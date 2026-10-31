/**
 * whisper-worker.js — ST1. On-device Whisper, in its own thread.
 *
 * Until ST1 this file pretended: it "loaded" in a timer and answered every recording with
 * the same fixed 'not yet implemented' sentence. It now runs OpenAI's Whisper
 * through Transformers.js and ONNX Runtime Web, on this device, and it never answers anything
 * it did not hear — on any failure it says so with an error message instead.
 *
 * Why a worker: this site is not crossOriginIsolated, so ONNX Runtime runs single-threaded, and
 * inference on the page's thread would stop the WebXR frame loop for as long as it takes —
 * Piper did exactly that until Q7. Here the page keeps drawing while the model listens.
 *
 * A MODULE worker (new Worker(url, { type: 'module' })), because Transformers.js ships as an
 * ES module and this repository has no bundler: it is imported at run time from the pinned URL
 * the page sends in `load` (QuestWhisperConfig), which a site may point at its own copy.
 * Import maps do not reach into workers, so the URL is always spelled out.
 *
 * Messages are WhisperProtocol's. One model per worker, one transcription at a time; the page
 * (WhisperModelManager) queues, times out and cancels.
 */
import '../src/stt/WhisperProtocol.js';
import '../src/stt/SpeechAudio.js';

const P = globalThis.NEXUS_WHISPER_PROTOCOL;
const A = globalThis.NEXUS_STT_AUDIO;
const IN = P.TO_WORKER;
const OUT = P.FROM_WORKER;

let asr = null; // the pipeline, once loaded
let loading = null;
let loadedModel = null;
const cancelled = new Set();

function post(msg, transfer) {
    try {
        self.postMessage(msg, transfer || []);
    } catch (err) {
        // A message that cannot be posted is not worth killing the worker for.
        console.warn('[whisper-worker] postMessage failed:', err);
    }
}

async function load(id, config) {
    if (asr && loadedModel === `${config.modelId}@${config.revision}`) {
        post({ type: OUT.READY, id, ms: 0, backend: config.device, model: config.modelId, cached: true });
        return;
    }
    if (loading) {
        await loading.catch(() => {});
        if (asr) {
            post({ type: OUT.READY, id, ms: 0, backend: config.device, model: config.modelId, cached: true });
            return;
        }
    }
    const t0 = performance.now();
    loading = (async () => {
        const T = await import(config.runtimeUrl);
        const env = T.env;
        if (config.localModelPath) {
            // A site-hosted install: nothing is fetched from Hugging Face.
            env.allowRemoteModels = false;
            env.allowLocalModels = true;
            env.localModelPath = config.localModelPath;
        } else {
            env.allowLocalModels = false;
        }
        env.useBrowserCache = true; // Cache API: downloaded once, kept by the browser
        if (config.wasmPaths && env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.wasmPaths = config.wasmPaths;
        }
        const progress = (p) => {
            if (!p || typeof p !== 'object') return;
            post({
                type: OUT.PROGRESS,
                id,
                status: p.status || null,
                file: p.file || p.name || null,
                loaded: typeof p.loaded === 'number' ? p.loaded : null,
                total: typeof p.total === 'number' ? p.total : null,
            });
        };
        const pipe = await T.pipeline('automatic-speech-recognition', config.modelId, {
            revision: config.revision,
            dtype: config.dtype,
            device: config.device,
            progress_callback: progress,
        });
        // Warm-up: the first inference builds kernels and is several times slower than the rest.
        // Paying it now, on half a second of silence, means the person's first sentence is not
        // the slow one. Its "transcript" is thrown away unread.
        try {
            await pipe(new Float32Array(8000));
        } catch (err) {
            console.warn('[whisper-worker] warm-up failed (continuing):', err);
        }
        return pipe;
    })();
    try {
        asr = await loading;
        loadedModel = `${config.modelId}@${config.revision}`;
        post({
            type: OUT.READY,
            id,
            ms: Math.round(performance.now() - t0),
            backend: config.device,
            model: config.modelId,
        });
    } catch (err) {
        asr = null;
        post({ type: OUT.LOAD_ERROR, id, message: String((err && err.message) || err) });
    } finally {
        loading = null;
    }
}

async function transcribe(msg) {
    const { id } = msg;
    if (!asr) {
        post({ type: OUT.ERROR, id, message: 'The speech model is not loaded.' });
        return;
    }
    post({ type: OUT.STARTED, id });
    const t0 = performance.now();
    try {
        const audio = A.resample(msg.samples, msg.sampleRate, A.TARGET_RATE);
        const audioMs = Math.round((audio.length / A.TARGET_RATE) * 1000);
        // max_new_tokens: ~30 s of speech is ~100 tokens. Without a cap a decoding loop runs to the
        // model's limit — one test inference took 35 s for 3 s of audio, which in a headset reads
        // as the microphone hanging.
        const options = { task: 'transcribe', return_timestamps: false, max_new_tokens: 128 };
        if (msg.language) options.language = msg.language;
        if (audioMs > 30000) {
            options.chunk_length_s = 30;
            options.stride_length_s = 5;
        }
        const out = await asr(audio, options);
        if (cancelled.delete(id)) {
            post({ type: OUT.CANCELLED, id });
            return;
        }
        const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : (out && out.text) || '';
        post({
            type: OUT.DONE,
            id,
            text: String(text).trim(),
            ms: Math.round(performance.now() - t0),
            audioMs,
            language: msg.language || null,
        });
    } catch (err) {
        cancelled.delete(id);
        post({ type: OUT.ERROR, id, message: String((err && err.message) || err) });
    }
}

// One transcription at a time, in order; a cancel marks the id so its result is not sent.
let chain = Promise.resolve();

self.onmessage = (event) => {
    const msg = event.data;
    if (!P.isMessage(msg)) return;
    if (msg.type === IN.LOAD) {
        chain = chain.then(() => load(msg.id, msg.config || {}));
    } else if (msg.type === IN.TRANSCRIBE) {
        chain = chain.then(() =>
            cancelled.delete(msg.id) ? post({ type: OUT.CANCELLED, id: msg.id }) : transcribe(msg)
        );
    } else if (msg.type === IN.CANCEL) {
        cancelled.add(msg.id);
    }
};
