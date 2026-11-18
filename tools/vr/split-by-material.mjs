#!/usr/bin/env node
/**
 * VW12. Give a scene exported as one merged mesh one named node per material, in place.
 *
 * Living Worlds spots are measured next to a named thing (`near` in tools/vr/spot-targets.json,
 * matched against top-level node names), and a Sketchfab download is usually one node holding
 * every primitive: nothing to name. Its materials are named, though (`School_blackboards`,
 * `Teacher_desk`, `Altar`), so this moves each primitive into its own mesh and its own top-level
 * node named after its material. Only the GLB's JSON changes: the same accessors, buffers,
 * textures and transforms, so the scene looks exactly as before and nothing is re-encoded.
 * Primitives sharing a material stay together. Run it before measuring spots; a scene with one
 * material gains nothing (use `anywhere` spots there).
 *
 *     node tools/vr/split-by-material.mjs assets/vr-worlds/scenes/<file>.glb
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: split-by-material.mjs <file.glb>');
const buf = fs.readFileSync(file);
const chunks = [];
for (let off = 12; off < buf.length; ) {
    const len = buf.readUInt32LE(off);
    chunks.push({ type: buf.readUInt32LE(off + 4), data: buf.subarray(off + 8, off + 8 + len) });
    off += 8 + len;
}
const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a);
const json = JSON.parse(jsonChunk.data.toString('utf8').replace(/\0+$/, ''));
const scene = json.scenes[json.scene || 0];

// World matrix of every node that holds a mesh, so a primitive keeps its place when its node
// moves to the top level.
function compose(node) {
    if (node.matrix) return node.matrix.slice();
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
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
}
const groups = new Map(); // material index -> { name, parts: [{ primitive, matrix }] }
const walk = (ni, parent) => {
    const node = json.nodes[ni];
    const world = multiply(parent, compose(node));
    if (node.mesh !== undefined && !node.skin) {
        for (const primitive of json.meshes[node.mesh].primitives) {
            const m = primitive.material === undefined ? -1 : primitive.material;
            const name = m >= 0 ? json.materials[m].name || `material-${m}` : 'unmaterialed';
            if (!groups.has(m)) groups.set(m, { name, parts: [] });
            groups.get(m).parts.push({ primitive, matrix: world });
        }
    }
    for (const c of node.children || []) walk(c, world);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const ni of scene.nodes) walk(ni, identity);
if (groups.size < 2) {
    console.log(`${file}: ${groups.size} material, nothing to split (use anywhere spots)`);
    process.exit(0);
}
// One top-level node per material; a primitive under a different transform gets its own child.
json.meshes = [];
json.nodes = [];
scene.nodes = [];
const used = new Set();
for (const { name, parts } of groups.values()) {
    let label = name.replace(/\s+\(Instance\)$/, '');
    while (used.has(label)) label += '_';
    used.add(label);
    const byMatrix = new Map();
    for (const p of parts) {
        const key = p.matrix.map((v) => v.toFixed(6)).join(',');
        if (!byMatrix.has(key)) byMatrix.set(key, { matrix: p.matrix, primitives: [] });
        byMatrix.get(key).primitives.push(p.primitive);
    }
    const children = [];
    for (const { matrix, primitives } of byMatrix.values()) {
        json.meshes.push({ name: label, primitives });
        json.nodes.push({ name: label, mesh: json.meshes.length - 1, matrix });
        children.push(json.nodes.length - 1);
    }
    json.nodes.push({ name: label, children });
    scene.nodes.push(json.nodes.length - 1);
}
delete json.skins;
json.animations = (json.animations || []).filter(() => false);
if (!json.animations.length) delete json.animations;
let text = JSON.stringify(json);
while (Buffer.byteLength(text) % 4) text += ' ';
const out = [Buffer.from(text)];
const parts = [{ type: 0x4e4f534a, data: Buffer.from(text) }, ...chunks.filter((c) => c.type !== 0x4e4f534a)];
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
const body = parts.map((c) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(c.data.length, 0);
    h.writeUInt32LE(c.type, 4);
    return Buffer.concat([h, c.data]);
});
header.writeUInt32LE(12 + body.reduce((n, b) => n + b.length, 0), 8);
fs.writeFileSync(file, Buffer.concat([header, ...body]));
void out;
console.log(`${file}: ${groups.size} materials → top-level nodes: ${[...used].join(', ')}`);
