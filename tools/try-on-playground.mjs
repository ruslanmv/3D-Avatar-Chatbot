#!/usr/bin/env node
/**
 * LT4. The Try-On playground: a person plays with Try-On against a real Forge, and every
 * step is timed. Where the tour (try-on-tour.mjs) checks that the stage holds together, this
 * measures how it feels: how long until something visibly answers, what she says while Forge
 * works, how long a new look takes to land, and what a person sees when a step cannot run.
 *
 *     npm start                                      # this site, in another terminal
 *     uvicorn apps.api.main:app --port 8765          # a Forge, in its own repository
 *     node tools/try-on-playground.mjs OUT_DIR --forge http://127.0.0.1:8765 [--url URL]
 *             [--avatar fem_vroid.vrm] [--private] [--scenario valentine]
 *
 * Writes OUT_DIR/timeline.json (every visible change, with milliseconds since the step began)
 * and a screenshot at each beat. It asserts nothing: it is the evidence a review reads.
 */
import fs from 'node:fs';
import path from 'node:path';

//: A scenario is a list of beats. `create` and `change` type into Try-On's own composer
//: (TryOnIntent → TryOnGenerator → Forge); `ask` types into the conversation, which reaches
//: the wardrobe only through the model's <wardrobe/> tag.
const SCENARIOS = {
    valentine: [
        { kind: 'create', text: "a red satin bodycon mini dress for a Valentine's date night" },
        { kind: 'change', text: 'change the dress to wine' },
        { kind: 'ask', text: "Make me a romantic Valentine's look" },
    ],
};

function args(argv) {
    const out = {
        dir: null,
        url: 'http://localhost:8080/',
        forge: null,
        avatar: 'fem_vroid.vrm',
        private: false,
        scenario: 'valentine',
        size: '1366x768',
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--url') out.url = argv[++i];
        else if (a === '--forge') out.forge = argv[++i];
        else if (a === '--avatar') out.avatar = argv[++i];
        else if (a === '--scenario') out.scenario = argv[++i];
        else if (a === '--size') out.size = argv[++i];
        else if (a === '--private') out.private = true;
        else out.dir = a;
    }
    if (!out.dir || !out.forge || !SCENARIOS[out.scenario]) {
        console.error('usage: node tools/try-on-playground.mjs OUT_DIR --forge URL [--scenario valentine]');
        process.exit(2);
    }
    return out;
}

const opts = args(process.argv.slice(2));
fs.mkdirSync(opts.dir, { recursive: true });
const { chromium } = await import('playwright');
const [width, height] = opts.size.split('x').map(Number);
const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript(
    ({ forge, avatar, priv }) => {
        localStorage.setItem('wardrobe_forge_mode', 'custom');
        localStorage.setItem('wardrobe_forge_url', forge);
        localStorage.setItem('nexus_selected_avatar_file', avatar);
        localStorage.setItem('nexus_wardrobe_ai_enabled', 'true');
        if (priv) {
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
        }
    },
    { forge: opts.forge, avatar: opts.avatar, priv: opts.private }
);
const page = await context.newPage();
const timeline = [];
const log = (beat, t0, what, detail) => {
    const entry = { beat, ms: Date.now() - t0, what, detail };
    timeline.push(entry);
    console.log(`[${beat}] +${entry.ms} ms ${what}${detail ? ': ' + detail : ''}`);
};
page.on('pageerror', (e) => timeline.push({ beat: 'page', what: 'page error', detail: e.message }));
const forgeCalls = [];
page.on('request', (r) => {
    if (r.url().startsWith(opts.forge)) forgeCalls.push({ at: Date.now(), method: r.method(), url: r.url() });
});
const shot = (name) => page.screenshot({ path: path.join(opts.dir, `${name}.png`) });

// What a person can see that says what is happening: Try-On's progress and errors, the
// stage's look counter, and the last bubble in the conversation.
const visibleState = () =>
    page.evaluate(() => {
        const text = (sel) =>
            Array.from(document.querySelectorAll(sel))
                .filter((e) => e.offsetParent !== null)
                .map((e) => e.textContent.trim())
                .filter(Boolean)
                .join(' | ');
        const bubbles = document.querySelectorAll('#chat-history .message, #chat-history [class*="message"]');
        return {
            progress: text('.nexus-try-on-progress-line, .nexus-try-on-progress'),
            error: text('.nexus-try-on-error, [role="alert"]'),
            count: text('.nexus-stage-count'),
            look: text('.nexus-stage-look-name, .nexus-stage-title'),
            lastBubble: bubbles.length ? bubbles[bubbles.length - 1].textContent.trim().slice(0, 160) : '',
            // "Look 3 of 3" shows on the stage and in the panel alike; the stage counter alone
            // is hidden while the panel is open, and a run that watched only it never saw a
            // look land.
            landed: ((document.body.innerText || '').match(/look\s+(\d+)\s+of\s+(\d+)/i) || [''])[0],
        };
    });

