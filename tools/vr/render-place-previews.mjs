#!/usr/bin/env node
/**
 * PG2. Render the venue-card pictures for every place by name, reproducibly.
 *
 * The first venue pictures (PG1) were crops of a whole-app screenshot: a ~530 px slice of a
 * 1440×860 page, with the viewport's corner brackets and the READY pill in them, her in the
 * stiff rest pose, and every place framed however the panel happened to frame it. Eight of the
 * thirteen places had no picture at all. A menu built from that cannot look like anything.
 *
 * This draws each place the same way, so the thirteen read as one set:
 *
 *   - the real app, in headless Chromium, with everything but her viewport hidden and the
 *     viewport filling a 4:3 window — the renderer draws the place at 1600×1200 (2× pixels);
 *   - every place shown the way a person reaches it: a general or romantic place through the
 *     companion session (`place-<id>`), a private room through the Private experience's own
 *     request (`nexus-world-request`, owner `intimate`) — simulated here, the one thing this
 *     harness does that a person cannot do without passing Private's gates. Nothing is added
 *     to the app for this: no route, no flag, no preview mode;
 *   - the same idle clip, the same three-quarter camera, the same eye height, her a little off
 *     centre so the room shows; a frame is taken only while her eyes are open;
 *   - a frame is refused if it is near-black, nearly one colour, or she is not in it;
 *   - the browser downsamples it (high-quality smoothing) to 640×480 WebP under ~60 KB.
 *
 *     npm start                                         # the app on :8080, in another shell
 *     node tools/vr/render-place-previews.mjs           # every place
 *     node tools/vr/render-place-previews.mjs bedroom   # one
 *     node tools/vr/render-place-previews.mjs --gpu     # use this machine's GPU, not SwiftShader
 *     node tools/vr/render-place-previews.mjs --base http://127.0.0.1:8080 --out tmp/previews
 *     node tools/vr/render-place-previews.mjs airship-dock-light --out tmp/previews  # a stand-in
 *
 * AX15. A light stand-in is rendered only when named: it has no desktop tier, so it is shown through
 * the engine's own `?vrWorld=` path (`_applyVRWorld({ preview })`), which falls back to the exact
 * id. Page driving shared with the Quality Lab's `lab_screenshot` lives in `./page-driver.mjs`.
 *
 * Writes `assets/vr-worlds/previews/<id>.webp` (or `--out`). The catalogue entry's `preview`
 * names that file; this tool does not edit `worlds.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ISOLATE, SWIFTSHADER, loadPlaywright, waitForWorld } from './page-driver.mjs';

const { playwright, why: noPlaywright } = loadPlaywright();
if (!playwright) {
    console.error(noPlaywright);
    process.exit(2);
}
const { chromium } = playwright;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = option('--base', 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUT = path.resolve(ROOT, option('--out', 'assets/vr-worlds/previews'));
const valueOf = new Set(['--base', '--out']);
const only = args.filter((a, i) => !a.startsWith('--') && !valueOf.has(args[i - 1]));

/** The look every picture shares. Change it here and re-render all of them. */
const SPEC = Object.freeze({
    window: { width: 800, height: 600, scale: 2 }, // drawn at 1600×1200
    output: { width: 640, height: 480, maxBytes: 60 * 1024 },
    clip: 'idle/neutral_idle.bvh', // relaxed, arms at rest — never the T/A rest pose
    clipSettleMs: 2600, // into the clip before the frame is taken
    // Three-quarter view: camera 22° round to her left, eye a little above hers, looking at her
    // upper chest. Distance keeps her whole from hair to shoes with the room around her.
    camera: { yawDeg: -22, distance: 3.7, height: 1.32, lookAt: 0.94, sideOffset: 0.3 },
    // Expressions that close or squint her eyes. The behaviour engine sets "happy"/"relaxed"
    // between lines; on a VRoid face both close the eyes, which read as asleep on a card.
    eyesOpen: ['blink', 'blinkLeft', 'blinkRight', 'happy', 'relaxed'],
});

