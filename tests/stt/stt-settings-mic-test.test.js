/**
 * ST8 — the STT section: choices apply at once, and the microphone test is honest.
 *
 * Pinned: picking On-device Whisper writes stt_config immediately (closing Settings with ✕ used
 * to leave the browser recognizer in force — on a Quest, the mic then heard nothing); the meter
 * lights only from real input and goes dark on Stop; while the result is worked out the button
 * cannot start a second recording; "sound but no words" is told apart from "recognized".
 */

require('../../src/stt/SpeechAudio.js');
const SS = require('../../src/stt/SttSettings.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const voice = (n = 4096) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i / 4));
const quiet = (n = 4096) => new Float32Array(n);

function page() {
    document.body.innerHTML = `
        <div class="config-section">
          <div class="input-group"><select id="stt-provider">
            <option value="webspeech">Web Speech</option><option value="wasm">On-device</option></select>
            <p class="voice-status">old line</p></div>
          <div id="wasm-stt-settings"><div class="input-group"><select id="wasm-model-size">
            <option value="tiny">Tiny</option><option value="base">Base</option></select></div></div>
          <div class="input-group"><select id="stt-language"><option value="en-US">English</option>
            <option value="it-IT">Italiano</option></select></div>
          <div class="input-group"><select id="stt-microphone"><option value="">Default</option></select></div>
        </div>`;
}

function setup({ text = 'testing one two three', accept = true } = {}) {
    page();
    const saved = [];
    window.SpeechService = {
        saveSTTConfig: (p) => saved.push(p),
        getSTTConfig: () => ({ wasm: { modelSize: 'tiny' } }),
        setRecognitionOptions: () => {},
    };
    let release;
    const transcribe = jest.fn(
        () => new Promise((r) => (release = () => r(accept ? { accept, text } : { accept: false, reason: 'phantom' })))
    );
    window.NEXUS_STT = {
        status: () => ({ model: 'ready', progress: null, config: { downloadMB: 41 } }),
        preload: () => Promise.resolve(),
        clearCache: () => Promise.resolve(0),
        transcribeSamples: transcribe,
    };
    const mic = { opens: [] };
    mic.open = (o) => {
        const lease = { ready: Promise.resolve({ ok: true, sampleRate: 16000 }), close: jest.fn() };
        mic.opens.push({ o, lease });
        return lease;
    };
    window.NEXUS_MIC_SESSION = { get: () => mic };
    expect(SS.mount(document)).toBe(true);
    const $ = (s) => document.querySelector(s);
    return {
        saved,
        mic,
        transcribe,
        release: () => release(),
        button: () => $('#stt-mic-test button'),
        chip: () => $('#stt-mic-test .stt-chip').textContent,
        heard: () => $('#stt-mic-test .stt-heard').textContent,
        lit: () => document.querySelectorAll('#stt-mic-test .stt-meter span.on').length,
        feed: (s) => mic.opens[mic.opens.length - 1].o.onFrames(s, 16000),
    };
}

afterEach(() => {
    delete window.SpeechService;
    delete window.NEXUS_STT;
    delete window.NEXUS_MIC_SESSION;
});

test('choosing a provider applies at once — no SAVE needed', () => {
    const t = setup();
    const sel = document.getElementById('stt-provider');
    sel.value = 'wasm';
    sel.dispatchEvent(new Event('change'));
    expect(t.saved.pop()).toMatchObject({ provider: 'wasm', language: 'en-US', wasm: { modelSize: 'tiny' } });
    expect(document.getElementById('stt-provider-help').textContent).toBe(SS.COPY.wasm);
});

test('the test sits right under STT LANGUAGE', () => {
    setup();
    const lang = document.getElementById('stt-language').closest('.input-group');
    expect(lang.nextElementSibling.id).toBe(SS.TEST_ID);
});

test('meter from real input; dark after Stop; locked while transcribing; then the words', async () => {
    const t = setup();
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(quiet());
    expect(t.lit()).toBe(0);
    t.feed(voice());
    expect(t.lit()).toBeGreaterThan(8);
    expect(t.chip()).toBe('Sound detected');
    t.button().click(); // Stop
    await tick();
    expect(t.lit()).toBe(0);
    expect(t.button().disabled).toBe(true);
    expect(t.chip()).toMatch(/Transcribing… \d+\.\d s/); // ST11: a live count from the stop
    t.button().click(); // ignored while transcribing
    expect(t.mic.opens).toHaveLength(1);
    t.release();
    await tick();
    await tick();
    expect(t.chip()).toBe('Mic works · recognized');
    expect(t.heard()).toBe('testing one two three');
    expect(t.button().disabled).toBe(false);
    expect(t.transcribe.mock.calls[0][2]).toMatchObject({ language: 'en-US' });
});

test('sound but no words is not "recognized"', async () => {
    const t = setup({ accept: false });
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(voice());
    t.button().click();
    await tick();
    t.release();
    await tick();
    await tick();
    expect(t.chip()).toBe('Sound detected · no words recognized');
});

test('a silent microphone says so, and the model is never asked', async () => {
    const t = setup();
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(quiet());
    t.button().click();
    await tick();
    await tick();
    expect(t.chip()).toBe('No sound');
    expect(t.transcribe).not.toHaveBeenCalled();
});

describe('ST9 — the test drives the browser recognizer the way the app does', () => {
    let made;
    class FakeSR {
        constructor() {
            made.push(this);
            this.starts = 0;
            this.stops = 0;
        }
        start() {
            this.starts++;
            this.startedAt = made.order++;
        }
        stop() {
            this.stops++;
        }
    }
    const ua = (s) => Object.defineProperty(window.navigator, 'userAgent', { value: s, configurable: true });
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/132 Mobile Safari/537.36';
    const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36';
    const original = window.navigator.userAgent;

    function browserSetup(agent) {
        ua(agent);
        made = [];
        made.order = 0;
        const t = setup();
        window.NEXUS_STT.recognitionClass = () => FakeSR; // the class the app's mic button would build
        const open = t.mic.open;
        t.mic.open = (o) => {
            t.meterOpenedAt = made.order++;
            return open(o);
        };
        document.getElementById('stt-provider').value = 'webspeech';
        document.getElementById('stt-language').value = 'it-IT';
        return t;
    }
    afterEach(() => ua(original));

    test('pure: only a desktop browser shares the microphone with the meter', () => {
        expect(SS.browserMeterSafe({ userAgent: ANDROID })).toBe(false);
        expect(SS.browserMeterSafe({ userAgent: 'x OculusBrowser/38 Quest 3' })).toBe(false);
        expect(SS.browserMeterSafe({ userAgent: DESKTOP, touch: false })).toBe(true);
        expect(SS.browserMeterSafe({ userAgent: DESKTOP, touch: true })).toBe(false);
    });

    test('on a phone: the recognizer runs alone, configured like the mic button, and its words count', async () => {
        const t = browserSetup(ANDROID);
        t.button().click();
        await tick();
        const sr = made[0];
        expect(sr.starts).toBe(1);
        expect(t.mic.opens).toHaveLength(0); // no second capture to steal the audio
        expect(sr).toMatchObject({ continuous: false, interimResults: true, lang: 'it-IT' });
        sr.onstart();
        sr.onsoundstart();
        expect(t.chip()).toBe('Sound detected');
        const r = [{ transcript: 'ciao come stai' }];
        r.isFinal = true;
        sr.onresult({ resultIndex: 0, results: [r] });
        sr.onend();
        await tick();
        await tick();
        expect(t.chip()).toBe('Mic works · recognized');
        expect(t.heard()).toBe('ciao come stai');
    });

    test('on a desktop: the recognizer starts first, then the meter takes its own capture', async () => {
        const t = browserSetup(DESKTOP);
        t.button().click();
        await tick();
        expect(made[0].starts).toBe(1);
        expect(t.mic.opens).toHaveLength(1);
        expect(made[0].startedAt).toBeLessThan(t.meterOpenedAt);
    });

    test('nothing recognised and no meter: "No speech heard", never "No sound"', async () => {
        const t = browserSetup(ANDROID);
        t.button().click();
        await tick();
        const sr = made[0];
        sr.onerror({ error: 'no-speech' });
        sr.onend();
        await tick();
        await tick();
        expect(t.chip()).toBe('No speech heard');
    });

    test('Stop asks the recognizer to stop and waits for its last words', async () => {
        const t = browserSetup(ANDROID);
        t.button().click();
        await tick();
        const sr = made[0];
        t.button().click(); // Stop
        expect(sr.stops).toBe(1);
        const r = [{ transcript: 'hello there' }];
        r.isFinal = true;
        sr.onresult({ resultIndex: 0, results: [r] });
        sr.onend();
        await tick();
        await tick();
        expect(t.heard()).toBe('hello there');
    });

    test('a blocked microphone is named', async () => {
        const t = browserSetup(ANDROID);
        t.button().click();
        await tick();
        made[0].onerror({ error: 'not-allowed' });
        made[0].onend();
        await tick();
        await tick();
        expect(t.chip()).toBe('Microphone blocked');
    });
});

describe('ST11 — the performance result under the test', () => {
    const P = require('../../src/stt/SttPerformance.js');
    require('../../src/stt/QuestAudioDiagnostics.js');
    require('../../src/stt/SttDiagnosticReport.js');
    beforeEach(() => {
        localStorage.clear();
        P._reset();
    });

    test('pure summary: measured rows only, the verdict, the bottleneck', () => {
        let t = 0;
        const tr = P.createTrace({ now: () => t });
        tr.mark('recording_stopped');
        t = 8400;
        tr.mark('transcript_displayed');
        const r = tr.end({
            provider: 'local-whisper',
            model: 'tiny',
            audioMs: 4800,
            workerTimings: { inferenceMs: 7600 },
            modelWarmAtStart: true,
        });
        const s = SS.perfSummary(r);
        expect(s.headline).toMatch(/Very slow/);
        expect(s.short).toBe('8.4 s after you stopped · Very slow transcription');
        const labels = s.rows.map(([k]) => k);
        expect(labels).toEqual(
            expect.arrayContaining([
                'Time after microphone stopped',
                'Target',
                'Whisper inference',
                'Model already loaded',
            ])
        );
        expect(labels).not.toContain('Queue in the worker'); // not measured: not shown as 0
        expect(s.bottleneck).toMatch(/inference/);
    });

    test('after an on-device test: the result line, details, and a report without the transcript', async () => {
        window.NEXUS_STT_PERF = P;
        const t = setup();
        window.NEXUS_STT_DIAGNOSTICS = require('../../src/stt/QuestAudioDiagnostics.js');
        window.NEXUS_STT_REPORT = require('../../src/stt/SttDiagnosticReport.js');
        const written = [];
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText: async (x) => written.push(x) },
            configurable: true,
        });
        document.getElementById('stt-provider').value = 'wasm';
        t.button().click();
        await tick();
        t.feed(voice());
        t.button().click();
        await tick();
        t.release();
        await tick();
        await tick();
        const line = document.querySelector('#stt-mic-test .stt-perf-line');
        expect(document.querySelector('#stt-mic-test .stt-perf').hidden).toBe(false);
        expect(line.textContent).toMatch(/after you stopped · Fast/);
        expect(P.last().surface).toBe('settings-mic-test');
        const copyBtn = [...document.querySelectorAll('#stt-mic-test button')].find((b) =>
            /Copy diagnostic/.test(b.textContent)
        );
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 20));
        expect(written).toHaveLength(1);
        const rep = JSON.parse(written[0]);
        expect(rep.schema_version).toBe(1);
        expect(written[0]).not.toMatch(/testing one two three/);
        delete window.NEXUS_STT_PERF;
        delete window.NEXUS_STT_DIAGNOSTICS;
        delete window.NEXUS_STT_REPORT;
    });

    test('ST9 holds with diagnostics loaded: no second capture on a phone, and the browser run is filed', async () => {
        window.NEXUS_STT_PERF = P;
        Object.defineProperty(window.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/132 Mobile Safari/537.36',
            configurable: true,
        });
        const made = [];
        class SR {
            constructor() {
                made.push(this);
            }
            start() {}
            stop() {}
        }
        const t = setup();
        window.NEXUS_STT.recognitionClass = () => SR;
        document.getElementById('stt-provider').value = 'webspeech';
        t.button().click();
        await tick();
        expect(t.mic.opens).toHaveLength(0);
        made[0].onaudiostart();
        made[0].onspeechend();
        const res = [{ transcript: 'ciao' }];
        res.isFinal = true;
        made[0].onresult({ resultIndex: 0, results: [res] });
        made[0].onend();
        await tick();
        await tick();
        const r = P.last();
        expect(r.data.provider).toBe('webspeech');
        expect(r.metrics.sttMs).not.toBeNull();
        expect(r.diagnosis.likely_bottleneck).toBe('unknown'); // the browser reports no stages
        delete window.NEXUS_STT_PERF;
    });
});
