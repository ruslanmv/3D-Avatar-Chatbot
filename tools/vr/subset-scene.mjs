#!/usr/bin/env node
/**
 * PG1. Cut a lighter scene out of an assembled one, reproducibly.
 *
 * The playground scenes (pub, club, stage, academy) come from 3dassets.dev as one GLB each, and
 * every one of them is over the phone budget (`VRWorlds.MOBILE_TRIANGLES`, 30 000) — some over
 * what a desktop should draw for a room the person never walks out of. Hand-editing a GLB in a
 * modelling tool would make the light version a thing nobody can rebuild; this makes it a recipe:
 * `tools/vr/playground-subsets.json` names, for each output, the source file and which of its
 * top-level nodes to keep (index ranges, as the kit numbers them `000-…`) or drop (name
 * patterns). Run it again after changing the recipe and the same file comes out.
 *
 * It runs three r147's GLTFLoader (the vendored copy — the version the app runs, so what it writes
 * is what the app can read) and r147's GLTFExporter in headless Chromium, with every request served
 * from this repository through `page.route`: no server. The exporter is not part of the vendored
 * tree (`vendor/` is never edited), so the first run fetches exactly three@0.147.0's file from
 * unpkg into `tmp/three-0.147.0/` (gitignored) and every later run uses that copy.
 *
 *     node tools/vr/subset-scene.mjs            # every recipe
 *     node tools/vr/subset-scene.mjs pub-light  # one
 *     node tools/vr/subset-scene.mjs --check    # report triangles, write nothing
 *
 * Prints the measured triangles of every output — the number `worlds.json` must declare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vr/playground-subsets.json'), 'utf8')).outputs;
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));
const todo = Object.entries(recipes).filter(([name]) => !only.length || only.includes(name));
if (!todo.length) {
    console.error('No recipe matches', only.join(', '));
    process.exit(1);
}

const ORIGIN = 'http://subset.local';
const PAGE = `<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three-0.147.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-0.147.0/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from '/tmp/three-0.147.0/GLTFExporter.js';
function inRanges(i, ranges) {
    return ranges.some((r) => { const [a, b] = String(r).split('-').map(Number); return i >= a && i <= (Number.isFinite(b) ? b : a); });
}
function tris(o) { let t = 0; o.traverse((m) => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return Math.round(t); }
window.cut = async (recipe) => {
    const g = await new GLTFLoader().loadAsync('/' + recipe.src);
    let root = g.scene; while (root.children.length === 1 && !root.children[0].isMesh) root = root.children[0];
    const before = tris(g.scene);
    const drop = (recipe.drop || []).map((s) => new RegExp(s));
    for (const child of [...root.children]) {
        const i = parseInt(child.name, 10);
        const kept = (!recipe.keep || (Number.isFinite(i) && inRanges(i, recipe.keep))) && !drop.some((re) => re.test(child.name));
        if (!kept) root.remove(child);
    }
    // The kit's files are quantized (KHR_mesh_quantization: Int16/Int8 normalized attributes);
    // r147's exporter writes only float and unsigned types, so dequantize what is left. getX..W
    // already denormalize, which is the whole conversion.
    g.scene.traverse((m) => {
        if (!m.isMesh) return;
        for (const [key, a] of Object.entries(m.geometry.attributes)) {
            if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
            const out = new Float32Array(a.count * a.itemSize);
            const get = ['getX', 'getY', 'getZ', 'getW'];
            for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a[get[k]](i);
            m.geometry.setAttribute(key, new THREE.BufferAttribute(out, a.itemSize));
        }
    });
    const after = tris(g.scene);
    const glb = await new GLTFExporter().parseAsync(g.scene, { binary: true });
    const bytes = new Uint8Array(glb); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { before, after, nodes: root.children.length, b64: btoa(s) };
};
window.READY = true;
</script>`;

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };

const EXPORTER = path.join(ROOT, 'tmp/three-0.147.0/GLTFExporter.js');
if (!fs.existsSync(EXPORTER)) {
    const res = await fetch('https://unpkg.com/three@0.147.0/examples/jsm/exporters/GLTFExporter.js');
    if (!res.ok) throw new Error(`Could not fetch three r147's GLTFExporter: HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(EXPORTER), { recursive: true });
    fs.writeFileSync(EXPORTER, await res.text());
}

const browser = await chromium.launch();
let failed = false;
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
    for (const [name, recipe] of todo) {
        const r = await page.evaluate((rec) => window.cut(rec), recipe);
        const out = path.join(ROOT, recipe.out);
        const budget = Number(recipe.budget) || Infinity;
        const over = r.after > budget;
        if (over) failed = true;
        console.log(
            `${name}: ${recipe.src} → ${recipe.out}  ${r.before} → ${r.after} triangles, ${r.nodes} nodes` +
                (Number.isFinite(budget) ? `  (budget ${budget}${over ? ' — OVER' : ''})` : '')
        );
        if (!check && !over) fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
    }
} finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);
