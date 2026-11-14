#!/usr/bin/env node
/**
 * Smoke-play curated develop/ BVH candidates on AvatarSample_A.
 * Uses site-absolute URLs (/develop/...) so the clip loader does not prefix
 * vendor/animations/. Staging only — does not promote clips into product.
 *
 *   npm start   # http://127.0.0.1:8080
 *   node develop/verification/play-candidates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(path.join(ROOT, 'package.json'));

/** IIFE scorer — package.json is "type":"module", so require() yields an empty module. */
function loadScorer() {
    const src = fs.readFileSync(path.join(ROOT, 'tools/qa/AnimationPlaybackScorer.js'), 'utf8');
    const sandbox = { module: { exports: {} }, exports: {}, console, Math };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.window = undefined;
    vm.runInNewContext(src, sandbox, { filename: 'AnimationPlaybackScorer.js' });
    return sandbox.module.exports || sandbox.NEXUS_ANIMATION_PLAYBACK_SCORER;
}
const Scorer = loadScorer();
if (!Scorer || typeof Scorer.score !== 'function') {
    throw new Error('Failed to load AnimationPlaybackScorer');
}

const OUT = path.join(ROOT, 'develop/verification/runs/develop-candidates');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const CANDIDATES = [
    'develop/sources/accad-female1/Female1_A01_Stand.bvh',
    'develop/sources/accad-female1/Female1_A02_Sway.bvh',
    'develop/sources/accad-female1/Female1_D2_Wait.bvh',
    'develop/sources/accad-female1/Female1_D3_ConversationGestures.bvh',
    'develop/sources/accad-female1/Female1_B01_StandToWalk.bvh',
    'develop/sources/accad-female1/Female1_A07_Crouch.bvh',
    'develop/sources/cmu-curated/013/13_01.bvh',
    'develop/sources/cmu-curated/013/13_26.bvh',
    'develop/sources/cmu-curated/013/13_29.bvh',
    'develop/sources/cmu-curated/002/02_01.bvh',
    'develop/sources/cmu-curated/018/18_08.bvh',
    'develop/sources/cmu-curated/005/05_02.bvh',
];

const SAMPLE_BONES = Scorer.SAMPLE_BONES || [
    'hips',
    'spine',
    'chest',
    'head',
    'leftUpperLeg',
    'rightUpperLeg',
    'leftLowerLeg',
    'rightLowerLeg',
    'leftUpperArm',
    'rightUpperArm',
];

