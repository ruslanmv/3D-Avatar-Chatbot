/**
 * Do not say that again (P11).
 *
 * Six identical lines was one symptom of a larger shape: a script with no memory of what it has
 * already offered, so *any* path that can fire twice reads as a loop. The ledger is deliberately
 * dull — exact-line memory plus a turn-counted family cooldown — because the alternative is asking
 * a model whether it is repeating itself, and a model that has lost track is exactly the one that
 * will say no.
 *
 * The rule most worth testing is the one this got wrong first time: a question is *ignored* only
 * once somebody has taken a turn without answering it. A question sitting on screen untapped is
 * nobody ignoring anything, and refusing every later question on that basis stalled the whole arc
 * behind a button nobody pressed.
 */

/* global describe, test, expect */

const Novelty = require('../../src/features/together/PrivateNovelty.js');

const ok = (state, family, line) => Novelty.canUse(state, family, { line }).ok;
const why = (state, family, line) => Novelty.canUse(state, family, { line }).why;

describe('an exact line is never said twice', () => {
    test('the reported shape, refused', () => {
        const s = Novelty.create();
        const line = 'We are already as gentle as this gets.';
        expect(ok(s, 'safety-ack', line)).toBe(true);
        Novelty.use(s, 'safety-ack', { line });
        expect(ok(s, 'safety-ack', line)).toBe(false);
        expect(why(s, 'safety-ack', line)).toBe('said already');
    });

    test('whitespace and case are not a new line', () => {
        const s = Novelty.create();
        Novelty.noteLine(s, 'I like the quiet.');
        expect(Novelty.saidAlready(s, '  i   like the quiet.  ')).toBe(true);
    });

    test('a line recorded without a family does not start a cooldown', () => {
        // `_speak`'s backstop records every scripted line. Recording it as an interaction would put
        // a meaningless family in the cooldown map and suppress real ones.
        const s = Novelty.create();
        Novelty.noteLine(s, 'anything');
        expect(s.families.size).toBe(0);
    });

    test('an empty line is not remembered as one', () => {
        const s = Novelty.create();
        expect(Novelty.noteLine(s, '')).toBe(false);
        expect(Novelty.saidAlready(s, '')).toBe(false);
    });
});

describe('a family cools down in turns, not seconds', () => {
    test('once-per-session families are once', () => {
        const s = Novelty.create();
        Novelty.use(s, 'texture-choice');
        for (let i = 0; i < 20; i += 1) Novelty.noteTurn(s);
        expect(ok(s, 'texture-choice')).toBe(false);
        expect(why(s, 'texture-choice')).toBe('once per session');
    });

    test('a cooled family comes back, and not before', () => {
        const s = Novelty.create();
        Novelty.use(s, 'reflection');
        expect(why(s, 'reflection')).toBe('too soon');
        for (let i = 0; i < 3; i += 1) Novelty.noteTurn(s);
        expect(ok(s, 'reflection')).toBe(false);
        Novelty.noteTurn(s);
        expect(ok(s, 'reflection')).toBe(true);
        expect(why(s, 'reflection')).toBe('cooled down');
    });

    test('time alone does not cool anything', () => {
        // Five turns of talking is real distance; five seconds is none, and a cooldown in seconds
        // would let the same interaction come back while the person was still reading it.
        const s = Novelty.create();
        Novelty.use(s, 'curiosity');
        expect(ok(s, 'curiosity')).toBe(false);
    });

    test('an undeclared family gets a conservative cooldown rather than a free pass', () => {
        const s = Novelty.create();
        Novelty.use(s, 'something-new');
        expect(ok(s, 'something-new')).toBe(false);
        for (let i = 0; i < Novelty.DEFAULT_COOLDOWN; i += 1) Novelty.noteTurn(s);
        expect(ok(s, 'something-new')).toBe(true);
    });

    test('a consent check-in is not rationed here, because ConsentFlow rations it', () => {
        // Each check-in asks a different question — level 2, then level 3 — and
        // `perLevelMinMs` already refuses one that has not been earned. A cooldown here would be a
        // second, weaker gate in front of the real one, and it silently capped Sensual at level 2.
        const s = Novelty.create();
        Novelty.use(s, 'consent-checkin');
        Novelty.noteAnswered(s);
        expect(ok(s, 'consent-checkin')).toBe(true);
    });

    test('the first use of anything is allowed', () => {
        const s = Novelty.create();
        for (const family of Object.keys(Novelty.FAMILIES)) {
            expect(Novelty.canUse(Novelty.create(), family).ok).toBe(true);
        }
        expect(why(s, 'curiosity')).toBe('first time');
    });
});

