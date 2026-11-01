/**
 * ST2–ST5 — the on-device recognizer and the code that switches to it.
 *
 * WhisperRecognition is run with a scripted microphone and model: results in the browser's
 * shape with no made-up confidence; push-to-talk keeps everything until stop(); a release
 * before the microphone opened records nothing; silence ends with 'no-speech' and never a
 * result; abort drops a transcription in flight; "on-device chosen but impossible" fails with
 * a reason instead of quietly using the browser's recognizer. MicrophoneSession: one owner,
 * a lease closed before the device opened stops the stream on arrival, refusals are named.
 * Then the three callers: SpeechService (VR), the mic button, CompanionMode.
 */

const fs = require('fs');
const path = require('path');

require('../../src/stt/SpeechAudio.js');
require('../../src/stt/WhisperProtocol.js');
require('../../src/stt/QuestWhisperConfig.js');
require('../../src/stt/WhisperModelManager.js');
const MS = require('../../src/stt/MicrophoneSession.js');
require('../../src/stt/SttRouter.js');
const STT = require('../../src/stt/LocalWhisperSTT.js');
const SS = require('../../src/stt/SttSettings.js');
const D = require('../../src/stt/QuestAudioDiagnostics.js');

const RATE = 16000;
const tone = (ms, amp = 0.5) =>
    Float32Array.from(
        { length: Math.round((RATE * ms) / 1000) },
        (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE)
    );
const quiet = (ms) => new Float32Array(Math.round((RATE * ms) / 1000));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A microphone whose open resolves when the test says, and whose frames the test feeds. */
function fakeMic() {
    const mic = { opens: [], closed: 0 };
    mic.open = (o) => {
        let resolve;
        const lease = {
            ready: new Promise((r) => (resolve = r)),
            close: () => {
                mic.closed++;
                lease.isClosed = true;
                resolve({ ok: false, reason: 'cancelled' });
            },
        };
        mic.opens.push({ o, lease, grant: () => resolve({ ok: true, sampleRate: RATE }), refuse: (r) => resolve(r) });
        return lease;
    };
    mic.feed = (samples) => {
        const cur = mic.opens[mic.opens.length - 1];
        for (let i = 0; i < samples.length; i += 1024) cur.o.onFrames(samples.subarray(i, i + 1024), RATE);
    };
    return mic;
}

function fakeModel(text = 'hello there') {
    const m = { calls: [], cancelled: 0 };
    m.load = () => Promise.resolve({});
    m.transcribe = (samples, rate, opts) => {
        m.calls.push({ samples, rate, opts });
        return Promise.resolve({ text: typeof text === 'function' ? text() : text, ms: 10, audioMs: 1000 });
    };
    m.cancel = () => m.cancelled++;
    return m;
}

function recognizer({ mic = fakeMic(), model = fakeModel(), route = { engine: 'local' }, speaking = false } = {}) {
    const r = new STT.Recognition({ mic, model, route: () => route, suppressWhile: () => speaking });
    const log = [];
    for (const t of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend', 'result', 'error', 'end']) {
        r['on' + t] = (e) =>
            log.push(
                t === 'error'
                    ? `error:${e.error}`
                    : t === 'result'
                      ? `result:${e.results[e.resultIndex][0].transcript}`
                      : t
            );
    }
    return { r, mic, model, log };
}

