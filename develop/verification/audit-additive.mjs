#!/usr/bin/env node
/**
 * Additive-only audit for develop/addons/stable.
 * High-signal, short loop for AI coders (Claude / Cursor / Grok):
 *
 *   npm start
 *   node develop/verification/audit-additive.mjs
 *   node develop/verification/audit-additive.mjs --strict
 *
 * Scans only develop/addons/stable/ for .vrma and .bvh — not the full vendor matrix.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STABLE = path.join(ROOT, 'develop/addons/stable');
const require = createRequire(path.join(ROOT, 'package.json'));
const STRICT = process.argv.includes('--strict');
const AVATAR = '/vendor/avatars/AvatarSample_A.vrm';

/** Optional: --dir <path> (repeatable). Default = develop/addons/stable. */
function scanRoots() {
    const roots = [];
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir' && argv[i + 1]) {
            roots.push(path.resolve(argv[++i]));
        }
    }
    return roots.length ? roots : [STABLE];
}

function loadScorer() {
    const src = fs.readFileSync(path.join(ROOT, 'tools/qa/AnimationPlaybackScorer.js'), 'utf8');
    const sandbox = { module: { exports: {} }, exports: {}, console, Math };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(src, sandbox, { filename: 'AnimationPlaybackScorer.js' });
    const api = sandbox.module.exports || sandbox.NEXUS_ANIMATION_PLAYBACK_SCORER;
    if (!api?.score) throw new Error('AnimationPlaybackScorer failed to load');
    return api;
}

function listClips(roots) {
    const out = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p);
            else if (/\.(vrma|bvh)$/i.test(name)) out.push(p);
        }
    };
    for (const root of roots) walk(root);
    return out.sort();
}

async function sampleBones(page, Scorer) {
    const boneNames = Scorer.SAMPLE_BONES || [
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
    return page.evaluate(
        async ({ boneNames }) => {
            await new Promise((r) => setTimeout(r, 80));
            const h = window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM?.humanoid;
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
        { boneNames }
    );
}

async function main() {
    const Scorer = loadScorer();
    const roots = scanRoots();
    const clips = listClips(roots);
    if (!clips.length) {
        console.log('additive-audit: no .vrma/.bvh under', roots.map((r) => path.relative(ROOT, r)).join(', '));
        process.exit(0);
    }

    let playwright;
    try {
        playwright = require('playwright');
    } catch {
        throw new Error('npm i --no-save playwright && npx playwright install chromium');
    }

    const base = process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080';
    const health = await fetch(base + '/health').catch(() => null);
    if (!health?.ok) throw new Error('Start the app: npm start (expected ' + base + ')');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(ROOT, 'develop/verification/runs', 'additive-' + stamp);
    fs.mkdirSync(outDir, { recursive: true });

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
        await page.waitForTimeout(800);
        await page.evaluate(async (url) => {
            await window.NEXUS_VIEWER.loadAvatar(url);
        }, AVATAR);
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM && window.vrPoseSystem?._bones?.size > 0,
            null,
            { timeout: 120000 }
        );
        await page.waitForTimeout(600);

        await page.evaluate(() => {
            window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
            window.vrPoseSystem?.setEnabled?.(true);
            window.vrPoseSystem?.applyPreset?.('lecturerNeutral', 0);
        });
        await page.waitForTimeout(200);
        const standing = await sampleBones(page, Scorer);
        const standingHipsY = standing?.hips?.y ?? null;

        console.log('additive-audit:', clips.length, 'clips →', path.relative(ROOT, outDir));
        for (const abs of clips) {
            const rel = path.relative(ROOT, abs).split(path.sep).join('/');
            const urlPath = '/' + rel;
            const id = path.basename(abs);
            const kind = /\.vrma$/i.test(id) ? 'vrma' : 'bvh';
            const row = {
                avatar: 'AvatarSample_A',
                kind,
                category: 'develop-stable',
                id,
                path: rel,
                played: false,
                verdict: 'fail',
                flags: [],
                motion: null,
                hipsY: null,
                error: '',
            };

            // SPA fallback check
            const head = await fetch(base + urlPath);
            const buf = Buffer.from(await head.arrayBuffer());
            if (buf.slice(0, 1).toString() === '<' || /html/i.test(head.headers.get('content-type') || '')) {
                row.error = 'served-html-not-clip';
                row.flags = ['play-failed', 'load-error'];
                rows.push(row);
                console.log('FAIL', id, row.error);
                continue;
            }

            await page.evaluate(() => {
                window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
                try {
                    window.vrPoseSystem?.setEnabled?.(false);
                } catch (_) {
                    /* ignore */
                }
                if (window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer)
                    window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false);
                const am = window.NEXUS_VIEWER?.avatarManager;
                if (window.NEXUS_CLIP_LOADER?.registerAvatar && am?.currentRoot)
                    window.NEXUS_CLIP_LOADER.registerAvatar(am.currentRoot, am.vrmLoader?.currentVRM || am._currentVRM);
            });
            const rest = await sampleBones(page, Scorer);
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
                samples.push(await sampleBones(page, Scorer));
                await page.waitForTimeout(900);
                samples.push(await sampleBones(page, Scorer));
            }
            const scored = Scorer.score({
                played: row.played,
                loadError: row.error || null,
                rest,
                samples: samples.filter(Boolean),
                standingHipsY,
                kind,
                category: 'develop-stable',
                expectedMotion: true,
                blackBackground: true,
            });
            row.verdict = scored.verdict;
            row.flags = scored.flags || [];
            row.motion = scored.motion;
            row.hipsY = scored.hipsY;
            console.log(
                row.verdict.toUpperCase().padEnd(4),
                id.padEnd(36),
                'hips',
                row.hipsY,
                (row.flags || []).join('|') || '-'
            );
            rows.push(row);
        }
    } finally {
        await browser.close();
    }

    const summary = {
        schema: 1,
        generator: 'develop/verification/audit-additive.mjs',
        avatar: 'AvatarSample_A.vrm',
        scope: 'develop/addons/stable/**/*.{vrma,bvh}',
        summary: {
            jobs: rows.length,
            ok: rows.filter((r) => r.verdict === 'ok').length,
            warn: rows.filter((r) => r.verdict === 'warn').length,
            fail: rows.filter((r) => r.verdict === 'fail').length,
        },
        rows,
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, 'additive.csv'), Scorer.rowsToCsv(rows));
    // Latest pointer for agents
    fs.writeFileSync(
        path.join(ROOT, 'develop/verification/runs/LATEST.json'),
        JSON.stringify(
            {
                outDir: path.relative(ROOT, outDir),
                ...summary.summary,
                at: new Date().toISOString(),
            },
            null,
            2
        ) + '\n'
    );

    console.log('summary', summary.summary);
    const bad = summary.summary.fail + (STRICT ? summary.summary.warn : 0);
    process.exit(bad ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
