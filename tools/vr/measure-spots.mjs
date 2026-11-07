#!/usr/bin/env node
/**
 * LW2. Measure where she can stand in a place: verified spots, by raycasting the real model.
 *
 * Why this exists. A place used to have one spot (`scene.at` in worlds.json), found by hand. Living
 * Worlds needs several per place (by the sofa, in the kitchen, by the bed) so she can move within
 * the place she and the person are in, without the world being swapped. A spot that is wrong is
 * worse than none: she stands inside the sofa, behind a wall from the camera, or in the shower,
 * and the conversation then describes a room she is not in. So no coordinate is typed in. This
 * loads the scene's GLB with the vendored three r147 (the version the app runs), in headless
 * Chromium with every file served from this repository, and for each spot named in
 * `tools/vr/spot-targets.json`:
 *
 *   1. finds the thing it is for (top-level node names matched by `near`) and its bounding box;
 *   2. tries every floor point 0.3–1.3 m from it on a 10 cm grid. A point counts only if a ray
 *      straight down hits an upward-facing surface at the scene's floor height (not a rug edge
 *      over a step, not a table top);
 *   3. keeps it only if she fits: no geometry within BODY_RADIUS at ankle, hip, chest and head
 *      height in 24 directions, and floor all around her;
 *   4. keeps it only if the thing is really in the same room: a ray from her chest to it reaches
 *      it before anything else (a wall, a door);
 *   5. turns her to face the person, the way every place is shown (the person stands 1 m in
 *      front of her, +z of the place). The facing must leave VIEW_CLEAR metres of open air at
 *      chest and eye height, and floor where the person stands. This is the comfort rule of
 *      VRWorlds.comfortProblem (nothing within 1 m of the person, nothing between the two of
 *      you) checked against the room's real walls and furniture, not only against props;
 *   5b. keeps the facing only if the screen's camera, 4.7 m away along it (the farthest any
 *      device frames her), sees all of her: rays from three camera points to five body points,
 *      feet to head and across her width, cross nothing. Only if no point passes is
 *      CameraPresets' 'mid' camera tried (knees up, 2.3 m), then 'bust'; the spot records which
 *      framing it needs. Faces are measured double-sided, so no wall is invisible from behind;
 *   6. stays at least minSpacing from every spot measured before it in the same scene: two spots
 *      on one patch of floor are one place to stand, not two places to go;
 *   7. scores what is left: more open view, the thing visible beside or behind her (so the camera
 *      sees what she is near), and closer is better. The best one wins.
 *
 * A spot that finds no point is written `verified: false` with the reason, and the app never
 * offers it. Writes `assets/vr-worlds/spots/<scene-stem>.json` with the measurements, the source
 * file's SHA-256 (a changed model invalidates the spots: a test re-hashes it) and this tool's
 * version. Nothing in worlds.json changes.
 *
 *     node tools/vr/measure-spots.mjs                         # every scene in spot-targets.json
 *     node tools/vr/measure-spots.mjs scenes/pixel-flat-home.glb
 *     node tools/vr/measure-spots.mjs --check                 # measure and print, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const TOOL_VERSION = 5;
/** Her body, for clearance: a 0.32 m radius column, checked at four heights above the floor. */
const PARAMS = {
    bodyRadius: 0.32,
    bodyHeights: [0.12, 0.55, 1.05, 1.55],
    gridStep: 0.1,
    minFromThing: 0.3,
    maxFromThing: 1.3,
    floorTolerance: 0.06,
    viewClear: 2.2,
    viewHeights: [0.95, 1.5],
    personAt: 1.0,
    personRadius: 0.28,
    facingSteps: 72,
    /**
     * Where the screen's camera is, measured in the real app (LW3 walkthrough, 2026-11-07): in
     * front of her along her facing, 3.8–4.65 m away (desktop 4.49, iPhone 13 3.8, Pixel 7 4.65),
     * at 0.95 m. The first measurement checked only the VR person's 2.2 m and four of six spots
     * came out behind a wall or an exercise bike on the screen. Every spot must now be seen from
     * there: rays from three points around the camera to five points of her body, feet to head.
     */
    camera: { distance: 4.7, height: 0.95, lateral: [-0.3, 0, 0.3] },
    bodyPoints: [0.08, 0.45, 0.85, 1.15, 1.45],
    /**
     * A small room cannot be seen whole from 4.7 m: every full-body sightline into the bedroom
     * crosses a wall. CameraPresets' existing 'bust' framing (≈0.9 m from her upper chest) is the
     * safe framing for such a spot. Tried only when no full-body point exists; the spot then
     * records framing 'bust' and the screen switches to it while the view is black.
     */
    /** CameraPresets 'mid' (LW3): knees up, ≈2.2 m (1.35 × her height) at chest height. */
    mid: { distance: 2.3, height: 1.1, lateral: [-0.25, 0, 0.25], bodyPoints: [0.45, 0.85, 1.15, 1.45] },
    bust: { distance: 1.0, height: 1.3, lateral: [-0.15, 0, 0.15], bodyPoints: [1.0, 1.25, 1.5] },
    /** Sightlines go to her whole width, not only her centre line: clutter at her side is in frame. */
    bodyWidth: [-0.3, 0, 0.3],
    /** Two spots closer than this are one place to stand, not two places to go. */
    minSpacing: 1.2,
};

