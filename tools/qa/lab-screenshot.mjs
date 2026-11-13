/**
 * AX15. `lab_screenshot`: see a world the way a desktop and a phone get it, in seconds, inside the
 * session. Used by tools/qa/lab-mcp.mjs; argument handling is pure and tested
 * (tests/quality-lab.test.js), rendering is not run under Jest.
 *
 * What it guarantees:
 *   - the world on each device is the one the app would show there: the expected id comes from
 *     VRWorlds' own `resolveFor` at the page's own tier (`tierFor`, from the `is-mobile` class the
 *     app sets), and the shot is taken only once `vrWorlds.activeId` equals it — no fixed sleep;
 *   - mobile is Playwright's real phone emulation (Pixel 7: phone user agent, touch, 412×915) at
 *     deviceScaleFactor 1, so the picture is small (≈60–90 KB JPEG);
 *   - Chromium is launched once per server process and reused; the app server is reused if one
 *     answers, else nexus-proxy is started on a free port and kept for later calls;
 *   - it writes only to tmp/shots/ (gitignored), never to assets/ or quality-lab/data/;
 *   - without Playwright it answers with the reason instead of failing the server.
 *
 * Headless Chromium draws through SwiftShader: evidence of what loads and how it is framed, never
 * of frame rate or comfort in a headset.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
    ROOT,
    ISOLATE,
    SWIFTSHADER,
    loadPlaywright,
    waitForApp,
    waitForWorld,
    pageState,
    frameCheck,
    ensureServer,
    catalogue,
    canvasJpeg,
    waitForFadeIn,
} from '../vr/page-driver.mjs';

const DEVICES = ['desktop', 'mobile'];
const SHOTS = path.join(ROOT, 'tmp/shots');

function vrWorlds() {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/VRWorlds.js'), 'utf8'), {
        module: mod,
        globalThis: {},
        console,
    });
    return mod.exports;
}

/** Pure: validated arguments, or a thrown Error whose message the caller can show as is. */
export function normalizeArgs(args, worlds = catalogue()) {
    const a = args || {};
    if (a.world != null && a.url != null) throw new Error('give world or url, not both');
    if (a.world == null && a.url == null)
        throw new Error('give world (a catalogue id) or url (an app path such as "/?vrWorld=oak-glade")');
    let world = null;
    let url = null;
    if (a.world != null) {
        world = String(a.world);
        if (!/^[a-z0-9-]{1,40}$/.test(world)) throw new Error(`not a world id: ${world}`);
        if (!worlds.some((w) => w.id === world)) throw new Error(`no world ${world} in assets/vr-worlds/worlds.json`);
        url = `/?vrWorld=${world}`;
    } else {
        url = String(a.url);
        if (!url.startsWith('/') || url.startsWith('//')) throw new Error('url must be an app path starting with "/"');
        const m = url.match(/[?&]vrWorld=([a-z0-9-]+)/);
        if (m) world = m[1];
    }
    const devices = a.devices == null ? DEVICES.slice() : [].concat(a.devices).map(String);
    if (!devices.length || devices.some((d) => !DEVICES.includes(d)))
        throw new Error('devices: some of desktop, mobile');
    const wait = Math.min(180000, Math.max(5000, Number(a.wait) || 60000));
    const view = a.view == null ? 'viewport' : String(a.view);
    if (!['viewport', 'page'].includes(view)) throw new Error('view: viewport or page');
    return { world, url, urlGiven: a.url != null, devices: [...new Set(devices)], wait, view };
}

let shared = null; // { browser, server, devices, warm: { [device]: { context, page, errors, view } } }

async function session(loader) {
    if (shared) return shared;
    const { playwright, why } = loader();
    if (!playwright) return { missing: why };
    const server = await ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({ args: SWIFTSHADER });
    shared = { browser, server, devices: playwright.devices, warm: {} };
    return shared;
}

export async function shutdown() {
    const s = shared;
    shared = null;
    if (!s) return;
    try {
        await s.browser.close();
    } catch (_) {
        /* already gone */
    }
    s.server.stop();
}

/**
 * One page per device, kept warm between calls. The app takes ~15 s to boot under SwiftShader; a
 * world call on a warm page only switches worlds through the engine's own `?vrWorld=` path
 * (`_applyVRWorld({ preview })`), which resolves exactly as the URL does. A `url` call, a changed
 * view, or a page that died gets a fresh load.
 */
async function pageFor(s, device, opts) {
    const warm = s.warm[device];
    const reusable = warm && opts.world && !opts.urlGiven && warm.view === opts.view && !warm.page.isClosed();
    if (reusable) return { ...warm, reused: true };
    if (warm) await warm.context.close().catch(() => {});
    const ctxOptions =
        device === 'mobile'
            ? { ...s.devices['Pixel 7'], deviceScaleFactor: 1 }
            : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
    const context = await s.browser.newContext(ctxOptions);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
    s.warm[device] = { context, page, errors, view: opts.view };
    return { ...s.warm[device], reused: false };
}

