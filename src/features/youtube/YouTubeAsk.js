/**
 * Ask her to put something on (batch YT-6).
 *
 * `/yt lofi` already searched YouTube — but only on a page with a `ChatManager` singleton,
 * which the shipped `index.html` does not have, and only if you knew the command existed.
 * What people actually do is say it: *"play some lofi"*, *"put on the Rick Astley video"*,
 * *"search youtube for jazz"*.
 *
 * This is that. It sits in front of the send button, recognises a request to play something,
 * and answers with result cards the rest of the feature already knows how to draw — click one
 * and it plays inline; press **Watch in VR** and it goes to the cinema screen.
 *
 * ## Why the matching is deliberately narrow
 *
 * The cost of a false positive is high and silent: a message the user meant for the assistant
 * never reaches it, and they get a video search instead of an answer. "Play chess with me" and
 * "let's play a game" are ordinary conversation. So a bare *play* is never enough — a request
 * qualifies only when it either names YouTube, or pairs a play verb with something that is
 * plainly media (a song, a track, music, a video, a genre). Everything else goes to the model
 * untouched, which is the behaviour on the day this file is deleted.
 *
 * ## Without an API key it still helps
 *
 * Search needs a Data API key. Without one this does not go quiet: it answers with a link to
 * the YouTube search for what you asked, so the request still gets you somewhere, and says
 * once how to add a key.
 *
 * Exposes: window.NEXUS_YT_ASK
 */
