#!/usr/bin/env node
/**
 * LM5. The living layer against the pose it is drawn over, on a real avatar, at exact instants.
 *
 *   node tools/qa/living-motion-compare.mjs --vrm vendor/avatars/Vita.vrm [--only riding,finish]
 *        [--times 0,0.65,1.3,1.95,2.6] [--out dir]
 *
 * There is no source animation behind these motions: each is a Pose Studio preset held still, plus
 * the procedural layer (PrivateLivingMotion). So the reference is the preset with the layer off,
 * and both sides are shot from the same cameras. The layer is not run on the wall clock: a fresh
 * stepper is advanced to each instant at 60 steps a second, so "1.3 s" is the same moment on every
 * run and on both sides (the live tool's frames were wall-clock, and its finish frames came after
 * the finish had ebbed). Writes, per scenario:
 *
 *   off-<view>-<t>.png, on-<view>-<t>.png   the held preset and the layered frame
 *   play-<k>.png                             the layer at 10 fps for six seconds (front), for a GIF
 *   trajectory.json                          per 0.1 s: pelvis, spine, chest and head angles off the
 *                                            held pose (deg), each bone's own axis, and arm joints
 *
 * Output under audits/poses/runs/ (gitignored): never commit it.
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

/** name, pose key, preset, evening (`finishAt`: seconds on the layer's clock when they finish), views */
const SCENARIOS = [
    { name: 'riding', pose: 'straddle', preset: 'straddle', level: 4, start: 20, views: ['front', 'side'] },
    // The finish begins at the first instant shot, so 0 s is the moment they say it.
    {
        name: 'finish',
        pose: 'straddle',
        preset: 'straddle',
        level: 4,
        start: 20,
        finishAt: 20,
        views: ['front', 'side'],
    },
    { name: 'sitting-open', pose: 'sit-open', preset: 'sittingOpen', level: 4, start: 24, views: ['front', 'side'] },
    { name: 'knees-up', pose: 'knees-up', preset: 'lyingKneesUp', level: 4, start: 24, views: ['ground', 'above'] },
];

