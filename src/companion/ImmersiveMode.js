/**
 * ImmersiveMode — a clean view of her and the place, on the person's say-so (DX3).
 *
 * The End button, a place's chips, the viewport's corner brackets and READY badge, and (by
 * choice) the chat composer are all useful and all in front of her. While she and a place are
 * the experience, the person may want none of it. This takes them away together and brings them
 * back with one discreet control — nothing else changes: the companion, the experience, its
 * music, the world and the conversation all carry on, because hiding is CSS on the page, never a
 * call into anything that runs. That is the whole contract, and the reason this module touches
 * no session, no activity and no engine.
 *
 *  - The way in is a small eye button in the viewport's top-left corner ("Clean view").
 *  - The way out is one control: a faint button in the bottom-right corner ("Show controls"),
 *    plus Escape on a keyboard. It stays reachable on touch (44 px) and is the only thing drawn.
 *  - "Hide the chat too" is the person's option (Settings ▸ CLEAN VIEW, `nexus_clean_view_chat`,
 *    on by default). On a desktop it hides the composer; on a phone held upright the chat is a
 *    sheet over her, so the sheet goes.
 *  - Not kept across a reload: a page that opens with its controls gone looks broken. The
 *    option is kept; the mode is not.
 *  - Leaving the page's DOM is all it does, so VR and AR (which draw their own UI in the scene
 *    or their own overlay) are unaffected; entering either leaves clean view first.
 *
 * Exposes: window.NEXUS_IMMERSIVE
 */
