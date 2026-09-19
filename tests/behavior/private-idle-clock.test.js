/* global describe, test, expect */

/**
 * P17 — somebody who notices that you have gone quiet.
 *
 * Two halves, tested separately because only one of them is risky. The state machine is arithmetic
 * and belongs in a pure test; the busy predicate is the whole of the risk and is exercised through
 * a real session in `private-liveness-stages.test.js`.
 */

const IdleClock = require('../../src/features/together/PrivateIdleClock.js');
const PrivateChoices = require('../../src/features/together/PrivateChoices.js');

describe('PrivateIdleClock', () => {
    test('the stages open a minute apart, one per tick', () => {
        const state = IdleClock.create(0);
        expect(IdleClock.tick(state, { at: 59999 })).toBe(0);
        expect(IdleClock.tick(state, { at: 60000 })).toBe(1);
        expect(IdleClock.tick(state, { at: 60001 })).toBe(0);
        expect(IdleClock.tick(state, { at: 120000 })).toBe(2);
        expect(IdleClock.tick(state, { at: 180000 })).toBe(3);
    });

    test('there is no fourth stage, however long the silence', () => {
        // The point of the last one is that it is the last one. A companion still producing lines
        // into an empty room is a notification, and the person has made it clear they are not
        // reading.
        const state = IdleClock.create(0);
        for (const at of [60000, 120000, 180000]) IdleClock.tick(state, { at });
        expect(IdleClock.tick(state, { at: 600000 })).toBe(0);
        expect(IdleClock.tick(state, { at: 3600000 })).toBe(0);
        expect(IdleClock.describe(state, 3600000).done).toBe(true);
    });

    test('a tab that was hidden for ten minutes comes back one stage at a time', () => {
        // The same rule the beats have: returning should be a sentence, not the backlog.
        const state = IdleClock.create(0);
        expect(IdleClock.tick(state, { at: 600000 })).toBe(1);
        expect(IdleClock.tick(state, { at: 600001 })).toBe(2);
        expect(IdleClock.tick(state, { at: 600002 })).toBe(3);
    });

    test('anything the user does comes back to stage 0', () => {
        const state = IdleClock.create(0);
        IdleClock.tick(state, { at: 60000 });
        IdleClock.tick(state, { at: 120000 });
        expect(state.stage).toBe(2);
        IdleClock.active(state, 130000);
        expect(state.stage).toBe(0);
        expect(IdleClock.tick(state, { at: 189000 })).toBe(0);
        expect(IdleClock.tick(state, { at: 190000 })).toBe(1);
    });

    test('busy does not pause the clock, it moves the start', () => {
        // Freezing it would make a reply that took forty seconds to arrive count as forty seconds
        // of somebody ignoring her. The silence that matters begins when the last thing anybody was
        // doing ends.
        const state = IdleClock.create(0);
        expect(IdleClock.tick(state, { at: 59000, busy: true })).toBe(0);
        expect(IdleClock.tick(state, { at: 60000 })).toBe(0);
        expect(IdleClock.tick(state, { at: 119000 })).toBe(1);
    });

    test('nextIn never returns zero, so a due-but-blocked stage cannot spin a timer', () => {
        const state = IdleClock.create(0);
        expect(IdleClock.nextIn(state, { at: 0 })).toBe(60000);
        expect(IdleClock.nextIn(state, { at: 59000 })).toBe(1000);
        // Past due, still floored — the busy loop `_armBeats` grew its own floor to prevent.
        expect(IdleClock.nextIn(state, { at: 90000 })).toBe(1000);
        for (const at of [60000, 120000, 180000]) IdleClock.tick(state, { at });
        expect(IdleClock.nextIn(state, { at: 200000 })).toBeNull();
    });

    test('the scale multiplies the thresholds, so a test need not wait a real minute', () => {
        const state = IdleClock.create(0);
        expect(IdleClock.tick(state, { at: 6000, scale: 0.1 })).toBe(1);
    });

    test('nothing here returns a level, a consent state or an escalation', () => {
        // The rule the module exists to make structurally true: the timer advances liveness, never
        // intimacy. Stated as a shape rather than as a promise in a comment.
        const state = IdleClock.create(0);
        IdleClock.tick(state, { at: 180000 });
        expect(Object.keys(state).sort()).toEqual(['enteredAt', 'since', 'stage']);
        const described = IdleClock.describe(state, 180000);
        expect(Object.keys(described).sort()).toEqual(['done', 'quietMs', 'stage']);
    });
});

describe('what she is allowed to say about a silence', () => {
    test('never "are you still there?", in any of its forms', () => {
        // System language destroys the fantasy, and it does it at the exact moment the feature is
        // asking somebody to forget they are using software.
        for (const line of [
            'Are you still there?',
            'are you there',
            'Still there?',
            'Hello? Anyone?',
            'Did you leave?',
            'Your session timed out.',
        ]) {
            expect(IdleClock.usable(line)).toBeNull();
        }
    });

    test('and never a question, because a question turns a silence into a debt', () => {
        expect(IdleClock.usable('What are you thinking about?')).toBeNull();
        expect(IdleClock.usable('I like this quiet.')).toBe('I like this quiet.');
    });

    test('every written line passes its own rules', () => {
        for (const line of [...IdleClock.NOTICING, ...IdleClock.RELEASING]) {
            expect(IdleClock.usable(line)).toBe(line);
        }
    });

    test('there are enough of them that a long evening does not repeat itself', () => {
        // `_speak` refuses a line it has already said this session, so a one-line pool would mean
        // one nudge per evening and then silence.
        expect(IdleClock.NOTICING.length).toBeGreaterThanOrEqual(3);
        expect(IdleClock.RELEASING.length).toBeGreaterThanOrEqual(2);
        expect(new Set(IdleClock.NOTICING).size).toBe(IdleClock.NOTICING.length);
    });
});

describe('the buttons stage 2 puts up', () => {
    test('are local, few, and hand the next move back to her', () => {
        const choices = PrivateChoices.idle();
        expect(choices.length).toBeGreaterThanOrEqual(2);
        expect(choices.length).toBeLessThanOrEqual(PrivateChoices.MAX);
        for (const line of choices) expect(PrivateChoices.usable(line)).toBe(line);
    });

    test('and never include "stay quiet", because they already are', () => {
        expect(PrivateChoices.idle().some((line) => PrivateChoices.isQuiet(line))).toBe(false);
    });

    test('nor anything that asks for more than they have', () => {
        // A silence is not a request. An idle button reading "closer" would be a stopwatch putting
        // an escalation in somebody's mouth, which is the one thing `ConsentFlow` cannot check for.
        for (const line of PrivateChoices.idle()) {
            expect(line.toLowerCase()).not.toMatch(/closer|more|further|intense/);
        }
    });
});
