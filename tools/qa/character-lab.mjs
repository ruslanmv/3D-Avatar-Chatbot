#!/usr/bin/env node
/**
 * AX8. Character Quality Lab — the real-provider half.
 *
 *   OLLABRIDGE_PAIR_TOKEN=… node tools/qa/character-lab.mjs --routes free-best,free-fast [--langs en,it]
 *       [--style sensual] [--base http://127.0.0.1:8080] [--out tmp/character-lab]
 *   node tools/qa/character-lab.mjs --token-file path/to/ob.json …   (a JSON file with { "token": … })
 *
 * The app must be running (`npm start`). The token is read from the environment or a file and is
 * never printed or written: the report holds routes, served models, replies and timings only.
 *
 * Why a real page and not a direct API call. What reaches the model is the product's whole prompt
 * — the persona, the language directive, Private's register, ceiling and length rule, care mode —
 * and it is assembled in the browser by the code that ships. Calling the provider with a prompt
 * written here would measure a prompt nobody uses. So Private is started through the Together
 * panel the way its tile starts it, each line goes through the real conversation surface, and the
 * provider's own responses are read off the network.
 *
 * What it records, and what it refuses to guess:
 *   - the route asked for (the `model` field the app sent) and the model the provider SAYS served
 *     the turn (the `model` field of its response). OllaBridge routes are aliases over several
 *     backends, so these differ and only the second describes the reply. When the response does
 *     not name one, the report says `null` — never the route name in its place.
 *   - latency from send to the finished reply, as the person would wait for it.
 *   - token usage when the provider reports it; `null` when it does not. Cost is not computed:
 *     the free routes publish no price, and a number made up here would be fabricated evidence.
 *   - the deterministic score of every reply (tools/qa/CharacterQualityScorer.js,
 *     injected into the page — the same file the unit tests require), plus one context check: the
 *     last line asks about something said three turns earlier, and the reply must mention it.
 *   - the embodied presentation (AX7) as the page reports it: the voice rate it applies, the face
 *     value the VRM really holds (`expressionManager.getValue('happy')`), whether the light
 *     applied — at start, after the person steps once, and after End.
 *
 * Fixtures are fixed and non-explicit, the same lines in English and Italian, so a run compares
 * models and nothing else. Warmth, wit and whether she sounds like someone are not scored here:
 * that is the human rubric in docs/qa/NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md.
 *
 * What is simulated: the person's own Private Mode confirmation (localStorage, as Settings writes
 * it) and the app language. No consent, gate or authorization code is touched.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:8080');
const OUT = arg('out', 'tmp/character-lab');
const ROUTES = arg('routes', 'free-best,free-fast').split(',').filter(Boolean);
const LANGS = arg('langs', 'en,it').split(',').filter(Boolean);
const STYLE = arg('style', 'sensual');
const OB_BASE = arg('ollabridge', 'https://app.ollabridge.com');

function readToken() {
    if (process.env.OLLABRIDGE_PAIR_TOKEN) return process.env.OLLABRIDGE_PAIR_TOKEN;
    const file = arg('token-file', '');
    if (file) return JSON.parse(fs.readFileSync(file, 'utf8')).token;
    return '';
}

/** The same scenarios in both languages. `recall` names what the context check looks for. */
export const SCENARIOS = {
    en: {
        app: 'en-US',
        lines: [
            { id: 'greeting', text: 'Hi, what a lovely evening.' },
            { id: 'open', text: 'Tell me what you like about tonight.' },
            { id: 'minimal', text: 'mm' },
            { id: 'day', text: 'I had a long day at work, the meeting ran late.' },
            { id: 'place', text: 'Describe where we are right now.' },
            { id: 'truth', text: 'Are you a real person or an AI?', askedAboutAI: true },
            { id: 'recall', text: 'What did I tell you about my day?', recall: /work|meeting|day/i },
        ],
    },
    it: {
        app: 'it-IT',
        lines: [
            { id: 'greeting', text: 'Ciao, che bella serata.' },
            { id: 'open', text: 'Raccontami cosa ti piace di questa sera.' },
            { id: 'minimal', text: 'mm' },
            { id: 'day', text: 'Ho avuto una lunga giornata al lavoro, la riunione è finita tardi.' },
            { id: 'place', text: 'Descrivimi dove siamo adesso.' },
            { id: 'truth', text: "Sei una persona vera o un'intelligenza artificiale?", askedAboutAI: true },
            { id: 'recall', text: 'Cosa ti ho detto della mia giornata?', recall: /lavor|riunion|giornat/i },
        ],
    },
};

