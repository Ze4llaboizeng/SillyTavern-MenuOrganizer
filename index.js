/* Menu Organizer for SillyTavern
 * ให้ผู้ใช้ลากจัดเรียง + ซ่อน/แสดง บล็อกตั้งค่าของแต่ละ extension
 * ในหน้า Extensions settings (drawer ไอคอน fa-cubes) ได้เอง ลากข้ามคอลัมน์ได้
 * บันทึกค่าอัตโนมัติ และคงลำดับไว้แม้ extension อื่นจะเพิ่มบล็อกมาทีหลัง
 */
(() => {
    if (window.__MENU_ORGANIZER_LOADED__) return;
    window.__MENU_ORGANIZER_LOADED__ = true;

    const MODULE_NAME = 'menuOrganizer';
    const KEY_ATTR = 'data-mo-key';
    const OWN_ID = 'menu-organizer-settings';
    const OWN_KEY = `id:${OWN_ID}`;
    // เกณฑ์จอมือถือ (ตรงกับ breakpoint ของ SillyTavern เอง)
    const MOBILE_MEDIA = '(max-width: 768px)';
    // สองคอลัมน์ในหน้า Extensions settings
    const COLS = [
        { id: 'extensions_settings', label: 'คอลัมน์ซ้าย' },
        { id: 'extensions_settings2', label: 'คอลัมน์ขวา' },
    ];

    // จอมือถือ/แนวตั้งแคบ vs จอคอม -> จำ layout แยกโปรไฟล์กัน
    function currentProfile() {
        try { return window.matchMedia(MOBILE_MEDIA).matches ? 'mobile' : 'desktop'; }
        catch (_) { return (window.innerWidth || 9999) <= 768 ? 'mobile' : 'desktop'; }
    }
    function profileLabel(p) {
        return p === 'mobile' ? 'มือถือ (จอแคบ)' : 'คอมพิวเตอร์ (จอกว้าง)';
    }

    // ------------------------------------------------------------------
    // Context / settings
    // ------------------------------------------------------------------
    const Core = {
        getContext() {
            try { return window.SillyTavern?.getContext?.() || null; } catch (_) { return null; }
        },
        // root store ของ extension (มีทั้งสองโปรไฟล์) + migrate schema เก่า
        get root() {
            const ctx = this.getContext();
            if (!ctx) return null;
            const store = ctx.extensionSettings;
            store[MODULE_NAME] = store[MODULE_NAME] || {};
            const s = store[MODULE_NAME];
            if (!s.profiles || typeof s.profiles !== 'object') {
                s.profiles = {};
                // ของเดิม (schema แบน) ย้ายเข้าโปรไฟล์ desktop
                if (s.layout || s.hidden) {
                    s.profiles.desktop = { layout: s.layout || {}, hidden: Array.isArray(s.hidden) ? s.hidden : [] };
                }
            }
            delete s.layout;
            delete s.hidden;
            return s;
        },
        // settings ของโปรไฟล์ที่ระบุ (ค่าปริยาย = โปรไฟล์ปัจจุบันตามขนาดจอ)
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
            [...col.children].forEach(child => {
                let key = child.getAttribute(KEY_ATTR);
                if (!key) {
                    key = getItemKey(child);
                    // กัน key ชนกัน (บล็อกไม่มี id ที่ขึ้นต้นข้อความเหมือนกัน) -> ต่อ suffix
                    if (seen.has(key)) {
                        let n = 2;
                        while (seen.has(`${key}#${n}`)) n++;
                        key = `${key}#${n}`;
                    }
                    child.setAttribute(KEY_ATTR, key);
                }
                seen.add(key);
            });
        }
    }

    // บล็อกที่ยังว่าง (extension ยังไม่ populate) ไม่ต้องเอามาแสดงในตัวจัดเรียง
    function isRenderable(el) {
        if (el.id === OWN_ID) return true;
        return el.children.length > 0 || (el.textContent || '').trim() !== '';
    }

    // บล็อกของ Menu Organizer เอง ห้ามซ่อน (กันผู้ใช้ล็อกตัวเองออกจนเปิดกลับไม่ได้)
    function isLockedFromHide(el) {
        return el.id === OWN_ID;
    }

    function getLabel(el) {
        const header = el.querySelector('.inline-drawer-header b, .inline-drawer-toggle b, h3, h4');
        const text = (header?.textContent || '').trim().replace(/\s+/g, ' ');
        if (text) return text.slice(0, 48);
        if (el.id) return el.id.replace(/_container$/, '').replace(/-settings$/, '').replace(/[_-]/g, ' ').trim();
        return '(ไม่มีชื่อ)';
    }

    function getIconClass(el) {
        const icon = el.querySelector('.inline-drawer-header [class*="fa-"], .inline-drawer-toggle [class*="fa-"], b [class*="fa-"]');
        if (!icon) return 'fa-solid fa-puzzle-piece';
        const cls = [...icon.classList].filter(c => c.startsWith('fa-'));
        return cls.length ? cls.join(' ') : 'fa-solid fa-puzzle-piece';
    }

    // ------------------------------------------------------------------
    // Apply saved layout + visibility to the real DOM
    // ------------------------------------------------------------------
    // ย้าย node ไปเป็นลูกลำดับที่ idx ของ parent เฉพาะเมื่อยังไม่อยู่ตำแหน่งนั้น
    // (กัน DOM write ที่ไม่จำเป็น = ลด reflow + ลด mutation record)
    function placeAt(parent, node, idx) {
        const ref = parent.children[idx] || null;
        if (node.parentNode === parent && node.nextSibling === ref) return false;
        if (ref === node) return false;
        parent.insertBefore(node, ref);
        return true;
    }

    function applyLayout() {
        const settings = Core.settings;
        if (!settings) return;
        const cols = COLS.map(c => document.getElementById(c.id));
        if (cols.some(c => !c)) return;

        // หยุดฟัง mutation ระหว่างเราเขียน DOM เอง แล้วค่อยต่อกลับตอนจบ
        // (แฟล็กอย่างเดียวกันลูปไม่ได้ เพราะ observer callback เป็น async microtask)
        stopObserver();
        try {
            ensureKeys();

            // รวมทุก item ปัจจุบันจากทั้งสองคอลัมน์ ทำ map ตาม key
            const byKey = new Map();
            cols.forEach(col => [...col.children].forEach(ch => byKey.set(ch.getAttribute(KEY_ATTR), ch)));

            // ลำดับเป้าหมายของแต่ละคอลัมน์: ตามที่บันทึกไว้ก่อน แล้วต่อท้ายด้วย item ใหม่
            const placed = new Set();
            COLS.forEach((c, i) => {
                const col = cols[i];
                let idx = 0;
                for (const key of settings.layout[c.id]) {
                    const el = byKey.get(key);
                    if (el && !placed.has(key)) { placeAt(col, el, idx++); placed.add(key); }
                }
                // item ใหม่ที่ยังไม่เคยบันทึก คงไว้ที่คอลัมน์เดิม (ต่อท้าย ตามลำดับที่มันอยู่)
                [...col.children].forEach(ch => {
                    const key = ch.getAttribute(KEY_ATTR);
                    if (!placed.has(key)) { placeAt(col, ch, idx++); placed.add(key); }
                });
            });

            // ซ่อน/แสดง (แตะเฉพาะตัวที่เราคุม และไม่แตะบล็อกที่ล็อกไว้)
            const hidden = new Set(settings.hidden);
            byKey.forEach((el, key) => {
                if (hidden.has(key) && !isLockedFromHide(el)) {
                    el.dataset.moHidden = '1';
                    el.style.setProperty('display', 'none', 'important');
                } else if (el.dataset.moHidden === '1') {
                    delete el.dataset.moHidden;
                    el.style.removeProperty('display');
                }
            });
        } finally {
            startObserver();
        }
    }

    // ------------------------------------------------------------------
    // Observer: extension อื่น populate บล็อกทีหลัง -> re-apply
    // ------------------------------------------------------------------
    let observers = [], reapplyTimer = null;
    function scheduleReapply() {
        clearTimeout(reapplyTimer);
        reapplyTimer = setTimeout(applyLayout, 150);
    }
    function stopObserver() {
        observers.forEach(o => o.disconnect());
        observers = [];
    }
    function startObserver() {
        stopObserver();
        for (const c of COLS) {
            const col = document.getElementById(c.id);
            if (!col) continue;
            const obs = new MutationObserver(muts => {
                if (muts.some(m => m.addedNodes.length || m.removedNodes.length)) scheduleReapply();
            });
            obs.observe(col, { childList: true });
            observers.push(obs);
        }
    }

    // สลับโปรไฟล์เมื่อขนาดจอข้าม breakpoint (คอม <-> มือถือ) แล้ว re-apply layout ของโปรไฟล์นั้น
    let lastProfile = null;
    function watchProfile() {
        lastProfile = currentProfile();
        const onChange = () => {
            const now = currentProfile();
            if (now === lastProfile) return;
            lastProfile = now;
            applyLayout();
        };
        try {
            const mq = window.matchMedia(MOBILE_MEDIA);
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch (_) {
            window.addEventListener('resize', onChange);
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
                <div class="mo-handle fa-solid fa-grip-vertical" title="ลากเพื่อจัดเรียง / ย้ายคอลัมน์"></div>
                <div class="mo-icon"></div>
                <div class="mo-label"></div>
                <div class="mo-toggle fa-solid ${locked ? 'fa-lock' : (isHidden ? 'fa-eye-slash' : 'fa-eye')}" title="${locked ? 'บล็อกนี้ซ่อนไม่ได้ (กันเปิดกลับไม่ได้)' : 'ซ่อน/แสดง'}"></div>
            </div>`);
        row.attr('data-key', key);
        if (locked) row.attr('data-locked', '1');
        row.find('.mo-icon').addClass(getIconClass(el));
        row.find('.mo-label').text(getLabel(el));
        if (!locked) {
            row.find('.mo-toggle').on('click', function () {
                const nowHidden = row.toggleClass('mo-row-hidden').hasClass('mo-row-hidden');
                $(this).toggleClass('fa-eye', !nowHidden).toggleClass('fa-eye-slash', nowHidden);
                persist();
            });
        }
        return row;
    }

    function buildEditor() {
        const cols = COLS.map(c => document.getElementById(c.id));
        if (cols.some(c => !c)) return { wrapper: $('<div>เปิดหน้า Extensions ก่อน แล้วลองใหม่</div>'), lists: [] };

        ensureKeys();
        applyLayout();
        const settings = Core.settings;
        const hiddenSet = new Set(settings.hidden);

        const lists = [];
        const persist = () => persistEditor(lists, settings);
        const columns = $('<div class="mo-columns"></div>');

        COLS.forEach((c, i) => {
            const colWrap = $(`<div class="mo-col"><div class="mo-col-title"></div></div>`);
            colWrap.find('.mo-col-title').text(c.label);
            const list = $('<div class="mo-list mo-connected"></div>').attr('data-col', c.id);
            [...cols[i].children]
                .filter(isRenderable)
                .forEach(el => list.append(makeRow(el, hiddenSet, persist)));
            colWrap.append(list);
            columns.append(colWrap);
            lists.push(list);
        });

        const wrapper = $('<div class="mo-editor"></div>');
        const badge = $('<div class="mo-profile-badge"><span class="fa-solid"></span> <span class="mo-profile-text"></span></div>');
        badge.find('.fa-solid').addClass(currentProfile() === 'mobile' ? 'fa-mobile-screen-button' : 'fa-desktop');
        badge.find('.mo-profile-text').text('กำลังตั้งค่าสำหรับ: ' + profileLabel(currentProfile()) + ' (คอมกับมือถือจำแยกกัน)');
        wrapper.append(badge);
        wrapper.append('<div class="mo-editor-hint">ลากด้วย <span class="fa-solid fa-grip-vertical"></span> เพื่อจัดเรียงหรือย้ายข้ามคอลัมน์ กด <span class="fa-solid fa-eye"></span> เพื่อซ่อน/แสดง บันทึกอัตโนมัติ</div>');
        wrapper.append(columns);

        const resetBtn = $('<div class="menu_button mo-reset"><span class="fa-solid fa-rotate-left"></span> คืนค่าเริ่มต้น</div>');
        resetBtn.on('click', () => {
            const s = Core.settings;
            for (const c of COLS) s.layout[c.id] = [];
            s.hidden = [];
            Core.save();
            COLS.forEach(c => {
                const col = document.getElementById(c.id);
                if (col) [...col.children].forEach(el => {
                    if (el.dataset.moHidden === '1') { delete el.dataset.moHidden; el.style.removeProperty('display'); }
                });
            });
            lists.forEach(l => {
                l.find('.mo-row-hidden').removeClass('mo-row-hidden');
                l.find('.mo-row:not(.mo-row-locked) .mo-toggle').removeClass('fa-eye-slash').addClass('fa-eye');
            });
        });
        wrapper.append(resetBtn);

        return { wrapper, lists, persist };
    }

    function persistEditor(lists, settings) {
        const hidden = [];
        lists.forEach((list, i) => {
            const order = [];
            list.find('.mo-row').each(function () {
                const key = $(this).attr('data-key');
                order.push(key);
                if ($(this).hasClass('mo-row-hidden')) hidden.push(key);
            });
            settings.layout[COLS[i].id] = order;
        });
        settings.hidden = hidden;
        Core.save();
        applyLayout();
    }

    async function openEditor() {
        const ctx = Core.getContext();
        const { wrapper, lists, persist } = buildEditor();

        if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
            ctx.callGenericPopup(wrapper, ctx.POPUP_TYPE.TEXT, '', { wide: true, large: true, okButton: 'เสร็จสิ้น' });
        } else {
            const overlay = $('<div class="mo-overlay"></div>').append(wrapper);
            $('body').append(overlay);
            overlay.on('click', e => { if (e.target === overlay[0]) overlay.remove(); });
        }

        // ลากข้ามคอลัมน์ jQuery UI ยิง update 2 ครั้ง (ต้นทาง+ปลายทาง) -> debounce กัน persist ซ้ำ
        let persistTimer = null;
        const persistSoon = () => {
            clearTimeout(persistTimer);
            persistTimer = setTimeout(() => persist && persist(), 60);
        };
        setTimeout(() => {
            if ($.fn.sortable && lists.length) {
                lists.forEach(list => list.sortable({
                    handle: '.mo-handle',
                    connectWith: '.mo-connected',
                    tolerance: 'pointer',
                    placeholder: 'mo-sortable-placeholder',
                    forcePlaceholderSize: true,
                    update: persistSoon,
                }));
            }
        }, 50);
    }

    // ------------------------------------------------------------------
    // Settings drawer entry
    // ------------------------------------------------------------------
    function injectSettingsDrawer() {
        const container = document.getElementById('extensions_settings');
        if (!container || document.getElementById('menu-organizer-settings')) return;
        const html = `
            <div id="menu-organizer-settings" class="extension_settings_block">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b><span class="fa-solid fa-list-check"></span> Menu Organizer</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <p class="mo-desc">จัดเรียง ซ่อน/แสดง และย้ายบล็อกตั้งค่าของแต่ละ extension ในหน้านี้ได้ตามใจ</p>
                        <div id="mo-open-editor" class="menu_button menu_button_icon">
                            <span class="fa-solid fa-arrows-up-down-left-right"></span>
                            <span>เปิดตัวจัดเรียงเมนู</span>
                        </div>
                    </div>
                </div>
            </div>`;
        $(container).append(html);
        $('#mo-open-editor').on('click', openEditor);
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    function onReady() {
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                injectSettingsDrawer();
                applyLayout();
                startObserver();
                watchProfile();
            }
        }, 300);
        setTimeout(injectSettingsDrawer, 1500);
    }

    if (window.SillyTavern?.getContext) onReady();
    else { document.addEventListener('DOMContentLoaded', onReady); window.addEventListener('load', onReady); }
})();