const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vr/spot-targets.json'), 'utf8')).scenes;
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));
const todo = Object.entries(targets).filter(([src]) => !only.length || only.includes(src));
if (!todo.length) {
    console.error('No scene matches', only.join(', '));
    process.exit(1);
}

const ORIGIN = 'http://spots.local';
const PAGE = `<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three-0.147.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-0.147.0/examples/jsm/loaders/GLTFLoader.js';
const r2 = (v) => Math.round(v * 1000) / 1000;
window.measure = async (src, spots, P) => {
    const g = await new GLTFLoader().loadAsync('/assets/vr-worlds/' + src);
    const scene = g.scene;
    // Two copies of the room. SOLID: every face blocks from both sides — her body must never be
    // inside a wall, and a one-sided wall seen from behind is still a wall to stand in (the first
    // measurement put her half inside the desk wall). AS DRAWN: the renderer's own materials, for
    // what the camera sees — a one-sided wall facing away is invisible on screen, which is how a
    // camera outside a room sees into it. Sightlines are cast from the camera toward her, as it looks.
    scene.updateMatrixWorld(true);
    const drawn = [];
    scene.traverse((m) => {
        if (!m.isMesh) return;
        const v = new THREE.Mesh(m.geometry, [].concat(m.material).map((x) => x.clone()).length > 1
            ? [].concat(m.material).map((x) => x.clone()) : m.material.clone());
        v.matrixWorld.copy(m.matrixWorld);
        v.matrixAutoUpdate = false;
        drawn.push(v);
    });
    scene.traverse((m) => {
        if (m.material) [].concat(m.material).forEach((x) => { x.side = THREE.DoubleSide; });
    });
    scene.updateMatrixWorld(true);
    let root = scene;
    while (root.children.length === 1 && !root.children[0].isMesh) root = root.children[0];
    const meshes = [];
    scene.traverse((m) => {
        if (m.isMesh) meshes.push(m);
    });
    const ray = new THREE.Raycaster();
    const DOWN = new THREE.Vector3(0, -1, 0);
    const topOf = (o) => { let n = o; while (n.parent && n.parent !== root) n = n.parent; return n; };
    function first(origin, dir, far, set) {
        ray.set(origin, dir); ray.far = far;
        const hits = ray.intersectObjects(set || meshes, false);
        return hits.length ? hits[0] : null;
    }
    // The floor height: the most common height of upward faces hit straight down across the scene.
    const sceneBox = new THREE.Box3().setFromObject(root);
    const votes = new Map();
    for (let x = sceneBox.min.x; x <= sceneBox.max.x; x += 0.25)
        for (let z = sceneBox.min.z; z <= sceneBox.max.z; z += 0.25) {
            const h = first(new THREE.Vector3(x, sceneBox.max.y + 1, z), DOWN, 1e3);
            if (!h || !h.face) continue;
            const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
            if (n.y < 0.9) continue;
            const k = Math.round(h.point.y * 50) / 50;
            votes.set(k, (votes.get(k) || 0) + 1);
        }
    const floorY = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    function floorAt(x, z) {
        const h = first(new THREE.Vector3(x, floorY + 2.1, z), DOWN, 3);
        if (!h || !h.face) return null;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y < 0.9 || Math.abs(h.point.y - floorY) > P.floorTolerance) return null;
        return h.point.y;
    }
    function clearRadius(x, y, z, radius) {
        for (const hgt of P.bodyHeights) {
            for (let k = 0; k < 24; k++) {
                const a = (k / 24) * Math.PI * 2;
                const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
                if (first(new THREE.Vector3(x, y + hgt, z), d, radius)) return false;
            }
        }
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            if (floorAt(x + Math.sin(a) * radius, z + Math.cos(a) * radius) == null) return false;
        }
        return true;
    }
    function openAlong(x, y, z, yaw) {
        const d = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        let open = 6;
        for (const hgt of P.viewHeights) {
            const h = first(new THREE.Vector3(x, y + hgt, z), d, 6);
            if (h) open = Math.min(open, h.distance);
        }
        return open;
    }
    function cameraSees(x, y, z, yaw, cfg) {
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        for (const lat of cfg.lateral) {
            const cam = new THREE.Vector3(
                x + fx * cfg.distance + rx * lat,
                y + cfg.height,
                z + fz * cfg.distance + rz * lat
            );
            for (const h of cfg.bodyPoints) for (const w of P.bodyWidth) {
                const body = new THREE.Vector3(x + rx * w, y + h, z + rz * w);
                const dir = body.clone().sub(cam);
                const len = dir.length();
                if (first(cam, dir.normalize(), len - 0.2, drawn)) return false;
            }
        }
        return true;
    }
    const results = [];
    const taken = [];
    for (const spot of spots) {
        const res = (spot.near || []).map((s) => new RegExp(s));
        const things = root.children.filter((c) => res.some((re) => re.test(c.name)));
        if (!things.length) { results.push({ id: spot.id, verified: false, why: 'no node matches ' + spot.near.join(', ') }); continue; }
        const box = new THREE.Box3(); things.forEach((t) => box.expandByObject(t));
        const centre = box.getCenter(new THREE.Vector3());
        let best = null; let tried = 0; const why = { floor: 0, body: 0, room: 0, view: 0 };
        for (const framing of ['fullBody', 'mid', 'bust']) {
        if (best) break;
        const cfg = framing === 'fullBody' ? { ...P.camera, bodyPoints: P.bodyPoints } : P[framing];
        for (let x = box.min.x - P.maxFromThing; x <= box.max.x + P.maxFromThing; x += P.gridStep)
            for (let z = box.min.z - P.maxFromThing; z <= box.max.z + P.maxFromThing; z += P.gridStep) {
                const dx = Math.max(box.min.x - x, 0, x - box.max.x), dz = Math.max(box.min.z - z, 0, z - box.max.z);
                const dist = Math.hypot(dx, dz);
                if (dist < P.minFromThing || dist > P.maxFromThing) continue;
                if (taken.some((t) => Math.hypot(t[0] - x, t[1] - z) < P.minSpacing)) continue;
                tried++;
                const y = floorAt(x, z); if (y == null) { why.floor++; continue; }
                if (!clearRadius(x, y, z, P.bodyRadius)) { why.body++; continue; }
                // Same room: from her chest, the first thing toward the object is the object.
                // v5: a low or wide thing (a strip of footlights at the stage edge, a curtain) is
                // missed by a chest-height aim that passes over it, so the nearest point of its top
                // edge is tried too. Either line reaching it first means the same room.
                const from = new THREE.Vector3(x, y + 1.0, z);
                const near = new THREE.Vector3(
                    Math.min(Math.max(x, box.min.x), box.max.x),
                    box.max.y - 0.02,
                    Math.min(Math.max(z, box.min.z), box.max.z)
                );
                const aims = [new THREE.Vector3(centre.x, Math.min(Math.max(centre.y, y + 0.4), y + 1.0), centre.z), near];
                const sees = aims.some((aim) => {
                    const hit = first(from, aim.clone().sub(from).normalize(), from.distanceTo(aim) + 0.5);
                    return Boolean(hit && things.includes(topOf(hit.object)));
                });
                if (!sees) { why.room++; continue; }
                for (let k = 0; k < P.facingSteps; k++) {
                    const yaw = (k / P.facingSteps) * Math.PI * 2;
                    const open = openAlong(x, y, z, yaw);
                    if (open < P.viewClear) continue;
                    const px = x + Math.sin(yaw) * P.personAt, pz = z + Math.cos(yaw) * P.personAt;
                    if (floorAt(px, pz) == null || !clearRadius(px, y, pz, P.personRadius)) continue;
                    if (!cameraSees(x, y, z, yaw, cfg)) continue;
                    // The thing seen past her: angle between "behind her" and the direction to it.
                    const toThing = Math.atan2(centre.x - x, centre.z - z);
                    const behind = yaw + Math.PI;
                    const off = Math.abs(Math.atan2(Math.sin(toThing - behind), Math.cos(toThing - behind)));
                    if (off > (80 * Math.PI) / 180) continue;
                    const score = Math.min(open, 4) + 2 * Math.cos(off) - 0.6 * dist;
                    if (!best || score > best.score) best = { x, y, z, yaw, open, dist, off, score, framing };
                }
                if (!best) why.view++;
            }
        }
        if (!best) { results.push({ id: spot.id, verified: false, why: 'no measured point passed (' + JSON.stringify(why) + ' of ' + tried + ')' }); continue; }
        taken.push([best.x, best.z]);
        let deg = Math.round((best.yaw * 180) / Math.PI) % 360; if (deg > 180) deg -= 360;
        results.push({
            id: spot.id,
            verified: true,
            position: [r2(best.x), r2(best.y), r2(best.z)],
            facingDeg: deg,
            framing: best.framing,
            measured: {
                fromThingM: r2(best.dist),
                viewOpenM: r2(best.open),
                thingOffBehindDeg: Math.round((best.off * 180) / Math.PI),
                framing: best.framing,
                candidates: tried,
            },
        });
    }
    return { floorY, results, nodes: root.children.length };
};
window.READY = true;
</script>`;

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const browser = await chromium.launch();
let failed = 0;
try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.route(`${ORIGIN}/**`, (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
        const file = path.join(ROOT, decodeURIComponent(url.pathname));
        if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({
            body: fs.readFileSync(file),
            contentType: TYPES[path.extname(file)] || 'application/octet-stream',
        });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => window.READY === true);
    for (const [src, spec] of todo) {
        const file = path.join(ROOT, 'assets/vr-worlds', src);
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        const r = await page.evaluate(([s, spots, P]) => window.measure(s, spots, P), [src, spec.spots, PARAMS]);
        const byId = new Map(r.results.map((x) => [x.id, x]));
        const out = {
            schemaVersion: 1,
            scene: src,
            sha256,
            tool: { name: 'tools/vr/measure-spots.mjs', version: TOOL_VERSION, params: PARAMS },
            coordinateSpace: 'scene',
            floorY: r.floorY,
            title: spec.title,
            spots: spec.spots.map((s) => {
                const m = byId.get(s.id) || { verified: false, why: 'not measured' };
                return {
                    id: s.id,
                    label: s.label,
                    room: s.room,
                    near: s.near,
                    sees: s.sees,
                    can: s.can,
                    rating: s.rating,
                    ...m,
                };
            }),
        };
        const stem = path.basename(src, '.glb');
        console.log(`${src}  floor y=${r.floorY}`);
        for (const s of out.spots) {
            if (s.verified)
                console.log(
                    `  ✓ ${s.id.padEnd(15)} at (${s.position.join(', ')}) facing ${String(s.facingDeg).padStart(4)}°  ` +
                        `${s.measured.fromThingM} m from it, ${s.measured.viewOpenM} m open, thing ${s.measured.thingOffBehindDeg}° off behind, ${s.framing}`
                );
            else {
                failed += 1;
                console.log(`  ✗ ${s.id.padEnd(15)} ${s.why}`);
            }
        }
        if (!check) {
            const dest = path.join(ROOT, 'assets/vr-worlds/spots', stem + '.json');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, JSON.stringify(out, null, 4) + '\n');
            console.log('  → ' + path.relative(ROOT, dest));
        }
    }
} finally {
    await browser.close();
}
// An unmeasurable spot is reported, not fatal: it is written verified:false and never offered.
process.exit(0);
