/**
 * Do not say that again (P11).
 *
 * Six identical "We are already as gentle as this gets." was one symptom with one cause, and the
 * cause is fixed at the button. But the class of defect is larger than the button: a five-minute
 * script with four fixed beats has no memory of what it has already offered, so *any* path that
 * can fire twice reads as a loop. Quieter-or-closer twice in a session is the same failure with
 * better manners.
 *
 * So the session keeps a ledger, and every guided interaction asks it first.
 *
 * ```text
 *   canUse('texture-choice')  ─▶  false  (offered ninety seconds ago)
 *   canUse('curiosity')       ─▶  true
 *                                   │
 *                              use('curiosity', { line })
 * ```
 *
 * ## Deterministic, deliberately
 *
 * Not an LLM judging whether it is repeating itself. A model asked "is this repetitive?" is a model
 * that will sometimes say no, and the failure it is meant to catch is exactly the one where it has
 * lost track. Exact-line memory and a turn-counted family cooldown are boring and they cannot be
 * talked out of it.
 *
 * ## Why families rather than lines
 *
 * Suppressing repeated *lines* would let the same interaction come back with different wording,
 * which is the version of this bug that is harder to see and just as annoying. A family is the
 * shape of the interaction — a texture choice, a curiosity question, an invitation to be quiet —
 * and the cooldown is counted in conversational turns rather than seconds, because five turns of
 * talking is a lot of distance and five seconds is none.
 *
 * ## The ignored-question rule
 *
 * The one rule here that is about the person rather than about repetition: if she asked something
 * and they said something else, asking again immediately is worse than repetition. It is not
 * listening.
 *
 * The distinction that matters, and which the first version of this got wrong: a question is
 * *ignored* only once the person has taken a turn without answering it. A question merely sitting
 * on screen untapped is not ignored — nobody has done anything yet — and refusing every later
 * question on that basis stalls the whole arc behind a button nobody pressed.
 *
 *
 * Exposes: window.NEXUS_PRIVATE_NOVELTY
 */
