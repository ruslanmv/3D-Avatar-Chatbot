/**
 * SG5. The body check behind the gesture audit and tuner, on a made-up skeleton.
 *
 * She stands at the origin facing +z, her right side towards -x (as a person facing you holds
 * their right hand on your left). Properties: her own frame is built from her legs; a hand at her
 * spine is inside her and one beside her is not; a hand past her midline is a crossing; and the
 * left hand is read as the mirror of the right.
 */

/* global describe, test, expect */

const BC = require('../../tools/qa/GestureBodyCheck.js');

const at = (x, y, z) => ({ x, y, z });
const her = BC.frame({
    hips: at(0, 0.9, 0),
    leftUpperLeg: at(0.09, 0.85, 0),
    rightUpperLeg: at(-0.09, 0.85, 0),
    leftUpperArm: at(0.17, 1.35, 0),
    rightUpperArm: at(-0.17, 1.35, 0),
    chest: at(0, 1.25, 0.02),
    neck: at(0, 1.42, 0),
    head: at(0, 1.55, 0),
});
const right = (hand, elbow, id) => BC.measure(her, 'right', { hand, elbow }, id);

describe('her frame', () => {
    test('is built from her legs: her right is +x in it, forward is the way she faces', () => {
        expect(her.toLocal(at(-0.3, 0.9, 0)).x).toBeCloseTo(0.3);
        expect(her.toLocal(at(0, 0.9, 0.4)).z).toBeCloseTo(0.4);
        expect(her.span).toBeCloseTo(0.34);
    });
});

describe('her body', () => {
    test('a hand on her spine is inside her, one beside her or in front of her is not', () => {
        expect(right(at(0, 1.1, 0), at(-0.2, 1.1, 0), 'beat').handInside).toBeGreaterThan(0);
        expect(right(at(-0.3, 1.1, 0), at(-0.25, 1.15, 0), 'beat').handInside).toBe(0);
        expect(right(at(-0.05, 1.1, 0.35), at(-0.2, 1.1, 0.15), 'beat').handInside).toBe(0);
    });

    test('a forearm through her is caught even when the hand comes out the other side', () => {
        const m = right(at(0.2, 1.1, 0.0), at(-0.2, 1.1, 0.0), 'beat');
        expect(m.forearmInside).toBeGreaterThan(0);
    });

    test('a hand across her front is a crossing; one on its own side is not', () => {
        expect(right(at(0.15, 1.1, 0.3), at(-0.1, 1.1, 0.2), 'beat').crossCm).toBeGreaterThan(10);
        expect(right(at(-0.2, 1.1, 0.3), at(-0.2, 1.2, 0.1), 'beat').crossCm).toBe(0);
    });

    test('a hand on her chest may reach her midline, not past it', () => {
        expect(right(at(0, 1.3, 0.1), at(-0.2, 1.15, 0.1), 'handOnChest').crossCm).toBe(0);
        expect(right(at(0.1, 1.3, 0.1), at(-0.2, 1.15, 0.1), 'handOnChest').crossCm).toBeGreaterThan(5);
    });

    test('the left hand is read as the mirror of the right', () => {
        const r = right(at(-0.25, 1.1, 0.3), at(-0.2, 1.15, 0.1), 'palmToYou');
        const l = BC.measure(her, 'left', { hand: at(0.25, 1.1, 0.3), elbow: at(0.2, 1.15, 0.1) }, 'palmToYou');
        expect(l.hand).toEqual(r.hand);
        expect(l.toTargetCm).toBeCloseTo(r.toTargetCm);
    });
});

describe('targets and verdicts', () => {
    test('a wave below her shoulder misses; one above it does not', () => {
        expect(BC.verdict(right(at(-0.2, 1.1, 0.1), at(-0.25, 1.2, 0.05), 'wave'))).toContain('missed-target');
        // Her target in her frame, back into the world: her right is -x, her hips are at y 0.9.
        const t = BC.target(her, 'wave').point;
        const onTarget = at(-t.x, t.y + 0.9, t.z);
        expect(BC.verdict(right(onTarget, at(-0.3, 1.4, 0.05), 'wave'))).toEqual([]);
    });

    test('every gesture has a target, and the tuner prefers reaching it over effort', () => {
        for (const id of [
            'beat',
            'wave',
            'palmToYou',
            'handOnChest',
            'chinTouch',
            'hairTuck',
            'shrug',
            'openArms',
            'palmsUp',
            'negate',
        ]) {
            expect(BC.target(her, id)).not.toBeNull();
        }
        const far = right(at(-0.2, 1.0, 0.1), at(-0.2, 1.2, 0.05), 'palmToYou');
        expect(BC.cost(far, 0)).toBeGreaterThan(BC.cost(far, 0) - 1);
        const inside = right(at(0, 1.1, 0), at(-0.1, 1.1, 0), 'palmToYou');
        expect(BC.cost(inside, 0)).toBeGreaterThan(BC.cost(far, 0));
    });
});
