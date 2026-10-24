/**
 * PS4. The lap correction closes a sheet that Sitting (Wide) has pulled apart,
 * and it pushes a vertex back out of the body. The body array is only read.
 */

const { correct, maxEdgeStretch, STRETCH_LIMIT } = require('../../src/wardrobe/PoseGarmentCorrection.js');

function lapAll(count) {
    return new Uint8Array(count).fill(1);
}

describe('PS4 pose garment correction', () => {
    test('a vertex inside the skin is pushed out to the clearance and the body is not rewritten', () => {
        const rest = new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0, 0.01]);
        const posed = new Float32Array([0, -0.02, 0, 0.04, -0.02, 0, 0.02, -0.02, 0.01]);
        const bodyPos = new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0, 0.01]);
        const bodyNrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
        const before = Array.from(bodyPos);
        const out = correct({
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap: lapAll(3),
            bodyPos,
            bodyNrm,
        });
        expect(out[1]).toBeGreaterThanOrEqual(0.0015 - 1e-4);
        expect(out[4]).toBeGreaterThanOrEqual(0.0015 - 1e-4);
        expect(Array.from(bodyPos)).toEqual(before);
    });

    test('an edge opened by the wide sit comes back under the stretch limit', () => {
        // 4 cm of cloth posed 20 cm apart: the triangular opening.
        const rest = new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0.01, 0]);
        const posed = new Float32Array([-0.08, 0, 0, 0.12, 0, 0, 0.02, 0.01, 0]);
        const before = maxEdgeStretch(posed, rest, [0, 1, 2]);
        expect(before).toBeGreaterThan(4);
        const out = correct({
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap: lapAll(3),
            bodyPos: new Float32Array(0),
            bodyNrm: new Float32Array(0),
        });
        expect(maxEdgeStretch(out, rest, [0, 1, 2])).toBeLessThanOrEqual(STRETCH_LIMIT + 0.2);
    });

    test('the same pose corrected twice from the bind result does not accumulate', () => {
        const rest = new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0, 0.01]);
        const posed = new Float32Array([0, -0.02, 0, 0.04, -0.02, 0, 0.02, -0.02, 0.01]);
        const input = {
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap: lapAll(3),
            bodyPos: new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0, 0.01]),
            bodyNrm: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        };
        const once = correct(input);
        const twice = correct(input);
        for (let i = 0; i < once.length; i += 1) expect(twice[i]).toBeCloseTo(once[i], 6);
    });
});
