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
    function profileLabel(p) {
        return p === 'mobile' ? 'มือถือ (จอแคบ)' : 'คอมพิวเตอร์ (จอกว้าง)';
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
        if (text) return text.slice(0, 48);
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
        const ref = parent.children[idx] || null;
        if (node.parentNode === parent && node.nextSibling === ref) return false;
        if (ref === node) return false;
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
            COLS.forEach((c, i) => {
                const col = cols[i];
                let idx = 0;
                for (const key of settings.layout[c.id]) {
                    const el = byKey.get(key);
                    if (el && !placed.has(key)) {
                        placeAt(col, el, idx++);
                        placed.add(key);
                    }
                }
                // item ใหม่: ต่อท้ายคอลัมน์เดิมตามลำดับปัจจุบัน
                for (const ch of [...col.children]) {
                    const key = ch.getAttribute(KEY_ATTR);
                    if (!placed.has(key)) {
                        placeAt(col, ch, idx++);
                        placed.add(key);
                    }
                }
            });

            const hidden = new Set(settings.hidden);
            byKey.forEach((el, key) => {
                if (hidden.has(key) && !isLockedFromHide(el)) {
                    if (el.dataset.moHidden !== '1') {
                        el.dataset.moHidden = '1';
                        el.style.setProperty('display', 'none', 'important');
                    }
                } else if (el.dataset.moHidden === '1') {
                    delete el.dataset.moHidden;
                    el.style.removeProperty('display');
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
                pendingApplyWhenVisible = true;
                return;
            }
            applyLayout();
        });
    }

    let pendingApplyWhenVisible = false;

    // ------------------------------------------------------------------
    // Observer — ทำงานเฉพาะเมื่อหน้ามองเห็น + คอลัมน์ยังอยู่ในเอกสาร
    // ------------------------------------------------------------------
    let observers = [];
    let reapplyTimer = null;
    let editorOpen = false;

    function shouldObserve() {
        return isPageVisible() && COLS.every(c => document.getElementById(c.id));
    }

    function scheduleReapply() {
        if (!isPageVisible()) {
            pendingApplyWhenVisible = true;
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
            if (pendingApplyWhenVisible) {
                pendingApplyWhenVisible = false;
                queueApplyLayout();
            }
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
            queueApplyLayout();
        };
        try {
            mq = window.matchMedia(MOBILE_MEDIA);
            mqHandler = onChange;
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch (_) {
            // fallback เบา: ใช้ matchMedia ไม่ได้ค่อย resize (debounced ผ่าน schedule)
            window.addEventListener('resize', () => scheduleReapply(), { passive: true });
        }
    }

    // ------------------------------------------------------------------
    // Editor UI
    // ------------------------------------------------------------------
    function makeRow(el, hiddenSet, persist) {
        const key = el.getAttribute(KEY_ATTR);
        const locked = isLockedFromHide(el);
        const isHidden = !locked && hiddenSet.has(key);
        const row = $(`
            <div class="mo-row ${isHidden ? 'mo-row-hidden' : ''} ${locked ? 'mo-row-locked' : ''}">
                <div class="mo-handle fa-solid fa-grip-vertical" title="ลากเพื่อจัดเรียง / ย้ายคอลัมน์" aria-label="ลากจัดเรียง"></div>
                <div class="mo-icon" aria-hidden="true"></div>
                <div class="mo-label"></div>
                <button type="button" class="mo-toggle fa-solid ${locked ? 'fa-lock' : (isHidden ? 'fa-eye-slash' : 'fa-eye')}"
                     title="${locked ? 'บล็อกนี้ซ่อนไม่ได้ (กันเปิดกลับไม่ได้)' : 'ซ่อน/แสดง'}"
                     aria-label="${locked ? 'ซ่อนไม่ได้' : 'ซ่อน/แสดงเมนูนี้'}"
                     aria-pressed="${isHidden}" ${locked ? 'disabled' : ''}></button>
            </div>`);
        row.attr('data-key', key);
        if (locked) row.attr('data-locked', '1');
        row.find('.mo-icon').addClass(getIconClass(el));
        row.find('.mo-label').text(getLabel(el));
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
                if (isRenderable(el)) list.append(makeRow(el, hiddenSet, persist));
            }
            colWrap.append(list);
            columns.append(colWrap);
            lists.push(list);
        });

        const wrapper = $('<div class="mo-editor"></div>');
        const badge = $('<div class="mo-profile-badge"><span class="fa-solid"></span> <span class="mo-profile-text"></span></div>');
        badge.find('.fa-solid').addClass(mobile ? 'fa-mobile-screen-button' : 'fa-desktop');
        badge.find('.mo-profile-text').text(
            mobile
                ? 'โปรไฟล์มือถือ · แยกจากคอมพิวเตอร์'
                : 'กำลังตั้งค่าสำหรับ: ' + profileLabel(currentProfile()) + ' (คอมกับมือถือจำแยกกัน)',
        );
        wrapper.append(badge);
        wrapper.append(
            '<div class="mo-editor-hint">'
            + (mobile
                ? 'ลาก <span class="fa-solid fa-grip-vertical"></span> เพื่อเรียงเมนูทั้งหมด · กดตาเพื่อซ่อน · บันทึกอัตโนมัติ'
                : 'ลากด้วย <span class="fa-solid fa-grip-vertical"></span> เพื่อจัดเรียงหรือย้ายข้ามคอลัมน์ · กดตาเพื่อซ่อน/แสดง · บันทึกอัตโนมัติ')
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
        const hidden = [];
        for (const c of COLS) settings.layout[c.id] = [];
        lists.forEach(list => {
            const order = [];
            list.find('.mo-row').each(function () {
                const key = this.getAttribute('data-key');
                order.push(key);
                if (this.classList.contains('mo-row-hidden')) hidden.push(key);
            });
            settings.layout[list.attr('data-col')] = order;
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
        const ctx = Core.getContext();
        const { wrapper, lists, persist } = buildEditor();
        editorOpen = true;

        // ลากข้ามคอลัมน์ jQuery UI ยิง update 2 ครั้ง -> debounce
        let persistTimer = null;
        let cleaned = false;
        const persistSoon = () => {
            clearTimeout(persistTimer);
            persistTimer = setTimeout(() => persist && persist(), 60);
        };
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            editorOpen = false;
            clearTimeout(persistTimer);
            destroySortables(lists);
        };

        const mobile = currentProfile() === 'mobile';
        // มือถือ: delay ก่อนเริ่มลาก กันชน scroll; คอม: ลากทันที
        const sortableOpts = {
            handle: '.mo-handle',
            connectWith: '.mo-connected',
            tolerance: 'pointer',
            placeholder: 'mo-sortable-placeholder',
            forcePlaceholderSize: true,
            scroll: true,
            scrollSensitivity: mobile ? 48 : 30,
            scrollSpeed: mobile ? 12 : 10,
            delay: mobile ? 160 : 0,
            distance: mobile ? 0 : 3,
            helper: 'original',
            update: persistSoon,
        };

        setTimeout(() => {
            if (cleaned || !$.fn.sortable || !lists.length) return;
            lists.forEach(list => list.sortable(sortableOpts));
        }, 40);

        try {
            if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
                await ctx.callGenericPopup(
                    wrapper,
                    ctx.POPUP_TYPE.TEXT,
                    '',
                    { wide: true, large: true, okButton: 'เสร็จสิ้น' },
                );
            } else {
                const overlay = $('<div class="mo-overlay"></div>').append(wrapper);
                $('body').append(overlay);
                await new Promise(resolve => {
                    overlay.on('click', e => {
                        if (e.target === overlay[0]) {
                            overlay.remove();
                            resolve();
                        }
                    });
                });
            }
        } catch (_) { /* closed / cancelled */ }
        cleanup();
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
                    <p class="mo-desc">จัดเรียง ซ่อน/แสดง และย้ายบล็อกตั้งค่าของแต่ละ extension ในหน้านี้ได้ตามใจ · คอม/มือถือจำแยกกัน</p>
                    <button type="button" id="mo-open-editor" class="menu_button menu_button_icon">
                        <span class="fa-solid fa-arrows-up-down-left-right"></span>
                        <span>เปิดตัวจัดเรียงเมนู</span>
                    </button>
                </div>
            </div>`;
        container.appendChild(block);
        const btn = document.getElementById('mo-open-editor');
        if (btn) btn.addEventListener('click', openEditor);
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
