/**
 * Where the evening is, and one step in either direction (P12).
 *
 * P11 made the prominent footer control a de-escalation control and gave it a `softer()` that
 * dropped Sensual straight to Warm. Both were backwards. Private's emotional action is
 * progression — the person drives it forward, explicitly, a step at a time — and a control somebody
 * is steering with needs precision in both directions, not a cliff in one.
 *
 * `exit('soft')` still jumps to the bottom, because that is the right shape for a safe *word*. This
 * file is the dial, not the word.
 *
 * What these tests are really pinning is predictability: exactly one next state per direction, and
 * `changed: false` as a first-class answer meaning "narrate nothing" — which is what stops a control
 * that cannot act from producing a line saying so, six times.
 */

/* global describe, test, expect */

const Pace = require('../../src/features/together/PrivatePace.js');

const sensual = (level, energy = 'present') => ({ level, energy, maxLevel: 3 });

describe('forward, one step at a time', () => {
    test('a step raises the level by exactly one', () => {
        expect(Pace.stepUp(sensual(1)).level).toBe(2);
        expect(Pace.stepUp(sensual(2)).level).toBe(3);
    });

    test('never two at once, and never past the preset ceiling', () => {
        const romantic = { level: 1, energy: 'present', maxLevel: 2 };
        expect(Pace.stepUp(romantic).level).toBe(2);
        expect(Pace.stepUp({ ...romantic, level: 2 })).toEqual(
            expect.objectContaining({ level: 2, changed: false, atCeiling: true })
        );
        // Affectionate: nowhere to go at all.
        expect(Pace.stepUp({ level: 1, energy: 'present', maxLevel: 1 }).changed).toBe(false);
    });

    test('the energy rides up with it, because asking to come closer is not asking to stay quiet', () => {
        // The one thing allowed to leave the quiet state is an explicit request in the other
        // direction. Not a timer, not a warm turn, not the model's reading of the mood.
        const next = Pace.stepUp(sensual(1, 'quiet'));
        expect(next.energy).toBe('present');
        expect(next.did).toEqual(['pace', 'energy']);
    });

    test('energy tops out rather than wrapping', () => {
        const next = Pace.stepUp(sensual(1, 'playful'));
        expect(next.energy).toBe('playful');
        expect(next.did).toEqual(['pace']);
    });

    test('it reports arriving at the ceiling, so the control can stop being drawn', () => {
        expect(Pace.stepUp(sensual(1)).atCeiling).toBe(false);
        expect(Pace.stepUp(sensual(2)).atCeiling).toBe(true);
    });
});

describe('back, one step at a time', () => {
    test('a step lowers the level by exactly one, not all the way', () => {
        // P11 did `Sensual → Warm` in one tap. Correct for a safe word, a cliff for a dial.
        const next = Pace.stepDown(sensual(3));
        expect(next).toEqual(expect.objectContaining({ level: 2, loweredPace: true, changed: true }));
        expect(Pace.stepDown(sensual(2)).level).toBe(1);
    });

    test('the energy is untouched while there is still a pace step to give back', () => {
        expect(Pace.stepDown(sensual(3, 'playful')).energy).toBe('playful');
        expect(Pace.stepDown(sensual(3)).did).toEqual(['pace']);
    });

    test('at the gentlest pace the energy is still somewhere to go', () => {
        // Which is why easing off at Warm is not a dead control.
        const next = Pace.stepDown(sensual(1, 'present'));
        expect(next).toEqual(expect.objectContaining({ level: 1, energy: 'quiet', changed: true }));
        expect(next.did).toEqual(['energy']);
        expect(next.atFloor).toBe(true);
    });

    test('at the floor it changes nothing and says so', () => {
        const next = Pace.stepDown(sensual(1, 'quiet'));
        expect(next.changed).toBe(false);
        expect(next.did).toEqual([]);
        expect(next.atFloor).toBe(true);
    });

    test('it is idempotent at the floor: six calls are the same as one', () => {
        // The reported screenshot was six taps and six identical lines.
        let state = sensual(1, 'quiet');
        for (let i = 0; i < 6; i += 1) {
            const next = Pace.stepDown(state);
            expect(next.changed).toBe(false);
            state = { ...next, maxLevel: 3 };
        }
        expect(state.level).toBe(1);
        expect(state.energy).toBe('quiet');
    });
});