/**
 * Where the default three-quarter view looks at the wrong thing. Each spot was raycast for a
 * straight camera; turning 22° one way can put a chair across her legs or the beach out of
 * frame. Mirroring the turn (or none) is the only change allowed — the framing stays one set.
 */
const PLACE_CAMERA = Object.freeze({
    'irish-pub': { yawDeg: 0 }, // at -22 a chair crosses her legs
    office: { yawDeg: 0 }, // at -22 two desk chairs stand in front of her
});
const yawArg = option('--yaw', null);

const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8'));
const places = catalogue.worlds.filter((w) => w.place === true && (only.length ? only.includes(w.id) : !w.lightFor));
if (!places.length) {
    console.error('No place matches', only.join(', '));
    process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
    args: flag('--gpu') ? ['--enable-gpu', '--ignore-gpu-blocklist'] : SWIFTSHADER,
});
let failed = 0;
try {
    const context = await browser.newContext({
        viewport: { width: SPEC.window.width, height: SPEC.window.height },
        deviceScaleFactor: SPEC.window.scale,
    });
    // Together on, so the companion session (the way a place is entered) boots.
    await context.addInitScript(() => localStorage.setItem('together_enabled', 'true'));
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn('  page error:', e.message.slice(0, 160)));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.__NEXUS_COMPANION_LIVE?.session &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.NEXUS_VIEWER?.vrWorlds &&
            window.NEXUS_CLIP_LOADER,
        null,
        { timeout: 180000 }
    );
    await page.addStyleTag({ content: ISOLATE });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(1500);

    for (const place of places) {
        const id = place.id;
        let done = false;
        for (let attempt = 1; attempt <= 3 && !done; attempt++) {
            const shot = await capture(page, place);
            if (!shot.ok) {
                console.warn(`  ${id}: attempt ${attempt} refused — ${shot.why}`);
                continue;
            }
            const bytes = Buffer.from(shot.webp, 'base64');
            fs.writeFileSync(path.join(OUT, id + '.webp'), bytes);
            console.log(
                `${id}: ${shot.world} → ${path.relative(ROOT, path.join(OUT, id + '.webp'))}  ` +
                    `${SPEC.output.width}×${SPEC.output.height}, ${Math.round(bytes.length / 1024)} KB, q${shot.quality}, ` +
                    `luma ${shot.luma.mean}±${shot.luma.sd}`
            );
            done = true;
        }
        if (!done) failed += 1;
    }
} finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);

