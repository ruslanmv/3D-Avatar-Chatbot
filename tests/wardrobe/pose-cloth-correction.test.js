/**
 * SW1. The posed cloth correction, on geometry simple enough to reason about: a sphere for her
 * body and a square of cloth pushed into it. Pinned: nothing is left inside, cloth that was
 * outside and unstretched is not moved, a fixed vertex (a boot's foot) stays put, the next layer
 * clears the one under it, and the report says before and after in pose_contact's terms.
 * On the real look in Sitting (Wide) the same function takes the bodycon from 23 mm inside her
 * to 0 and the briefs from 13.9 mm to 0 (docs/SITTING_WIDE.md).
 */
const C = require('../../src/wardrobe/PoseClothCorrection.js');

/** A unit-ish sphere of points with outward normals: radius r metres. */
function sphere(r, rings = 40, segments = 80) {
    const pos = [];
    const nrm = [];
    for (let i = 1; i < rings; i += 1) {
        const theta = (Math.PI * i) / rings;
        for (let j = 0; j < segments; j += 1) {
            const phi = (2 * Math.PI * j) / segments;
            const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
            nrm.push(...n);
            pos.push(n[0] * r, n[1] * r, n[2] * r);
        }
    }
    return { pos, nrm };
}

/** A flat square of cloth at height y over [-h, h]², n×n vertices, with its triangles. */
function square(y, h, n) {
    const pos = [];
    const indices = [];
    for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) pos.push(-h + (2 * h * i) / (n - 1), y, -h + (2 * h * j) / (n - 1));
    }
    for (let i = 0; i < n - 1; i += 1) {
        for (let j = 0; j < n - 1; j += 1) {
            const a = i * n + j;
            indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
    }
    return { pos, indices };
}

const R = 0.1;
const body = sphere(R);

function radiusOf(p, v) {
    return Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
}

describe('SW1 — pushing cloth back out of her', () => {
    test('cloth sunk 2 cm into her comes out to the clearance, and the report says so', () => {
        const cloth = square(R - 0.02, 0.03, 9); // its middle is 2 cm inside the sphere
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'dress', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices }],
        });
        const out = garments[0].positions;
        for (let v = 0; v < out.length / 3; v += 1) {
            expect(radiusOf(out, v)).toBeGreaterThan(R + C.DEFAULTS.clearance - 0.0012); // sampled sphere
        }
        expect(garments[0].before.maxPenetrationMm).toBeGreaterThan(15);
        expect(garments[0].after.maxPenetrationMm).toBeLessThan(1);
        expect(garments[0].after.penetratingPct).toBe(0);
    });

    test('cloth already outside, at its rest lengths, is left exactly where skinning put it', () => {
        const cloth = square(R + 0.03, 0.02, 5);
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'top', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices }],
        });
        expect(Array.from(garments[0].positions)).toEqual(Array.from(Float32Array.from(cloth.pos)));
    });

    test('a vertex that may not move does not, however deep it is', () => {
        const cloth = square(R - 0.02, 0.03, 9);
        const movable = new Array(cloth.pos.length / 3).fill(1);
        const centre = 40; // the middle vertex of a 9×9 grid
        movable[centre] = 0;
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'boot', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices, movable }],
        });
        const out = garments[0].positions;
        const given = Float32Array.from(cloth.pos); // positions are float32 on both sides
        expect([out[centre * 3], out[centre * 3 + 1], out[centre * 3 + 2]]).toEqual([
            given[centre * 3],
            given[centre * 3 + 1],
            given[centre * 3 + 2],
        ]);
    });

    test('the dress clears the brief under it, not only her skin', () => {
        const brief = square(R - 0.01, 0.02, 7);
        const dress = square(R - 0.015, 0.02, 7);
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [
                { name: 'brief', posed: brief.pos, rest: brief.pos, indices: brief.indices },
                { name: 'dress', posed: dress.pos, rest: dress.pos, indices: dress.indices },
            ],
        });
        const [b, d] = garments.map((g) => g.positions);
        // Over the middle of the patch the dress is outside the brief, by about the clearance.
        const centre = 24;
        expect(radiusOf(d, centre)).toBeGreaterThan(radiusOf(b, centre) + C.DEFAULTS.clearance * 0.5);
    });

    test('a correction starts from what it is given: the same input, the same answer', () => {
        const cloth = square(R - 0.02, 0.03, 7);
        const input = {
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'dress', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices }],
        };
        const a = C.correct(input).garments[0].positions;
        const b = C.correct(input).garments[0].positions;
        expect(Array.from(a)).toEqual(Array.from(b));
        expect(cloth.pos[1]).toBe(R - 0.02); // the input is not modified
    });
});