const FILE = arg('--vrm', 'vendor/avatars/Vita.vrm');
const ONLY = arg('--only', '').split(',').filter(Boolean);
const TIMES = arg('--times', '0,0.65,1.3,1.95,2.6').split(',').map(Number);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-compare`)));

async function main() {
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    try {
        const page = await (await browser.newContext({ viewport: { width: 1700, height: 950 } })).newPage();
        page.setDefaultTimeout(240000);
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 240000);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem
        );
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), '/' + FILE.replace(/^\/+/, ''));
        await page.waitForTimeout(7000);
        const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);

        for (const sc of SCENARIOS) {
            if (ONLY.length && !ONLY.includes(sc.name)) continue;
            const dir = path.join(out, sc.name);
            fs.mkdirSync(dir, { recursive: true });
            // Hold her in the preset, the way Private does, and remember the held pose.
            await page.evaluate(async (sc) => {
                const vps = window.vrPoseSystem;
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                vps.setLayer(null);
                vps.releaseBones({ blendSeconds: 0 });
                await wait(300);
                window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode(true);
                vps.claimBones();
                vps.applyPreset(sc.preset, 0.3);
                const t0 = performance.now();
                while (vps.isSettling() && performance.now() - t0 < 8000) await wait(100);
                await wait(500);
                const held = {};
                for (const [k, b] of vps._bones)
                    held[k] = b.getWorldQuaternion(new window.THREE.Quaternion()).toArray();
                window.__LM_HELD = held;
            }, sc);

            // Set the layer to a frame `t` seconds into the scenario's evening (null = layer off).
            const at = (t) =>
                page.evaluate(
                    async ([sc, t]) => {
                        const vps = window.vrPoseSystem;
                        const L = window.NEXUS_PRIVATE_LIVING;
                        if (t == null) {
                            vps.setLayer(null);
                        } else {
                            const st = L.create();
                            const clock = sc.start + t;
                            let frame = null;
                            const steps = Math.round(clock * 60);
                            for (let i = 0; i < steps; i += 1) {
                                const now = (i + 1) / 60;
                                frame = st.step(1 / 60, {
                                    pose: sc.pose,
                                    level: sc.level,
                                    secondsAtTop: now,
                                    sinceFinish: sc.finishAt != null && now >= sc.finishAt ? now - sc.finishAt : null,
                                });
                            }
                            vps.setLayer({ keys: L.BONES, apply: (d, rig, THREE) => L.apply(rig, frame, THREE) });
                        }
                        await new Promise((r) => setTimeout(r, 200));
                    },
                    [sc, t]
                );

            // Cameras from her own body: front (35° round), side, and for lying down a view at
            // floor level from her side and one from above.
            const camera = (view) =>
                page.evaluate((view) => {
                    const vps = window.vrPoseSystem;
                    const T = window.THREE;
                    const v = window.NEXUS_VIEWER;
                    const root = v.avatarManager.currentRoot;
                    root.updateMatrixWorld(true);
                    const box = new T.Box3().setFromObject(root);
                    const c = box.getCenter(new T.Vector3());
                    const size = box.getSize(new T.Vector3());
                    const vb = (k) => vps.getVisualBone(k).getWorldPosition(new T.Vector3());
                    const up = vb('head').sub(vb('hips')).normalize();
                    const right = vb('rightUpperLeg').sub(vb('leftUpperLeg'));
                    right.addScaledVector(up, -right.dot(up)).normalize();
                    const fwd = new T.Vector3().crossVectors(up, right);
                    const flat = (x) => {
                        const y = x.clone();
                        y.y = 0;
                        return y.lengthSq() > 1e-6 ? y.normalize() : new T.Vector3(0, 0, 1);
                    };
                    const dist =
                        (Math.max(size.x, size.y, size.z) * 0.62) / Math.tan(T.MathUtils.degToRad(v.camera.fov) / 2);
                    let pos;
                    if (view === 'front')
                        pos = c
                            .clone()
                            .addScaledVector(flat(fwd).applyAxisAngle(new T.Vector3(0, 1, 0), 0.6), dist)
                            .add(new T.Vector3(0, 0.12, 0));
                    else if (view === 'side')
                        pos = c
                            .clone()
                            .addScaledVector(flat(right), -dist)
                            .add(new T.Vector3(0, 0.08, 0));
                    else if (view === 'ground') {
                        pos = c.clone().addScaledVector(flat(right), -dist);
                        pos.y = box.min.y + 0.12;
                    } else pos = c.clone().add(new T.Vector3(0.001, dist, 0)); // above
                    v.controls.minDistance = 0.05;
                    v.camera.position.copy(pos);
                    v.controls.target.copy(c);
                    v.controls.update();
                }, view);

            for (const view of sc.views) {
                await at(null);
                await camera(view);
                for (const t of TIMES) {
                    await at(null);
                    await canvas.screenshot({ path: path.join(dir, `off-${view}-${t.toFixed(2)}.png`) });
                    await at(t);
                    await canvas.screenshot({ path: path.join(dir, `on-${view}-${t.toFixed(2)}.png`) });
                }
            }

            // Playback: six seconds at 10 fps, front (or ground) view, for a GIF.
            await camera(sc.views[0]);
            for (let k = 0; k < 60; k += 1) {
                await at(k / 10);
                await canvas.screenshot({ path: path.join(dir, `play-${String(k).padStart(3, '0')}.png`) });
            }

            // Trajectories: angles of each bone off the held pose, about her own axes, every 0.1 s.
            const traj = [];
            for (let k = 0; k <= 60; k += 1) {
                await at(k / 10);
                traj.push(
                    await page.evaluate((t) => {
                        const vps = window.vrPoseSystem;
                        const T = window.THREE;
                        const held = window.__LM_HELD;
                        const vb = (b) => vps.getVisualBone(b);
                        const wp = (b) => vb(b).getWorldPosition(new T.Vector3());
                        const up = wp('head').sub(wp('hips')).normalize();
                        const right = wp('rightUpperLeg').sub(wp('leftUpperLeg'));
                        right.addScaledVector(up, -right.dot(up)).normalize();
                        const fwd = new T.Vector3().crossVectors(up, right);
                        const row = { t };
                        for (const b of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']) {
                            const bone = vps._bones.get(b);
                            if (!bone || !held[b]) continue;
                            const now = bone.getWorldQuaternion(new T.Quaternion());
                            const d = now.clone().multiply(new T.Quaternion().fromArray(held[b]).invert());
                            const ang = 2 * Math.acos(Math.min(1, Math.abs(d.w)));
                            const ax = new T.Vector3(d.x, d.y, d.z);
                            const sgn = d.w < 0 ? -1 : 1;
                            const len = ax.length();
                            if (len > 1e-9) ax.multiplyScalar(sgn / len);
                            // signed pitch about her right: + is backwards (arch, head back)
                            row[b] = +((ang * ax.dot(right) * 180) / Math.PI).toFixed(2);
                        }
                        row.headPos = wp('head')
                            .toArray()
                            .map((x) => +x.toFixed(4));
                        for (const s of ['left', 'right']) {
                            row[s + 'Elbow'] = wp(s + 'LowerArm')
                                .toArray()
                                .map((x) => +x.toFixed(4));
                            row[s + 'Hand'] = wp(s + 'Hand')
                                .toArray()
                                .map((x) => +x.toFixed(4));
                        }
                        row.knees = [wp('leftLowerLeg'), wp('rightLowerLeg')].map((p) =>
                            p.toArray().map((x) => +x.toFixed(4))
                        );
                        row.forwardY = +fwd.y.toFixed(3);
                        return row;
                    }, k / 10)
                );
            }
            fs.writeFileSync(path.join(dir, 'trajectory.json'), JSON.stringify(traj));
            const span = (k) => {
                const xs = traj.map((r) => r[k]).filter((x) => typeof x === 'number');
                return xs.length ? +(Math.max(...xs) - Math.min(...xs)).toFixed(1) : null;
            };
            const knee = Math.max(...traj.map((r) => Math.hypot(...r.knees[0].map((x, i) => x - traj[0].knees[0][i]))));
            console.log(
                sc.name,
                JSON.stringify({
                    rangeDeg: Object.fromEntries(
                        ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'].map((b) => [b, span(b)])
                    ),
                    headPeakDeg: Math.max(...traj.map((r) => r.head || 0)),
                    kneeDriftMm: Math.round(knee * 1000),
                })
            );
        }
        await page.evaluate(() => window.vrPoseSystem.setLayer(null));
    } finally {
        await browser.close();
        server.stop();
    }
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
