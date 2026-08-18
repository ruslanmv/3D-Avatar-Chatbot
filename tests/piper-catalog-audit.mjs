#!/usr/bin/env node
/**
 * Piper catalog audit — the machine-checkable half of the TTS language matrix.
 *
 * The matrix page (tests/tts-language-matrix.html) needs human ears to judge
 * whether a voice *sounds* right. Everything else is verifiable from primary
 * sources, and this script checks it on every run against:
 *
 *   1. the piper-tts-web runtime bundle  → does the voice ID exist at all, and
 *      what model path does it resolve to?
 *   2. each model's own .onnx.json config → num_speakers, language code
 *   3. rhasspy/piper-voices voices.json   → speaker_id_map (who is speaker 0?)
 *
 * Why speaker 0 matters: piper-tts-web hardcodes `const speakerId = 0`, so for
 * a multi-speaker model it ALWAYS synthesizes speaker 0 and the rest are
 * unreachable. A `gender` tag on such a model is a claim about speaker 0 only.
 *
 * Usage:  node tests/piper-catalog-audit.mjs [--offline]
 * Exit code 0 = catalog consistent, 1 = a defect was found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDN = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/piper-tts-web.js';
const MODELS = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
const META = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json';
const OFFLINE = process.argv.includes('--offline');

/** Languages the app offers in Settings (src/AppLanguage.js LANGS). */
const APP_LANGS = ['en-US', 'en-GB', 'es-ES', 'it-IT', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];
/** Languages Piper genuinely has no model for — steered to the built-in engine. */
const NO_PIPER = ['ja-JP', 'ko-KR'];

const fail = [];
const warn = [];
const note = (a, m) => a.push(m);

/* ---- 1. read the app's catalog ------------------------------------------ */
const src = fs.readFileSync(path.join(ROOT, 'src/tts/PiperWasmTTSProvider.js'), 'utf8');
const body = src.slice(src.indexOf('const PIPER_VOICES = ['), src.indexOf('\n    ];'));
const catalog = [];
for (const m of body.matchAll(/\{[^{}]*id:\s*'([^']+)'[^{}]*\}/g)) {
    const o = m[0];
    const g = (k) => (o.match(new RegExp(k + ":\\s*'([^']*)'")) || [])[1];
    catalog.push({
        id: m[1],
        name: g('name'),
        lang: g('lang'),
        gender: g('gender'),
        quality: g('quality'),
        speakers: Number((o.match(/speakers:\s*(\d+)/) || [])[1] || 1),
        multi: /multi:\s*true/.test(o),
    });
}
console.log(`catalog: ${catalog.length} voices across ${new Set(catalog.map((v) => v.lang)).size} languages`);

/* ---- 2. structural checks (always run, no network) ---------------------- */
const seen = new Set();
for (const v of catalog) {
    if (seen.has(v.id)) note(fail, `duplicate catalog entry: ${v.id}`);
    seen.add(v.id);
    if (!['female', 'male', 'unknown'].includes(v.gender)) note(fail, `${v.id}: bad gender '${v.gender}'`);
    if (!APP_LANGS.includes(v.lang)) note(fail, `${v.id}: lang '${v.lang}' is not offered in Settings`);
    if (v.multi !== v.speakers > 1) note(fail, `${v.id}: multi flag disagrees with speakers=${v.speakers}`);
}
for (const lang of APP_LANGS) {
    const pool = catalog.filter((v) => v.lang === lang);
    if (!pool.length && !NO_PIPER.includes(lang)) note(fail, `${lang}: no Piper voice, and not on the no-Piper list`);
    if (pool.length && NO_PIPER.includes(lang)) note(fail, `${lang}: on the no-Piper list but has voices`);
    for (const g of ['female', 'male']) {
        if (!pool.length) continue;
        const solo = pool.filter((v) => v.gender === g && !v.multi);
        if (!solo.length) note(warn, `${lang}: no single-speaker ${g} voice — "Prefer ${g}" falls back`);
    }
}

/* ---- 3. primary-source checks (network) --------------------------------- */
if (!OFFLINE) {
    const get = async (url) => {
        const r = await fetch(url, { redirect: 'follow' });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        return r.text();
    };
    const bundle = await get(CDN);
    const paths = {};
    for (const m of bundle.matchAll(
        /"([a-z]{2,3}_[A-Z]{2}-[A-Za-z_0-9]+-(?:x_low|low|medium|high))":\s*"([^"]+\.onnx)"/g
    ))
        paths[m[1]] = m[2];
    console.log(`runtime PATH_MAP: ${Object.keys(paths).length} voices`);

    // The library hardcodes speaker 0 — if that ever changes, the multi-speaker
    // reasoning in the catalog needs revisiting, so assert it.
    if (!/const speakerId = 0/.test(bundle))
        note(fail, 'piper-tts-web no longer hardcodes speakerId=0 — revisit multi-speaker gender tags');

    const meta = JSON.parse(await get(META));

    for (const v of catalog) {
        const p = paths[v.id];
        if (!p) {
            note(fail, `${v.id}: NOT in the runtime PATH_MAP — would 404 at playback`);
            continue;
        }
        const cfg = JSON.parse(await get(`${MODELS}/${p}.json`));
        // RUNTIME COMPATIBILITY. piper-tts-web phonemizes with its own bundled
        // (modern, 256-symbol) piper_phonemize and passes only espeak.voice —
        // the model's phoneme_id_map is never consulted. A piper 0.2.0 model
        // has a 130-symbol embedding table, so it receives out-of-range IDs,
        // ONNX throws, and the provider silently falls back to ENGLISH. Such a
        // voice looks fine in the dropdown and then speaks the wrong language,
        // so it must never be in the catalog.
        if (cfg.num_symbols !== 256)
            note(
                fail,
                `${v.id}: num_symbols=${cfg.num_symbols} (piper ${cfg.piper_version || '?'}) — ` +
                    `incompatible with the bundled phonemizer; it would throw and fall back to English`
            );
        if (cfg.num_speakers !== v.speakers)
            note(fail, `${v.id}: catalog says speakers=${v.speakers}, model says ${cfg.num_speakers}`);
        const modelLang = String(cfg.language?.code || '').replace('_', '-');
        if (modelLang.slice(0, 2) !== v.lang.slice(0, 2))
            note(fail, `${v.id}: catalog lang ${v.lang} vs model ${modelLang}`);
        // Who does the runtime actually play?
        const map = meta[v.id]?.speaker_id_map || {};
        const zero = Object.entries(map).find(([, i]) => i === 0);
        if (v.multi && zero) console.log(`  ${v.id}: plays speaker 0 = "${zero[0]}" (of ${cfg.num_speakers})`);
        // A named male/female speaker map must agree with the tag.
        if (zero && /^[MF]$/.test(zero[0])) {
            const real = zero[0] === 'F' ? 'female' : 'male';
            if (v.gender !== real) note(fail, `${v.id}: speaker 0 is ${real}, catalog says ${v.gender}`);
        }
    }
}

/* ---- 4. report ----------------------------------------------------------- */
for (const w of warn) console.log('⚠  ' + w);
for (const f of fail) console.log('✖  ' + f);
console.log(fail.length ? `\n${fail.length} DEFECT(S)` : `\nOK — catalog consistent (${warn.length} known gap(s))`);
process.exit(fail.length ? 1 : 0);
