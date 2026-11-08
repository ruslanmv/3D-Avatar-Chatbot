/**
 * AX15. What is in an assembled scene, and how close each part comes to her — read in plain Node.
 *
 * Shared by `tools/vr/subset-scene.mjs --list` (choosing which nodes a light stand-in keeps) and
 * `tools/qa/world-audit.mjs` (the VR comfort check on scene nodes). Before this, the only way to see
 * a scene's parts was to load it in a browser: the VW4 session wrote its own Playwright script to
 * list nodes and their distances, and applied the 1 m rule to the stand-in by hand, because
 * `VRWorlds.comfortProblem` checks props and never the nodes of an assembled scene.
 *
 * No browser and no three.js: a GLB's JSON chunk already holds what this needs. glTF requires
 * `min`/`max` on every POSITION accessor, so each mesh's box comes from the accessor bounds
 * (dequantized when KHR_mesh_quantization stores them as normalized integers), carried through the
 * node hierarchy's matrices to the scene root, then placed the way VRWorlds places a scene:
 * scale, then `rotation.y = turn`, then `position = at` (ViewerEngine's world build). She stands at
 * the origin of that placed space.
 *
 * "Top-level node" means what subset-scene's recipes index: descend from the scene's roots while
 * there is exactly one node with children and no mesh (the kits wrap everything in one or two
 * empty parents), then take that node's children.
 *
 * A box is an axis-aligned bound, so it over-reaches for anything L-shaped or hollow: a room's
 * shell contains her. The distance is from the box to her body (a vertical segment from the floor
 * to 1.8 m at the origin) — 0 means the box contains or touches her.
 */
import fs from 'node:fs';

const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
export const HER_HEIGHT = 1.8;

export function readGlb(file) {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
    const len = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
    return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

// ── 4×4 column-major matrices, as glTF stores them ─────────────────────────
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
function trs(node) {
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
function apply(m, p) {
    return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

function accessorBounds(json, index) {
    const a = json.accessors[index];
    if (!a || !a.min || !a.max) return null;
    const d = a.normalized && NORM[a.componentType];
    const f = (v) => (d ? Math.max(v / d, -1) : v);
    return [a.min.map(f), a.max.map(f)];
}

function emptyBox() {
    return [
        [Infinity, Infinity, Infinity],
        [-Infinity, -Infinity, -Infinity],
    ];
}
function grow(box, m, local) {
    const [lo, hi] = local;
    for (let i = 0; i < 8; i++) {
        const p = apply(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
        for (let k = 0; k < 3; k++) {
            box[0][k] = Math.min(box[0][k], p[k]);
            box[1][k] = Math.max(box[1][k], p[k]);
        }
    }
}

/** Triangles and scene-space box of a node and everything under it. */
function measure(json, nodeIndex, parent, acc) {
    const node = json.nodes[nodeIndex];
    const m = mul(parent, trs(node));
    if (node.mesh != null) {
        for (const prim of json.meshes[node.mesh].primitives || []) {
            const pos = prim.attributes && prim.attributes.POSITION;
            if (pos == null) continue;
            if ((prim.mode == null ? 4 : prim.mode) === 4) {
                const count = prim.indices != null ? json.accessors[prim.indices].count : json.accessors[pos].count;
                acc.triangles += count / 3;
            }
            const b = accessorBounds(json, pos);
            if (b) grow(acc.box, m, b);
        }
    }
    for (const c of node.children || []) measure(json, c, m, acc);
    return acc;
}

/** The nodes subset-scene's recipes index, with each one's triangles and scene-space box. */
export function topNodes(json) {
    const scene = json.scenes[json.scene || 0];
    let list = scene.nodes.slice();
    let parent = IDENTITY;
    while (list.length === 1) {
        const n = json.nodes[list[0]];
        if (n.mesh != null || !(n.children || []).length) break;
        parent = mul(parent, trs(n));
        list = n.children.slice();
    }
    return list.map((index, i) => {
        const r = measure(json, index, parent, { triangles: 0, box: emptyBox() });
        const name = json.nodes[index].name || `node-${index}`;
        const kit = parseInt(name, 10);
        return {
            order: i,
            index: Number.isFinite(kit) ? kit : i,
            name,
            triangles: Math.round(r.triangles),
            box: Number.isFinite(r.box[0][0]) ? r.box : null,
        };
    });
}

/** Scene space → the placed world (scale, turn about Y, then `at`); still axis-aligned. */
export function placeBox(box, spec) {
    if (!box) return null;
    const s = spec && spec.scale ? spec.scale : 1;
    const t = (((spec && spec.turn) || 0) * Math.PI) / 180;
    const at = (spec && spec.at) || [0, 0, 0];
    // three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos
    const m = [
        Math.cos(t) * s,
        0,
        -Math.sin(t) * s,
        0,
        0,
        s,
        0,
        0,
        Math.sin(t) * s,
        0,
        Math.cos(t) * s,
        0,
        at[0],
        at[1],
        at[2],
        1,
    ];
    const out = emptyBox();
    grow(out, m, box);
    return out;
}

/** Metres from a placed box to her body: the segment x = z = 0, 0 ≤ y ≤ 1.8. */
export function distanceToHer(box) {
    if (!box) return Infinity;
    const gap = (lo, hi, a, b) => Math.max(lo - b, 0, a - hi);
    const dx = gap(box[0][0], box[1][0], 0, 0);
    const dy = gap(box[0][1], box[1][1], 0, HER_HEIGHT);
    const dz = gap(box[0][2], box[1][2], 0, 0);
    return Math.hypot(dx, dy, dz);
}

/**
 * Floor: anything whose top is at or below her feet (a stage deck she stands on is 0.9 m thick),
 * or a thin piece just above them (a rug, a deck plate's lip). The floor is meant to touch her.
 */
export function isFloorPiece(box) {
    if (!box) return false;
    return box[1][1] <= 0.1 || (box[1][1] - box[0][1] < 0.2 && box[1][1] < 0.25);
}

/** A room shell: a box that holds her with room to spare on both sides — not something in reach. */
export function isEnclosure(box) {
    if (!box) return false;
    return box[0][0] < -2 && box[1][0] > 2 && box[0][2] < -2 && box[1][2] > 2;
}

/** Every top-level node of a GLB placed by a world's `scene` spec, nearest to her first. */
export function inspect(file, spec) {
    const nodes = topNodes(readGlb(file)).map((n) => {
        const placed = placeBox(n.box, spec);
        return {
            ...n,
            placed,
            distance: distanceToHer(placed),
            floor: isFloorPiece(placed),
            enclosure: isEnclosure(placed),
        };
    });
    nodes.sort((a, b) => a.distance - b.distance || a.order - b.order);
    let total = 0;
    for (const n of nodes) n.runningTriangles = total += n.triangles;
    return nodes;
}
