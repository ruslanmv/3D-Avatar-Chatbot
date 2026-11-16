/**
 * What kind of turn the person just took — decided here, locally, before the model answers.
 *
 * Private was a five-minute script that tolerated conversation. Beats fired at 45, 120, 210 and
 * 285 seconds whatever was happening, and the only concession to a person actually talking was
 * `_conversationBusyUntil = now + 8000` — a guess that an answer takes eight seconds. It can
 * take seven hundred milliseconds or fifteen seconds, so the guess was wrong in both directions:
 * a beat could land on top of a reply still streaming, or the session could sit mute long after
 * one had finished.
 *
 * Two things fix that, and this file is the first. Classifying a turn locally means the
 * experience can react *before* a token comes back — a pace request can ease off immediately, a
 * question can suppress the next scheduled beat immediately — so Private feels attentive at
 * 50 ms rather than at whatever the provider costs.
 *
 * ## Heuristics, deliberately, and deliberately conservative
 *
 * No second model call: a classifier that costs a round trip cannot be used to hide a round
 * trip. So this is patterns over a lowercased string, and every ambiguous case resolves to
 * `conversation` — the intent that changes nothing. Being unsure must never be the thing that
 * escalates a pace, changes a scene or ends a session.
 *
 * The order matters and is not alphabetical. `end` and `pace-down` are checked before anything
 * else because they are the two the person must always be able to reach, including mid-sentence
 * and including when the rest of the sentence looks like something else. "slow down, this is
 * nice" is a pace request that happens to contain a compliment, and reading the compliment
 * would be the worst possible failure this file can have.
 *
 * ## What it is not
 *
 * Not consent. `pace-up-request` means the person asked for more; whether they get it is
 * `ConsentFlow`'s decision, on its own earned-and-checked-in terms, and nothing here bypasses
 * it. This classifies a sentence; the gate still decides.
 *
 * Exposes: window.NEXUS_PRIVATE_TURN_DIRECTOR
 */
