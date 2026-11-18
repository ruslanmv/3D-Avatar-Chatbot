/**
 * AN1. tools/qa/ClipQualityScorer.js — each check fires on the fault it names and stays quiet on
 * a clean clip, so the animation review's verdicts mean what they say.
 */
const Q = require('../tools/qa/ClipQualityScorer.js');

const FOOT = 0.08;
const ID = [0, 0, 0, 1];
const rotZ = (deg) => {
    const r = (deg * Math.PI) / 360;
    return [0, 0, Math.sin(r), Math.cos(r)];
};

/** A clean standing sample: feet on the floor, straight legs, facing +z, hands outside. */
function sample(over = {}) {
    const legs = {
        left: { hip: [0.08, 0.9, 0], knee: [0.08, 0.5, 0.01], ankle: [0.08, FOOT, 0] },
        right: { hip: [-0.08, 0.9, 0], knee: [-0.08, 0.5, 0.01], ankle: [-0.08, FOOT, 0] },
    };
    return {
        hips: [0, 0.9, 0],
        feet: [
            [0.08, FOOT, 0],
            [-0.08, FOOT, 0],
        ],
        legs,
        fwd: [0, 0, 1],
        yawDeg: 0,
        inside: 0,
        quats: { hips: ID, spine: ID, leftUpperArm: ID },
        ...over,
    };
}
const clip = (n, f, category = 'idle') => ({
    category,
    dt: 1 / 30,
    stand: { footY: [FOOT, FOOT] },
    samples: Array.from({ length: n }, (_, i) => f(i)),
});

test('a clean standing loop has no flags', () => {
    const r = Q.score(clip(60, () => sample()));
    expect(r.flags).toEqual([]);
});

test('feet in the floor for a fifth of the clip fail', () => {
    const r = Q.score(
        clip(50, (i) =>
            sample(
                i < 15
                    ? {
                          feet: [
                              [0.08, FOOT - 0.1, 0],
                              [-0.08, FOOT, 0],
                          ],
                      }
                    : {}
            )
        )
    );
    expect(r.fails).toContain('feet-through-floor');
    expect(r.metrics.floorPenCm).toBeCloseTo(10, 0);
});

test('a knee bent backwards fails; the same bend forwards is a normal knee', () => {
    const bent = (z) => ({
        legs: {
            left: { hip: [0.08, 0.9, 0], knee: [0.08, 0.5, z], ankle: [0.08, FOOT, 0] },
            right: { hip: [-0.08, 0.9, 0], knee: [-0.08, 0.5, 0.01], ankle: [-0.08, FOOT, 0] },
        },
    });
    expect(Q.score(clip(30, () => sample(bent(-0.15)))).fails).toContain('knee-reversed');
    expect(Q.score(clip(30, () => sample(bent(0.15)))).fails).not.toContain('knee-reversed');
});

test('knees are not judged lying down', () => {
    const r = Q.score(
        clip(
            30,
            () =>
                sample({
                    legs: {
                        left: { hip: [0.08, 0.9, 0], knee: [0.08, 0.5, -0.2], ankle: [0.08, FOOT, 0] },
                        right: { hip: [-0.08, 0.9, 0], knee: [-0.08, 0.5, -0.2], ankle: [-0.08, FOOT, 0] },
                    },
                }),
            'laying'
        )
    );
    expect(r.fails).not.toContain('knee-reversed');
});

test('a planted foot that slides is foot skate; one that steps is not', () => {
    const slide = Q.score(
        clip(40, (i) =>
            sample({
                feet: [
                    [0.08 + i * 0.02, FOOT, 0],
                    [-0.08, FOOT, 0],
                ],
            })
        )
    );
    expect(slide.warns).toContain('foot-skate');
    const step = Q.score(
        clip(40, (i) =>
            sample({
                feet: [
                    [0.08 + i * 0.02, FOOT + 0.1, 0],
                    [-0.08, FOOT, 0],
                ],
            })
        )
    );
    expect(step.warns).not.toContain('foot-skate');
});

test('a hand inside her torso for a tenth of the clip warns', () => {
    const r = Q.score(clip(50, (i) => sample({ inside: i < 10 ? 0.3 : 0 })));
    expect(r.warns).toContain('hand-in-body');
});

test('a bone flipping in one step is a pop; a fast but continuous spin is not', () => {
    const flip = Q.score(clip(30, (i) => sample({ quats: { hips: i === 15 ? rotZ(170) : ID } })));
    expect(flip.warns).toContain('pop');
    const spin = Q.score(clip(30, (i) => sample({ quats: { hips: rotZ(i * 20) } }), 'dance'));
    expect(spin.warns).not.toContain('pop');
});

test('a loop whose last frame misses its first warns; one-shot categories are not judged', () => {
    const f = (i) => sample({ quats: { leftUpperArm: rotZ(i) } }); // ends 59° from where it began
    expect(Q.score(clip(60, f, 'idle')).warns).toContain('loop-seam');
    expect(Q.score(clip(60, f, 'emotion')).warns).not.toContain('loop-seam');
});

test('an in-place clip that walks off or turns round warns; a dance may', () => {
    const walk = (i) => sample({ hips: [0, 0.9, i * 0.02], yawDeg: i * 2 });
    const idle = Q.score(clip(60, walk, 'idle'));
    expect(idle.warns).toEqual(expect.arrayContaining(['travels', 'turns']));
    expect(Q.score(clip(60, walk, 'dance')).warns).not.toContain('travels');
});

test('turning is measured the short way round', () => {
    const r = Q.score(clip(10, (i) => sample({ yawDeg: i % 2 ? 359 : 1 })));
    expect(r.metrics.turnDeg).toBeLessThan(5);
});

test('with the ground given, a foot lying flat is on the floor, and a sole below it is not', () => {
    const flat = Q.score({
        ...clip(30, () =>
            sample({
                feet: [
                    [0.08, 0.03, 0],
                    [-0.08, 0.03, 0],
                ],
                soles: [0.0, 0.0],
            })
        ),
        ground: 0,
    });
    expect(flat.fails).not.toContain('feet-through-floor');
    const sunk = Q.score({ ...clip(30, () => sample({ soles: [-0.08, 0.0] })), ground: 0 });
    expect(sunk.fails).toContain('feet-through-floor');
});

test("a reviewed clip's own posture overrides the category's: knees are not judged lying down", () => {
    const bent = sample({
        legs: {
            left: { hip: [0.08, 0.9, 0], knee: [0.08, 0.5, -0.2], ankle: [0.08, FOOT, 0] },
            right: { hip: [-0.08, 0.9, 0], knee: [-0.08, 0.5, -0.2], ankle: [-0.08, FOOT, 0] },
        },
    });
    expect(Q.score(clip(30, () => bent, 'exercise')).fails).toContain('knee-reversed');
    expect(Q.score({ ...clip(30, () => bent, 'exercise'), posture: 'lay' }).fails).not.toContain('knee-reversed');
});
