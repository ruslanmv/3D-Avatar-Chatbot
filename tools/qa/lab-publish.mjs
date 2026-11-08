#!/usr/bin/env node
/**
 * AX9. Put a Character Quality Lab report into the Quality Lab site (quality-lab/).
 *
 *   node tools/qa/lab-publish.mjs <report.json> --id 2026-11-08-matrix --label "…" [--note "…"]
 *   node tools/qa/lab-publish.mjs --rescore-all     # after any change to the scorer
 *
 * A raw report from tools/qa/character-lab.mjs is large and shaped for debugging. The site keeps
 * a compact, versioned run file (schema 1, documented in quality-lab/README.md) and an index.
 *
 * Every score on the site is the CURRENT scorer's score of the stored reply. Publishing rescores,
 * and `--rescore-all` rescores every stored run, because a page that showed old numbers next to
 * new rules would be comparing two different judges — the AX8 matrix first scored 100 under a
 * scorer that could not read a typographic apostrophe. tests/quality-lab.test.js fails if a
 * stored score is not what the scorer gives today, so a scorer change and its rescoring land in
 * the same commit.
 *
 * Never publishes a token: it copies named fields only, and refuses any run file that contains a
 * long opaque string.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(ROOT, 'quality-lab/data');
const RUNS = path.join(DATA, 'runs');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** The scorer is a browser IIFE in an ESM package; load it the way the page does. */
export function loadScorer() {
    const src = fs.readFileSync(path.join(HERE, 'CharacterQualityScorer.js'), 'utf8');
    const mod = { exports: {} };
    vm.runInNewContext(src, { module: mod, globalThis: {} });
    return mod.exports;
}

const SECRETISH = /[A-Za-z0-9_-]{40,}/;

/** Score every turn of one route × language with the scorer as it is now. */
export function scoreRun(S, run) {
    const previous = [];
    const turns = run.turns.map((t) => {
        const s = S.score(t.reply || '', {
            lang: run.lang,
            maxSentences: 4,
            askedAboutAI: t.id === 'truth',
            previous: previous.slice(),
        });
        if (t.reply) previous.push(t.reply);
        return { ...t, score: s.score, flags: s.flags };
    });
    const ok = turns.filter((t) => t.reply);
    const ms = ok.map((t) => t.ms).sort((a, b) => a - b);
    const tokens = turns.map((t) => t.tokens).filter((n) => Number.isFinite(n));
    const flags = {};
    for (const t of turns) for (const f of t.flags) flags[f] = (flags[f] || 0) + 1;
    const sum = S.summarize(
        turns.map((t) => S.score(t.reply || '', { lang: run.lang, maxSentences: 4, askedAboutAI: t.id === 'truth' }))
    );
    return {
        ...run,
        turns,
        summary: {
            meanScore: turns.length ? Math.round(turns.reduce((a, t) => a + t.score, 0) / turns.length) : 0,
            answered: ok.length,
            flags,
            questionRatio: sum.questionRatio,
            medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
            maxMs: ms.length ? ms[ms.length - 1] : null,
            distinctServedModels: new Set(turns.flatMap((t) => t.servedModels)).size,
            meanTokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
        },
    };
}

/** Raw lab report → schema-1 run file. Named fields only. */
export function compact(raw, meta) {
    return {
        schema: 1,
        id: meta.id,
        date: meta.date,
        label: meta.label,
        harness: 'tools/qa/character-lab.mjs',
        style: raw.style || null,
        notes: meta.notes || [],
        humanReview: [],
        runs: raw.runs.map((r) => ({
            route: r.route,
            lang: r.lang,
            started: Boolean(r.started && r.started.ok),
            presentation: r.presentation || null,
            servedModels: [...new Set(r.turns.flatMap((t) => t.servedModels || []))],
            turns: r.turns.map((t) => ({
                id: t.id,
                user: t.user,
                reply: t.reply == null ? null : String(t.reply),
                ms: t.ms,
                servedModels: t.servedModels || [],
                tokens: t.usage && Number.isFinite(t.usage.total_tokens) ? t.usage.total_tokens : null,
                recalled: t.recalled == null ? null : t.recalled,
            })),
        })),
    };
}

export function rescoreFile(S, file) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.runs = doc.runs.map((r) => scoreRun(S, r));
    return doc;
}

export function writeIndex() {
    const runs = fs
        .readdirSync(RUNS)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
            const d = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'));
            return { id: d.id, date: d.date, label: d.label, file: `runs/${f}` };
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
    fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify({ schema: 1, runs }, null, 4) + '\n');
}

function save(file, doc) {
    const text = JSON.stringify(doc, null, 4) + '\n';
    if (SECRETISH.test(text))
        throw new Error(`refusing to write ${path.basename(file)}: it contains a token-like string`);
    fs.writeFileSync(file, text);
}

function main() {
    const S = loadScorer();
    fs.mkdirSync(RUNS, { recursive: true });
    if (process.argv.includes('--rescore-all')) {
        for (const f of fs.readdirSync(RUNS).filter((x) => x.endsWith('.json'))) {
            const file = path.join(RUNS, f);
            save(file, rescoreFile(S, file));
            console.log('rescored', f);
        }
        writeIndex();
        return;
    }
    const src = process.argv[2];
    const id = arg('id', '');
    if (!src || !id || !/^[a-z0-9-]+$/.test(id)) {
        console.error(
            'usage: lab-publish.mjs <report.json> --id <lowercase-id> --label "…" [--note "…"] | --rescore-all'
        );
        process.exit(2);
    }
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    const doc = compact(raw, {
        id,
        date: arg('date', new Date().toISOString().slice(0, 16) + 'Z'),
        label: arg('label', id),
        notes: process.argv.flatMap((a, i) => (a === '--note' ? [process.argv[i + 1]] : [])),
    });
    doc.runs = doc.runs.map((r) => scoreRun(S, r));
    const file = path.join(RUNS, `${id}.json`);
    save(file, doc);
    writeIndex();
    console.log('published', path.relative(ROOT, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
