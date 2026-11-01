/**
 * ST1/ST2 — the protocol, the pinned config, the router and the model manager.
 *
 * The manager is driven with a scripted fake worker: one download for three callers, honest
 * states, a result only for the request that asked, cancelled work never delivered, a wedged
 * worker terminated by its timeout, and a worker that cannot start reported, not waited on.
 */

const fs = require('fs');
const path = require('path');
const P = require('../../src/stt/WhisperProtocol.js');
const C = require('../../src/stt/QuestWhisperConfig.js');
const R = require('../../src/stt/SttRouter.js');
const M = require('../../src/stt/WhisperModelManager.js');

describe('protocol', () => {
    test('only protocol messages with an id are recognised', () => {
        expect(P.isMessage({ type: P.FROM_WORKER.DONE, id: 'x' })).toBe(true);
        expect(P.isMessage({ type: 'done', id: 'x' })).toBe(false);
        expect(P.isMessage({ type: P.FROM_WORKER.DONE })).toBe(false);
        expect(P.isMessage(null)).toBe(false);
    });
    test('a transcription request needs real samples and a rate', () => {
        expect(() => P.transcribeRequest('a', [0.1], 16000)).toThrow();
        expect(() => P.transcribeRequest('a', new Float32Array(0), 16000)).toThrow();
        expect(() => P.transcribeRequest('a', Float32Array.of(0.1), 0)).toThrow();
        expect(P.transcribeRequest('a', Float32Array.of(0.1), 48000, 'it').language).toBe('it');
    });
    test('ids are unique', () => {
        expect(new Set(Array.from({ length: 50 }, () => P.nextId())).size).toBe(50);
    });
});

