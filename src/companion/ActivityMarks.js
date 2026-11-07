/**
 * ActivityMarks — one quiet line in the chat when what she is doing with the person changes (IC2).
 *
 * The first IC2 draft posted a coloured session card with a scripted introduction every time a
 * destination opened. Reviewed, that read as a chatbot switching programs, not as a companion
 * noticing what the person needs. So:
 *
 * - **One small line, only on a change.** "Life · Relaxing together", then later "Copilot ·
 *   Ready to help" — a coloured dot and a few muted words between messages. The same context
 *   twice in a row posts nothing; the conversation itself carries on uninterrupted.
 * - **No scripted words.** The line names the activity; what she says is hers, from the model.
 * - **An End control only for real activities.** A focus block, Seaside Evening, Scene Tale,
 *   Life Evening and Copilot Hour have a beginning and an end, so a small pill above the
 *   composer offers End while one runs. Everyday conversation shows nothing there.
 * - **Drawn, never stored.** The line is not a message: it is not in `chatHistory`, so it never
 *   reaches the prompt, the transcript or TTS. What the model knows comes from `PromptContext`.
 * - **No face in the chat** — her face is in the viewport. Colours: Life #38A9FF, Copilot
 *   #26D89A, Experiences #F2C94C.
 *
 * Exposes: window.NEXUS_COMPANION_MARKS
 */
