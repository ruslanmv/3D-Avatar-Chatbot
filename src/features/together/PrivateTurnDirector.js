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
     * The two that outrank everything, in the order they are checked.
     *
     * `ConsentFlow` already owns `stop` and `exit` as hard-exit words and `cozy` as the soft
     * one; these are the same idea reached through ordinary phrasing, and they are first so that
     * no amount of surrounding sentence can outvote them.
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
    function classify(raw) {
        const text = normalise(raw);
        if (!text) return shape('conversation', text);

        // Safety words first, and unconditionally. See the header.
        if (any(END, text)) return shape('end', text);
        if (any(PACE_DOWN, text)) return shape('pace-down', text);

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
     * How many tokens her answer is worth.
     *
     * The OllaBridge path asks for 800 on every turn, which for `So` is a hundred and fifty
     * words of reply nobody wanted and several seconds of waiting for them. A budget is not a
     * substitute for telling the model to be brief, and telling the model is not a substitute
     * for a budget: prompts are a request and `max_tokens` is a rule.
     */
    const BUDGET = Object.freeze({
        affirmation: 48,
        conversation: 96,
        quiet: 48,
        preference: 72,
        'pace-down': 48,
        'pace-up-request': 72,
        'scene-request': 72,
        'music-request': 48,
        end: 48,
        question: 120,
        request: 140,
    });

    /** Shorter still when the person said almost nothing: mirror them rather than lecture. */
    function budgetFor(turn) {
        const base = BUDGET[turn && turn.intent] || BUDGET.conversation;
        if (!turn) return base;
        if (turn.length === 'tiny') return Math.min(base, 48);
        if (turn.length === 'short') return Math.min(base, 96);
        return base;
    }

    const api = { INTENTS, STYLES, BUDGET, classify, styleFor, budgetFor, normalise, lengthOf };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_TURN_DIRECTOR = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
