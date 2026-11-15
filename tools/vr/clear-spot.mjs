#!/usr/bin/env node
/**
 * VW6. Where she can stand in a scene that has no floor mesh.
 *
 * `measure-spots.mjs` finds spots by casting a ray down onto the scene's floor. Some starter
 * scenes (the hotel lobby, the hotel guest room) are furniture and walls only: the floor is the
 * world's `ground` disk, there is nothing to hit, and every point is refused. A spot typed in by
 * eye is what the VW rules forbid, so this computes one from the scene's own top-level node
 * boxes instead: on a 10 cm grid, the point whose distance to every box that reaches into her
 * height (0 to 1.8 m) is largest, with the person's place 1 m in front of her clear as well.
 * `--behind <regex>` keeps only points that have a named thing behind her within `--reach`
 * metres, so the camera sees what the place is for; `--min` refuses anything closer than the VR
 * comfort distance. Prints `scene.at` / `turn` in worlds.json's convention (she stays at the
 * origin facing +z; the room is turned and moved).
 *
 *     node tools/vr/clear-spot.mjs scenes/hotel-lobby.glb --behind check-in-desk
 *     node tools/vr/clear-spot.mjs scenes/hotel-bathroom.glb --behind shower --min 0.6
 *
 * Boxes, not triangles: a hollow thing (a door frame) counts as solid, so the answer is
 * conservative. No browser, no network; reads the GLB with tools/vr/scene-nodes.mjs.
 */
import path from 'node:path';
import { inspect } from './scene-nodes.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const file = args.find((a) => /\.glb$/.test(a));
if (!file) {
    console.error('usage: node tools/vr/clear-spot.mjs <scenes/x.glb> [--behind <regex>] [--reach 4] [--min 1]');
    process.exit(2);
}
const behind = opt('--behind', null);
const reach = Number(opt('--reach', 4));
const min = Number(opt('--min', 1));
const VIEW = Number(opt('--view', 3.2));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const full = path.isAbsolute(file) ? file : path.join(root, 'assets/vr-worlds', file);
const nodes = inspect(full, null).filter((n) => n.box && n.box[1][1] > 0.05 && n.box[0][1] < 1.8);
const want = behind ? nodes.filter((n) => new RegExp(behind).test(n.name)) : [];
if (behind && !want.length) {
    console.error(`no node matches ${behind}`);
    process.exit(1);
}
const gap = (b, x, z) => Math.hypot(Math.max(b[0][0] - x, 0, x - b[1][0]), Math.max(b[0][2] - z, 0, z - b[1][2]));
/** Does the segment (x0,z0)-(x1,z1) pass through the box's footprint? Slab test in 2D. */
function crosses(b, x0, z0, x1, z1) {
    let t0 = 0;
    let t1 = 1;
    for (const [p, d, lo, hi] of [
        [x0, x1 - x0, b[0][0], b[1][0]],
        [z0, z1 - z0, b[0][2], b[1][2]],
    ]) {
        if (Math.abs(d) < 1e-9) {
            if (p < lo || p > hi) return false;
            continue;
        }
        const a = (lo - p) / d;
        const c = (hi - p) / d;
        t0 = Math.max(t0, Math.min(a, c));
        t1 = Math.min(t1, Math.max(a, c));
        if (t0 > t1) return false;
    }
    return true;
}
const clear = (x, z) => Math.min(...nodes.map((n) => gap(n.box, x, z)));
const xs = nodes.flatMap((n) => [n.box[0][0], n.box[1][0]]);
const zs = nodes.flatMap((n) => [n.box[0][2], n.box[1][2]]);
let best = null;
// A small room (a bathroom) has no clear point inside it: she stands just outside, looking in,
// so the search reaches MARGIN beyond the scene's own extent.
const MARGIN = 2.5;
for (let x = Math.min(...xs) - MARGIN; x <= Math.max(...xs) + MARGIN; x += 0.1) {
    for (let z = Math.min(...zs) - MARGIN; z <= Math.max(...zs) + MARGIN; z += 0.1) {
        const here = clear(x, z);
        if (here < min) continue;
        for (let deg = -180; deg < 180; deg += 15) {
            const f = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
            const person = clear(x + f[0], z + f[1]);
            if (person < 0.5) continue;
            // The camera looks at her from in front, further back than the person stands: a sofa
            // on that line hid her legs in the hotel lobby. Nothing may cross it out to VIEW metres.
            if (nodes.some((o) => crosses(o.box, x, z, x + f[0] * VIEW, z + f[1] * VIEW))) continue;
            let seen = 0;
            if (want.length) {
                // The thing must be behind her: along −facing, within reach and within 45° of it.
                let near = Infinity;
                for (const n of want) {
                    const c = [(n.box[0][0] + n.box[1][0]) / 2, (n.box[0][2] + n.box[1][2]) / 2];
                    const v = [c[0] - x, c[1] - z];
                    const d = Math.hypot(v[0], v[1]);
                    if (d > reach || -(v[0] * f[0] + v[1] * f[1]) / (d || 1) <= Math.SQRT1_2) continue;
                    // Nothing else between her and it: a wall's back is not a view of the room.
                    if (nodes.some((o) => !want.includes(o) && crosses(o.box, x, z, c[0], c[1]))) continue;
                    near = Math.min(near, d);
                }
                if (!Number.isFinite(near)) continue;
                seen = 2 - near * 0.5; // closer to what the place is for is better
            }
            const score = Math.min(here, 1.5) + Math.min(person, 1.5) * 0.5 + seen;
            if (!best || score > best.score) best = { x, z, deg, here, person, score };
        }
    }
}
if (!best) {
    console.error(`no point is ${min} m clear of everything${behind ? ` with ${behind} behind her` : ''}`);
    process.exit(1);
}
const turn = -best.deg;
const a = (turn * Math.PI) / 180;
const rx = best.x * Math.cos(a) + best.z * Math.sin(a);
const rz = -best.x * Math.sin(a) + best.z * Math.cos(a);
const r = (v) => Math.round(v * 1000) / 1000;
console.log(
    `${file}: she stands at (${r(best.x)}, ${r(best.z)}) facing ${best.deg}°, ${r(best.here)} m clear, ` +
        `the person's place ${r(best.person)} m clear`
);
console.log(`  "at": [${r(-rx)}, 0, ${r(-rz)}], "turn": ${turn}`);