async function sampleBones(page, waitMs = 80) {
    return page.evaluate(
        async ({ boneNames, waitMs }) => {
            await new Promise((r) => setTimeout(r, waitMs));
            const vrm = window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM;
            const h = vrm?.humanoid;
            if (!h) return null;
            const out = {};
            for (const name of boneNames) {
                const node =
                    (typeof h.getRawBoneNode === 'function' && h.getRawBoneNode(name)) ||
                    (typeof h.getNormalizedBoneNode === 'function' && h.getNormalizedBoneNode(name));
                if (!node) continue;
                const q = node.quaternion;
                const p = new THREE.Vector3();
                node.getWorldPosition(p);
                out[name] = { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
            }
            return out;
        },
        { boneNames: SAMPLE_BONES, waitMs }
    );
}

async function main() {
    let playwright;
    try {
        playwright = require('playwright');
    } catch {
        throw new Error('Playwright required: npm i --no-save playwright && npx playwright install chromium');
    }

    const base = process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080';
    const health = await fetch(base + '/health').catch(() => null);
    if (!health || !health.ok) throw new Error('Start the app first: npm start (expected ' + base + ')');

    // Confirm a develop asset is served (not SPA HTML fallback).
    const probe = await fetch(base + '/' + CANDIDATES[0]);
    const probeText = await probe.text();
    if (/^\s*</.test(probeText)) {
        throw new Error('develop/ BVH not served as a file (got HTML). Is the static root the repo?');
    }

    const browser = await playwright.chromium.launch({
        args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    });
    const rows = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.setDefaultTimeout(180000);
        await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.NEXUS_VIEWER && window.NEXUS_CLIP_LOADER && window.vrPoseSystem, null, {
            timeout: 180000,
        });
        await page.waitForTimeout(1200);

        await page.evaluate(async () => {
            await window.NEXUS_VIEWER.loadAvatar('/vendor/avatars/AvatarSample_A.vrm');
        });
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem?._bones?.size > 0,
            null,
            { timeout: 120000 }
        );
        await page.waitForTimeout(800);

        await page.evaluate(() => {
            window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
            window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(false);
            const vr = window.vrPoseSystem;
            vr?.setEnabled?.(true);
            vr?.applyPreset?.('lecturerNeutral', 0);
        });
        await page.waitForTimeout(250);
        const standing = await sampleBones(page, 100);
        const standingHipsY = standing?.hips?.y ?? null;

        for (const rel of CANDIDATES) {
            const urlPath = '/' + rel.replace(/^\/+/, '');
            const id = path.basename(rel);
            const row = {
                avatar: 'AvatarSample_A',
                kind: 'bvh',
                category: 'develop-candidate',
                id,
                path: rel,
                played: false,
                verdict: 'fail',
                flags: [],
                motion: null,
                hipsY: null,
                error: '',
                shot: '',
            };
            try {
                await page.evaluate(() => {
                    window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
                    try {
                        window.vrPoseSystem?.setEnabled?.(false);
                    } catch (_) {
                        /* ignore */
                    }
                    if (window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer)
                        window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false);
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(false);
                    const am = window.NEXUS_VIEWER?.avatarManager;
                    if (window.NEXUS_CLIP_LOADER?.registerAvatar && am?.currentRoot)
                        window.NEXUS_CLIP_LOADER.registerAvatar(
                            am.currentRoot,
                            am.vrmLoader?.currentVRM || am._currentVRM
                        );
                });
                await page.waitForTimeout(120);
                const rest = await sampleBones(page, 80);

                const played = await page.evaluate(async (clipUrl) => {
                    try {
                        const ok = await window.NEXUS_CLIP_LOADER.playClip(clipUrl, {
                            loop: true,
                            fadeIn: 0,
                        });
                        return { ok: !!ok, err: ok ? null : 'playClip-false' };
                    } catch (e) {
                        return { ok: false, err: String(e && e.message ? e.message : e).slice(0, 200) };
                    }
                }, urlPath);

                row.played = !!played.ok;
                row.error = played.err || '';
                const samples = [];
                if (row.played) {
                    await page.waitForTimeout(450);
                    samples.push(await sampleBones(page, 50));
                    await page.waitForTimeout(900);
                    samples.push(await sampleBones(page, 50));
                }

                const scored = Scorer.score({
                    played: row.played,
                    loadError: row.error || null,
                    rest,
                    samples: samples.filter(Boolean),
                    standingHipsY,
                    kind: 'bvh',
                    category: 'develop-candidate',
                    expectedMotion: true,
                    blackBackground: true,
                });
                row.verdict = scored.verdict;
                row.flags = scored.flags || [];
                row.motion = scored.motion;
                row.hipsY = scored.hipsY;

                if (row.verdict !== 'ok') {
                    const shotRel = path.posix.join('shots', id.replace(/[^\w.-]+/g, '_') + '.jpg');
                    const shotAbs = path.join(OUT, shotRel);
                    const jpeg = await page.evaluate(async () => {
                        const canvas = document.querySelector('#viewer canvas') || document.querySelector('canvas');
                        if (!canvas) return null;
                        const blob = await new Promise((resolve) =>
                            canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7)
                        );
                        if (!blob) return null;
                        const buf = await blob.arrayBuffer();
                        return Array.from(new Uint8Array(buf));
                    });
                    if (jpeg) {
                        fs.writeFileSync(shotAbs, Buffer.from(jpeg));
                        row.shot = shotRel;
                    }
                }
                console.log(
                    row.verdict.toUpperCase().padEnd(4),
                    id.padEnd(40),
                    'hips',
                    row.hipsY,
                    (row.flags || []).join('|') || '-',
                    row.error || ''
                );
            } catch (e) {
                row.error = String(e && e.message ? e.message : e).slice(0, 200);
                row.flags = ['load-error'];
                console.log('FAIL', id, row.error);
            }
            rows.push(row);
        }
    } finally {
        await browser.close();
    }

    const summary = {
        schema: 1,
        generator: 'develop/verification/play-candidates.mjs',
        note: 'Curated develop/ BVH smoke — not product integration',
        summary: {
            jobs: rows.length,
            ok: rows.filter((r) => r.verdict === 'ok').length,
            warn: rows.filter((r) => r.verdict === 'warn').length,
            fail: rows.filter((r) => r.verdict === 'fail').length,
        },
        rows,
    };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'candidates.csv'), Scorer.rowsToCsv(rows));
    console.log('summary', summary.summary, '→', path.relative(ROOT, OUT));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
