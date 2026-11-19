#!/usr/bin/env node
/**
 * ID1. Her standing idle, measured: how her arms hang, front and side, on the real avatar.
 *
 *   node tools/qa/idle-pose-check.mjs [--vrm vendor/avatars/AvatarSample_A.vrm,…] [--wait 6] [--out dir]
 *
 * For each avatar: loads it on the main page, waits for the idle to settle, photographs her from the
 * front and the side, and measures from the rendered skeleton —
 *
 *   armDown     each upper arm's angle from straight down, degrees (0 = hanging, 90 = T-pose)
 *   elbow       each elbow's bend, degrees (0 = straight)
 *   handGap     each hand's distance outside her thigh's centre line, metres (the dress needs room)
 *   symmetric   whether both elbows bend within 2° of each other (the brief wants one more bent)
 *   pose        which layer set the arms: NaturalPosePlugin's preset name, if it is active
 *
 * Writes `report.json` and `<avatar>-front.png` / `<avatar>-side.png` under
 * `audits/poses/runs/<stamp>-idle/` (gitignored). Needs the app running (`npm start`), pointed at by
 * NEXUS_LAB_BASE, or starts its own.
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
const VRMS = arg('--vrm', 'vendor/avatars/AvatarSample_A.vrm,vendor/avatars/Vita.vrm').split(',').filter(Boolean);
const WAIT = Number(arg('--wait', '6')) * 1000;
/** ID2. A line to speak while photographed (co-speech gestures), or '' to skip. */
const TALK = arg('--talk', 'Hi! I think you will love this. Maybe we can try it together, what do you say?');
/** A NaturalPosePlugin preset to compare against (e.g. naturalIdle, the old default). */
const PRESET = arg('--preset', '');
const TALK_FRAMES = Number(arg('--talk-frames', '24'));
const TALK_STEP_MS = Number(arg('--talk-step', '60'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-idle`)));

/** Measuring and framing, installed into the page before it loads (addInitScript). */
const HELPERS = `
window.measure = function () {
    const T = window.THREE;
    const v = window.NEXUS_VIEWER;
    const vrm = v.avatarManager._currentVRM || v.avatarManager.vrmLoader?.currentVRM;
    const h = vrm.humanoid;
    const bone = (n) => (h.getRawBoneNode ? h.getRawBoneNode(n) : null) || h.getNormalizedBoneNode(n);
    const pos = (n) => (bone(n) ? bone(n).getWorldPosition(new T.Vector3()) : null);
    const r = (x) => Math.round(x * 100) / 100;
    const deg = (a) => Math.round((a * 180) / Math.PI);
    const side = (s) => {
        const sh = pos(s + 'UpperArm'), el = pos(s + 'LowerArm'), ha = pos(s + 'Hand'), leg = pos(s + 'UpperLeg');
        if (!sh || !el || !ha) return null;
        const up = el.clone().sub(sh).normalize();
        const fore = ha.clone().sub(el).normalize();
        const hips = pos('hips');
        return {
            armDown: deg(up.angleTo(new T.Vector3(0, -1, 0))),
            elbow: deg(up.angleTo(fore)),
            handGap: leg && hips ? r(Math.abs(ha.x - hips.x) - Math.abs(leg.x - hips.x)) : null,
        };
    };
    const left = side('left');
    const right = side('right');
    const np = window.NEXUS_NATURAL_POSE;
    return {
        left,
        right,
        symmetric: left && right ? Math.abs(left.elbow - right.elbow) < 2 : null,
        pose: np && np.isActive && np.isActive() ? (np.getActivePreset ? np.getActivePreset() : 'natural-pose') : 'other',
    };
};
window.frame = function (view) {
    const T = window.THREE;
    const v = window.NEXUS_VIEWER;
    const root = v.avatarManager.currentRoot;
    const vrm = v.avatarManager._currentVRM || v.avatarManager.vrmLoader?.currentVRM;
    const head = vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new T.Vector3());
    const hips = vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(new T.Vector3());
    const c = new T.Vector3(hips.x, (head.y + 0) / 2 + 0.05, hips.z);
    // Her front from her eyes (ahead of the head bone), whichever way the file faces.
    const eye = vrm.humanoid.getNormalizedBoneNode('leftEye');
    const headNode = vrm.humanoid.getNormalizedBoneNode('head');
    const ahead = eye ? eye.getWorldPosition(new T.Vector3()) : null;
    const facing = ahead ? (ahead.z - headNode.getWorldPosition(new T.Vector3()).z >= 0 ? 1 : -1) : 1;
    const d = 2.4;
    if (view === 'hand' || view === 'hand-side') {
        // Close on her right hand: from the front, or from her outer side.
        const hand = vrm.humanoid.getNormalizedBoneNode('rightHand').getWorldPosition(new T.Vector3());
        const at = hand.clone().add(new T.Vector3(0, -0.05, 0));
        if (view === 'hand') v.camera.position.set(at.x, at.y, at.z + 0.45 * facing);
        else v.camera.position.set(at.x + (hand.x - hips.x >= 0 ? 0.45 : -0.45), at.y, at.z);
        if (v.controls) { v.controls.minDistance = 0.05; v.controls.target.copy(at); v.controls.update(); }
        v.camera.lookAt(at);
        return;
    }
    if (view === 'front') v.camera.position.set(c.x, c.y, c.z + d * facing);
    else v.camera.position.set(c.x + d, c.y, c.z);
    if (v.controls) { v.controls.target.copy(c); v.controls.update(); }
    v.camera.lookAt(c);
};
`;

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const report = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage();
        page.setDefaultTimeout(240000);
        await page.addInitScript(HELPERS);
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 240000);
        await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM);
        for (const file of VRMS) {
            await page.evaluate(
                async (u) => {
                    const v = window.NEXUS_VIEWER;
                    const was = v.avatarManager.currentRoot?.uuid;
                    await v.loadAvatar(u);
                    const t0 = performance.now();
                    while (v.avatarManager.currentRoot?.uuid === was && performance.now() - t0 < 30000)
                        await new Promise((r) => setTimeout(r, 200));
                },
                '/' + file.replace(/^\/+/, '')
            );
            if (PRESET) await page.evaluate((p) => window.NEXUS_NATURAL_POSE?.setPreset(p), PRESET);
            await page.waitForTimeout(WAIT);
            const name = path.basename(file, '.vrm') + (PRESET ? `-${PRESET}` : '');
            const m = await page.evaluate(() => measure());
            for (const view of ['front', 'side', 'hand', 'hand-side']) {
                await page.evaluate((view) => frame(view), view);
                await page.waitForTimeout(500);
                await page
                    .locator('canvas')
                    .first()
                    .screenshot({ path: path.join(out, `${name}-${view}.png`) });
            }
            // ID2. Speaking: the co-speech gestures (SpeechGestures) over the idle, a frame every
            // half second while she says a line that has a gesture anchor in each sentence.
            if (TALK) {
                await page.evaluate((line) => {
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setMode('talk', 15000);
                    window.NEXUS_SPEECH_GESTURES?.start(line, 1);
                }, TALK);
                await page.evaluate(() => frame('front'));
                for (let k = 0; k < TALK_FRAMES; k += 1) {
                    // Real speech keeps talk mode on; with no audio here the page's own idle logic
                    // would let it lapse, so it is held for the capture.
                    await page.evaluate(() => window.NEXUS_PROCEDURAL_ANIMATOR?.setMode('talk', 2000));
                    // Back to back: a stroke lasts well under a second and spaced frames missed them.
                    await page.waitForTimeout(TALK_STEP_MS);
                    await page
                        .locator('canvas')
                        .first()
                        .screenshot({ path: path.join(out, `${name}-talk-${String(k).padStart(2, '0')}.png`) });
                }
                await page.evaluate(() => window.NEXUS_SPEECH_GESTURES?.stop());
            }
            report.push({ avatar: file, ...m });
            console.log(`${name}: ${JSON.stringify(m)}`);
        }
    } finally {
        await browser.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`→ ${path.relative(ROOT, out)}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
