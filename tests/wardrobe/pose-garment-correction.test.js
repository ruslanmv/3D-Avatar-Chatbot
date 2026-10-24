/**
 * PS4. The lap correction closes a sheet that Sitting (Wide) has pulled apart,
 * and it pushes a vertex back out of the body. The body array is only read.
 */

const { correct, maxEdgeStretch, isBodyName, STRETCH_LIMIT, widenCollapsedGusset, moundPanel } = require('../../src/wardrobe/PoseGarmentCorrection.js');

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

    test('inner-thigh normals do not pin the hem open', () => {
        const rest = new Float32Array([-0.02, 0, 0, 0.02, 0, 0, 0, 0.01, 0]);
        const posed = new Float32Array([-0.1, 0, 0, 0.1, 0, 0, 0, 0.01, 0]);
        const out = correct({
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap: lapAll(3),
            bodyPos: posed.slice(),
            bodyNrm: new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]),
        });
        expect(maxEdgeStretch(out, rest, [0, 1, 2])).toBeLessThanOrEqual(STRETCH_LIMIT + 0.2);
    });

    test('contact and stretch both hold when the push is across the cloth', () => {
        const rest = new Float32Array([0, 0, 0, 0.04, 0, 0, 0.02, 0, 0.01]);
        const posed = new Float32Array([0, -0.02, 0, 0.1, -0.02, 0, 0.02, -0.02, 0.01]);
        const bodyPos = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.02, 0, 0.01]);
        const bodyNrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
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
        expect(maxEdgeStretch(out, rest, [0, 1, 2])).toBeLessThanOrEqual(STRETCH_LIMIT + 0.2);
    });

    test('shortening a chord does not leave the cloth inside a curved surface', () => {
        const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        const radius = 0.03;
        const rest = new Float32Array(9);
        const posed = new Float32Array(9);
        const bodyPos = new Float32Array(9);
        const bodyNrm = new Float32Array(9);
        angles.forEach((angle, i) => {
            const nx = Math.cos(angle);
            const ny = Math.sin(angle);
            bodyPos[i * 3] = nx * radius;
            bodyPos[i * 3 + 1] = ny * radius;
            bodyNrm[i * 3] = nx;
            bodyNrm[i * 3 + 1] = ny;
            posed[i * 3] = nx * (radius + 0.0015);
            posed[i * 3 + 1] = ny * (radius + 0.0015);
            rest[i * 3] = nx * 0.01;
            rest[i * 3 + 1] = ny * 0.01;
        });
        const out = correct({
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap: lapAll(3),
            bodyPos,
            bodyNrm,
        });
        for (let i = 0; i < 3; i += 1) {
            let best = 0;
            let bestD = Infinity;
            for (let j = 0; j < 3; j += 1) {
                const d = Math.hypot(
                    out[i * 3] - bodyPos[j * 3],
                    out[i * 3 + 1] - bodyPos[j * 3 + 1],
                    out[i * 3 + 2] - bodyPos[j * 3 + 2]
                );
                if (d < bestD) {
                    bestD = d;
                    best = j;
                }
            }
            const signed =
                (out[i * 3] - bodyPos[best * 3]) * bodyNrm[best * 3] +
                (out[i * 3 + 1] - bodyPos[best * 3 + 1]) * bodyNrm[best * 3 + 1] +
                (out[i * 3 + 2] - bodyPos[best * 3 + 2]) * bodyNrm[best * 3 + 2];
            expect(signed).toBeGreaterThanOrEqual(0.0015 - 1e-4);
        }
        expect(Number.isFinite(maxEdgeStretch(out, rest, [0, 1, 2]))).toBe(true);
    });

    test('a hem vertex is pulled back to a pinned skirt vertex', () => {
        const rest = new Float32Array([0, 0, 0, 0, 0.04, 0, 0.01, 0.02, 0]);
        const posed = new Float32Array([0, -0.12, 0, 0, 0.04, 0, 0.01, -0.04, 0]);
        const lap = new Uint8Array([1, 0, 1]);
        const pinned = [posed[3], posed[4], posed[5]];
        const out = correct({
            posed,
            rest,
            indices: new Uint32Array([0, 1, 2]),
            lap,
            bodyPos: new Float32Array(0),
            bodyNrm: new Float32Array(0),
        });
        expect(out[3]).toBeCloseTo(pinned[0], 5);
        expect(out[4]).toBeCloseTo(pinned[1], 5);
        expect(out[5]).toBeCloseTo(pinned[2], 5);
        const span = Math.hypot(out[0] - out[3], out[1] - out[4], out[2] - out[5]);
        expect(span / 0.04).toBeLessThanOrEqual(STRETCH_LIMIT + 0.2);
    });

    test('a bodycon dress is cloth, and the VRM body primitives are the skin', () => {
        expect(isBodyName('Body')).toBe(true);
        expect(isBodyName('Body_(merged)baked')).toBe(true);
        expect(isBodyName('Body.baked')).toBe(true);
        expect(isBodyName('Body.baked_1')).toBe(true);
        expect(isBodyName('Black Bodycon Mini Dress')).toBe(false);
        expect(isBodyName('Black_Bodycon_Mini_Dress')).toBe(false);
        expect(isBodyName('Beige Tailored Briefs')).toBe(false);
        expect(isBodyName('Face')).toBe(false);
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

function rowOf(z, widthM, y) {
    const out = [];
    for (let i = 0; i < 5; i += 1) {
        const x = -widthM / 2 + (widthM * i) / 4;
        out.push(x, y, z);
    }
    return out;
}

function spanOf(positions, offset, count) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < count; i += 1) {
        const x = positions[(offset + i) * 3];
        if (x < lo) lo = x;
        if (x > hi) hi = x;
    }
    return hi - lo;
}