(function (global) {
    'use strict';

    const CLASS = 'nexus-immersive';
    const CHAT_CLASS = 'nexus-immersive-chat';
    const CHAT_KEY = 'nexus_clean_view_chat';
    const TOGGLE_ID = 'nexus-immersive-toggle';
    const EXIT_ID = 'nexus-immersive-exit';
    const STYLE_ID = 'nexus-immersive-style';
    const SECTION_ID = 'clean-view-settings';

    const EYE_OFF =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><path d="M3 13L13 3"/></svg>';
    const EYE =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/></svg>';

    /** What clean view hides. Everything here is a page overlay; none of it runs anything. */
    const CSS = `
html.${CLASS} #nexus-activity-pill,
html.${CLASS} #nexus-playground-bar, html.${CLASS} #nexus-playground-badge,
html.${CLASS} .avatar-viewport .hud-overlay, html.${CLASS} .avatar-viewport .status-badge,
html.${CLASS} #${TOGGLE_ID} { display: none !important; }
html.${CLASS}.${CHAT_CLASS} .chat-input-shell { display: none !important; }
html.${CLASS}.${CHAT_CLASS} body.nexus-mobile.nexus-portrait .chat-card { visibility: hidden !important; }
#${TOGGLE_ID}, #${EXIT_ID} {
  display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; margin: 0;
  border: 1px solid rgba(255, 255, 255, .12); border-radius: 50%; color: #c9d5df; cursor: pointer;
  background: rgba(10, 16, 23, .45); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#${TOGGLE_ID} svg, #${EXIT_ID} svg { width: 15px; height: 15px; display: block; }
#${TOGGLE_ID} { position: absolute; top: 12px; left: 12px; z-index: 6; opacity: .55; }
#${TOGGLE_ID}:hover, #${TOGGLE_ID}:focus-visible { opacity: 1; }
#${EXIT_ID} {
  position: fixed; z-index: 2000; opacity: .5;
  right: calc(14px + env(safe-area-inset-right, 0px)); bottom: calc(14px + env(safe-area-inset-bottom, 0px));
}
#${EXIT_ID}[hidden] { display: none; }
#${EXIT_ID}:hover, #${EXIT_ID}:focus-visible { opacity: 1; }
#${TOGGLE_ID}:focus-visible, #${EXIT_ID}:focus-visible { outline: 2px solid #d6b75e; outline-offset: 2px; }
@media (pointer: coarse) {
  #${TOGGLE_ID}, #${EXIT_ID} { width: 44px; height: 44px; }
}
`;

    function readHideChat(store) {
        try {
            return !(store && store.getItem(CHAT_KEY) === 'show');
        } catch (_) {
            return true;
        }
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        if (!doc || !doc.documentElement) return null;
        const win = doc.defaultView || global;
        const store = o.storage || (win && win.localStorage) || null;
        let on = false;
        let hideChat = readHideChat(store);
        const listeners = [];

        if (!doc.getElementById(STYLE_ID)) {
            const style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }

        const button = (id, icon, label) => {
            const b = doc.createElement('button');
            b.id = id;
            b.type = 'button';
            b.innerHTML = icon;
            b.setAttribute('aria-label', label);
            b.title = label;
            return b;
        };
        const toggle = button(TOGGLE_ID, EYE_OFF, 'Clean view');
        const exit = button(EXIT_ID, EYE, 'Show controls');
        exit.hidden = true;
        toggle.addEventListener('click', () => set(true));
        exit.addEventListener('click', () => set(false));

        function mount() {
            const viewport = doc.querySelector('.avatar-viewport');
            if (viewport && toggle.parentNode !== viewport) viewport.appendChild(toggle);
            if (doc.body && exit.parentNode !== doc.body) doc.body.appendChild(exit);
        }
        mount();

        function apply() {
            const cls = doc.documentElement.classList;
            cls.toggle(CLASS, on);
            cls.toggle(CHAT_CLASS, on && hideChat);
            exit.hidden = !on;
        }

        function set(next) {
            const value = Boolean(next);
            if (value === on) return on;
            on = value;
            mount();
            if (on) {
                // A focused text field would keep a phone's keyboard up over the clean view.
                try {
                    const active = doc.activeElement;
                    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName) && hideChat) active.blur();
                } catch (_) {
                    /* nothing to blur */
                }
            }
            apply();
            try {
                (on ? exit : toggle).focus({ preventScroll: true });
            } catch (_) {
                /* focus is a courtesy */
            }
            for (const fn of listeners.slice()) {
                try {
                    fn(on);
                } catch (error) {
                    console.warn('[Immersive] a listener threw', error);
                }
            }
            return on;
        }

        function setHideChat(value) {
            hideChat = Boolean(value);
            try {
                if (store) store.setItem(CHAT_KEY, hideChat ? 'hide' : 'show');
            } catch (_) {
                /* kept for this page only */
            }
            apply();
        }

        const onKey = (event) => {
            if (on && event && event.key === 'Escape') set(false);
        };
        doc.addEventListener('keydown', onKey);
        // Into the headset or AR the page's DOM is not what the person sees; leave clean view
        // so the controls are there when they come back.
        const leave = () => set(false);
        if (win && win.addEventListener) {
            win.addEventListener('vr-session-start', leave);
            win.addEventListener('ar-session-start', leave);
        }

        return {
            set,
            toggle: () => set(!on),
            setHideChat,
            get on() {
                return on;
            },
            get hideChat() {
                return hideChat;
            },
            onChange(fn) {
                listeners.push(fn);
                return () => {
                    const i = listeners.indexOf(fn);
                    if (i >= 0) listeners.splice(i, 1);
                };
            },
            mount,
            detach() {
                set(false);
                doc.removeEventListener('keydown', onKey);
                if (win && win.removeEventListener) {
                    win.removeEventListener('vr-session-start', leave);
                    win.removeEventListener('ar-session-start', leave);
                }
                toggle.remove();
                exit.remove();
            },
        };
    }

    /**
     * Settings ▸ CLEAN VIEW: one checkbox, drawn from JS (index.html's lines are pinned by the
     * parity harness), inserted before DEVELOPER like the other JS-drawn sections.
     */
    function attachSettings(live, options) {
        const o = options || {};
        const doc = o.doc || global.document;
        if (!doc || !live) return null;
        const modal = doc.getElementById('settings-modal');
        const content = modal && modal.querySelector('.modal-content');
        if (!content || doc.getElementById(SECTION_ID)) return null;
        const section = doc.createElement('div');
        section.className = 'config-section';
        section.id = SECTION_ID;
        section.innerHTML =
            '<h3 class="config-title">CLEAN VIEW</h3>' +
            '<label class="input-label" style="display:flex;gap:8px;align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clean-view-hide-chat"> Hide the chat too</label>' +
            '<p style="font-size:0.68rem;color:rgba(255,255,255,0.45);margin:6px 2px 0">' +
            'The eye in the corner of her view hides everything but her and the place. ' +
            'She and any experience keep going; the eye in the bottom corner, or Escape, brings it all back.</p>';
        const box = section.querySelector('input');
        box.checked = live.hideChat;
        box.addEventListener('change', () => live.setHideChat(box.checked));
        const developer = Array.prototype.slice
            .call(content.querySelectorAll('.config-section'))
            .find((node) => /DEVELOPER/.test((node.querySelector('.config-title') || {}).textContent || ''));
        content.insertBefore(section, developer || null);
        return section;
    }

    const api = { attach, attachSettings, readHideChat, CSS, CLASS, CHAT_CLASS, CHAT_KEY, TOGGLE_ID, EXIT_ID };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_IMMERSIVE = api;
        const doc = global.document;
        if (doc && !global.__NEXUS_IMMERSIVE_LIVE) {
            const start = () => {
                try {
                    global.__NEXUS_IMMERSIVE_LIVE = attach({});
                    attachSettings(global.__NEXUS_IMMERSIVE_LIVE, {});
                } catch (error) {
                    console.warn('[Immersive] not attached', error);
                }
            };
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
            else start();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
