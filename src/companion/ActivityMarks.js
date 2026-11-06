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
/* DX1. A status bar, not a floating pill: its own full-width row at the top of the composer
   area, in normal flow, so it can never cover a message, the microphone or the input. Title on
   the left (truncated, never wrapping into the controls), the End action on the right. */
#${PILL_ID} {
  --mark: #38A9FF;
  display: flex; align-items: center; gap: .5rem; margin: 0 0 .5rem; padding: .3rem .4rem .3rem .7rem;
  width: 100%; box-sizing: border-box; min-height: 34px; border-radius: 10px; color: #cfe0ec;
  border: 1px solid color-mix(in srgb, var(--mark) 45%, transparent);
  background: color-mix(in srgb, var(--mark) 9%, #0b1620); font: 500 .76rem/1.2 system-ui, sans-serif;
}
#${PILL_ID} .nexus-activity-words { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PILL_ID}[hidden] { display: none; }
#${PILL_ID}[data-destination="copilot"] { --mark: #26D89A; }
#${PILL_ID}[data-destination="experiences"] { --mark: #F2C94C; }
#${PILL_ID} .nexus-activity-dot { width: .42rem; height: .42rem; border-radius: 50%; background: var(--mark); }
#${PILL_ID} button {
  flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--mark) 55%, transparent); border-radius: 8px;
  background: color-mix(in srgb, var(--mark) 14%, transparent); color: #eef6fb; font: inherit; font-weight: 650;
  cursor: pointer; padding: .3rem .7rem; min-height: 28px;
}
#${PILL_ID} button:hover { background: color-mix(in srgb, var(--mark) 26%, transparent); }
#${PILL_ID} button:focus-visible { outline: 2px solid var(--mark); outline-offset: 2px; }
/* DX2. On a phone the bar is a mini-player docked on top of the chat sheet, the "now playing"
   row music and companion apps use, not a row inside it. Inside, it took 52 px of a chat sheet
   whose height is fixed and pushed the message input below the screen's edge, and it shared the
   top-right corner with the sheet's collapse chevron. Fixed rather than absolute: the chat sheet
   clips its overflow, so a bar hanging off its top edge was cut away. dock() keeps the offset
   8 px above the sheet. (No backticks in this comment: it lives inside a template literal.) */
body.nexus-mobile.nexus-portrait #${PILL_ID} {
  position: fixed; left: 10px; right: 10px; bottom: var(--nexus-activity-dock, 120px); width: auto; margin: 0; z-index: 40;
  background: color-mix(in srgb, var(--mark) 12%, rgba(8, 16, 24, .94));
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 6px 22px rgba(0, 0, 0, .35);
} {
  position: absolute; left: 10px; right: 10px; bottom: calc(100% + 8px); width: auto; margin: 0; z-index: 12;
  background: color-mix(in srgb, var(--mark) 12%, rgba(8, 16, 24, .94));
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 6px 22px rgba(0, 0, 0, .35);
}
/* DX2. A fingertip, not a cursor: 44 px is Apple's and Google's minimum touch target. */
@media (pointer: coarse) {
  #${PILL_ID} { min-height: 44px; }
  #${PILL_ID} button { min-height: 44px; padding: .5rem .9rem; }
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

        function end() {
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

        // ── the End pill above the composer, for explicit activities only ──
        const pill = el(doc, 'div');
        pill.id = PILL_ID;
        pill.setAttribute('role', 'status');
        pill.hidden = true;
        const dot = el(doc, 'span', 'nexus-activity-dot');
        dot.setAttribute('aria-hidden', 'true');
        const words = el(doc, 'span', 'nexus-activity-words');
        const endButton = el(doc, 'button', '', 'End');
        endButton.type = 'button';
        endButton.addEventListener('click', end);
        pill.append(dot, words, endButton);
        const shell = doc.querySelector('.chat-input-shell');
        if (shell) shell.insertBefore(pill, shell.firstChild);

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
                if (mobile && doc.body && pill.parentNode !== doc.body) doc.body.appendChild(pill);
                else if (!mobile && shellNow && pill.parentNode !== shellNow)
                    shellNow.insertBefore(pill, shellNow.firstChild);
                if (!win || !chat || !mobile) return;
                const offset = dockOffset(win.innerHeight, chat.getBoundingClientRect().top);
                if (offset != null) pill.style.setProperty('--nexus-activity-dock', offset + 'px');
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
                EXPLICIT.includes(activity);
            pill.hidden = !explicit;
            if (!explicit) return;
            dock();
            const destination = session.destination();
            pill.dataset.destination = destination;
            words.textContent = text(destination, activity, label(activity));
            words.title = words.textContent;
            // DX1. Say what it ends. "End experience" for an experience; elsewhere "End" with
            // the activity in its accessible name, so a screen reader hears "End Relaxing together".
            endButton.textContent = destination === 'experiences' ? 'End experience' : 'End';
            endButton.setAttribute('aria-label', 'End ' + (label(activity) || 'activity'));
            endButton.title = endButton.getAttribute('aria-label');
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
            refresh: paintPill,
            detach() {
                off();
                if (win && win.removeEventListener) {
                    win.removeEventListener('resize', dock);
                    win.removeEventListener('orientationchange', dock);
                }
                if (observer) observer.disconnect();
                if (pill.parentNode) pill.parentNode.removeChild(pill);
            },
        };
    }

    return { attach, text, dockOffset, DESTINATIONS, EXPLICIT, PILL_ID, CSS };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_MARKS = ActivityMarks;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityMarks;
