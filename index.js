/* Menu Organizer for SillyTavern
 * จัดเรียง + ซ่อน/แสดง บล็อกตั้งค่า extension ในหน้า Extensions (fa-cubes)
 * ลากข้ามคอลัมน์ได้ · โปรไฟล์คอม/มือถือแยกกัน · ประหยัดงาน idle
 */
(() => {
    if (window.__MENU_ORGANIZER_LOADED__) return;
    window.__MENU_ORGANIZER_LOADED__ = true;

    const MODULE_NAME = 'menuOrganizer';
    const KEY_ATTR = 'data-mo-key';
    const OWN_ID = 'menu-organizer-settings';
    const MOBILE_MEDIA = '(max-width: 768px)';
    const COLS = [
        { id: 'extensions_settings', label: 'คอลัมน์ซ้าย' },
        { id: 'extensions_settings2', label: 'คอลัมน์ขวา' },
    ];
    const defaultLayout = Object.fromEntries(COLS.map(c => [c.id, []]));
    const defaultKeys = new Set();

    // debounce: idle ยาวขึ้น / ตอนมี editor เปิด ตอบสนองเร็วขึ้น
    const REAPPLY_MS_IDLE = 280;
    const REAPPLY_MS_ACTIVE = 80;
    const BOOT_POLL_MS = 400;
    const BOOT_POLL_MAX = 60; // ~24s แล้วหยุด — ไม่ poll ตลอดชีพ

    function currentProfile() {
        try { return window.matchMedia(MOBILE_MEDIA).matches ? 'mobile' : 'desktop'; }
        catch (_) { return (window.innerWidth || 9999) <= 768 ? 'mobile' : 'desktop'; }
    }
    function isPageVisible() {
        return document.visibilityState !== 'hidden';
    }

    // ------------------------------------------------------------------
    // Context / settings
    // ------------------------------------------------------------------
    const Core = {
        getContext() {
            try { return window.SillyTavern?.getContext?.() || null; } catch (_) { return null; }
        },
        get root() {
            const ctx = this.getContext();
            if (!ctx) return null;
            const store = ctx.extensionSettings;
            store[MODULE_NAME] = store[MODULE_NAME] || {};
            const s = store[MODULE_NAME];
            if (!s.profiles || typeof s.profiles !== 'object') {
                s.profiles = {};
                if (s.layout || s.hidden) {
                    s.profiles.desktop = {
                        layout: s.layout || {},
                        hidden: Array.isArray(s.hidden) ? s.hidden : [],
                    };
                }
            }
            delete s.layout;
            delete s.hidden;
            if (!s.versionPins || typeof s.versionPins !== 'object' || Array.isArray(s.versionPins)) {
                s.versionPins = {};
            }
            return s;
        },
        profile(name) {
            const root = this.root;
            if (!root) return null;
            const p = name || currentProfile();
            root.profiles[p] = root.profiles[p] || {};
            const s = root.profiles[p];
            s.layout = s.layout || {};
            for (const c of COLS) if (!Array.isArray(s.layout[c.id])) s.layout[c.id] = [];
            if (!Array.isArray(s.hidden)) s.hidden = [];
            return s;
        },
        get settings() { return this.profile(); },
        save() {
            const ctx = this.getContext();
            if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
        },
    };

    // ------------------------------------------------------------------
    // Third-party extension version management
    // ------------------------------------------------------------------
    function normalizeExtensionEntry(entry) {
        if (!entry || !['local', 'global'].includes(entry.type) || typeof entry.name !== 'string') return null;
        const extensionName = entry.name.replace(/^third-party\//, '');
        if (!extensionName) return null;
        return {
            id: `${entry.type}:${extensionName}`,
            extensionName,
            internalName: entry.name,
            global: entry.type === 'global',
            type: entry.type,
        };
    }

    function pinKey(item) {
        return `${item.type}:${item.extensionName}`;
    }

    function isPinned(item) {
        return Core.root?.versionPins?.[pinKey(item)] === true;
    }

    function setPinned(item, pinned) {
        const root = Core.root;
        if (!root) return;
        if (pinned) root.versionPins[pinKey(item)] = true;
        else delete root.versionPins[pinKey(item)];
        Core.save();
    }

    function compareBranchNames(a, b) {
        const parse = name => {
            const match = String(name).match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-.]([0-9A-Za-z.-]+))?$/);
            return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0), match[4] || ''] : null;
        };
        const av = parse(a);
        const bv = parse(b);
        if (av && bv) {
            for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
            if (av[3] !== bv[3]) return av[3] ? 1 : -1;
        } else if (av) return -1;
        else if (bv) return 1;
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    function dedupeBranches(branches) {
        const byName = new Map();
        for (const branch of Array.isArray(branches) ? branches : []) {
            if (!branch || typeof branch.name !== 'string' || branch.name === 'origin/HEAD') continue;
            const shortName = branch.name.replace(/^origin\//, '');
            const previous = byName.get(shortName);
            const isLocal = !branch.name.startsWith('origin/');
            if (!previous || branch.current || (!previous.current && isLocal && previous.name.startsWith('origin/'))) {
                byName.set(shortName, { ...branch, shortName });
            }
        }
        return [...byName.values()].sort((a, b) => compareBranchNames(a.shortName, b.shortName));
    }

    async function apiRequest(path, body) {
        const ctx = Core.getContext();
        const options = body === undefined
            ? { method: 'GET' }
            : {
                method: 'POST',
                headers: ctx?.getRequestHeaders?.() || { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            };
        const response = await fetch(path, options);
        if (!response.ok) {
            const message = (await response.text()).trim();
            throw new Error(message || `${response.status} ${response.statusText}`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    function notify(level, message, title) {
        const toast = window.toastr?.[level];
        if (typeof toast === 'function') toast(message, title);
        else if (level === 'error') console.error(title || 'Menu Organizer', message);
        else console.info(title || 'Menu Organizer', message);
    }

    async function mapLimit(items, limit, worker) {
        let next = 0;
        const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                await worker(items[index], index);
            }
        });
        await Promise.all(runners);
    }

    function extensionDisplayName(item) {
        const manifest = Core.getContext()?.getExtensionManifest?.(item.internalName)
            || Core.getContext()?.getExtensionManifest?.(item.extensionName);
        return manifest?.display_name || item.extensionName;
    }

    function extensionManifestVersion(item) {
        if (item.manifestVersion) return item.manifestVersion;
        const manifest = Core.getContext()?.getExtensionManifest?.(item.internalName)
            || Core.getContext()?.getExtensionManifest?.(item.extensionName);
        return manifest?.version || '';
    }

    async function refreshManifestVersion(item) {
        const manifestPath = item.internalName.split('/').map(encodeURIComponent).join('/');
        try {
            const manifest = await apiRequest(`/scripts/extensions/${manifestPath}/manifest.json?mo=${Date.now()}`);
            item.manifestVersion = manifest?.version || '';
        } catch (_) { /* manifest อาจหาย/เปลี่ยนระหว่างสลับ branch; ใช้ค่าที่โหลดไว้แทน */ }
    }

    function makeVersionCard(item, manager) {
        const card = $(`
            <section class="mo-version-card">
                <div class="mo-version-head">
                    <div class="mo-version-title-wrap">
                        <strong class="mo-version-title"></strong>
                        <span class="mo-scope-badge"></span>
                    </div>
                    <button type="button" class="mo-pin menu_button menu_button_icon" aria-pressed="false">
                        <span class="fa-solid fa-lock-open"></span><span class="mo-pin-label"> Pin</span>
                    </button>
                </div>
                <div class="mo-version-meta">
                    <span class="mo-current-version">กำลังตรวจสอบ…</span>
                    <span class="mo-current-branch"></span>
                    <span class="mo-current-commit"></span>
                </div>
                <div class="mo-version-status" aria-live="polite">รอสักครู่…</div>
                <div class="mo-version-controls">
                    <button type="button" class="mo-branch-prev menu_button" title="Older / branch ลำดับถัดไป" aria-label="เลือก version เก่ากว่าหรือ branch ลำดับถัดไป">◀</button>
                    <select class="text_pole mo-branch-select" aria-label="เลือก version หรือ branch" disabled>
                        <option>กำลังโหลด branches…</option>
                    </select>
                    <button type="button" class="mo-branch-next menu_button" title="Newer / branch ลำดับก่อนหน้า" aria-label="เลือก version ใหม่กว่าหรือ branch ลำดับก่อนหน้า">▶</button>
                    <button type="button" class="mo-update-one menu_button menu_button_icon">
                        <span class="fa-solid fa-download"></span><span> Update</span>
                    </button>
                </div>
                <div class="mo-card-error" role="alert"></div>
            </section>`);
        card.find('.mo-version-title').text(extensionDisplayName(item));
        card.find('.mo-scope-badge').text(item.global ? 'Global' : 'Local');
        item.card = card;
        item.busy = false;

        const setBusy = busy => {
            item.busy = busy;
            card.toggleClass('mo-card-busy', busy);
            card.find('button, select').prop('disabled', busy || !item.version?.currentCommitHash);
            card.find('.mo-pin').prop('disabled', busy);
        };

        const syncPin = () => {
            const pinned = isPinned(item);
            card.toggleClass('mo-version-pinned', pinned);
            card.find('.mo-pin')
                .attr('aria-pressed', String(pinned))
                .attr('title', pinned ? 'เลิก Pin เพื่อให้ Update All อัปเดตตัวนี้' : 'Pin เพื่อข้ามตัวนี้ตอน Update All')
                .find('.fa-solid').toggleClass('fa-lock', pinned).toggleClass('fa-lock-open', !pinned);
            card.find('.mo-pin-label').text(pinned ? ' Pinned' : ' Pin');
        };

        const paint = () => {
            const version = item.version || {};
            const manifestVersion = extensionManifestVersion(item);
            const branches = item.branches || [];
            const current = branches.find(branch => branch.current);
            const currentName = version.currentBranchName || current?.shortName || '';
            const isGit = Boolean(version.currentCommitHash);
            card.find('.mo-current-version').text(manifestVersion ? `v${String(manifestVersion).replace(/^v/, '')}` : (isGit ? 'ไม่มีเลข version ใน manifest' : 'ไม่ใช่ Git repository'));
            card.find('.mo-current-branch').text(currentName ? `Branch: ${currentName}` : '');
            card.find('.mo-current-commit').text(version.currentCommitHash ? `Commit: ${version.currentCommitHash.slice(0, 7)}` : '');
            card.find('.mo-version-status')
                .toggleClass('mo-update-available', isGit && version.isUpToDate === false)
                .text(!isGit ? 'จัดการเวอร์ชันไม่ได้' : (version.isUpToDate ? 'เป็นเวอร์ชันล่าสุดของ branch นี้แล้ว' : 'มีอัปเดตใน branch นี้'));

            const select = card.find('.mo-branch-select').empty();
            if (!branches.length) select.append($('<option>').text(currentName || 'ไม่พบ branch').val(currentName));
            else branches.forEach(branch => select.append(
                $('<option>').val(branch.name).text(`${branch.shortName}${branch.current ? ' · Current' : ''}`),
            ));
            if (current) select.val(current.name);
            else if (currentName) {
                const match = branches.find(branch => branch.shortName === currentName);
                if (match) select.val(match.name);
            }
            setBusy(false);
            card.find('.mo-branch-prev, .mo-branch-next').prop('disabled', !isGit || branches.length < 2);
            card.find('.mo-branch-select').prop('disabled', !isGit || branches.length < 2);
            card.find('.mo-update-one').prop('disabled', !isGit);
            card.find('.mo-pin').prop('disabled', !isGit);
            syncPin();
        };

        const refresh = async () => {
            setBusy(true);
            card.find('.mo-card-error').empty();
            card.find('.mo-version-status').text('กำลังตรวจสอบ repository…');
            try {
                item.version = await apiRequest('/api/extensions/version', {
                    extensionName: item.extensionName,
                    global: item.global,
                });
                await refreshManifestVersion(item);
                item.branches = [];
                let branchError = '';
                if (item.version?.currentCommitHash) {
                    try {
                        item.branches = dedupeBranches(await apiRequest('/api/extensions/branches', {
                            extensionName: item.extensionName,
                            global: item.global,
                        }));
                    } catch (error) {
                        branchError = error.message || String(error);
                    }
                }
                paint();
                if (branchError) card.find('.mo-card-error').text(`โหลด branches ไม่สำเร็จ: ${branchError}`);
            } catch (error) {
                item.version = null;
                item.branches = [];
                setBusy(false);
                card.find('.mo-version-status').text('ตรวจสอบไม่สำเร็จ');
                card.find('.mo-card-error').text(error.message || String(error));
            }
        };

        const switchBranch = async branchName => {
            const branch = item.branches.find(value => value.name === branchName);
            if (!branch || branch.current || item.busy) return;
            if (!window.confirm(`สลับ ${extensionDisplayName(item)} ไปที่ branch “${branch.shortName}”?\n\nควร reload หน้า SillyTavern หลังสลับเพื่อใช้ไฟล์ของ branch ใหม่`)) {
                paint();
                return;
            }
            setBusy(true);
            card.find('.mo-version-status').text(`กำลังสลับไป ${branch.shortName}…`);
            try {
                await apiRequest('/api/extensions/switch', {
                    extensionName: item.extensionName,
                    branch: branch.name,
                    global: item.global,
                });
                notify('success', `${extensionDisplayName(item)} → ${branch.shortName}`, 'สลับ branch แล้ว · กรุณา reload หน้า');
                await refresh();
            } catch (error) {
                setBusy(false);
                paint();
                card.find('.mo-card-error').text(error.message || String(error));
                notify('error', error.message || String(error), 'สลับ branch ไม่สำเร็จ');
            }
        };

        const update = async ({ quiet = false } = {}) => {
            if (!item.version?.currentCommitHash || item.busy) return false;
            setBusy(true);
            card.find('.mo-card-error').empty();
            card.find('.mo-version-status').text('กำลังอัปเดต branch ปัจจุบัน…');
            try {
                await apiRequest('/api/extensions/update', {
                    extensionName: item.extensionName,
                    global: item.global,
                });
                await refresh();
                if (!quiet) notify('success', `${extensionDisplayName(item)} อัปเดตแล้ว`, 'กรุณา reload หน้าเพื่อใช้เวอร์ชันใหม่');
                return true;
            } catch (error) {
                setBusy(false);
                paint();
                card.find('.mo-card-error').text(error.message || String(error));
                if (!quiet) notify('error', error.message || String(error), 'อัปเดตไม่สำเร็จ');
                return false;
            }
        };

        card.find('.mo-pin').on('click', () => {
            setPinned(item, !isPinned(item));
            syncPin();
            manager.updateSummary();
        });
        card.find('.mo-branch-select').on('change', function () { void switchBranch(this.value); });
        card.find('.mo-branch-prev, .mo-branch-next').on('click', function () {
            const branches = item.branches || [];
            const currentIndex = Math.max(0, branches.findIndex(branch => branch.current));
            // Version-like branches เรียงใหม่ -> เก่า: ซ้ายไป index ถัดไป, ขวาไป index ก่อนหน้า
            const delta = $(this).hasClass('mo-branch-prev') ? 1 : -1;
            const nextIndex = Math.min(branches.length - 1, Math.max(0, currentIndex + delta));
            if (nextIndex !== currentIndex) void switchBranch(branches[nextIndex].name);
        });
        card.find('.mo-update-one').on('click', () => void update());
        syncPin();
        return { card, refresh, update, paint };
    }

    function buildVersionManager() {
        const wrapper = $(`
            <div class="mo-version-manager">
                <div class="mo-version-intro">
                    จัดการเฉพาะ third-party Git extensions · เลือกได้ตาม branch ที่ repository มี (Git tags ยังไม่รองรับโดย SillyTavern API)
                </div>
                <div class="mo-version-toolbar">
                    <div class="mo-version-summary" aria-live="polite">กำลังค้นหา extensions…</div>
                    <div class="mo-version-actions">
                        <button type="button" class="mo-check-all menu_button menu_button_icon"><span class="fa-solid fa-rotate"></span><span> Check All</span></button>
                        <button type="button" class="mo-update-all menu_button menu_button_icon"><span class="fa-solid fa-cloud-arrow-down"></span><span> Update All</span></button>
                    </div>
                </div>
                <div class="mo-version-list"></div>
            </div>`);
        const manager = {
            wrapper,
            items: [],
            controls: [],
            busy: false,
            updateSummary() {
                const gitItems = this.items.filter(item => item.version?.currentCommitHash);
                const pinned = gitItems.filter(isPinned).length;
                wrapper.find('.mo-version-summary').text(
                    `${this.items.length} extensions · Git ${gitItems.length}${pinned ? ` · Pin ${pinned}` : ''}`,
                );
            },
            setBusy(busy) {
                this.busy = busy;
                wrapper.find('.mo-check-all, .mo-update-all').prop('disabled', busy);
            },
        };

        const discover = async () => {
            manager.setBusy(true);
            const list = wrapper.find('.mo-version-list').empty().append('<div class="mo-version-loading"><span class="fa-solid fa-spinner fa-spin"></span> กำลังค้นหา extensions…</div>');
            try {
                const discovered = await apiRequest('/api/extensions/discover');
                manager.items = (Array.isArray(discovered) ? discovered : [])
                    .map(normalizeExtensionEntry)
                    .filter(Boolean)
                    .sort((a, b) => extensionDisplayName(a).localeCompare(extensionDisplayName(b), undefined, { sensitivity: 'base' }));
                list.empty();
                if (!manager.items.length) {
                    list.append('<div class="mo-version-empty">ไม่พบ third-party extension ที่ติดตั้งอยู่</div>');
                    manager.updateSummary();
                    manager.setBusy(false);
                    return;
                }
                manager.controls = manager.items.map(item => {
                    const control = makeVersionCard(item, manager);
                    list.append(control.card);
                    return control;
                });
                await mapLimit(manager.controls, 3, control => control.refresh());
                manager.updateSummary();
            } catch (error) {
                list.empty().append($('<div class="mo-version-empty mo-card-error"></div>').text(error.message || String(error)));
                wrapper.find('.mo-version-summary').text('โหลดรายการไม่สำเร็จ');
            } finally {
                manager.setBusy(false);
            }
        };

        wrapper.find('.mo-check-all').on('click', async () => {
            if (manager.busy) return;
            manager.setBusy(true);
            await mapLimit(manager.controls, 3, control => control.refresh());
            manager.updateSummary();
            manager.setBusy(false);
        });
        wrapper.find('.mo-update-all').on('click', async () => {
            if (manager.busy) return;
            const targets = manager.controls.filter((control, index) => {
                const item = manager.items[index];
                return item.version?.currentCommitHash && !isPinned(item);
            });
            const skipped = manager.items.filter(item => item.version?.currentCommitHash && isPinned(item)).length;
            if (!targets.length) {
                notify('info', skipped ? 'ทุก extension ถูก Pin ไว้' : 'ไม่พบ Git extension ที่อัปเดตได้', 'Update All');
                return;
            }
            if (!window.confirm(`อัปเดต ${targets.length} extensions ตาม branch ปัจจุบัน?${skipped ? `\nข้าม ${skipped} ตัวที่ Pin ไว้` : ''}`)) return;
            manager.setBusy(true);
            let succeeded = 0;
            for (let i = 0; i < targets.length; i++) {
                wrapper.find('.mo-version-summary').text(`กำลังอัปเดต ${i + 1}/${targets.length}…`);
                if (await targets[i].update({ quiet: true })) succeeded++;
            }
            manager.updateSummary();
            manager.setBusy(false);
            const failed = targets.length - succeeded;
            notify(failed ? 'warning' : 'success', `สำเร็จ ${succeeded}${failed ? ` · ไม่สำเร็จ ${failed}` : ''}${skipped ? ` · ข้าม Pin ${skipped}` : ''}`, 'Update All เสร็จแล้ว · กรุณา reload หน้า');
        });

        return { wrapper, discover };
    }

    async function openVersionManager() {
        const ctx = Core.getContext();
        const { wrapper, discover } = buildVersionManager();
        let popupPromise;
        try {
            if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                popupPromise = ctx.callGenericPopup(
                    wrapper,
                    ctx.POPUP_TYPE.TEXT,
                    '',
                    { wide: true, large: true, okButton: 'ปิด' },
                );
            } else {
                const overlay = $('<div class="mo-overlay"></div>').append(wrapper);
                $('body').append(overlay);
                popupPromise = new Promise(resolve => overlay.on('click', event => {
                    if (event.target === overlay[0]) {
                        overlay.remove();
                        resolve();
                    }
                }));
            }
            void discover();
            await popupPromise;
        } catch (_) { /* closed / cancelled */ }
    }

    // ------------------------------------------------------------------
    // Item identity + metadata
    // ------------------------------------------------------------------
    function getItemKey(el) {
        if (el.id) return `id:${el.id}`;
        const existing = el.getAttribute(KEY_ATTR);
        if (existing) return existing;
        const header = el.querySelector('.inline-drawer-header b, .inline-drawer-toggle b, h3, h4');
        const text = (header?.textContent || el.textContent || '').trim().slice(0, 32).replace(/\s+/g, '_');
        return `gen:${text || 'item'}`;
    }

    function ensureKeys() {
        const seen = new Set();
        for (const c of COLS) {
            const col = document.getElementById(c.id);
            if (!col) continue;
            for (const child of col.children) {
                let key = child.getAttribute(KEY_ATTR);
                if (!key) {
                    key = getItemKey(child);
                    if (seen.has(key)) {
                        let n = 2;
                        while (seen.has(`${key}#${n}`)) n++;
                        key = `${key}#${n}`;
                    }
                    child.setAttribute(KEY_ATTR, key);
                }
                seen.add(key);
                if (!defaultKeys.has(key)) {
                    defaultKeys.add(key);
                    defaultLayout[c.id].push(key);
                }
            }
        }
    }

    function isRenderable(el) {
        if (el.id === OWN_ID) return true;
        return el.children.length > 0 || (el.textContent || '').trim() !== '';
    }

    function isLockedFromHide(el) {
        return el.id === OWN_ID;
    }

    function getLabel(el) {
        const header = el.querySelector('.inline-drawer-header b, .inline-drawer-toggle b, h3, h4');
        const text = (header?.textContent || '').trim().replace(/\s+/g, ' ');
        if (text) return text;
        if (el.id) {
            return el.id
                .replace(/_container$/, '')
                .replace(/-settings$/, '')
                .replace(/[_-]/g, ' ')
                .trim();
        }
        return '(ไม่มีชื่อ)';
    }

    function getIconClass(el) {
        const icon = el.querySelector(
            '.inline-drawer-header [class*="fa-"], .inline-drawer-toggle [class*="fa-"], b [class*="fa-"]',
        );
        if (!icon) return 'fa-solid fa-puzzle-piece';
        const cls = [...icon.classList].filter(c => c.startsWith('fa-'));
        return cls.length ? cls.join(' ') : 'fa-solid fa-puzzle-piece';
    }

    // ------------------------------------------------------------------
    // Apply layout (minimal DOM writes)
    // ------------------------------------------------------------------
    function placeAt(parent, node, idx) {
        let ref = parent.children[idx] || null;
        if (ref === node) return false;
        if (node.parentNode === parent && [...parent.children].indexOf(node) < idx) ref = ref?.nextSibling || null;
        parent.insertBefore(node, ref);
        return true;
    }

    let applyQueued = false;
    function applyLayout() {
        const settings = Core.settings;
        if (!settings) return;
        const cols = COLS.map(c => document.getElementById(c.id));
        if (cols.some(c => !c)) return;

        // หยุด observer ชั่วคราวตอนเขียน DOM เอง
        const wasWatching = observers.length > 0;
        stopObserver();
        try {
            ensureKeys();

            const byKey = new Map();
            for (const col of cols) {
                for (const ch of col.children) byKey.set(ch.getAttribute(KEY_ATTR), ch);
            }

            const placed = new Set();
            const nextIndex = [0, 0];

            // วางรายการที่บันทึกของทั้งสองคอลัมน์ก่อน เพื่อไม่ให้รายการของ
            // คอลัมน์ขวาที่เริ่มต้นอยู่ซ้ายถูกนับเป็น "รายการใหม่" ผิดฝั่ง
            COLS.forEach((c, i) => {
                const col = cols[i];
                const order = [...settings.layout[c.id], ...defaultLayout[c.id].filter(key =>
                    !COLS.some(column => settings.layout[column.id].includes(key)))];
                for (const key of order) {
                    const el = byKey.get(key);
                    if (el && !placed.has(key)) {
                        placeAt(col, el, nextIndex[i]++);
                        placed.add(key);
                    }
                }
            });

            COLS.forEach((c, i) => {
                const col = cols[i];
                // item ใหม่: ต่อท้ายคอลัมน์เดิมตามลำดับปัจจุบัน
                for (const ch of [...col.children]) {
                    const key = ch.getAttribute(KEY_ATTR);
                    if (!placed.has(key)) {
                        placeAt(col, ch, nextIndex[i]++);
                        placed.add(key);
                    }
                }
            });

            const hidden = new Set(settings.hidden);
            byKey.forEach((el, key) => {
                if (hidden.has(key) && !isLockedFromHide(el)) {
                    if (el.dataset.moHidden !== '1') {
                        el.dataset.moHidden = '1';
                        el.classList.add('mo-panel-hidden');
                    }
                } else if (el.dataset.moHidden === '1') {
                    delete el.dataset.moHidden;
                    el.classList.remove('mo-panel-hidden');
                }
            });
        } finally {
            if (wasWatching && shouldObserve()) startObserver();
        }
    }

    /** จัดคิว apply ผ่าน rAF — รวมหลาย schedule ในเฟรมเดียว */
    function queueApplyLayout() {
        if (applyQueued) return;
        applyQueued = true;
        requestAnimationFrame(() => {
            applyQueued = false;
            if (!isPageVisible()) {
                // หน้าซ่อน: เลื่อนไปทำตอนกลับมาโชว์
                return;
            }
            applyLayout();
        });
    }

    // ------------------------------------------------------------------
    // Observer — ทำงานเฉพาะเมื่อหน้ามองเห็น + คอลัมน์ยังอยู่ในเอกสาร
    // ------------------------------------------------------------------
    let observers = [];
    let reapplyTimer = null;
    let editorOpen = false;
    let refreshEditor = null;

    function shouldObserve() {
        return isPageVisible() && COLS.every(c => document.getElementById(c.id));
    }

    function scheduleReapply() {
        if (!isPageVisible()) {
            return;
        }
        clearTimeout(reapplyTimer);
        const ms = editorOpen ? REAPPLY_MS_ACTIVE : REAPPLY_MS_IDLE;
        reapplyTimer = setTimeout(queueApplyLayout, ms);
    }

    function stopObserver() {
        if (!observers.length) return;
        for (const o of observers) o.disconnect();
        observers = [];
    }

    function startObserver() {
        if (!shouldObserve()) return;
        // ถ้า observe อยู่แล้วและ target เดิม — ไม่ recreate
        if (observers.length === COLS.length) {
            let same = true;
            for (let i = 0; i < COLS.length; i++) {
                const col = document.getElementById(COLS[i].id);
                if (!col || observers[i].__moTarget !== col) { same = false; break; }
            }
            if (same) return;
        }
        stopObserver();
        for (const c of COLS) {
            const col = document.getElementById(c.id);
            if (!col) continue;
            const obs = new MutationObserver(muts => {
                // สนใจเฉพาะ childList ที่มี node เข้า/ออกจริง
                for (const m of muts) {
                    if (m.addedNodes.length || m.removedNodes.length) {
                        scheduleReapply();
                        return;
                    }
                }
            });
            obs.observe(col, { childList: true });
            obs.__moTarget = col;
            observers.push(obs);
        }
    }

    function onVisibilityChange() {
        if (isPageVisible()) {
            // Changes made while disconnected must be reconciled on return.
            queueApplyLayout();
            startObserver();
        } else {
            // แท็บ/แอปถูกซ่อน: ตัด observer ลด wake-up + เคลียร์ timer
            clearTimeout(reapplyTimer);
            reapplyTimer = null;
            stopObserver();
        }
    }

    // ------------------------------------------------------------------
    // Profile switch (desktop <-> mobile)
    // ------------------------------------------------------------------
    let lastProfile = null;
    let mq = null;
    let mqHandler = null;

    function watchProfile() {
        lastProfile = currentProfile();
        const onChange = () => {
            const now = currentProfile();
            if (now === lastProfile) return;
            lastProfile = now;
            applyLayout();
            refreshEditor?.();
        };
        try {
            mq = window.matchMedia(MOBILE_MEDIA);
            mqHandler = onChange;
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch (_) {
            // fallback เบา: ใช้ matchMedia ไม่ได้ค่อย resize (debounced ผ่าน schedule)
            window.addEventListener('resize', onChange, { passive: true });
        }
    }

    // ------------------------------------------------------------------
    // Editor UI
    // ------------------------------------------------------------------
    function makeRow(el, hiddenSet, persist, mobile) {
        const key = el.getAttribute(KEY_ATTR);
        const locked = isLockedFromHide(el);
        const isHidden = !locked && hiddenSet.has(key);
        const row = $(`
            <div class="mo-row ${isHidden ? 'mo-row-hidden' : ''} ${locked ? 'mo-row-locked' : ''}">
                <div class="mo-handle fa-solid fa-grip-vertical" title="ลากเพื่อจัดเรียง / ย้ายคอลัมน์" aria-label="ลากจัดเรียง"></div>
                <div class="mo-icon" aria-hidden="true"></div>
                <div class="mo-label"></div>
                <div class="mo-move-actions">
                    <button type="button" class="mo-move mo-up" title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น">↑</button>
                    <button type="button" class="mo-move mo-down" title="เลื่อนลง" aria-label="เลื่อนลง">↓</button>
                    ${mobile ? '' : '<button type="button" class="mo-move mo-across" title="ย้ายคอลัมน์" aria-label="ย้ายคอลัมน์">⇄</button>'}
                </div>
                <button type="button" class="mo-toggle fa-solid ${locked ? 'fa-lock' : (isHidden ? 'fa-eye-slash' : 'fa-eye')}"
                     title="${locked ? 'บล็อกนี้ซ่อนไม่ได้ (กันเปิดกลับไม่ได้)' : 'ซ่อน/แสดง'}"
                     aria-label="${locked ? 'ซ่อนไม่ได้' : 'ซ่อน/แสดงเมนูนี้'}"
                     aria-pressed="${isHidden}" ${locked ? 'disabled' : ''}></button>
            </div>`);
        row.attr('data-key', key);
        if (locked) row.attr('data-locked', '1');
        row.find('.mo-icon').addClass(getIconClass(el));
        const label = getLabel(el);
        row.find('.mo-label').text(label).attr('title', label);
        row.find('button').each(function () {
            this.setAttribute('aria-label', `${this.getAttribute('aria-label')}: ${label}`);
        });
        row.find('.mo-move').on('click', function () {
            const node = row[0];
            if (this.classList.contains('mo-across')) {
                const other = row.closest('.mo-columns').find('.mo-list').toArray()
                    .find(list => list !== node.parentNode);
                if (!other) return;
                other.appendChild(node);
            } else {
                const up = this.classList.contains('mo-up');
                let neighbor = up ? node.previousElementSibling : node.nextElementSibling;
                while (neighbor?.hidden) neighbor = up ? neighbor.previousElementSibling : neighbor.nextElementSibling;
                if (!neighbor) return;
                node.parentNode.insertBefore(node, up ? neighbor : neighbor.nextElementSibling);
            }
            persist();
            this.focus({ preventScroll: true });
            node.scrollIntoView({ block: 'nearest' });
        });
        if (!locked) {
            const toggle = () => {
                const nowHidden = row.toggleClass('mo-row-hidden').hasClass('mo-row-hidden');
                row.find('.mo-toggle')
                    .toggleClass('fa-eye', !nowHidden)
                    .toggleClass('fa-eye-slash', nowHidden)
                    .attr('aria-pressed', String(nowHidden));
                persist();
            };
            row.find('.mo-toggle').on('click', toggle);
        }
        return row;
    }

    function buildEditor() {
        const cols = COLS.map(c => document.getElementById(c.id));
        if (cols.some(c => !c)) {
            return { wrapper: $('<div>เปิดหน้า Extensions ก่อน แล้วลองใหม่</div>'), lists: [] };
        }

        ensureKeys();
        applyLayout();
        const settings = Core.settings;
        const hiddenSet = new Set(settings.hidden);
        const mobile = currentProfile() === 'mobile';
        const lists = [];
        const persist = () => persistEditor(lists, settings);
        const columns = $('<div class="mo-columns"></div>');
        const groups = mobile
            ? [{ ...COLS[0], label: 'เมนูทั้งหมด', elements: cols.flatMap(col => [...col.children]) }]
            : COLS.map((c, i) => ({ ...c, elements: [...cols[i].children] }));

        groups.forEach(c => {
            const colWrap = $('<div class="mo-col"><div class="mo-col-title"></div></div>');
            colWrap.find('.mo-col-title').text(c.label);
            const list = $('<div class="mo-list mo-connected"></div>').attr('data-col', c.id);
            for (const el of c.elements) {
                if (isRenderable(el)) list.append(makeRow(el, hiddenSet, persist, mobile));
            }
            colWrap.append(list);
            columns.append(colWrap);
            lists.push(list);
        });

        const wrapper = $('<div class="mo-editor"></div>');
        wrapper.toggleClass('mo-touch-editor', mobile || !$.fn.sortable);
        const badge = $('<div class="mo-profile-badge"><span class="fa-solid"></span> <span class="mo-profile-text"></span></div>');
        badge.find('.fa-solid').addClass(mobile ? 'fa-mobile-screen-button' : 'fa-desktop');
        badge.find('.mo-profile-text').text(
            mobile
                ? 'โปรไฟล์มือถือ · แยกจากคอมพิวเตอร์'
                : 'โปรไฟล์คอมพิวเตอร์ · แยกจากมือถือ',
        );
        wrapper.append(badge);
        wrapper.append(
            '<div class="mo-editor-hint">'
            + (mobile
                ? 'กด ↑ ↓ เพื่อเรียงเมนู · กดตาเพื่อซ่อน/แสดง · บันทึกอัตโนมัติ'
                : 'กด ↑ ↓ เพื่อเรียง หรือ ⇄ เพื่อย้ายคอลัมน์ · ลากได้ด้วยที่จับ · บันทึกอัตโนมัติ')
            + '</div>',
        );

        const search = $('<input class="text_pole mo-search" type="search" placeholder="ค้นหาเมนู…" aria-label="ค้นหาเมนู">');
        const status = $('<span class="mo-search-status" aria-live="polite"></span>');
        search.on('input', function () {
            const query = this.value.trim().toLocaleLowerCase();
            let found = 0;
            lists.forEach(list => list.find('.mo-row').each(function () {
                const match = !query || $(this).find('.mo-label').text().toLocaleLowerCase().includes(query);
                this.hidden = !match;
                if (match) found++;
            }));
            status.text(query ? `พบ ${found} เมนู` : '');
        });

        const showAllBtn = $('<button type="button" class="menu_button menu_button_icon mo-show-all"><span class="fa-solid fa-eye"></span> แสดงทั้งหมด</button>');
        showAllBtn.on('click', () => {
            settings.hidden = [];
            lists.forEach(list => {
                list.find('.mo-row-hidden').removeClass('mo-row-hidden');
                list.find('.mo-row:not(.mo-row-locked) .mo-toggle')
                    .removeClass('fa-eye-slash').addClass('fa-eye')
                    .attr('aria-pressed', 'false');
            });
            search.val('').trigger('input');
            persist();
        });

        const resetBtn = $('<button type="button" class="menu_button menu_button_icon mo-reset"><span class="fa-solid fa-rotate-left"></span> คืนค่าเริ่มต้น</button>');
        resetBtn.on('click', () => {
            if (!window.confirm('คืนลำดับและการแสดงเมนูทั้งหมดเป็นค่าเริ่มต้นของโปรไฟล์นี้?')) return;

            const rows = new Map();
            lists.forEach(list => list.find('.mo-row').each(function () {
                rows.set(this.getAttribute('data-key'), this);
            }));
            const defaults = mobile
                ? [COLS.flatMap(c => defaultLayout[c.id])]
                : COLS.map(c => defaultLayout[c.id]);
            defaults.forEach((keys, i) => keys.forEach(key => {
                const row = rows.get(key);
                if (row) lists[i].append(row);
            }));
            for (const c of COLS) settings.layout[c.id] = [...defaultLayout[c.id]];
            if (mobile) {
                settings.layout[COLS[0].id] = COLS.flatMap(c => defaultLayout[c.id]);
                settings.layout[COLS[1].id] = [];
            }
            showAllBtn.trigger('click');
        });

        const toolbar = $('<div class="mo-toolbar"></div>');
        toolbar.append($('<div class="mo-search-wrap"><span class="fa-solid fa-magnifying-glass" aria-hidden="true"></span></div>').append(search));
        toolbar.append($('<div class="mo-actions"></div>').append(showAllBtn, resetBtn));
        wrapper.append(toolbar, status);
        wrapper.append(columns);

        return { wrapper, lists, persist };
    }

    function persistEditor(lists, settings) {
        const represented = new Set();
        lists.forEach(list => list.find('.mo-row').each(function () {
            represented.add(this.getAttribute('data-key'));
        }));
        const hidden = settings.hidden.filter(key => !represented.has(key));
        // Keep preferences for extensions that have not loaded or have no content yet.
        for (const c of COLS) settings.layout[c.id] = settings.layout[c.id].filter(key => !represented.has(key));
        lists.forEach(list => {
            const order = [];
            list.find('.mo-row').each(function () {
                const key = this.getAttribute('data-key');
                order.push(key);
                if (this.classList.contains('mo-row-hidden')) hidden.push(key);
            });
            settings.layout[list.attr('data-col')] = [...order, ...settings.layout[list.attr('data-col')]];
        });
        settings.hidden = hidden;
        Core.save();
        applyLayout();
    }

    function destroySortables(lists) {
        if (!$.fn.sortable || !lists?.length) return;
        lists.forEach(list => {
            try {
                if (list.data('ui-sortable')) list.sortable('destroy');
            } catch (_) { /* already gone */ }
        });
    }

    async function openEditor() {
        if (editorOpen) return;
        const ctx = Core.getContext();
        let { wrapper, lists, persist } = buildEditor();
        editorOpen = true;

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            editorOpen = false;
            refreshEditor = null;
            destroySortables(lists);
        };

        // Desktop dragging is optional; buttons work on touch and with a keyboard.
        const sortableOpts = {
            handle: '.mo-handle',
            connectWith: '.mo-connected',
            tolerance: 'pointer',
            placeholder: 'mo-sortable-placeholder',
            forcePlaceholderSize: true,
            scroll: true,
            scrollSensitivity: 30,
            scrollSpeed: 10,
            distance: 3,
            helper: 'original',
            // stop fires once, after a cross-column drop has finished.
            stop: () => persist?.(),
        };

        const initSortables = () => {
            if (cleaned || currentProfile() === 'mobile' || !$.fn.sortable || !lists.length) return;
            lists.forEach(list => list.sortable({ ...sortableOpts, items: '.mo-row:not([hidden])' }));
        };
        refreshEditor = () => {
            destroySortables(lists);
            const next = buildEditor();
            const close = wrapper.find('.mo-close').detach();
            wrapper.attr('class', next.wrapper.attr('class')).empty().append(next.wrapper.children());
            wrapper.append(close);
            lists = next.lists;
            persist = next.persist;
            initSortables();
        };
        setTimeout(initSortables, 40);

        try {
            if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                await ctx.callGenericPopup(
                    wrapper,
                    ctx.POPUP_TYPE.TEXT,
                    '',
                    { wide: true, large: true, okButton: 'เสร็จสิ้น' },
                );
            } else {
                const overlay = $('<div class="mo-overlay" role="dialog" aria-modal="true" aria-label="Arrange Extensions"></div>').append(wrapper);
                const close = $('<button type="button" class="menu_button mo-close">เสร็จสิ้น</button>');
                wrapper.append(close);
                $('body').append(overlay);
                await new Promise(resolve => {
                    const dismiss = () => {
                        overlay.remove();
                        resolve();
                    };
                    close.on('click', dismiss);
                    overlay.on('click', e => {
                        if (e.target === overlay[0]) dismiss();
                    });
                    overlay.on('keydown', e => {
                        if (e.key === 'Escape') dismiss();
                        if (e.key !== 'Tab') return;
                        const buttons = overlay.find('input, button:not(:disabled)').filter(':visible').toArray();
                        const first = buttons[0];
                        const last = buttons[buttons.length - 1];
                        if (e.shiftKey && e.target === first) { e.preventDefault(); last?.focus(); }
                        else if (!e.shiftKey && e.target === last) { e.preventDefault(); first?.focus(); }
                    });
                    close[0].focus();
                });
            }
        } catch (_) { /* closed / cancelled */ }
        cleanup();
        document.getElementById('mo-open-editor')?.focus();
    }

    // ------------------------------------------------------------------
    // Settings drawer entry
    // ------------------------------------------------------------------
    function injectSettingsDrawer() {
        const container = document.getElementById('extensions_settings');
        if (!container || document.getElementById(OWN_ID)) return false;
        const block = document.createElement('div');
        block.id = OWN_ID;
        block.className = 'extension_settings_block';
        block.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><span class="fa-solid fa-list-check"></span> Menu Organizer</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p class="mo-desc">จัดเรียง ซ่อน/แสดง และจัดการ branch/update ของ third-party extensions · คอม/มือถือจำ layout แยกกัน</p>
                    <div class="mo-entry-actions">
                        <button type="button" id="mo-open-editor" class="menu_button menu_button_icon">
                            <span class="fa-solid fa-arrows-up-down-left-right"></span>
                            <span>Arrange Extensions</span>
                        </button>
                        <button type="button" id="mo-open-version-manager" class="menu_button menu_button_icon">
                            <span class="fa-solid fa-code-branch"></span>
                            <span>Version Manager</span>
                        </button>
                    </div>
                </div>
            </div>`;
        container.appendChild(block);
        const btn = document.getElementById('mo-open-editor');
        if (btn) btn.addEventListener('click', openEditor);
        const versionBtn = document.getElementById('mo-open-version-manager');
        if (versionBtn) versionBtn.addEventListener('click', openVersionManager);
        return true;
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    let booted = false;
    function finishBoot() {
        if (booted) {
            injectSettingsDrawer(); // idempotent
            return;
        }
        if (!document.getElementById('extensions_settings')) return;
        booted = true;
        injectSettingsDrawer();
        applyLayout();
        startObserver();
        watchProfile();
        document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    }

    function onReady() {
        let ticks = 0;
        const wait = setInterval(() => {
            ticks++;
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                finishBoot();
            } else if (ticks >= BOOT_POLL_MAX) {
                clearInterval(wait);
                // ยังไม่เจอ — รอครั้งเดียวด้วย MutationObserver แล้วตัดทิ้ง
                const bootObs = new MutationObserver(() => {
                    if (document.getElementById('extensions_settings')) {
                        bootObs.disconnect();
                        finishBoot();
                    }
                });
                bootObs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => bootObs.disconnect(), 120000);
            }
        }, BOOT_POLL_MS);

        // ย้ำหลังโหลดช้า (idempotent ผ่าน finishBoot / inject)
        setTimeout(finishBoot, 1600);
    }

    if (window.SillyTavern?.getContext) onReady();
    else {
        document.addEventListener('DOMContentLoaded', onReady);
        window.addEventListener('load', onReady);
    }
})();
