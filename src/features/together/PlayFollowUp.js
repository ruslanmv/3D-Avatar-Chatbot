/**
 * "yes" and "can you play it" mean something (batch T6).
 *
 * The transcript that started this work has three turns, and the pattern matcher can only ever
 * fix the first:
 *
 *     YOU  can you find music about relaxation   ← T4 catches this
 *     YOU  yes                                   ← nothing to match
 *     YOU  can you play it                       ← "it" has no referent
 *
 * A pattern is a function of one message. The second and third turns are only requests *given
 * the first one*, so no amount of widening the patterns can reach them — what is missing is not
 * vocabulary, it is a memory one turn deep.
 *
 * ## What it remembers, and what it does not
 *
 * It remembers the **topic**, taken from a message the user actually typed — "music about
 * relaxation" — and never anything the assistant suggested. That distinction matters: a model
 * that offered five genres has not been chosen from, and playing the first one because somebody
 * said "yes" would be putting words in their mouth.
 *
 * It expires after two user turns. Long enough for "yes" and then "can you play it", short
 * enough that a "yes" to something else entirely, five minutes later, plays nothing. And it is
 * cleared the moment something plays, so one topic can never be fulfilled twice.
 *
 * ## Why the affirmative list is short
 *
 * "yes", "yeah", "ok", "sure", "please do", "go on", "do it", "play it". Every one of them is a
 * word whose only meaning in this position is agreement. Words that *could* be agreement and
 * could be something else — "right", "fine", "well" — are left out, because a false positive
 * here starts playing music at somebody in the middle of a sentence.
 *
 * Exposes: window.NEXUS_PLAY_FOLLOWUP
 */
(function (global) {
    'use strict';

    /** How many user turns a remembered topic survives. */
    const TURNS = 2;

    /** Nouns that make a message about media. Shared shape with the intent matcher's list. */
    const MEDIA =
        /\b(song|songs|music|track|tune|album|playlist|video|videos|mix|radio|podcast|beats|ost|soundtrack)\b/i;

    /**
     * Bare agreement, and the pronoun forms that point at the last thing discussed.
     *
     * Anchored whole-message on purpose: "yes, but not that one" is not a yes to this.
     */
    const AFFIRM =
        /^(?:yes|yeah|yep|yup|ok|okay|sure|please|please do|go on|go ahead|do it|that one|sounds good|why not)[.!]?$/i;
    const PRONOUN_PLAY =
        /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:play|put on|start)\s+(?:it|that|them|those|this)[.!]?$/i;

    /** Words that are the request, not part of the topic. */
    const TRIM = /^(?:some|the|a|an|me|for|about)\s+|\s+(?:please|now|for me)[.!]?$/gi;

    let pending = null;

    /**
     * Note a user message. Remembers a topic when the message is about media, and ages out any
     * topic already held.
     *
     * Called for every user message, including ones the pattern matcher already handled — those
     * clear the memory rather than set it, because something is about to play and a follow-up
     * "yes" would then start a second thing.
     */
    function note(text, { handled = false } = {}) {
        const raw = String(text || '').trim();
        if (handled) {
            pending = null;
            return null;
        }
        if (!raw) {
            return pending;
        }

        // An affirmative or a pronoun does not become the new topic — it points at the old one.
        if (AFFIRM.test(raw) || PRONOUN_PLAY.test(raw)) {
            return pending;
        }

        if (MEDIA.test(raw)) {
            pending = { topic: topicOf(raw), turns: TURNS, kind: kindOf(raw) };
            return pending;
        }

        if (pending) {
            pending.turns -= 1;
            if (pending.turns <= 0) {
                pending = null;
            }
        }
        return pending;
    }

    /** `music` when the message named audio, `video` otherwise. */
    function kindOf(raw) {
        return /\b(song|songs|music|track|tune|album|playlist|mix|radio|beats|ost|soundtrack)\b/i.test(raw)
            ? 'music'
            : 'video';
    }

    /**
     * The searchable part of a message.
     *
     * Everything up to and including the play verb is dropped, so "can you find music about
     * relaxation" remembers "music about relaxation" rather than the whole sentence — a query
     * containing "can you find" returns videos titled *can you find*.
     */
    function topicOf(raw) {
        const withoutLead = raw
            .replace(/^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?/i, '')
            .replace(
                /^(?:play|put on|start|queue up|find me|find|search for|look for|get me|suggest|recommend)\s+/i,
                ''
            )
            .replace(/\?+$/, '')
            .trim();
        return withoutLead.replace(TRIM, '').trim() || raw;
    }

    /**
     * What to play for this message, or `null`.
     *
     * Only ever returns something when the message is *nothing but* agreement or a pronoun and
     * a topic is held. Anything with content of its own is the pattern matcher's or the
     * model's, not this.
     */
    function resolve(text) {
        const raw = String(text || '').trim();
        if (!pending || !raw) {
            return null;
        }
        if (!AFFIRM.test(raw) && !PRONOUN_PLAY.test(raw)) {
            return null;
        }
        return { query: pending.topic, kind: pending.kind, source: 'follow-up' };
    }

    /** Called when something plays, so one topic is never fulfilled twice. */
    function clear() {
        pending = null;
    }

    function peek() {
        return pending ? { ...pending } : null;
    }

    const api = { TURNS, AFFIRM, PRONOUN_PLAY, note, resolve, clear, peek, topicOf, kindOf };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_PLAY_FOLLOWUP = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
