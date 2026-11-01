/**
 * ST10/ST11/ST15 — SttPerformance: the timings are honest.
 *
 * Pinned: one clock per number (worker durations are used as durations, never subtracted from
 * page timestamps); a stage that did not happen is null, never 0; the time spent speaking is not
 * latency; classification boundaries; a diagnosis only as strong as its evidence; p95 only from
 * five samples; thresholds persist and the critical one stays above the warning one; history is
 * bounded; and the recognizer files a trace for a real utterance, with the slow notice firing as
 * a label while the transcription keeps going.
 */

const P = require('../../src/stt/SttPerformance.js');

function clockAt(start = 1000) {
    let t = start;
    const now = () => t;
    now.advance = (ms) => (t += ms);
    return now;
}

beforeEach(() => {
    localStorage.clear();
    P._reset();
});

describe('a trace', () => {
    test('stop → transcript is one interval; the time spent speaking is outside it', () => {
        const now = clockAt();
        const t = P.createTrace({ surface: 'settings-mic-test', now });
        t.mark('microphone_request_started');
        now.advance(120);
        t.mark('microphone_capture_started');
        now.advance(30);
        t.mark('first_audio_frame');
        now.advance(5000); // the person speaks for five seconds
        t.mark('recording_stopped');
        now.advance(40);
        t.mark('worker_request_queued');
        now.advance(2000);
        t.mark('worker_inference_completed');
        now.advance(10);
        t.mark('transcript_validation_completed');
        now.advance(5);
        t.mark('transcript_displayed');
        const r = t.end({ audioMs: 5000, workerTimings: { inferenceMs: 1900, workerQueueMs: 3, resampleMs: 12 } });
        expect(r.metrics.sttMs).toBe(2055);
        expect(r.metrics.micAcquisitionMs).toBe(120);
        expect(r.metrics.firstAudioFrameMs).toBe(30);
        expect(r.metrics.inferenceMs).toBe(1900);
        expect(r.metrics.realTimeFactor).toBe(0.38);
        expect(r.status).toBe('fast');
    });

    test('a stage that did not happen is null — never 0', () => {
        const t = P.createTrace({ now: clockAt() });
        const r = t.end();
        for (const k of [
            'sttMs',
            'inferenceMs',
            'micAcquisitionMs',
            'workerQueueMs',
            'modelDownloadMs',
            'stopToVoiceMs',
        ]) {
            expect(r.metrics[k]).toBeNull();
        }
        expect(r.status).toBe('not_measured');
    });

    test('a mark is kept once; startAt lets a trace begin at the microphone request', () => {
        const now = clockAt(500);
        const t = P.createTrace({ now, startAt: 400 });
        t.mark('recording_stopped');
        now.advance(50);
        t.mark('recording_stopped'); // second time ignored
        expect(t.trace.marks.recording_stopped).toBe(100);
        expect(t.trace.marks.test_started).toBe(0);
    });

    test('worker numbers are durations: messaging is round trip minus the worker total, never negative', () => {
        const t = P.createTrace({ now: clockAt() });
        const r = t.end({
            pageTimings: { roundTripMs: 2100, messagingMs: 40, modelWaitMs: 0 },
            workerTimings: { workerTotalMs: 2060 },
        });
        expect(r.metrics.workerRoundTripMs).toBe(2100);
        expect(r.metrics.messagingMs).toBe(40);
    });

    test('end() files the result once; history is bounded', () => {
        for (let i = 0; i < 40; i++) P.createTrace({ now: clockAt() }).end();
        expect(P.history()).toHaveLength(30);
        const t = P.createTrace({ surface: 'mic-button', now: clockAt() });
        expect(t.end()).toBe(t.end());
        expect(P.last((r) => r.surface === 'mic-button')).toBeTruthy();
    });
});

