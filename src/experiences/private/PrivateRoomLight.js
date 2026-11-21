/**
 * NL2. The light of her room in Private: the room's own (the Window Room's red window, the
 * stage's colours), or normal light. The person's choice, remembered on this device.
 *
 * Why (owner, 2026-11-21: "we like to have sex in rooms with normal light"): the Window Room
 * is lit red by design, and an evening there was always red. NL1 made a `normal-room` mood
 * that repaints the lamps AND the sky, fog and floor (a light alone left them red), offered by
 * the playground's 💡 Light chip. But that chip is the playground's, and it forgets: the next
 * evening, or the next room she takes them to, was red again. This keeps the choice:
 *
 *   - a switch in Settings ▸ Private Mode ("Normal room light in Private"), and a chip in the
 *     ⋯ menu to flip it in the middle of the evening;
 *   - applied each time a private room is shown (`nexus-world-shown`, rating `private`),
 *     through the same `nexus-world-mood` event the 💡 chip sends, so there is one way the
 *     light changes; turned off, the room gets its own light back (`light: null`), never a
 *     bespoke undo.
 *
 * A setting, not conversation: CLEAR leaves it (ConversationReset forgets conversation, and
 * settings are not that). Nothing here is the model's: a reply never changes the light.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'nexus_private_room_light';
    const MOOD_ID = 'normal-room';
    const listeners = new Set();
    let shownPrivate = null; // the private room up now, if any
    let installed = null;

    function store() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /** Normal light chosen? Off unless chosen: the rooms keep their own light by default. */
    function isNormal() {
        try {
            const st = store();
            return Boolean(st) && st.getItem(STORAGE_KEY) === 'normal';
        } catch (_) {
            return false;
        }
    }

    function moodEvent(win, normal) {
        const moods = win && win.NEXUS_PLAYGROUND_MOODS;
        const preset = normal && moods && typeof moods.get === 'function' ? moods.get(MOOD_ID) : null;
        if (normal && !preset) return false; // no preset here: leave the room as it is
        try {
            win.dispatchEvent(
                new win.CustomEvent('nexus-world-mood', {
                    detail: preset
                        ? { light: preset.light, room: preset.room || null, instant: true }
                        : { light: null, room: null, instant: true },
                })
            );
            return true;
        } catch (error) {
            console.warn('[RoomLight] not applied', error);
            return false;
        }
    }

    /** Choose it; applied at once to the private room that is up, and remembered. */
    function setNormal(on, win) {
        const was = isNormal();
        try {
            const st = store();
            if (st) st.setItem(STORAGE_KEY, on ? 'normal' : 'room');
        } catch (_) {
            /* private browsing: the choice lasts this page only */
        }
        const now = Boolean(on);
        const w = win || global;
        if (shownPrivate && w) moodEvent(w, Boolean(on));
        if (now !== was)
            for (const fn of [...listeners]) {
                try {
                    fn(now);
                } catch (_) {
                    /* a listener's failure is its own */
                }
            }
        return Boolean(on);
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    /**
     * Watch the rooms: each private room shown gets normal light when it is chosen. A room the
     * person did not choose this for (a public place) is never touched.
     */
    function install(win) {
        const w = win || global;
        if (!w || typeof w.addEventListener !== 'function') return () => {};
        if (installed) return installed;
        const onShown = (event) => {
            const d = (event && event.detail) || {};
            shownPrivate = d.id && d.rating === 'private' ? String(d.id) : null;
            if (shownPrivate && isNormal()) moodEvent(w, true);
        };
        w.addEventListener('nexus-world-shown', onShown);
        installed = () => {
            w.removeEventListener('nexus-world-shown', onShown);
            installed = null;
            shownPrivate = null;
        };
        return installed;
    }

    /** The Settings row, in the Spicy Mode section beside Private's other switches (LM3's way). */
    const ROW_ID = 'private-room-light-toggle';
    function mountSetting(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d || d.getElementById(ROW_ID)) return d ? d.getElementById(ROW_ID) : null;
        const spicy = d.getElementById('spicy-mode-toggle');
        const section = spicy && spicy.closest ? spicy.closest('.config-section') : null;
        if (!section) return null;
        const group = d.createElement('div');
        group.className = 'input-group';
        const label = d.createElement('label');
        label.className = 'spicy-toggle-label';
        const text = d.createElement('span');
        text.textContent = 'Normal room light in Private';
        const sw = d.createElement('div');
        sw.className = 'spicy-toggle-switch';
        const box = d.createElement('input');
        box.type = 'checkbox';
        box.id = ROW_ID;
        box.checked = isNormal();
        const slider = d.createElement('span');
        slider.className = 'spicy-toggle-slider';
        sw.append(box, slider);
        label.append(text, sw);
        const note = d.createElement('p');
        note.style.cssText = 'font-size: 0.7rem; color: #888; margin: 6px 0 0';
        note.textContent =
            'On: her rooms (the Window Room too) in ordinary light instead of their own red or coloured light. Also in the ⋯ menu during the evening.';
        group.append(label, note);
        section.append(group);
        box.addEventListener('change', () => setNormal(box.checked));
        onChange((on) => {
            box.checked = on;
        });
        return box;
    }

    const api = { STORAGE_KEY, MOOD_ID, isNormal, setNormal, onChange, install, mountSetting };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ROOM_LIGHT = api;
    if (typeof document !== 'undefined' && typeof module === 'undefined') {
        install(global);
        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', () => mountSetting(document), { once: true });
        else mountSetting(document);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
