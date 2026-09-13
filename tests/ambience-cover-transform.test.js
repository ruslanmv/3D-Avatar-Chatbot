/**
 * Cover transform (batch A1).
 *
 * The acceptance for this batch is geometric rather than behavioural, so the tests are written
 * as the two properties that actually matter and must hold for every viewport:
 *
 *   1. the visible sub-rectangle has the *viewport's* aspect ratio — that is what "cover" means,
 *      and it is the property whose absence shows up as a squashed horizon;
 *   2. the window stays inside [0,1] on both axes — outside it, ClampToEdgeWrapping smears the
 *      edge pixel across the screen, which reads as a rendering bug rather than a crop.
 *
 * Then the focal point, pinned from both ends on whichever axis is actually cropping. The
 * vertical case is the one worth the ceremony: `flipY` means a focal point measured from the top
 * has to be read from the other end of v, and an inverted vertical axis is the one error in this
 * file that looks entirely plausible until you compare against the source image.
 *
 * The asset these numbers come from is real: the ten starter scenes are all 1672x941.
 */

const Cover = require('../src/gltf-viewer/ambience/coverTransform.js');

const IMAGE_W = 1672;
const IMAGE_H = 941;
const IMAGE_ASPECT = IMAGE_W / IMAGE_H; // ~1.7768

/** The sub-rectangle `repeat`/`offset` select, in image pixels. */
function window(t) {
    return {
        w: IMAGE_W * t.repeat.x,
        h: IMAGE_H * t.repeat.y,
        u: [t.offset.x, t.offset.x + t.repeat.x],
        v: [t.offset.y, t.offset.y + t.repeat.y],
    };
}

describe('computeCoverTransform', () => {
    const VIEWPORTS = [
        ['wide desktop', 1920, 1080],
        ['narrow desktop', 1280, 1024],
        ['portrait phone', 390, 844],
        ['exactly the image aspect', IMAGE_W, IMAGE_H],
        ['ultrawide', 3440, 1440],
        ['a tall sliver', 200, 1200],
    ];

    test.each(VIEWPORTS)('%s: the visible window matches the viewport aspect', (_name, vw, vh) => {
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, vw / vh);
        const win = window(t);
        expect(win.w / win.h).toBeCloseTo(vw / vh, 6);
    });

    test.each(VIEWPORTS)('%s: the window stays inside the image', (_name, vw, vh) => {
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, vw / vh);
        const win = window(t);
        expect(t.repeat.x).toBeLessThanOrEqual(1);
        expect(t.repeat.y).toBeLessThanOrEqual(1);
        expect(win.u[0]).toBeGreaterThanOrEqual(0);
        expect(win.v[0]).toBeGreaterThanOrEqual(0);
        expect(win.u[1]).toBeLessThanOrEqual(1 + 1e-12);
        expect(win.v[1]).toBeLessThanOrEqual(1 + 1e-12);
    });

    test('never scales up: one axis is always fully visible', () => {
        for (const [, vw, vh] of VIEWPORTS) {
            const t = Cover.computeCoverTransform(IMAGE_ASPECT, vw / vh);
            expect(Math.max(t.repeat.x, t.repeat.y)).toBeCloseTo(1, 12);
        }
    });

    test('a matching aspect crops nothing', () => {
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, IMAGE_ASPECT);
        expect(t.repeat).toEqual({ x: 1, y: 1 });
        expect(t.offset).toEqual({ x: 0, y: 0 });
    });

    test('a wider viewport crops top and bottom, not the sides', () => {
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, 3440 / 1440);
        expect(t.repeat.x).toBe(1);
        expect(t.repeat.y).toBeLessThan(1);
    });

    test('a narrower viewport crops the sides, not top and bottom', () => {
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, 390 / 844);
        expect(t.repeat.y).toBe(1);
        expect(t.repeat.x).toBeLessThan(1);
    });

    describe('focal point, on the axis that is cropping', () => {
        // Ultrawide: viewAspect 2.39 > imageAspect 1.78, so the VERTICAL axis crops.
        const tall = (y) => Cover.computeCoverTransform(IMAGE_ASPECT, 3440 / 1440, { x: 0.5, y });

        test('focal y=0 pins the window to the top of the image', () => {
            const win = window(tall(0));
            expect(win.v[1]).toBeCloseTo(1, 12); // flipY: v=1 is the top row
        });

        test('focal y=1 pins the window to the bottom of the image', () => {
            const win = window(tall(1));
            expect(win.v[0]).toBeCloseTo(0, 12);
        });

        test('focal y=0.5 centres it', () => {
            const t = tall(0.5);
            const win = window(t);
            expect(win.v[0]).toBeCloseTo((1 - t.repeat.y) / 2, 12);
        });

        // Portrait: the HORIZONTAL axis crops.
        const wide = (x) => Cover.computeCoverTransform(IMAGE_ASPECT, 390 / 844, { x, y: 0.5 });

        test('focal x=0 pins the window to the left edge', () => {
            expect(window(wide(0)).u[0]).toBeCloseTo(0, 12);
        });

        test('focal x=1 pins the window to the right edge', () => {
            expect(window(wide(1)).u[1]).toBeCloseTo(1, 12);
        });

        test('focal y has no effect when the vertical axis is not cropping', () => {
            // A landscape image in a portrait window crops only horizontally: repeat.y === 1
            // leaves nothing to pan, so a "top" focal point is correctly a no-op rather than
            // silently shifting the crop.
            const top = Cover.computeCoverTransform(IMAGE_ASPECT, 390 / 844, { x: 0.5, y: 0 });
            const bottom = Cover.computeCoverTransform(IMAGE_ASPECT, 390 / 844, { x: 0.5, y: 1 });
            expect(top.repeat.y).toBe(1);
            expect(top.offset.y).toBe(0);
            expect(bottom.offset.y).toBe(0);
        });
    });

    describe('unusable input returns the identity rather than NaN', () => {
        // A collapsed panel, a hidden canvas, a phone mid-rotation: all produce a zero
        // dimension for real, and NaN reaching the GPU renders as nothing at all.
        const BAD = [0, -1, NaN, Infinity, -Infinity, undefined, null, '16/9', {}];

        test.each(BAD)('viewAspect %p', (bad) => {
            const t = Cover.computeCoverTransform(IMAGE_ASPECT, bad);
            expect(t).toEqual({ repeat: { x: 1, y: 1 }, offset: { x: 0, y: 0 } });
        });

        test.each(BAD)('imageAspect %p', (bad) => {
            const t = Cover.computeCoverTransform(bad, 16 / 9);
            expect(t).toEqual({ repeat: { x: 1, y: 1 }, offset: { x: 0, y: 0 } });
        });

        test('every output is a finite number', () => {
            for (const [, vw, vh] of VIEWPORTS) {
                const t = Cover.computeCoverTransform(IMAGE_ASPECT, vw / vh, { x: 0.3, y: 0.7 });
                for (const v of [t.repeat.x, t.repeat.y, t.offset.x, t.offset.y]) {
                    expect(Number.isFinite(v)).toBe(true);
                }
            }
        });

        test('an out-of-range focal point is clamped, not trusted', () => {
            const low = Cover.computeCoverTransform(IMAGE_ASPECT, 3440 / 1440, { x: -5, y: -5 });
            const high = Cover.computeCoverTransform(IMAGE_ASPECT, 3440 / 1440, { x: 5, y: 5 });
            expect(low.offset.x).toBe(0);
            expect(window(high).u[1]).toBeCloseTo(1, 12);
            for (const t of [low, high]) {
                expect(t.offset.y).toBeGreaterThanOrEqual(0);
                expect(t.offset.y + t.repeat.y).toBeLessThanOrEqual(1 + 1e-12);
            }
        });
    });
});

