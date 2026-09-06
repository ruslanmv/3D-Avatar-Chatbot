/**
 * "Show me what's on my PC." (batch RS1)
 *
 * The whole feature, from the user's side, is three sentences long:
 *
 *     you    Show me what's on my PC.
 *     nexus  Looking at Home PC…            ← a real state, not a fake progress bar
 *     nexus  [ the screenshot ]  Home PC · Just now       Ask about this   Refresh
 *     you    What do you see?
 *     nexus  VS Code is open with a Python traceback…     ↳ Screenshot · 10:42:18
 *
 * Everything in this file exists to make that hold together, and the load-bearing part is
 * the last line. "What do you see?" is answered about **the frame already on screen**, never
 * by taking a new one — because a fresh capture under an old picture is an assistant
 * describing something the user cannot see, and there is no way to tell from the transcript.
 *
 * ## What it will not claim
 *
 * A bare "what do you see?" with no frame in hand is ordinary conversation and goes to the
 * model untouched. The message is only intercepted when the words are unambiguous about the
 * *other* computer, or when there is a live screenshot for the question to be about. The
 * cost of a false positive here is a message the user meant for the assistant being answered
 * with a screenshot, silently.
 *
 * ## Nothing is ever a status code
 *
 * Five things can go wrong and each has a sentence naming the machine the fix is on. A
 * vision model that cannot answer is the interesting one: the screenshot still appears,
 * because the picture was the useful part and failing the whole turn would throw it away.
 *
 * Exposes: window.NEXUS_SCREEN_ASK
 */
