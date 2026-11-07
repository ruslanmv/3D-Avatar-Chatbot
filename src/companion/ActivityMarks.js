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
/* DX1. In normal flow at the top of the composer area, so it never covers a message, the
   microphone or the input.
   DX5. Only an X, at the right: a small round button, a thin border, a translucent surface,
   no colour of its own. The activity it ends is in its name and tooltip, and in a status line
   kept for screen readers only. */
#${PILL_ID} { display: flex; justify-content: flex-end; margin: 0 0 .35rem; padding: 0; }
#${PILL_ID}[hidden] { display: none; }
#${PILL_ID} .nexus-activity-words {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
#${PILL_ID} .nexus-activity-end {
  display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; margin: 0;
  border: 1px solid rgba(255, 255, 255, .12); border-radius: 50%; color: #b9c6d2; cursor: pointer;
  background: rgba(14, 20, 28, .55); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#${PILL_ID} .nexus-activity-end svg { width: 14px; height: 14px; display: block; }
#${PILL_ID} .nexus-activity-end:hover { color: #f1f5f8; background: rgba(255, 255, 255, .1); }
#${PILL_ID} .nexus-activity-end:focus-visible { outline: 2px solid #d6b75e; outline-offset: 2px; }
/* DX2. On a phone held upright it docks 8 px above the chat sheet, at the right inside the safe
   area, clear of her and of the composer, the microphone and the send button. Fixed rather than
   absolute: the chat sheet clips its overflow. (No backticks in this comment: it lives inside a
   template literal.) */
body.nexus-mobile.nexus-portrait #${PILL_ID} {
  position: fixed; bottom: var(--nexus-activity-dock, 120px); right: calc(12px + env(safe-area-inset-right, 0px));
  margin: 0; z-index: 40;
}
/* A fingertip, not a cursor: 44 px is Apple's and Google's minimum touch target. */
@media (pointer: coarse) {
  #${PILL_ID} .nexus-activity-end { width: 44px; height: 44px; }
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

        // ── the End control above the composer, for explicit activities only ──
        // DX5. Only an X. The person asked for the cleanest thing that still ends what is running:
        // no name, no dot, no minimise — the place is all around her, the bar only repeated it.
        // What the X ends is still said: in its accessible name ("End experience"), in its
        // tooltip ("End Irish pub"), and in a visually hidden status line a screen reader reads
        // when it appears. The control is a 44 px target on touch around a 14 px glyph.
        const END_ICON =
            '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
        const pill = el(doc, 'div');
        pill.id = PILL_ID;
        pill.hidden = true;
        // The live region is the hidden name only: a place's chips can sit in this row (a timer
        // counting down among them), and a status role on the row would read every tick.
        const words = el(doc, 'span', 'nexus-activity-words');
        words.setAttribute('role', 'status');
        const endButton = el(doc, 'button', 'nexus-activity-end');
        endButton.type = 'button';
        endButton.dataset.role = 'end';
        endButton.innerHTML = END_ICON;
        endButton.setAttribute('aria-label', 'End experience');
        endButton.addEventListener('click', end);
        pill.append(words, endButton);

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
                isExplicit(activity);
            pill.hidden = !explicit;
            if (!explicit) return;
            dock();
            const destination = session.destination();
            pill.dataset.destination = destination;
            const name = label(activity) || 'activity';
            // Read, not seen: "Experiences · Irish pub" for a screen reader.
            words.textContent = text(destination, activity, label(activity));
            // DX1, DX3. Say what it ends. An experience's X is "End experience"; elsewhere "End"
            // with the activity in its accessible name, so a screen reader hears "End Relaxing
            // together". The tooltip names the place.
            const endLabel = destination === 'experiences' ? 'End experience' : 'End ' + name;
            endButton.setAttribute('aria-label', endLabel);
            endButton.title = 'End ' + name;
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

    return {
        attach,
        text,
        dockOffset,
        isExplicit,
        DESTINATIONS,
        EXPLICIT,
        PILL_ID,
        CSS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_MARKS = ActivityMarks;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityMarks;