describe('WhisperRecognition', () => {
    test('push-to-talk: everything until stop(), one final result without a confidence', async () => {
        const { r, mic, model, log } = recognizer();
        let event;
        r.holdToTalk = true;
        r.lang = 'it-IT';
        r.start();
        r.addEventListener('result', (e) => (event = e));
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(300));
        mic.feed(tone(1000));
        mic.feed(quiet(2000)); // a pause does NOT end a held recording
        expect(log).toEqual(['start', 'audiostart']);
        r.stop();
        await tick();
        await tick();
        expect(log).toEqual(['start', 'audiostart', 'audioend', 'result:hello there', 'end']);
        expect(model.calls[0].opts.language).toBe('it');
        expect(model.calls[0].samples.length).toBeGreaterThan(RATE * 3); // the whole hold
        const res = event.results[0];
        expect(res.isFinal).toBe(true);
        expect(res[0].confidence).toBeUndefined();
    });

    test('released before the microphone opened: nothing recorded, no start, just end', async () => {
        const { r, mic, model, log } = recognizer();
        r.holdToTalk = true;
        r.start();
        r.stop();
        await tick();
        mic.opens[0].grant(); // too late: the lease was closed
        await tick();
        expect(mic.closed).toBe(1);
        expect(model.calls).toHaveLength(0);
        expect(log).toEqual(['end']);
    });

    test('tap-to-talk stops itself after the sentence', async () => {
        const { r, mic, log } = recognizer();
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(400));
        mic.feed(tone(800));
        mic.feed(quiet(1500));
        await tick();
        await tick();
        expect(log).toEqual([
            'start',
            'audiostart',
            'speechstart',
            'speechend',
            'audioend',
            'result:hello there',
            'end',
        ]);
    });

    test('silence: no-speech, and the model is never asked', async () => {
        const { r, mic, model, log } = recognizer();
        r.holdToTalk = true;
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(2000));
        r.stop();
        await tick();
        await tick();
        expect(model.calls).toHaveLength(0);
        expect(log.slice(-2)).toEqual(['error:no-speech', 'end']);
    });

    test('a phantom transcript from a weak recording is not a result', async () => {
        const { r, mic, log } = recognizer({ model: fakeModel('Thank you.') });
        r.holdToTalk = true;
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(1000));
        mic.feed(tone(250, 0.05));
        mic.feed(quiet(1000));
        r.stop();
        await tick();
        await tick();
        expect(log.filter((x) => x.startsWith('result'))).toEqual([]);
        expect(log).toContain('error:no-speech');
    });

    test('abort drops the transcription in flight', async () => {
        let release;
        const model = fakeModel();
        model.transcribe = () => new Promise((r) => (release = r));
        const { r, mic, log } = recognizer({ model });
        r.holdToTalk = true;
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(500));
        mic.feed(tone(1000));
        mic.feed(quiet(500));
        r.stop();
        await tick();
        r.abort();
        release({ text: 'too late' });
        await tick();
        await tick();
        expect(log.filter((x) => x.startsWith('result'))).toEqual([]);
        expect(log).toContain('error:aborted');
        expect(model.cancelled).toBe(1);
    });

    test('continuous: sentence after sentence, and her own voice is not listened to', async () => {
        let speaking = false;
        const mic = fakeMic();
        let n = 0;
        const r = new STT.Recognition({
            mic,
            model: fakeModel(() => `sentence ${++n}`),
            route: () => ({ engine: 'local' }),
            suppressWhile: () => speaking,
        });
        const results = [];
        r.onresult = (e) => results.push(e.results[e.resultIndex][0].transcript);
        r.continuous = true;
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(400));
        mic.feed(tone(700));
        mic.feed(quiet(1200));
        await tick();
        speaking = true; // her reply plays through the headset speakers
        mic.feed(tone(1500));
        mic.feed(quiet(1200));
        speaking = false;
        mic.feed(quiet(400));
        mic.feed(tone(700));
        mic.feed(quiet(1200));
        await tick();
        expect(results).toEqual(['sentence 1', 'sentence 2']);
        r.stop();
    });

    test('on-device chosen but impossible here: an error with the reason, never the browser’s', async () => {
        const { r, mic, log } = recognizer({ route: { engine: 'unavailable', reason: 'insecure-context' } });
        let err;
        r.addEventListener('error', (e) => (err = e));
        r.start();
        await tick();
        expect(mic.opens).toHaveLength(0);
        expect(log).toEqual(['error:service-not-allowed', 'end']);
        expect(err.message).toMatch(/HTTPS/);
    });

    test('a permission refusal is the browser’s not-allowed', async () => {
        const { r, mic, log } = recognizer();
        r.start();
        mic.opens[0].refuse({ ok: false, reason: 'denied', message: 'blocked' });
        await tick();
        expect(log).toEqual(['error:not-allowed', 'end']);
    });

    test('start() twice throws like the browser’s', () => {
        const { r } = recognizer();
        r.start();
        expect(() => r.start()).toThrow();
    });
});

