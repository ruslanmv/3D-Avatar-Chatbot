/**
 * Show me choices, start it now, or that one (batch M4).
 *
 * Three transcripts, all real, all the same underlying mistake — one intent where there are
 * three.
 *
 *     YOU    play music please
 *     NEXUS  Here's what I found for “music”. Press play on one, or Watch in VR.
 *            → five unrelated videos, nothing playing
 *
 * "Play" was in the same verb list as "find", so a request to *start something* was answered
 * with a catalogue and four extra steps.
 *
 *     YOU    play the fist song of the list
 *     NEXUS  Here's what I found for “fist song of the list”.
 *            → five videos about first songs
 *
 * Worse, and more revealing: the sentence refers to results already on screen, and it was
 * parsed as a fresh search query. The app had the list — `MediaSession` holds it precisely so
 * "the first one" can mean something — and asked YouTube for the words instead.
 *
 * ## The rule
 *
 *   **discover** — "find", "search for", "show me" → give me choices, list them
 *   **execute**  — "play", "put on", "start", "execute", "reproduce" → choose one and start it
 *   **reference** — "the first one", "number three", "that one" → the thing we already found
 *
 * References are resolved **first**, before anything looks like a query. That ordering is the
 * whole fix for the second transcript: "the fist song of the list" only becomes search terms
 * if nothing recognises it as a pointer, and by then the damage is done.
 *
 * ## Why `fist` is in the pattern
 *
 * Deliberately. It is what the user typed, and it is what dictation produces. A parser that
 * is right about English and wrong about the sentence in front of it has failed at its job.
 * The cost of accepting it is nil — "fist" is not a word anyone types at a media player
 * meaning anything else.
 *
 * Exposes: window.NEXUS_MEDIA_COMMAND
 */
(function (global) {
    'use strict';

    /** Ordinals people actually use, including the ones dictation produces. */
    const ORDINALS = [
        [/\b(?:first|1st|fist|firts)\b/i, 0],
        [/\b(?:second|2nd|secound)\b/i, 1],
        [/\b(?:third|3rd)\b/i, 2],
        [/\b(?:fourth|4th)\b/i, 3],
        [/\b(?:fifth|5th)\b/i, 4],
        [/\b(?:last|final)\b/i, -1],
    ];

    /** "number three", "result 2", "song 4" — a position said as a digit. */
    const NUMBERED = /\b(?:number|result|option|song|track|video|one)\s*(?:#\s*)?(\d{1,2})\b/i;

    /**
     * A pointer needs something to point *at*.
     *
     * Without this, "play the first song by Queen" would be read as "results[0]" — the word
     * "first" is doing a different job there. Requiring a word that refers to the set, or a
     * bare pointer with nothing else in the sentence, keeps the two apart.
     */
    const THE_SET = /\b(?:list|results?|these|those|them|ones?|above|you found|you showed)\b/i;

    /** Bare pointers: the whole message is the reference. */
    const BARE =
        /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:play|start|put on)?\s*(?:the\s+)?(?:first|1st|fist|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s*(?:one|song|track|video)?\s*(?:please)?[.!]?$/i;

    /** Verbs that mean *start it now*. */
    const EXECUTE =
        /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:play|put on|start|queue up|execute|reproduce|listen to)\b/i;

    /** Verbs that mean *give me choices*. */
    const DISCOVER =
        /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:find|search|search for|look for|look up|show me|list|browse|suggest|recommend)\b/i;

    /**
     * Which position in the held results this message points at, or `null`.
     *
     * `-1` means the last one, which is why the caller must resolve against the list length
     * rather than treating the number as an index directly.
     */
    function referenceIndex(text) {
        const t = String(text === null || text === undefined ? '' : text).trim();
        if (!t) {
            return null;
        }
        const bare = BARE.test(t);
        if (!bare && !THE_SET.test(t)) {
            return null;
        }
        const numbered = NUMBERED.exec(t);
        if (numbered) {
            const n = Number(numbered[1]);
            return n >= 1 ? n - 1 : null;
        }
        for (const [re, index] of ORDINALS) {
            if (re.test(t)) {
                return index;
            }
        }
        return null;
    }

    /**
     * The result this message points at, out of what is actually held.
     *
     * `null` when nothing is held — which is the honest answer, and lets the caller fall
     * through to an ordinary search rather than inventing a selection.
     */
    function resolve(text, { session = null } = {}) {
        const index = referenceIndex(text);
        if (index === null) {
            return null;
        }
        const s = session || (global && global.NEXUS_MEDIA_SESSION) || null;
        if (!s || typeof s.results !== 'function') {
            return null;
        }
        let held = [];
        try {
            held = s.results() || [];
        } catch (_) {
            return null;
        }
        if (!held.length) {
            return null;
        }
        const at = index < 0 ? held.length + index : index;
        if (at < 0 || at >= held.length) {
            return null;
        }
        return { result: held[at], index: at };
    }

    /**
     * `'execute'`, `'discover'` or `null`.
     *
     * `null` is not a failure: it means this is ordinary conversation, or a phrasing no verb
     * list will ever cover, and both belong to the model. The lists here are for the cases
     * where the intent is unmistakable and a round trip would only add latency.
     */
    function action(text) {
        const t = String(text === null || text === undefined ? '' : text).trim();
        if (!t) {
            return null;
        }
        // Discover is tested first, because "search for" and "look for" would otherwise never
        // be reached — "look" is not in EXECUTE, but a future edit adding it would silently
        // turn every search into a play.
        if (DISCOVER.test(t)) {
            return 'discover';
        }
        if (EXECUTE.test(t)) {
            return 'execute';
        }
        return null;
    }

    const api = { ORDINALS, NUMBERED, THE_SET, BARE, EXECUTE, DISCOVER, referenceIndex, resolve, action };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_MEDIA_COMMAND = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
