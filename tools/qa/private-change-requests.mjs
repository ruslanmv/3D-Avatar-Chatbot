#!/usr/bin/env node
/**
 * UN20. The reported Italian transcript, in the real page: what the person is shown after asking
 * for a change that cannot happen.
 *
 *   node tools/qa/private-change-requests.mjs [--lang it-IT|en-US] [--size desktop|phone] [--out dir]
 *        [--url http://127.0.0.1:8080]
 *
 * Reported (it-IT, Private, level "Intimo"): "poi togliete i vestiti" took a layer off, then
 * "Toglili tutti" parsed as nothing and the person saw "Per ora resto come sono." under
 * "Sì, fallo / Aspetta un momento" chips that offered nothing. This drives the same two sentences
 * through the page's own composer, in a Private session raised to level 4 with ConsentFlow's own
 * Closer control (three taps, as a person does), and reads back what the conversation card shows.
 *
 * The one stand-in, and why it is the worst case: the model. No provider is configured in a test
 * container, so the OpenAI-shaped request the page makes is answered here with a fixed draft that
 * *claims the change happened* and offers "yes / wait" choices — exactly the draft that produced
 * the reported card. Everything after it is the page's own: the bridge's verdict, the reply check,
 * the chips. Looks are the vendored pack (clothed, general-rated); no Forge, no lingerie import,
 * no bare state exists, and none is simulated. Screenshots go to --out, outside the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LANG = arg('lang', 'it-IT');
const SIZE = arg('size', 'desktop');
const OUT = path.resolve(arg('out', path.join(ROOT, 'audits/private/runs/change-requests')));
fs.mkdirSync(OUT, { recursive: true });

const SCRIPT = arg('script', 'reported');
/**
 * Each step: [label, the person's words, the model stand-in's draft, expectations].
 * `expect.action/status/why` are checked against the newest action; `noAction` means none may
 * be added; `send` means the next step is sent without waiting for this one to settle (UN21:
 * "Aspetta" while the lingerie is still downloading, through the real controller's cancel()).
 */
