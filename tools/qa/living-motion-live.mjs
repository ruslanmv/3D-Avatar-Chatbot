#!/usr/bin/env node
/**
 * LM1–LM2. Her body alive in a held position, measured in the app's own viewer: does she breathe,
 * rock, arch and take her head back, and do her hands land where they are sent — on the real
 * avatar and the real presets, not the test rig.
 *
 *   node tools/qa/living-motion-live.mjs [--vrm path/under/repo.vrm] [--only straddle,sit-open]
 *        [--seconds 12] [--out dir]
 *
 * For each scenario it holds her in the preset the way Private does (claim, apply, settle), starts
 * the living layer with a fixed evening (`window.__LM_CTX`), samples her rendered bones at 10 Hz,
 * records each frame's hand misses and the layer's own cost, and saves three frames. Writes
 * `report.json` beside them. Output goes under `audits/poses/runs/` (gitignored): never commit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** [name, pose key, Pose Studio preset, the evening] */
const SCENARIOS = [
    ['kneel-l1', 'kneel', 'kneeling', { level: 1 }],
    ['straddle-l4', 'straddle', 'straddle', { level: 4 }],
    ['all-fours-l4', 'all-fours', 'handsKnees', { level: 4 }],
    ['sit-open-l3', 'sit-open', 'sittingOpen', { level: 3 }],
    ['sit-open-l4', 'sit-open', 'sittingOpen', { level: 4 }],
    ['knees-up-l4', 'knees-up', 'lyingKneesUp', { level: 4 }],
    ['kneel-wide-l4', 'kneel-wide', 'kneelingWide', { level: 4 }],
    ['straddle-finish', 'straddle', 'straddle', { level: 4, finishIn: 1 }],
];