async function shoot(s, opts, device, W, worlds) {
    const t0 = Date.now();
    const { page, errors, reused } = await pageFor(s, device, opts);
    errors.length = 0;
    const report = { device, requested: opts.world, expected: null, shown: null, tier: null, reused };
    try {
        if (reused) {
            await page.evaluate((id) => {
                window.NEXUS_VIEWER._vrWorldPreview = null;
                window.NEXUS_VIEWER._applyVRWorld({ preview: id });
            }, opts.world);
        } else {
            await page.goto(s.server.base + opts.url, { waitUntil: 'domcontentloaded', timeout: opts.wait });
            await waitForApp(page, opts.wait);
            if (opts.view === 'viewport') {
                await page.addStyleTag({ content: ISOLATE });
                await page.evaluate(() => window.dispatchEvent(new Event('resize')));
            }
        }
        const st = await pageState(page);
        report.tier = st.tier;
        if (opts.world) {
            const w = worlds.find((x) => x.id === opts.world);
            report.expected =
                w && w.rating === 'private' ? null : W.resolveFor(worlds, opts.world, st.tier, true) || opts.world;
            if (!report.expected)
                report.note = 'private worlds open only through Private, after its gates; the preview refuses them';
            else if (!(await waitForWorld(page, report.expected, Math.max(1000, opts.wait - (Date.now() - t0)))))
                report.note = `the world did not come up within ${opts.wait} ms`;
        }
        report.loadMs = Date.now() - t0;
        // Out of the fade (state, not a fixed sleep), then one frame check; a dark or flat frame is
        // re-checked a few times in case the first frame after the fade was not drawn yet.
        await waitForFadeIn(page);
        let frame = await frameCheck(page);
        for (let i = 0; i < 3 && frame.verdict !== 'ok'; i++) {
            await page.waitForTimeout(200);
            frame = await frameCheck(page);
        }
        report.frame = frame;
        report.frameMs = Date.now() - t0 - report.loadMs;
        report.shown = (await pageState(page)).shown;
        const shownWorld = worlds.find((x) => x.id === report.shown);
        report.triangles = shownWorld ? shownWorld.triangles : null;
        // Viewport: the 3D canvas from one render. Page: the browser's own screenshot of everything.
        let quality = 72;
        const grab = (q) =>
            opts.view === 'viewport' ? canvasJpeg(page, q / 100) : page.screenshot({ type: 'jpeg', quality: q });
        let jpg = await grab(quality);
        while (jpg.length > 90 * 1024 && quality > 40) jpg = await grab((quality -= 12));
        fs.mkdirSync(SHOTS, { recursive: true });
        const file = path.join(SHOTS, `${(opts.world || 'page').replace(/[^a-z0-9-]/g, '')}-${device}.jpg`);
        fs.writeFileSync(file, jpg);
        report.file = path.relative(ROOT, file);
        report.kb = Math.round(jpg.length / 1024);
        report.shotMs = Date.now() - t0 - report.loadMs - report.frameMs;
        report.errors = errors.slice(0, 5);
        report.errorCount = errors.length;
        return { report, jpg };
    } catch (e) {
        // A broken page is not reused.
        await s.warm[device]?.context.close().catch(() => {});
        delete s.warm[device];
        throw e;
    }
}

/** MCP content: per device a text block, then its picture. */
export async function screenshot(args, loader = loadPlaywright) {
    const opts = normalizeArgs(args);
    const s = await session(loader);
    if (s.missing) return { content: [{ type: 'text', text: s.missing }], isError: true };
    const W = vrWorlds();
    const worlds = catalogue();
    const started = Date.now();
    const content = [];
    // Both devices at once in the shared browser: each is mostly the app booting.
    const shots = await Promise.all(opts.devices.map((device) => shoot(s, opts, device, W, worlds)));
    for (const { report, jpg } of shots) {
        const device = report.device;
        const lines = [
            `${device}: requested ${report.requested || opts.url} → expected ${report.expected || '—'} → shown ${report.shown || 'none'} (tier ${report.tier}${report.reused ? ', warm page' : ', fresh load'})`,
            `triangles ${report.triangles ?? '—'} · load ${report.loadMs} ms, frame check ${report.frameMs} ms, picture ${report.shotMs} ms · luma ${report.frame.mean}±${report.frame.sd} (${report.frame.verdict}) · ${report.kb} KB → ${report.file}`,
            `console errors: ${report.errorCount}${report.errors.length ? ' — ' + report.errors.join(' | ') : ''}`,
        ];
        if (report.note) lines.push('note: ' + report.note);
        if (report.expected && report.shown !== report.expected)
            lines.push(`MISMATCH: expected ${report.expected}, shown ${report.shown}`);
        content.push({ type: 'text', text: lines.join('\n') });
        content.push({ type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' });
    }
    content.push({
        type: 'text',
        text: `${Date.now() - started} ms for ${opts.devices.length} device(s)${s.server.started ? ` · started the app at ${s.server.base}` : ` · app at ${s.server.base}`}. Headless SwiftShader render: what loads and how it is framed, not frame rate or headset comfort.`,
    });
    return { content };
}
