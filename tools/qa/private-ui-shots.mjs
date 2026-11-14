#!/usr/bin/env node
/**
 * PUI. Screenshots and measurements of the Private conversation UI, next to the Experiences UI
 * it should feel like, at the four sizes the redesign is judged at.
 *
 *   node tools/qa/private-ui-shots.mjs [--base http://127.0.0.1:8080] [--out tmp/private-ui] [--label after]
 *
 * The app must be running (`npm start`). Headless Chromium renders through SwiftShader: these are
 * layout and visibility measurements, never frame-rate or device evidence.
 *
 * Why measure and not only look. The complaint was "the chips cross her face". A screenshot shows
 * that once; a number says it for every size and every later change. For each shot this asks the
 * browser what is drawn at five points of her face — `elementFromPoint` returns the topmost
 * element — and reports anything that is not the 3D canvas. It also records where the venue chips
 * live (inside the Private card, or floating), the transcript's visible height, and whether End
 * and the composer are on screen and not covered.
 *
 * What is simulated, and nothing else: the person's own Private Mode confirmation (localStorage,
 * as the Settings toggle writes it) and the transcript text, which is drawn through the real
 * conversation surface with fixed, non-explicit lines so every run compares like with like. Private
 * is started through the Together panel exactly as its tile starts it, on a public avatar declared
 * adult (PW8). No consent, gate or authorization code is touched.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:8080');
const OUT = arg('out', 'tmp/private-ui');
const LABEL = arg('label', 'shot');
const ONLY = arg('only', '');

const SIZES = {
    desktop: { viewport: { width: 1440, height: 900 } },
    phone: { ...devices['iPhone 13'] },
    'small-phone': {
        ...devices['iPhone SE'],
        viewport: { width: 320, height: 568 },
        screen: { width: 320, height: 568 },
    },
    landscape: { ...devices['iPhone 13 landscape'] },
};

/** Fixed, non-explicit lines: the same text every run, so a layout change is the only change. */
const SHORT = [
    ['user', 'Che bel posto. Dove siamo?'],
    ['her', 'In a little private cabaret — the stage lights are low and warm.'],
];
const LONG = [
    ...SHORT,
    ['user', 'Mi metti una luce più calda?'],
    [
        'her',
        'There — softer now. The footlights catch the edge of the curtain, and the lounge corner is just a few steps away if you would rather sit back and listen to the music for a while.',
    ],
    ['user', 'Raccontami qualcosa di questo posto.'],
    [
        'her',
        'It used to be a small music hall. They kept the old curtain and the brass rail, and the stage still creaks a little in the middle. I like it best like this, when it is quiet and it is only us.',
    ],
];

async function boot(browser, size) {
    const ctx = await browser.newContext(SIZES[size]);
    await ctx.addInitScript(() => {
        localStorage.setItem('nexus_together_enabled', 'on');
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.__NEXUS_COMPANION_LIVE,
        null,
        { timeout: 180000 }
    );
    await page.waitForTimeout(2500);
    return { ctx, page, errors };
}

/** Everything is read from the live page; nothing here is assumed about the layout. */
function measure(page) {
    return page.evaluate(() => {
        const viewer = window.NEXUS_VIEWER;
        const canvas = viewer.renderer.domElement;
        const cr = canvas.getBoundingClientRect();
        const vrm = viewer.avatarManager._currentVRM;
        const head = vrm?.humanoid?.getNormalizedBoneNode?.('head');
        const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const shown = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
            return shown
                ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
                : null;
        };
        const label = (el) =>
            !el
                ? 'nothing'
                : el.id
                  ? '#' + el.id
                  : el.className && typeof el.className === 'string'
                    ? '.' + el.className.trim().split(/\s+/)[0]
                    : el.tagName.toLowerCase();
        let face = null;
        const covered = [];
        if (head) {
            head.updateWorldMatrix(true, false);
            const p = head.getWorldPosition(head.position.clone());
            const toScreen = (v) => {
                const q = v.clone().project(viewer.camera);
                return { x: cr.x + ((q.x + 1) / 2) * cr.width, y: cr.y + ((1 - q.y) / 2) * cr.height };
            };
            const chin = toScreen(p);
            const top = toScreen(p.clone().setY(p.y + 0.22));
            const midY = (chin.y + top.y) / 2;
            const half = Math.max(6, Math.abs(chin.y - top.y) * 0.35);
            face = { x: Math.round(chin.x), top: Math.round(top.y), chin: Math.round(chin.y) };
            const points = [
                [chin.x, midY],
                [chin.x - half, midY],
                [chin.x + half, midY],
                [chin.x, top.y + 2],
                [chin.x, chin.y - 2],
            ];
            for (const [x, y] of points) {
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
                    covered.push('off-screen');
                    continue;
                }
                const hit = document.elementFromPoint(x, y);
                if (hit !== canvas && !(hit && hit.contains && hit.contains(canvas))) covered.push(label(hit));
            }
        }
        const bar = document.getElementById('nexus-playground-bar');
        const row = document.getElementById('nexus-private-conversation-row');
        const card = row && row.querySelector('.nexus-private-card');
        const end = row && [...row.querySelectorAll('button')].find((b) => /^(End|Fine)\b/i.test(b.textContent.trim()));
        const input =
            document.getElementById('user-input') ||
            document.querySelector('.chat-input-shell textarea, .chat-input-shell input');
        const onTop = (el) => {
            const r = el && el.getBoundingClientRect();
            if (!r || !r.width) return false;
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!hit && (hit === el || el.contains(hit));
        };
        return {
            viewport: { w: innerWidth, h: innerHeight },
            canvas: rect(canvas),
            face,
            faceCoveredBy: [...new Set(covered)],
            chips: bar
                ? {
                      inPrivateCard: !!(row && row.contains(bar)),
                      rect: rect(bar),
                      count: bar.querySelectorAll('button').length,
                  }
                : null,
            privateCard: rect(row),
            transcript: card ? { visibleH: Math.round(card.clientHeight), contentH: card.scrollHeight } : null,
            endVisible: !!end && onTop(end),
            endRect: rect(end),
            composerVisible: !!input && onTop(input),
            pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
    });
}

