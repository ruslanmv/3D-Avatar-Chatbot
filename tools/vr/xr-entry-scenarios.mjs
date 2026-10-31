#!/usr/bin/env node
/**
 * xr-entry-scenarios.mjs — XL7. Enter VR in an emulated Meta Quest 3, the five ways it can start.
 *
 * Loads the real page in headless Chromium with Meta's Immersive Web Emulation Runtime (IWER) as
 * the headset, presses ENTER VR, and checks what the HomePilot loading card and her scene did,
 * from the page's own entry trace (window.NEXUS_XR_ENTRY). One scenario per startup the app must
 * survive:
 *
 *   quest-native        Quest Browser: the session is visible from the start.
 *   airlink             Chrome on Windows over Air Link: the session is 'hidden' for a while after
 *                       it starts (Link shows its own loading screen) and then becomes visible.
 *                       The card must be SEEN for its minimum after that, not dismissed unseen.
 *   gpu-move            makeXRCompatible() moves the WebGL context to the headset's GPU (lost,
 *                       then restored) before the card exists; entry must still complete.
 *   context-lost-in-vr  The context is lost while the card is up: the page must end the session
 *                       (a frozen headset otherwise) and bring the desktop view back.
 *   cancel-while-hidden The session ends while still hidden, before a frame was seen: no stuck
 *                       card, the desktop view comes back, the report blames the headset/runtime.
 *
 * This is SIMULATION. IWER emulates the WebXR API, not Quest Link or the Meta runtime; frames are
 * withheld while hidden because the WebXR spec says so, not because Link was observed doing it
 * here. Confirm on a real Quest 3 + Air Link with docs/VR_STARTUP.md.
 *
 * Usage:
 *   node tools/vr/xr-entry-scenarios.mjs                    # all five, starting the local server
 *   npm run vr:entry-scenarios
 *   node tools/vr/xr-entry-scenarios.mjs --only airlink,quest-native
 *   node tools/vr/xr-entry-scenarios.mjs --url http://localhost:8080 --iwer ./iwer.min.js
 *
 * Options: --url <url> (use a running server), --port <n> (default 8097), --only <list>,
 * --iwer <file or URL> (default: iwer@2.7.0 from jsDelivr), --visible-after-ready-ms <n> (when
 * Air Link shows the session, counted from the end of the warm-up; default 1500 — measured ~800),
 * --report (print the page's [VR entry] report for every scenario, not only failed ones).
 * Needs Playwright with Chromium: npm i --no-save playwright && npx playwright install chromium
 * Exits 1 if any scenario fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IWER_CDN = 'https://cdn.jsdelivr.net/npm/iwer@2.7.0/build/iwer.min.js';
const QUEST_UA =
    'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0 Chrome/132.0 VR Safari/537.36';
const WINDOWS_CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const MIN_MS = 900; // XRSplash.MIN_MS

/** One render per headset frame; a second loop drawing her mid-session shows up as ~2. */
const loopCheck = (r) => [
    r.loopRatio != null && r.loopRatio <= 1.3,
    `one render per headset frame (${r.loopRatio == null ? 'not measured' : r.loopRatio.toFixed(2)} over ${r.xrFrames} frames)`,
];

function parseArgs(argv) {
    const o = { port: 8097, iwer: IWER_CDN, visibleAfterReadyMs: 1500 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--url') o.url = next();
        else if (a === '--port') o.port = Number(next());
        else if (a === '--only')
            o.only = next()
                .split(',')
                .map((s) => s.trim());
        else if (a === '--iwer') o.iwer = next();
        else if (a === '--visible-after-ready-ms') o.visibleAfterReadyMs = Number(next());
        else if (a === '--report') o.report = true;
        else {
            console.error(`Unknown option: ${a}`);
            process.exit(2);
        }
    }
    return o;
}

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        try {
            return createRequire(import.meta.url)('playwright');
        } catch {
            console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
            process.exit(2);
        }
    }
}

