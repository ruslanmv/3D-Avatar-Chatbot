/**
 * ID1. Her standing idle, solved for her body: arms close to her sides with the hand a small gap
 * outside the thigh, one elbow bent more than the other, palms in, fingers in a gentle cascade.
 */
const Idle = require('../src/gltf-viewer/RelaxedIdle.js');

const body = (shoulderX, armLength, thighX, height = 1.55) => ({
    height,
    left: { shoulderX, armLength, thighX },
    right: { shoulderX, armLength, thighX },
});

describe('ID1 relaxed idle', () => {
    test('the hand lands a small gap outside the thigh: the arm angle is solved, not fixed', () => {
        const narrow = Idle.solve(body(0.18, 0.5, 0.07)).angles.left;
        const broad = Idle.solve(body(0.18, 0.5, 0.12)).angles.left;
        // Wider hips with the same shoulders need the hand further out: a smaller angle.
        expect(broad).toBeLessThan(narrow);
        for (const a of [narrow, broad]) {
            expect(a).toBeGreaterThanOrEqual(Idle.MIN_DOWN);
            expect(a).toBeLessThanOrEqual(Idle.MAX_DOWN);
        }
        // Where it lands: shoulder + arm·cos(angle) is the thigh plus the gap, within a centimetre.
        const b = body(0.18, 0.5, 0.09);
        const a = Idle.solve(b).angles.left;
        const reach = 0.18 + 0.5 * Math.cos((a * Math.PI) / 180);
        expect(reach - 0.09).toBeGreaterThan(0.1);
        expect(reach - 0.09).toBeLessThan(0.2);
    });

    test('never into the hip, never back toward a T, even for a broken measurement', () => {
        expect(Idle.armDown({ shoulderX: 0.18, length: 0.5, target: 0.0 })).toBe(Idle.MAX_DOWN);
        expect(Idle.armDown({ shoulderX: 0.18, length: 0.5, target: 9 })).toBe(Idle.MIN_DOWN);
        expect(Idle.armDown({ shoulderX: 0.18, length: 0, target: 0.2 })).toBe(72);
        expect(Idle.solve({}).angles.left).toBeGreaterThanOrEqual(Idle.MIN_DOWN);
    });

    test('one elbow bends more than the other, both arms mirror otherwise', () => {
        const { bones } = Idle.solve(body(0.18, 0.5, 0.09));
        expect(bones.leftLowerArm[3]).not.toBe(bones.rightLowerArm[3]);
        expect(bones.leftUpperArm[2]).toBe(-bones.rightUpperArm[2]);
        expect(bones.leftLowerArmTwist[3]).toBe(Idle.PALM_IN);
    });

    test('fingers curl in a cascade toward the little finger, the thumb relaxed', () => {
        const { bones } = Idle.solve(body(0.18, 0.5, 0.09));
        const prox = ['Index', 'Middle', 'Ring', 'Little'].map((f) => bones[`left${f}Proximal`][3]);
        expect([...prox].sort((a, b) => a - b)).toEqual(prox);
        for (const f of ['Index', 'Middle', 'Ring', 'Little'])
            for (const j of ['Proximal', 'Intermediate', 'Distal']) expect(bones[`left${f}${j}`][3]).toBeLessThan(30);
        expect(bones.leftThumbProximal[3]).toBeLessThanOrEqual(30);
    });
});
