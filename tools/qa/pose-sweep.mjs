#!/usr/bin/env node
/**
 * UN29. Tune a Pose Studio preset live: try bone variants on the real avatar, read what the pose
 * system measured for each, shoot it from the side — without editing VRPoseSystem.js per try.
 *
 *   node tools/qa/pose-sweep.mjs --preset floorOpen --variants variants.json [--grid] [--out dir]
 *
 * `variants.json` is an array; each entry replaces the preset's bones (Euler degrees, the same
 * x,y,z `eulerDegToQuat` takes in VRPoseSystem.js) and may replace its `support`:
 *
 *   [ { "bones": { "hips": [30, 0, 0], "leftUpperLeg": [95, 0, -40], ... },
 *       "support": { "ground": ["hips", "leftFoot", "rightFoot"], "reach": ["leftHand", "rightHand"] } } ]
 *
 * The page imports the same module URL VRPoseSystem was loaded from, so `POSE_PRESETS` is the live
 * object: a variant is applied exactly as the shipped preset would be (blend, MO5/UN6 grounding,
 * support hands). Nothing is written to the source tree; put the winner in VRPoseSystem.js by hand
 * and confirm it with tools/qa/pose-shots.mjs.
 *
 * What it prints per variant: `groundBeforeMm` (how far grounding moved her), each reaching palm's
 * height after the arm IK (`palmAfterMm`; Private fails a palm beyond 20 mm), and raw-rig joint
 * heights above the sole plane. The joint heights are from the normalised (proxy) rig: compare
 * them between variants, never against the floor — the floorOpen hunt showed a 30 cm offset.
 *
 * What the floorOpen hunt learnt (2026-11-18), so the next one starts there:
 *   - JOINT_LIMITS clamp the IK: the left upper arm allows Z only up to +30°, so an arm posed at
 *     Z 60–72 is pulled up on the first IK pass and cannot reach the floor. A reach must come from
 *     the body's orientation (handsKnees swings the arms on Y while she is prone).
 *   - A seat with knees up rests on the floor only when the shin comes back down at the angle the
 *     thigh rose; otherwise the feet ground her and the seat hangs.
 *
 * Writes audits/poses/runs/<stamp>-sweep/{variant-<n>.png, report.json}. Exit 2 if the run failed.
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
const PRESET = arg('--preset', null);
const FILE = arg('--variants', null);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-sweep`)));

async function main() {
    if (!PRESET || !FILE) {
        console.error('usage: node tools/qa/pose-sweep.mjs --preset <name> --variants <file.json> [--grid]');
        return 2;
    }
    const variants = JSON.parse(fs.readFileSync(path.resolve(FILE), 'utf8'));
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const results = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        page.setDefaultTimeout(180000);
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 180000);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem
        );
        await page.evaluate(() => document.getElementById('openPoseStudioBtn')?.click());
        await page.waitForTimeout(2000);
        if (process.argv.includes('--grid'))
            await page.evaluate(() => {
                const T = window.THREE;
                const grid = new T.GridHelper(3, 12, 0x44ff88, 0x226644);
                grid.position.y = window.vrPoseSystem._restSurfaceFloor ?? 0;
                window.NEXUS_VIEWER.scene.add(grid);
            });
        for (let n = 0; n < variants.length; n++) {
            const r = await page.evaluate(
                async ([preset, v]) => {
                    const mod = await import('/src/gltf-viewer/VRPoseSystem.js');
                    const T = window.THREE;
                    const target = mod.POSE_PRESETS[preset];
                    if (!target) return { error: `no preset ${preset}` };
                    const deg = Math.PI / 180;
                    target.bones = {};
                    for (const [bone, [x, y, z]] of Object.entries(v.bones || {}))
                        target.bones[bone] = new T.Quaternion().setFromEuler(new T.Euler(x * deg, y * deg, z * deg));
                    if (v.support) target.support = v.support;
                    const vps = window.vrPoseSystem;
                    vps.applyPreset('standingRelaxed', 0);
                    vps.applyPreset(preset, 0.3);
                    const t0 = performance.now();
                    while (vps.isSettling() && performance.now() - t0 < 10000)
                        await new Promise((res) => setTimeout(res, 100));
                    await new Promise((res) => setTimeout(res, 400));
                    const floor = vps._restSurfaceFloor ?? 0;
                    const y = (k) => {
                        const b = vps._bones.get(k);
                        return b ? +(b.getWorldPosition(new T.Vector3()).y - floor).toFixed(3) : null;
                    };
                    return {
                        support: vps.lastSupport || null,
                        joints: { hips: y('hips'), knee: y('leftLowerLeg'), foot: y('leftFoot'), hand: y('leftHand') },
                    };
                },
                [PRESET, variants[n]]
            );
            await page.evaluate(() => {
                const v = window.NEXUS_VIEWER;
                const p = v.avatarManager.currentRoot.getWorldPosition(new window.THREE.Vector3());
                const sign = v.camera.position.z >= p.z ? 1 : -1;
                v.camera.position.set(p.x + Math.sin(1.45) * 3, p.y + 0.9, p.z + sign * Math.cos(1.45) * 3);
                v.controls.target.set(p.x, p.y + 0.35, p.z);
                v.controls.update();
            });
            await page.waitForTimeout(250);
            const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
            await canvas.screenshot({ path: path.join(out, `variant-${n}.png`) });
            const hands = r.support && r.support.hands ? Object.values(r.support.hands) : [];
            const palms = hands.map((h) => h && h.palmAfterMm);
            results.push({ n, variant: variants[n], ...r, palms });
            console.log(
                `#${n}  ground ${r.support ? r.support.groundBeforeMm : '—'} mm  palms ${palms.join('/') || '—'}  joints ${JSON.stringify(r.joints || r.error)}`
            );
        }
    } finally {
        await browser.close();
        server.stop();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ preset: PRESET, results }, null, 2));
    console.log(`\n${out}`);
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
