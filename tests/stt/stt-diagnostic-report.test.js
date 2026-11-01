/**
 * ST12/ST14 — the environment snapshot and the report that leaves the headset.
 *
 * Pinned: browser/version parsing (Quest, Android, desktop); what a page cannot know is
 * 'not_exposed', never guessed; a headset model typed by the tester is marked 'user-entered' and
 * a client-hint model 'browser-reported'; the report has a schema version, 'not_measured' for
 * missing stages, no transcript text unless explicitly asked, no audio, and scrubbed strings
 * (keys, bearer tokens, URL queries and credentials, IPs, 64-hex device ids).
 */

const D = require('../../src/stt/QuestAudioDiagnostics.js');
const R = require('../../src/stt/SttDiagnosticReport.js');
const P = require('../../src/stt/SttPerformance.js');

const QUEST =
    'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0.0.12.345 SamsungBrowser/4.0 Chrome/132.0.6834.110 VR Safari/537.36';
const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';
const DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

beforeEach(() => localStorage.clear());

describe('browser parsing', () => {
    test('Quest Browser with its version; family Meta Quest; no hardware claimed', () => {
        expect(D.parseBrowser(QUEST)).toMatchObject({
            name: 'Quest Browser',
            version: '38.0.0.12.345',
            deviceFamily: 'Meta Quest',
            chromiumVersion: '132.0.6834.110',
            questBrowser: true,
        });
    });
    test('Android Chrome and desktop Chrome', () => {
        expect(D.parseBrowser(ANDROID)).toMatchObject({ name: 'Chrome', deviceFamily: 'Android' });
        expect(D.parseBrowser(DESKTOP)).toMatchObject({
            name: 'Chrome',
            version: '157.0.0.0',
            deviceFamily: 'Windows',
        });
    });
    test('an unknown string: unknown, version not exposed', () => {
        expect(D.parseBrowser('')).toMatchObject({ name: 'unknown', version: 'not_exposed' });
    });
});

describe('environment', () => {
    test('what a page cannot read is not_exposed; threads need cross-origin isolation', async () => {
        const env = await D.environment(window, { sttLanguage: 'it', xrMode: 'browser-2d' });
        expect(env.horizon_os_version).toBe('not_exposed');
        expect(env.headset_model).toBe('not_exposed');
        expect(env.webgpu_in_use).toBe(false);
        expect(env.wasm_threads_available).toBe(false); // jsdom is not cross-origin isolated
        expect(env.stt_language).toBe('it');
        expect(env.manual).toBeNull();
    });
    test('unsupported APIs are named, not invented', async () => {
        const env = await D.environment({ navigator: { userAgent: QUEST }, localStorage: window.localStorage });
        expect(env.storage).toBe('unsupported');
        expect(env.js_heap).toBe('not_exposed');
        expect(env.device_memory_gb).toBe('not_exposed');
        expect(env.wasm_simd).toBe('unsupported');
    });
    test('manual fields are kept apart, bounded, and only the known ones', () => {
        D.setManualEnv({ headset_model: 'Quest 3', horizon_os_version: 'v74', junk: 'x' });
        expect(D.manualEnv()).toEqual({ headset_model: 'Quest 3', horizon_os_version: 'v74' });
    });
});

function sampleResult() {
    let t = 0;
    const now = () => t;
    const tr = P.createTrace({ surface: 'settings-mic-test', now });
    t = 100;
    tr.mark('recording_stopped');
    t = 2600;
    tr.mark('transcript_displayed');
    return tr.end({
        provider: 'local-whisper',
        model: 'tiny',
        language: 'en',
        audioMs: 4800,
        workerTimings: { inferenceMs: 2300 },
        runtime: { backend: 'wasm', dtype: 'q8', wasmThreads: 1 },
        error: 'load failed: https://user:pw@host.example/model?token=abc123 from 10.0.0.7',
        samples: new Float32Array(16000), // must never reach the report
    });
}

describe('the report', () => {
    test('schema, measured numbers, not_measured for the rest', () => {
        const rep = R.build(sampleResult(), { device_family: 'Meta Quest', user_agent: QUEST });
        expect(rep).toMatchObject({ schema_version: 1, kind: 'quest-stt-performance' });
        expect(rep.stt).toMatchObject({
            provider: 'local-whisper',
            model: 'whisper-tiny',
            stop_to_transcript_ms: 2500,
            inference_ms: 2300,
            backend: 'wasm',
            wasm_threads: 1,
            queue_ms: 'not_measured',
            encoder_ms: 'not_measured',
            threshold_ms: 3000,
        });
        expect(rep.conversation.stop_to_first_voice_ms).toBe('not_measured');
    });

    test('no audio and no transcript text, unless the transcript is explicitly opted in', () => {
        const res = sampleResult();
        const plain = JSON.stringify(R.build(res, {}, { transcript: 'my private sentence' }));
        expect(plain).not.toMatch(/private sentence/);
        expect(plain).toMatch(/"transcript_chars":19/);
        expect(plain).not.toMatch(/"samples"|Float32/); // input_samples is a count, not audio
        const opted = R.build(res, {}, { transcript: 'my private sentence', includeTranscript: true });
        expect(opted.stt.transcript).toBe('my private sentence');
    });

    test('strings are scrubbed: credentials, queries, keys, bearer tokens, IPs, device ids', () => {
        const err = R.build(sampleResult(), {}).stt.error;
        expect(err).toContain('https://host.example/model');
        expect(err).not.toMatch(/user:pw|token=abc|10\.0\.0\.7/);
        expect(R.scrub('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [redacted]');
        expect(R.scrub('key sk-proj_ABCDEFGHIJKLMNOP here')).toBe('key [redacted-key] here');
        expect(R.scrub('api_key=12345 ok')).toBe('api_key=[redacted] ok');
        expect(R.scrub(`mic ${'ab'.repeat(32)}`)).toBe('mic [redacted-id]');
    });

    test('a typed headset model says so; a client-hint model is browser-reported', () => {
        const rep = R.build(sampleResult(), {
            headset_model: 'not_exposed',
            manual: { source: 'user-entered', headset_model: 'Quest 3' },
            client_hints: { model: 'Quest 3', platform: 'Android' },
        });
        expect(rep.environment).toMatchObject({ headset_model: 'Quest 3', headset_model_source: 'user-entered' });
        expect(rep.environment.client_hints.model_source).toMatch(/browser-reported/);
    });

    test('history is summarized and bounded', () => {
        const res = sampleResult();
        const rep = R.build(res, {}, { history: Array.from({ length: 30 }, () => res) });
        expect(rep.history).toHaveLength(20);
        expect(Object.keys(rep.history[0])).toEqual(
            expect.arrayContaining(['surface', 'status', 'stt_ms', 'inference_ms', 'warm_model'])
        );
    });

    test('file name sorts by time', () => {
        expect(R.fileName({ timestamp: '2026-11-01T08:30:00.000Z' })).toBe('stt-report-2026-11-01T08-30-00-000Z.json');
    });
});
