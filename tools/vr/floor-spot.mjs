#!/usr/bin/env node
/**
 * VW10. Where she stands in a scene that is one merged mesh: measured on its real floor.
 *
 * `clear-spot.mjs` works from top-level node boxes, and `measure-spots.mjs` stands her near a named
 * thing. A room exported as a single merged mesh (most Sketchfab downloads: the Japanese school
 * corridor, hallway, stairs, the subway car) has one box that covers the whole room and no named
 * things, so both find nothing. This reads the GLB's triangles with the vendored three r147 and:
 *
 *   1. casts rays straight down on a 20 cm grid; a point is floor when the first hit faces up and
 *      lies within 25 cm of the scene's lowest broad floor height (not a desk top, not a stair);
 *   2. keeps a point only if she fits: nothing within BODY m at ankle, hip, chest and head height
 *      in 24 directions;
 *   3. for each of 16 facings, requires the person's place 1 m in front of her to be floor with
 *      the same clearance, and measures how far the view runs open at chest height (up to 5 m);
 *   4. picks the point and facing with the longest open view, ties to the most clearance.
 *
 * Prints `scene.at` / `turn` in worlds.json's convention (she stays at the origin facing +z; the
 * room is moved and turned). No browser, no network.
 *
 *     node tools/vr/floor-spot.mjs scenes/anime-school-corridor.glb
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREE = await import(path.join(ROOT, 'vendor/three-0.147.0/build/three.module.js'));

const BODY = 0.3;
const HEIGHTS = [0.15, 0.9, 1.3, 1.6];
const GRID = 0.2;
const VIEW_MAX = 5;

function readGlb(file) {
    const buf = fs.readFileSync(file);
    let json = null;
    let bin = null;
    for (let off = 12; off < buf.length; ) {
        const len = buf.readUInt32LE(off);
        const type = buf.readUInt32LE(off + 4);
        const chunk = buf.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
        else if (type === 0x004e4942) bin = chunk;
        off += 8 + len;
    }
    return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
};

function accessor(g, i) {
    const a = g.json.accessors[i];
    const view = g.json.bufferViews[a.bufferView];
    const Kind = ARRAYS[a.componentType];
    const n = COMPONENTS[a.type];
    const stride = view.byteStride || n * Kind.BYTES_PER_ELEMENT;
    const base = (view.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float32Array(a.count * n);
    const dv = new DataView(g.bin.buffer, g.bin.byteOffset);
    const get = {
        5120: (o) => dv.getInt8(o),
        5121: (o) => dv.getUint8(o),
        5122: (o) => dv.getInt16(o, true),
        5123: (o) => dv.getUint16(o, true),
        5125: (o) => dv.getUint32(o, true),
        5126: (o) => dv.getFloat32(o, true),
    }[a.componentType];
    for (let k = 0; k < a.count; k++)
        for (let c = 0; c < n; c++) out[k * n + c] = get(base + k * stride + c * Kind.BYTES_PER_ELEMENT);
    return out;
}

function sceneMeshes(g) {
    const meshes = [];
    const visit = (ni, parent) => {
        const node = g.json.nodes[ni];
        const local = new THREE.Matrix4();
        if (node.matrix) local.fromArray(node.matrix);
        else
            local.compose(
                new THREE.Vector3(...(node.translation || [0, 0, 0])),
                new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
                new THREE.Vector3(...(node.scale || [1, 1, 1]))
            );
        const world = parent.clone().multiply(local);
        if (node.mesh !== undefined) {
            for (const prim of g.json.meshes[node.mesh].primitives) {
                if (prim.mode !== undefined && prim.mode !== 4) continue;
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(accessor(g, prim.attributes.POSITION), 3));
                if (prim.indices !== undefined)
                    geo.setIndex(Array.from(accessor(g, prim.indices), (v) => Math.round(v)));
                geo.applyMatrix4(world);
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
                mesh.updateMatrixWorld(true);
                meshes.push(mesh);
            }
        }
        for (const c of node.children || []) visit(c, world);
    };
    const scene = g.json.scenes[g.json.scene || 0];
    for (const ni of scene.nodes) visit(ni, new THREE.Matrix4());
    return meshes;
}

function main() {
    const rel = process.argv[2];
    if (!rel) throw new Error('usage: floor-spot.mjs scenes/<file>.glb');
    const meshes = sceneMeshes(readGlb(path.join(ROOT, 'assets/vr-worlds', rel)));
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const first = (from, dir, far) => {
        ray.set(from, dir);
        ray.far = far;
        const hit = ray.intersectObjects(meshes, false)[0];
        return hit || null;
    };
    const upward = (x, z) => {
        ray.set(new THREE.Vector3(x, box.max.y + 1, z), down);
        ray.far = box.max.y - box.min.y + 2;
        const out = [];
        for (const hit of ray.intersectObjects(meshes, false)) {
            if (!hit.face) continue;
            const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            if (n.y > 0.9) out.push(hit.point.y);
        }
        return out;
    };
    // 1. Floor samples, then the floor height: the lowest height that many samples share.
    const samples = [];
    for (let x = box.min.x + GRID / 2; x < box.max.x; x += GRID)
        for (let z = box.min.z + GRID / 2; z < box.max.z; z += GRID) {
            // Every surface on this vertical line, not only the first: inside a closed room the
            // first one down is the ceiling. A floor faces up; a ceiling faces down.
            for (const y of upward(x, z)) samples.push({ x, z, y });
        }
    if (!samples.length) throw new Error('no upward surface found');
    const bins = new Map();
    for (const s of samples) {
        const k = Math.round(s.y * 10);
        bins.set(k, (bins.get(k) || 0) + 1);
    }
    const enough = Math.max(20, samples.length * 0.05);
    // The lowest broad up-facing level; a stray quad under the room (a buried plane) is too few.
    const floorY = Math.min(...[...bins].filter(([, c]) => c >= enough).map(([k]) => k)) / 10;
    // A floor point must have its own ceiling-free headroom: nothing within 1.8 m above it.
    const floor = samples.filter(
        (s) =>
            Math.abs(s.y - floorY) <= 0.25 &&
            !first(new THREE.Vector3(s.x, s.y + 0.05, s.z), new THREE.Vector3(0, 1, 0), 1.8)
    );
    const isFloor = (x, z) => upward(x, z).some((y) => Math.abs(y - floorY) <= 0.25);
    const fits = (x, z, y) => {
        for (const h of HEIGHTS)
            for (let a = 0; a < 24; a++) {
                const t = (a / 24) * Math.PI * 2;
                if (first(new THREE.Vector3(x, y + h, z), new THREE.Vector3(Math.sin(t), 0, Math.cos(t)), BODY))
                    return false;
            }
        return true;
    };
    // How much room she has: the nearest geometry around her at chest height, up to 1.5 m.
    const room = (x, z, y) => {
        let near = 1.5;
        for (let a = 0; a < 24; a++) {
            const t = (a / 24) * Math.PI * 2;
            const hit = first(new THREE.Vector3(x, y + 1.3, z), new THREE.Vector3(Math.sin(t), 0, Math.cos(t)), 1.5);
            if (hit) near = Math.min(near, hit.distance);
        }
        return near;
    };
    // 2-4. Best point and facing: the longest open view first, then the most room around her (a
    // corner with a long diagonal view is not where anyone stands to talk).
    let best = null;
    for (const s of floor) {
        if (!fits(s.x, s.z, s.y)) continue;
        const space = room(s.x, s.z, s.y);
        for (let f = 0; f < 16; f++) {
            const t = (f / 16) * Math.PI * 2;
            const dir = new THREE.Vector3(Math.sin(t), 0, Math.cos(t));
            const px = s.x + dir.x;
            const pz = s.z + dir.z;
            if (!isFloor(px, pz) || !fits(px, pz, s.y)) continue;
            const hit = first(new THREE.Vector3(s.x, s.y + 1.3, s.z), dir, VIEW_MAX);
            const view = hit ? hit.distance : VIEW_MAX;
            if (view < 2.5) continue;
            const score = Math.min(view, VIEW_MAX) + space * 2;
            if (!best || score > best.score + 1e-6)
                best = { x: s.x, z: s.z, y: s.y, turn: (t * 180) / Math.PI, view, space, score };
        }
    }
    if (!best) {
        console.log(`${rel}: no floor point where she and the person both fit with 2.5 m of view`);
        process.exit(1);
    }
    // worlds.json: she stays at the origin facing +z; the scene is turned by -turn, then moved.
    const r = (-best.turn * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const rx = best.x * c + best.z * s;
    const rz = -best.x * s + best.z * c;
    const at = [-rx, -best.y, -rz].map((v) => Math.round(v * 1000) / 1000 + 0);
    const turn = Math.round(-best.turn + 360) % 360;
    console.log(
        `${rel}: floor at y=${floorY.toFixed(2)}, she stands at (${best.x.toFixed(2)}, ${best.z.toFixed(2)}), ` +
            `${best.view.toFixed(1)} m open view, ${best.space.toFixed(2)} m around her, ${floor.length} floor samples`
    );
    console.log(`  "at": [${at.join(', ')}], "turn": ${turn}`);
}

main();
