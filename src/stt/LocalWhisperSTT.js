/**
 * LocalWhisperSTT — ST2. On-device Whisper, shaped like the browser's SpeechRecognition.
 *
 * Why that shape. Three recognizers in this app — the mic button (src/main.js), the VR panel
 * (js/speech-service.js, which VR push-to-talk drives) and the companion's hands-free call
 * (src/CompanionMode.js) — were each written against `webkitSpeechRecognition`: `lang`,
 * `continuous`, `start()`/`stop()`/`abort()`, and `onstart`/`onresult`/`onerror`/`onend`. A
 * recognizer with the same surface lets each of them swap the class it constructs and keep
 * every line of its own endpointing, state machine and UI. The alternative — a second code path
 * in each — is three new sets of bugs in the code that already works on desktop and phone.
 *
 * What it does differently from the browser's, because Whisper is not a streaming recognizer:
 *
 *  - **No interim results.** The text arrives when the sentence is over. It never fakes one.
 *  - **`onaudioend` is the moment to say "Transcribing…".** The microphone has closed and the
 *    model is working; callers that show a status listen there.
 *  - **`confidence` is undefined.** Whisper has no calibrated per-utterance confidence, and a
 *    made-up percentage would be read as one. Callers treat a missing confidence as "no score".
 *  - **Push-to-talk keeps everything** between start() and stop() (`holdToTalk` or
 *    `endOnSilence = false`); the mic button stops itself after a pause; the hands-free call
 *    (`continuous`) cuts sentences with SpeechAudio's endpointer and stays open.
 *  - **Half-duplex.** While the app is speaking (its status indicator carries `speaking`), the
 *    hands-free and auto-stopping modes ignore the microphone, so her own voice from the
 *    headset's speakers is never transcribed into a new question.
 *  - **Two guards around the model** (SpeechAudio.gate before, judgeTranscript after): silence
 *    and Whisper's phantom phrases never become a chat message. A recording with nothing in it
 *    ends with the browser's own error, 'no-speech'.
 *
 * `NEXUS_STT` is the one entry point the app uses: `recognitionClass()` answers which class a
 * recognizer should construct right now (SttRouter decides), so switching the setting applies
 * to the next listen with no reload.
 *
 * Errors use the browser's names so the callers' existing handling applies: 'not-allowed'
 * (permission), 'audio-capture' (device), 'no-speech', 'aborted', 'network' (the model could not
 * be loaded or answered too late), 'service-not-allowed' (on-device chosen but cannot run here).
 * Each carries a `message` a person can read.
 */