describe('classification', () => {
    const th = P.DEFAULT_THRESHOLDS;
    test('boundaries', () => {
        expect(P.classify(3000, th)).toBe('fast');
        expect(P.classify(3001, th)).toBe('slow');
        expect(P.classify(8000, th)).toBe('slow');
        expect(P.classify(8001, th)).toBe('very_slow');
        expect(P.classify(500, th, true)).toBe('failed');
        expect(P.classify(null, th)).toBe('not_measured');
        expect(P.classify(-5, th)).toBe('not_measured');
    });

    test('defaults are the agreed targets, and recording time is not one of them', () => {
        expect(th).toEqual({
            sttWarningMs: 3000,
            sttCriticalMs: 8000,
            firstAudioWarningMs: 2000,
            conversationWarningMs: 12000,
        });
    });

    test('thresholds persist; critical stays above warning', () => {
        P.setThresholds({ sttWarningMs: 5000 });
        expect(P.thresholds().sttWarningMs).toBe(5000);
        P.setThresholds({ sttWarningMs: 9000 });
        expect(P.thresholds().sttCriticalMs).toBeGreaterThan(9000);
        localStorage.setItem('nexus_stt_perf_thresholds', 'not json');
        expect(P.thresholds()).toEqual(P.DEFAULT_THRESHOLDS);
    });
});

describe('diagnosis follows the evidence', () => {
    test('inference dominant, slower than real time', () => {
        const d = P.diagnose({ sttMs: 8400, inferenceMs: 7600, modelWaitMs: 0, realTimeFactor: 1.6 });
        expect(d).toMatchObject({ likely_bottleneck: 'inference', confidence: 'dominant' });
        expect(d.suggestions.join(' ')).toMatch(/inside Whisper inference/);
        expect(d.suggestions.join(' ')).toMatch(/slower than real time/);
    });
    test('model load dominant', () => {
        const d = P.diagnose({ sttMs: 9000, inferenceMs: 2000, modelWaitMs: 6800 });
        expect(d.likely_bottleneck).toBe('model_load');
        expect(d.suggestions[0]).toMatch(/loading the model/);
    });
    test('fast speech recognition, slow answer: says the delay was after transcription', () => {
        const d = P.diagnose({ sttMs: 1500, inferenceMs: 1300, stopToVoiceMs: 15000 });
        expect(d.suggestions.join(' ')).toMatch(/after transcription/);
    });
    test('a failed run is not "within the target"', () => {
        const d = P.diagnose({ sttMs: 900, inferenceMs: 800 }, { failed: true });
        expect(d.suggestions.join(' ')).toMatch(/failed/);
        expect(d.suggestions.join(' ')).not.toMatch(/within the target/);
    });
    test('no transcript: insufficient data, no invented cause', () => {
        expect(P.diagnose({ sttMs: null })).toMatchObject({
            likely_bottleneck: 'none',
            confidence: 'insufficient-data',
        });
    });
    test('the browser recognizer reports no stages: unknown, said plainly', () => {
        expect(P.diagnose({ sttMs: 900 }).likely_bottleneck).toBe('unknown');
    });
    test('slow mic setup and XR are mentioned only with their evidence', () => {
        const d = P.diagnose({ sttMs: 5000, inferenceMs: 4500, micAcquisitionMs: 2500 }, { xrMode: 'immersive-vr' });
        expect(d.suggestions.join(' ')).toMatch(/Microphone setup/);
        expect(d.suggestions.join(' ')).toMatch(/XR rendering/);
        expect(P.diagnose({ sttMs: 5000, inferenceMs: 4500 }).suggestions.join(' ')).not.toMatch(/XR|Microphone/);
    });
});

describe('stats', () => {
    test('p95 needs five samples', () => {
        expect(P.stats([3, 1, 2])).toMatchObject({ n: 3, min: 1, median: 2, p95: null, max: 3 });
        expect(P.stats([1, 2, 3, 4, 5, 6]).p95).toBe(6);
        expect(P.stats([null, NaN]).n).toBe(0);
    });
});

