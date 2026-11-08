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

/**
 * The square again, split down its middle column the way a glTF exporter splits a UV seam: the
 * right half's triangles use their own copies of that column's vertices, at the same positions.
 */
function seamed(y, h, n) {
    const { pos, indices } = square(y, h, n);
    const mid = Math.floor(n / 2);
    const copy = {};
    for (let j = 0; j < n; j += 1) {
        const v = mid * n + j;
        copy[v] = pos.length / 3;
        pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (let t = 0; t < indices.length; t += 3) {
        const tri = indices.slice(t, t + 3);
        const right = tri.some((v) => Math.floor(v / n) > mid);
        if (right) for (let k = 0; k < 3; k += 1) if (copy[tri[k]] !== undefined) indices[t + k] = copy[tri[k]];
    }
    return { pos, indices, copy };
}

function faceNormal(p, indices, t) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

describe('SW3 — seams, pieces of one garment, folds and shoes', () => {
    test("a seam's two copies of a vertex are corrected as one and end where each other is", () => {
        const cloth = seamed(R - 0.02, 0.03, 9);
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'dress', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices }],
        });
        const out = garments[0].positions;
        for (const [v, c] of Object.entries(cloth.copy)) {
            for (let k = 0; k < 3; k += 1) expect(out[c * 3 + k]).toBe(out[Number(v) * 3 + k]);
        }
        expect(garments[0].after.maxPenetrationMm).toBeLessThan(1);
    });

    test("pieces of one garment are one cloth: a boot's lining is not pushed out through its shell", () => {
        const shell = square(R - 0.006, 0.02, 7);
        const lining = square(R - 0.01, 0.02, 7);
        const run = (group) =>
            C.correct({
                bodyPos: body.pos,
                bodyNrm: body.nrm,
                garments: [
                    { name: 'shell', posed: shell.pos, rest: shell.pos, indices: shell.indices, group },
                    { name: 'lining', posed: lining.pos, rest: lining.pos, indices: lining.indices, group },
                ],
            }).garments.map((g) => g.positions);
        const centre = 24;
        const [s1, l1] = run(undefined);
        expect(radiusOf(l1, centre)).toBeGreaterThan(radiusOf(s1, centre) + C.DEFAULTS.clearance * 0.5);
        const [s2, l2] = run('boot');
        expect(radiusOf(l2, centre)).toBeLessThan(radiusOf(s2, centre) + 0.0005);
    });

    test('no triangle the correction moves ends turned over against the way skinning faced it', () => {
        const cloth = square(R - 0.03, 0.04, 11);
        const { garments } = C.correct({
            bodyPos: body.pos,
            bodyNrm: body.nrm,
            garments: [{ name: 'dress', posed: cloth.pos, rest: cloth.pos, indices: cloth.indices }],
        });
        const out = garments[0].positions;
        for (let t = 0; t < cloth.indices.length; t += 3) {
            const before = faceNormal(cloth.pos, cloth.indices, t);
            const after = faceNormal(out, cloth.indices, t);
            expect(before[0] * after[0] + before[1] * after[1] + before[2] * after[2]).toBeGreaterThan(0);
        }
    });

    test("a shoe's vertex goes no farther than maxMove from where skinning put it; cloth's may", () => {
        const deep = square(R - 0.045, 0.02, 7); // 45 mm inside her
        const moved = (profile) => {
            const out = C.correct({
                bodyPos: body.pos,
                bodyNrm: body.nrm,
                garments: [{ name: 'x', posed: deep.pos, rest: deep.pos, indices: deep.indices, profile }],
            }).garments[0].positions;
            let most = 0;
            for (let v = 0; v < out.length / 3; v += 1) {
                most = Math.max(
                    most,
                    Math.hypot(
                        out[v * 3] - deep.pos[v * 3],
                        out[v * 3 + 1] - deep.pos[v * 3 + 1],
                        out[v * 3 + 2] - deep.pos[v * 3 + 2]
                    )
                );
            }
            return most;
        };
        expect(moved('shoe')).toBeLessThanOrEqual(C.SHOE.maxMove + 1e-6);
        expect(moved(undefined)).toBeGreaterThan(C.SHOE.maxMove);
    });
});

/**
 * SD1. Two thighs and a pencil-skirt panel. Skinning drops the panel into the opening.
 * The opening is not inside either thigh, so the push leaves it there and the hem parts.
 * A span garment is lifted back onto the support across both thighs. A patch that only
 * covers one thigh is not a bridge and does not move.
 */
