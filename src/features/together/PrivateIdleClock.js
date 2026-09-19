/**
 * Somebody who notices that you have gone quiet (P17).
 *
 * Private waits. That is the whole of its behaviour when nothing is typed: the scripted beats fire
 * at 45 s, 210 s and 330 s and otherwise the card is a still picture of somebody who has stopped
 * existing between your sentences. A person you are in a room with does not do that, and the
 * difference between a chat window and a scene is exactly this — one of you is still there when
 * neither of you is talking.
 *
 * ```text
 *   stage 0   live — anything the user does comes back here
 *     60 s ─▶ stage 1   one line that notices the quiet (never "are you still there?")
 *    120 s ─▶ stage 2   two or three local buttons. No model call.
 *    180 s ─▶ stage 3   ambient only. Nothing more is said until the user acts.
 * ```
 *
 * ## The timer advances liveness, never intimacy
 *
 * The single rule this module exists to make structurally true. Nothing here returns a level, a
 * consent state or an escalation; the stages carry no intensity and the runtime's idle handlers
 * are forbidden from reaching `ConsentFlow.initiated`. Silence is not consent, and a companion that
 * gets closer because you stopped typing is the failure mode the whole Private design is arranged
 * against. A person who says nothing for three minutes gets attention, not pressure.
 *
 * ## Why the clock does not simply count
 *
 * `busy` does not pause the clock, it *moves the start*. Anything that means somebody is mid-turn —
 * a generation in flight, her voice still playing, a half-typed line in the composer — resets the
 * quiet to zero rather than freezing it, because the silence that matters begins when the last of
 * those ends. Freezing it would make a reply that took forty seconds to arrive count as forty
 * seconds of somebody ignoring her.
 *
 * Wall-clock, never accumulated `setTimeout`s, for the reason `_beat` already documents: a hidden
 * tab has its timers clamped to roughly one a minute and may freeze them outright, so a session
 * that was away comes back and works out where it should be rather than replaying a backlog.
 *
 * ## Deliberately a state machine and nothing else
 *
 * No timers, no DOM, no `win`. It is handed a clock reading and a busy answer and says which stage
 * was entered, which is the half worth testing — the busy predicate is the risky half and it lives
 * in `TogetherCapability`, where the things it must ask are.
 *
 * Exposes: window.NEXUS_PRIVATE_IDLE_CLOCK
 */