describe('pinned configuration', () => {
    test('every model is a multilingual onnx-community Whisper at a full commit hash', () => {
        for (const m of Object.values(C.MODELS)) {
            expect(m.id).toMatch(/^onnx-community\/whisper-(tiny|base|small)$/); // never a .en model
            expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
            for (const sha of Object.values(m.files)) expect(sha).toMatch(/^[0-9a-f]{64}$/);
        }
    });
    test('the runtime is an exact version, and Tiny is the default', () => {
        expect(C.DEFAULTS.runtimeUrl).toContain(`@huggingface/transformers@${C.RUNTIME_VERSION}/`);
        expect(C.RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
        expect(C.resolve({}, null).model).toBe('tiny');
    });
    test('a site may self-host; an unknown size falls back to Tiny', () => {
        const r = C.resolve({ localModelPath: '/models/', bogus: 1 }, 'huge');
        expect(r.localModelPath).toBe('/models/');
        expect(r.bogus).toBeUndefined();
        expect(r.modelId).toBe(C.MODELS.tiny.id);
        expect(C.resolve({}, 'base').revision).toBe(C.MODELS.base.revision);
    });
});

describe('router', () => {
    const caps = { secure: true, mic: true, audio: true, worker: true, wasm: true };
    test('the browser recognizer stays the default — off means unchanged', () => {
        expect(R.decide({ provider: 'webspeech', capabilities: caps }).engine).toBe('browser');
        expect(R.decide({ provider: undefined, capabilities: caps }).engine).toBe('browser');
    });
    test('choosing on-device (or ?localStt=1) selects Whisper where it can run', () => {
        expect(R.decide({ provider: 'wasm', capabilities: caps })).toEqual({ engine: 'local', reason: 'setting' });
        expect(R.decide({ forced: R.forcedFrom('?a=1&localStt=1'), capabilities: caps }).engine).toBe('local');
        expect(R.decide({ provider: 'wasm', forced: R.forcedFrom('?localStt=0'), capabilities: caps }).engine).toBe(
            'browser'
        );
    });
    test('on-device chosen but impossible is "unavailable" — never silently the browser’s', () => {
        expect(R.decide({ provider: 'wasm', capabilities: { ...caps, secure: false } })).toEqual({
            engine: 'unavailable',
            reason: 'insecure-context',
        });
        expect(R.UNAVAILABLE['insecure-context']).toMatch(/HTTPS/);
    });
    test('the Quest hint only on a Quest using the browser recognizer', () => {
        expect(R.hint({ isQuest: true, engine: 'browser' })).toMatch(/On-device Whisper/);
        expect(R.hint({ isQuest: true, engine: 'local' })).toBeNull();
        expect(R.hint({ isQuest: false, engine: 'browser' })).toBeNull();
    });
});

function fakeWorker() {
    const w = { sent: [], terminated: false, onmessage: null, onerror: null };
    w.postMessage = (m) => w.sent.push(m);
    w.terminate = () => (w.terminated = true);
    w.reply = (m) => w.onmessage({ data: m });
    w.last = (type) => [...w.sent].reverse().find((m) => m.type === type);
    return w;
}

function manager(extra) {
    const workers = [];
    const timers = [];
    const m = M.create({
        config: C.resolve({}, 'tiny'),
        createWorker: () => {
            const w = fakeWorker();
            workers.push(w);
            return w;
        },
        setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
        clearTimeout: (id) => id && timers[id - 1] && (timers[id - 1].fn = null),
        ...extra,
    });
    return { m, workers, timers, fire: (i) => timers[i].fn && timers[i].fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('model manager', () => {
    test('three callers, one download; states go downloading → loading → ready', async () => {
        const { m, workers } = manager();
        const states = [];
        m.on((e) => e.type === 'state' && states.push(e.state));
        const a = m.load();
        const b = m.load();
        expect(a).toBe(b);
        const w = workers[0];
        expect(w.sent.filter((x) => x.type === 'load')).toHaveLength(1);
        const id = w.last('load').id;
        w.reply({ type: P.FROM_WORKER.PROGRESS, id, status: 'progress', file: 'enc', loaded: 5, total: 10 });
        expect(m.progress().fraction).toBe(0.5);
        w.reply({ type: P.FROM_WORKER.PROGRESS, id, status: 'done', file: 'enc', loaded: 10, total: 10 });
        expect(m.state()).toBe('downloading'); // a finished file is not a finished download
        w.reply({ type: P.FROM_WORKER.PROGRESS, id, status: 'ready' });
        w.reply({ type: P.FROM_WORKER.READY, id, ms: 7, backend: 'wasm', model: 'm' });
        await expect(a).resolves.toMatchObject({ ms: 7 });
        expect(states).toEqual(['downloading', 'loading', 'ready']);
        expect(m.load()).toBe(a);
    });

    test('a result answers its own request; a cancelled one is never delivered', async () => {
        const { m, workers } = manager();
        const loaded = m.load();
        const w = workers[0];
        w.reply({ type: P.FROM_WORKER.READY, id: w.last('load').id, ms: 1 });
        await loaded;
        const first = m.transcribe(Float32Array.of(0.1, 0.2), 16000, { language: 'it' });
        await flush();
        const req = w.last('transcribe');
        expect(req.language).toBe('it');
        m.cancel();
        await expect(first).rejects.toMatchObject({ code: 'cancelled' });
        expect(w.last('cancel').id).toBe(req.id);
        // the worker's late answer for the cancelled id is dropped
        w.reply({ type: P.FROM_WORKER.DONE, id: req.id, text: 'late' });
        const second = m.transcribe(Float32Array.of(0.3), 16000);
        await flush();
        const req2 = w.last('transcribe');
        w.reply({ type: P.FROM_WORKER.DONE, id: req2.id, text: 'hello', ms: 5, audioMs: 1000 });
        await expect(second).resolves.toMatchObject({ text: 'hello' });
    });

    test('a sentence spoken while the model downloads is transcribed once it is ready', async () => {
        const { m, workers } = manager();
        const p = m.transcribe(Float32Array.of(0.1), 16000);
        await flush();
        const w = workers[0];
        expect(w.last('transcribe')).toBeUndefined();
        w.reply({ type: P.FROM_WORKER.READY, id: w.last('load').id, ms: 1 });
        await flush();
        w.reply({ type: P.FROM_WORKER.DONE, id: w.last('transcribe').id, text: 'ok' });
        await expect(p).resolves.toMatchObject({ text: 'ok' });
    });

    test('a wedged inference times out, terminates the worker, and the next load starts fresh', async () => {
        const { m, workers, timers, fire } = manager();
        const loaded = m.load();
        workers[0].reply({ type: P.FROM_WORKER.READY, id: workers[0].last('load').id, ms: 1 });
        await loaded;
        const p = m.transcribe(Float32Array.of(0.1), 16000);
        await flush();
        const t = timers.findIndex((x) => x.fn && x.ms === C.DEFAULTS.transcribeTimeoutMs);
        fire(t);
        await expect(p).rejects.toMatchObject({ code: 'timeout' });
        expect(workers[0].terminated).toBe(true);
        expect(m.state()).toBe('not-installed');
        m.load();
        expect(workers).toHaveLength(2);
    });

    test('a load error is an error state with the reason; a worker that cannot start too', async () => {
        const one = manager();
        const p = one.m.load();
        one.workers[0].reply({ type: P.FROM_WORKER.LOAD_ERROR, id: one.workers[0].last('load').id, message: '404' });
        await expect(p).rejects.toMatchObject({ code: 'load-failed' });
        expect(one.m.state()).toBe('error');
        expect(one.m.lastError()).toBe('404');

        const two = manager();
        const q = two.m.load();
        two.workers[0].onerror({ message: 'module workers unsupported' });
        await expect(q).rejects.toBeTruthy();
        expect(two.m.state()).toBe('error');
    });
});

describe('the worker', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../workers/whisper-worker.js'), 'utf-8');
    test('no placeholder transcript survives anywhere in the speech code', () => {
        const files = [
            'workers/whisper-worker.js',
            'js/speech-service.js',
            ...fs.readdirSync(path.resolve(__dirname, '../../src/stt')).map((f) => `src/stt/${f}`),
        ];
        for (const f of files) {
            expect(fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf-8')).not.toMatch(
                /placeholder transcript/i
            );
        }
    });
    test('it speaks the shared protocol, imports the runtime from the configured URL and warms up', () => {
        expect(src).toMatch(/import '\.\.\/src\/stt\/WhisperProtocol\.js'/);
        expect(src).toMatch(/await import\(config\.runtimeUrl\)/);
        expect(src).toMatch(/revision: config\.revision/);
        expect(src).toMatch(/env\.allowRemoteModels = false/); // self-hosted installs fetch nothing remote
        expect(src).toMatch(/warm-up/i);
    });
});