const FILE = arg('--vrm', '');
const ONLY = arg('--only', '').split(',').filter(Boolean);
const SECONDS = Number(arg('--seconds', '12'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-living`)));

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const errors = [];
    const report = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1700, height: 950 } })).newPage();
        page.setDefaultTimeout(240000);
        page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 240000);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem
        );
        if (FILE) {
            await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), '/' + FILE.replace(/^\/+/, ''));
            await page.waitForTimeout(7000);
        }
        const ok = await page.evaluate(() => Boolean(window.NEXUS_PRIVATE_LIVING && window.vrPoseSystem.setLayer));
        if (!ok) throw new Error('the living layer or the pose system hook is not on this page');
        for (const [name, pose, preset, evening] of SCENARIOS) {
            if (ONLY.length && !ONLY.includes(name) && !ONLY.includes(pose)) continue;
            const r = await page.evaluate(
                async ([pose, preset, evening, seconds]) => {
                    const vps = window.vrPoseSystem;
                    const T = window.THREE;
                    const v = window.NEXUS_VIEWER;
                    const root = v.avatarManager.currentRoot;
                    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                    if (window.__LM) window.__LM.detach();
                    vps.releaseBones({ blendSeconds: 0 });
                    await wait(300);
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode(true);
                    vps.claimBones();
                    vps.applyPreset(preset, 0.4);
                    const t0 = performance.now();
                    while (vps.isSettling() && performance.now() - t0 < 8000) await wait(100);
                    await wait(400);
                    // Frame her whole body, from the side a little, as the person sees her.
                    root.updateMatrixWorld(true);
                    const box = new T.Box3().setFromObject(root);
                    const c = box.getCenter(new T.Vector3());
                    const size = box.getSize(new T.Vector3());
                    const half = T.MathUtils.degToRad(v.camera.fov) / 2;
                    const dist = (Math.max(size.x, size.y, size.z) * 0.62) / Math.tan(half);
                    const yaw = (root.userData?.vrmForwardNegZ ? Math.PI : 0) + 0.6;
                    v.controls.minDistance = 0.05;
                    v.camera.position.set(c.x + Math.sin(yaw) * dist, c.y + 0.15, c.z + Math.cos(yaw) * dist);
                    v.controls.target.copy(c);
                    v.controls.update();
                    // The evening, fixed for the run; the finish starts `finishIn` s from now.
                    const started = Date.now();
                    window.__LM_CTX = {
                        pose,
                        level: evening.level,
                        finishAt: evening.finishIn != null ? started + evening.finishIn * 1000 : null,
                    };
                    window.__LM = window.NEXUS_PRIVATE_LIVING.attach({ win: window, read: () => window.__LM_CTX });
                    // Wrap the layer to time it and keep what it did.
                    const layer = vps.getLayer();
                    const inner = layer.apply.bind(layer);
                    const costs = [];
                    const misses = { left: [], right: [] };
                    const places = new Set();
                    const byPlace = {};
                    let leanMax = 0;
                    layer.apply = (dt, rig, THREE) => {
                        const a = performance.now();
                        const done = inner(dt, rig, THREE);
                        costs.push(performance.now() - a);
                        for (const side of ['left', 'right']) {
                            const h = done && done.hands && done.hands[side];
                            if (h && h.weight > 0.9) {
                                misses[side].push(h.missMm);
                                (byPlace[h.place] = byPlace[h.place] || []).push(h.missMm);
                                places.add(h.place);
                            }
                        }
                        window.__LM_LAST = done;
                        if (done && done.lean) leanMax = Math.max(leanMax, done.lean);
                        return done;
                    };
                    const bones = ['hips', 'upperChest', 'head', 'leftHand', 'rightHand', 'leftLowerLeg'];
                    const samples = Object.fromEntries(bones.map((b) => [b, []]));
                    const shots = [];
                    for (let i = 0; i < seconds * 10; i += 1) {
                        await wait(100);
                        for (const b of bones) {
                            const n = vps.getVisualBone(b);
                            if (n) samples[b].push(n.getWorldPosition(new T.Vector3()).toArray());
                        }
                        if ([20, Math.floor(seconds * 5), seconds * 10 - 1].includes(i)) shots.push(i);
                    }
                    const span = (pts) => {
                        if (!pts.length) return null;
                        let m = 0;
                        for (const p of pts)
                            for (const q of pts) m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
                        return Math.round(m * 1000);
                    };
                    const sorted = costs.slice().sort((a, b) => a - b);
                    const med = (xs) =>
                        xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
                    return {
                        held: vps.isHoldingBones(),
                        preset: vps.getCurrentPreset(),
                        movedMm: Object.fromEntries(bones.map((b) => [b, span(samples[b])])),
                        handMissMm: { left: med(misses.left), right: med(misses.right) },
                        places: [...places],
                        missByPlaceMm: Object.fromEntries(Object.entries(byPlace).map(([p, xs]) => [p, med(xs)])),
                        leanMaxDeg: Math.round((leanMax * 180) / Math.PI),
                        layerMs: {
                            median: +(sorted[Math.floor(sorted.length / 2)] || 0).toFixed(3),
                            p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(3),
                        },
                        said: window.__LM.describe(),
                        frames: costs.length,
                    };
                },
                [pose, preset, evening, SECONDS]
            );
            // Three frames of the layer still running, 1.3 s apart (a rock is ~2 s at the closest step),
            // with a small marker on each hand's target so a miss is seen, not only measured.
            const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
            for (let k = 0; k < 3; k += 1) {
                await page.waitForTimeout(k === 0 ? 0 : 1300);
                await page.evaluate(() => {
                    const T = window.THREE;
                    const scene = window.NEXUS_VIEWER.scene;
                    for (const m of window.__LM_MARKS || []) scene.remove(m);
                    window.__LM_MARKS = [];
                    const done = window.__LM_LAST;
                    for (const side of ['left', 'right']) {
                        const h = done && done.hands && done.hands[side];
                        if (!h || !h.target) continue;
                        const m = new T.Mesh(
                            new T.SphereGeometry(0.012, 8, 8),
                            new T.MeshBasicMaterial({ color: side === 'left' ? 0x00ff66 : 0x33aaff, depthTest: false })
                        );
                        m.position.fromArray(h.target);
                        m.renderOrder = 999;
                        scene.add(m);
                        window.__LM_MARKS.push(m);
                    }
                });
                await canvas.screenshot({ path: path.join(out, `${name}-${k}.png`) });
            }
            report.push(Object.assign({ name, pose, preset, evening }, r));
            console.log(name, JSON.stringify(r));
        }
        await page.evaluate(() => window.__LM && window.__LM.detach());
    } finally {
        await browser.close();
        server.stop();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ errors, report }, null, 2));
    if (errors.length) console.log(`page errors: ${errors.length}`, errors.slice(0, 3));
    console.log(out);
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
