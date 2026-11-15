#!/usr/bin/env node
/**
 * UN16. A real Private evening with a real model: the person's words typed into the Private
 * composer, the configured provider answering, the wardrobe and the world doing what they do.
 *
 *   node tools/qa/una-notte-live-chat.mjs --ob-token-file <file> [--model grok-best] [--lang it-IT]
 *        [--forge http://127.0.0.1:8092] [--size desktop|phone] [--out <dir>]
 *
 * The token is an OllaBridge device-pairing token (POST /pair with the person's code); it is
 * read from a file and never written to the report. Every other audit drives the action bridge
 * directly and so says nothing about the model's language; this one records, per turn: what was
 * said, her reply, how long the reply took, every wardrobe action with its outcome and duration,
 * what the wardrobe reports she is wearing, and a screenshot. It flags a reply that claims a
 * change the app did not make (she says she took something off, and no wardrobe action
 * completed that turn) — a fixture cannot prove model quality, and this is the evidence instead.
 *
 * The report holds Private conversation and images: write it to an access-controlled folder
 * (the default is under audits/, which git ignores), never to the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const tokenFile = arg('--ob-token-file');
if (!tokenFile) {
    console.error('--ob-token-file is required (a file holding the OllaBridge pairing JSON or token)');
    process.exit(2);
}
const raw = fs.readFileSync(tokenFile, 'utf8').trim();
const token = raw.startsWith('{') ? JSON.parse(raw).token : raw;
const model = arg('--model', 'grok-best');
const lang = arg('--lang', 'it-IT');
const size = arg('--size', 'desktop');
const forge = arg('--forge', 'http://127.0.0.1:8092');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-live-${model}-${lang}`)));
fs.mkdirSync(out, { recursive: true, mode: 0o700 });

const IT = lang.startsWith('it');
// The journey: chat, a change of clothes, the person bringing the evening closer, undressing,
// the request from the reported session, dressing again, the end.
const TURNS = IT
    ? [
          ['chat', 'Ciao. Che posto è questo? Cosa ti porta qui stasera?'],
          ['chat', 'Mi piace come mi guardi. Raccontami di te.'],
          ['wear', 'Mettiti qualcosa di elegante per me'],
          ['closer', null],
          ['undress', 'Fammi vedere di più'],
          ['undress', 'Spogliati per me'],
          ['undress', 'Togliti le mutandine'],
          ['redress', 'Rivestiti'],
          ['chat', 'È stata una bella serata.'],
      ]
    : [
          ['chat', 'Hi. What is this place? What brings you here tonight?'],
          ['chat', 'I like the way you look at me. Tell me about yourself.'],
          ['wear', 'Put on something elegant for me'],
          ['closer', null],
          ['undress', 'Show me more'],
          ['undress', 'Undress for me'],
          ['undress', 'Take your panties off'],
          ['redress', 'Get dressed again'],
          ['chat', 'It was a lovely evening.'],
      ];
// Her words claiming a change of clothes. Checked against what the wardrobe did that turn.
const CLAIM =
    /\b(?:mi tolgo|me l[ae] tolgo|le tolgo|lo tolgo|tolgo|mi spoglio|mi sono spogliat|ti mostro di più|mi metto|indosso ora|ecco(?:mi)? (?:con|in)|I(?:'m| am) taking (?:off|it off)|I take (?:it|them) off|I(?:'ve| have) taken|slipping (?:off|out of|into)|I(?:'m| am) (?:now )?wearing|I put on)\b/i;

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
const report = { model, lang, size, forge, turns: [], errors: [], failures: [] };
try {
    const ctx = await browser.newContext(
        size === 'phone'
            ? { ...playwright.devices['Pixel 7'], deviceScaleFactor: 1 }
            : { viewport: { width: 1440, height: 900 } }
    );
    await ctx.addInitScript(
        ({ code, token, model, forge }) => {
            localStorage.setItem('app_lang', code);
            localStorage.setItem('nexus_together_enabled', 'on');
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
            localStorage.setItem('npc_enabled', 'false');
            localStorage.setItem('wardrobe_forge_mode', 'custom');
            localStorage.setItem('wardrobe_forge_url', forge);
            localStorage.setItem(
                'nexus_llm_settings',
                JSON.stringify({
                    provider: 'ollabridge',
                    ollabridge: { pair_token: token, auth_mode: 'pairing', model },
                })
            );
        },
        { code: lang, token, model, forge }
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.__NEXUS_COMPANION_LIVE,
        null,
        { timeout: 240000 }
    );
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const a = panel.activities.get('intimate');
        if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || { id: 'mature' };
        await panel.startActivity('intimate', opt);
    });
    await page.waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS?.snapshot().active, null, { timeout: 60000 });
    const herLines = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('.nexus-private-turn')].map((n) => ({
                who: n.dataset.privateTurn,
                streaming: n.classList.contains('is-streaming'),
                text: ((n.querySelector('.nexus-private-copy') || {}).textContent || '').trim(),
            }))
        );
    const settle = async (before, ms) => {
        const t0 = Date.now();
        // Her reply: a new turn of hers after the person's, finished streaming and not empty.
        while (Date.now() - t0 < ms) {
            const lines = await herLines();
            const last = lines[lines.length - 1];
            if (lines.length > before && last && last.who === 'her' && !last.streaming && last.text) break;
            await page.waitForTimeout(400);
        }
        const took = Date.now() - t0;
        await page.waitForTimeout(1200);
        return took;
    };
    const state = () =>
        page.evaluate(() => {
            const A = window.NEXUS_PRIVATE_ACTIONS;
            const snap = A.snapshot();
            return {
                wearing: snap.outfit && snap.outfit.wearing ? snap.outfit.name : 'her own outfit',
                outfitStatus: snap.outfit
                    ? `${snap.outfit.status}${snap.outfit.why ? '/' + snap.outfit.why : ''}`
                    : null,
                world: window.NEXUS_VIEWER.vrWorlds?.activeId || null,
                log: A.log()
                    .filter((a) => a.family === 'wardrobe')
                    .map((a) => ({
                        name: a.name,
                        status: a.status,
                        why: a.why,
                        result: a.result || null,
                        at: a.settledAt,
                    })),
            };
        });
    await settle(0, 60000); // her opening line
    let i = 0;
    for (const [kind, text] of TURNS) {
        i += 1;
        const before = await state();
        const t0 = Date.now();
        if (kind === 'closer') {
            for (let k = 0; k < 3; k += 1) {
                await page.waitForTimeout(4600);
                await page.click('[data-private-action="closer"]', { timeout: 5000 }).catch(() => null);
            }
            report.turns.push({ i, kind, text: '(Più vicino ×3)', ms: Date.now() - t0 });
            await page.waitForTimeout(2000);
            continue;
        }
        const count = (await herLines()).length;
        const input = page.locator('#speech-text, #chatInput').first();
        await input.fill(text);
        await input.press('Enter');
        const replyMs = await settle(count + 1, 90000);
        // A wardrobe change may still be loading after she answered: wait for it to end (UN15 bounds it).
        const w0 = Date.now();
        await page
            .waitForFunction(
                () => !['changing', 'creating'].includes(window.NEXUS_PRIVATE_ACTIONS.snapshot().outfit?.status),
                null,
                { timeout: 90000 }
            )
            .catch(() => null);
        const after = await state();
        const lines = await herLines();
        const reply = lines.length ? lines[lines.length - 1].text : '';
        const fresh = after.log.slice(before.log.length);
        const changed = fresh.some((a) => a.status === 'completed');
        const claims = CLAIM.test(reply);
        const turn = {
            i,
            kind,
            text,
            reply,
            replyMs,
            wardrobeMs: Date.now() - w0,
            actions: fresh,
            wearing: after.wearing,
            outfitStatus: after.outfitStatus,
            world: after.world,
            claimsChange: claims,
            claimMatchesRenderer: !claims || changed,
        };
        if (claims && !changed) report.failures.push(`turn ${i}: she claims a change of clothes the app did not make`);
        report.turns.push(turn);
        await page.screenshot({ path: path.join(out, `${String(i).padStart(2, '0')}-${kind}.png`) });
        console.log(
            `${i} ${kind} ${replyMs}ms → ${after.wearing} ${fresh.map((a) => `${a.name}:${a.status}${a.why ? '/' + a.why : ''}`).join(' ')}`
        );
    }
    await page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, '99-ended.png') });
    await ctx.close();
} catch (e) {
    report.crash = String(e && e.stack ? e.stack : e).slice(0, 1200);
    report.failures.push('crashed');
} finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1), { mode: 0o600 });
    console.log(`${out}: ${report.failures.length} failures, ${report.errors.length} page errors`);
    await browser.close();
    server.stop();
    process.exitCode = report.failures.length ? 1 : 0;
}
