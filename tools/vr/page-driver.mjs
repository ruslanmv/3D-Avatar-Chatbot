/**
 * AX15. Driving the real app in headless Chromium for pictures of worlds — one module, used by
 * `tools/vr/render-place-previews.mjs` (the venue cards) and the Quality Lab's `lab_screenshot`
 * MCP tool. Before it, every session that wanted to see a world wrote its own script, slept a fixed
 * number of seconds and read whatever global it guessed (VW4: 25 s, and the wrong global).
 *
 * The rules it keeps:
 *   - wait for the app and the world by state, never by a fixed sleep: the world is up when
 *     `NEXUS_VIEWER.vrWorlds.activeId` equals the id expected;
 *   - the frame check is the one the previews always used — a frame is near-black under luma 14,
 *     nearly one colour under spread 9 — measured on a fresh render of the renderer's own canvas
 *     (its drawing buffer is not kept between frames);
 *   - Playwright is required lazily, so importing this module never fails where it is missing.
 *
 * Headless Chromium draws through SwiftShader: these pictures say what loads and how it is framed,
 * never frame rate or comfort in a headset.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

/** Everything but her viewport hidden, the viewport filling the window. */
export const ISOLATE = `
  body > *:not(.nexus-preview-keep) { visibility: hidden !important; }
  .avatar-viewport { visibility: visible !important; position: fixed !important; inset: 0 !important;
    width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
    margin: 0 !important; border: 0 !important; border-radius: 0 !important; z-index: 2147483000 !important; }
  .avatar-viewport > *:not(canvas) { display: none !important; }
  .avatar-viewport canvas { visibility: visible !important; width: 100vw !important; height: 100vh !important; }
`;

export const SWIFTSHADER = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

/** Playwright, or null with the reason — never a throw at import time. */
export function loadPlaywright() {
    try {
        return { playwright: require('playwright'), why: null };
    } catch (e) {
        return {
            playwright: null,
            why:
                'Playwright is not installed here (npm ci installs it as a dev dependency): ' +
                String(e.message).split('\n')[0],
        };
    }
}

export async function waitForApp(page, timeout = 180000) {
    await page.waitForFunction(
        () =>
            window.NEXUS_VIEWER &&
            window.NEXUS_VIEWER.avatarManager &&
            window.NEXUS_VIEWER.avatarManager.currentRoot &&
            window.NEXUS_VIEWER.vrWorlds,
        null,
        { timeout }
    );
}

/** Resolves true once the world on screen is `id`, false on timeout. */
export function waitForWorld(page, id, timeout = 120000) {
    return page
        .waitForFunction(
            (want) =>
                window.NEXUS_VIEWER && window.NEXUS_VIEWER.vrWorlds && window.NEXUS_VIEWER.vrWorlds.activeId === want,
            id,
            {
                timeout,
            }
        )
        .then(() => true)
        .catch(() => false);
}

/** What the page thinks it is: the tier VRWorlds would use, and the world up. */
export function pageState(page) {
    return page.evaluate(() => {
        const W = window.NEXUS_VR_WORLDS;
        const mobile = document.documentElement.classList.contains('is-mobile');
        return {
            tier: W && W.tierFor ? W.tierFor({ xr: false, mobile }) : mobile ? 'mobile' : 'desktop',
            shown:
                (window.NEXUS_VIEWER && window.NEXUS_VIEWER.vrWorlds && window.NEXUS_VIEWER.vrWorlds.activeId) || null,
        };
    });
}

/**
 * Luma mean and spread of a fresh render of the 3D canvas (64×48 probe), and the previews' verdict.
 */
export function frameCheck(page) {
    return page.evaluate(() => {
        const e = window.NEXUS_VIEWER;
        e.renderer.render(e.scene, e.camera);
        const probe = document.createElement('canvas');
        probe.width = 64;
        probe.height = 48;
        const pc = probe.getContext('2d');
        pc.drawImage(e.renderer.domElement, 0, 0, 64, 48);
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
        const verdict = mean < 14 ? 'near-black frame' : sd < 9 ? 'nearly one colour' : 'ok';
        return { mean: Math.round(mean), sd: Math.round(sd), verdict };
    });
}

/**
 * The 3D canvas as a JPEG, from one fresh render — what her viewport shows, without waiting for the
 * page to composite (page.screenshot took 4–7 s under SwiftShader with the app animating).
 */
export async function canvasJpeg(page, quality = 0.72, maxWidth = 960) {
    const b64 = await page.evaluate(
        ({ q, maxWidth }) => {
            const e = window.NEXUS_VIEWER;
            e.renderer.render(e.scene, e.camera);
            const src = e.renderer.domElement;
            const k = Math.min(1, maxWidth / src.width);
            const out = document.createElement('canvas');
            out.width = Math.round(src.width * k);
            out.height = Math.round(src.height * k);
            const c = out.getContext('2d');
            c.imageSmoothingQuality = 'high';
            c.drawImage(src, 0, 0, out.width, out.height);
            return out.toDataURL('image/jpeg', q).split(',')[1];
        },
        { q: quality, maxWidth }
    );
    return Buffer.from(b64, 'base64');
}

/**
 * Resolves once the world-change fade (VRWorlds' black sphere, `vr-world-fade`) has cleared — the
 * state the picture should be taken in — or false on timeout. No extra renders while it waits.
 */
export function waitForFadeIn(page, timeout = 15000) {
    return page
        .waitForFunction(
            () => {
                const f = window.NEXUS_VIEWER.scene.getObjectByName('vr-world-fade');
                return !f || !f.visible;
            },
            null,
            { timeout, polling: 100 }
        )
        .then(() => true)
        .catch(() => false);
}

async function answers(base) {
    try {
        const res = await fetch(base + '/', { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch (_) {
        return false;
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

/**
 * The app's base URL: `base` if something answers there, else nexus-proxy started on a free port
 * and kept for the caller (its `stop()` ends it). Waits for the new server to answer.
 */
export async function ensureServer(base = 'http://127.0.0.1:8080') {
    if (await answers(base)) return { base, started: false, stop() {} };
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'nexus-proxy/server.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
        if (await answers(url)) return { base: url, started: true, stop: () => child.kill() };
        if (child.exitCode != null) break;
        await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
    throw new Error('could not start nexus-proxy/server.js');
}

/** The catalogue, and VRWorlds' own resolveFor, so the expected world is the app's answer. */
export function catalogue() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8')).worlds;
}
