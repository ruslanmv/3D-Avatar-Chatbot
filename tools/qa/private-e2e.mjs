#!/usr/bin/env node
/**
 * E2E1. A real Private evening, end to end: the real app, a real model (OllaBridge Cloud), the
 * real wardrobe (Forge, with a read grant), and real words — checked turn by turn.
 *
 *   OLLABRIDGE_TOKEN=… FORGE_GRANT=… NEXUS_LAB_BASE=http://127.0.0.1:8080 \
 *     node tools/qa/private-e2e.mjs [--lang it] [--room bright-hotel] [--persona gina] [--turns file.json]
 *
 * Secrets come from the environment only and are never written to the report, the console or a
 * file: OLLABRIDGE_TOKEN (a paired device token — or OLLABRIDGE_PAIR_CODE to pair first),
 * FORGE_GRANT (a Forge read grant). Optional: OLLABRIDGE_URL (default https://app.ollabridge.com),
 * OLLABRIDGE_MODEL (default grok-best), FORGE_URL (default the app's own Forge).
 *
 * What the unit tests cannot show and this does: what a real model says and does with the prompt
 * Private builds, through the real bridge. For each turn it sends the person's words through the
 * conversation surface (as the composer does), waits for her reply to finish, and records her
 * words, the action the bridge took (name, status, why), the lines of what she knows of her body
 * (PB2), and a frame of her. Each turn may expect: an action (`action`), words in her reply
 * (`says`), a line in her prompt (`told`); every reply is checked for leaked tags and silence.
 *
 * The evening: Intense (step 4 reached through the footer's own step control), in `--room`.
 * Output: audits/private-e2e/runs/<stamp>/{report.json, index.html, turn-NN.png} (gitignored —
 * the frames are of Private; never commit them). Exit 1 when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LANG = arg('--lang', 'it');
const ROOM = arg('--room', 'bright-hotel');
const PERSONA = arg('--persona', '');
const REPLY_TIMEOUT = Number(arg('--timeout', '120')) * 1000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/private-e2e/runs', stamp)));

const OB_URL = (process.env.OLLABRIDGE_URL || 'https://app.ollabridge.com').replace(/\/$/, '');
const OB_MODEL = process.env.OLLABRIDGE_MODEL || 'grok-best';
const FORGE_URL = process.env.FORGE_URL || '';

/**
 * The default conversation (Italian): the turns a real evening is made of, and what each must do.
 * `action` is a regex on the bridge's last action name this turn; `says` / `told` regexes on her
 * reply / her prompt. Only what the app guarantees is checked — a model's wording is free.
 */
const DEFAULT_TURNS = [
    { say: 'Ciao amore, come stai stasera?' },
    { say: 'Cosa puoi mostrare?', told: /Your body can show tonight|What they are asking about/ },
    { say: 'Mettiti in ginocchio per me', action: /^avatar\.pose$/ },
    { say: 'Spogliati, voglio vederti', action: /^wardrobe\.undress$/ },
    { say: 'Mettiti a quattro zampe', action: /^avatar\.pose$/ },
    { say: 'Voglio un piercing nella tua vagina', told: /piercings, tattoos and marks are part of a bare look/ },
    { say: 'Muoviti per me, piano', action: /^avatar\.move$/ },
    { say: 'Fammi un ballo sul tavolo', action: /^avatar\.routine$/ },
    { say: 'Basta, fermati', action: /^avatar\.routine$|^avatar\.move$|^$/ },
];
const LEAKED_TAG = /<\s*\/?\s*(play|pose|go|gesture|wardrobe|action|tag)\b|\[(smile|laugh|sigh)\]/i;