describe('parseFocalPoint', () => {
    test('the documented spellings', () => {
        expect(Cover.parseFocalPoint('center')).toEqual({ x: 0.5, y: 0.5 });
        expect(Cover.parseFocalPoint('top')).toEqual({ x: 0.5, y: 0 });
        expect(Cover.parseFocalPoint('bottom')).toEqual({ x: 0.5, y: 1 });
        expect(Cover.parseFocalPoint('left')).toEqual({ x: 0, y: 0.5 });
        expect(Cover.parseFocalPoint('right')).toEqual({ x: 1, y: 0.5 });
        expect(Cover.parseFocalPoint('center top')).toEqual({ x: 0.5, y: 0 });
        expect(Cover.parseFocalPoint('left bottom')).toEqual({ x: 0, y: 1 });
        expect(Cover.parseFocalPoint('45% center')).toEqual({ x: 0.45, y: 0.5 });
        expect(Cover.parseFocalPoint('30% 70%')).toEqual({ x: 0.3, y: 0.7 });
    });

    test('keyword order does not matter, as in CSS', () => {
        expect(Cover.parseFocalPoint('top center')).toEqual(Cover.parseFocalPoint('center top'));
        expect(Cover.parseFocalPoint('bottom left')).toEqual(Cover.parseFocalPoint('left bottom'));
    });

    test('case and surrounding whitespace are forgiven', () => {
        expect(Cover.parseFocalPoint('  CENTER   TOP ')).toEqual({ x: 0.5, y: 0 });
    });

    test('percentages outside the image are clamped', () => {
        expect(Cover.parseFocalPoint('150% -20%')).toEqual({ x: 1, y: 0 });
    });

    test.each([
        ['', 'empty'],
        ['   ', 'whitespace'],
        ['somewhere nice', 'prose'],
        ['left right', 'two values for one axis'],
        ['top bottom', 'two values for one axis'],
        ['10% 20% 30%', 'three values'],
        ['45', 'a bare number, which CSS would read as pixels'],
        ['45px', 'pixels — we only speak fractions'],
        [null, 'null'],
        [undefined, 'undefined'],
        [42, 'a number'],
        [{}, 'an object'],
    ])('%p (%s) falls back to centre rather than throwing', (input) => {
        expect(Cover.parseFocalPoint(input)).toEqual({ x: 0.5, y: 0.5 });
    });

    test('the fallback is a fresh object each time, never the shared constant', () => {
        // Handing out the module's own CENTER would let one caller's mutation reach every
        // later caller, which is the kind of bug that only shows up in the third scene.
        const a = Cover.parseFocalPoint('nonsense');
        a.x = 0.1;
        expect(Cover.parseFocalPoint('nonsense')).toEqual({ x: 0.5, y: 0.5 });
        expect(Cover.CENTER).toEqual({ x: 0.5, y: 0.5 });
    });

    test('parsed output feeds the transform directly', () => {
        const focal = Cover.parseFocalPoint('center top');
        const t = Cover.computeCoverTransform(IMAGE_ASPECT, 3440 / 1440, focal);
        expect(window(t).v[1]).toBeCloseTo(1, 12);
    });
});
