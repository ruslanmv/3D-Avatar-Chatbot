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

    /**
     * "Just work alongside me" — the old Focus, kept.
     *
     * Body doubling is the best-engineered part of what Focus used to be: the silence is
     * structural rather than disciplined, enforced by a profile overlay with no speech budget.
     * Deleting that to make room for studying would have thrown away the one thing that
     * already worked.
     */
    const SIT_WITH_ME =
        /^(?:(?:just|only)\s+)?(?:sit|stay|work|be)\s+(?:with|near|beside|alongside)\s+me\b|^nothing[,.]?\s*(?:just|only)?\s*(?:sit|stay|work)\b|^(?:just )?(?:body[- ]?doubl\w*|work quietly|quiet company)\b/i;

    /** Verbs that can begin a request to play something. */
    const PLAY =
        '(?:play|put on|start|queue up|pon|execute|reproduce|find|find me|search|search for|look for|look up|get me|show me|list|list me|suggest|recommend)';

    /**
     * How many results a "top N" request asks for.
     *
     * "list the top 3 dance songs" is a request for three, and answering with four is the
     * kind of small carelessness that makes an interface feel like it was not listening.
     */
    const HOW_MANY = /\btop\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:best|songs?|tracks?|videos?)\b/i;

    /** The counting words that are part of the ask, not part of what to search for. */
    const COUNT_WORDS = /\b(?:the\s+)?top\s+\d{1,2}\s*|\b\d{1,2}\s+(?=best\b)|\bbest\s+(?=\d)/gi;

    /**
     * The politeness people actually put in front of a request (T4).
     *
     * Every pattern here is anchored at the start, and that anchor is load-bearing: without it
     * "we could play something later" is a request to play something. But *with* it, "can you
     * play some jazz" was not a request either — and "can you" is how most people ask. So the
     * lead-in is optional and matched at the anchor, which keeps the guarantee (the request has
     * to start the message) while accepting the phrasing.
     *
     * `(?:you|u)` is required after the modal on purpose. "could we", "should I", "we could"
     * are not requests to this assistant, and dropping the pronoun would let all three in.
     */
    const LEAD = '(?:(?:can|could|would|will)\\s+(?:you|u)\\s+)?(?:please\\s+)?';
    /** Words that make a play verb unambiguously about media rather than a game. */
    const MEDIA = '(?:song|songs|music|track|tune|album|playlist|video|videos|mix|radio|podcast|beats|ost|soundtrack)';

    /**
     * Patterns, tried in order. Each captures the query in group 1.
     *
     * Anchored at the start — after an optional polite lead-in — so a passing mention
     * mid-sentence ("we could play something later") is not a request. `search youtube` comes
     * first because it is the least ambiguous phrasing anybody uses.
     *
     * A play verb alone is never enough: every pattern also needs either the word *youtube* or
     * a media noun. That is what keeps "find my keys" and "start the timer" out, and it is why
     * widening the verbs was safe.
     */
    const PATTERNS = [
        // "search youtube for lofi" / "look on youtube for lofi"
        new RegExp(`^${LEAD}(?:search|look|find|browse)\\s+(?:on\\s+)?youtube\\s+(?:for\\s+)?(.+)$`, 'i'),
        // "youtube lofi hip hop"
        new RegExp(`^youtube[:,]?\\s+(.+)$`, 'i'),
        // "play a video in youtube of music" — what follows the connector is the request.
        //
        // Ordered before the pattern below because that one matches this sentence too, and
        // matches it wrongly: its lazy group stops at the first "in", captures "a video", and
        // searches for the word *video* while the user plainly asked for music. The
        // connectors are deliberately only `of|about|with`; `for` is excluded because
        // "put on jazz on youtube for me" would then search for "me".
        new RegExp(`^${LEAD}${PLAY}\\s+.+?\\s+(?:on|in|from)\\s+youtube\\b\\s*(?:of|about|with)\\s+(.+)$`, 'i'),
        // "play lofi on youtube" / "put on jazz on youtube"
        new RegExp(`^${LEAD}${PLAY}\\s+(.+?)\\s+(?:on|in|from)\\s+youtube\\b.*$`, 'i'),
        // "play the lofi video" / "put on some jazz music" — a media word makes it a request
        new RegExp(`^${LEAD}${PLAY}\\s+(?:me\\s+)?(?:some\\s+|the\\s+|a\\s+|an\\s+)?(.*\\b${MEDIA}\\b.*)$`, 'i'),
        new RegExp(
            `^${LEAD}${PLAY}\\s+(?:me\\s+)?(?:some\\s+|the\\s+|a\\s+|an\\s+)?${MEDIA}\\s+(?:by|from|of)\\s+(.+)$`,
            'i'
        ),
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
            let q = m[1].replace(TRIM, '').replace(/\s+/g, ' ').trim();
            // Widening the verbs made `search` match before `search for`, so the connector
            // leaked into the query and YouTube was asked for "for dance music".
            q = q.replace(/^(?:for|about|of)\s+/i, '').trim();
            // "top 3" says how many, not what — leaving it in searches YouTube for the words
            // "top 3", which is how "list the top 3 dance songs" returns compilations called
            // "Top 3".
            const many = HOW_MANY.exec(t);
            const count = many ? Number(many[1] || many[2]) : 0;
            q = q.replace(COUNT_WORDS, '').replace(/\s+/g, ' ').trim();
            if (q) {
                return { query: q, matched: re.source, count: count > 0 ? Math.min(count, 8) : 0 };
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
    /**
     * Put what was just said into the model's transcript, not only on the screen (batch M7).
     *
     * `say` drew a message and stopped there, so every turn this file handles — the user's
     * "stop", their "play the first one", their "search top music about love", and the app's
     * replies to each — was visible to the person and invisible to the model. What the model
     * actually received was this:
     *
     *     user       hello there
     *     assistant  Hello! Welcome...
     *     assistant  Playing “Relaxing music…” — url
     *     assistant  Playing “TOP10 LOVE SONGS…” — url
     *     assistant  Playing “New Love Songs 2020…” — url
     *     user       can you dance
     *
     * Three assistant turns in a row with nothing from the user between them, because the
     * cards were recorded and the requests that caused them were not. Asked "can you dance",
     * it answered *"It seems you're trying to play a video, but the user has not specified
     * which video they want to watch"* — talking about the user in the third person, which is
     * what a model does when the transcript stops looking like a conversation it is part of.
     *
     * So the screen and the transcript are written together, here, in the one function that
     * every path in this file goes through. `ChatManager` keeps its own history, so that
     * branch is left alone rather than recorded twice.
     */
    function remember(text, who) {
        const w = typeof window !== 'undefined' ? window : null;
        if (!w || (w.ChatManager && typeof w.ChatManager.addMessage === 'function')) {
            return false;
        }
        const history = w.chatHistory;
        if (!history || typeof history.addMessage !== 'function') {
            return false;
        }
        try {
            history.addMessage(who === 'user' ? 'user' : 'assistant', String(text || ''));
        } catch (_) {
            // A message on screen is worth more than a tidy transcript.
            return false;
        }
        try {
            // The same call the app makes after its own messages, so an intercepted turn
            // survives a reload exactly as an ordinary one does.
            if (typeof w._persistChat === 'function') {
                w._persistChat();
            }
        } catch (_) {
            // Storage full or disabled.
        }
        return true;
    }

    function say(text, who = 'bot', doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return null;
        }
        remember(text, who);
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

    /**
     * “Set up YouTube” — the whole of what a user needs to do about a missing key.
     *
     * A real `<button>` rather than a styled div, because it does something and has to be
     * reachable from a keyboard. On a page with no Settings modal it still renders and does
     * nothing visible, which is better than an affordance that vanishes on some pages.
     */
    function setupButton(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'nexus-yt-setup';
        btn.textContent = 'Set up YouTube';
        btn.addEventListener('click', () => {
            const settings = typeof window !== 'undefined' ? window.NEXUS_YT_SETTINGS : null;
            if (settings && typeof settings.openSettings === 'function') {
                settings.openSettings(d);
            }
        });
        return btn;
    }

    /** Draw result cards under a message node, using the 2D card builder. */
    function showResults(node, results, doc) {
        const embed = typeof window !== 'undefined' ? window.NEXUS_YT_2D : null;
        if (!node || !embed || typeof embed.buildCard !== 'function') {
            return 0;
        }
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const rows = results.slice(0, MAX_RESULTS);
        // The same compact row `decorate` uses: side by side on a desktop pane, swipeable on
        // a phone. Search results are exactly the case that turned the thread into a
        // catalogue, so they must not be the one path that still stacks.
        let parent = node;
        if (rows.length > 1 && d) {
            parent = d.createElement('div');
            parent.className = 'nexus-yt-group';
            node.appendChild(parent);
        }
        let drawn = 0;
        for (const r of rows) {
            parent.appendChild(embed.buildCard(r, { doc: d }));
            drawn += 1;
        }

        // M4. Remember what was shown, so "play the first one" has something to point at.
        //
        // Without this the reference resolver has an empty list and the sentence falls
        // through to the search parser, which is exactly the bug: "play the fist song of the
        // list" became a YouTube query for those words. Drawing cards and recording them are
        // one act — a list on screen that the app cannot name is a list nobody can refer to.
        const session = typeof window !== 'undefined' ? window.NEXUS_MEDIA_SESSION : null;
        if (session && typeof session.setResults === 'function') {
            try {
                session.setResults(
                    rows.map((r) => ({
                        id: r.id,
                        provider: 'youtube',
                        kind: 'video',
                        title: r.name || r.title || '',
                        creator: r.channel || r.creator || '',
                        url: `https://www.youtube.com/watch?v=${r.id}`,
                    })),
                    { source: 'search' }
                );
            } catch (_) {
                // Cards on screen are worth more than the ability to name them.
            }
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
            // still honoured — and the way to connect it is a button, not an instruction.
            //
            // D1. This used to print `localStorage.setItem('nexus.yt.apiKey', 'YOUR_KEY')`,
            // which is a line of JavaScript shown to somebody who asked for a song. The
            // how-to still exists, in docs/YOUTUBE.md, where a developer looks for it.
            const node = say(`YouTube search isn't connected yet — here's the search for “${query}”.`, 'bot', d);
            if (node) {
                const link = d.createElement('a');
                link.className = 'nexus-yt-open';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                link.textContent = `Search YouTube for “${query}”`;
                node.appendChild(link);
                node.appendChild(setupButton(d));
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
    /**
     * What to say when a media request produced nothing (batch M9).
     *
     * Every one of these used to be silence: `void intents.list(...)` discarded the result, so
     * an off switch, an empty query, a failed search and a missing renderer all looked
     * identical from the user's side — they typed a sentence and the app did nothing. That is
     * the worst possible answer, because there is nothing to act on and no reason to believe
     * anything is wrong rather than slow.
     */
    const WHY_COPY = {
        'together-off': "Together is switched off, so I can't play media. You can turn it back on in Settings.",
        'empty-query': "I didn't catch what to look for.",
        'no-provider': "Search isn't set up on this deployment yet.",
        'search-failed': "I couldn't reach the search just now — worth trying again in a moment.",
        'nothing-found': "I couldn't find anything for that.",
        'no-chat': 'Something went wrong putting that in the chat.',
    };

    /** Run a media request and say something if it comes back empty-handed. */
    function announce(promise, d) {
        return Promise.resolve(promise)
            .then((out) => {
                if (out && out.ok === false) {
                    say(WHY_COPY[out.why] || "That didn't work, sorry.", 'bot', d);
                }
                return out;
            })
            .catch(() => {
                say(WHY_COPY['search-failed'], 'bot', d);
                return null;
            });
    }

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
            const said0 = input.value;
            const w = typeof window !== 'undefined' ? window : null;
            const command = w && w.NEXUS_MEDIA_COMMAND;
            const intents = w && w.NEXUS_MEDIA_INTENT;

            // S3. A study session has just asked what to learn, so this message is the answer
            // — before any media parsing, or "play me some music theory" gets treated as a
            // request to play music rather than as the topic.
            const study = w && w.NEXUS_STUDY_SESSION;
            const loop = w && w.NEXUS_STUDY_LOOP;
            if (study && loop && typeof study.get === 'function' && study.get().phase === 'topic' && said0.trim()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                input.value = '';
                say(said0, 'user', d);
                // "Just sit with me" is still a real answer. Body doubling is the best part of
                // the old Focus and survives as a branch rather than a deletion.
                if (SIT_WITH_ME.test(said0)) {
                    study.end();
                    const focus = w.NEXUS_BD_FOCUS;
                    if (focus && typeof focus.start === 'function') {
                        try {
                            focus.start();
                            say("Alright — I'll be here. No talking.", 'bot', d);
                            return;
                        } catch (_) {
                            /* fall through to studying, which is better than nothing */
                        }
                    }
                }
                void Promise.resolve(loop.study(said0)).catch(() => null);
                return;
            }

            // M5. "Stop the music" — before anything else, because a request to stop must
            // never be answered by starting something. Only acted on when something is
            // actually playing: with nothing on, "stop" belongs to the conversation, and
            // intercepting it would swallow an ordinary sentence.
            if (command && typeof command.transport === 'function') {
                const move = command.transport(said0);
                const embed = w && w.NEXUS_YT_2D;
                if (move && embed && typeof embed.control === 'function') {
                    let acted = false;
                    try {
                        acted = embed.control(move);
                    } catch (_) {
                        acted = false;
                    }
                    if (acted) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        input.value = '';
                        say(said0, 'user', d);
                        say(
                            { stop: 'Stopped.', pause: 'Paused.', resume: 'Playing again.' }[move] || 'Done.',
                            'bot',
                            d
                        );
                        return;
                    }
                }
            }

            // M4. A pointer at results already on screen, resolved before anything treats the
            // sentence as search terms.
            //
            //     YOU  play the fist song of the list
            //          → five videos about first songs
            //
            // The app was holding the list. `MediaSession` keeps it precisely so "the first
            // one" can mean something, and this is where that becomes true — no provider call,
            // no second catalogue, just the thing they pointed at.
            if (command && typeof command.resolve === 'function' && intents) {
                let pointed = null;
                try {
                    pointed = command.resolve(said0);
                } catch (_) {
                    pointed = null;
                }
                if (pointed && pointed.result) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    input.value = '';
                    say(said0, 'user', d);
                    try {
                        if (typeof intents.play === 'function') {
                            intents.play(pointed.result, 'reference');
                        }
                    } catch (_) {
                        /* a pointer that cannot play is not worth losing the message over */
                    }
                    return;
                }
            }

            const intent = parseIntent(input.value);
            const follow = typeof window !== 'undefined' ? window.NEXUS_PLAY_FOLLOWUP : null;

            // T6. A pattern is a function of one message, so "yes" and "can you play it" are
            // unreachable to it — they are only requests given the message before. The memory
            // is one topic, two turns, taken from what the *user* typed and never from what the
            // assistant suggested: a model that offered five genres has not been chosen from.
            if (!intent && follow) {
                const carried = follow.resolve(input.value);
                if (carried) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const said = input.value;
                    input.value = '';
                    say(said, 'user', d);
                    follow.clear();
                    void fulfil(carried.query, { doc: d });
                    return;
                }
            }
            if (follow) {
                follow.note(input.value, { handled: Boolean(intent) });
            }

            if (!intent) {
                return; // ordinary conversation, and the model gets it
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const asked = input.value;
            input.value = '';
            say(asked, 'user', d);

            // M4. "Play" and "find" were the same verb list, so a request to *start* something
            // was answered with a catalogue and four more steps:
            //
            //     YOU    play music please
            //     NEXUS  Here's what I found for “music”. Press play on one…
            //
            // Now an execute verb takes the execute path: one result, published and started.
            // Discover keeps the list, because a list is what was asked for.
            const move = command ? command.action(asked) : null;
            if (command && intents && move === 'execute' && typeof intents.fulfil === 'function') {
                void announce(
                    intents.fulfil({ query: intent.query, kind: intent.kind || 'video', source: 'pattern' }),
                    d
                );
                return;
            }
            // M6. A request to find ends in a list they can pick from — not in something
            // playing that nobody chose. `count` honours "the top 3".
            if (command && intents && move === 'discover' && typeof intents.list === 'function') {
                void announce(
                    intents.list({
                        query: intent.query,
                        kind: intent.kind || 'video',
                        count: intent.count || 4,
                        source: 'pattern',
                    }),
                    d
                );
                return;
            }
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

    return {
        parseIntent,
        fulfil,
        say,
        remember,
        announce,
        WHY_COPY,
        showResults,
        setupButton,
        hook,
        init,
        PATTERNS,
        MAX_RESULTS,
        LIVE,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_ASK = YouTubeAsk;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeAsk;
}