async function capture(page, place) {
    const isPrivate = place.rating === 'private';
    // Leave whatever was up, and wait until nothing is.
    await page.evaluate(() => {
        window.NEXUS_VIEWER._vrWorldPreview = null; // a stand-in shown by preview must not stick
        window.dispatchEvent(new CustomEvent('nexus-world-request', { detail: { id: null, owner: 'intimate' } }));
        const s = window.__NEXUS_COMPANION_LIVE.session;
        if (s.active()) s.end();
    });
    await page.waitForFunction(() => !window.NEXUS_VIEWER.vrWorlds.activeId, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(
        ({ id, isPrivate, standIn }) => {
            if (standIn) window.NEXUS_VIEWER._applyVRWorld({ preview: id });
            else if (isPrivate)
                window.dispatchEvent(new CustomEvent('nexus-world-request', { detail: { id, owner: 'intimate' } }));
            else
                window.__NEXUS_COMPANION_LIVE.session.enter('experiences', 'place-' + id, {
                    source: 'together',
                    silent: true,
                });
        },
        { id: place.id, isPrivate, standIn: Boolean(place.lightFor) }
    );
    const shown = await waitForWorld(page, place.id, 120000);
    if (!shown) return { ok: false, why: 'the world did not come up on a desktop tier' };
    // Out of the fade, the framing the engine chose settled, then ours.
    await page.waitForTimeout(1800);
    const spec = {
        ...SPEC,
        camera: {
            ...SPEC.camera,
            ...(PLACE_CAMERA[place.id] || {}),
            ...(yawArg != null ? { yawDeg: Number(yawArg) } : {}),
        },
    };
    return page.evaluate(async (spec) => {
        const e = window.NEXUS_VIEWER;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.NEXUS_CLIP_LOADER.playClip(spec.clip, { loop: true, fadeIn: 0 });
        await wait(spec.clipSettleMs);
        // The camera: three-quarter, about her, after the engine's own framing.
        const c = spec.camera;
        const root = e.avatarManager.currentRoot;
        const at = root.position;
        const yaw = (c.yawDeg * Math.PI) / 180;
        const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
        e.camera.position.set(at.x + Math.sin(yaw) * c.distance, c.height, at.z + Math.cos(yaw) * c.distance);
        const look = { x: at.x + right.x * c.sideOffset, y: c.lookAt, z: at.z + right.z * c.sideOffset };
        if (e.controls) {
            e.controls.target.set(look.x, look.y, look.z);
            e.controls.update();
        }
        e.camera.lookAt(look.x, look.y, look.z);
        e.camera.updateProjectionMatrix();
        await wait(400);
        // Eyes open: the blink is driven every frame, so wait for a moment between blinks.
        const vrm = e.avatarManager._currentVRM;
        const blink = () => {
            const m = vrm && vrm.expressionManager;
            if (!m) return 0;
            return Math.max(m.getValue('blink') || 0, m.getValue('blinkLeft') || 0, m.getValue('blinkRight') || 0);
        };
        for (let i = 0; i < 60 && blink() > 0.02; i++) await wait(50);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const source = e.renderer.domElement;
        // Eyes open for this one frame: zero what closes them, push it to the face, draw, copy.
        // The next frame the engine's own expressions come back; nothing here is kept.
        const em = vrm && vrm.expressionManager;
        if (em) {
            for (const name of spec.eyesOpen) if (em.getExpression && em.getExpression(name)) em.setValue(name, 0);
            em.update();
        }
        // Copy the frame now (the drawing buffer is not kept): render once more, then copy.
        e.renderer.render(e.scene, e.camera);
        const full = document.createElement('canvas');
        full.width = source.width;
        full.height = source.height;
        full.getContext('2d').drawImage(source, 0, 0);
        // The quality gate, on a small copy: dark, flat or empty frames are refused.
        const probe = document.createElement('canvas');
        probe.width = 64;
        probe.height = 48;
        const pc = probe.getContext('2d');
        pc.drawImage(full, 0, 0, 64, 48);
        const px = pc.getImageData(0, 0, 64, 48).data;
        let sum = 0;
        let sq = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
            const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            sum += y;
            sq += y * y;
        }
        const mean = sum / n;
        const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
        const luma = { mean: Math.round(mean), sd: Math.round(sd) };
        if (mean < 14) return { ok: false, why: 'near-black frame', luma };
        if (sd < 9) return { ok: false, why: 'nearly one colour', luma };
        // She must be in the frame: her head projects inside it.
        const THREE_V = e.camera.position.constructor;
        const p = new THREE_V(at.x, 1.45, at.z).project(e.camera);
        if (Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95 || p.z > 1)
            return { ok: false, why: 'she is out of frame', luma };
        // Downsample in two steps (a single large step aliases) and encode.
        const half = document.createElement('canvas');
        half.width = Math.round(full.width / 2);
        half.height = Math.round(full.height / 2);
        const hc = half.getContext('2d');
        hc.imageSmoothingQuality = 'high';
        hc.drawImage(full, 0, 0, half.width, half.height);
        const out = document.createElement('canvas');
        out.width = spec.output.width;
        out.height = spec.output.height;
        const oc = out.getContext('2d');
        oc.imageSmoothingQuality = 'high';
        // Cover: fill 4:3 from the centre of whatever the canvas is.
        const scale = Math.max(out.width / half.width, out.height / half.height);
        const w = half.width * scale;
        const h = half.height * scale;
        oc.drawImage(half, (out.width - w) / 2, (out.height - h) / 2, w, h);
        let quality = 0.84;
        let data = '';
        for (; quality >= 0.5; quality -= 0.06) {
            data = out.toDataURL('image/webp', quality).split(',')[1];
            if ((data.length * 3) / 4 <= spec.output.maxBytes) break;
        }
        return { ok: true, webp: data, quality: Math.round(quality * 100), luma, world: e.vrWorlds.activeId };
    }, spec);
}