describe('MicrophoneSession', () => {
    function devices() {
        const pending = [];
        const tracks = [];
        const nav = {
            mediaDevices: {
                getUserMedia: () =>
                    new Promise((resolve, reject) => {
                        pending.push({
                            give: () => {
                                const t = {
                                    stopped: false,
                                    stop: () => (t.stopped = true),
                                    addEventListener: (_, fn) => (t.end = fn),
                                };
                                tracks.push(t);
                                resolve({ getTracks: () => [t], getAudioTracks: () => [t] });
                            },
                            refuse: (name) => reject(Object.assign(new Error(name), { name })),
                        });
                    }),
            },
        };
        class AC {
            constructor() {
                this.sampleRate = 48000;
                this.state = 'running';
                this.destination = {};
            }
            createMediaStreamSource() {
                return { connect() {}, disconnect() {} };
            }
            createGain() {
                return { gain: {}, connect() {}, disconnect() {} };
            }
            createScriptProcessor() {
                return { connect() {}, disconnect() {} };
            }
            close() {}
        }
        return { nav, AC, pending, tracks };
    }

    test('a lease closed before the device opened stops the stream on arrival', async () => {
        const d = devices();
        const mics = MS.create({ navigator: d.nav, AudioContext: d.AC });
        const lease = mics.open({ owner: 'ptt' });
        lease.close();
        d.pending[0].give();
        expect(await lease.ready).toMatchObject({ ok: false, reason: 'cancelled' });
        expect(d.tracks[0].stopped).toBe(true);
    });

    test('one owner: a second open ends the first', async () => {
        const d = devices();
        const mics = MS.create({ navigator: d.nav, AudioContext: d.AC });
        const ended = [];
        const a = mics.open({ owner: 'a', onEnded: (why) => ended.push(why) });
        d.pending[0].give();
        expect((await a.ready).ok).toBe(true);
        mics.open({ owner: 'b' });
        expect(ended).toEqual(['preempted']);
        expect(d.tracks[0].stopped).toBe(true);
        expect(mics.owner()).toBe('b');
    });

    test('refusals are named; a device that stops ends the lease', async () => {
        const d = devices();
        const mics = MS.create({ navigator: d.nav, AudioContext: d.AC });
        const denied = mics.open({});
        d.pending[0].refuse('NotAllowedError');
        expect(await denied.ready).toMatchObject({ ok: false, reason: 'denied' });
        const ended = [];
        const live = mics.open({ onEnded: (w) => ended.push(w) });
        d.pending[1].give();
        await live.ready;
        d.tracks[0].end();
        expect(ended).toEqual(['device-ended']);
        expect(MS.reasonOf({ name: 'NotReadableError' })).toBe('busy');
    });

    test('no microphone API: unsupported, with a sentence', async () => {
        const mics = MS.create({ navigator: {}, AudioContext: null });
        expect(await mics.open({}).ready).toMatchObject({ ok: false, reason: 'unsupported' });
    });
});