const YouTubeAsk = (() => {
    'use strict';

    /** The live page's ids; `index-old.html`'s are tried first by the caller. */
    const LIVE = { history: 'chat-history', input: 'speech-text', send: 'speak-btn' };
    const OLD = { input: 'chatInput', send: 'sendBtn' };

    const MAX_RESULTS = 5;

    function YT() {
        return (typeof window !== 'undefined' && window.NEXUS_YT) || null;
    }
    function companion() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_COMPANION) || null;
    }

    // ── the intent ──────────────────────────────────────────────────────────

    /** Verbs that can begin a request to play something. */
    const PLAY = '(?:play|put on|start|queue up|pon)';
    /** Words that make a play verb unambiguously about media rather than a game. */
    const MEDIA = '(?:song|songs|music|track|tune|album|playlist|video|videos|mix|radio|podcast|beats|ost|soundtrack)';

    /**
     * Patterns, tried in order. Each captures the query in group 1.
     *
     * Anchored at the start so a passing mention mid-sentence ("we could play something
     * later") is not a request. `search youtube` comes first because it is the least
     * ambiguous phrasing anybody uses.
     */
    const PATTERNS = [
        // "search youtube for lofi" / "look on youtube for lofi"
        new RegExp(`^(?:search|look|find|browse)\\s+(?:on\\s+)?youtube\\s+(?:for\\s+)?(.+)$`, 'i'),
        // "youtube lofi hip hop"
        new RegExp(`^youtube[:,]?\\s+(.+)$`, 'i'),
        // "play lofi on youtube" / "put on jazz on youtube"
        new RegExp(`^${PLAY}\\s+(.+?)\\s+(?:on|in|from)\\s+youtube\\b.*$`, 'i'),
        // "play the lofi video" / "put on some jazz music" — a media word makes it a request
        new RegExp(`^${PLAY}\\s+(?:me\\s+)?(?:some\\s+|the\\s+|a\\s+|an\\s+)?(.*\\b${MEDIA}\\b.*)$`, 'i'),
        new RegExp(`^${PLAY}\\s+(?:me\\s+)?(?:some\\s+|the\\s+|a\\s+|an\\s+)?${MEDIA}\\s+(?:by|from|of)\\s+(.+)$`, 'i'),
        // "/yt lofi", kept so the command and the sentence share one implementation
        new RegExp(`^/(?:yt|youtube)\\s+(.+)$`, 'i'),
    ];

    /** Words that are being asked *for*, not part of what to search. */
    const TRIM = new RegExp(`^(?:some|the|a|an|me)\\s+|\\s+(?:please|now|for me)\\.?$`, 'gi');

    /**
     * The thing to search for, or `null` when this is ordinary conversation.
     *
     * A message that already contains a YouTube link is **not** an intent: the card for it is
     * about to appear on its own, and searching as well would answer a question nobody asked.
     */
    function parseIntent(text) {
        const t = String(text || '').trim();
        if (!t) {
            return null;
        }
        const Y = YT();
        if (Y && Y.extract && Y.extract(t).length) {
            return null;
        }
        for (const re of PATTERNS) {
            const m = re.exec(t);
            if (!m) {
                continue;
            }
            const q = m[1].replace(TRIM, '').replace(/\s+/g, ' ').trim();
            if (q) {
                return { query: q, matched: re.source };
            }
        }
        return null;
    }

    // ── saying things in the page the app actually renders ──────────────────

    /**
     * Put a message in the chat, in whichever shape this page uses.
     *
     * `ChatManager` when there is one (`index-old.html`); otherwise the
     * `.chat-row > .chat-message > .message-text` the shipped `src/main.js` builds — read off
     * the running app rather than guessed, and the same shape `AvatarAliveness` and
     * `CompanionMode` already observe. Returns the node so a caller can decorate it.
     */
    function say(text, who = 'bot', doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return null;
        }
        const cm = typeof window !== 'undefined' ? window.ChatManager : null;
        if (cm && typeof cm.addMessage === 'function') {
            cm.addMessage(text, who);
            return null;
        }
        const host = d.getElementById(LIVE.history);
        if (!host) {
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

    /** Draw result cards under a message node, using the 2D card builder. */
    function showResults(node, results, doc) {
        const embed = typeof window !== 'undefined' ? window.NEXUS_YT_2D : null;
        if (!node || !embed || typeof embed.buildCard !== 'function') {
            return 0;
        }
        const d = doc || (typeof document !== 'undefined' ? document : null);
        let drawn = 0;
        for (const r of results.slice(0, MAX_RESULTS)) {
            node.appendChild(embed.buildCard(r, { doc: d }));
            drawn += 1;
        }
        return drawn;
    }

    // ── the round trip ──────────────────────────────────────────────────────

    /**
     * Answer a request to play something. Resolves to what happened, for tests and callers.
     *
     * The user's own words are echoed first so the transcript reads like a conversation
     * rather than like results appearing from nowhere.
     */
    async function fulfil(query, { doc, search } = {}) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const comp = companion();
        const Y = YT();
        if (!Y || !comp) {
            return { ok: false, why: 'feature not loaded' };
        }

        if (!comp.apiKey || !comp.apiKey()) {
            // No key is not a dead end. The search page is one tap away and the request is
            // still honoured; the how-to is said once, plainly, and never again in this turn.
            const node = say(
                `I can't search YouTube without an API key, but here's the search for “${query}”.`,
                'bot',
                d
            );
            if (node) {
                const link = d.createElement('a');
                link.className = 'nexus-yt-open';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                link.textContent = `Search YouTube for “${query}”`;
                node.appendChild(link);
                const hint = d.createElement('div');
                hint.className = 'nexus-yt-status';
                hint.textContent = `Add a key with localStorage.setItem('${comp.KEY_STORAGE}', 'YOUR_KEY') and I'll show the results here instead.`;
                node.appendChild(hint);
            }
            return { ok: true, why: 'no key', query };
        }

        const pending = say(`Looking for “${query}” on YouTube…`, 'bot', d);
        let results;
        try {
            results = await (search || comp.search)(query, { max: MAX_RESULTS });
        } catch (err) {
            if (pending) {
                pending.querySelector('.message-text').textContent =
                    `I couldn't reach YouTube just then. ${String((err && err.message) || err)}`;
            }
            return { ok: false, why: 'search failed', query };
        }
        if (!results || !results.length) {
            if (pending) {
                pending.querySelector('.message-text').textContent = `Nothing came back for “${query}”.`;
            }
            return { ok: true, why: 'empty', query };
        }
        if (pending) {
            pending.querySelector('.message-text').textContent =
                results.length === 1
                    ? `Here's “${results[0].name || query}”. Press play, or Watch in VR.`
                    : `Here's what I found for “${query}”. Press play on one, or Watch in VR.`;
        }
        const drawn = showResults(pending, results, d);
        return { ok: true, why: 'results', query, count: drawn };
    }

    // ── the hook ────────────────────────────────────────────────────────────

    /**
     * Intercept a play request on its way to the model.
     *
     * Capture phase on both the input and the send button, the same way the `/yt` command is
     * caught, so the app's own handler never sees a message this answers. Anything
     * `parseIntent` does not claim passes straight through, untouched — which is the whole of
     * the additive promise.
     */
    function hook(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return () => {};
        }
        const input = d.getElementById(OLD.input) || d.getElementById(LIVE.input);
        const send = d.getElementById(OLD.send) || d.getElementById(LIVE.send);
        if (!input || input.__nexusYtAsk) {
            return () => {};
        }

        const intercept = (e) => {
            const intent = parseIntent(input.value);
            if (!intent) {
                return; // ordinary conversation, and the model gets it
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const asked = input.value;
            input.value = '';
            say(asked, 'user', d);
            void fulfil(intent.query, { doc: d });
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
        input.__nexusYtAsk = true;

        return () => {
            input.removeEventListener('keypress', onKey, true);
            if (send) {
                send.removeEventListener('click', intercept, true);
            }
            delete input.__nexusYtAsk;
        };
    }

    function init(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return;
        }
        hook(d);
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_YT_ASK_NOAUTO__) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => init());
        } else {
            init();
        }
    }

    return { parseIntent, fulfil, say, showResults, hook, init, PATTERNS, MAX_RESULTS, LIVE };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_ASK = YouTubeAsk;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeAsk;
}
