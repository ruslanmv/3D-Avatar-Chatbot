#!/usr/bin/env node
/**
 * Screenshot every .vrma under develop/addons/{stable,pending} mid-playback.
 *
 *   npm start
 *   node develop/verification/screenshot-clips.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const AVATAR = '/vendor/avatars/AvatarSample_A.vrm';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(ROOT, 'develop/verification/runs', 'screenshots-' + STAMP);
const ARTIFACTS = '/opt/cursor/artifacts/pr153-animation-screenshots';

const LABELS = {
    'idle_loop.vrma': 'stable-mit-idle_loop',
    'test.vrma': 'stable-mit-test',
    'Blush.vrma': 'stable-tk256-Blush',
    'Clapping.vrma': 'stable-tk256-Clapping',
    'Goodbye.vrma': 'stable-tk256-Goodbye',
    'Jump.vrma': 'stable-tk256-Jump',
    'LookAround.vrma': 'stable-tk256-LookAround',
    'Sleepy.vrma': 'stable-tk256-Sleepy',
    'VRMA_01.vrma': 'booth-01-ShowFullBody',
    'VRMA_03.vrma': 'booth-03-PeaceSign',
    'VRMA_04.vrma': 'booth-04-Shoot',
    'VRMA_05.vrma': 'booth-05-Spin',
    'VRMA_06.vrma': 'booth-06-ModelPose',
    'VRMA_07.vrma': 'booth-07-Squat',
    'MCPM_20230806_154241.vrma': 'mocopi-154241',
    'MCPM_20230806_154323.vrma': 'mocopi-154323',
    'MCPM_20230806_154402.vrma': 'mocopi-154402',
    'MCPM_20230806_154429.vrma': 'mocopi-154429',
    'MCPM_20230806_154455.vrma': 'mocopi-154455',
};

function listClips() {
    const roots = [path.join(ROOT, 'develop/addons/stable'), path.join(ROOT, 'develop/addons/pending')];
    const out = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p);
            else if (/\.vrma$/i.test(name)) out.push(p);
        }
    };
    for (const r of roots) walk(r);
    return out.sort();
}

async function main() {
    const playwright = require('playwright');
    const base = process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080';
    const health = await fetch(base + '/health').catch(() => null);
    if (!health?.ok) throw new Error('npm start required');

    const clips = listClips();
    fs.mkdirSync(OUT, { recursive: true });
    fs.mkdirSync(ARTIFACTS, { recursive: true });

    const browser = await playwright.chromium.launch({
        args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180000);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.NEXUS_VIEWER && window.NEXUS_CLIP_LOADER && window.THREE, null, {
        timeout: 180000,
    });
    await page.waitForTimeout(800);
    await page.evaluate(async (url) => {
        await window.NEXUS_VIEWER.loadAvatar(url);
    }, AVATAR);
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM, null, {
        timeout: 120000,
    });
    await page.waitForTimeout(600);

    // Prefer a readable framing if helpers exist
    await page.evaluate(() => {
        try {
            window.NEXUS_VIEWER?.cameraController?.frameAvatar?.() ||
                window.NEXUS_CAMERA_FRAMING?.frameAvatar?.() ||
                window.vrPoseSystem?.applyPreset?.('lecturerNeutral', 0);
        } catch (_) {
            /* ignore */
        }
        // Soft background for readable shots
        try {
            if (window.NEXUS_VIEWER?.renderer) {
                window.NEXUS_VIEWER.renderer.setClearColor(0x2a2a32, 1);
            }
        } catch (_) {
            /* ignore */
        }
    });
    await page.waitForTimeout(300);

    const index = [];
    console.log('screenshot-clips:', clips.length, '→', path.relative(ROOT, OUT));
    for (const abs of clips) {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        const id = path.basename(abs);
        const label = LABELS[id] || id.replace(/\.vrma$/i, '');
        const file = label + '.png';

        await page.evaluate(() => {
            window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
            try {
                window.vrPoseSystem?.setEnabled?.(false);
            } catch (_) {
                /* ignore */
            }
            const am = window.NEXUS_VIEWER?.avatarManager;
            if (window.NEXUS_CLIP_LOADER?.registerAvatar && am?.currentRoot) {
                window.NEXUS_CLIP_LOADER.registerAvatar(am.currentRoot, am.vrmLoader?.currentVRM || am._currentVRM);
            }
        });

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
        }, '/' + rel);

        // Mid-clip pose
        await page.waitForTimeout(played.ok ? 900 : 200);
        const destRun = path.join(OUT, file);
        const destArt = path.join(ARTIFACTS, file);
        await page.screenshot({ path: destRun, type: 'png' });
        fs.copyFileSync(destRun, destArt);
        const row = { id, label, path: rel, played: played.ok, error: played.err, screenshot: file };
        index.push(row);
        console.log(played.ok ? 'SHOT' : 'FAIL', label, played.err || '');
    }

    await browser.close();
    fs.writeFileSync(
        path.join(OUT, 'index.json'),
        JSON.stringify({ clips: index, out: path.relative(ROOT, OUT) }, null, 2) + '\n'
    );
    // Markdown gallery for PR / agents
    const md = [
        '# Animation screenshots (PR develop/)',
        '',
        `AvatarSample_A · ${index.length} clips · ${STAMP}`,
        '',
        ...index.map((r) => `## ${r.label}\n\n\`${r.path}\` — played: ${r.played}\n\n![${r.label}](${r.screenshot})\n`),
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'GALLERY.md'), md + '\n');
    fs.writeFileSync(path.join(ARTIFACTS, 'GALLERY.md'), md + '\n');
    fs.writeFileSync(path.join(ARTIFACTS, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    console.log('done', index.filter((r) => r.played).length + '/' + index.length, 'OUT', OUT);
    console.log('artifacts', ARTIFACTS);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
