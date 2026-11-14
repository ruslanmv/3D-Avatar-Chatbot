#!/usr/bin/env node
/**
 * One-shot: can Quaternius UAL GLB drive AvatarSample_A?
 * Product ClipLoader only accepts .bvh/.vrma — this probes raw GLTF load +
 * name-based mixer on the VRM scene (best-effort).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const GLB = '/develop/addons/stable/quaternius-ual-standard/Godot/AnimationLibrary_Godot_Standard.glb';
const AVATAR = '/vendor/avatars/AvatarSample_A.vrm';
const TRY = ['Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop', 'Jump_Start', 'A_TPose'];

async function main() {
    const playwright = require('playwright');
    const base = process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080';
    const health = await fetch(base + '/health').catch(() => null);
    if (!health?.ok) throw new Error('npm start required');

    const browser = await playwright.chromium.launch({
        args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180000);
    const logs = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || /warn|Clip|GLTF|quaternius/i.test(m.text())) logs.push(m.text());
    });

    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.NEXUS_VIEWER && window.THREE, null, { timeout: 180000 });
    await page.waitForTimeout(800);
    await page.evaluate(async (url) => {
        await window.NEXUS_VIEWER.loadAvatar(url);
    }, AVATAR);
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM, null, {
        timeout: 120000,
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate(
        async ({ glbUrl, tryNames }) => {
            const THREE = window.THREE;
            const vrm = window.NEXUS_VIEWER.avatarManager.vrmLoader.currentVRM;
            const scene = vrm.scene;
            const humanoid = vrm.humanoid;

            // Standing hips
            const hips =
                (humanoid.getRawBoneNode && humanoid.getRawBoneNode('hips')) ||
                (humanoid.getNormalizedBoneNode && humanoid.getNormalizedBoneNode('hips'));
            const standing = new THREE.Vector3();
            if (hips) hips.getWorldPosition(standing);

            // Load GLB
            const loader = new THREE.GLTFLoader();
            let gltf;
            try {
                gltf = await new Promise((resolve, reject) => {
                    loader.load(glbUrl, resolve, undefined, reject);
                });
            } catch (e) {
                return { loadOk: false, error: String(e && e.message ? e.message : e) };
            }

            const animNames = (gltf.animations || []).map((c) => c.name);
            const sampleTracks = [];
            const first = gltf.animations[0];
            if (first) {
                for (const t of first.tracks.slice(0, 12)) sampleTracks.push(t.name);
            }

            // VRM bone node names available to mixer
            const vrmBoneNames = [];
            const boneList = [
                'hips',
                'spine',
                'chest',
                'head',
                'leftUpperArm',
                'rightUpperArm',
                'leftUpperLeg',
                'rightUpperLeg',
            ];
            for (const b of boneList) {
                const n =
                    (humanoid.getNormalizedBoneNode && humanoid.getNormalizedBoneNode(b)) ||
                    (humanoid.getRawBoneNode && humanoid.getRawBoneNode(b));
                if (n) vrmBoneNames.push({ humanoid: b, node: n.name });
            }

            // Overlap between Quaternius track roots and VRM node names
            const trackRoots = new Set();
            for (const clip of gltf.animations) {
                for (const t of clip.tracks) {
                    const root = String(t.name).split('.')[0];
                    trackRoots.add(root);
                }
            }
            const vrmSet = new Set(vrmBoneNames.map((x) => x.node));
            const overlap = [...trackRoots].filter((r) => vrmSet.has(r));

            const trials = [];
            for (const name of tryNames) {
                const clip = gltf.animations.find((c) => c.name === name);
                if (!clip) {
                    trials.push({ name, played: false, error: 'clip-missing' });
                    continue;
                }
                // Count tracks that resolve under VRM scene
                let resolvable = 0;
                for (const t of clip.tracks) {
                    const root = String(t.name).split('.')[0];
                    if (scene.getObjectByName(root)) resolvable++;
                }
                const mixer = new THREE.AnimationMixer(scene);
                let action;
                try {
                    action = mixer.clipAction(clip);
                    action.reset().play();
                    // Advance a bit
                    for (let i = 0; i < 30; i++) mixer.update(1 / 30);
                } catch (e) {
                    trials.push({ name, played: false, error: String(e.message || e), resolvable });
                    continue;
                }
                const after = new THREE.Vector3();
                if (hips) hips.getWorldPosition(after);
                action.stop();
                mixer.stopAllAction();
                trials.push({
                    name,
                    played: true,
                    resolvable,
                    totalTracks: clip.tracks.length,
                    hipsY: Number(after.y.toFixed(3)),
                    hipsDelta: Number((after.y - standing.y).toFixed(3)),
                    // If almost no tracks bind, motion is effectively dead
                    effective: resolvable > 5,
                });
            }

            return {
                loadOk: true,
                animCount: animNames.length,
                animNames: animNames.slice(0, 20),
                sampleTracks,
                trackRoots: [...trackRoots].slice(0, 30),
                vrmBoneNames,
                nameOverlap: overlap,
                standingHipsY: Number(standing.y.toFixed(3)),
                trials,
                clipLoaderSupportsGlb: false, // documented in product
            };
        },
        { glbUrl: GLB, tryNames: TRY }
    );

    await browser.close();

    const outDir = path.join(ROOT, 'develop/verification/runs/quaternius-glb-probe');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
        path.join(outDir, 'probe.json'),
        JSON.stringify({ result, logs: logs.slice(-40) }, null, 2) + '\n'
    );

    console.log(JSON.stringify(result, null, 2));
    const anyEffective = (result.trials || []).some((t) => t.effective);
    const verdict = result.loadOk && anyEffective ? 'maybe-works' : 'does-not-drive-vrm';
    console.log('VERDICT', verdict);
    process.exit(anyEffective ? 0 : 2);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