const ScreenAsk = (() => {
    'use strict';

    /** The live page's ids; `index-old.html`'s are tried first by the caller, as elsewhere. */
    const LIVE = { history: 'chat-history', input: 'speech-text', send: 'speak-btn' };
    const OLD = { input: 'chatInput', send: 'sendBtn' };

    /** Injected on first use, the same way the YouTube cards bring their own stylesheet. */
    const CSS_HREF = 'src/features/screen/screen.css';

    function ensureCss(doc) {
        if (!doc || !doc.head || doc.querySelector(`link[href="${CSS_HREF}"]`)) {
            return;
        }
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_HREF;
        doc.head.appendChild(link);
    }

    function screen() {
        return (typeof window !== 'undefined' && window.NEXUS_SCREEN) || null;
    }
    function frames() {
        return (typeof window !== 'undefined' && window.NEXUS_SCREEN_FRAMES) || null;
    }
    function cards() {
        return (typeof window !== 'undefined' && window.NEXUS_SCREEN_CARD) || null;
    }

    // ── the intent ──────────────────────────────────────────────────────────

    /** Words that mean the machine that is not here. "my screen" alone never qualifies. */
    const OTHER =
        '(?:my\\s+)?(?:remote\\s+|other\\s+|home\\s+|work\\s+)?(?:pc|computer|desktop|laptop|machine|home\\s?pc)';

    /** Ask for a picture and nothing more. */
    const CAPTURE = [
        new RegExp(
            `^(?:please\\s+)?(?:can\\s+you\\s+|could\\s+you\\s+)?(?:take|grab|get|make)\\s+(?:me\\s+)?(?:a\\s+)?screen\\s?shot(?:\\s+of\\s+${OTHER})?\\s*[.!?]*$`,
            'i'
        ),
        new RegExp(`^(?:please\\s+)?screen\\s?shot\\s+${OTHER}\\s*[.!?]*$`, 'i'),
        new RegExp(`^(?:please\\s+)?(?:show|show\\s+me)\\s+(?:what(?:'| i)?s\\s+on\\s+)?${OTHER}\\s*[.!?]*$`, 'i'),
        new RegExp(`^(?:please\\s+)?(?:look\\s+at|check|glance\\s+at)\\s+${OTHER}\\s*[.!?]*$`, 'i'),
        /^\/screen\s*$/i,
    ];

    /** Ask for a picture *and* an answer about it, in one message. */
    const LOOK_AND_ASK = [
        new RegExp(`^(?:what|which|why|how)\\b.{0,80}\\bon\\s+${OTHER}\\s*[.!?]*$`, 'i'),
        new RegExp(`^(?:what\\s+(?:can|do)\\s+you\\s+see)\\s+on\\s+${OTHER}\\s*[.!?]*$`, 'i'),
        new RegExp(`^(?:please\\s+)?(?:look\\s+at|check)\\s+${OTHER}\\s+and\\s+.+$`, 'i'),
        /^\/screen\s+(.+)$/i,
    ];

    /**
     * Questions about a picture that is already on screen.
     *
     * These only claim a message when a live frame exists — see `parseIntent`. Without that
     * rule "what do you see?" would stop reaching the model on every page load.
     */
    const ABOUT_FRAME = [
        /^(?:so\s+)?what\s+(?:can|do)\s+you\s+see\b.*$/i,
        /^(?:can\s+you\s+)?(?:explain|describe)\s+(?:this|that|it|the\s+screenshot|what\s+you\s+see)\b.*$/i,
        /^(?:what|which)\s+(?:is|are)\s+(?:this|that|the)\b.{0,60}(?:error|window|app|application|program|message|number|text)\b.*$/i,
        /^(?:can\s+you\s+)?read\s+(?:the|that|this)\b.{0,60}$/i,
        /^why\s+(?:is|does|did)\s+(?:this|that|it)\b.{0,60}(?:fail|failing|broken|crash|not\s+work)\w*\b.*$/i,
        /^what(?:'| i)?s\s+(?:on\s+)?(?:the\s+)?screen(?:shot)?\s*[.!?]*$/i,
    ];

    /**
     * What this message is asking for, or `null` for ordinary conversation.
     *
     * @param {string} text
     * @param {boolean} hasFrame whether a live screenshot exists to be asked about
     */
    function parseIntent(text, hasFrame) {
        const t = String(text || '').trim();
        if (!t) {
            return null;
        }
        for (const re of LOOK_AND_ASK) {
            const m = re.exec(t);
            if (m) {
                return { kind: 'look-and-ask', question: (m[1] || t).trim() };
            }
        }
        for (const re of CAPTURE) {
            if (re.test(t)) {
                return { kind: 'capture', question: '' };
            }
        }
        if (hasFrame) {
            for (const re of ABOUT_FRAME) {
                if (re.test(t)) {
                    return { kind: 'explain', question: t };
                }
            }
        }
        return null;
    }

    // ── saying things in the page the app actually renders ──────────────────

    /** Put a message in the chat, in whichever shape this page uses. Returns the node. */
    function say(text, who = 'bot', doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return null;
        }
        const host = d.getElementById(LIVE.history);
        if (!host) {
            const cm = typeof window !== 'undefined' ? window.ChatManager : null;
            if (cm && typeof cm.addMessage === 'function') {
                cm.addMessage(text, who);
            }
            return null;
        }
        const empty = host.querySelector('.empty-state');
        if (empty) {
            empty.remove();
        }
        const row = d.createElement('div');
        row.className = 'chat-row';
        const msg = d.createElement('div');
        msg.className = `chat-message ${who === 'user' ? 'user' : 'avatar'}`;
        const sender = d.createElement('div');
        sender.className = `message-sender ${who === 'user' ? 'user' : 'avatar'}`;
        sender.textContent = who === 'user' ? 'YOU' : 'NEXUS';
        const body = d.createElement('div');
        body.className = 'message-text';
        body.textContent = text;
        msg.appendChild(sender);
        msg.appendChild(body);
        row.appendChild(msg);
        host.appendChild(row);
        host.scrollTop = host.scrollHeight;
        return msg;
    }

    function setText(node, text) {
        if (!node) {
            return;
        }
        const body = node.querySelector('.message-text');
        if (body) {
            body.textContent = text;
        }
    }

    /**
     * A transient state the avatar is in, rather than a progress bar.
     *
     * There are no percentages here and there should not be: nothing in this path knows how
     * far along a capture is. `Looking at Home PC…` is true for the whole wait, and a made-up
     * `63%` is not true at any point in it.
     */
    function thinking(text, doc) {
        const node = say(text, 'bot', doc);
        if (node) {
            node.classList.add('nexus-screen-thinking');
        }
        return node;
    }

    function settled(node) {
        if (node) {
            node.classList.remove('nexus-screen-thinking');
        }
        return node;
    }

    /**
     * Tell the 3D layer the avatar is looking away, and when she is back.
     *
     * An event rather than a call into the renderer: this file must work on a page with no
     * avatar at all (the mobile chat overlay, a test), and a hard dependency on the scene
     * would make a screenshot fail because a model had not loaded.
     */
    function glance(phase, detail) {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
            return;
        }
        try {
            window.dispatchEvent(
                new CustomEvent('nexus:screen-glance', { detail: Object.assign({ phase }, detail || {}) })
            );
        } catch (_) {
            // A browser without CustomEvent is still allowed to take screenshots.
        }
    }

    // ── the answer filter ───────────────────────────────────────────────────

    const REFUSALS = [
        "i'm sorry",
        'i am sorry',
        'sorry,',
        'i cannot',
        "i can't",
        'i am unable',
        "i'm unable",
        'as an ai',
        'i do not have',
        "i don't have",
        'unable to',
    ];

    /**
     * Is this worth showing a person? (`''` when not.)
     *
     * The same blunt rule ScreenSense keeps server-side, for the same reason: a small vision
     * model asked an open question about a screenshot sometimes returns two words of noise,
     * and printing that verbatim makes the product look broken when the truth is that the
     * model is too small. A real answer to "what is on my screen" is a sentence.
     */
    function usableAnswer(text) {
        const body = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!body) {
            return '';
        }
        const lowered = body.toLowerCase();
        for (const mark of REFUSALS) {
            if (lowered.startsWith(mark)) {
                return '';
            }
        }
        if (body.length < 20 || body.split(' ').filter(Boolean).length < 5) {
            return '';
        }
        return body;
    }

    /** `10:42:18` in the viewer's own clock — the stamp the citation carries. */
    function stamp(ms) {
        const d = new Date(Number(ms) || Date.now());
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    /**
     * Attach `↳ Screenshot · 10:42:18` under an answer, linked to the card it came from.
     *
     * This is the trust detail. Without it the user has an image and, separately, some
     * prose, and no way to know the prose is about that image rather than a newer capture.
     * Clicking scrolls the card back into view and flashes it.
     */
    function cite(node, frame, doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!node || !frame || !d) {
            return null;
        }
        const link = d.createElement('button');
        link.type = 'button';
        link.className = 'nexus-screen-cite';
        link.textContent = `↳ Screenshot · ${stamp(frame.taken_at_local)}`;
        link.addEventListener('click', () => {
            const card = d.querySelector(`.nexus-screen-card[data-frame-id="${frame.frame_id}"]`);
            if (!card) {
                return;
            }
            if (typeof card.scrollIntoView === 'function') {
                card.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            card.classList.remove('is-cited');
            // Reading offsetWidth restarts the animation; without it a second click on the
            // same citation does nothing, which reads as a broken link.
            void card.offsetWidth;
            card.classList.add('is-cited');
        });
        node.appendChild(link);
        return link;
    }

    // ── the round trips ─────────────────────────────────────────────────────

    /**
     * Take a picture and show it. Resolves to `{ok, frame}` so a caller can go on to ask
     * about it in the same turn.
     */
    async function look(opts = {}) {
        const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        const api = opts.screen || screen();
        if (!api) {
            return { ok: false, reason: 'not-loaded' };
        }

        const cap = await api.capability(opts.deps || {});
        const verdict = api.describe(cap);
        if (!verdict.ok) {
            say(verdict.text, 'bot', doc);
            return { ok: false, reason: cap.reason, said: verdict.text };
        }

        const device = cap.device || 'your computer';
        const pending = thinking(`Looking at ${device}…`, doc);
        glance('looking', { device });

        const shot = await api.capture(opts.reason || 'You asked me to look', opts.deps || {});
        if (!shot.ok) {
            settled(pending);
            setText(pending, shot.message || `I could not look at ${device} just then.`);
            glance('back', { device, ok: false });
            return { ok: false, reason: shot.reason, said: shot.message };
        }

        const store = frames();
        const record = store ? store.remember(shot.frame) : Object.assign({ taken_at_local: Date.now() }, shot.frame);
        const src = await api.frameObjectUrl(shot.frame, opts.deps || {});

        settled(pending);
        setText(pending, opts.line || `Here is ${device}.`);
        const builder = cards();
        if (pending && builder) {
            const card = builder.build(record, {
                doc,
                src,
                onAsk: () => ask('What do you see?', { doc, screen: api, deps: opts.deps, frame: record }),
                onRefresh: () => look(Object.assign({}, opts, { line: `Here is ${device}, again.` })),
                now: opts.now,
            });
            if (card) {
                pending.appendChild(card);
            }
        }
        glance('back', { device, ok: true });
        return { ok: true, frame: record, node: pending };
    }

    /**
     * Answer a question about a frame that already exists.
     *
     * `opts.frame` wins; otherwise the newest live one. If there is none — the user pressed
     * Ask on a card that has just expired — this captures first rather than refusing, and
     * says so by showing the new card.
     */
    async function ask(question, opts = {}) {
        const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        const api = opts.screen || screen();
        const store = frames();
        if (!api) {
            return { ok: false, reason: 'not-loaded' };
        }

        let frame = opts.frame && store ? store.get(opts.frame.frame_id) : opts.frame || null;
        if (!frame && store) {
            frame = store.latest();
        }
        if (!frame) {
            const taken = await look(Object.assign({}, opts, { reason: question }));
            if (!taken.ok) {
                return taken;
            }
            frame = taken.frame;
        }

        const pending = thinking('Reading it…', doc);
        const out = await api.explain(frame.frame_id, question, opts.deps || {});
        settled(pending);

        if (out && out.error === 'expired') {
            setText(pending, 'That screenshot has expired. Ask me to take another.');
            if (store) {
                store.forget(frame.frame_id);
            }
            return { ok: false, reason: 'expired' };
        }

        const answer = out && out.ok ? usableAnswer(out.analysis_text) : '';
        if (!answer) {
            // The picture was the useful part and it is still on screen. Failing the whole
            // turn here would throw away the thing that worked.
            const model = (out && out.meta && (out.meta.model || out.meta.name)) || '';
            setText(
                pending,
                out && out.message
                    ? out.message
                    : model
                      ? `I took the screenshot, but ${model} did not give me anything readable about it. A larger vision model would.`
                      : 'I took the screenshot, but I could not read it just now.'
            );
            cite(pending, frame, doc);
            return { ok: false, reason: 'no-answer', frame };
        }

        setText(pending, answer);
        cite(pending, frame, doc);
        return { ok: true, frame, answer };
    }

    // ── the hook ────────────────────────────────────────────────────────────

    /**
     * Intercept a screen request on its way to the model.
     *
     * Capture phase on the input and the send button, the same way the YouTube ask is
     * caught, so the app's own handler never sees a message this answers. Anything
     * `parseIntent` does not claim passes straight through — which is the whole of the
     * additive promise, and the behaviour on the day this file is deleted.
     */
    function hook(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return () => {};
        }
        const input = d.getElementById(OLD.input) || d.getElementById(LIVE.input);
        const send = d.getElementById(OLD.send) || d.getElementById(LIVE.send);
        if (!input || input.__nexusScreenAsk) {
            return () => {};
        }

        const intercept = (e) => {
            const store = frames();
            const intent = parseIntent(input.value, Boolean(store && store.latest()));
            if (!intent) {
                return; // ordinary conversation, and the model gets it
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const asked = input.value;
            input.value = '';
            say(asked, 'user', d);
            if (intent.kind === 'capture') {
                void look({ doc: d, reason: asked });
            } else {
                void ask(intent.question || asked, { doc: d });
            }
        };
        const onKey = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                intercept(e);
            }
        };
        input.addEventListener('keypress', onKey, true);
        if (send) {
            send.addEventListener('click', intercept, true);
        }
        input.__nexusScreenAsk = true;

        return () => {
            input.removeEventListener('keypress', onKey, true);
            if (send) {
                send.removeEventListener('click', intercept, true);
            }
            delete input.__nexusScreenAsk;
        };
    }

    /**
     * Attach, and keep attaching.
     *
     * The composer is built by `src/main.js` after this script has run, and on the mobile
     * overlay it is rebuilt when the drawer opens. A one-shot hook attaches to nothing on
     * the page that ships — that exact bug cost the YouTube feature a release — so this
     * watches for the input appearing, exactly as that fix does.
     */
    function init(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return () => {};
        }
        ensureCss(d);
        hook(d);
        if (typeof MutationObserver !== 'function' || !d.body) {
            return () => {};
        }
        const observer = new MutationObserver(() => hook(d));
        observer.observe(d.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_SCREEN_ASK_NOAUTO__) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => init());
        } else {
            init();
        }
    }

    return {
        parseIntent,
        look,
        ask,
        say,
        cite,
        hook,
        init,
        ensureCss,
        usableAnswer,
        stamp,
        glance,
        CAPTURE,
        ABOUT_FRAME,
        LOOK_AND_ASK,
        LIVE,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_SCREEN_ASK = ScreenAsk;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenAsk;
}
