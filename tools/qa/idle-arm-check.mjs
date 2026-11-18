#!/usr/bin/env node
/**
 * MO17. Where her arms hang in each standing idle, and after "stand up".
 *
 *   node tools/qa/idle-arm-check.mjs
 *   node tools/qa/idle-arm-check.mjs --avatars AvatarSample_A --clips vendor/animations/idle/neutral2.bvh
 *
 * A phone showed her, after "stand up", with one arm pressed against her side (the sleeve into the
 * cardigan) and the other held well out: two different arms in one idle. This plays every clip of
 * the standing idle pool and the stand-up clip on several avatars, samples each across its length,
 * and measures both arms against her torso with the same body model the gesture audit uses
 * (tools/qa/GestureBodyCheck.js — an elliptical cylinder around her spine):
 *
 *   clearance  how far the elbow, mid-forearm and hand stay outside the torso (cm; < 0 is inside)
 *   abduction  the upper arm's angle out from her side in her frontal plane (degrees)
 *   asymmetry  the difference between the two arms' abduction (degrees)
 *
 * A clip fails where an arm goes into her torso, an arm hangs closer than 2 cm to it, or the arms
 * differ by more than 14° for a third of the clip. Prints a table and writes
 * tools/qa/idle-arm-check.out.json (git-ignored). A QA tool: the app never loads it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = arg('--avatars', 'AvatarSample_A,Vita,VRM_Viewer_Sample').split(',');
const ONLY = arg('--clips', '').split(',').filter(Boolean);
const SAMPLES = 16;
const LIMITS = { clearCm: 2, asymDeg: 14, asymShare: 1 / 3 };

/** In the page: measure both arms now. */
function probe() {
    const BC = window.NEXUS_GESTURE_BODY_CHECK;
    const T = window.THREE;
    window.__arms = () => {
        const vrm = window.NEXUS_VIEWER.avatarManager._currentVRM;
        vrm.scene.updateMatrixWorld(true);
        const W = (b) => {
            const n = vrm.humanoid.getRawBoneNode(b);
            if (!n) return null;
            const v = n.getWorldPosition(new T.Vector3());
            return { x: v.x, y: v.y, z: v.z };
        };
        const f = BC.frame({
            hips: W('hips'),
            leftUpperLeg: W('leftUpperLeg'),
            rightUpperLeg: W('rightUpperLeg'),
            leftUpperArm: W('leftUpperArm'),
            rightUpperArm: W('rightUpperArm'),
            chest: W('upperChest') || W('chest'),
            neck: W('neck'),
            head: W('head'),
        });
        const t = f.torso;
        // Outside distance from the torso's elliptical wall at that height, in its own plane (cm).
        const clear = (q) => {
            if (q.y < t.bottom || q.y > t.top) return 99;
            const dz = (q.z - t.z) / t.rz;
            if (Math.abs(dz) >= 1) return 99;
            const wall = t.rx * Math.sqrt(1 - dz * dz);
            return (Math.abs(q.x) - wall) * 100;
        };
        const out = {};
        for (const side of ['left', 'right']) {
            const sh = f.toLocal(W(side + 'UpperArm'));
            const el = f.toLocal(W(side + 'LowerArm'));
            const ha = f.toLocal(W(side + 'Hand'));
            const mid = { x: (el.x + ha.x) / 2, y: (el.y + ha.y) / 2, z: (el.z + ha.z) / 2 };
            const outward = side === 'right' ? 1 : -1;
            const abd = (Math.atan2((el.x - sh.x) * outward, sh.y - el.y) * 180) / Math.PI;
            out[side] = { clear: Math.min(clear(el), clear(mid), clear(ha)), abd };
        }
        return out;
    };
}

async function openAvatar(D, browser, base, avatar) {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
    page.setDefaultTimeout(180000);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?._currentVRM && window.NEXUS_CLIP_LOADER);
    if (avatar !== 'AvatarSample_A') {
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), `/vendor/avatars/${avatar}.vrm`);
        await page.waitForFunction(
            (n) => (window.NEXUS_VIEWER.avatarManager.currentRoot?.name || '').endsWith(n),
            `${avatar}.vrm`
        );
    }
    await page.waitForTimeout(2000);
    await page.addScriptTag({ path: path.join(HERE, 'GestureBodyCheck.js') });
    await page.evaluate(probe);
    return page;
}