(function (global) {
    'use strict';

    const NO_SPEECH_MS = 8000; // the browser's own timeout for "you said nothing"

    function lib(name) {
        return (global && global[name]) || null;
    }

    function readSttConfig() {
        try {
            const raw = global.localStorage && global.localStorage.getItem('stt_config');
            return raw ? JSON.parse(raw) || {} : {};
        } catch (_) {
            return {};
        }
    }

    function emitStatus(detail) {
        try {
            if (global && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
                global.dispatchEvent(new global.CustomEvent('nexus-stt', { detail }));
            }
        } catch (_) {
            /* a status listener's failure is not the recognizer's */
        }
    }

    /**
     * The app's language when a caller set none. Transformers.js does not detect the spoken
     * language when none is given — it assumes English — so an Italian speaker with an empty
     * `lang` would be transcribed as if speaking English. The app's own language setting is the
     * better answer (CompanionMode._srLang reads the same keys, for the same reason).
     */
    function appLanguage() {
        try {
            return (
                (global.AppLanguage && global.AppLanguage.code) ||
                global.localStorage.getItem('speech_lang') ||
                (global.navigator && global.navigator.language) ||
                ''
            );
        } catch (_) {
            return '';
        }
    }

    function appSpeaking() {
        try {
            const doc = global && global.document;
            const ind = doc && doc.getElementById('status-indicator');
            return !!(ind && ind.classList && ind.classList.contains('speaking'));
        } catch (_) {
            return false;
        }
    }

    // ---- the shared model ------------------------------------------------------------------

    let sharedModel = null;

    function siteConfig() {
        return (global && global.NEXUS_STT_CONFIG) || {};
    }

    /**
     * The model configuration for a language. ST17: the model depends on it — "Auto" runs
     * Moonshine for English and Whisper for everything else — so a transcription passes its own
     * language; a preload passes none and uses STT LANGUAGE (else the app's language).
     */
    function resolvedConfig(language) {
        const C = lib('NEXUS_WHISPER_CONFIG');
        const cfg = readSttConfig();
        const size = (cfg.wasm && cfg.wasm.modelSize) || null;
        return C ? C.resolve(siteConfig(), size, language || cfg.language || appLanguage()) : {};
    }

    function model() {
        if (!sharedModel) {
            const M = lib('NEXUS_WHISPER_MODEL');
            if (!M) throw new Error('WhisperModelManager is not loaded');
            sharedModel = M.create({ config: resolvedConfig });
            sharedModel.on((e) => {
                if (e.type === 'state') emitStatus({ type: 'model-state', state: e.state, message: e.message || null });
                else if (e.type === 'progress') {
                    emitStatus({ type: 'model-progress', state: e.state, loaded: e.loaded, total: e.total });
                }
            });
        }
        return sharedModel;
    }

    function micSessions() {
        const M = lib('NEXUS_MIC_SESSION');
        return M ? M.get() : null;
    }

    // ---- routing ---------------------------------------------------------------------------

    function decision() {
        const R = lib('NEXUS_STT_ROUTER');
        if (!R) return { engine: 'browser', reason: 'router-missing' };
        const loc = global && global.location;
        const forced = R.forcedFrom(loc && loc.search) || (siteConfig().forceLocal ? 'local' : null);
        return R.decide({ provider: readSttConfig().provider, forced, capabilities: R.capabilities(global) });
    }

    function nativeClass() {
        return (global && (global.SpeechRecognition || global.webkitSpeechRecognition)) || null;
    }

    // ---- results in the browser's shape ----------------------------------------------------

    function makeResult(text) {
        const alt = { transcript: text, confidence: undefined };
        const r = [alt];
        r.isFinal = true;
        r.item = (i) => r[i];
        return r;
    }

    function resultList(items) {
        const list = items.slice();
        list.item = (i) => list[i];
        return list;
    }

    // ---- ST10/ST15: one instrumented transcription, for every surface --------------------------

    function perf() {
        return lib('NEXUS_STT_PERF');
    }

    function nowMs() {
        return global && global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
    }

    /**
     * Gate → normalize → worker → judge, marking each stage on `trace` (when one is given) and
     * filing the worker's own timings beside them. Returns { analysis, gate, out, verdict, error }.
     * The guards and their order are exactly what the recognizer always did; only marks are added.
     */
    async function runTranscription(job) {
        const A = lib('NEXUS_STT_AUDIO');
        const t = job.trace || null;
        const mdl = job.model;
        if (t) t.mark('audio_analysis_started');
        const analysis = A ? A.analyze(job.samples, job.rate) : null;
        const g = A ? A.gate(analysis) : { ok: true };
        if (t) {
            t.mark('audio_analysis_completed');
            if (analysis)
                t.merge({ audioMs: analysis.durationMs, inputRate: job.rate, inputSamples: job.samples.length });
        }
        if (!g.ok) return { analysis, gate: g };
        if (typeof job.onQueued === 'function') job.onQueued(analysis);
        if (t) t.mark('audio_preprocessing_started');
        const audio = A ? A.normalize(job.samples) : job.samples;
        if (t) {
            t.mark('audio_preprocessing_completed');
            t.set('modelWarmAtStart', typeof mdl.isReady === 'function' ? mdl.isReady() : null);
            t.mark('worker_request_queued');
        }
        let out;
        try {
            // `transfer`: `audio` is a fresh copy made by normalize(), so the manager may hand it
            // to the worker without copying the recording once more.
            out = await mdl.transcribe(audio, job.rate, {
                language: job.language,
                transfer: audio !== job.samples,
                maxNewTokens: job.maxNewTokens || undefined,
            });
        } catch (error) {
            if (t) t.set('error', (error && (error.code || error.message)) || 'error');
            return { analysis, gate: g, error };
        }
        if (t) {
            t.mark('worker_inference_completed');
            t.merge({
                workerTimings: out.timings || null,
                pageTimings: out.page || null,
                loadTimings: (out.page && out.page.load && out.page.load.timings) || null,
                outputTokens: out.outputTokens == null ? null : out.outputTokens,
                maxNewTokens: out.maxNewTokens == null ? null : out.maxNewTokens,
                runtime: out.runtime || null,
            });
        }
        const verdict = A ? A.judgeTranscript(out.text, analysis) : { accept: !!out.text, text: out.text };
        if (t) {
            t.mark('transcript_validation_completed');
            t.merge({ accepted: !!verdict.accept, rejectedReason: verdict.accept ? null : verdict.reason });
        }
        return { analysis, gate: g, out, verdict };
    }

    /** The facts every trace carries: provider, model, language, runtime, where the page is. */
    function traceFacts(language) {
        const cfg = resolvedConfig(language);
        const P = perf();
        return {
            provider: 'local-whisper',
            model: cfg.model || null,
            family: cfg.family || null,
            modelChoice: cfg.choice || null,
            modelPickReason: cfg.pickReason || null,
            modelId: cfg.modelId || null,
            revision: cfg.revision || null,
            dtype: cfg.dtype || null,
            backend: cfg.device || null,
            runtimeVersion: (lib('NEXUS_WHISPER_CONFIG') || {}).RUNTIME_VERSION || null,
            language: language || null,
            xrMode: P ? P.xrMode(global) : null,
        };
    }

    /**
     * ST15. "Speech recognition is taking longer than expected": once stop → now passes the
     * warning threshold, tell the surfaces (window 'nexus-stt' { type: 'slow' }). A label only —
     * the transcription keeps running and is never cancelled by this.
     */
    function armSlowNotice(t) {
        const P = perf();
        if (!P || !t) return () => {};
        const warnAt = P.thresholds().sttWarningMs;
        const since = t.elapsedSince('recording_stopped') || 0;
        const timer = setTimeout(
            () => emitStatus({ type: 'slow', elapsedMs: Math.round(t.elapsedSince('recording_stopped') || 0) }),
            Math.max(0, warnAt - since)
        );
        return () => clearTimeout(timer);
    }

    // ---- the recognizer --------------------------------------------------------------------

    class WhisperRecognition {
        constructor(deps) {
            this.lang = '';
            this.continuous = false;
            this.interimResults = false;
            this.maxAlternatives = 1;
            this.endOnSilence = null; // null: stop after a pause unless continuous or holdToTalk
            this.holdToTalk = false;
            this.deviceId = null;
            this.isLocalWhisper = true;
            this.onstart = null;
            this.onaudiostart = null;
            this.onsoundstart = null;
            this.onspeechstart = null;
            this.onspeechend = null;
            this.onsoundend = null;
            this.onaudioend = null;
            this.onresult = null;
            this.onnomatch = null;
            this.onerror = null;
            this.onend = null;
            this._deps = deps || {};
            this._listeners = {};
            this._state = 'idle'; // idle | opening | capturing | finishing
            this._gen = 0;
        }

        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || new Set()).add(fn);
        }

        removeEventListener(type, fn) {
            if (this._listeners[type]) this._listeners[type].delete(fn);
        }

        _fire(type, extra) {
            const event = Object.assign({ type, target: this }, extra || {});
            const handler = this['on' + type];
            try {
                if (typeof handler === 'function') handler.call(this, event);
            } catch (err) {
                if (global && global.console) global.console.error(`[LocalWhisperSTT] on${type} threw:`, err);
            }
            for (const fn of Array.from(this._listeners[type] || [])) {
                try {
                    fn.call(this, event);
                } catch (_) {}
            }
        }

        _mode() {
            if (this.holdToTalk || this.endOnSilence === false) return 'hold';
            if (this.continuous) return 'continuous';
            return 'auto-stop';
        }

        start() {
            if (this._state !== 'idle') {
                const Err = global && global.DOMException;
                throw Err
                    ? new Err('recognition has already started', 'InvalidStateError')
                    : new Error('already started');
            }
            const gen = ++this._gen;
            this._state = 'opening';
            this._results = [];
            this._chunks = [];
            this._rejected = null;
            this._jobs = [];
            this._stopAsked = false;
            this._error = null;
            this._rate = 0;
            this._heardSound = false;
            this._heardSpeech = false;
            this._endpointer = null;
            const route = this._deps.route ? this._deps.route() : decision();
            if (route.engine === 'unavailable') {
                const R = lib('NEXUS_STT_ROUTER');
                const message = (R && R.UNAVAILABLE[route.reason]) || 'On-device speech recognition cannot run here.';
                Promise.resolve().then(() => this._failAndEnd(gen, 'service-not-allowed', message));
                return;
            }
            const mdl = this._deps.model || model();
            this._model = mdl;
            // Start the download now, not when the person stops talking: the first sentence is
            // spoken while it arrives, kept, and transcribed as soon as the model is ready.
            mdl.load().catch(() => {});
            const mics = this._deps.mic || micSessions();
            if (!mics) {
                Promise.resolve().then(() =>
                    this._failAndEnd(gen, 'service-not-allowed', 'On-device speech recognition is not loaded.')
                );
                return;
            }
            const mode = this._mode();
            const A = lib('NEXUS_STT_AUDIO');
            const cfg = readSttConfig();
            // ST15. The run's microphone moments, on this page's clock, for the first utterance's trace.
            this._perfRun = perf() ? { requestAt: nowMs() } : null;
            this._lease = mics.open({
                owner: 'whisper-recognition',
                deviceId: this.deviceId || cfg.microphoneDeviceId || null,
                onFrames: (samples, rate) => this._onFrames(gen, samples, rate),
                onEnded: (why) => {
                    if (gen !== this._gen || this._state === 'idle') return;
                    if (why === 'device-ended')
                        this._error = this._error || { error: 'audio-capture', message: 'The microphone stopped.' };
                    this._finishCapture(gen);
                },
            });
            this._lease.ready.then((r) => {
                if (gen !== this._gen) return;
                if (!r.ok) {
                    if (r.reason === 'cancelled') return this._end(gen);
                    const error =
                        r.reason === 'denied'
                            ? 'not-allowed'
                            : r.reason === 'unsupported'
                              ? 'service-not-allowed'
                              : 'audio-capture';
                    return this._failAndEnd(gen, error, r.message);
                }
                this._rate = r.sampleRate;
                this._state = 'capturing';
                if (this._perfRun) this._perfRun.captureAt = nowMs();
                this._startedAt = Date.now();
                if (mode !== 'hold' && A) this._endpointer = A.createEndpointer(r.sampleRate);
                this._fire('start');
                this._fire('audiostart');
                emitStatus({ type: 'recording', mode });
                if (mode === 'auto-stop') {
                    this._noSpeechTimer = setTimeout(() => {
                        if (gen === this._gen && this._state === 'capturing' && !this._heardSpeech)
                            this._finishCapture(gen);
                    }, NO_SPEECH_MS);
                }
                if (this._stopAsked) this._finishCapture(gen);
            });
        }

        stop() {
            if (this._state === 'idle' || this._state === 'finishing') return;
            this._stopAsked = true;
            if (this._state === 'opening') {
                // Released before the microphone opened (push-to-talk tapped): close the lease;
                // the stream, if it still arrives, is stopped on arrival. Nothing was recorded.
                if (this._lease) this._lease.close();
                return;
            }
            this._finishCapture(this._gen);
        }

        abort() {
            if (this._state === 'idle') return;
            const gen = this._gen;
            this._gen++; // every pending callback of this run is now stale
            if (this._lease) this._lease.close();
            if (this._model) this._model.cancel();
            clearTimeout(this._noSpeechTimer);
            this._state = 'idle';
            this._fireErrorEnd(gen, 'aborted', 'Speech recognition was stopped.');
        }

        _onFrames(gen, samples, rate) {
            if (gen !== this._gen || this._state !== 'capturing') return;
            if (this._perfRun && this._perfRun.firstFrameAt == null) this._perfRun.firstFrameAt = nowMs();
            const mode = this._mode();
            const maxMs = (resolvedConfig().maxRecordMs || 30000) + 100;
            if (mode === 'hold') {
                this._chunks.push(samples);
                if (!this._heardSound) {
                    this._heardSound = true;
                    this._fire('soundstart');
                }
                if (Date.now() - this._startedAt > maxMs) this._finishCapture(gen);
                return;
            }
            const suppress = this._deps.suppressWhile || appSpeaking;
            if (suppress()) {
                // Her own voice is playing: do not listen to it. A sentence in progress is dropped.
                this._endpointer.reset();
                return;
            }
            for (const ev of this._endpointer.push(samples)) {
                if (ev.type === 'speech-start') {
                    this._heardSpeech = true;
                    clearTimeout(this._noSpeechTimer);
                    this._fire('soundstart');
                    this._fire('speechstart');
                    emitStatus({ type: 'speech-start' });
                } else if (ev.type === 'speech-end') {
                    this._fire('speechend');
                    this._queue(gen, ev.samples, rate, { endpointed: true });
                    if (mode === 'auto-stop') this._finishCapture(gen);
                }
            }
        }

        _queue(gen, samples, rate, how) {
            const job = this._transcribe(gen, samples, rate, this._newTrace(how || {}));
            this._jobs.push(job);
            return job;
        }

        /**
         * ST15. One trace per utterance. The first utterance of a run starts at the microphone
         * request and carries its mic timings; later ones (the hands-free call) start at their own
         * end of speech, with no mic marks (the mic opened long before). For an endpointed sentence
         * "recording stopped" is the endpoint, and the trailing silence it waited for is reported
         * separately — the time the person spoke never counts as latency.
         */
        _newTrace(how) {
            const P = perf();
            if (!P) return null;
            const nowT = nowMs();
            const run = this._perfRun;
            const first = !!run && !run.used;
            const t = P.createTrace({ surface: this.perfSurface || 'app', startAt: first ? run.requestAt : nowT });
            if (first) {
                run.used = true;
                t.mark('microphone_request_started', run.requestAt);
                if (run.captureAt != null) {
                    t.mark('microphone_permission_completed', run.captureAt);
                    t.mark('microphone_capture_started', run.captureAt);
                }
                if (run.firstFrameAt != null) t.mark('first_audio_frame', run.firstFrameAt);
            }
            t.mark('recording_stopped', nowT);
            const A = lib('NEXUS_STT_AUDIO');
            t.merge(traceFacts(this.lang || appLanguage()));
            t.set('mode', this._mode());
            if (how.endpointed && A) t.set('endpointWaitMs', A.ENDPOINT_DEFAULTS.endSilenceMs);
            t.stopFrames = P.sampleFrames(global);
            return t;
        }

        async _transcribe(gen, samples, rate, trace) {
            const A = lib('NEXUS_STT_AUDIO');
            const disarm = armSlowNotice(trace);
            const finishTrace = (extra) => {
                disarm();
                if (!trace) return;
                const frames = trace.stopFrames ? trace.stopFrames() : null;
                trace.end(Object.assign({ frames }, extra || {}));
            };
            const res = await runTranscription({
                samples,
                rate,
                model: this._model,
                trace,
                language: A ? A.whisperLanguage(this.lang || appLanguage()) : null,
                onQueued: () => emitStatus({ type: 'transcribing' }),
            });
            if (!res.gate.ok) {
                this._rejected = res.gate.reason;
                emitStatus({ type: 'rejected', reason: res.gate.reason, stage: 'audio' });
                finishTrace();
                return;
            }
            if (res.error) {
                const err = res.error;
                if (gen !== this._gen || (err && err.code === 'cancelled')) {
                    finishTrace({ error: 'cancelled' });
                    return;
                }
                const loadFailed =
                    err && (err.code === 'load-failed' || err.code === 'timeout' || err.code === 'worker-reset');
                const message = loadFailed
                    ? 'The on-device speech model could not be loaded: ' + (err.message || 'unknown error') + '.'
                    : 'On-device speech recognition failed: ' + ((err && err.message) || 'unknown error') + '.';
                this._error = { error: 'network', message };
                emitStatus({ type: 'error', message });
                finishTrace({ error: err.code || 'error' });
                return;
            }
            if (gen !== this._gen) {
                finishTrace({ error: 'cancelled' });
                return;
            }
            const out = res.out;
            const verdict = res.verdict;
            if (!verdict.accept) {
                this._rejected = verdict.reason;
                emitStatus({ type: 'rejected', reason: verdict.reason, stage: 'transcript', ms: out.ms });
                finishTrace();
                return;
            }
            this._results.push(makeResult(verdict.text));
            emitStatus({ type: 'result', text: verdict.text, ms: out.ms, audioMs: out.audioMs });
            this._fire('result', { results: resultList(this._results), resultIndex: this._results.length - 1 });
            // The handlers above put the text on screen synchronously (the mic button's input, the
            // VR panel's transcript, the companion's input): this is when it was displayed.
            if (trace) {
                trace.mark('transcript_displayed');
                finishTrace();
                const P = perf();
                if (P && trace.trace.surface !== 'settings-mic-test') P.watchConversation(trace);
            }
        }

        _finishCapture(gen) {
            if (gen !== this._gen || (this._state !== 'capturing' && this._state !== 'opening')) return;
            const wasCapturing = this._state === 'capturing';
            this._state = 'finishing';
            clearTimeout(this._noSpeechTimer);
            if (this._lease) this._lease.close();
            if (this._mode() === 'hold' && this._chunks.length) {
                const A = lib('NEXUS_STT_AUDIO');
                const all = A ? A.concat(this._chunks) : this._chunks[0];
                this._chunks = [];
                this._queue(gen, all, this._rate);
            } else if (this._endpointer) {
                for (const ev of this._endpointer.flush()) {
                    if (ev.type === 'speech-end') {
                        this._fire('speechend');
                        this._queue(gen, ev.samples, this._rate);
                    }
                }
            }
            if (wasCapturing) {
                if (this._heardSound || this._heardSpeech) this._fire('soundend');
                this._fire('audioend');
            }
            Promise.all(this._jobs).then(() => {
                if (gen !== this._gen) return;
                if (this._error) return this._failAndEnd(gen, this._error.error, this._error.message);
                if (!this._results.length && wasCapturing) {
                    return this._failAndEnd(gen, 'no-speech', 'No speech was heard.', this._rejected);
                }
                this._end(gen);
            });
        }

        _failAndEnd(gen, error, message, detail) {
            if (gen !== this._gen) return;
            this._fireErrorEnd(gen, error, message, detail);
        }

        _fireErrorEnd(gen, error, message, detail) {
            this._state = 'idle';
            this._fire('error', { error, message, detail: detail || null });
            this._fire('end');
            emitStatus({ type: 'end', error });
        }

        _end(gen) {
            if (gen !== this._gen) return;
            this._state = 'idle';
            this._fire('end');
            emitStatus({ type: 'end' });
        }
    }

    // ---- the facade ------------------------------------------------------------------------

    /**
     * Transcribe samples already in hand (the diagnostics page, tests): the same guards as a
     * recording. Resolves { accept, text, reason, ms, audioMs, analysis }.
     */
    async function transcribeSamples(samples, sampleRate, opts) {
        const o = opts || {};
        const A = lib('NEXUS_STT_AUDIO');
        const language = A.whisperLanguage(o.language || appLanguage());
        if (o.trace) o.trace.merge(traceFacts(language));
        const res = await runTranscription({
            samples,
            rate: sampleRate,
            model: model(),
            trace: o.trace,
            language,
            maxNewTokens: o.maxNewTokens,
        });
        if (!res.gate.ok) return { accept: false, reason: res.gate.reason, analysis: res.analysis };
        if (res.error) throw res.error;
        const out = res.out;
        return Object.assign(
            {
                raw: out.text,
                ms: out.ms,
                audioMs: out.audioMs,
                analysis: res.analysis,
                timings: out.timings || null,
                page: out.page || null,
                outputTokens: out.outputTokens == null ? null : out.outputTokens,
            },
            res.verdict
        );
    }

    const api = {
        Recognition: WhisperRecognition,
        decision,
        /** true when the app's recognizers should use on-device Whisper right now. */
        isLocal: () => decision().engine !== 'browser',
        /**
         * The class a recognizer should construct now: on-device Whisper (or its "cannot run
         * here" form), else the browser's own, else null.
         */
        recognitionClass() {
            return decision().engine === 'browser' ? nativeClass() : WhisperRecognition;
        },
        model,
        preload: () => model().load(),
        status() {
            const m = sharedModel;
            return {
                engine: decision().engine,
                model: m ? m.state() : 'not-installed',
                progress: m ? m.progress() : null,
                error: m ? m.lastError() : null,
                config: resolvedConfig(),
            };
        },
        transcribeSamples,
        runTranscription,
        traceFacts,
        readSttConfig,
        /**
         * Forget the downloaded model (Settings ▸ "Remove downloaded model", stt-check.html).
         * Transformers.js keeps its files in the Cache API under 'transformers-cache'. Resolves
         * with the number of files removed.
         */
        async clearCache() {
            if (sharedModel) sharedModel.unload();
            let removed = 0;
            const cs = global && global.caches;
            if (!cs) return removed;
            for (const name of await cs.keys()) {
                if (!/transformers/i.test(name)) continue;
                const cache = await cs.open(name);
                removed += (await cache.keys()).length;
                await cs.delete(name);
            }
            emitStatus({ type: 'model-state', state: 'not-installed' });
            return removed;
        },
        _resetForTests() {
            sharedModel = null;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