describe('the recognizer files a trace for a real utterance', () => {
    require('../../src/stt/SpeechAudio.js');
    require('../../src/stt/WhisperProtocol.js');
    require('../../src/stt/QuestWhisperConfig.js');
    require('../../src/stt/SttRouter.js');
    const STT = require('../../src/stt/LocalWhisperSTT.js');
    const RATE = 16000;
    const tone = (ms, amp = 0.5) =>
        Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE));
    const quiet = (ms) => new Float32Array((RATE * ms) / 1000);
    const tick = () => new Promise((r) => setTimeout(r, 0));

    function rig({ delay = 0 } = {}) {
        const mic = { opens: [] };
        mic.open = (o) => {
            let ok;
            const lease = { ready: new Promise((r) => (ok = r)), close() {} };
            mic.opens.push({ o, grant: () => ok({ ok: true, sampleRate: RATE }) });
            return lease;
        };
        mic.feed = (s) => mic.opens[0].o.onFrames(s, RATE);
        const model = {
            load: () => Promise.resolve({}),
            isReady: () => true,
            cancel() {},
            transcribe: () =>
                new Promise((res) =>
                    setTimeout(
                        () =>
                            res({
                                text: 'hello there',
                                ms: 1800,
                                audioMs: 2000,
                                timings: { inferenceMs: 1700, resampleMs: 9, workerQueueMs: 1, workerTotalMs: 1720 },
                                page: { cold: false, modelWaitMs: 0, roundTripMs: 1750, messagingMs: 30 },
                                outputTokens: 4,
                            }),
                        delay
                    )
                ),
        };
        const r = new STT.Recognition({ mic, model, route: () => ({ engine: 'local' }), suppressWhile: () => false });
        r.perfSurface = 'vr-ptt';
        r.holdToTalk = true;
        r.onresult = () => {};
        return { r, mic };
    }

    test('push-to-talk: a trace with the surface, mic marks, worker timings and a measured stop → text', async () => {
        const { r, mic } = rig();
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(300));
        mic.feed(tone(1000));
        mic.feed(quiet(300));
        r.stop();
        await new Promise((res) => setTimeout(res, 20));
        const res = P.last((x) => x.surface === 'vr-ptt');
        expect(res).toBeTruthy();
        expect(res.marks.first_audio_frame).toBeLessThanOrEqual(res.marks.recording_stopped);
        expect(res.metrics.sttMs).toBeGreaterThanOrEqual(0);
        expect(res.metrics.inferenceMs).toBe(1700);
        expect(res.metrics.messagingMs).toBe(30);
        expect(res.metrics.outputTokens).toBe(4);
        expect(res.data).toMatchObject({ provider: 'local-whisper', accepted: true, mode: 'hold' });
        expect(res.metrics.endpointWaitMs).toBeNull(); // push-to-talk: the release is the stop
    });

    test('past the warning threshold: a "slow" notice, and the transcription still completes', async () => {
        P.setThresholds({ sttWarningMs: 5 });
        const seen = [];
        const onStt = (e) => seen.push(e.detail.type);
        window.addEventListener('nexus-stt', onStt);
        const { r, mic } = rig({ delay: 40 });
        let text = null;
        r.onresult = (e) => (text = e.results[0][0].transcript);
        r.start();
        mic.opens[0].grant();
        await tick();
        mic.feed(quiet(300));
        mic.feed(tone(1000));
        mic.feed(quiet(300));
        r.stop();
        await new Promise((res) => setTimeout(res, 80));
        window.removeEventListener('nexus-stt', onStt);
        expect(seen).toContain('slow');
        expect(text).toBe('hello there');
        expect(P.last((x) => x.surface === 'vr-ptt').status).toBe('slow');
    });
});

describe('nothing is added to the render loop', () => {
    const fs = require('fs');
    const path = require('path');
    test('frames are sampled only inside a trace (the recognizer starts the sampler per utterance)', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../src/stt/LocalWhisperSTT.js'), 'utf-8');
        const calls = src.match(/sampleFrames\(/g) || [];
        expect(calls).toHaveLength(1);
        expect(src).toMatch(/_newTrace\(how\) \{[\s\S]*?sampleFrames\(global\)/);
        const engine = fs.readFileSync(path.resolve(__dirname, '../../src/gltf-viewer/ViewerEngine.js'), 'utf-8');
        expect(engine).not.toMatch(/NEXUS_STT_PERF|SttPerformance/);
    });
});