async function measureClip(page, clip, loop) {
    await page.evaluate(
        ([c, l]) => {
            window.NEXUS_CLIP_LOADER.stopClip?.();
            window.NEXUS_CLIP_LOADER.playClip(c, l);
        },
        [clip, loop]
    );
    await page.waitForTimeout(1200);
    const playing = await page.evaluate(() => window.NEXUS_CLIP_LOADER.getCurrentPlaybackState?.());
    if (!playing || !playing.isPlaying) return { clip, missing: true, flags: ['did-not-play'] };
    // A loop is sampled over 8 s; the stand-up over the 3 s it takes and the rest it ends in.
    const span = loop ? 8000 : 3000;
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
        samples.push(await page.evaluate(() => window.__arms()));
        await page.waitForTimeout(span / SAMPLES);
    }
    const minClear = (s) => Math.min(...samples.map((x) => x[s].clear));
    const asym = samples.map((x) => Math.abs(x.left.abd - x.right.abd));
    const asymShare = asym.filter((a) => a > LIMITS.asymDeg).length / samples.length;
    const r = {
        clip,
        clearL: +minClear('left').toFixed(1),
        clearR: +minClear('right').toFixed(1),
        abdL: +(samples.reduce((a, x) => a + x.left.abd, 0) / samples.length).toFixed(1),
        abdR: +(samples.reduce((a, x) => a + x.right.abd, 0) / samples.length).toFixed(1),
        asymMax: +Math.max(...asym).toFixed(1),
        asymShare: +asymShare.toFixed(2),
    };
    r.flags = [];
    if (r.clearL < 0 || r.clearR < 0) r.flags.push('arm-inside-body');
    else if (Math.min(r.clearL, r.clearR) < LIMITS.clearCm) r.flags.push('arm-against-body');
    if (asymShare >= LIMITS.asymShare) r.flags.push('arms-uneven');
    return r;
}

async function main() {
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { playwright, why } = D.loadPlaywright();
    if (!playwright) {
        console.error(why);
        process.exit(2);
    }
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
    const results = [];
    try {
        for (const avatar of AVATARS) {
            const page = await openAvatar(D, browser, server.base, avatar);
            const map = await page.evaluate(() => {
                const E = window.NEXUS_MOTION_CLIPS.ENTRIES;
                return { idle: E.idle.candidates, stand: E.stand.candidates };
            });
            const clips = ONLY.length
                ? ONLY.map((c) => [c, true])
                : [...map.idle.map((c) => [c, true]), ...map.stand.map((c) => [c, false])];
            for (const [clip, loop] of clips) {
                const r = { avatar, ...(await measureClip(page, clip, loop)) };
                results.push(r);
                if (r.missing) {
                    console.log(`${avatar.padEnd(18)} ${clip} did not play (not shipped?)`);
                    continue;
                }
                console.log(
                    `${avatar.padEnd(18)} ${clip.split('/').slice(-2).join('/').padEnd(34)} clear L ${String(r.clearL).padStart(5)} R ${String(r.clearR).padStart(5)} cm · out L ${String(r.abdL).padStart(5)}° R ${String(r.abdR).padStart(5)}° · uneven >${LIMITS.asymDeg}° ${Math.round(r.asymShare * 100)}% (max ${r.asymMax}°) ${r.flags.join(' ') || 'ok'}`
                );
            }
            await page.context().close();
        }
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    fs.writeFileSync(path.join(HERE, 'idle-arm-check.out.json'), JSON.stringify({ LIMITS, results }, null, 1));
    const bad = results.filter((r) => r.flags.length && !r.missing);
    console.log(
        `\n${bad.length ? 'FAIL' : 'PASS'} — ${results.length - bad.length}/${results.length} clip × avatar runs clean`
    );
    process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
    console.error('idle arm check crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
