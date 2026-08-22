'use strict';

/**
 * The character is centred in the viewport.
 *
 * Reported with a screenshot: she sits low, with a band of dead space above
 * her and her feet nearly touching the bottom edge.
 *
 * The tempting explanation — framing goes stale because ViewerEngine.resize()
 * re-frames on mobile only — is wrong, and the first block below is what
 * disproves it. In three.js `PerspectiveCamera.fov` is the VERTICAL field of
 * view and does not vary with `aspect`; aspect only widens or narrows the
 * frame. A standing figure is height-limited at every aspect, so the fit
 * distance is identical on a 1:2 panel and a 21:9 one. Resizing cannot move
 * her, and flipping that gate would have fixed nothing while yanking the
 * camera to a front view on every window drag.
 *
 * The cause is the composition bias. Raising the camera TARGET pushes the
 * subject DOWN in frame, and both framing paths raised it by 0.08-0.12 of
 * subject height.
 */

/* global describe, test, expect */

const CF = require('../src/gltf-viewer/CameraFraming');

/** A ~1.6 m avatar, arms at rest, through the app's 50° lens. */
const AVATAR = { sizeX: 0.55, sizeY: 1.6, fovDeg: 50 };
const fit = (aspect, extra) => CF.fitDistance(Object.assign({}, AVATAR, { aspect }, extra));

describe('resize was NOT the cause — the fit is aspect-invariant here', () => {
    test('a standing figure needs the same distance at every aspect', () => {
        const distances = [0.5, 0.75, 1.0, 1.33, 1.78, 2.4].map((a) => fit(a));
        for (const d of distances) expect(d).toBeCloseTo(distances[0], 10);
    });

    test('because fov is VERTICAL: height is the limiting axis, and it ignores aspect', () => {
        const byHeightOnly = CF.fitDistance(Object.assign({}, AVATAR, { sizeX: 0, aspect: 0.5 }));
        expect(fit(0.5)).toBeCloseTo(byHeightOnly, 10);
        expect(fit(2.4)).toBeCloseTo(byHeightOnly, 10);
    });

    test('a WIDE pose is the case where aspect does matter', () => {
        // Arms out in a dance: width becomes the limiting axis on a narrow panel.
        const dancing = { sizeX: 2.4, sizeY: 1.6, fovDeg: 50 };
        const narrow = CF.fitDistance(Object.assign({}, dancing, { aspect: 0.5 }));
        const wide = CF.fitDistance(Object.assign({}, dancing, { aspect: 2.4 }));
        expect(narrow).toBeGreaterThan(wide);
    });
});

describe('the composition bias IS the cause', () => {
    test('the old 0.12 leaves 5.4x more headroom than footroom', () => {
        const c = CF.composition({ sizeY: 1.6, fitOffset: 1.35, biasY: 0.12 });
        expect(c.ratio).toBeCloseTo(5.4, 1);
        expect(c.headroom).toBeCloseTo(0.472, 3);
        expect(c.footroom).toBeCloseTo(0.088, 3);
    });

    test('the old landscape 0.08 is still 2.7x', () => {
        expect(CF.composition({ sizeY: 1.6, fitOffset: 1.35, biasY: 0.08 }).ratio).toBeCloseTo(2.7, 1);
    });

    test('the shipped bias is a natural portrait split, not a void', () => {
        const c = CF.composition({ sizeY: 1.6, fitOffset: 1.35 });
        expect(c.ratio).toBeGreaterThan(1); // a little more headroom, as convention wants
        expect(c.ratio).toBeLessThan(2); // but nothing like the reported 5.4
    });

    test('and it leaves real space under her feet', () => {
        const before = CF.composition({ sizeY: 1.6, fitOffset: 1.35, biasY: 0.12 });
        const after = CF.composition({ sizeY: 1.6, fitOffset: 1.35 });
        expect(after.footroom).toBeGreaterThan(before.footroom * 2);
    });

    test('zero bias is exactly centred — the reference point', () => {
        const c = CF.composition({ sizeY: 1.6, fitOffset: 1.35, biasY: 0 });
        expect(c.headroom).toBeCloseTo(c.footroom, 10);
        expect(c.ratio).toBeCloseTo(1, 10);
    });

    test('the bias can never push her feet out of frame at the shipped fit', () => {
        // footroom > 0 requires biasY < fitOffset/2 - 0.5 = 0.175 at 1.35.
        expect(CF.composition({ sizeY: 1.6, fitOffset: 1.35 }).footroom).toBeGreaterThan(0);
        expect(CF.HEADROOM_BIAS).toBeLessThan(0.175);
    });

    test('a clipped subject is reported as negative footroom, not hidden', () => {
        const c = CF.composition({ sizeY: 1.6, fitOffset: 1.35, biasY: 0.3 });
        expect(c.footroom).toBeLessThan(0);
        expect(c.ratio).toBe(Infinity);
    });

    test('margins scale with the subject, so the split is height-independent', () => {
        const small = CF.composition({ sizeY: 1.0 });
        const large = CF.composition({ sizeY: 2.0 });
        expect(large.headroom).toBeCloseTo(small.headroom * 2, 10);
        expect(large.ratio).toBeCloseTo(small.ratio, 10);
    });
});

describe('fitDistance basics', () => {
    test('distance scales linearly with the subject', () => {
        const twice = CF.fitDistance(Object.assign({}, AVATAR, { sizeY: 3.2, sizeX: 1.1, aspect: 1.6 }));
        expect(twice).toBeCloseTo(fit(1.6) * 2, 6);
    });

    test('a wider lens needs less distance', () => {
        expect(fit(1.6, { fovDeg: 80 })).toBeLessThan(fit(1.6, { fovDeg: 30 }));
    });

    test('a larger fitOffset backs the camera off', () => {
        expect(fit(1.6, { fitOffset: 2.0 })).toBeGreaterThan(fit(1.6, { fitOffset: 1.35 }));
    });

    test('nonsense inputs yield 0 rather than NaN or Infinity', () => {
        for (const bad of [
            {},
            { sizeX: 0, sizeY: 0, fovDeg: 50, aspect: 1 },
            { sizeX: 1, sizeY: 1, fovDeg: 0, aspect: 1 },
            { sizeX: 1, sizeY: 1, fovDeg: 50, aspect: 0 },
            { sizeX: 1, sizeY: 1, fovDeg: 50, aspect: 1, fitOffset: 0 },
        ]) {
            expect(CF.fitDistance(bad)).toBe(0);
        }
        expect(CF.fitDistance(null)).toBe(0);
    });

    test('composition survives missing input', () => {
        expect(() => CF.composition(null)).not.toThrow();
        expect(CF.composition(null).headroom).toBe(0);
    });
});
