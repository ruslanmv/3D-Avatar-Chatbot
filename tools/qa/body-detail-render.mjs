#!/usr/bin/env node
/**
 * UN30. Look at Forge's body-detail variants (BD1) close up, in the app's own viewer and poses.
 *
 *   node tools/qa/body-detail-render.mjs --vrm audits/poses/runs/detail/ref-natural.vrm[,…]
 *        [--views chest,seated,kneesup,allfours] [--marks '{"nipple":[x,y,z],"crotch":[x,y,z]}'] [--out dir]
 *
 * The VRMs come from Forge's `tools/body_surface/detail_preview.py` (its synthetic adult reference
 * body, never a library character) and must sit under this repository so nexus-proxy serves them —
 * `audits/poses/runs/` is gitignored, and explicit previews must never be committed.
 *
 * Why the camera is aimed this way. A landmark (nipple, crotch) is given in her rest pose, the
 * same numbers Forge's report prints (`bodyDetail.landmarks`). It is carried into hips-local space
 * at rest, then out again after the pose, and the camera looks along that spot's own surface normal
 * (the vulva faces front-down, the anus back-down) — so the same view works lying, kneeling or on
 * all fours. Two traps it encodes: OrbitControls' minDistance kept every close-up a metre away until
 * it was lifted, and Pose Studio's panel narrows the canvas, hence the wide viewport.
 *
 * Writes <out>/<name>-<view>.png (default audits/poses/runs/<stamp>-detail). Exit 2 if the run failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const FILES = arg('--vrm', '').split(',').filter(Boolean);
const MARKS = JSON.parse(arg('--marks', '{"nipple":[0.0946,1.1685,0.1855],"crotch":[0,0.7578,0.0045]}'));
// view: [pose, landmark, the spot's normal in her rest frame (z = her front), camera distance m]
const ALL = {
    chest: ['standing', 'nipple', [0.15, 0.05, 1], 0.16],
    seated: ['sittingOpen', 'crotch', [0, -0.25, 1], 0.2],
    kneesup: ['lyingKneesUp', 'crotch', [0, -0.85, 0.5], 0.3],
    allfours: ['handsKnees', 'crotch', [0, -0.45, -0.9], 0.24],
};
const VIEWS = arg('--views', Object.keys(ALL).join(',')).split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-detail`)));

async function main() {
    if (!FILES.length) {
        console.error('usage: node tools/qa/body-detail-render.mjs --vrm <path under this repo>[,…]');
        return 2;
    }
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const errors = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1700, height: 950 } })).newPage();
        page.setDefaultTimeout(240000);
        page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 240000);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem
        );
        for (const file of FILES) {
            const name = path.basename(file, '.vrm');
            await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), '/' + file.replace(/^\/+/, ''));
            await page.waitForTimeout(7000);
            await page.evaluate(() => {
                const am = window.NEXUS_VIEWER.avatarManager;
                try {
                    window.NEXUS_MOTION?.onAvatarChanged?.(am.currentRoot, am._currentVRM);
                } catch (_) {
                    /* motion may not be there; posing still works */
                }
                document.getElementById('openPoseStudioBtn')?.click();
            });
            await page.waitForTimeout(2000);
            for (const view of VIEWS) {
                const [pose, mark, normal, dist] = ALL[view];
                await page.evaluate(
                    async ([pose, at, normal, dist]) => {
                        const vps = window.vrPoseSystem;
                        const T = window.THREE;
                        const v = window.NEXUS_VIEWER;
                        const root = v.avatarManager.currentRoot;
                        const hips = () => v.avatarManager._currentVRM.humanoid.getRawBoneNode('hips');
                        const settle = async () => {
                            const t0 = performance.now();
                            while (vps.isSettling() && performance.now() - t0 < 8000)
                                await new Promise((r) => setTimeout(r, 100));
                            await new Promise((r) => setTimeout(r, 500));
                            root.updateMatrixWorld(true);
                        };
                        vps.applyPreset('standing', 0);
                        await settle();
                        const inv = hips().matrixWorld.clone().invert();
                        const local = root.localToWorld(new T.Vector3(...at)).applyMatrix4(inv);
                        const nLocal = new T.Vector3(...normal)
                            .normalize()
                            .transformDirection(root.matrixWorld)
                            .transformDirection(inv);
                        vps.applyPreset(pose, 0);
                        await settle();
                        const m = hips().matrixWorld;
                        const target = local.clone().applyMatrix4(m);
                        const dir = nLocal.clone().transformDirection(m);
                        v.controls.minDistance = 0.01;
                        v.camera.near = 0.005;
                        v.camera.updateProjectionMatrix();
                        v.camera.position.copy(target.clone().addScaledVector(dir, dist));
                        v.controls.target.copy(target);
                        v.controls.update();
                    },
                    [pose, MARKS[mark], normal, dist]
                );
                await page.waitForTimeout(400);
                const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
                await canvas.screenshot({ path: path.join(out, `${name}-${view}.png`) });
                console.log(`${name} ${view}`);
            }
        }
    } finally {
        await browser.close();
        server.stop();
    }
    if (errors.length) console.log(`page errors: ${errors.length}`);
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
