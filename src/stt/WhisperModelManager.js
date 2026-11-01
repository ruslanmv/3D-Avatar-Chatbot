/**
 * WhisperModelManager — ST1. The page's side of the Whisper worker.
 *
 * One worker, one model, shared by every surface that listens (the mic button, the VR panel's
 * push-to-talk, the companion's hands-free call). This module is what makes "shared" safe:
 *
 *  - **state** is one of not-installed → downloading → loading → ready, or error, and listeners
 *    hear every change (Settings draws the download bar from it);
 *  - **load()** is deduplicated: three surfaces asking at once start one download;
 *  - **transcribe()** answers the request it was asked, by id — a result that arrives after a
 *    cancel, or for an older request, is dropped here and never reaches the chat;
 *  - **timeouts**: a load or an inference that never answers terminates the worker and starts
 *    a fresh one next time, so one wedged model cannot make the microphone dead for the rest
 *    of the session. Inference cannot be interrupted inside ONNX Runtime; terminating the worker
 *    is the only real cancel, and it is the timeout's.
 *
 * The Worker constructor is injected (`createWorker`), so the whole state machine is tested in
 * jsdom with a scripted fake worker.
 */
(function (global) {
    'use strict';

    const STATES = Object.freeze(['not-installed', 'downloading', 'loading', 'ready', 'error']);

    function protocol() {
        return (global && global.NEXUS_WHISPER_PROTOCOL) || null;
    }

    function defaultWorker() {
        const base = (global && global.document && global.document.baseURI) || '';
        return new global.Worker(new URL('workers/whisper-worker.js', base), { type: 'module', name: 'whisper' });
    }

    /**
     * create({ config, createWorker, now, setTimeout, clearTimeout })
     * `config` is QuestWhisperConfig.resolve(...) — or a function returning it, read on each load.
     */
    function create(deps) {
        const d = deps || {};
        const P = d.protocol || protocol();
        if (!P) throw new Error('WhisperProtocol is not loaded');
        const IN = P.TO_WORKER;
        const OUT = P.FROM_WORKER;
        const makeWorker = d.createWorker || defaultWorker;
        const later = d.setTimeout || ((fn, ms) => setTimeout(fn, ms));
        const cancelLater = d.clearTimeout || ((t) => clearTimeout(t));
        const now = d.now || (() => Date.now());
        // ST17. The model can depend on the language (Moonshine for English), so the config is
        // read for the language of the transcription being served (null for a plain preload).
        let configLanguage = null;
        const configOf = () => (typeof d.config === 'function' ? d.config(configLanguage) : d.config) || {};

        let worker = null;
        let state = 'not-installed';
        let lastError = null;
        let loadPromise = null;
        let loadKey = null;
        let readyInfo = null;
        const files = new Map(); // file → { loaded, total }
        const pending = new Map(); // id → { resolve, reject, timer, kind }
        const listeners = new Set();

        function emit(event) {
            for (const fn of Array.from(listeners)) {
                try {
                    fn(event);
                } catch (err) {
                    if (global && global.console) global.console.warn('[WhisperModelManager] listener failed:', err);
                }
            }
        }

        function setState(next, extra) {
            if (state === next && !extra) return;
            state = next;
            emit(Object.assign({ type: 'state', state: next }, extra || {}));
        }

        function progress() {
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
                loaded += f.loaded || 0;
                total += f.total || 0;
            }
            return { loaded, total, fraction: total ? Math.min(1, loaded / total) : null };
        }

        function settle(id, fn, value) {
            const p = pending.get(id);
            if (!p) return false; // stale or cancelled: nobody is waiting, drop it
            pending.delete(id);
            cancelLater(p.timer);
            p[fn](value);
            return true;
        }

        function teardown(reason) {
            if (worker) {
                try {
                    worker.terminate();
                } catch (_) {}
            }
            worker = null;
            loadPromise = null;
            loadKey = null;
            readyInfo = null;
            files.clear();
            for (const [id, p] of Array.from(pending)) {
                pending.delete(id);
                cancelLater(p.timer);
                p.reject(Object.assign(new Error(reason), { code: 'worker-reset' }));
            }
        }

        function onMessage(event) {
            const m = event && event.data;
            if (!P.isMessage(m)) return;
            switch (m.type) {
                case OUT.PROGRESS: {
                    if (m.file && (m.loaded != null || m.total != null)) {
                        const f = files.get(m.file) || { loaded: 0, total: 0 };
                        if (m.total != null) f.total = m.total;
                        if (m.loaded != null) f.loaded = m.loaded;
                        files.set(m.file, f);
                    }
                    // Files arrive one after another, so "every file done" happens several times on
                    // the way. Only the runtime's own 'ready' (all files in, session being built and
                    // warmed up) moves the state on; until then it is downloading.
                    if (m.status === 'ready') setState('loading');
                    else if (state !== 'downloading' && state !== 'loading') setState('downloading');
                    emit(Object.assign({ type: 'progress', state }, progress(), { file: m.file }));
                    break;
                }
                case OUT.READY:
                    readyInfo = {
                        ms: m.ms,
                        backend: m.backend,
                        model: m.model,
                        cached: !!m.cached,
                        // ST10 (additive): the worker's own load split, and what runtime it built.
                        timings: m.timings || (readyInfo && readyInfo.timings) || null,
                        runtime: m.runtime || (readyInfo && readyInfo.runtime) || null,
                    };
                    setState('ready', { info: readyInfo });
                    settle(m.id, 'resolve', readyInfo);
                    break;
                case OUT.LOAD_ERROR:
                    lastError = m.message;
                    settle(m.id, 'reject', Object.assign(new Error(m.message), { code: 'load-failed' }));
                    teardown('load failed');
                    setState('error', { message: m.message });
                    break;
                case OUT.STARTED:
                    emit({ type: 'transcribing', id: m.id });
                    break;
                case OUT.DONE:
                    settle(m.id, 'resolve', {
                        text: m.text || '',
                        ms: m.ms,
                        audioMs: m.audioMs,
                        language: m.language,
                        // ST10 (additive; absent from an older worker, so callers must not need them)
                        timings: m.timings || null,
                        outputTokens: m.outputTokens == null ? null : m.outputTokens,
                        maxNewTokens: m.maxNewTokens == null ? null : m.maxNewTokens,
                        runtime: m.runtime || null,
                    });
                    break;
                case OUT.ERROR:
                    settle(m.id, 'reject', Object.assign(new Error(m.message), { code: 'inference-failed' }));
                    break;
                case OUT.CANCELLED:
                    settle(m.id, 'reject', Object.assign(new Error('cancelled'), { code: 'cancelled' }));
                    break;
            }
        }

        function ensureWorker() {
            if (worker) return worker;
            worker = makeWorker();
            worker.onmessage = onMessage;
            worker.onerror = (e) => {
                // A worker that failed to start (blocked URL, no module-worker support) says only
                // this; without it the manager would wait for a load that never answers.
                const message = (e && e.message) || 'The speech worker could not start.';
                lastError = message;
                teardown(message);
                setState('error', { message });
            };
            return worker;
        }

        function request(kind, msg, timeoutMs, transfer) {
            return new Promise((resolve, reject) => {
                const timer = later(() => {
                    if (!pending.has(msg.id)) return;
                    const message =
                        kind === 'load'
                            ? 'The speech model took too long to load.'
                            : 'Speech recognition took too long and was restarted.';
                    lastError = message;
                    pending.delete(msg.id);
                    teardown(message);
                    setState(kind === 'load' ? 'error' : 'not-installed', { message });
                    reject(Object.assign(new Error(message), { code: 'timeout' }));
                }, timeoutMs);
                pending.set(msg.id, { resolve, reject, timer, kind });
                try {
                    ensureWorker().postMessage(msg, transfer || []);
                } catch (err) {
                    pending.delete(msg.id);
                    cancelLater(timer);
                    reject(err);
                }
            });
        }

        /** Download (once) and prepare the model. Resolves with { ms, backend, model }. */
        function keyOf(cfg) {
            return `${cfg.modelId}@${cfg.revision}@${cfg.runtimeUrl}@${cfg.localModelPath || ''}`;
        }

        function load() {
            const cfg = configOf();
            const key = keyOf(cfg);
            if (loadPromise && loadKey === key) return loadPromise;
            if (loadPromise && loadKey !== key) teardown('model changed');
            lastError = null;
            files.clear();
            if (state !== 'ready') setState('downloading');
            loadKey = key;
            const id = P.nextId('load');
            loadPromise = request('load', { type: IN.LOAD, id, config: cfg }, cfg.loadTimeoutMs || 180000);
            loadPromise.catch(() => {
                if (loadKey === key) {
                    loadPromise = null;
                    loadKey = null;
                }
            });
            return loadPromise;
        }

        const active = new Set(); // transcriptions this manager will still answer

        /**
         * Transcribe mono samples at any rate. Waits for the model first (a sentence spoken
         * while it downloads is kept and transcribed once it is ready). Resolves with
         * { text, ms, audioMs }; rejects with code 'cancelled' after cancel().
         */
        async function transcribe(samples, sampleRate, opts) {
            const o = opts || {};
            const id = P.nextId('tx');
            active.add(id);
            // ST10. Page-side measurements, all on this page's clock: whether the model was warm
            // when asked, how long the request waited for it, and the worker round trip.
            const tCall = now();
            if (o.language) configLanguage = o.language;
            const cold = state !== 'ready' || loadKey !== keyOf(configOf());
            try {
                await load();
                const modelWaitMs = Math.round(now() - tCall);
                if (!active.has(id)) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
                const cfg = configOf();
                // The caller keeps its own buffer, unless it says it is a throw-away copy already
                // (`transfer`), which saves one copy of the recording on the way to the worker.
                const buf = o.transfer && samples instanceof Float32Array ? samples : Float32Array.from(samples);
                const msg = P.transcribeRequest(id, buf, sampleRate, o.language || null);
                const maxNewTokens = o.maxNewTokens || cfg.maxNewTokens;
                if (maxNewTokens) msg.maxNewTokens = maxNewTokens;
                msg.family = cfg.family || 'whisper';
                const t0 = now();
                const result = await request('transcribe', msg, cfg.transcribeTimeoutMs || 60000, [buf.buffer]);
                const roundTripMs = Math.round(now() - t0);
                const workerTotal = result.timings && result.timings.workerTotalMs;
                result.page = {
                    cold,
                    modelWaitMs,
                    roundTripMs,
                    // Round trip minus the worker's own total: message delivery both ways (and any
                    // structured-clone cost). Never negative; null when the worker did not say.
                    messagingMs: workerTotal == null ? null : Math.max(0, roundTripMs - workerTotal),
                };
                if (cold && readyInfo) result.page.load = readyInfo;
                emit({ type: 'transcribed', id, ms: result.ms, audioMs: result.audioMs, wallMs: roundTripMs, result });
                return result;
            } finally {
                active.delete(id);
            }
        }

        /** Drop every transcription in flight: none of their results will be delivered. */
        function cancel() {
            for (const id of Array.from(active)) {
                active.delete(id);
                if (worker && pending.has(id)) {
                    try {
                        worker.postMessage({ type: IN.CANCEL, id });
                    } catch (_) {}
                }
                settle(id, 'reject', Object.assign(new Error('cancelled'), { code: 'cancelled' }));
            }
        }

        /** Release the worker and the model's memory. The next load starts again from the cache. */
        function unload() {
            teardown('unloaded');
            setState('not-installed');
        }

        return {
            STATES,
            load,
            transcribe,
            cancel,
            unload,
            state: () => state,
            isReady: () => state === 'ready',
            progress,
            info: () => readyInfo,
            lastError: () => lastError,
            on(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
        };
    }

    const api = { STATES, create };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WHISPER_MODEL = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