const ActivityMarks = (() => {
    'use strict';

    const STYLE_ID = 'nexus-activity-style';
    const PILL_ID = 'nexus-activity-pill';
    const RESTORE_ID = 'nexus-activity-restore';
    // DX3. How the status shows, chosen by the person and kept between visits.
    const VIEW_KEY = 'nexus_status_view';
    const VIEWS = Object.freeze(['compact', 'minimal', 'hidden']);

    const DESTINATIONS = Object.freeze({
        life: { title: 'Life', color: '#38A9FF' },
        copilot: { title: 'Copilot', color: '#26D89A' },
        experiences: { title: 'Experiences', color: '#F2C94C' },
    });

    /** Activities with a beginning and an end. Only these get the End pill. */
    const EXPLICIT = Object.freeze([
        'relax',
        'work',
        'move',
        'focus-block',
        'seaside',
        'scene-tale',
        'life-evening',
        'copilot-hour',
        'forest',
        'ocean',
        'meditation',
    ]);

    /** VW3. An activity with a beginning and an end: the list, or any place by name. Pure. */
    function isExplicit(activity) {
        return EXPLICIT.includes(activity) || /^place-/.test(String(activity || ''));
    }

    const CSS = `
.nexus-activity-mark {
  --mark: #38A9FF;
  clear: both; display: flex; align-items: center; gap: .4rem; justify-content: center;
  margin: .5rem 0; color: #8fa2b4; font: 500 .72rem/1.2 system-ui, sans-serif; letter-spacing: .02em;
}
.nexus-activity-mark[data-destination="copilot"] { --mark: #26D89A; }
.nexus-activity-mark[data-destination="experiences"] { --mark: #F2C94C; }
.nexus-activity-mark .nexus-activity-dot { width: .42rem; height: .42rem; border-radius: 50%; background: var(--mark); }
.nexus-activity-mark .nexus-activity-where { color: var(--mark); font-weight: 650; }
/* DX1. A status bar, not a floating pill: its own row at the top of the composer area, in
   normal flow, so it can never cover a message, the microphone or the input.
   DX3. Quiet by default. Thin border, a translucent surface with a restrained blur where the
   browser has one, icon buttons instead of a filled "End experience" slab, and the accent only
   on the dot and a hairline. Muted accents: Experiences a soft yellow, Life blue, Copilot green.
   Three views - compact (name, minimise, end), minimal (a small chip that expands) and hidden
   (one faint restore dot) - chosen by the person and remembered. */
#${PILL_ID} {
  --mark: #5aa9e0;
  display: flex; align-items: center; gap: .25rem; margin: 0 0 .4rem; padding: 2px 3px 2px 10px;
  width: 100%; box-sizing: border-box; min-height: 34px; border-radius: 12px; color: #c9d5df;
  border: 1px solid color-mix(in srgb, var(--mark) 22%, rgba(255, 255, 255, .07));
  background: rgba(14, 20, 28, .55); font: 500 .74rem/1.2 system-ui, sans-serif; letter-spacing: .01em;
  -webkit-backdrop-filter: blur(10px) saturate(1.15); backdrop-filter: blur(10px) saturate(1.15);
}
#${PILL_ID}[hidden] { display: none; }
#${PILL_ID}[data-destination="copilot"] { --mark: #46c79b; }
#${PILL_ID}[data-destination="experiences"] { --mark: #d6b75e; }
#${PILL_ID} .nexus-activity-main {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: .45rem; padding: 0; margin: 0;
  background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; min-height: 28px;
}
#${PILL_ID} .nexus-activity-words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PILL_ID} .nexus-activity-dot { flex: 0 0 auto; width: .4rem; height: .4rem; border-radius: 50%; background: var(--mark); }
#${PILL_ID} .nexus-activity-icon {
  flex: 0 0 auto; display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; margin: 0;
  border: 0; border-radius: 8px; background: transparent; color: #9fb0bf; cursor: pointer;
}
#${PILL_ID} .nexus-activity-icon svg { width: 14px; height: 14px; display: block; }
#${PILL_ID} .nexus-activity-icon:hover, #${PILL_ID} .nexus-activity-main:hover { color: #eef3f7; }
#${PILL_ID} .nexus-activity-icon:hover { background: rgba(255, 255, 255, .07); }
#${PILL_ID} button:focus-visible { outline: 2px solid var(--mark); outline-offset: 1px; }
#${PILL_ID} .nexus-activity-hide { display: none; }
/* Minimal: a small chip, never full width, so it does not sit across her. */
#${PILL_ID}[data-view="minimal"] {
  width: auto; max-width: 13.5rem; display: inline-flex; min-height: 28px; padding: 1px 2px 1px 9px; border-radius: 999px;
}
#${PILL_ID}[data-view="minimal"] .nexus-activity-min, #${PILL_ID}[data-view="minimal"] .nexus-activity-end { display: none; }
#${PILL_ID}[data-view="minimal"] .nexus-activity-hide { display: inline-grid; }
#${PILL_ID}[data-view="minimal"] .nexus-activity-icon { width: 24px; height: 24px; }
#${RESTORE_ID} {
  display: inline-grid; place-items: center; width: 28px; height: 28px; margin: 0 0 .4rem auto; padding: 0;
  border: 1px solid rgba(255, 255, 255, .1); border-radius: 50%; background: rgba(14, 20, 28, .45); color: #9fb0bf;
  opacity: .6; cursor: pointer; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#${RESTORE_ID}[hidden] { display: none; }
#${RESTORE_ID}:hover, #${RESTORE_ID}:focus-visible { opacity: 1; color: #eef3f7; }
#${RESTORE_ID} .nexus-activity-dot { width: .4rem; height: .4rem; border-radius: 50%; background: var(--mark, #5aa9e0); }
/* DX2. On a phone the bar is a mini-player docked on top of the chat sheet, the "now playing"
   row music and companion apps use, not a row inside it. Inside, it took 52 px of a chat sheet
   whose height is fixed and pushed the message input below the screen's edge. Fixed rather
   than absolute: the chat sheet clips its overflow. dock() keeps the offset 8 px above the sheet,
   which is above the composer, the microphone and the send button by construction.
   DX3: inside the safe area on the left and right; the minimal chip and the restore dot sit at
   the right edge, clear of her. (No backticks in this comment: it lives inside a template literal.) */
body.nexus-mobile.nexus-portrait #${PILL_ID}, body.nexus-mobile.nexus-portrait #${RESTORE_ID} {
  position: fixed; bottom: var(--nexus-activity-dock, 120px); margin: 0; z-index: 40;
}
body.nexus-mobile.nexus-portrait #${PILL_ID} {
  left: calc(10px + env(safe-area-inset-left, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); width: auto;
  background: rgba(10, 16, 23, .72);
}
body.nexus-mobile.nexus-portrait #${PILL_ID}[data-view="minimal"] { left: auto; }
body.nexus-mobile.nexus-portrait #${RESTORE_ID} { right: calc(12px + env(safe-area-inset-right, 0px)); }
/* DX2. A fingertip, not a cursor: 44 px is Apple's and Google's minimum touch target. The
   visible icon stays small; the button around it grows. */
@media (pointer: coarse) {
  #${PILL_ID} { min-height: 44px; }
  #${PILL_ID} .nexus-activity-icon, #${PILL_ID} .nexus-activity-main { min-width: 44px; min-height: 44px; }
  #${PILL_ID}[data-view="minimal"] { min-height: 44px; }
  #${PILL_ID}[data-view="minimal"] .nexus-activity-icon { width: 44px; height: 44px; }
  #${RESTORE_ID} { width: 44px; height: 44px; }
}
@media (pointer: fine) {
  #${PILL_ID} .nexus-activity-end, #${PILL_ID} .nexus-activity-min { min-width: 28px; }
}
`;

    /** How far above the viewport's bottom the mini-player sits: 8 px over the chat sheet. Pure. */
    function dockOffset(viewportHeight, chatTop, gap) {
        const h = Number(viewportHeight);
        const top = Number(chatTop);
        if (!(h > 0) || !Number.isFinite(top) || top <= 0 || top >= h) return null;
        return Math.round(h - top + (gap == null ? 8 : gap));
    }

    function where(destination) {
        return DESTINATIONS[destination] || DESTINATIONS.life;
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /** "Life · Relaxing together". Pure. */
    function text(destination, activity, label) {
        const name = label || (activity ? activity : '');
        return where(destination).title + (name ? ' · ' + name : '');
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || (typeof document !== 'undefined' ? document : null);
        const session = o.session;
        const label = o.label || ((id) => id || '');
        if (!doc || !session || typeof session.on !== 'function') return { mounted: false, detach() {} };

        if (!doc.getElementById(STYLE_ID)) {
            const style = el(doc, 'style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }

        let last = null; // "destination:activity" of the last line posted

        /**
         * DX3. Ask before ending only when ending would lose something the person made: an
         * activity may answer `unsavedProgress()` with a sentence ("Your plan for tonight is not
         * saved") or nothing. None does today, so End ends at once, as it always has; the hook
         * is here so the one that someday needs it does not grow its own End button.
         */
        function confirmEnd() {
            try {
                const panel = o.panel ? o.panel() : null;
                const running = panel && panel.activeActivity;
                const say = running && typeof running.unsavedProgress === 'function' ? running.unsavedProgress() : '';
                if (!say) return true;
                const win = doc.defaultView;
                return !(win && typeof win.confirm === 'function') || win.confirm(String(say) + ' End anyway?');
            } catch (_) {
                return true;
            }
        }

        function end() {
            if (!confirmEnd()) return;
            // IC3. End ends the thing itself, not only the label: the Together activity that
            // is running (a focus block, a place, the coach) and an experience.
            const panel = o.panel ? o.panel() : null;
            try {
                if (panel && panel.activeActivity && typeof panel.stopActivity === 'function')
                    panel.stopActivity('end');
            } catch (error) {
                console.warn('[Companion] the activity did not stop cleanly', error);
            }
            const director = o.director || null;
            try {
                const status = director && director.status ? director.status() : null;
                if (status && (status.status === 'active' || status.status === 'paused')) director.stop('session-end');
            } catch (error) {
                console.warn('[Companion] the experience did not stop cleanly', error);
            }
            session.end();
        }

        // ── the status bar above the composer, for explicit activities only ──
        // DX3. One component, three views. The name (a button: it minimises, or in the minimal
        // view expands), a minimise icon, a hide icon (minimal view only) and End as an X. A
        // separate restore dot stands in for all of it while hidden, so the person can always
        // get back to the controls of what is running.
        const ICONS = {
            min: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5l4 4 4-4"/></svg>',
            hide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><path d="M3 13L13 3"/></svg>',
            end: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
        };
        const store = o.storage || (doc.defaultView && doc.defaultView.localStorage) || null;
        let view = readView(store);

        const pill = el(doc, 'div');
        pill.id = PILL_ID;
        pill.setAttribute('role', 'status');
        pill.hidden = true;
        const main = el(doc, 'button', 'nexus-activity-main');
        main.type = 'button';
        const dot = el(doc, 'span', 'nexus-activity-dot');
        dot.setAttribute('aria-hidden', 'true');
        const words = el(doc, 'span', 'nexus-activity-words');
        main.append(dot, words);
        const iconButton = (cls, icon, labelText) => {
            const b = el(doc, 'button', 'nexus-activity-icon ' + cls);
            b.type = 'button';
            b.innerHTML = icon;
            b.setAttribute('aria-label', labelText);
            b.title = labelText;
            return b;
        };
        const minButton = iconButton('nexus-activity-min', ICONS.min, 'Minimise status');
        const hideButton = iconButton('nexus-activity-hide', ICONS.hide, 'Hide status');
        const endButton = iconButton('nexus-activity-end', ICONS.end, 'End experience');
        endButton.dataset.role = 'end';
        main.addEventListener('click', () => setView(view === 'compact' ? 'minimal' : 'compact'));
        minButton.addEventListener('click', () => setView('minimal'));
        hideButton.addEventListener('click', () => setView('hidden'));
        endButton.addEventListener('click', end);
        pill.append(main, minButton, hideButton, endButton);

        const restore = el(doc, 'button');
        restore.id = RESTORE_ID;
        restore.type = 'button';
        restore.hidden = true;
        const restoreDot = el(doc, 'span', 'nexus-activity-dot');
        restoreDot.setAttribute('aria-hidden', 'true');
        restore.appendChild(restoreDot);
        restore.addEventListener('click', () => {
            setView('compact');
            try {
                main.focus();
            } catch (_) {
                /* focus is a courtesy */
            }
        });

        const shell = doc.querySelector('.chat-input-shell');
        if (shell) {
            shell.insertBefore(restore, shell.firstChild);
            shell.insertBefore(pill, shell.firstChild);
        }

        function setView(next) {
            if (!VIEWS.includes(next)) return;
            view = next;
            try {
                if (store) store.setItem(VIEW_KEY, next);
            } catch (_) {
                /* remembered for this page only */
            }
            paintPill();
        }

        /**
         * DX2. On a phone, keep the mini-player 8 px above the chat sheet's top edge, measured,
         * because the sheet expands, collapses and moves with the keyboard. The maths is
         * dockOffset (pure); this only reads one rectangle. Fail soft: the CSS default stands.
         */
        function dock() {
            try {
                const win = doc.defaultView;
                const chat = doc.querySelector('.chat-card');
                // Portrait only: there the chat is a sheet across the bottom. In landscape it is a
                // side panel, and the bar belongs in its composer as on a desktop.
                const cls = doc.body ? doc.body.classList : null;
                const mobile = !!(cls && cls.contains('nexus-mobile') && cls.contains('nexus-portrait'));
                // The composer area has a backdrop-filter, which makes it the containing block of
                // its fixed children: a fixed bar inside it was still clipped by the chat sheet.
                // On a phone the bar lives in <body>; on a desktop, back at the top of the composer.
                const shellNow = doc.querySelector('.chat-input-shell');
                if (mobile && doc.body && pill.parentNode !== doc.body) doc.body.append(pill, restore);
                else if (!mobile && shellNow && pill.parentNode !== shellNow) {
                    shellNow.insertBefore(restore, shellNow.firstChild);
                    shellNow.insertBefore(pill, shellNow.firstChild);
                }
                if (!win || !chat || !mobile) return;
                const offset = dockOffset(win.innerHeight, chat.getBoundingClientRect().top);
                if (offset != null) {
                    pill.style.setProperty('--nexus-activity-dock', offset + 'px');
                    restore.style.setProperty('--nexus-activity-dock', offset + 'px');
                }
            } catch (_) {
                /* the CSS default stands */
            }
        }
        const win = doc.defaultView;
        if (win && win.addEventListener) {
            win.addEventListener('resize', dock);
            win.addEventListener('orientationchange', dock);
        }
        dock();
        let observer = null;
        try {
            const chat = doc.querySelector('.chat-card');
            if (chat && win && typeof win.ResizeObserver === 'function') {
                observer = new win.ResizeObserver(dock);
                observer.observe(chat);
            }
        } catch (_) {
            observer = null;
        }

        function paintPill() {
            const activity = session.activity ? session.activity() : null;
            const explicit =
                session.active &&
                session.active() &&
                session.source &&
                session.source() === 'together' &&
                isExplicit(activity);
            const cls = doc.documentElement ? doc.documentElement.classList : null;
            // DX3. The page knows the view, so a venue's chips fold away with the bar (minimal and
            // hidden) and come back when it is expanded: one place decides how much is showing.
            if (cls) {
                cls.toggle('nexus-status-hidden', explicit && view === 'hidden');
                cls.toggle('nexus-status-minimal', explicit && view === 'minimal');
            }
            pill.hidden = !explicit || view === 'hidden';
            restore.hidden = !explicit || view !== 'hidden';
            if (!explicit) return;
            dock();
            const destination = session.destination();
            pill.dataset.destination = destination;
            pill.dataset.view = view;
            restore.style.setProperty(
                '--mark',
                destination === 'experiences' ? '#d6b75e' : destination === 'copilot' ? '#46c79b' : '#5aa9e0'
            );
            const name = label(activity) || 'activity';
            words.textContent = view === 'minimal' ? name : text(destination, activity, label(activity));
            main.title = text(destination, activity, label(activity));
            main.setAttribute('aria-expanded', view === 'compact' ? 'true' : 'false');
            main.setAttribute('aria-label', (view === 'compact' ? 'Minimise ' : 'Show ') + main.title);
            // DX1, DX3. Say what it ends. An experience's X is "End experience"; elsewhere "End"
            // with the activity in its accessible name, so a screen reader hears "End Relaxing
            // together". The words are in the label, not on the button: the X is the control.
            const endLabel = destination === 'experiences' ? 'End experience' : 'End ' + name;
            endButton.setAttribute('aria-label', endLabel);
            endButton.title = destination === 'experiences' ? 'End ' + name : endLabel;
            restore.setAttribute('aria-label', 'Show ' + main.title);
            restore.title = restore.getAttribute('aria-label');
        }

        // ── the line in the chat ────────────────────────────────────────────
        function mark(destination, activity) {
            const key = destination + ':' + (activity || '');
            if (key === last) return null;
            const root = doc.getElementById('chat-history');
            if (!root) return null;
            last = key;
            const empty = root.querySelector('.empty-state');
            if (empty) empty.remove();
            const line = el(doc, 'div', 'chat-row nexus-activity-mark');
            line.dataset.destination = destination;
            line.setAttribute('role', 'note');
            const d = el(doc, 'span', 'nexus-activity-dot');
            d.setAttribute('aria-hidden', 'true');
            const name = el(doc, 'span', 'nexus-activity-where', where(destination).title);
            const act = label(activity);
            line.append(d, name);
            if (act) line.append(el(doc, 'span', '', '· ' + act));
            root.appendChild(line);
            root.scrollTop = root.scrollHeight;
            return line;
        }

        const off = session.on(function (detail) {
            if (!detail) return;
            if (detail.type === 'session:entered') mark(detail.destination, detail.activity);
            if (detail.type === 'session:entered' || detail.type === 'session:ended') paintPill();
            if (detail.type === 'session:ended') last = null;
        });

        paintPill();

        return {
            mounted: true,
            pill: pill,
            restore: restore,
            refresh: paintPill,
            setView: setView,
            get view() {
                return view;
            },
            detach() {
                off();
                if (win && win.removeEventListener) {
                    win.removeEventListener('resize', dock);
                    win.removeEventListener('orientationchange', dock);
                }
                if (observer) observer.disconnect();
                if (pill.parentNode) pill.parentNode.removeChild(pill);
                if (restore.parentNode) restore.parentNode.removeChild(restore);
                if (doc.documentElement)
                    doc.documentElement.classList.remove('nexus-status-hidden', 'nexus-status-minimal');
            },
        };
    }

    /** The remembered view, or compact. Pure apart from the read. */
    function readView(store) {
        try {
            const v = store && store.getItem(VIEW_KEY);
            return VIEWS.includes(v) ? v : 'compact';
        } catch (_) {
            return 'compact';
        }
    }

    return {
        attach,
        text,
        dockOffset,
        isExplicit,
        readView,
        DESTINATIONS,
        EXPLICIT,
        PILL_ID,
        RESTORE_ID,
        VIEW_KEY,
        VIEWS,
        CSS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_MARKS = ActivityMarks;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityMarks;
