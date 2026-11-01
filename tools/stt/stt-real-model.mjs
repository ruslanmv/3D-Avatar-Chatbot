#!/usr/bin/env node
/**
 * stt-real-model.mjs — ST7. On-device Whisper, for real, without a headset.
 *
 * Not a mock: this downloads the pinned Whisper model and runs it in headless Chromium, through
 * the same modules the app uses (src/stt/, workers/whisper-worker.js). Three phases:
 *
 *   1. speech   Spoken test phrases are synthesized IN THE BROWSER with the app's own Piper
 *               (the pinned piper-tts-web the app speaks with) — English and Italian — and
 *               saved as WAV to tmp/stt/. Nothing is committed: the audio is made each run.
 *   2. model    Each phrase, plus silence and noise, goes through NEXUS_STT.transcribeSamples
 *               (gate → worker → judgeTranscript). Speech must come back as its words; silence
 *               and noise must come back as nothing. Timings and real-time factor are printed.
 *   3. capture  Chromium is relaunched with a fake microphone that plays the English WAV, the
 *               app is opened with on-device recognition chosen, and the real mic button is
 *               pressed: MicrophoneSession → AudioWorklet → endpointer → worker → the input field.
 *               The same for VR push-to-talk through SpeechService (hold, then release).
 *
 * What it is not: a Quest. It measures this machine's CPU, not the XR2 Gen 2, and Chromium's
 * fake microphone, not the headset's. Run stt-check.html on the headset for those numbers
 * (docs/QUEST_STT.md has the procedure).
 *
 * Usage:
 *   node tools/stt/stt-real-model.mjs                # all phases, starts the local server
 *   npm run stt:real-model
 *   node tools/stt/stt-real-model.mjs --only model --model base
 * Options: --url <url>, --port <n> (8099), --only speech,model,capture, --model tiny|base|small.
 * Needs Playwright with Chromium and network access to jsDelivr and Hugging Face. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tmp/stt');
const PIPER_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/piper-tts-web.js';

const PHRASES = [
    { id: 'en', lang: 'en', voice: 'en_US-hfc_female-medium', text: 'What is the weather like in Rome today?' },
    {
        id: 'en-long',
        lang: 'en',
        voice: 'en_US-ryan-medium',
        text: 'Please tell me a short story about a cat who lives on a boat.',
    },
    { id: 'it', lang: 'it', voice: 'it_IT-paola-medium', text: 'Ciao, come stai oggi? Raccontami una storia.' },
    {
        id: 'it-long',
        lang: 'it',
        voice: 'it_IT-paola-medium',
        text: 'Vorrei sapere che tempo farà domani a Milano, e se devo portare un ombrello.',
    },
];

// The accuracy each model must reach on these phrases (word error rate). English is gated: Tiny
// and Base transcribe both English phrases exactly (measured 2026-10-31). Italian is REPORTED,
// not gated (null): on Piper's synthetic Italian voice Tiny scored 29–57% and Base 14–36%
// from run to run ("Molano" for "Milano", "a gui" for "oggi") — usable, not promisable. Gate
// it once a recorded human Italian fixture exists. Tighten these; never loosen one to pass.
const MAX_WER = {
    tiny: { en: 0.25, it: null },
    base: { en: 0.25, it: null },
    small: { en: 0.2, it: null },
    // ST17. Auto = Moonshine Tiny for English (gated like Whisper), Whisper Tiny for Italian.
    auto: { en: 0.25, it: null },
    'moonshine-tiny': { en: 0.25, it: null },
};

function parseArgs(argv) {
    const o = { port: 8099, only: ['speech', 'model', 'capture', 'perf'], model: 'tiny' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--url') o.url = next();
        else if (a === '--port') o.port = Number(next());
        else if (a === '--only') o.only = next().split(',');
        else if (a === '--model') o.model = next();
        else {
            console.error(`Unknown option: ${a}`);
            process.exit(2);
        }
    }
    return o;
}

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        try {
            return createRequire(import.meta.url)('playwright');
        } catch {
            console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
            process.exit(2);
        }
    }
}

async function startServer(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'nexus-proxy/server.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`${url}/index.html`)).ok) return { url, stop: () => child.kill() };
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    child.kill();
    throw new Error(`The local server did not start on port ${port}.`);
}

/** Words, lower-cased, without punctuation — for comparing what was said with what was heard. */
function words(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/** Word error rate (Levenshtein over words). */
function wer(ref, hyp) {
    const r = words(ref);
    const h = words(hyp);
    const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
    for (let j = 1; j <= h.length; j++) d[0][j] = j;
    for (let i = 1; i <= r.length; i++) {
        for (let j = 1; j <= h.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
        }
    }
    return r.length ? d[r.length][h.length] / r.length : h.length ? 1 : 0;
}

const FIXTURE_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"onnxruntime-web":"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js"}}</script>
</head><body>speech fixtures</body></html>`;

async function phaseSpeech(browser, base) {
    const page = await browser.newPage();
    await page.route('**/__stt_fixture.html', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_PAGE })
    );
    await page.goto(`${base}/__stt_fixture.html`);
    fs.mkdirSync(OUT, { recursive: true });
    for (const p of PHRASES) {
        const b64 = await page.evaluate(
            async ({ url, voice, text }) => {
                const piper = await import(url);
                const blob = await piper.predict({ voiceId: voice, text });
                const bytes = new Uint8Array(await blob.arrayBuffer());
                let s = '';
                for (let i = 0; i < bytes.length; i += 0x8000)
                    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                return btoa(s);
            },
            { url: PIPER_URL, voice: p.voice, text: p.text }
        );
        const file = path.join(OUT, `${p.id}.wav`);
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        console.log(`   ✔ synthesized ${p.id} (${p.voice}) → ${path.relative(ROOT, file)}`);
    }
    await page.close();
    return true;
}

async function phaseModel(browser, base, o) {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.addInitScript((size) => {
        localStorage.setItem('stt_config', JSON.stringify({ provider: 'wasm', wasm: { modelSize: size } }));
    }, o.model);
    await page.goto(`${base}/stt-check.html`);
    const t0 = Date.now();
    const info = await page.evaluate(() => window.NEXUS_STT.preload());
    console.log(`   ✔ model ${o.model} ready in ${Date.now() - t0} ms (worker reported ${info.ms} ms)`);
    let ok = true;
    const cases = PHRASES.map((p) => ({
        ...p,
        wav: fs.readFileSync(path.join(OUT, `${p.id}.wav`)).toString('base64'),
    }));
    cases.push({ id: 'silence', lang: 'en', synthetic: 'silence' }, { id: 'noise', lang: 'en', synthetic: 'noise' });
    for (const c of cases) {
        const r = await page.evaluate(async (c) => {
            let samples;
            let rate;
            if (c.wav) {
                const bytes = Uint8Array.from(atob(c.wav), (ch) => ch.charCodeAt(0));
                const ctx = new OfflineAudioContext(1, 1, 48000);
                const buf = await ctx.decodeAudioData(bytes.buffer);
                samples = buf.getChannelData(0);
                rate = buf.sampleRate;
            } else {
                rate = 48000;
                samples = new Float32Array(rate * 3);
                if (c.synthetic === 'noise')
                    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.02;
            }
            return window.NEXUS_STT.transcribeSamples(samples, rate, { language: c.lang });
        }, c);
        if (c.text) {
            const e = r.accept ? wer(c.text, r.text) : 1;
            const max = (MAX_WER[o.model] || MAX_WER.tiny)[c.lang];
            const gated = max != null;
            const pass = !gated || (r.accept && e <= max);
            ok = ok && pass;
            console.log(
                `   ${!gated ? 'ℹ' : pass ? '✔' : '✖'} ${c.id}: "${r.text || r.reason}" — WER ${(e * 100).toFixed(0)}%` +
                    `${gated ? ` (max ${max * 100}%)` : ' (reported, not gated)'}, ` +
                    `${r.ms} ms for ${r.audioMs} ms (RTF ${(r.ms / r.audioMs).toFixed(2)})`
            );
        } else {
            const pass = !r.accept;
            ok = ok && pass;
            console.log(
                `   ${pass ? '✔' : '✖'} ${c.id}: ${r.accept ? `ACCEPTED "${r.text}"` : `refused (${r.reason})`}`
            );
        }
    }
    await page.close();
    if (!ok) console.log(logs.slice(-15).join('\n'));
    return ok;
}

async function phaseCapture(chromium, base, o) {
    const wav = path.join(OUT, 'en.wav');
    // The fake microphone loops its file. Pad it with silence so the endpointer sees a pause.
    const padded = path.join(OUT, 'en-mic.wav');
    padWav(wav, padded, 2.0);
    const browser = await chromium.launch({
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${padded}`,
            '--autoplay-policy=no-user-gesture-required',
        ],
    });
    let ok = true;
    try {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        await ctx.addInitScript((size) => {
            localStorage.setItem('stt_config', JSON.stringify({ provider: 'wasm', wasm: { modelSize: size } }));
        }, o.model);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.NEXUS_STT && window.SpeechService, null, { timeout: 120000 });
        await page.evaluate(() => window.NEXUS_STT.preload());

        // The 2D mic button: one press, it stops by itself after the sentence.
        await page.evaluate(() => {
            const input = document.getElementById('speech-text');
            if (input) input.value = '';
            window.__sent = [];
            const orig = window.handleUserMessage;
            window.handleUserMessage = (t) => window.__sent.push(t);
            window.__restoreSend = () => (window.handleUserMessage = orig);
        });
        await page.evaluate(() => document.getElementById('listen-btn').click());
        await page.waitForFunction(
            () => (document.getElementById('speech-text')?.value || '').length > 5 || window.__sent.length,
            null,
            { timeout: 60000 }
        );
        const heard = await page.evaluate(() => document.getElementById('speech-text').value || window.__sent[0]);
        const e = wer(PHRASES[0].text, heard);
        const pass1 = e <= 0.34; // the fake mic may start mid-phrase: allow a missing word or two
        ok = ok && pass1;
        console.log(`   ${pass1 ? '✔' : '✖'} mic button → input: "${heard}" (WER ${(e * 100).toFixed(0)}%)`);

        // VR push-to-talk through SpeechService: hold for 4 s, release, get one result.
        const vr = await page.evaluate(async () => {
            const s = window.SpeechService;
            const got = [];
            let transcribing = false;
            await s.startRecognition({
                holdToTalk: true,
                onResult: (t, c) => got.push({ t, c }),
                onTranscribing: () => (transcribing = true),
            });
            await new Promise((r) => setTimeout(r, 4500));
            s.stopRecognition();
            const t0 = Date.now();
            while (!got.length && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
            await new Promise((r) => setTimeout(r, 500));
            return { got, transcribing };
        });
        const pass2 = vr.got.length === 1 && vr.transcribing && vr.got[0].c == null;
        ok = ok && pass2;
        console.log(
            `   ${pass2 ? '✔' : '✖'} VR push-to-talk → one result, "Transcribing…" shown, no fake confidence: ` +
                JSON.stringify(vr.got.map((g) => g.t))
        );

        // Push-to-talk released before the microphone opened: nothing is recorded, nothing sent.
        const early = await page.evaluate(async () => {
            const s = window.SpeechService;
            const got = [];
            const p = s.startRecognition({ holdToTalk: true, onResult: (t) => got.push(t) });
            s.stopRecognition();
            await p;
            await new Promise((r) => setTimeout(r, 1500));
            return { got, recognizing: s.isRecognizing, owner: window.NEXUS_MIC_SESSION.get().owner() };
        });
        const pass3 = early.got.length === 0 && !early.recognizing && early.owner === null;
        ok = ok && pass3;
        console.log(`   ${pass3 ? '✔' : '✖'} released before the mic opened: no recording left running`);
        if (errors.length) {
            ok = false;
            console.log(`   ✖ page errors: ${errors.slice(0, 3).join(' | ')}`);
        }
    } finally {
        await browser.close();
    }
    return ok;
}

