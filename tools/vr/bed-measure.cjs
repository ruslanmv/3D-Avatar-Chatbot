/**
 * BS1. Where a room's bed is, measured from the bed's own GLB and its prop entry, never typed.
 *
 * A prop is placed with its box centred on `at` (x, z) and its bottom on `at[1]`, uniformly
 * scaled to its `width` (or `height`) — VRWorlds `placementOffset`/`fitScale`. So the bed's centre
 * is its `at`, and the mattress top is found in the model: the highest vertex in the middle of the
 * bed (away from the headboard, the posts and the pillows' ends), scaled. Private lays her there
 * for the positions done on a bed (src/experiences/private/PrivateBed.js).
 *
 * Shared by tools/vr/measure-bed.mjs (writes `bed` into worlds.json) and its test, which measures
 * again and must agree — a model changed without re-measuring fails the gate.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const BED_SRC = /\/bed(Double|Single)\.glb$/;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** A node's local matrix (column-major 4x4) from its matrix or its translation, rotation, scale. */
function local(node) {
    if (Array.isArray(node.matrix)) return node.matrix.slice();
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    return [
        (1 - 2 * (y * y + z * z)) * sx,
        2 * (x * y + z * w) * sx,
        2 * (x * z - y * w) * sx,
        0,
        2 * (x * y - z * w) * sy,
        (1 - 2 * (x * x + z * z)) * sy,
        2 * (y * z + x * w) * sy,
        0,
        2 * (x * z + y * w) * sz,
        2 * (y * z - x * w) * sz,
        (1 - 2 * (x * x + y * y)) * sz,
        0,
        tx,
        ty,
        tz,
        1,
    ];
}

function multiply(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1)
        for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}

/** Every vertex position of a GLB in model space, through each node's full transform. */
function positions(file) {
    const b = fs.readFileSync(file);
    const jsonLen = b.readUInt32LE(12);
    const json = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
    const bin = b.slice(20 + jsonLen + 8);
    const out = [];
    const tris = [];
    const visit = (index, parent) => {
        const node = json.nodes[index];
        const m = multiply(parent, local(node));
        if (node.mesh != null) {
            for (const p of json.meshes[node.mesh].primitives) {
                const acc = json.accessors[p.attributes.POSITION];
                const view = json.bufferViews[acc.bufferView];
                const stride = view.byteStride || 4 * COMPONENTS[acc.type];
                const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
                const first = out.length;
                for (let i = 0; i < acc.count; i += 1) {
                    const o = base + i * stride;
                    const x = bin.readFloatLE(o);
                    const y = bin.readFloatLE(o + 4);
                    const z = bin.readFloatLE(o + 8);
                    out.push([
                        m[0] * x + m[4] * y + m[8] * z + m[12],
                        m[1] * x + m[5] * y + m[9] * z + m[13],
                        m[2] * x + m[6] * y + m[10] * z + m[14],
                    ]);
                }
                // Its triangles, by index into `out` (indexed or not).
                if (p.indices != null) {
                    const ia = json.accessors[p.indices];
                    const iv = json.bufferViews[ia.bufferView];
                    const ib = (iv.byteOffset || 0) + (ia.byteOffset || 0);
                    const size = ia.componentType === 5125 ? 4 : ia.componentType === 5123 ? 2 : 1;
                    const read = (k) =>
                        size === 4
                            ? bin.readUInt32LE(ib + k * 4)
                            : size === 2
                              ? bin.readUInt16LE(ib + k * 2)
                              : bin.readUInt8(ib + k);
                    for (let k = 0; k + 2 < ia.count; k += 3)
                        tris.push([first + read(k), first + read(k + 1), first + read(k + 2)]);
                } else for (let k = 0; k + 2 < acc.count; k += 3) tris.push([first + k, first + k + 1, first + k + 2]);
            }
        }
        for (const c of node.children || []) visit(c, m);
    };
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const scene = json.scenes[json.scene || 0];
    for (const n of scene.nodes) visit(n, identity);
    out.triangles = tris;
    return out;
}

/** The highest surface a vertical line at (x, z) crosses: the y where it meets each triangle. */
function surfaceAt(pts, x, z) {
    let top = -Infinity;
    for (const [a, b, c] of pts.triangles) {
        const A = pts[a];
        const B = pts[b];
        const C = pts[c];
        const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
        if (Math.abs(d) < 1e-12) continue; // seen edge-on from above
        const u = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d;
        const v = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        top = Math.max(top, u * A[1] + v * B[1] + (1 - u - v) * C[1]);
    }
    return top;
}

/**
 * The bed of one prop entry, in the place's metres: centre (x, z), mattress top, its long side.
 * Only beds turned 0/±90/180 degrees (all the rooms' beds); anything else is refused.
 */
function measure(prop, file) {
    const pts = positions(file);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of pts)
        for (let k = 0; k < 3; k += 1) ((min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k])));
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const scale = prop.height ? prop.height / size[1] : prop.width / Math.max(size[0], size[2]);
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    // The mattress top in the middle of the bed, where she lies: the median of a few vertical lines
    // around the centre, so a pillow's edge or a seam cannot decide it.
    const samples = [];
    for (const fx of [-0.15, 0, 0.15])
        for (const fz of [-0.1, 0, 0.1]) samples.push(surfaceAt(pts, cx + fx * size[0], cz + fz * size[2]));
    const found = samples.filter(Number.isFinite).sort((p, q) => p - q);
    if (!found.length) throw new Error(`${file}: no surface found over the middle of the bed`);
    const top = found[Math.floor(found.length / 2)];
    const turn = (((Number(prop.turn) || 0) % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(turn)) throw new Error('only a bed turned by a right angle can be measured');
    const long = Math.max(size[0], size[2]) * scale;
    return {
        at: [round(prop.at[0]), round(prop.at[2])],
        top: round((top - min[1]) * scale + (Number(prop.at[1]) || 0)),
        length: round(long),
        src: prop.src,
        sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16),
    };
}

function round(x) {
    return Math.round(x * 1000) / 1000;
}

/** The bed prop of a world entry, or null. */
function bedProp(world) {
    return (world.props || []).find((p) => BED_SRC.test(String(p.src || ''))) || null;
}

module.exports = { measure, bedProp, positions, BED_SRC };