async function fill(page, lines) {
    await page.evaluate(async (lines) => {
        const S = window.NEXUS_CONVERSATION_SURFACE;
        for (const [who, text] of lines) {
            if (who === 'user') S.renderUser(text);
            else S.renderAssistant(text);
        }
    }, lines);
    await page.waitForTimeout(600);
}

async function privateRun(browser, size, out) {
    const { ctx, page, errors } = await boot(browser, size);
    await page.evaluate(async () => {
        await window.NEXUS_VIEWER.avatarManager.setAvatarByUrl('/vendor/avatars/AvatarSample_A.vrm', 'AvatarSample A');
    });
    await page.waitForTimeout(2500);
    const started = await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const a = panel.activities.get('intimate');
        if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'romantic') || {
            id: 'romantic',
        };
        const r = await panel.startActivity('intimate', opt);
        return { ok: !!(r && r.ok), why: r && r.why };
    });
    await page
        .waitForFunction(() => /private-cabaret/.test(window.NEXUS_VIEWER.vrWorlds?.activeId || ''), null, {
            timeout: 120000,
        })
        .catch(() => {});
    await page
        .waitForFunction(() => document.getElementById('nexus-playground-bar'), null, { timeout: 30000 })
        .catch(() => {});
    await page.waitForTimeout(3500);
    const shots = {};
    await fill(page, SHORT);
    await page.screenshot({ path: path.join(out, `${LABEL}-${size}-private-short.png`) });
    shots.short = await measure(page);
    await fill(page, LONG.slice(SHORT.length));
    await page.screenshot({ path: path.join(out, `${LABEL}-${size}-private-long.png`) });
    shots.long = await measure(page);
    if (size !== 'desktop') {
        // Keyboard: focusing the composer is what sets html.nexus-keyboard-open (MobileChatOverlay).
        await page.evaluate(() => {
            const i =
                document.getElementById('user-input') ||
                document.querySelector('.chat-input-shell textarea, .chat-input-shell input');
            if (i) i.focus();
        });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(out, `${LABEL}-${size}-private-keyboard.png`) });
        shots.keyboard = await measure(page);
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
    }
    await ctx.close();
    return { started, world: 'private-cabaret', shots, errors };
}

async function experiencesRun(browser, size, out) {
    const { ctx, page, errors } = await boot(browser, size);
    await page.evaluate(() =>
        window.__NEXUS_COMPANION_LIVE.session.enter('experiences', 'place-irish-pub', {
            source: 'together',
            silent: true,
        })
    );
    await page
        .waitForFunction(() => /irish-pub/.test(window.NEXUS_VIEWER.vrWorlds?.activeId || ''), null, {
            timeout: 120000,
        })
        .catch(() => {});
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(out, `${LABEL}-${size}-experiences.png`) });
    const m = await measure(page);
    await ctx.close();
    return { world: 'irish-pub', shots: { reference: m }, errors };
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
fs.mkdirSync(OUT, { recursive: true });
const report = { base: BASE, label: LABEL, renderer: 'SwiftShader (software) — layout evidence only', sizes: {} };
for (const size of Object.keys(SIZES)) {
    if (ONLY && !ONLY.split(',').includes(size)) continue;
    report.sizes[size] = {
        private: await privateRun(browser, size, OUT),
        experiences: await experiencesRun(browser, size, OUT),
    };
    process.stderr.write(`done ${size}\n`);
}
await browser.close();
fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