async function startServer(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'nexus-proxy/server.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`${url}/index.html`)).ok) return { url, stop: () => child.kill() };
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    child.kill();
    throw new Error(`The local server did not start on port ${port} (try --port).`);
}

async function loadIwer(source) {
    if (/^https?:/.test(source)) {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Could not fetch IWER from ${source}: HTTP ${res.status}`);
        return res.text();
    }
    return fs.readFileSync(path.resolve(source), 'utf8');
}

/**
 * Runs in the page before anything else: installs the emulated Quest 3, withholds frame callbacks
 * while the session is hidden (WebXR: a hidden session's animation frames are not processed), and
 * drives the scenario's events off the session's start.
 */
function bootstrap(iwerSrc, scenario) {
    return `${iwerSrc};(function () {
        const S = ${JSON.stringify(scenario)};
        const d = new IWER.XRDevice(IWER.metaQuest3);
        d.installRuntime({ forceInstall: true });
        window.__xr = d;
        // IWER reports its own Quest user agent; the PC scenarios must look like Chrome on Windows.
        if (S.ua) {
            try {
                Object.defineProperty(navigator, 'userAgent', { get: () => S.ua, configurable: true });
            } catch (_) {}
        }
        window.__events = [];
        const mark = (what) => window.__events.push({ at: performance.now(), what });
        let patched = false;
        const patch = (session) => {
            if (patched) return;
            patched = true;
            const proto = Object.getPrototypeOf(session);
            const raf = proto.requestAnimationFrame;
            // __xrFrames counts the frames the headset actually handed the page, so a run can tell
            // one render per headset frame from two (a desktop loop still running mid-session).
            window.__xrFrames = 0;
            proto.requestAnimationFrame = function (cb) {
                const self = this;
                const held = (t, f) => {
                    if (self.visibilityState === 'hidden') return raf.call(self, held);
                    window.__xrFrames++;
                    return cb(t, f);
                };
                return raf.call(this, held);
            };
        };
        const glOf = () => window.NEXUS_VIEWER && window.NEXUS_VIEWER.renderer.getContext();
        const loseFor = (ms) => {
            const ext = glOf() && glOf().getExtension('WEBGL_lose_context');
            if (!ext) return mark('no WEBGL_lose_context');
            ext.loseContext();
            mark('context lost');
            setTimeout(() => { ext.restoreContext(); mark('context restored'); }, ms);
        };
        if (S.gpuMove) {
            const proto = (window.WebGL2RenderingContext || window.WebGLRenderingContext).prototype;
            const orig = proto.makeXRCompatible;
            let moved = false;
            proto.makeXRCompatible = function () {
                if (moved) return orig.call(this);
                moved = true;
                loseFor(300);
                return Promise.reject(new DOMException('Context lost (GPU move)', 'InvalidStateError'));
            };
        }
        const request = navigator.xr.requestSession.bind(navigator.xr);
        navigator.xr.requestSession = async (...args) => {
            const session = await request(...args);
            patch(session);
            mark('granted');
            if (S.hiddenMs) {
                d.updateVisibilityState('hidden');
                mark('hidden');
                const show = () => { d.updateVisibilityState('visible'); window.__visibleAt = performance.now(); mark('visible'); };
                if (S.endWhileHiddenAfterMs) {
                    setTimeout(() => { mark('ended externally'); session.end().catch(() => {}); }, S.endWhileHiddenAfterMs);
                } else if (S.visibleAfterReadyMs != null) {
                    // As measured over Air Link: the session turned visible ~800 ms AFTER the warm-up
                    // finished. Timed off the trace's 'warmed' step, so a slow emulator keeps the order.
                    const wait = setInterval(() => {
                        const snap = window.NEXUS_XR_ENTRY && window.NEXUS_XR_ENTRY.snapshot();
                        if (snap && snap.steps.warmed) { clearInterval(wait); setTimeout(show, S.visibleAfterReadyMs); }
                    }, 20);
                } else {
                    setTimeout(show, S.hiddenMs);
                }
            }
            if (S.loseDuringCardAfterMs) setTimeout(() => loseFor(600), S.loseDuringCardAfterMs);
            return session;
        };
    })();`;
}

const SCENARIOS = (o) => ({
    'quest-native': {
        ua: QUEST_UA,
        setup: {},
        check: (r) => [
            [r.snap.frames.cardVisible > 0, `card seen (${r.snap.frames.cardVisible} visible frames)`],
            [r.sceneAt != null, 'her scene drew'],
            [
                r.sceneAt != null && r.sceneAt - r.firstSeenAt >= MIN_MS * 0.9,
                `card shown its minimum (${Math.round(r.sceneAt - r.firstSeenAt)} ms)`,
            ],
            loopCheck(r),
        ],
    },
    airlink: {
        ua: WINDOWS_CHROME_UA,
        setup: { hiddenMs: 1, visibleAfterReadyMs: o.visibleAfterReadyMs },
        check: (r) => [
            [r.firstSeenAt != null && r.firstSeenAt >= r.visibleAt, 'no card frame counted as seen while hidden'],
            [
                r.snap.frames.cardVisible > 0,
                `card seen after Link showed the session (${r.snap.frames.cardVisible} visible frames)`,
            ],
            [
                r.sceneAt != null && r.sceneAt - r.firstSeenAt >= MIN_MS * 0.9,
                `card shown its minimum once visible (${Math.round(r.sceneAt - r.firstSeenAt)} ms)`,
            ],
            [
                r.visibleAt != null && r.sceneAt != null && r.sceneAt >= r.visibleAt,
                'her scene not drawn while the session was hidden',
            ],
            loopCheck(r),
            [
                r.snap.steps.session && r.snap.steps.session.detail.path === 'XRWebGLLayer',
                'classic XRWebGLLayer path on the PC',
            ],
        ],
    },
    'gpu-move': {
        ua: WINDOWS_CHROME_UA,
        setup: { gpuMove: true },
        check: (r) => [
            [r.snap.steps.card && r.snap.steps.card.detail.gpuMoved === true, 'GPU move seen and waited out'],
            [r.events.some((e) => e.what === 'WebGL context restored'), 'restore recorded in the report'],
            [r.snap.frames.cardVisible > 0, 'card seen after the move'],
            [r.sceneAt != null, 'her scene drew'],
        ],
    },
    'context-lost-in-vr': {
        ua: WINDOWS_CHROME_UA,
        setup: { loseDuringCardAfterMs: 50 },
        endsItself: true,
        check: (r) => [
            [
                r.snap.ended && r.snap.endedBy === 'WebGL context lost in VR',
                `session ended by the page (${r.snap.endedBy})`,
            ],
            [!r.presenting, 'headset released'],
            [!r.splashLeft, 'no loading card left behind'],
            [r.desktopFrames > 0, `desktop view back (${r.desktopFrames} frames)`],
        ],
    },
    'cancel-while-hidden': {
        ua: WINDOWS_CHROME_UA,
        setup: { hiddenMs: 1, endWhileHiddenAfterMs: 1500 },
        endsItself: true,
        check: (r) => [
            [r.snap.frames.cardVisible === 0, 'nothing was seen'],
            [r.snap.ended && !r.snap.endedBy, 'report: ended by the headset or its runtime'],
            [!r.presenting && !r.splashLeft, 'no stuck card, headset released'],
            [r.desktopFrames > 0, `desktop view back (${r.desktopFrames} frames)`],
        ],
    },
});

async function run(name, def, o, iwerSrc, chromium, baseUrl) {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: def.ua });
        await ctx.addInitScript(bootstrap(iwerSrc, { ...def.setup, ua: def.ua }));
        const page = await ctx.newPage();
        const errors = [];
        const emulatorErrors = [];
        page.on('pageerror', (e) => {
            // The emulator's own code runs from the injected script (no URL); its WebGL layer does
            // not survive a context loss, which a real browser handles itself. Not the app's error.
            const fromEmulator = /onDeviceFrame|<anonymous>/.test(e.stack || '') && !/https?:\/\//.test(e.stack || '');
            (fromEmulator ? emulatorErrors : errors).push(e.message);
        });
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () => window.NEXUS_VIEWER?.avatarManager?.currentRoot && window.NEXUS_XR_ENTRY,
            null,
            {
                timeout: 120000,
            }
        );
        await page.waitForTimeout(1500);
        await page.locator('#vr-button').click();
        if (def.endsItself) {
            await page.waitForFunction(() => window.NEXUS_XR_ENTRY.snapshot()?.ended, null, { timeout: 120000 });
            await page.waitForTimeout(2500);
        } else {
            await page.waitForFunction(() => window.NEXUS_XR_ENTRY.snapshot()?.steps.scene, null, { timeout: 120000 });
            await page.waitForTimeout(1000);
        }
        const r = await page.evaluate(async () => {
            const v = window.NEXUS_VIEWER;
            const snap = window.NEXUS_XR_ENTRY.snapshot();
            const f0 = v.renderer.info.render.frame;
            const x0 = window.__xrFrames || 0;
            await new Promise((res) => setTimeout(res, 1200));
            const presenting = v.renderer.xr.isPresenting;
            const xrFrames = (window.__xrFrames || 0) - x0;
            return {
                // Renders per headset frame while she is up. Two means a second (desktop) loop is
                // drawing her too: three r147's setAnimationLoop restarts the window loop when it
                // is called mid-session.
                loopRatio: presenting && xrFrames > 0 ? (v.renderer.info.render.frame - f0) / xrFrames : null,
                xrFrames,
                snap: JSON.parse(JSON.stringify(snap)),
                events: snap.events,
                sceneAt: snap.steps.scene ? snap.steps.scene.at : null,
                firstSeenAt: snap.firstFrame.cardVisible,
                visibleAt: window.__visibleAt ?? null,
                presenting,
                splashLeft: !!v._splash,
                desktopFrames: presenting ? 0 : v.renderer.info.render.frame - f0,
                report: window.NEXUS_XR_ENTRY.report(),
            };
        });
        if (!def.endsItself) await page.evaluate(() => window.NEXUS_VIEWER.renderer.xr.getSession()?.end());
        const checks = def.check(r);
        if (errors.length) checks.push([false, `page errors: ${errors.slice(0, 2).join(' | ')}`]);
        const notes = emulatorErrors.length
            ? [`emulator error (not the app's, ignored): ${[...new Set(emulatorErrors)].join(' | ')}`]
            : [];
        return { name, ok: checks.every(([pass]) => pass), checks, notes, report: r.report };
    } finally {
        await browser.close();
    }
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const all = SCENARIOS(o);
    const names = o.only || Object.keys(all);
    const iwerSrc = await loadIwer(o.iwer);
    const server = o.url ? { url: o.url.replace(/\/$/, ''), stop: () => {} } : await startServer(o.port);
    const { chromium } = await loadPlaywright();
    let failed = 0;
    try {
        for (const name of names) {
            if (!all[name]) {
                console.error(`Unknown scenario: ${name}`);
                failed++;
                continue;
            }
            const res = await run(name, all[name], o, iwerSrc, chromium, server.url);
            console.log(`\n${res.ok ? 'PASS' : 'FAIL'}  ${name}  (simulated: IWER, headless Chromium)`);
            for (const [pass, what] of res.checks) console.log(`   ${pass ? '✔' : '✖'} ${what}`);
            for (const note of res.notes) console.log(`   · ${note}`);
            if (!res.ok) failed++;
            if (!res.ok || o.report) console.log(res.report.replace(/^/gm, '     '));
        }
    } finally {
        server.stop();
    }
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