describe('Settings copy and diagnostics', () => {
    test('status follows the model', () => {
        expect(SS.statusText({ model: 'downloading', progress: { loaded: 20e6, total: 41e6 } })).toMatch(
            /20\.0 of 41\.0 MB/
        );
        expect(SS.statusText({ model: 'ready' })).toMatch(/On this device/);
        expect(SS.statusText({ model: 'error', error: 'offline' })).toMatch(/offline/);
        expect(SS.statusText({ model: 'not-installed', config: { downloadMB: 77 } })).toMatch(/77 MB/);
    });
    test('one helper sentence per provider; the Quest line only on a Quest with the browser recognizer', () => {
        expect(SS.providerText('wasm', true)).toBe(SS.COPY.wasm);
        expect(SS.providerText('webspeech', false)).toBe(SS.COPY.webspeech);
        expect(SS.providerText('webspeech', true)).toContain(SS.COPY.webspeechQuest);
        expect(SS.providerText('openai', true)).toMatch(/OpenAI/);
        expect(SS.advice({ provider: 'wasm', size: 'tiny', lang: 'it-IT' })).toEqual([SS.COPY.italian]);
        expect(SS.advice({ provider: 'wasm', size: 'base', lang: 'it-IT' })).toEqual([]);
    });
    test('ST17 hints: Auto is faster for English on Whisper; Moonshine is English only', () => {
        expect(SS.advice({ provider: 'wasm', size: 'tiny', lang: 'en-US' })).toEqual([SS.COPY.fasterEnglish]);
        expect(SS.advice({ provider: 'wasm', size: 'auto', lang: 'en-US' })).toEqual([]);
        expect(SS.advice({ provider: 'wasm', size: 'moonshine-tiny', lang: 'it-IT' })).toEqual([
            SS.COPY.moonshineEnglishOnly,
        ]);
        expect(SS.advice({ provider: 'webspeech', size: 'tiny', lang: 'en-US' })).toEqual([]);
    });
    test('ST17 the model select gains Auto (selected for a new install) and Moonshine', () => {
        document.body.innerHTML = '<select id="wasm-model-size"><option value="tiny" selected>Tiny</option></select>';
        window.NEXUS_WHISPER_CONFIG = require('../../src/stt/QuestWhisperConfig.js');
        window.NEXUS_STT = { readSttConfig: () => ({}) };
        SS.addModelChoices(document);
        const sel = document.getElementById('wasm-model-size');
        expect(Array.from(sel.options).map((o) => o.value)).toEqual(['auto', 'tiny', 'moonshine-tiny']);
        expect(sel.value).toBe('auto');
        window.NEXUS_STT = { readSttConfig: () => ({ wasm: { modelSize: 'tiny' } }) };
        SS.addModelChoices(document); // idempotent, and a saved choice wins
        expect(sel.options).toHaveLength(3);
        expect(sel.value).toBe('tiny');
        delete window.NEXUS_STT;
    });
    test('the meter is the real input level: silence 0, quiet room low, speech high', () => {
        expect(SS.levelOf(new Float32Array(1024))).toBe(0);
        const room = Float32Array.from({ length: 1024 }, (_, i) => 0.001 * Math.sin(i));
        const voice = Float32Array.from({ length: 1024 }, (_, i) => 0.2 * Math.sin(i / 3));
        expect(SS.levelOf(room)).toBeLessThan(SS.SOUND_LEVEL);
        expect(SS.levelOf(voice)).toBeGreaterThan(0.7);
    });
    test('the verdict tells "the mic hears sound" apart from "speech was recognised"', () => {
        const heard = { heardSound: true };
        expect(SS.verdict({ provider: 'wasm', error: { reason: 'denied' } })).toMatchObject({
            tone: 'error',
            status: 'Microphone blocked',
        });
        expect(SS.verdict({ provider: 'wasm', heardSound: false, analysis: { peak: 0 } }).status).toBe('No sound');
        expect(
            SS.verdict({ provider: 'wasm', ...heard, result: { accept: true, text: 'testing one two three' } })
        ).toMatchObject({ tone: 'ok', text: 'testing one two three' });
        expect(SS.verdict({ provider: 'wasm', ...heard, result: { accept: false, reason: 'phantom' } })).toMatchObject({
            tone: 'warn',
            status: 'Sound detected · no words recognized',
        });
        expect(SS.verdict({ provider: 'wasm', ...heard, failure: 'model 404' })).toMatchObject({
            tone: 'error',
            text: 'model 404',
        });
        expect(SS.verdict({ provider: 'webspeech', ...heard, quest: true, result: { accept: false } }).text).toBe(
            SS.COPY.webspeechQuest
        );
    });
    test('a recording of silence is named as such, not as a permission problem', () => {
        expect(D.judgeRecording({ durationMs: 5000, peak: 0 }).finding).toMatch(/silence/);
        expect(D.judgeRecording({ durationMs: 0 }).ok).toBe(false);
        expect(D.judgeRecording({ durationMs: 5000, peak: 0.4, speechMs: 2000, clippedFraction: 0 }).ok).toBe(true);
        expect(D.realTimeFactor(500, 1000)).toBe(0.5);
    });
});

