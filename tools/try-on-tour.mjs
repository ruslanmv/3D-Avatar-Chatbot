#!/usr/bin/env node
/**
 * LT3. The Try-On tour: Together → Try-On → every look and control, in a real browser,
 * with screenshots and the invariants a person would notice checked as it goes.
 *
 *     npm start                                    # in another terminal
 *     node tools/try-on-tour.mjs OUT_DIR [--url http://localhost:8080/] [--sizes 1920x1080,390x844]
 *
 * Needs Playwright, which is not a dependency of this repo (nothing here is bundled):
 * `npx playwright install chromium` once, or point PLAYWRIGHT_CHROMIUM at a Chromium binary.
 * Widths under 700 px run with mobile emulation (touch, a phone user agent), as phones do.
 * Behind an HTTPS-only proxy (HTTPS_PROXY), requests to other hosts go through it.
 *
 * Fails (exit 1) when:
 *   - the Together chooser does not show all ten activities;
 *   - the camera moves when a look is worn (she must keep her size on the stage);
 *   - the stage summary and the advanced panel are on screen together;
 *   - on a phone, Turn, Save or Next is not visible on the stage.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOGETHER = [
    'Watch',
    'Journey',
    'Music',
    'Play',
    'Playground',
    'Try-On',
    'Focus',
    'Coach',
    'Meeting',
    'Help me with this',
];
const DEFAULT_SIZES = '1920x1080,1366x768,1024x768,412x915,390x844,360x640';

function args(argv) {
    const out = { dir: null, url: 'http://localhost:8080/', sizes: DEFAULT_SIZES };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--url') out.url = argv[++i];
        else if (argv[i] === '--sizes') out.sizes = argv[++i];
        else out.dir = argv[i];
    }
    if (!out.dir) {
        console.error('usage: node tools/try-on-tour.mjs OUT_DIR [--url URL] [--sizes WxH,...]');
        process.exit(2);
    }
    return out;
}

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch (error) {
        console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
        process.exit(2);
    }
}

async function openPage(pw, viewport, origin) {
    const mobile = viewport.width < 700;
    const browser = await pw.chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: true,
        ...(mobile
            ? {
                  isMobile: true,
                  hasTouch: true,
                  deviceScaleFactor: 2,
                  userAgent:
                      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
                      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
              }
            : {}),
    });
    if (process.env.HTTPS_PROXY) {
        // The browser cannot use an HTTPS-only proxy for the local page itself, so only the
        // requests to other hosts are fetched through it.
        const net = await pw.request.newContext({
            proxy: { server: process.env.HTTPS_PROXY },
            ignoreHTTPSErrors: true,
        });
        await context.route(
            (u) => u.origin !== origin && u.protocol === 'https:',
            async (route) => {
                const r = route.request();
                try {
                    const res = await net.fetch(r.url(), {
                        method: r.method(),
                        headers: r.headers(),
                        data: r.postDataBuffer() || undefined,
                    });
                    await route.fulfill({ status: res.status(), headers: res.headers(), body: await res.body() });
                } catch {
                    await route.abort();
                }
            }
        );
    }
    return { browser, page: await context.newPage(), mobile };
}

async function tour(pw, opts, viewport) {
    const tag = `${viewport.width}x${viewport.height}`;
    const failures = [];
    const { browser, page, mobile } = await openPage(pw, viewport, new URL(opts.url).origin);
    const shot = (name) => page.screenshot({ path: path.join(opts.dir, `${tag}-${name}.png`) });
    const camera = () =>
        page.evaluate(() => {
            const v = window.NEXUS_VIEWER;
            return v && v.camera && v.controls
                ? [...v.camera.position.toArray(), ...v.controls.target.toArray()].map((n) => n.toFixed(4)).join(',')
                : null;
        });
    const visible = (selector) =>
        page.$$eval(selector, (els) =>
            els.some((e) => {
                const r = e.getBoundingClientRect();
                const s = getComputedStyle(e);
                if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') return false;
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return Boolean(hit && (hit === e || e.contains(hit)));
            })
        );
    try {
        await page.goto(opts.url, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => window.NEXUS_VIEWER && window.NEXUS_VIEWER.avatarManager?.currentRoot, null, {
            timeout: 120000,
        });
        await page.waitForTimeout(2000);
        await shot('00-home');

        if (await page.$('#nexus-bd-together-launcher:visible')) await page.click('#nexus-bd-together-launcher');
        else {
            await page.click('#mobile-menu-btn');
            await page.click('#nexus-bd-together-drawer-item');
        }
        await page.waitForSelector('.nexus-bd-together-tile', { timeout: 15000 });
        await shot('01-together');
        const tiles = await page.$$eval('.nexus-bd-together-tile', (els) => els.map((e) => e.textContent.trim()));
        for (const name of TOGETHER) {
            if (!tiles.some((t) => t.endsWith(name) || t.includes(name)))
                failures.push(`Together has no "${name}" tile`);
        }

        await page.$eval('.nexus-bd-together-tile[data-activity="try-on-haul"]', (e) => {
            e.scrollIntoView({ block: 'center' });
            e.click();
        });
        await page.waitForSelector('.nexus-look-rail-title', { timeout: 60000 });
        await page.waitForSelector('.nexus-look-rail-item', { state: 'attached', timeout: 60000 });
        // On a phone the rail starts folded to its Looks button: open it, as a person would.
        if (await page.$('.nexus-try-on-look-rail.is-folded')) {
            await page.waitForTimeout(800);
            await shot('02a-folded');
            await page.click('.nexus-look-rail-title');
        }
        await page.waitForTimeout(1500);
        await shot('02-try-on');
        const before = await camera();

        const count = (await page.$$('.nexus-look-rail-item')).length;
        for (let i = 0; i < Math.min(count, 3); i += 1) {
            const landed = page.waitForFunction(
                (n) => (document.querySelector('.nexus-stage-count')?.textContent || '').includes(`${n} /`),
                i + 1,
                { timeout: 90000 }
            );
            await page.click(`.nexus-look-rail-item >> nth=${i}`);
            await landed;
            await page.waitForTimeout(1500);
            await shot(`03-look-${i + 1}`);
            const now = await camera();
            if (now !== before) failures.push(`the camera moved when look ${i + 1} was worn (${before} → ${now})`);
        }

        if (mobile) {
            for (const command of ['turn', 'save', 'next']) {
                if (!(await visible(`.nexus-stage-action[data-command="${command}"]`)))
                    failures.push(`on a phone, "${command}" is not visible on the stage`);
            }
        }

        // Click by selector, never through a held element: the stage redraws its buttons on
        // every state change, and a held one is detached by the time it is clicked.
        const turn = '.nexus-stage-action[data-command="turn"]';
        if (await page.$(turn)) {
            await page.click(turn);
            await page.waitForTimeout(1200);
            await shot('04-back');
            await page.click(turn);
            await page.waitForTimeout(900);
        }
        const zoom = '.nexus-stage-action[data-command="zoom"]';
        if (await page.isVisible(zoom).catch(() => false)) {
            await page.click(zoom);
            await page.waitForTimeout(600);
            await shot('05-zoom');
            await page.click(zoom);
            await page.waitForTimeout(300);
            if ((await camera()) !== before) failures.push('Zoom, pressed twice, did not return to the same camera');
        }

        await page.click('.nexus-look-rail-edit');
        await page.waitForTimeout(800);
        await shot('06-more');
        if ((await visible('.nexus-stage-info')) && (await visible('#nexus-try-on-view')))
            failures.push('the stage summary and the advanced panel are on screen together');
        await page.click('.nexus-look-rail-edit');
        await page.waitForTimeout(500);

        const conversation = '.nexus-live-button[aria-label="Conversation mode"]';
        if (mobile && (await page.isVisible('.nexus-live-summary').catch(() => false))) {
            await page.click('.nexus-live-summary');
            await page.waitForTimeout(800);
            await shot('07-conversation');
            if (await visible('.nexus-stage-action[data-command="next"]'))
                failures.push('on a phone, the stage controls stay over her in Conversation');
        } else if (await page.isVisible(conversation).catch(() => false)) {
            await page.click(conversation);
            await page.waitForTimeout(800);
            await shot('07-conversation');
        }
    } catch (error) {
        failures.push(`the tour stopped: ${error.message.split('\n')[0]}`);
        await shot('99-stopped').catch(() => {});
    } finally {
        await browser.close();
    }
    return { tag, failures };
}

const opts = args(process.argv.slice(2));
fs.mkdirSync(opts.dir, { recursive: true });
const pw = await loadPlaywright();
let failed = 0;
for (const size of opts.sizes.split(',')) {
    const [width, height] = size.split('x').map(Number);
    const { tag, failures } = await tour(pw, opts, { width, height });
    console.log(`${tag}: ${failures.length ? 'FAIL' : 'ok'}`);
    for (const f of failures) console.log(`   - ${f}`);
    failed += failures.length;
}
process.exit(failed ? 1 : 0);