describe('the ignored-question rule', () => {
    test('a question nobody has touched does not block the next one', () => {
        // The bug in the first version of this file: the mood choice at 45 s set a pending
        // question, nobody tapped it, and the consent check-in at 120 s was refused — so the whole
        // arc stalled behind an untapped button.
        const s = Novelty.create();
        Novelty.use(s, 'mood-choice', { line: 'What kind of mood should we keep?' });
        expect(ok(s, 'consent-checkin')).toBe(true);
    });

    test('a question talked past holds the next one back, briefly', () => {
        const s = Novelty.create();
        Novelty.use(s, 'curiosity', { line: 'Can I ask you something?' });
        // They said something else entirely.
        Novelty.noteTurn(s, { answered: false });
        expect(ok(s, 'quiet-invitation')).toBe(false);
        expect(why(s, 'quiet-invitation')).toBe('the last question was talked past');

        // One more turn and she may offer again. Bounded, or a single missed button would mute her
        // for the rest of the evening.
        Novelty.noteTurn(s);
        expect(ok(s, 'quiet-invitation')).toBe(true);
    });

    test('a turn that answers it holds nothing back', () => {
        const s = Novelty.create();
        Novelty.use(s, 'curiosity', { line: 'Can I ask you something?' });
        Novelty.noteTurn(s, { answered: true });
        expect(ok(s, 'quiet-invitation')).toBe(true);
        expect(s.ignoredAt).toBeNull();
    });

    test('answering explicitly clears an earlier snub too', () => {
        const s = Novelty.create();
        Novelty.use(s, 'curiosity', { line: 'a question' });
        Novelty.noteTurn(s, { answered: false });
        expect(ok(s, 'quiet-invitation')).toBe(false);
        Novelty.noteAnswered(s);
        expect(ok(s, 'quiet-invitation')).toBe(true);
    });

    test('it only holds back questions, never a plain observation', () => {
        const s = Novelty.create();
        Novelty.use(s, 'curiosity', { line: 'a question' });
        Novelty.noteTurn(s, { answered: false });
        expect(ok(s, 'reflection')).toBe(true);
        expect(ok(s, 'scene-note')).toBe(true);
    });
});

describe('the ledger is optional and cannot break a session', () => {
    test('every call tolerates a missing ledger', () => {
        expect(Novelty.canUse(null, 'curiosity')).toEqual({ ok: true, why: 'no ledger' });
        expect(Novelty.use(null, 'curiosity')).toBe(false);
        expect(Novelty.noteTurn(null)).toBe(0);
        expect(Novelty.noteAnswered(null)).toBe(false);
        expect(Novelty.saidAlready(null, 'x')).toBe(false);
        expect(Novelty.noteLine(null, 'x')).toBe(false);
        expect(Novelty.unused(null)).toEqual(Object.keys(Novelty.FAMILIES));
    });

    test('what a session still has to offer shrinks as it is used', () => {
        const s = Novelty.create();
        const before = Novelty.unused(s).length;
        Novelty.use(s, 'curiosity');
        expect(Novelty.unused(s)).not.toContain('curiosity');
        expect(Novelty.unused(s)).toHaveLength(before - 1);
    });
});