const SCRIPTS = {
    reported: {
        'it-IT': [
            [
                'wear',
                'Mettiti il prendisole giallo',
                'Ecco, me lo metto per te.',
                { action: 'wardrobe.wear', status: 'completed' },
            ],
            ['undress', 'poi togliete i vestiti', 'Va bene, li tolgo per te.', { action: 'wardrobe.undress' }],
            [
                'all',
                'Toglili tutti',
                'Le tolgo tutte per te.',
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
        ],
        'en-US': [
            [
                'wear',
                'Put on the yellow sundress',
                "There, I'm putting it on for you.",
                { action: 'wardrobe.wear', status: 'completed' },
            ],
            ['undress', 'Take off your clothes', "Okay, I'm taking them off for you.", { action: 'wardrobe.undress' }],
            [
                'all',
                'Take them all off',
                "I'm taking everything off for you.",
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
        ],
    },
    // UN21. The adult directive's transcript, with a "wait" sent while a change is downloading.
    directive: {
        'it-IT': [
            [
                'wear',
                'Mettiti il prendisole giallo',
                'Ecco, me lo metto per te.',
                { action: 'wardrobe.wear', status: 'completed' },
            ],
            ['undress-1', 'Togliti i vestiti.', 'Va bene, me li tolgo.', { action: 'wardrobe.undress', send: true }],
            [
                'wait',
                'Aspetta un momento.',
                'Va bene, me li tolgo lo stesso.',
                { action: 'wardrobe.cancel', status: 'completed', cancelled: true },
            ],
            [
                'undress-2',
                'Togliti i vestiti.',
                'Va bene, me li tolgo.',
                { action: 'wardrobe.undress', status: 'completed', state: 'lingerie' },
            ],
            [
                'then-all',
                'Poi togli tutto.',
                'Tolgo tutto per te.',
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
            [
                'all',
                'Toglili tutti.',
                'Le tolgo tutte per te.',
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
            [
                'correct-1',
                'Non intendevo un vestito più leggero.',
                'Va bene, mi tolgo tutto.',
                { action: 'wardrobe.undress', why: 'no-bare-look', correction: true, reason: true },
            ],
            [
                'correct-2',
                'Intendevo tutti i vestiti.',
                'Ecco, tolgo tutto.',
                { action: 'wardrobe.undress', why: 'no-bare-look', correction: true, reason: true },
            ],
            ['yes', 'Sì, fallo.', 'Mm, sono qui con te.', { noAction: true }],
        ],
        'en-US': [
            [
                'wear',
                'Put on the yellow sundress',
                "There, I'm putting it on for you.",
                { action: 'wardrobe.wear', status: 'completed' },
            ],
            [
                'undress-1',
                'Take your clothes off.',
                "Okay, I'm taking them off.",
                { action: 'wardrobe.undress', send: true },
            ],
            [
                'wait',
                'Wait a moment.',
                "I'm taking them off anyway.",
                { action: 'wardrobe.cancel', status: 'completed', cancelled: true },
            ],
            [
                'undress-2',
                'Take your clothes off.',
                "Okay, I'm taking them off.",
                { action: 'wardrobe.undress', status: 'completed', state: 'lingerie' },
            ],
            [
                'then-all',
                'Then take everything off.',
                "I'm taking everything off for you.",
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
            [
                'all',
                'Take them all off.',
                "I'm taking them all off.",
                { action: 'wardrobe.undress', why: 'no-bare-look', reason: true },
            ],
            [
                'correct-1',
                'Not just a lighter outfit.',
                "Okay, I'm taking everything off.",
                { action: 'wardrobe.undress', why: 'no-bare-look', correction: true, reason: true },
            ],
            [
                'correct-2',
                'I mean everything.',
                "I'm taking everything off.",
                { action: 'wardrobe.undress', why: 'no-bare-look', correction: true, reason: true },
            ],
            ['yes', 'Yes, do it.', "Mm, I'm right here with you.", { noAction: true }],
        ],
    },
};
const SAY = SCRIPTS[SCRIPT][LANG];
const CHOICES = LANG === 'it-IT' ? ['Sì, fallo', 'Aspetta un momento'] : ['Yes, do it', 'Wait a moment'];

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright, why } = D.loadPlaywright();
if (!playwright) {
    console.error(why);
    process.exit(1);
}
const server = await D.ensureServer(arg('url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
const report = { lang: LANG, size: SIZE, steps: [], failures: [], modelCalls: 0 };
const fail = (step, msg) => report.failures.push(`${step}: ${msg}`);
try {
    const ctx = await browser.newContext(
        SIZE === 'phone'
            ? { ...playwright.devices['iPhone 13'], viewport: { width: 390, height: 844 } }
            : { viewport: { width: 1440, height: 900 } }
    );
    await ctx.addInitScript((lang) => {
        localStorage.setItem('nexus_together_enabled', 'on');
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
        localStorage.setItem('app_lang', lang);
        localStorage.setItem('npc_enabled', 'false');
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({ provider: 'openai', openai: { api_key: 'sk-qa-stand-in', model: 'qa-stand-in' } })
        );
    }, LANG);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    // The model stand-in: the draft for the person's latest line, with the reported choices.
    let draftFor = () => '';
    await page.route('**/v1/chat/completions', async (route) => {
        report.modelCalls += 1;
        let body = {};
        try {
            body = JSON.parse(route.request().postData() || '{}');
        } catch (_) {
            /* an unreadable body gets the plain draft */
        }
        const last = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
        const content = `${draftFor(String((last && last.content) || ''))}\n<choices>\n${CHOICES.join('\n')}\n</choices>`;
        if (body.stream) {
            const chunk = JSON.stringify({ choices: [{ delta: { content } }] });
            await route.fulfill({
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
                body: `data: ${chunk}\n\ndata: [DONE]\n\n`,
            });
        } else {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
            });
        }
    });
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.__NEXUS_COMPANION_LIVE,
        null,
        { timeout: 240000 }
    );
    await page.waitForTimeout(2500);

    // Private, then level 4 with the person's own control.
    await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || {
            id: 'mature',
        };
        await panel.startActivity('intimate', opt);
    });
    await page.waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS?.snapshot().active, null, { timeout: 60000 });
    for (let i = 0; i < 3; i += 1) {
        await page.waitForTimeout(4600);
        await page.click('[data-private-action="closer"]').catch(() => fail('level', `Closer tap ${i + 1} failed`));
    }
    await page.waitForTimeout(1500);
    report.level = await page.evaluate(() => window.NEXUS_BD.adult.level);
    // Every turn as it appears, with its time, so a scripted line can be placed against the
    // person's lines and the actions' own times (what was running when it arrived).
    await page.evaluate(() => {
        window.__turns = [];
        const seen = new WeakSet();
        const note = () => {
            for (const t of document.querySelectorAll('[data-private-turn]')) {
                if (seen.has(t)) continue;
                seen.add(t);
                const copy = t.querySelector('.nexus-private-copy');
                window.__turns.push({
                    at: Date.now(),
                    who: t.dataset.privateTurn,
                    text: copy ? copy.textContent.trim() : '',
                });
            }
        };
        note();
        new MutationObserver(note).observe(document.body, { childList: true, subtree: true });
        window.__levels = [];
        const bus = window.NEXUS_BD && window.NEXUS_BD.bus;
        if (bus && typeof bus.on === 'function')
            for (const name of ['adult:level', 'adult:exit'])
                bus.on(name, (e) => window.__levels.push({ event: name, now: Date.now(), ...(e || {}) }));
    });
    if (report.level !== 4) fail('level', `ConsentFlow is at ${report.level}, not 4`);

    const herLines = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy')]
                .map((n) => n.textContent.trim())
                .filter(Boolean)
        );
    const visibleChoices = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('[data-private-choices]:not([data-spent]) .nexus-private-choice')].map((b) =>
                b.textContent.trim()
            )
        );
    const card = async (label) => {
        // A clipped page capture, never an element capture: an element capture waits for the live
        // canvas behind the card to stop changing, which it never does — every step then sat idle
        // for its full timeout, and that silence was long enough for the session's lull lines.
        const file = path.join(OUT, `${SCRIPT}-${SIZE}-${LANG}-${label}.png`);
        const box = await page
            .locator('#nexus-private-conversation-row')
            .first()
            .boundingBox()
            .catch(() => null);
        await page.screenshot({ path: file, ...(box && box.width && box.height ? { clip: box } : {}) });
        return path.basename(file);
    };

    const vague =
        LANG === 'it-IT'
            ? ['Per ora resto come sono.', 'Per ora resto così.']
            : ['For now I’m staying as I am.', 'I’m staying as I am, for now.'];
    let previous = null;
    for (const [label, said, draft, planned] of SAY) {
        draftFor = () => draft;
        let expect = planned;
        let noneSettled = false;
        // "Aspetta" stops a change only while it is under way. Whether it still was is decided
        // after the step, from when the bridge received the words (typing on a phone takes
        // seconds, and the change may land meanwhile) — see `landedFirst` below.
        const wasRunning = previous ? previous.turnId : null;
        const before = await page.evaluate(() => window.NEXUS_PRIVATE_ACTIONS.log().length);
        const shownBefore = (await herLines()).length;
        await page.fill('#speech-text', said);
        await page.click('#speak-btn');
        if (expect.send) {
            // Sent on: wait only until it is under way.
            await page
                .waitForFunction((n) => window.NEXUS_PRIVATE_ACTIONS.log().length > n, before, { timeout: 30000 })
                .catch(() => fail(label, 'no action started'));
            const started = await page.evaluate(() => {
                const a = window.NEXUS_PRIVATE_ACTIONS.log().slice(-1)[0] || {};
                return { action: a.name, status: a.status, turnId: a.turnId };
            });
            report.steps.push({ label, said, ...started });
            console.log(`${label}: ${started.action} ${started.status} (sent on without waiting)`);
            if (started.status !== 'pending') fail(label, `expected a change still under way, got ${started.status}`);
            previous = started;
            continue;
        }
        if (!expect.noAction)
            await page
                .waitForFunction(
                    (n) => {
                        const log = window.NEXUS_PRIVATE_ACTIONS.log();
                        const w = log[log.length - 1];
                        return log.length > n && w && w.status !== 'pending';
                    },
                    before,
                    { timeout: planned.cancelled ? 30000 : 180000 }
                )
                .catch(() => {
                    noneSettled = true;
                });
        await page
            .waitForFunction(
                (n) => document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy').length > n,
                shownBefore,
                { timeout: 60000 }
            )
            .catch(() => {});
        await page.waitForTimeout(2500);
        const facts = await page.evaluate(
            (prevTurn) => {
                const A = window.NEXUS_PRIVATE_ACTIONS;
                const log = A.log();
                const last = log.slice(-1)[0] || {};
                const earlier =
                    prevTurn == null ? null : log.find((a) => a.turnId === prevTurn && a.family === 'wardrobe');
                return {
                    count: log.length,
                    action: last.name,
                    status: last.status,
                    why: last.why || null,
                    params: last.params || {},
                    earlierStatus: earlier ? earlier.status : null,
                    outfitState: A.snapshot().outfitState,
                    wearing: (A.snapshot().outfit && A.snapshot().outfit.name) || null,
                    level: window.NEXUS_BD.adult.level,
                };
            },
            previous ? previous.turnId : null
        );
        const lines = await herLines();
        // Everything said after the person's line: every turn after the last "you" turn.
        const after = await page.evaluate(() => {
            const turns = [...document.querySelectorAll('[data-private-turn]')];
            let i = turns.length - 1;
            while (i >= 0 && turns[i].dataset.privateTurn !== 'you') i -= 1;
            return turns
                .slice(i + 1)
                .map((t) => t.querySelector('.nexus-private-copy')?.textContent.trim() || '')
                .filter(Boolean);
        });
        const step = {
            label,
            said,
            expected: expect,
            modelDraft: draft,
            ...facts,
            shown: after.join(' / '),
            after,
            transcript: lines,
            choices: await visibleChoices(),
            screenshot: await card(label),
        };
        report.steps.push(step);
        console.log(
            `${label}: ${facts.action} ${facts.status}${facts.why ? ` (${facts.why})` : ''} → “${step.shown}” [${step.choices.join(' | ')}]`
        );
        // The change had settled before the bridge received "wait": nothing to stop. The right
        // outcome is then no action, and no false claim shown.
        if (planned.cancelled && wasRunning != null) {
            const landed = await page.evaluate(
                ({ turnId, said: words }) => {
                    const a = window.NEXUS_PRIVATE_ACTIONS.log().find(
                        (x) => x.turnId === turnId && x.family === 'wardrobe'
                    );
                    const heard = [...(window.__turns || [])]
                        .reverse()
                        .find((t) => t.who === 'you' && t.text === words);
                    return Boolean(a && a.settledAt && heard && a.settledAt <= heard.at);
                },
                { turnId: wasRunning, said }
            );
            if (landed) {
                expect = { noAction: true, landedFirst: true };
                step.expected = expect;
                console.log(`${label}: the change had landed before the words arrived; expecting no action`);
            }
        }
        // What must hold for this step.
        if (noneSettled && !expect.noAction) fail(label, 'no action settled');
        if (expect.noAction && facts.count !== before) fail(label, `an action ran: ${facts.action}`);
        if (expect.landedFirst && after.some((l) => l.includes(draft))) fail(label, 'her false claim is shown');
        if (expect.action && facts.action !== expect.action) fail(label, `${facts.action}, expected ${expect.action}`);
        if (expect.status && facts.status !== expect.status) fail(label, `${facts.status}, expected ${expect.status}`);
        if (expect.why && facts.why !== expect.why) fail(label, `refused for ${facts.why}, expected ${expect.why}`);
        if (expect.state && facts.outfitState !== expect.state)
            fail(label, `she is ${facts.outfitState}, expected ${expect.state}`);
        if (expect.correction && !facts.params.correction) fail(label, 'not read as a correction');
        if (expect.cancelled) {
            if (facts.earlierStatus !== 'cancelled')
                fail(label, `the change under way is ${facts.earlierStatus}, not cancelled`);
            if (facts.outfitState === 'lingerie') fail(label, 'the cancelled lingerie reached her');
        }
        if (expect.reason) {
            const reason = after.filter((l) => l.length > 40 && /\b(?:nuda|bare)\b/i.test(l));
            if (after.some((l) => l.includes(draft))) fail(label, 'her false claim is shown');
            if (reason.length !== 1) fail(label, `the no-bare-look reason is shown ${reason.length} times`);
        }
        if (after.some((l) => vague.some((v) => l.includes(v)))) fail(label, 'a vague line is shown');
        if (step.choices.some((c) => CHOICES.includes(c)))
            fail(label, `the draft's yes/wait chips under no offer: ${step.choices.join(' | ')}`);
        if (facts.level !== 4) fail(label, `the consent level moved to ${facts.level}`);
        previous = null;
    }
    report.timeline = await page.evaluate(() => ({
        turns: window.__turns,
        actions: window.NEXUS_PRIVATE_ACTIONS.log().map((a) => ({
            name: a.name,
            status: a.status,
            why: a.why || null,
            turnId: a.turnId,
            source: a.source,
            at: a.at || a.createdAt || null,
            settledAt: a.settledAt || null,
        })),
        levelEvents: (window.__levels || []).slice(),
    }));
    // UN21. A scripted line (one drawn with its text, not a reply placeholder filled later) is a
    // defect only inside the lull: less than 18 s after the person's last line or after an action
    // of theirs settled. After that it is the designed "the evening has gone quiet" line.
    {
        const LULL_MS = 18000;
        const turns = report.timeline.turns;
        const begun = turns.findIndex((t) => t.who === 'you');
        const marks = [
            ...turns.filter((t) => t.who === 'you').map((t) => t.at),
            ...report.timeline.actions.filter((a) => a.source !== 'model' && a.settledAt).map((a) => a.settledAt),
        ];
        report.scripted = [];
        for (const t of turns.slice(Math.max(0, begun))) {
            if (t.who !== 'her' || !t.text) continue;
            const before = marks.filter((m) => m <= t.at);
            const since = before.length ? t.at - Math.max(...before) : Infinity;
            report.scripted.push({ text: t.text, sinceActivityMs: since });
            if (since < LULL_MS)
                fail('timeline', `a scripted line ${Math.round(since / 1000)} s after activity: ${t.text}`);
        }
    }
    report.errors = errors;
    await ctx.close();
} finally {
    await browser.close();
    server.stop();
}
fs.writeFileSync(path.join(OUT, `${SCRIPT}-${SIZE}-${LANG}-report.json`), JSON.stringify(report, null, 1));
console.log(report.failures.length ? `FAIL\n- ${report.failures.join('\n- ')}` : 'PASS');
process.exit(report.failures.length ? 1 : 0);