describe('the two directions are inverse, and neither one cheats', () => {
    test('up then down returns to where it started', () => {
        const start = sensual(2, 'quiet');
        const up = Pace.stepUp(start);
        const back = Pace.stepDown({ ...up, maxLevel: 3 });
        expect(back.level).toBe(start.level);
    });

    test('stepUp never lowers and stepDown never raises, from any state', () => {
        for (const level of [1, 2, 3]) {
            for (const energy of Pace.ENERGY) {
                const state = { level, energy, maxLevel: 3 };
                const up = Pace.stepUp(state);
                const down = Pace.stepDown(state);
                expect(up.level).toBeGreaterThanOrEqual(level);
                expect(down.level).toBeLessThanOrEqual(level);
                expect(Pace.ENERGY.indexOf(up.energy)).toBeGreaterThanOrEqual(Pace.ENERGY.indexOf(energy));
                expect(Pace.ENERGY.indexOf(down.energy)).toBeLessThanOrEqual(Pace.ENERGY.indexOf(energy));
            }
        }
    });

    test('a preset ceiling is respected, and junk lands somewhere sane', () => {
        expect(Pace.stepUp({ level: 9, energy: 'playful', maxLevel: 1 }).level).toBe(1);
        expect(Pace.stepDown({ level: 0, energy: 'nonsense' }).energy).toBe('quiet');
        expect(Pace.stepUp(null).level).toBe(2);
        expect(Pace.stepDown(undefined).changed).toBe(true);
    });
});

describe('what the card shows', () => {
    test('the ladder carries the ceiling and the position at once', () => {
        // The most confusing thing in the screenshot: the header said `Sensual`, the footer said
        // `Warm`. Both true, and nobody could be expected to infer ceiling-versus-current from two
        // words in two places.
        const shown = Pace.describe(sensual(2));
        expect(shown.pace).toBe('Romantic');
        expect(shown.steps.map((s) => s.label)).toEqual(['Warm', 'Romantic', 'Sensual']);
        expect(shown.steps.map((s) => s.reached)).toEqual([true, true, false]);
        expect(shown.steps.filter((s) => s.current)).toHaveLength(1);
    });

    test('a one-level preset gets no ladder, because Warm alone is not progress', () => {
        expect(Pace.describe({ level: 1, energy: 'present', maxLevel: 1 }).hasLadder).toBe(false);
        expect(Pace.describe(sensual(1)).hasLadder).toBe(true);
    });

    test('the forward control is named, and named differently for the second step', () => {
        // The same word twice reads as a control that did not work the first time.
        expect(Pace.describe(sensual(1)).forward).toBe('Closer');
        expect(Pace.describe(sensual(2)).forward).toBe('More');
        expect(Pace.describe(sensual(3)).forward).toBe('');
        expect(Pace.describe({ level: 1, energy: 'present', maxLevel: 1 }).forward).toBe('');
    });

    test('easing is offered exactly while there is a pace step to give back', () => {
        expect(Pace.describe(sensual(1)).canEase).toBe(false);
        expect(Pace.describe(sensual(2)).canEase).toBe(true);
        expect(Pace.describe(sensual(3)).canEase).toBe(true);
    });

    test('the pace word matches the level, at every level', () => {
        expect(Pace.describe({ level: 1 }).pace).toBe('Warm');
        expect(Pace.describe({ level: 2 }).pace).toBe('Romantic');
        expect(Pace.describe({ level: 3 }).pace).toBe('Sensual');
    });

    test('describe agrees with atCeiling and atFloor, from every state', () => {
        for (const level of [1, 2, 3]) {
            for (const energy of Pace.ENERGY) {
                const state = { level, energy, maxLevel: 3 };
                expect(Pace.describe(state).atCeiling).toBe(Pace.atCeiling(state));
                expect(Pace.describe(state).atFloor).toBe(Pace.atFloor(state));
            }
        }
    });
});

describe('the default', () => {
    test('a session opens attentive rather than playful', () => {
        // Energy is earned the same way pace is. Opening at `playful` would be the experience
        // deciding how lively somebody wants to be before they have said anything.
        expect(Pace.DEFAULT_ENERGY).toBe('present');
        expect(Pace.ENERGY.indexOf('present')).toBeLessThan(Pace.ENERGY.indexOf('playful'));
    });

    test('`softer` is gone, so nothing can accidentally jump to the bottom through here', () => {
        expect(Pace.softer).toBeUndefined();
    });
});