function cylinder(cx, cy, radius, z0, z1, segments = 24, rings = 9) {
    const pos = [];
    const nrm = [];
    for (let i = 0; i < rings; i += 1) {
        const z = z0 + ((z1 - z0) * i) / (rings - 1);
        for (let j = 0; j < segments; j += 1) {
            const a = (2 * Math.PI * j) / segments;
            const nx = Math.cos(a);
            const ny = Math.sin(a);
            nrm.push(nx, ny, 0);
            pos.push(cx + nx * radius, cy + ny * radius, z);
        }
    }
    return { pos, nrm };
}

function panel(y, x0, x1, z0, z1, n) {
    const pos = [];
    const indices = [];
    for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
            pos.push(x0 + ((x1 - x0) * i) / (n - 1), y, z0 + ((z1 - z0) * j) / (n - 1));
        }
    }
    for (let i = 0; i < n - 1; i += 1) {
        for (let j = 0; j < n - 1; j += 1) {
            const a = i * n + j;
            indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
    }
    return { pos, indices };
}

describe('SD1 — a skirt panel that falls through the lap', () => {
    const left = cylinder(-0.09, 0.4, 0.06, -0.1, 0.1);
    const right = cylinder(0.09, 0.4, 0.06, -0.1, 0.1);
    const bodyPos = left.pos.concat(right.pos);
    const bodyNrm = left.nrm.concat(right.nrm);
    const cloth = panel(0.48, -0.15, 0.15, -0.06, 0.06, 11);
    const posed = cloth.pos.slice();
    for (let v = 0; v < posed.length / 3; v += 1) {
        if (Math.abs(posed[v * 3]) < 0.16) posed[v * 3 + 1] = 0.4;
    }
    const garment = { name: 'Pencil Mini Skirt', posed, rest: cloth.pos, indices: cloth.indices };

    function gapHeight(positions) {
        const ys = [];
        for (let v = 0; v < positions.length / 3; v += 1) {
            if (Math.abs(positions[v * 3]) < 0.02) ys.push(positions[v * 3 + 1]);
        }
        return Math.min(...ys);
    }

    test('without the span profile the opening stays below the thighs', () => {
        const { garments } = C.correct({ bodyPos, bodyNrm, garments: [garment] });
        expect(gapHeight(garments[0].positions)).toBeLessThan(0.43);
        expect(garments[0].after.maxPenetrationMm).toBeLessThan(1);
        expect(garments[0].after.maxSpanDropMm).toBe(0);
    });

    test('a bridged hem stays up when the cloth over each thigh is held down', () => {
        const movable = new Array(cloth.pos.length / 3).fill(1);
        for (let v = 0; v < movable.length; v += 1) {
            if (Math.abs(cloth.pos[v * 3]) > 0.1) movable[v] = 0;
        }
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ ...garment, profile: 'span', movable }],
        });
        expect(garments[0].after.maxSpanDropMm).toBeLessThan(8);
        expect(garments[0].after.maxEdgeStretch).toBeLessThanOrEqual(6);
        expect(gapHeight(garments[0].positions)).toBeGreaterThan(0.44);
    });

    test('a hem swung up with the knee comes back toward its cut', () => {
        const swung = cloth.pos.slice();
        for (let v = 0; v < swung.length / 3; v += 1) {
            swung[v * 3 + 1] += 0.35;
            swung[v * 3 + 2] += 0.2;
        }
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ ...garment, profile: 'span', posed: swung }],
        });
        const ys = [];
        for (let v = 0; v < garments[0].positions.length / 3; v += 1) {
            if (Math.abs(garments[0].positions[v * 3]) < 0.02) ys.push(garments[0].positions[v * 3 + 1]);
        }
        const avg = ys.reduce((sum, y) => sum + y, 0) / ys.length;
        expect(avg).toBeLessThan(0.7);
        expect(garments[0].after.maxEdgeStretch).toBeLessThanOrEqual(6);
    });

    test('a span skirt is lifted onto the support and the gate passes', () => {
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ ...garment, profile: 'span' }],
        });
        const out = garments[0];
        expect(out.before.maxSpanDropMm).toBeGreaterThan(40);
        expect(out.after.maxSpanDropMm).toBeLessThan(8);
        expect(out.after.maxPenetrationMm).toBeLessThan(1);
        expect(gapHeight(out.positions)).toBeGreaterThan(0.44);
        expect(C.assess(garments).ok).toBe(true);
    });

    test('cloth that only covers one thigh is not pulled across the opening', () => {
        const side = panel(0.47, -0.15, -0.04, -0.04, 0.04, 6);
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ name: 'side', posed: side.pos, rest: side.pos, indices: side.indices, profile: 'span' }],
        });
        const out = garments[0].positions;
        for (let i = 0; i < side.pos.length; i += 1) expect(Math.abs(out[i] - side.pos[i])).toBeLessThan(1e-4);
    });

    test('catalog ids: skirts and dresses span, jeans and a dress shirt do not, shoes stay shoes', () => {
        expect(
            C.profileFor({
                name: 'Pencil Mini Skirt',
                slot: 'Bottoms',
                templateId: 'skirt-glam-pencil-mini-v1',
            })
        ).toBe('span');
        expect(C.profileFor({ name: 'Shirt Dress', slot: 'Onepiece', templateId: 'dress-shirt-v1' })).toBe('span');
        expect(C.profileFor({ name: 'Satin Nightgown', templateId: 'night-nightgown-v1' })).toBe('span');
        expect(
            C.profileFor({ name: 'Straight jeans', slot: 'Bottoms', templateId: 'jeans-straight-v1' })
        ).toBeUndefined();
        expect(C.profileFor({ name: 'White dress shirt', slot: 'Tops', templateId: 'top-shirt-v1' })).toBeUndefined();
        expect(C.profileFor({ name: 'Catsuit', templateId: 'jumpsuit-catsuit-v1' })).toBeUndefined();
        expect(
            C.profileFor({ name: 'Ankle Boots [Forge_Shoes_01_CLOTH]', slot: 'Shoes', templateId: 'shoes-ankle-v1' })
        ).toBe('shoe');
    });

    test('a Forge skirt name is a span even when the caller did not set a profile', () => {
        const named = {
            ...garment,
            name: 'Black Pencil Mini Skirt [Forge_Bottoms_01_CLOTH]',
            slot: 'Bottoms',
            templateId: 'skirt-glam-pencil-mini-v1',
        };
        const { garments } = C.correct({ bodyPos, bodyNrm, garments: [named] });
        expect(garments[0].after.maxSpanDropMm).toBeLessThan(8);
        expect(gapHeight(garments[0].positions)).toBeGreaterThan(0.44);
    });

    test('a span panel whose rest sits below it is not pushed further into the opening', () => {
        const lowRest = cloth.pos.map((value, index) => (index % 3 === 1 ? 0.3 : value));
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ ...garment, profile: 'span', rest: lowRest }],
        });
        const out = garments[0];
        expect(out.before.maxSpanDropMm).toBe(0);
        expect(out.after.maxSpanDropMm).toBe(0);
        expect(gapHeight(out.positions)).toBeGreaterThan(0.39);
        expect(gapHeight(out.positions)).toBeLessThan(0.44);
    });

    test('a span panel that is still on its cut is not counted as a drop', () => {
        const flat = cloth.pos.map((value, index) => (index % 3 === 1 ? 0.4 : value));
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ ...garment, profile: 'span', posed: flat, rest: flat.slice() }],
        });
        expect(garments[0].before.maxSpanDropMm).toBe(0);
        expect(gapHeight(garments[0].positions)).toBeLessThan(0.43);
    });

    test('cloth pinched between two opposing surfaces is not torn apart', () => {
        function sphereAt(cx, cy, cz, r) {
            const raw = sphere(r, 18, 28);
            const pos = [];
            const nrm = raw.nrm;
            for (let i = 0; i < raw.pos.length; i += 3) {
                pos.push(raw.pos[i] + cx, raw.pos[i + 1] + cy, raw.pos[i + 2] + cz);
            }
            return { pos, nrm };
        }
        const left = sphereAt(-0.03, 0, 0, 0.05);
        const right = sphereAt(0.03, 0, 0, 0.05);
        const posed = [0, 0, 0, 0.004, 0, 0, 0, 0.004, 0];
        const { garments } = C.correct({
            bodyPos: left.pos.concat(right.pos),
            bodyNrm: left.nrm.concat(right.nrm),
            garments: [{ name: 'leggings', posed, rest: posed.slice(), indices: [0, 1, 2] }],
        });
        const out = garments[0].positions;
        const stretch = Math.hypot(out[3] - out[0], out[4] - out[1], out[5] - out[2]) / 0.004;
        expect(stretch).toBeLessThan(6);
        expect(garments[0].after.maxEdgeStretch).toBeLessThan(6);
        for (let v = 0; v < 3; v += 1) {
            expect(Math.hypot(out[v * 3], out[v * 3 + 1], out[v * 3 + 2])).toBeLessThan(0.04);
        }
    });

    test('a square merely labelled dress is not treated as a span', () => {
        const { garments } = C.correct({
            bodyPos,
            bodyNrm,
            garments: [{ name: 'dress', posed, rest: cloth.pos, indices: cloth.indices }],
        });
        expect(gapHeight(garments[0].positions)).toBeLessThan(0.43);
    });
});