/** Copy a 16-bit PCM WAV and append `seconds` of silence (Piper writes plain PCM WAVs). */
/**
 * ST10–ST15. The performance diagnostics, end to end with the real model: the Settings test shows
 * a measured stop → transcript with its stages and a report that holds no audio or transcript;
 * the app's own mic button files a "real" run that Settings shows; stt-check's benchmark runs three
 * warm transcriptions without opening the microphone again. Prints the measured numbers — this
 * machine's CPU, not a Quest.
 */
async function phasePerf(chromium, base, o) {
    const wav = path.join(OUT, 'en-mic.wav');
    if (!fs.existsSync(wav)) padWav(path.join(OUT, 'en.wav'), wav, 2.0);
    const browser = await chromium.launch({
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${wav}`,
        ],
    });
    let ok = true;
    const check = (pass, what) => {
        ok = ok && pass;
        console.log(`   ${pass ? '✔' : '✖'} ${what}`);
    };
    try {
        const ctx = await browser.newContext({ permissions: ['microphone'] });
        await ctx.addInitScript((size) => {
            localStorage.setItem('stt_config', JSON.stringify({ provider: 'wasm', wasm: { modelSize: size } }));
        }, o.model);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.NEXUS_STT_PERF && document.getElementById('stt-mic-test'), null, {
            timeout: 120000,
        });
        await page.evaluate(() => {
            const s = document.getElementById('stt-provider');
            s.value = 'wasm';
            s.dispatchEvent(new Event('change'));
            return window.NEXUS_STT.preload();
        });
        // Settings test: 3 s of the fake mic, Stop, wait for the verdict.
        await page.evaluate(() => document.querySelector('#stt-mic-test button').click());
        await page.waitForTimeout(3500);
        await page.evaluate(() => document.querySelector('#stt-mic-test button').click());
        await page.waitForFunction(() => !document.querySelector('#stt-mic-test .stt-perf').hidden, null, {
            timeout: 90000,
        });
        const settings = await page.evaluate(async () => {
            const r = window.NEXUS_STT_PERF.last((x) => x.surface === 'settings-mic-test');
            const rep = window.NEXUS_STT_REPORT.build(r, await window.NEXUS_STT_DIAGNOSTICS.environment(window), {
                transcript: document.querySelector('#stt-mic-test .stt-heard').textContent,
            });
            return {
                line: document.querySelector('#stt-mic-test .stt-perf-line').textContent,
                rows: document.querySelectorAll('#stt-mic-test .stt-perf table tr').length,
                status: r.status,
                m: r.metrics,
                marks: r.marks,
                bottleneck: r.diagnosis.likely_bottleneck,
                report: rep,
            };
        });
        console.log(`   · Settings test: ${settings.line}`);
        console.log(
            `     stop→text ${settings.m.sttMs} ms · inference ${settings.m.inferenceMs} ms · queue ${settings.m.workerQueueMs} ms · ` +
                `messaging ${settings.m.messagingMs} ms · audio ${settings.m.recordedAudioMs} ms · RTF ${settings.m.realTimeFactor} · ` +
                `tokens ${settings.m.outputTokens} · mic ${settings.m.micAcquisitionMs} ms · bottleneck ${settings.bottleneck}`
        );
        check(
            settings.m.sttMs > 0 && settings.m.inferenceMs > 0,
            'Settings test measured stop → transcript and inference'
        );
        check(
            settings.marks.recording_stopped - settings.marks.microphone_capture_started >= 3000 &&
                settings.m.sttMs <= settings.marks.test_completed - settings.marks.recording_stopped,
            'the 3 s spent speaking is not part of stop → transcript'
        );
        check(settings.rows >= 5, `performance details listed (${settings.rows} rows)`);
        const text = JSON.stringify(settings.report);
        check(
            settings.report.schema_version === 1 &&
                !/weather like in Rome/i.test(text) &&
                !('transcript' in settings.report.stt),
            'report: schema 1, no transcript text'
        );
        // The app's own mic button, then Settings shows it as the last real use.
        await page.evaluate(() => {
            window.handleUserMessage = () => {};
            document.getElementById('listen-btn').click();
        });
        await page.waitForFunction(() => window.NEXUS_STT_PERF.last((x) => x.surface === 'mic-button'), null, {
            timeout: 60000,
        });
        const real = await page.evaluate(() => ({
            r: window.NEXUS_STT_PERF.last((x) => x.surface === 'mic-button'),
            last: document.querySelector('#stt-mic-test .stt-last').textContent,
        }));
        console.log(
            `   · mic button: stop→text ${real.r.metrics.sttMs} ms, endpoint wait ${real.r.metrics.endpointWaitMs} ms (reported apart)`
        );
        check(
            real.r.metrics.sttMs > 0 && /mic-button/.test(real.last),
            'the mic button filed a real run; Settings shows it'
        );
        // stt-check: record via the page's own talk control, then the 3-run benchmark.
        const chk = await ctx.newPage();
        chk.on('pageerror', (e) => errors.push(e.message));
        await chk.goto(`${base}/stt-check.html`);
        await chk.evaluate(() => window.NEXUS_STT.preload());
        await chk.click('#talk'); // ST18: tap to start…
        await chk.waitForTimeout(3500);
        await chk.click('#talk'); // …tap to stop and transcribe
        await chk.waitForFunction(
            () => /“|Nothing usable|✖/.test(document.getElementById('transcript').textContent),
            null,
            {
                timeout: 90000,
            }
        );
        const opensBefore = await chk.evaluate(() => window.NEXUS_MIC_SESSION.get().owner());
        await chk.click('#bench');
        await chk.waitForFunction(
            () => /Aggregate|Error/.test(document.getElementById('bench-out').textContent),
            null,
            {
                timeout: 180000,
            }
        );
        const bench = await chk.evaluate(() => ({
            out: document.getElementById('bench-out').innerText,
            verdict: document.getElementById('perf-verdict').textContent,
            owner: window.NEXUS_MIC_SESSION.get().owner(),
        }));
        console.log(`   · stt-check: ${bench.verdict}`);
        console.log(bench.out.replace(/^/gm, '     '));
        check(
            /Aggregate/.test(bench.out) && opensBefore === null && bench.owner === null,
            'benchmark ran 3 times without the microphone'
        );
        if (errors.length) check(false, `page errors: ${errors.slice(0, 3).join(' | ')}`);
    } finally {
        await browser.close();
    }
    return ok;
}

function padWav(src, dst, seconds) {
    const buf = fs.readFileSync(src);
    const rate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    let off = 12;
    while (off < buf.length && buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + buf.readUInt32LE(off + 4));
    const silence = Buffer.alloc(Math.round(rate * seconds) * 2 * channels);
    const lead = Buffer.alloc(Math.round(rate * 0.5) * 2 * channels);
    const body = Buffer.concat([lead, data, silence]);
    const head = Buffer.from(buf.subarray(0, 44));
    head.write('data', 36, 'ascii');
    head.writeUInt32LE(body.length, 40);
    head.writeUInt32LE(36 + body.length, 4);
    fs.writeFileSync(dst, Buffer.concat([head, body]));
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const server = o.url ? { url: o.url.replace(/\/$/, ''), stop: () => {} } : await startServer(o.port);
    const { chromium } = await loadPlaywright();
    const results = [];
    try {
        const browser = await chromium.launch();
        try {
            if (o.only.includes('speech')) {
                console.log('\nspeech (Piper, in the browser)');
                results.push(await phaseSpeech(browser, server.url));
            }
            if (o.only.includes('model')) {
                console.log(`\nmodel (Whisper ${o.model}, real inference — simulated device: this machine's CPU)`);
                results.push(await phaseModel(browser, server.url, o));
            }
        } finally {
            await browser.close();
        }
        if (o.only.includes('capture')) {
            console.log('\ncapture (Chromium fake microphone → the app)');
            results.push(await phaseCapture(chromium, server.url, o));
        }
        if (o.only.includes('perf')) {
            console.log('\nperf (ST10–ST15 diagnostics with the real model — this machine, not a Quest)');
            results.push(await phasePerf(chromium, server.url, o));
        }
    } finally {
        server.stop();
    }
    const failed = results.filter((r) => !r).length;
    console.log(failed ? `\n${failed} phase(s) FAILED` : '\nall phases passed');
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