/** Pure: pull the served model and usage out of a chat-completions body, JSON or SSE. */
export function readCompletion(body) {
    const out = { servedModel: null, usage: null };
    const take = (o) => {
        if (!o || typeof o !== 'object') return;
        if (typeof o.model === 'string' && o.model) out.servedModel = o.model;
        if (o.usage && typeof o.usage === 'object') out.usage = o.usage;
    };
    const text = String(body || '');
    if (/^\s*data:/m.test(text)) {
        for (const line of text.split('\n')) {
            const m = line.match(/^\s*data:\s*(\{.*\})\s*$/);
            if (!m) continue;
            try {
                take(JSON.parse(m[1]));
            } catch (_) {
                /* a partial line is not evidence */
            }
        }
    } else {
        try {
            take(JSON.parse(text));
        } catch (_) {
            /* not JSON: nothing recorded */
        }
    }
    return out;
}

async function presentationNow(p) {
    return p.evaluate(() => {
        const pres = window.NEXUS_PRIVATE_PRESENTATION;
        const st = pres ? pres.state() : null;
        const em = window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM?.expressionManager;
        let happy = null;
        try {
            happy = em && typeof em.getValue === 'function' ? em.getValue('happy') : null;
        } catch (_) {
            happy = null;
        }
        return {
            active: st ? st.active : null,
            level: window.NEXUS_BD?.adult?.level ?? null,
            rate: pres ? pres.adjustVoice({ rate: 1, pitch: 1 }).rate : null,
            intended: st && st.presentation ? st.presentation.expression : null,
            faceHappy: happy == null ? null : Math.round(happy * 1000) / 1000,
            applied: st ? st.applied : null,
        };
    });
}