async function main() {
    const token = await deviceToken();
    if (!token) throw new Error('set OLLABRIDGE_TOKEN (or OLLABRIDGE_PAIR_CODE) in the environment');
    // E2E2. One direct call to the model before anything else. Twice on 2026-11-19 a whole run
    // (ten minutes, nine turns) "failed" on every turn because grok-best answered HTTP 402 (the
    // provider's credits ran out) and the app filled each silence with its own English lines,
    // which looked like a bad model. A model that cannot answer now stops the run in a second,
    // with the provider's own reason. `--skip-preflight` runs anyway (to test the fallbacks).
    if (!process.argv.includes('--skip-preflight')) await preflight(token);
    const grant = process.env.FORGE_GRANT || '';
    const turns = arg('--turns', '') ? JSON.parse(fs.readFileSync(arg('--turns'), 'utf8')) : DEFAULT_TURNS;
    fs.mkdirSync(out, { recursive: true });

    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = require('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const report = {
        lang: LANG,
        room: ROOM,
        persona: PERSONA || null,
        model: OB_MODEL,
        forge: Boolean(grant),
        turns: [],
        failures: [],
        errors: [],
    };
    try {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
        // The device's settings, as the person would have saved them in Settings — in this test's
        // browser only. The secrets go no further than this page's localStorage.
        await ctx.addInitScript(
            ({ lang, token, grant, obUrl, model, forgeUrl }) => {
                localStorage.setItem('app_lang', lang);
                localStorage.setItem('nexus_together_enabled', 'on');
                localStorage.setItem('nexus_spicy_enabled', 'true');
                localStorage.setItem('nexus_spicy_verified', 'true');
                localStorage.setItem('npc_enabled', 'false');
                localStorage.setItem(
                    'nexus_llm_settings',
                    JSON.stringify({
                        provider: 'ollabridge',
                        ollabridge: { base_url: obUrl, pair_token: token, auth_mode: 'pairing', model, api_key: '' },
                    })
                );
                if (grant) localStorage.setItem('wardrobe_forge_grant', grant);
                if (forgeUrl) {
                    localStorage.setItem('wardrobe_forge_mode', 'custom');
                    localStorage.setItem('wardrobe_forge_url', forgeUrl);
                }
            },
            { lang: LANG, token, grant, obUrl: OB_URL, model: OB_MODEL, forgeUrl: FORGE_URL }
        );
        const page = await ctx.newPage();
        page.setDefaultTimeout(240000);
        page.on('pageerror', (e) => report.errors.push(String(e.message || e).slice(0, 240)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
                window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
                window.NEXUS_CONVERSATION_SURFACE,
            null,
            { timeout: 240000 }
        );
        await page.waitForTimeout(2500);

        // Into Private: Intense, in the room, with the persona if one was asked for.
        const started = await page.evaluate(
            async ({ room, persona }) => {
                const panel = window.NEXUS_BD.togetherPanel;
                const a = panel.activities.get('intimate');
                if (a.chooseMood) a.chooseMood({ id: 'mature' });
                if (persona && a.setAtmosphere) a.setAtmosphere({ persona });
                if (room && a.setAtmosphere) a.setAtmosphere({ world: room });
                const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || {
                    id: 'mature',
                };
                const r = await panel.startActivity('intimate', opt);
                return { ok: !!(r && r.ok), why: r && r.why };
            },
            { room: ROOM, persona: PERSONA }
        );
        if (!started.ok) throw new Error(`Private did not start: ${started.why}`);
        await waitForReplyIdle(page);

        // Step the pace up to the top through the footer's own control (one step per press, the
        // flow's own minimum spacing between presses).
        for (let i = 0; i < 4; i += 1) {
            const level = await page.evaluate(() => {
                const s = window.NEXUS_BD.togetherPanel.activities.get('intimate')._privateExperience;
                if (s && typeof s._advanceIntensity === 'function') s._advanceIntensity();
                return window.NEXUS_BD.adult.level;
            });
            if (level >= 4) break;
            await page.waitForTimeout(4500);
        }
        report.level = await page.evaluate(() => window.NEXUS_BD.adult.level);

        for (let i = 0; i < turns.length; i += 1) {
            const t = turns[i];
            const herBefore = await page.evaluate(() => document.querySelectorAll('.nexus-private-turn.is-her').length);
            const logBefore = await page.evaluate(() => window.NEXUS_PRIVATE_ACTIONS.log().length);
            await page.evaluate((text) => window.NEXUS_CONVERSATION_SURFACE.send(text), t.say);
            const done = await waitForReply(page, herBefore);
            const got = await page.evaluate((logBefore) => {
                const A = window.NEXUS_PRIVATE_ACTIONS;
                const snap = A.snapshot();
                const her = [...document.querySelectorAll('.nexus-private-turn.is-her .nexus-private-copy')];
                const lines = A.promptLines();
                const actions = A.log()
                    .slice(logBefore)
                    .map((a) => ({ name: a.name, status: a.status, why: a.why || null, source: a.source }));
                return {
                    reply: her.length ? her[her.length - 1].textContent.trim() : '',
                    actions,
                    last: snap.last
                        ? { name: snap.last.name, status: snap.last.status, why: snap.last.why || null }
                        : null,
                    body: lines.filter((l) => /Your body can show tonight|What they are asking about/.test(l)),
                    level: window.NEXUS_BD.adult.level,
                };
            }, logBefore);
            const file = `turn-${String(i + 1).padStart(2, '0')}.png`;
            const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
            await canvas.screenshot({ path: path.join(out, file) }).catch(() => {});

            const checks = [];
            const check = (ok, what) => {
                checks.push({ ok, what });
                if (!ok) report.failures.push(`turn ${i + 1} (“${t.say}”): ${what}`);
            };
            check(done, 'she answered within the time limit');
            check(got.reply.length > 0, 'her reply is not empty');
            check(!LEAKED_TAG.test(got.reply), 'no tag or stage direction leaked into her words');
            if (t.action) {
                const names = got.actions.map((a) => a.name).join(' ');
                check(
                    got.actions.some((a) => toRe(t.action).test(a.name)) || toRe(t.action).test(''),
                    `the bridge acted: ${t.action} (got: ${names || 'nothing'})`
                );
            }
            if (t.says) check(toRe(t.says).test(got.reply), `her words match ${t.says}`);
            if (t.told)
                check(
                    got.body.some((l) => toRe(t.told).test(l)),
                    `she was told ${t.told}`
                );
            report.turns.push({ n: i + 1, say: t.say, ...got, file, checks });
            console.log(
                `${i + 1}. ${t.say}\n   → ${got.reply.slice(0, 160)}\n   actions: ${got.actions.map((a) => `${a.name}:${a.status}${a.why ? `(${a.why})` : ''}`).join(', ') || '—'}  ${checks.every((c) => c.ok) ? 'OK' : 'FAIL'}`
            );
        }
    } finally {
        await browser.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(out, 'index.html'), sheet(report));
    console.log(
        `\n${report.turns.length} turns, ${report.failures.length} failed → ${path.relative(ROOT, out)}/index.html`
    );
    for (const f of report.failures) console.log(`  ✗ ${f}`);
    process.exit(report.failures.length ? 1 : 0);
}

function toRe(x) {
    return x instanceof RegExp ? x : new RegExp(String(x), 'i');
}

/** E2E2. The model answers a one-line request through OllaBridge, or the run stops with why. */
async function preflight(token) {
    const started = Date.now();
    let res;
    try {
        res = await fetch(`${OB_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                model: OB_MODEL,
                messages: [{ role: 'user', content: 'Reply with one short word.' }],
                max_tokens: 16,
            }),
            signal: AbortSignal.timeout(90000),
        });
    } catch (e) {
        throw new Error(`preflight: ${OB_URL} did not answer (${e.message}); nothing was run`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const why = (body.detail && (body.detail.message || body.detail.error)) || body.error || '';
        throw new Error(
            `preflight: model ${OB_MODEL} answered HTTP ${res.status} ${String(why).slice(0, 240)} — ` +
                'pick another with OLLABRIDGE_MODEL (GET /v1/models lists them); nothing was run'
        );
    }
    const served = body.model || OB_MODEL;
    console.log(`preflight: ${OB_MODEL} → ${served} answered in ${Date.now() - started} ms`);
}

/** A device token: the environment's, or one paired now from a pairing code (kept in memory). */
async function deviceToken() {
    if (process.env.OLLABRIDGE_TOKEN) return process.env.OLLABRIDGE_TOKEN;
    const code = String(process.env.OLLABRIDGE_PAIR_CODE || '')
        .replace(/[-\s]/g, '')
        .toUpperCase();
    if (!code) return '';
    const res = await fetch(`${OB_URL}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, label: '3d-avatar-e2e' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(`pairing failed: ${res.status} ${body.error || ''}`);
    return body.token;
}

async function waitForReplyIdle(page) {
    await page
        .waitForFunction(() => window.NEXUS_CONVERSATION_SURFACE.turn().phase === 'idle', null, { timeout: 30000 })
        .catch(() => {});
}

/** Her new reply has arrived and finished streaming. */
async function waitForReply(page, herBefore) {
    try {
        await page.waitForFunction(
            (n) =>
                document.querySelectorAll('.nexus-private-turn.is-her').length > n &&
                !document.querySelector('.nexus-private-turn.is-streaming') &&
                window.NEXUS_CONVERSATION_SURFACE.turn().phase === 'idle',
            herBefore,
            { timeout: REPLY_TIMEOUT, polling: 500 }
        );
        await page.waitForTimeout(1500); // the bridge acts on the finished reply
        return true;
    } catch (_) {
        return false;
    }
}

function esc(s) {
    return String(s == null ? '' : s).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
}

function sheet(r) {
    const card = (t) => {
        const ok = t.checks.every((c) => c.ok);
        return `<figure class="${ok ? 'ok' : 'bad'}"><img src="${esc(t.file)}" loading=lazy><figcaption>
<p class=you>TU: ${esc(t.say)}</p><p class=her>LEI: ${esc(t.reply)}</p>
<p class=meta>actions: ${esc(t.actions.map((a) => `${a.name} ${a.status}${a.why ? ` (${a.why})` : ''}`).join(', ') || '—')}</p>
${t.body.map((l) => `<p class=meta>${esc(l)}</p>`).join('')}
<ul>${t.checks.map((c) => `<li class=${c.ok ? 'ok' : 'bad'}>${c.ok ? '✓' : '✗'} ${esc(c.what)}</li>`).join('')}</ul></figcaption></figure>`;
    };
    return `<!doctype html><meta charset=utf-8><title>Private end to end</title>
<style>body{font:14px system-ui;background:#141218;color:#eee;margin:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}
figure{margin:0;background:#201e24;border-radius:10px;overflow:hidden;border:2px solid transparent}figure.bad{border-color:#ff7a7a}img{width:100%;display:block}
figcaption{padding:10px}.you{color:#9fd8ea}.her{color:#f6b9cd}.meta{color:#a9a1a8;font-size:12px}li.ok{color:#7fd07f}li.bad{color:#ff7a7a}ul{padding-left:16px;margin:6px 0 0}</style>
<h1>Private end to end · ${esc(r.lang)} · ${esc(r.room)}${r.persona ? ' · ' + esc(r.persona) : ''} · model ${esc(r.model)} · step ${esc(r.level)}</h1>
<p>${r.turns.length} turns · ${r.failures.length} failed${r.errors.length ? ` · ${r.errors.length} page errors` : ''} · Forge grant: ${r.forge ? 'yes' : 'no'}</p>
<div class=grid>${r.turns.map(card).join('')}</div>`;
}

main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(2);
});