(function (global) {
    'use strict';

    /**
     * When each stage opens, measured from the last thing that happened.
     *
     * A minute is long enough that it is unmistakably a silence rather than somebody thinking, and
     * short enough that nobody concludes the feature is finished with them. The second minute is
     * the same interval again on purpose: a stage that arrived faster than the one before would
     * read as impatience, which is the one thing this must never read as.
     */
    const STAGES = Object.freeze([
        Object.freeze({ stage: 1, after: 60000 }),
        Object.freeze({ stage: 2, after: 120000 }),
        Object.freeze({ stage: 3, after: 180000 }),
    ]);

    const LAST_STAGE = STAGES[STAGES.length - 1].stage;

    /**
     * What she says when she notices, and what she does not.
     *
     * The written floor. `docs/PRIVATE_LIVE_SCENE.md` §6.2 has these generated per-scene by the
     * story director; until that exists these are what stage 1 has, and they are written to be good
     * enough on their own — the same rule `PrivateBeats.POOLS` is written to.
     *
     * Every one of them is a story beat that happens to acknowledge quiet. None of them asks a
     * question, and that is the constraint, not a coincidence: a line that ends in a question mark
     * turns a silence into something the person now owes an answer to, which is pressure applied by
     * a stopwatch. `BANNED` is the floor under that — "are you still there?" is a system prompt
     * wearing her voice, and it tells the person they are using software at the exact moment the
     * feature is asking them to forget it.
     */
    const NOTICING = Object.freeze([
        'You have gone quiet. I do not mind it.',
        'I like this part, where neither of us is filling the room.',
        'Still here. Not waiting for anything in particular.',
        'The quiet suits us. I am not in a hurry to end it.',
        'I was just listening to the room for a moment.',
    ]);

    /**
     * And the line that lets an unanswered question go.
     *
     * `PrivateNovelty`'s ignored-question rule already stops the script asking a second thing while
     * the first is unanswered. This is the other half: if she asked and got silence, the kind thing
     * is to take the question back rather than to leave it standing.
     */
    const RELEASING = Object.freeze([
        'You do not have to answer that. I was only curious.',
        'Never mind the question. It was not important.',
        'Leave that one. I would rather have the quiet than the answer.',
    ]);

    /**
     * What a noticing line may never be.
     *
     * Not a safety list — a fantasy one, which is why it lives here rather than beside
     * `PrivateBeats.BANNED`. "Are you still there?" is the sentence a support widget says. It is
     * correct, it is harmless, and it ends the scene.
     */
    const BANNED = Object.freeze([
        /\bare you (?:still )?(?:there|here)\b/i,
        /\bstill (?:there|with me|awake)\b/i,
        /\bhello\?/i,
        /\bdid you (?:go|leave)\b/i,
        /\bsession\b/i,
        /\btimed? out\b/i,
        // A question mark is the tell. A noticing line that asks something has turned a silence
        // into a debt, which is the opposite of what a stage that exists to relieve pressure does.
        /\?/,
    ]);

    /** Is this usable as a line that notices quiet? Returns it, or null. Never a repaired one. */
    function usable(line) {
        const text = String(line == null ? '' : line)
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return null;
        for (const pattern of BANNED) {
            if (pattern.test(text)) return null;
        }
        return text;
    }

    /** A fresh clock, live, with the quiet starting now. */
    function create(at) {
        const now = Number(at) || 0;
        return { stage: 0, since: now, enteredAt: 0 };
    }

    /**
     * Something happened. Back to stage 0.
     *
     * Every route in — a typed line, a tap, a reply landing, her voice finishing — goes through
     * here, so there is one definition of "the silence starts now" rather than one per caller.
     */
    function active(state, at) {
        if (!state) return state;
        state.stage = 0;
        state.since = Number(at) || 0;
        state.enteredAt = 0;
        return state;
    }

    /** How long it has been quiet, in the clock's own units. */
    function quietFor(state, at) {
        if (!state) return 0;
        return Math.max(0, (Number(at) || 0) - (Number(state.since) || 0));
    }

    /**
     * Move the clock, and say which stage was *entered* — 0 for "nothing new".
     *
     * At most one stage per call, however long the gap: a tab that was hidden for ten minutes
     * should arrive at somebody who noticed the quiet, not replay three stages into the same
     * second. The next call takes the next one, which for a session that has genuinely been away
     * that long is the right pace anyway.
     *
     * `scale` exists for the tests, and for the same reason the rest of the session has a
     * `timingScale`: a test that has to wait a real minute is a test nobody runs.
     */
    function tick(state, { at, busy = false, scale = 1 } = {}) {
        if (!state) return 0;
        const now = Number(at) || 0;
        if (busy) {
            // Not a pause — a reset. The silence that matters starts when the last thing anybody
            // was doing ends. See the header.
            active(state, now);
            return 0;
        }
        if (state.stage >= LAST_STAGE) return 0;
        const factor = Number(scale) > 0 ? Number(scale) : 1;
        const quiet = quietFor(state, now);
        for (const step of STAGES) {
            if (step.stage <= state.stage) continue;
            if (quiet < step.after * factor) return 0;
            state.stage = step.stage;
            state.enteredAt = now;
            return step.stage;
        }
        return 0;
    }

    /**
     * When the next stage could open, as a delay from `at`, or null when there is none left.
     *
     * For arming a timer. Never negative and never zero: a due-but-blocked stage that returned 0
     * would arm a zero-delay timer that fired, found itself blocked, and armed another — the busy
     * loop `_armBeats` grew its one-second floor to prevent.
     */
    function nextIn(state, { at, scale = 1, floor = 1000 } = {}) {
        if (!state || state.stage >= LAST_STAGE) return null;
        const factor = Number(scale) > 0 ? Number(scale) : 1;
        const quiet = quietFor(state, Number(at) || 0);
        for (const step of STAGES) {
            if (step.stage <= state.stage) continue;
            return Math.max(floor, step.after * factor - quiet);
        }
        return null;
    }

    function describe(state, at) {
        const stage = state ? state.stage : 0;
        return {
            stage,
            quietMs: quietFor(state, at),
            /** Stage 3 says nothing more, ever, until the person acts. */
            done: stage >= LAST_STAGE,
        };
    }

    const api = {
        STAGES,
        LAST_STAGE,
        NOTICING,
        RELEASING,
        BANNED,
        usable,
        create,
        active,
        tick,
        nextIn,
        quietFor,
        describe,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_IDLE_CLOCK = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
