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
    const EXPLICIT = Object.freeze(['focus-block', 'seaside', 'scene-tale', 'life-evening', 'copilot-hour']);

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
#${PILL_ID} {
  --mark: #38A9FF;
  display: flex; align-items: center; gap: .4rem; margin: 0 0 .35rem; padding: .22rem .6rem;
  width: fit-content; max-width: 100%; border-radius: 999px; color: #cfe0ec;
  border: 1px solid color-mix(in srgb, var(--mark) 55%, transparent);
  background: color-mix(in srgb, var(--mark) 10%, #0b1620); font: 500 .72rem/1.2 system-ui, sans-serif;
}
#${PILL_ID}[hidden] { display: none; }
#${PILL_ID}[data-destination="copilot"] { --mark: #26D89A; }
#${PILL_ID}[data-destination="experiences"] { --mark: #F2C94C; }
#${PILL_ID} .nexus-activity-dot { width: .42rem; height: .42rem; border-radius: 50%; background: var(--mark); }
#${PILL_ID} button {
  border: 0; background: none; color: var(--mark); font: inherit; font-weight: 650;
  text-decoration: underline; cursor: pointer; padding: .2rem .2rem; min-height: 26px;
}
`;

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
        const words = el(doc, 'span');
        const endButton = el(doc, 'button', '', 'End');
        endButton.type = 'button';
        endButton.addEventListener('click', end);
        pill.append(dot, words, endButton);
        const shell = doc.querySelector('.chat-input-shell');
        if (shell) shell.insertBefore(pill, shell.firstChild);

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
            const destination = session.destination();
            pill.dataset.destination = destination;
            words.textContent = text(destination, activity, label(activity));
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
                if (pill.parentNode) pill.parentNode.removeChild(pill);
            },
        };
    }

    return { attach, text, DESTINATIONS, EXPLICIT, PILL_ID, CSS };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_MARKS = ActivityMarks;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityMarks;
