#!/usr/bin/env node
/**
 * UN29. Look at Pose Studio presets on the real avatar — front and side — and read what the pose
 * system measured, before trusting any number.
 *
 *   node tools/qa/pose-shots.mjs [--poses sittingOpen,straddle] [--views front,side]
 *                                [--cam 2.6,0.9] [--grid] [--speed slow|normal|fast] [--out dir]
 *
 * Why it exists. UN24 shipped `floorOpen` on the strength of a front screenshot that "looked
 * seated"; the side view and `lastSupport` said her seat and palms hung 25–30 cm above the floor
 * (develop/NEEDS_FIX.md). This is the loop that caught it, kept: open Pose Studio the way the
 * person does, apply each preset with Pose Studio's own 0.5 s blend (so PoseTransition's
 * stretch and stagger are measured too), wait until the pose system says it has stopped moving
 * her (blend, grounding, support hands), then shoot the WebGL canvas only and record:
 *
 *   blendSeconds   the duration PoseTransition chose for this change (UN23/UN25)
 *   support        `vrPoseSystem.lastSupport`: how far grounding moved her, and for `support.reach`
 *                  presets each palm's height above her sole plane after the arm IK
 *                  (`palmAfterMm`; Private's own check fails a palm beyond 20 mm)
 *
 * `--grid` draws a grid at her standing sole plane — the camera alone cannot tell "on the floor"
 * from "hovering", which is how floorOpen fooled a look. `--cam d,h` sets the camera distance and
 * height (lying poses read better from 3.6,1.8).
 *
 * Starts nexus-proxy itself if nothing is serving (tools/vr/page-driver.mjs). Writes
 * audits/poses/runs/<stamp>-shots/{<preset>-<view>.png, report.json, index.html}. Exit 1 when a
 * `reach` preset leaves a palm off the floor (> 20 mm), 2 when the run itself failed.
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
const has = (name) => process.argv.includes(name);

const POSES = arg('--poses', 'sittingOpen,kneelingWide,lyingKneesUp,straddle').split(',').filter(Boolean);
const VIEWS = arg('--views', 'front,side').split(',').filter(Boolean);
const [CAM_D, CAM_Y] = arg('--cam', '2.6,0.9').split(',').map(Number);
const SPEED = arg('--speed', null);
const ANGLE = { front: 0.35, side: 1.45, back: Math.PI, left: -1.45 };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-shots`)));
const PALM_MM = 20;

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const report = { poses: POSES, views: VIEWS, cam: [CAM_D, CAM_Y], speed: SPEED, results: [], errors: [] };
    try {
        const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        page.setDefaultTimeout(180000);
        page.on('pageerror', (e) => report.errors.push(String(e.message || e).slice(0, 240)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 180000);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem
        );
        // The way the person does it: the button opens Pose Studio and puts her in pose mode.
        await page.evaluate(() => document.getElementById('openPoseStudioBtn')?.click());
        await page.waitForTimeout(2000);
        if (SPEED) await page.evaluate((s) => window.NEXUS_POSE_TRANSITION?.setSpeed(s), SPEED);
        if (has('--grid'))
            await page.evaluate(() => {
                const T = window.THREE;
                const grid = new T.GridHelper(3, 12, 0x44ff88, 0x226644);
                grid.position.y = window.vrPoseSystem._restSurfaceFloor ?? 0;
                window.NEXUS_VIEWER.scene.add(grid);
            });
        for (const id of POSES) {
            const r = await page.evaluate(async (preset) => {
                const vps = window.vrPoseSystem;
                vps.applyPreset('standingRelaxed', 0);
                vps.applyPreset(preset, 0.5);
                const blendSeconds = +Number(vps._blendDuration).toFixed(3);
                const t0 = performance.now();
                while (vps.isSettling() && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
                await new Promise((r) => setTimeout(r, 500));
                return { applied: vps.getCurrentPreset(), blendSeconds, support: vps.lastSupport || null };
            }, id);
            const shots = [];
            for (const view of VIEWS) {
                await page.evaluate(
                    ([a, d, y]) => {
                        const v = window.NEXUS_VIEWER;
                        const p = v.avatarManager.currentRoot.getWorldPosition(new window.THREE.Vector3());
                        const sign = v.camera.position.z >= p.z ? 1 : -1;
                        v.camera.position.set(p.x + Math.sin(a) * d, p.y + y, p.z + sign * Math.cos(a) * d);
                        v.controls.target.set(p.x, p.y + 0.4, p.z);
                        v.controls.update();
                    },
                    [ANGLE[view] ?? 0, CAM_D, CAM_Y]
                );
                await page.waitForTimeout(250);
                const file = `${id}-${view}.png`;
                const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
                await canvas.screenshot({ path: path.join(out, file) });
                shots.push(file);
            }
            const hands = r.support && r.support.hands ? Object.values(r.support.hands) : [];
            const palms = hands.map((h) => h && h.palmAfterMm);
            const fail =
                r.applied !== id
                    ? 'not-applied'
                    : palms.some((mm) => mm == null || Math.abs(mm) > PALM_MM)
                      ? `palm-off-floor ${palms.join('/')} mm`
                      : null;
            report.results.push({ id, ...r, palms, shots, fail });
            console.log(`${fail ? 'FAIL' : 'ok  '} ${id}  blend ${r.blendSeconds}s  palms ${palms.join('/') || '—'}`);
        }
    } finally {
        await browser.close();
        server.stop();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(
        path.join(out, 'index.html'),
        `<!doctype html><meta charset="utf-8"><title>Pose shots</title><body style="background:#111;color:#eee;font:14px system-ui">` +
            report.results
                .map(
                    (r) =>
                        `<h3>${r.id} ${r.fail ? '— ' + r.fail : ''}</h3><p>blend ${r.blendSeconds}s · ${JSON.stringify(r.support)}</p>` +
                        r.shots.map((s) => `<img src="${s}" height="420">`).join('')
                )
                .join('')
    );
    console.log(`\n${out}/index.html`);
    if (report.errors.length) console.log(`page errors: ${report.errors.length}`);
    return report.results.some((r) => r.fail) ? 1 : 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