(function (global) {
    'use strict';

    /**
     * Every intent, and what it is for.
     *
     * Small on purpose. A taxonomy with thirty entries is one nobody can keep in their head
     * while reading the runtime that consumes it, and the runtime only branches on a handful.
     */
    const INTENTS = Object.freeze([
        'end', // stop now
        'pace-down', // ease off
        'pace-up-request', // asked for more — the gate still decides
        'quiet', // fewer words, more presence
        'scene-request', // somewhere else
        'music-request', // the soundtrack
        'preference', // how she should be
        'question', // asked something
        'request', // asked her to do or tell
        'affirmation', // yes / agreement
        'conversation', // everything else, and the safe default
    ]);

    /** Conversation styles the runtime moves between. Never shown, only felt. */
    const STYLES = Object.freeze(['guided', 'conversational', 'quiet']);

    // eslint-disable-next-line no-control-regex
    const CONTROL = /[\x00-\x1f\x7f]/g;

    function normalise(value) {
        return String(value == null ? '' : value)
            .replace(CONTROL, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Whole-word matching that works outside ASCII. `\b` in a JS regex is ASCII-only, so it cannot see
     * the edge of "arrête" or "più"; this asks for no letter or digit on either side instead. CJK has
     * no spaces, so those languages are plain substring patterns.
     */
    function unicodeWords(list) {
        const escaped = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp('(?<![\\p{L}\\p{N}])(?:' + escaped.join('|') + ')(?![\\p{L}\\p{N}])', 'u');
    }

    /**
     * The two that outrank everything, in the order they are checked.
     *
     * `ConsentFlow` already owns `stop` and `exit` as hard-exit words and `cozy` as the soft
     * one; these are the same idea reached through ordinary phrasing, and they are first so that
     * no amount of surrounding sentence can outvote them.
     *
     * English is the baseline and is exactly what it always was: it applies in every session,
     * because "stop" has always ended Private whatever language the app is in.
     */
    const END = [/\bstop\b/, /\bexit\b/, /\bend (?:this|it|the session)\b/, /\bi(?:'m| am) done\b/, /\bgoodnight\b/];
    const PACE_DOWN = [
        /\bslow(?:er)? down\b/,
        /\bslow it down\b/,
        /\btake it slow(?:er)?\b/,
        /\bcozy\b/,
        /\bcalm down\b/,
        /\bease off\b/,
        /\bless intense\b/,
        /\btoo (?:much|fast|intense)\b/,
        /\bback off\b/,
    ];

    /**
     * AC3. Each language's own words for the same two ideas, kept apart: a language's pack applies
     * only while the app is in that language (`AppLanguage.code`), and never mixes into another's.
     * They were English only, so a typed Italian "basta" or "fermati" was read as small talk and only
     * the End button worked.
     *
     * What goes in a pack: words that mean "stop" / "good night" (end) or "slow down" / "too much"
     * (pace down) in that language and are not also everyday words there. Italian "troppo" or
     * "calma" on their own, Spanish "para" ("for"), French "assez" ("quite") and Portuguese
     * "chega" ("arrives") stay conversation: this check can end an evening, so a false positive is
     * paid for by the person.
     */
    const PACKS = Object.freeze({
        it: {
            end: [unicodeWords(['basta', 'basta così', 'fermati', 'smettila', 'buonanotte', 'buona notte'])],
            paceDown: [
                unicodeWords([
                    'rallenta',
                    'più piano',
                    'piu piano',
                    'troppo veloce',
                    'troppo intenso',
                    'è troppo',
                    'calmati',
                ]),
            ],
        },
        es: {
            end: [unicodeWords(['detente', 'ya basta', 'buenas noches'])],
            paceDown: [
                unicodeWords([
                    'más despacio',
                    'mas despacio',
                    'más lento',
                    'demasiado rápido',
                    'demasiado rapido',
                    'baja el ritmo',
                ]),
            ],
        },
        fr: {
            end: [unicodeWords(['arrête', 'arrete', 'arrête-toi', 'bonne nuit'])],
            paceDown: [unicodeWords(['plus doucement', 'ralentis', 'trop vite', 'trop intense', 'calme-toi'])],
        },
        de: {
            end: [unicodeWords(['hör auf', 'hoer auf', 'aufhören', 'stopp', 'gute nacht'])],
            paceDown: [unicodeWords(['langsamer', 'zu schnell', 'zu viel', 'beruhige dich'])],
        },
        pt: {
            end: [unicodeWords(['pare', 'pára', 'boa noite'])],
            paceDown: [unicodeWords(['mais devagar', 'muito rápido', 'muito rapido', 'mais calmo'])],
        },
        ja: {
            end: [/やめて|やめろ|ストップ|おやすみ|終わりにして|止めて/],
            paceDown: [/ゆっくり|速すぎ|早すぎ|落ち着いて/],
        },
        ko: {
            end: [/그만|멈춰|중지|잘 자/],
            paceDown: [/천천히|너무 빨라|진정해/],
        },
        zh: {
            end: [/停止|停下|别说了|够了|结束吧|晚安/],
            paceDown: [/慢一点|慢点|太快了|太多了|冷静一点/],
        },
    });

    /** `it-IT` -> `it`. The app's own language, read at call time like `PrivateLocale` does. */
    function activeLanguage(override) {
        const raw = override || (global && global.AppLanguage && global.AppLanguage.code) || 'en-US';
        return String(raw).slice(0, 2).toLowerCase();
    }

    /** English always; the app language's own pack on top of it when it has one. */
    function safeWords(lang) {
        const own = PACKS[activeLanguage(lang)] || null;
        return {
            end: own ? END.concat(own.end) : END,
            paceDown: own ? PACE_DOWN.concat(own.paceDown) : PACE_DOWN,
        };
    }

    const PACE_UP = [
        /\b(?:a little |a bit )?(?:more|closer)\b.*\b(?:intense|flirty|sensual|close)\b/,
        /\bturn (?:it|the .*) up\b/,
        /\bcome closer\b/,
        /\bget closer\b/,
        /\bmore of that\b/,
    ];

    const QUIET = [
        /\bjust stay\b/,
        /\bstay (?:here|with me|like this)\b/,
        /\bdon'?t (?:say|talk)\b/,
        /\bbe quiet\b/,
        /\bno (?:words|talking)\b/,
        /\bin silence\b/,
        /\bjust be here\b/,
    ];

    const SCENE = [
        /\b(?:go|move|take me|can we go)\b.*\b(?:somewhere|place|room|outside|terrace|beach|garden)\b/,
        /\bchange the (?:scene|room|place|background)\b/,
        /\bsomewhere (?:quieter|warmer|darker|else)\b/,
    ];

    const MUSIC = [
        /\b(?:music|song|track|soundtrack)\b.*\b(?:off|on|down|up|louder|quieter|stop|change|different)\b/,
        /\b(?:turn|put)\s+(?:off|on|down|up)\b.*\b(?:music|song|track)\b/,
        /\bno music\b/,
        /\bplay something (?:else|softer|quieter)\b/,
    ];

    const PREFERENCE = [
        /\bbe (?:more|less|a little more|a bit more)\b/,
        /\b(?:more|less) (?:playful|tender|romantic|gentle|soft|teasing|serious)\b/,
        /\bcan (?:we|you) keep (?:this|it)\b/,
        /\bi(?:'d| would) (?:prefer|rather)\b/,
        /\bi (?:just )?want(?: to)? (?:talk|chat)\b/,
        /\bi don'?t want a story\b/,
    ];

    const REQUEST = [
        /\btell me\b/,
        /\bshow me\b/,
        /\bsay something\b/,
        /\bgive me\b/,
        /\bcan you\b/,
        /\bwould you\b/,
        /\bplease\b/,
    ];

    const AFFIRMATION = [
        /^(?:yes|yeah|yep|yup|sure|okay|ok|mm+|mhm+|right|exactly|agreed|true|nice|good|please do)[.!]?$/,
        /^(?:i )?(?:like|love) (?:that|this|it)[.!]?$/,
        // `that is` as well as `that's`: an expansion is not a different sentiment, and a
        // classifier that only recognises the contraction quietly reads half the compliments
        // people actually type as `conversation`.
        /^that (?:is|'s|s) (?:nice|lovely|good|sweet|perfect)[.!]?$/,
    ];

    const QUESTION = [/\?$/, /^(?:why|what|how|when|where|who|which|really|do you|are you|did you|can you)\b/];

    function any(patterns, text) {
        return patterns.some((pattern) => pattern.test(text));
    }

    /**
     * Classify one turn.
     *
     * Returns the intent plus what the runtime needs to act without re-parsing: which way a
     * pace request pointed, and a length bucket for choosing a response budget.
     */
    function classify(raw, options) {
        const text = normalise(raw);
        if (!text) return shape('conversation', text);

        // Safety words first, and unconditionally. See the header.
        const safe = safeWords(options && options.lang);
        if (any(safe.end, text)) return shape('end', text);
        if (any(safe.paceDown, text)) return shape('pace-down', text);

        if (any(QUIET, text)) return shape('quiet', text);
        if (any(MUSIC, text)) return shape('music-request', text);
        if (any(SCENE, text)) return shape('scene-request', text);
        if (any(PACE_UP, text)) return shape('pace-up-request', text);
        if (any(PREFERENCE, text)) return shape('preference', text);
        if (any(AFFIRMATION, text)) return shape('affirmation', text);
        // A question mark beats a request phrasing: "can you tell me why?" is being asked, and
        // answering it is the same thing either way, but the budget differs.
        if (any(QUESTION, text)) return shape('question', text);
        if (any(REQUEST, text)) return shape('request', text);
        return shape('conversation', text);
    }

    /** Words, bucketed — the runtime mirrors the person's energy rather than measuring it. */
    function lengthOf(text) {
        const words = text.split(/\s+/).filter(Boolean).length;
        if (words <= 2) return 'tiny';
        if (words <= 8) return 'short';
        if (words <= 30) return 'medium';
        return 'long';
    }

    function shape(intent, text) {
        return {
            intent,
            length: lengthOf(text),
            words: text.split(/\s+/).filter(Boolean).length,
            /** Which way a pace turn pointed, for a runtime that should not re-read the string. */
            pace: intent === 'pace-down' ? 'down' : intent === 'pace-up-request' ? 'up' : null,
            /** Whether the experience should hold its next scheduled beat. */
            holdsTheFloor: intent === 'question' || intent === 'request',
        };
    }

    /**
     * The style this turn suggests, or `null` for "leave it alone".
     *
     * Deliberately sparse: three intents move it and the rest do not, so the style drifts with
     * what somebody is actually doing rather than oscillating on every sentence.
     */
    function styleFor(intent) {
        if (intent === 'quiet') return 'quiet';
        if (intent === 'question' || intent === 'request' || intent === 'preference') return 'conversational';
        return null;
    }

    /**
     * How many tokens her answer is allowed, which is not the same as how long it should be.
     *
     * ## The correction (P19), because the first version of this table broke the feature
     *
     * These numbers were 48–140, and at those values a Private turn came back **empty**. The
     * provider answered with `finish_reason: "length"` and no content, `LLMManager` turned that
     * into the literal string `'No response'`, and the card drew it under a `HER` label and spoke
     * it out loud. Reported exactly that way, with `This is good.` as the turn that caused it: 3
     * words, `conversation`, `short` → 96, plus 48 for the `<choices>` block → a 144-token
     * allowance for a reply *and* three buttons.
     *
     * The mistake was in the old comment above this table, which said "prompts are a request and
     * `max_tokens` is a rule". Both halves are true and the conclusion does not follow, because
     * the two do different jobs:
     *
     *   - **The prompt controls length.** `privateLengthLines` already says "one short sentence",
     *     "one or two sentences", "three at most". That is what made Private answer briefly, and
     *     it is what removed the hundred-and-fifty-word replies.
     *   - **`max_tokens` controls only the failure.** It is a ceiling, and providers bill what
     *     was produced rather than what was allowed — so a ceiling nobody reaches costs nothing,
     *     in latency or in money. A ceiling somebody *does* reach costs the whole turn.
     *
     * So the cap is now set to be unreachable in normal use rather than to shape the reply. The
     * relative shaping is kept, because it is free and it is a second signal in the same
     * direction — it just no longer has an absolute value low enough to be hit.
     *
     * ## And why the old numbers were lethal rather than merely tight
     *
     * A reasoning model spends its thinking against the same allowance. `free-best` on OllaBridge
     * routes to one, so the first 144 tokens went to reasoning and the visible reply began after
     * the cap. That is not a slightly short answer; it is no answer, and it is invisible unless
     * something reads `finish_reason` — which is why `EmptyCompletionError` now does.
     *
     * `MIN` is the floor, and it exists so that a later edit optimising for brevity cannot
     * reintroduce this. Brevity belongs in the prompt. Nothing here may go below it.
     *
     * AX18c. 256 was still reachable. Measured on 2026-11-12 once Private's prompt actually reached
     * the model (AX18b): gpt-oss replies on OllaBridge were cut at "It makes me feel like you
     * really" and "It makes", and two turns came back empty after 30 s — the reasoning had spent
     * the allowance (AX8 recorded 442 reasoning tokens on a single reply). The ceilings are now
     * well above that; the length is held by the prompt and by `TogetherCapability`'s shaping
     * (whole sentences only, at most the turn's limit), never by cutting her off.
     */
    const MIN = 640;

    const BUDGET = Object.freeze({
        affirmation: MIN,
        conversation: 768,
        quiet: MIN,
        preference: 704,
        'pace-down': MIN,
        'pace-up-request': 704,
        // AX21. A scene they asked for may run to six sentences from step 3 (see
        // PrivateExperienceProfile.maxSentences); the same room a plain request already has.
        'scene-request': 1024,
        'music-request': MIN,
        end: MIN,
        question: 896,
        request: 1024,
    });

    /**
     * A little less when the person said almost nothing — and never below `MIN`.
     *
     * The shaping survives the P19 correction; the cliff does not. "Mirror them rather than
     * lecture" is the prompt's job, and `privateLengthLines` does it in words the model reads.
     */
    function budgetFor(turn) {
        const base = BUDGET[turn && turn.intent] || BUDGET.conversation;
        if (!turn) return base;
        if (turn.length === 'tiny') return Math.max(MIN, Math.min(base, MIN));
        if (turn.length === 'short') return Math.max(MIN, Math.min(base, 704));
        return Math.max(MIN, base);
    }

    const api = { INTENTS, STYLES, BUDGET, MIN, PACKS, classify, styleFor, budgetFor, normalise, lengthOf };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_TURN_DIRECTOR = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