/** Two islands: a high panel, and a 3-row gusset under it. Triangles just need connectivity. */
function briefWithGusset(seamM, middleM) {
    const panel = [0, 0.95, 0, 0.08, 0.95, 0, 0.04, 0.95, 0.02];
    const gusset = [
        ...rowOf(-0.08, seamM, 0.80),
        ...rowOf(0.0, middleM, 0.80),
        ...rowOf(0.08, seamM, 0.80),
    ];
    // The panel has to be the larger island. The gusset is the small one under it.
    const band = [];
    for (let i = 0; i < 20; i += 1) band.push(i * 0.01, 0.96, 0);
    const positions = new Float32Array([...panel, ...gusset, ...band]);
    function stitch(a0, b0) {
        const idx = [];
        for (let i = 0; i < 4; i += 1) {
            idx.push(a0 + i, b0 + i, b0 + i + 1, a0 + i, b0 + i + 1, a0 + i + 1);
        }
        return idx;
    }
    const bandIdx = [];
    for (let i = 0; i < 19; i += 1) bandIdx.push(0, 18 + i, 19 + i);
    const indices = [0, 1, 2, ...stitch(3, 8), ...stitch(8, 13), ...bandIdx];
    return { positions, indices: new Uint32Array(indices) };
}

describe('a pinched brief gusset', () => {
    test('opens back to 24 mm and leaves the seams where they meet the panels', () => {
        const { positions, indices } = briefWithGusset(0.070, 0.005);
        const seams = [spanOf(positions, 3, 5), spanOf(positions, 13, 5)];
        expect(widenCollapsedGusset(positions, indices)).toBeGreaterThan(0);
        expect(spanOf(positions, 8, 5)).toBeCloseTo(0.024, 5);
        expect(spanOf(positions, 3, 5)).toBeCloseTo(seams[0], 5);
        expect(spanOf(positions, 13, 5)).toBeCloseTo(seams[1], 5);
    });

    test('a string stays narrow', () => {
        const { positions, indices } = briefWithGusset(0.012, 0.005);
        const before = Array.from(positions);
        expect(widenCollapsedGusset(positions, indices)).toBe(0);
        expect(Array.from(positions)).toEqual(before);
    });

    test('opening it twice does not open it further', () => {
        const { positions, indices } = briefWithGusset(0.070, 0.005);
        widenCollapsedGusset(positions, indices);
        const once = spanOf(positions, 8, 5);
        expect(widenCollapsedGusset(positions, indices)).toBe(0);
        expect(spanOf(positions, 8, 5)).toBeCloseTo(once, 5);
    });
});

function gridSheet(x0, x1, y0, y1, z, cols, rows) {
    const positions = [];
    const indices = [];
    function vid(c, r) { return r * cols + c; }
    for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
            const x = x0 + (x1 - x0) * (c / (cols - 1));
            const y = y0 + (y1 - y0) * (r / (rows - 1));
            positions.push(x, y, z);
        }
    }
    for (let r = 0; r < rows - 1; r += 1) {
        for (let c = 0; c < cols - 1; c += 1) {
            const a = vid(c, r);
            const b = vid(c + 1, r);
            const d = vid(c, r + 1);
            const e = vid(c + 1, r + 1);
            indices.push(a, b, e, a, e, d);
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('the mound panel', () => {
    const hips = [0, 0.893, 0];
    const front = [0, 0, -1];
    const up = [0, 1, 0];
    const eye = [0, 0.66, -0.42];
    const target = [0, 0.83, -0.02];

    test('covers mound skin the brief leaves below its hem', () => {
        const skin = gridSheet(-0.04, 0.04, 0.798, 0.816, -0.02, 8, 4);
        const brief = gridSheet(-0.07, 0.07, 0.86, 0.94, -0.07, 6, 3);
        const panel = moundPanel({
            skin: skin.positions,
            skinFaces: skin.indices,
            brief: brief.positions,
            briefFaces: brief.indices,
            hips, front, up, eye, target,
        });
        expect(panel).not.toBeNull();
        let inFront = 0;
        const n = panel.positions.length / 3;
        for (let i = 0; i < n; i += 1) {
            const dx = panel.positions[i * 3] - eye[0];
            const dy = panel.positions[i * 3 + 1] - eye[1];
            const dz = panel.positions[i * 3 + 2] - eye[2];
            const skinD = Math.hypot(0 - eye[0], 0.81 - eye[1], -0.02 - eye[2]);
            if (Math.hypot(dx, dy, dz) < skinD - 0.001) inFront += 1;
        }
        expect(inFront).toBeGreaterThan(n * 0.5);
        expect(panel.indices.length).toBeGreaterThan(0);
    });

    test('adds nothing when the brief already covers the mound', () => {
        const skin = gridSheet(-0.04, 0.04, 0.798, 0.816, -0.02, 6, 3);
        const brief = gridSheet(-0.08, 0.08, 0.78, 0.90, -0.05, 6, 4);
        const panel = moundPanel({
            skin: skin.positions,
            skinFaces: skin.indices,
            brief: brief.positions,
            briefFaces: brief.indices,
            hips, front, up, eye, target,
        });
        expect(panel).toBeNull();
    });
});