async function runOne(browser, token, route, lang, scorerSrc) {
    const sc = SCENARIOS[lang];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(
        ({ token, route, app, ob }) => {
            localStorage.setItem('app_lang', app);
            localStorage.setItem('speech_lang', app);
            localStorage.setItem('nexus_together_enabled', 'on');
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
            localStorage.setItem(
                'nexus_llm_settings',
                JSON.stringify({
                    provider: 'ollabridge',
                    proxy: { enable_proxy: false, proxy_url: '/api/proxy' },
                    ollabridge: { base_url: ob, auth_mode: 'pairing', pair_token: token, api_key: '', model: route },
                })
            );
        },
        { token, route, app: sc.app, ob: OB_BASE }
    );
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    const calls = [];
    p.on('response', async (res) => {
        if (!/\/v1\/chat\/completions/.test(res.url())) return;
        const at = Date.now();
        let asked = null;
        try {
            asked = JSON.parse(res.request().postData() || '{}').model || null;
        } catch (_) {
            asked = null;
        }
        let body = '';
        try {
            body = await res.text();
        } catch (_) {
            body = '';
        }
        calls.push({ at, done: Date.now(), status: res.status(), asked, ...readCompletion(body) });
    });

    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.NEXUS_CONVERSATION_SURFACE,
        null,
        { timeout: 180000 }
    );
    await p.addScriptTag({ content: scorerSrc });
    await p.waitForTimeout(3000);
    const started = await p.evaluate(async (style) => {
        const panel = window.NEXUS_BD.togetherPanel;
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === style) || { id: style };
        const r = await panel.startActivity('intimate', opt);
        return r && typeof r === 'object' ? { ok: r.ok !== false, why: r.why || r.reason || null } : { ok: Boolean(r) };
    }, STYLE);
    await p.waitForTimeout(6000);
    const presentation = { start: await presentationNow(p) };

    await p.evaluate(() => {
        window.__turns = [];
        window.NEXUS_CONVERSATION_SURFACE.observe((e) => {
            if (e.type === 'assistant-end') window.__turns.push(String(e.text || ''));
        });
    });

    const turns = [];
    const previous = [];
    for (const line of sc.lines) {
        const before = await p.evaluate(() => window.__turns.length);
        const t0 = Date.now();
        await p.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.send(t), line.text);
        const ok = await p
            .waitForFunction((n) => window.__turns.length > n, before, { timeout: 120000 })
            .then(() => true)
            .catch(() => false);
        const ms = Date.now() - t0;
        await p.waitForTimeout(1500);
        const reply = await p.evaluate(() => window.__turns[window.__turns.length - 1] || '');
        const mine = calls.filter((c) => c.at >= t0 && c.at <= t0 + ms + 1500);
        const score = await p.evaluate(
            ({ reply, lang, askedAboutAI, previous }) =>
                window.NEXUS_CHARACTER_SCORER.score(reply, { lang, maxSentences: 4, askedAboutAI, previous }),
            { reply: ok ? reply : '', lang, askedAboutAI: line.askedAboutAI === true, previous: previous.slice() }
        );
        const recalled = line.recall ? line.recall.test(reply) : null;
        turns.push({
            id: line.id,
            user: line.text,
            ok,
            ms,
            reply: ok ? reply : null,
            servedModels: [...new Set(mine.map((c) => c.servedModel).filter(Boolean))],
            askedRoutes: [...new Set(mine.map((c) => c.asked).filter(Boolean))],
            calls: mine.length,
            usage: mine.map((c) => c.usage).find(Boolean) || null,
            score,
            recalled,
        });
        if (ok) previous.push(reply);
    }

    // AX7 in the running app: one step of the person's own, then End.
    await p.waitForTimeout(4500);
    await p.evaluate(() => window.NEXUS_BD.adult.initiated(Date.now()));
    await p.waitForTimeout(800);
    presentation.stepped = await presentationNow(p);
    await p.evaluate(() => {
        const a = window.NEXUS_BD.intimate;
        if (a && typeof a.stop === 'function') a.stop('user');
    });
    await p.waitForTimeout(1200);
    presentation.stopped = await presentationNow(p);

    await ctx.close();
    return { route, lang, style: STYLE, started, presentation, turns, errors };
}

async function main() {
    const token = readToken();
    if (!token) {
        console.error('No OllaBridge pairing token: set OLLABRIDGE_PAIR_TOKEN or pass --token-file.');
        process.exit(2);
    }
    const scorerSrc = fs.readFileSync(new URL('./CharacterQualityScorer.js', import.meta.url), 'utf8');
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const runs = [];
    for (const route of ROUTES)
        for (const lang of LANGS) {
            process.stdout.write(`${route} · ${lang} … `);
            const run = await runOne(browser, token, route, lang, scorerSrc);
            const scores = run.turns.map((t) => t.score);
            run.summary = {
                meanScore: scores.length ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0,
                answered: run.turns.filter((t) => t.ok).length,
                medianMs: [...run.turns.map((t) => t.ms)].sort((a, b) => a - b)[Math.floor(run.turns.length / 2)],
                flags: scores.reduce((acc, r) => {
                    for (const f of r.flags) acc[f] = (acc[f] || 0) + 1;
                    return acc;
                }, {}),
                questionRatio:
                    Math.round((scores.filter((r) => r.endsWithQuestion).length / (scores.length || 1)) * 100) / 100,
                recalled: run.turns.find((t) => t.id === 'recall')?.recalled ?? null,
                servedModels: [...new Set(run.turns.flatMap((t) => t.servedModels))],
            };
            runs.push(run);
            console.log(JSON.stringify(run.summary));
        }
    await browser.close();
    const file = path.join(OUT, `character-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    // The report never carries the token; scrub anything that looks like one anyway.
    fs.writeFileSync(
        file,
        JSON.stringify({ base: BASE, style: STYLE, runs }, null, 2).replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>')
    );
    console.log('report:', file);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    main().catch((e) => {
        console.error('LAB FAILED', String(e.message).replace(/[A-Za-z0-9_-]{30,}/g, '<r>'));
        process.exit(1);
    });
}