async function watch(beat, t0, done, limitMs) {
    let last = {};
    for (;;) {
        const now = await visibleState();
        for (const key of Object.keys(now)) {
            if (now[key] !== last[key] && now[key]) log(beat, t0, key, now[key]);
        }
        last = now;
        if (await done(now)) return now;
        if (Date.now() - t0 > limitMs) {
            log(beat, t0, 'gave up waiting');
            return now;
        }
        await page.waitForTimeout(400);
    }
}

try {
    let t0 = Date.now();
    await page.goto(opts.url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?.currentRoot, null, { timeout: 180000 });
    log('open', t0, 'avatar on stage');
    await shot('00-home');

    t0 = Date.now();
    await page.click('#nexus-bd-together-launcher');
    await page.waitForSelector('.nexus-bd-together-tile', { timeout: 15000 });
    await page.$eval('.nexus-bd-together-tile[data-activity="try-on-haul"]', (e) => e.click());
    await page.waitForSelector('.nexus-look-rail-item', { state: 'attached', timeout: 90000 });
    log('try-on', t0, 'Try-On open', `${(await page.$$('.nexus-look-rail-item')).length} looks in the rail`);
    await page.waitForTimeout(1500);
    await shot('01-try-on');

    for (const [index, step] of SCENARIOS[opts.scenario].entries()) {
        const beat = `${index + 1}-${step.kind}`;
        t0 = Date.now();
        const calls = forgeCalls.length;
        const before = await visibleState();
        if (step.kind === 'ask') {
            if (!(await page.isVisible('#speech-text').catch(() => false))) {
                // Finding: with Try-On's panel open the conversation is not on screen at all.
                log(beat, t0, 'the conversation is not visible; closing the panel to reach it');
                await page
                    .getByText('Hide', { exact: false })
                    .first()
                    .click()
                    .catch(() => {});
                await page.waitForTimeout(800);
            }
            await page.fill('#speech-text', step.text);
            await page.click('#speak-btn');
            log(beat, t0, 'sent to the conversation', step.text);
            await watch(
                beat,
                t0,
                async (s) => s.lastBubble && s.lastBubble !== before.lastBubble && Date.now() - t0 > 6000,
                60000
            );
        } else {
            // The composer lives in the advanced panel ("More"); open it the way a person would.
            if (!(await page.isVisible('.nexus-try-on-composer input').catch(() => false))) {
                await page.click('.nexus-look-rail-edit');
                log(beat, t0, 'pressed More');
                if (!(await page.isVisible('.nexus-try-on-composer input').catch(() => false))) {
                    // PR #114: More opens the garment catalog; the free-text composer is under Advanced.
                    await page.getByRole('button', { name: 'Advanced' }).click();
                    log(beat, t0, 'pressed Advanced');
                }
                await page.waitForSelector('.nexus-try-on-composer input', { timeout: 10000 });
                log(beat, t0, 'composer visible', `${(await page.$$('.nexus-try-on-composer input')).length} input(s)`);
            }
            await page.fill('.nexus-try-on-composer input', step.text);
            await page.press('.nexus-try-on-composer input', 'Enter');
            log(beat, t0, 'typed', step.text);
            await shot(`${beat}-a-sent`);
            const final = await watch(
                beat,
                t0,
                async (s) => (s.landed && s.landed !== before.landed) || Boolean(s.error),
                15 * 60000
            );
            log(beat, t0, final.error ? 'ended with an error' : 'look landed', final.error || final.landed);
        }
        log(beat, t0, 'Forge requests', String(forgeCalls.length - calls));
        await page.waitForTimeout(2000);
        await shot(`${beat}-b-result`);
    }
} catch (error) {
    timeline.push({ beat: 'stopped', what: error.message.split('\n')[0] });
    await shot('99-stopped').catch(() => {});
} finally {
    fs.writeFileSync(
        path.join(opts.dir, 'timeline.json'),
        JSON.stringify({ timeline, forgeCalls: forgeCalls.map((c) => `${c.method} ${c.url}`) }, null, 1)
    );
    await browser.close();
}
