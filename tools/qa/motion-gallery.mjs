#!/usr/bin/env node
/**
 * MP2. A gallery of the motion we support, on a real avatar, for later review: every item in the
 * provenance registry (src/gltf-viewer/MotionProvenance.js) as a short sequence of frames, tagged
 * with how it was made. `tools/qa/review_sheets.py gallery` turns the frames into GIFs and an
 * index.html; it can also take `audits/animations/run.mjs` runs, so the clip library (and the
 * CC0 dances, reviewed with `--files`) sit in the same gallery.
 *
 *   node tools/qa/motion-gallery.mjs --vrm vendor/avatars/Vita.vrm [--out dir] [--only preset,show]
 *   node audits/animations/run.mjs --avatars Vita --files addons/vrma-cc0/slow_body_roll.vrma,addons/vrma-cc0/club_phrase.vrma --tag cc0
 *   python3 tools/qa/review_sheets.py gallery <out dir> [audits/animations/runs/<…-cc0> …]
 *
 * What each kind shows:
 *   preset      held still, then with the living layer at the closest step (4 s, fixed clock)
 *   transition  from standing into a closer preset and back, at the blend's own pace (wall clock)
 *   show        each step as the bridge plays it: a pose held, a clip danced (1.5 s each)
 *   layer       riding, riding at the finish, sitting open, on her back (5 s, fixed clock)
 *
 * Cameras come from her bones (front, 35° round; lying down, from the side just above the floor).
 * Output under audits/poses/runs/ (gitignored): frames of Private poses are never committed.
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
const FILE = arg('--vrm', 'vendor/avatars/Vita.vrm');
const ONLY = arg('--only', '').split(',').filter(Boolean);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-gallery`)));

/** Private's pose keys for each preset (PrivatePoseController.POSES), for the layer's styles. */
const KEY_OF = { sittingOpen: 'sit-open', kneelingWide: 'kneel-wide', lyingKneesUp: 'knees-up', straddle: 'straddle' };
const LAYER = [
    { id: 'layer:riding', preset: 'straddle', pose: 'straddle', what: 'Riding: breathing, rocking, arch' },
    {
        id: 'layer:finish',
        preset: 'straddle',
        pose: 'straddle',
        finish: true,
        what: 'Riding at the finish: head back, shudder',
    },
    {
        id: 'layer:sitting-open',
        preset: 'sittingOpen',
        pose: 'sit-open',
        what: 'Sitting open: hands on breast and belly',
    },
    { id: 'layer:knees-up', preset: 'lyingKneesUp', pose: 'knees-up', what: 'On her back: breathing, hands' },
];

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const manifest = [];
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
        // Spicy on for the run, so the adult presets are listed (the page's own gate, not bypassed).
        await page.evaluate(() => {
            window.NEXUS_SPICY = Object.assign({}, window.NEXUS_SPICY, { isEnabled: () => true });
        });
        const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
        const items = await page.evaluate(() => window.NEXUS_MOTION_PROVENANCE.ITEMS);

        const hold = (preset) =>
            page.evaluate(async (preset) => {
                const vps = window.vrPoseSystem;
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                vps.setLayer(null);
                window.NEXUS_CLIP_LOADER?.stopClip?.();
                window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode(true);
                vps.claimBones();
                vps.applyPreset(preset, 0.3);
                const t0 = performance.now();
                while (vps.isSettling() && performance.now() - t0 < 8000) await wait(100);
                await wait(300);
            }, preset);
        const camera = () =>
            page.evaluate(() => {
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
                const lying = Math.abs(up.y) < 0.6;
                const flat = (x) => {
                    const y = x.clone();
                    y.y = 0;
                    return y.lengthSq() > 1e-6 ? y.normalize() : new T.Vector3(0, 0, 1);
                };
                const dist =
                    (Math.max(size.x, size.y, size.z) * 0.62) / Math.tan(T.MathUtils.degToRad(v.camera.fov) / 2);
                const dir = lying ? flat(right).negate() : flat(fwd).applyAxisAngle(new T.Vector3(0, 1, 0), 0.6);
                const pos = c.clone().addScaledVector(dir, dist);
                pos.y = lying ? box.min.y + 0.35 : c.y + 0.12;
                v.controls.minDistance = 0.05;
                v.camera.position.copy(pos);
                v.controls.target.copy(c);
                v.controls.update();
            });
        // The living layer on a fixed clock: frame `t` s into an evening at the closest step.
        const layerAt = (pose, t, finish) =>
            page.evaluate(
                async ([pose, t, finish]) => {
                    const vps = window.vrPoseSystem;
                    const L = window.NEXUS_PRIVATE_LIVING;
                    const st = L.create();
                    let frame = null;
                    const start = 20;
                    for (let i = 0; i < Math.round((start + t) * 60); i += 1) {
                        const now = (i + 1) / 60;
                        frame = st.step(1 / 60, {
                            pose,
                            level: 4,
                            secondsAtTop: now,
                            sinceFinish: finish && now >= start ? now - start : null,
                        });
                    }
                    vps.setLayer({ keys: L.BONES, apply: (d, rig, THREE) => L.apply(rig, frame, THREE) });
                    await new Promise((r) => setTimeout(r, 150));
                },
                [pose, t, finish]
            );
        const shoot = async (dir, k) =>
            canvas.screenshot({ path: path.join(dir, `${String(k).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 72 });
        const entry = (id, kind, extra) => {
            const it = items.find((i) => i.id === id) || {};
            const dir = path.join(out, id.replace(/[^A-Za-z0-9_-]+/g, '_'));
            fs.mkdirSync(dir, { recursive: true });
            const e = Object.assign(
                {
                    id,
                    kind,
                    dir: path.basename(dir),
                    method: it.method || null,
                    batch: it.batch || null,
                    what: it.what || '',
                },
                extra || {}
            );
            manifest.push(e);
            return { dir, e };
        };
        const want = (kind) => !ONLY.length || ONLY.includes(kind);

        // Presets: held still (2 frames), then the living layer (4 s at 8 fps).
        if (want('preset'))
            for (const it of items.filter((i) => i.method === 'hand-authored-preset' && i.name !== 'floorOpen')) {
                const { dir, e } = entry(it.id, 'preset', { fps: 8 });
                await hold(it.name);
                await camera();
                await page.evaluate(() => window.vrPoseSystem.setLayer(null));
                await shoot(dir, 0);
                await shoot(dir, 1);
                let k = 2;
                for (let i = 0; i < 32; i += 1) {
                    await layerAt(KEY_OF[it.name] || null, i / 8, false);
                    await shoot(dir, k++);
                }
                e.note = 'first 2 frames: the preset held still; then the living layer at the closest step';
                console.log(it.id, k, 'frames');
            }

        // The transition: standing → kneeling wide → standing, at the blend's own pace.
        if (want('transition')) {
            const { dir, e } = entry('transition:stagger', 'transition', { fps: 10 });
            await hold('standingRelaxed');
            await camera();
            let k = 0;
            for (const target of ['kneelingWide', 'standingRelaxed']) {
                await page.evaluate((p) => window.vrPoseSystem.applyPreset(p, 0.8), target);
                for (let i = 0; i < 22; i += 1) {
                    await shoot(dir, k++);
                    await page.waitForTimeout(60);
                }
            }
            e.note = 'wall clock: standing into kneeling wide and back';
            console.log('transition', k, 'frames');
        }

        // Shows: each step as the bridge plays it — a pose held, or a clip danced.
        if (want('show'))
            for (const it of items.filter((i) => i.method === 'composed-show')) {
                const steps = await page.evaluate((id) => {
                    const R = window.NEXUS_PRIVATE_ROUTINES;
                    const P = window.NEXUS_PRIVATE_POSES;
                    return R.ROUTINES[id].steps.map((s) => ({
                        pose: s.pose || null,
                        preset: s.pose && P.POSES[s.pose] ? P.POSES[s.pose].preset : null,
                        clip: s.clip || null,
                    }));
                }, it.name);
                const { dir, e } = entry(it.id, 'show', { fps: 4, steps: steps.length });
                let k = 0;
                let turned = false;
                for (const s of steps) {
                    if (s.clip) {
                        await page.evaluate(async (clip) => {
                            const vps = window.vrPoseSystem;
                            vps.setLayer(null);
                            vps.releaseBones({ blendSeconds: 0.2 });
                            await window.NEXUS_CLIP_LOADER.playClip(clip, { loop: true });
                        }, s.clip);
                        await page.waitForTimeout(600);
                        await camera();
                        for (let i = 0; i < 6; i += 1) {
                            await shoot(dir, k++);
                            await page.waitForTimeout(250);
                        }
                    } else if (s.pose === 'turn') {
                        turned = !turned;
                        await page.evaluate((t) => {
                            const root = window.NEXUS_VIEWER.avatarManager.currentRoot;
                            root.rotation.y += Math.PI;
                            void t;
                        }, turned);
                        for (let i = 0; i < 4; i += 1) await shoot(dir, k++);
                    } else if (s.preset) {
                        await hold(s.preset);
                        await camera();
                        for (let i = 0; i < 4; i += 1) await shoot(dir, k++);
                    }
                }
                if (turned)
                    await page.evaluate(() => {
                        window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y += Math.PI;
                    });
                await page.evaluate(() => window.NEXUS_CLIP_LOADER?.stopClip?.());
                e.note = 'each step: a held pose (4 frames) or the clip danced (6 frames, 0.25 s apart)';
                console.log(it.id, k, 'frames');
            }

        // The living layer in the positions it was built for.
        if (want('layer'))
            for (const l of LAYER) {
                const { dir, e } = entry(l.id, 'layer', {
                    fps: 10,
                    method: 'procedural-layer',
                    batch: 'LM1–LM4',
                    what: l.what,
                });
                await hold(l.preset);
                await camera();
                let k = 0;
                for (let i = 0; i < 50; i += 1) {
                    await layerAt(l.pose, i / 10, l.finish);
                    await shoot(dir, k++);
                }
                console.log(l.id, k, 'frames');
            }
        await page.evaluate(() => window.vrPoseSystem.setLayer(null));
    } finally {
        fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ vrm: FILE, items: manifest }, null, 1));
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