(function (global) {
    'use strict';

    /**
     * The interaction families a session can draw on.
     *
     * A catalogue rather than a script: the existing beats are entries in it, so the ledger governs
     * what Private already does before it governs anything new. `once` families are the ones whose
     * whole value is being asked a single time.
     */
    const FAMILIES = Object.freeze({
        'mood-choice': Object.freeze({ cooldown: Infinity, question: true }),
        // Not once, and not on a cooldown from here: each check-in asks a *different* question —
        // level 2, then level 3 — and `ConsentFlow.perLevelMinMs` already refuses one that has not
        // been earned. A cooldown here would be a second, weaker gate in front of the real one, and
        // on Sensual it silently capped the session at level 2.
        'consent-checkin': Object.freeze({ cooldown: 0, question: true }),
        'texture-choice': Object.freeze({ cooldown: Infinity, question: true }),
        'quiet-invitation': Object.freeze({ cooldown: 6, question: true }),
        curiosity: Object.freeze({ cooldown: 5, question: true }),
        reflection: Object.freeze({ cooldown: 4, question: false }),
        'scene-note': Object.freeze({ cooldown: 6, question: false }),
        'music-note': Object.freeze({ cooldown: 6, question: false }),
        closing: Object.freeze({ cooldown: Infinity, question: false }),
        'safety-ack': Object.freeze({ cooldown: Infinity, question: false }),
    });

    /** The cooldown for a family nobody declared, in turns. Conservative on purpose. */
    const DEFAULT_COOLDOWN = 5;

    function create() {
        return {
            /** Every line said this session, so an exact repeat is impossible. */
            lines: new Set(),
            /** family → the turn count when it was last used. */
            families: new Map(),
            /** Turns taken by the person. The cooldown's unit. */
            turns: 0,
            /** A question she asked that nobody has answered yet. */
            pendingQuestion: null,
            /** The turn on which a question of hers was talked past. See the header. */
            ignoredAt: null,
        };
    }

    /**
     * How long a question of hers stays held back after being talked past.
     *
     * Exactly the turn it happened on: she answers what they actually said, and offers nothing of
     * her own until they have spoken again. "Immediately after" is the rule, and one turn is what
     * immediately means — any longer and a single missed button would mute her for the rest of the
     * evening, which is the failure this rule exists to prevent rather than cause.
     */
    const IGNORED_GRACE = 1;

    function normalise(value) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Count a turn the person took. The ledger's clock, and where "ignored" is decided.
     *
     * `answered` is the caller's judgement about whether this turn was a reply to the question she
     * had outstanding — a tapped button, or a turn the classifier read as a preference or an
     * agreement. Anything else, with a question outstanding, is the person talking past it, and that
     * is the one case the grace below exists for.
     */
    function noteTurn(state, { answered = false } = {}) {
        if (!state) return 0;
        state.turns += 1;
        if (state.pendingQuestion) {
            if (!answered) state.ignoredAt = state.turns;
            state.pendingQuestion = null;
        }
        return state.turns;
    }

    /**
     * She asked something. Nothing question-shaped may follow until it is answered or let go.
     *
     * `family` is remembered so a caller can tell *which* question is outstanding, which matters
     * for deciding whether a reply answered it at all.
     */
    function noteQuestion(state, family) {
        if (!state) return null;
        state.pendingQuestion = { family: family || null, atTurn: state.turns };
        return state.pendingQuestion;
    }

    /**
     * The question was answered, dismissed, or has been withdrawn.
     *
     * Clears `ignoredAt` as well: once she has been answered, whatever happened before it is no
     * longer a reason to hold back.
     */
    function noteAnswered(state) {
        if (!state) return false;
        const had = Boolean(state.pendingQuestion);
        state.pendingQuestion = null;
        state.ignoredAt = null;
        return had;
    }

    /**
     * Was this exact line already said this session?
     *
     * Exact after whitespace and case, which is the shape the reported repetition had: the same
     * string, six times. A near-miss is the family cooldown's job.
     */
    function saidAlready(state, line) {
        const key = normalise(line);
        if (!state || !key) return false;
        return state.lines.has(key);
    }

    /**
     * Remember a line without claiming an interaction family.
     *
     * For the backstop in `_speak`: every scripted line is recorded so an exact repeat becomes
     * impossible whatever route produced it, but a line is not an interaction and recording it
     * through `use` would put a meaningless family in the cooldown map.
     */
    function noteLine(state, line) {
        const key = normalise(line);
        if (!state || !key) return false;
        state.lines.add(key);
        return true;
    }

    /**
     * May this interaction run now?
     *
     * Returns a reason rather than a bare boolean, because the reason is what a caller logs and
     * what a test asserts on — "it did not happen" is indistinguishable from a bug otherwise.
     */
    function canUse(state, family, { line = '' } = {}) {
        if (!state) return { ok: true, why: 'no ledger' };
        const spec = FAMILIES[family] || { cooldown: DEFAULT_COOLDOWN, question: false };

        if (line && saidAlready(state, line)) return { ok: false, why: 'said already' };

        // Being talked past outranks the cooldowns. Asking a second thing when the first was ignored
        // is not repetition, it is not listening. Bounded: see `IGNORED_GRACE`.
        if (spec.question && state.ignoredAt !== null && state.turns - state.ignoredAt < IGNORED_GRACE) {
            return { ok: false, why: 'the last question was talked past' };
        }

        const last = state.families.get(family);
        if (last === undefined) return { ok: true, why: 'first time' };
        if (spec.cooldown === Infinity) return { ok: false, why: 'once per session' };
        if (state.turns - last < spec.cooldown) return { ok: false, why: 'too soon' };
        return { ok: true, why: 'cooled down' };
    }

    /**
     * Record that it ran. Always called, even when the line was empty.
     *
     * Recording the family is what makes the cooldown real; recording the line is what makes an
     * exact repeat impossible. A caller that checks `canUse` and forgets this gets no protection at
     * all, which is why the two are named as a pair.
     */
    function use(state, family, { line = '' } = {}) {
        if (!state) return false;
        state.families.set(family, state.turns);
        const key = normalise(line);
        if (key) state.lines.add(key);
        const spec = FAMILIES[family] || { question: false };
        if (spec.question) noteQuestion(state, family);
        return true;
    }

    /** Families that have never run, in declaration order. What a session still has to offer. */
    function unused(state) {
        return Object.keys(FAMILIES).filter((name) => !state || !state.families.has(name));
    }

    const api = {
        FAMILIES,
        DEFAULT_COOLDOWN,
        IGNORED_GRACE,
        create,
        canUse,
        use,
        noteLine,
        saidAlready,
        noteTurn,
        noteQuestion,
        noteAnswered,
        unused,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_NOVELTY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
