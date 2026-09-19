/**
 * Two dimensions, so `Slow down` always has somewhere to go (P11).
 *
 * The reported bug is six taps producing six identical "We are already as gentle as this gets."
 * The listener that spoke them is fixed where it lives; this file is the reason the control has
 * something to *do* at the bottom of the pace scale, which is the deeper half of the same problem.
 *
 * What these tests are really pinning is predictability. A de-escalation control must have exactly
 * one next state for any state it is in — no randomness, no personality, no "sometimes it also
 * does X" — because a person reaching for it is not in the mood to find out what it does today.
 */

/* global describe, test, expect */

const Pace = require('../../src/features/together/PrivatePace.js');

describe('the transition table, in full', () => {
    test('a raised pace comes all the way down, and takes the energy with it', () => {
        // Somebody asking to slow down from Sensual is not asking to stay as chatty as they were,
        // and making them press twice to be heard once is the interaction this replaces.
        const next = Pace.softer({ level: 3, energy: 'playful', maxLevel: 3 });
        expect(next).toEqual(
            expect.objectContaining({ level: 1, energy: 'quiet', loweredPace: true, changed: true, atFloor: true })
        );
        expect(next.did).toEqual(['pace', 'energy']);
    });

    test('at level 1 the energy is still somewhere to go', () => {
        // The whole reason the second dimension exists: at Warm there used to be nothing left to
        // lower, so the only honest answer was a sentence saying so.
        const next = Pace.softer({ level: 1, energy: 'present', maxLevel: 3 });
        expect(next).toEqual(expect.objectContaining({ level: 1, energy: 'quiet', loweredPace: false, changed: true }));
        expect(next.did).toEqual(['energy']);
    });

    test('at the floor it changes nothing and says so', () => {
        const next = Pace.softer({ level: 1, energy: 'quiet', maxLevel: 3 });
        expect(next.changed).toBe(false);
        expect(next.did).toEqual([]);
        expect(next.atFloor).toBe(true);
    });

    test('it is idempotent: twice is the same as once', () => {
        const once = Pace.softer({ level: 3, energy: 'playful', maxLevel: 3 });
        const twice = Pace.softer({ ...once, maxLevel: 3 });
        expect(twice.level).toBe(once.level);
        expect(twice.energy).toBe(once.energy);
        expect(twice.changed).toBe(false);
    });

    test('nothing here ever raises anything', () => {
        // `softer` is the only transition. A way back up has to be an explicit user choice routed
        // through the consent gate, not a function in this file.
        for (const level of [1, 2, 3]) {
            for (const energy of Pace.ENERGY) {
                const next = Pace.softer({ level, energy, maxLevel: 3 });
                expect(next.level).toBeLessThanOrEqual(level);
                expect(Pace.ENERGY.indexOf(next.energy)).toBeLessThanOrEqual(Pace.ENERGY.indexOf(energy));
            }
        }
    });

    test('a preset ceiling is respected, and junk lands somewhere sane', () => {
        expect(Pace.softer({ level: 9, energy: 'playful', maxLevel: 1 }).level).toBe(1);
        expect(Pace.softer({ level: 0, energy: 'nonsense' }).energy).toBe('quiet');
        expect(Pace.softer(null).level).toBe(1);
        expect(Pace.softer(undefined).changed).toBe(true);
    });
});

describe('what the card shows', () => {
    test('it reports whether there is anything left to lower', () => {
        // Half of why six taps happened: the button went on saying `↓ Slow down` at the floor,
        // which is an invitation. The label itself lives in the view — two files owning one string
        // is how they end up disagreeing — so this reports the state and nothing else.
        expect(Pace.describe({ level: 1, energy: 'present' }).gentle).toBe(false);
        expect(Pace.describe({ level: 1, energy: 'quiet' }).gentle).toBe(true);
        expect(Pace.describe({ level: 3, energy: 'quiet' }).gentle).toBe(false);
    });

    test('the pace word matches the level, at every level', () => {
        expect(Pace.describe({ level: 1 }).pace).toBe('Warm');
        expect(Pace.describe({ level: 2 }).pace).toBe('Romantic');
        expect(Pace.describe({ level: 3 }).pace).toBe('Sensual');
    });

    test('atFloor and describe agree, always', () => {
        for (const level of [1, 2, 3]) {
            for (const energy of Pace.ENERGY) {
                const state = { level, energy, maxLevel: 3 };
                expect(Pace.describe(state).gentle).toBe(Pace.atFloor(state));
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
});