describe('the three recognizers switch through NEXUS_STT', () => {
    const read = (f) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf-8');

    test('CompanionMode constructs only what _SR() answers, and skips its second stream for Whisper', () => {
        const src = read('src/CompanionMode.js');
        const direct = src.match(/window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/g) || [];
        expect(direct).toHaveLength(1); // the fallback inside _SR itself
        expect(src).toMatch(/static _SR\(\)[\s\S]*?NEXUS_STT\.recognitionClass\(\)/);
        expect(src).toMatch(
            /async _liveVadWait\(\) \{[\s\S]{0,400}CompanionMode\._localSR\(\)[\s\S]{0,80}this\._liveListen\(\)/
        );
    });

    test('the mic button re-reads the provider on every press and treats no confidence as "no score"', () => {
        const src = read('src/main.js');
        expect(src).toMatch(
            /function startVoiceInput\(\) \{[\s\S]{0,300}micRecognizerClass\(\)[\s\S]{0,120}initSpeechRecognition\(\)/
        );
        expect(src).toMatch(/SpeechSettings\.autoSend && \(!scored \|\| confidence >= 0\.8\)/);
    });

    test('VR push-to-talk: the release always stops, and a start after the release does not record', () => {
        const src = read('src/gltf-viewer/VRChatIntegration.js');
        expect(src).toMatch(/this\._pttHeld = true/);
        expect(src).toMatch(/if \(!this\._pttHeld\) \{/);
        expect(src).toMatch(/this\._pttHeld = false;[\s\S]{0,600}this\.speechService\.stopRecognition\(\)/);
        expect(src).toMatch(/holdToTalk: true/);
    });

    test('index.html loads the modules in order, after every frozen line', () => {
        const html = read('index.html');
        const order = [
            'SpeechAudio',
            'WhisperProtocol',
            'QuestWhisperConfig',
            'WhisperModelManager',
            'MicrophoneSession',
            'SttRouter',
            'LocalWhisperSTT',
            'SttSettings',
        ].map((n) => html.indexOf(`src="src/stt/${n}.js"`));
        expect(order.every((i) => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(order[0]).toBeGreaterThan(html.indexOf('src="src/wardrobe/WardrobeForgeSettings.js"'));
        expect(html).toMatch(/<option value="wasm">On-device Whisper/);
    });
});

describe('SpeechService (the VR panel’s recognizer), run for real', () => {
    let service;
    let made;
    class FakeRec {
        constructor() {
            this.isLocalWhisper = true;
            this.started = 0;
            this.stopped = 0;
            made.push(this);
        }
        start() {
            this.started++;
        }
        stop() {
            this.stopped++;
        }
    }
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        made = [];
        window.NEXUS_STT = { recognitionClass: () => FakeRec };
        jest.isolateModules(() => require('../../js/speech-service.js'));
        service = window.SpeechService;
    });
    afterAll(() => {
        delete window.NEXUS_STT;
        console.log.mockRestore();
        console.warn.mockRestore();
    });

    test('it builds the on-device recognizer and passes hold-to-talk through', async () => {
        expect(service.isLocalRecognizer()).toBe(true);
        await service.startRecognition({ holdToTalk: true });
        expect(service.recognition.holdToTalk).toBe(true);
        expect(service.recognition.started).toBe(1);
    });

    test('stop reaches the recognizer even before it reported onstart', () => {
        const rec = service.recognition;
        service.isRecognizing = false;
        service.stopRecognition();
        expect(rec.stopped).toBe(1);
    });

    test('"Transcribing…" fires at audio end; the result carries no confidence', () => {
        const got = [];
        service.recognitionCallbacks = {
            onTranscribing: () => got.push('transcribing'),
            onResult: (t, c) => got.push([t, c]),
        };
        service.recognition.onaudioend();
        const result = [{ transcript: 'ciao', confidence: undefined }];
        result.isFinal = true;
        service.recognition.onresult({ resultIndex: 0, results: [result] });
        expect(got).toEqual(['transcribing', ['ciao', null]]);
    });
});
