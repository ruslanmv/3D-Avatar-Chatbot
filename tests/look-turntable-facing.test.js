/**
 * RP2. The review packet's "front" picture must be her front, whatever her file's VRM version.
 * See tools/qa/turntable-facing.js for why the app's own framing could not be trusted.
 */
const { facingOffset } = require('../tools/qa/turntable-facing.js');

const v = (x, y, z) => ({ x, y, z });
const CAMERA = v(0, 1.4, 2.8); // the app's default camera, on +Z, looking at the origin

describe('turntable facing (RP2)', () => {
    test('VRM 0.x after the app turns it by π: faces the +Z camera, no change', () => {
        // Facing +Z, her left is at +X.
        const r = facingOffset(v(0.2, 1.4, 0), v(-0.2, 1.4, 0), CAMERA);
        expect(r.facing).toBe('camera');
        expect(r.offset).toBe(0);
    });

    test('VRM 1.0 after the same π: her back is to the camera, so the turntable adds π', () => {
        // Facing −Z, her left is at −X.
        const r = facingOffset(v(-0.2, 1.4, 0), v(0.2, 1.4, 0), CAMERA);
        expect(r.facing).toBe('away');
        expect(r.offset).toBeCloseTo(Math.PI);
    });

    test('the answer follows the pose, not the camera height or shoulder height', () => {
        const r = facingOffset(v(-0.2, 1.1, 0.01), v(0.2, 1.6, -0.01), v(0.3, 5, 2));
        expect(r.offset).toBeCloseTo(Math.PI);
    });

    test('side-on, degenerate or missing input changes nothing', () => {
        expect(facingOffset(v(0, 1.4, 0.2), v(0, 1.4, -0.2), CAMERA).offset).toBe(0); // side-on
        expect(facingOffset(v(0, 1.4, 0), v(0, 1.6, 0), CAMERA).facing).toBe('unknown'); // stacked
        expect(facingOffset(v(0.2, 1, 0), v(-0.2, 1, 0), v(0, 3, 0)).facing).toBe('unknown'); // overhead
        expect(facingOffset(null, v(0, 0, 0), CAMERA)).toEqual({ offset: 0, facing: 'unknown', dot: 0 });
        expect(facingOffset(v(NaN, 0, 0), v(0, 0, 0), CAMERA).facing).toBe('unknown');
    });
});
