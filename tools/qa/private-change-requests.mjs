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

const SAY = {
    'it-IT': [
        ['wear', 'Mettiti il prendisole giallo', 'Ecco, me lo metto per te.'],
        ['undress', 'poi togliete i vestiti', 'Va bene, li tolgo per te.'],
        ['all', 'Toglili tutti', 'Le tolgo tutte per te.'],
    ],
    'en-US': [
        ['wear', 'Put on the yellow sundress', "There, I'm putting it on for you."],
        ['undress', 'Take off your clothes', "Okay, I'm taking them off for you."],
        ['all', 'Take them all off', "I'm taking everything off for you."],
    ],
}[LANG];
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
        const el = await page.$('#nexus-private-conversation-row');
        const file = path.join(OUT, `${SIZE}-${LANG}-${label}.png`);
        if (el) await el.screenshot({ path: file }).catch(() => page.screenshot({ path: file }));
        else await page.screenshot({ path: file });
        return path.basename(file);
    };

    for (const [label, said, draft] of SAY) {
        draftFor = () => draft;
        const before = await page.evaluate(() => window.NEXUS_PRIVATE_ACTIONS.log().length);
        const shownBefore = (await herLines()).length;
        await page.fill('#speech-text', said);
        await page.click('#speak-btn');
        await page
            .waitForFunction(
                (n) => {
                    const log = window.NEXUS_PRIVATE_ACTIONS.log();
                    const w = log[log.length - 1];
                    return log.length > n && w && w.status !== 'pending';
                },
                before,
                { timeout: 120000 }
            )
            .catch(() => fail(label, 'no action settled'));
        await page
            .waitForFunction(
                (n) => document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy').length > n,
                shownBefore,
                { timeout: 60000 }
            )
            .catch(() => {});
        await page.waitForTimeout(2500);
        const facts = await page.evaluate(() => {
            const A = window.NEXUS_PRIVATE_ACTIONS;
            const last = A.log().slice(-1)[0] || {};
            return {
                action: last.name,
                status: last.status,
                why: last.why || null,
                params: last.params || {},
                outfitState: A.snapshot().outfitState,
                wearing: (A.snapshot().outfit && A.snapshot().outfit.name) || null,
                wearingPrivate: Boolean(window.NEXUS_WARDROBE?.service?.controller?.activeLook?.private),
                rendererUrl: String(window.NEXUS_VIEWER.avatarManager.currentUrl || '')
                    .split('?')[0]
                    .slice(-60),
            };
        });
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
    }
    // What must hold for the reported pair.
    const all = report.steps.find((s) => s.label === 'all');
    // The two vague lines of the report: the reply check's catch-all and the generic follow-up.
    const vague =
        LANG === 'it-IT'
            ? ['Per ora resto come sono.', 'Per ora resto così.']
            : ['For now I’m staying as I am.', 'I’m staying as I am, for now.'];
    if (!all || all.action !== 'wardrobe.undress') fail('all', `not a request to undress: ${all && all.action}`);
    if (all && all.why !== 'no-bare-look') fail('all', `refused for ${all.why}, expected no-bare-look`);
    for (const s of report.steps) {
        if (s.after.some((l) => vague.some((v) => l.includes(v)))) fail(s.label, 'a vague line is shown');
        if (s.choices.some((c) => CHOICES.includes(c)))
            fail(s.label, `the draft's yes/wait chips under no offer: ${s.choices.join(' | ')}`);
    }
    // A refusal: her false claim is not shown, and the reason is, exactly once.
    if (all) {
        const reason = all.after.filter((l) => l.length > 40 && /\b(?:nuda|bare)\b/i.test(l));
        if (all.after.some((l) => l.includes(all.modelDraft))) fail('all', 'her false claim is shown');
        if (reason.length !== 1) fail('all', `the no-bare-look reason is shown ${reason.length} times`);
    }
    report.errors = errors;
    await ctx.close();
} finally {
    await browser.close();
    server.stop();
}
fs.writeFileSync(path.join(OUT, `${SIZE}-${LANG}-report.json`), JSON.stringify(report, null, 1));
console.log(report.failures.length ? `FAIL\n- ${report.failures.join('\n- ')}` : 'PASS');
process.exit(report.failures.length ? 1 : 0);
