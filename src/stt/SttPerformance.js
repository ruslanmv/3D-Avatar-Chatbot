/**
 * SttPerformance — ST10/ST11/ST15. Where the time goes between "I stopped talking" and the text.
 *
 * On a physical Quest 3, on-device Whisper felt slow, and nothing said why: the model download,
 * the runtime starting, the warm-up, the microphone, the worker's queue, the inference itself, or
 * — after the text — the AI's answer and the voice. Each looks the same from inside a headset.
 * This module is the one place those moments are recorded, for every surface that listens (the
 * Settings test, the mic button, VR push-to-talk, the companion's hands-free call), so a person
 * can see — and copy — which stage was slow.
 *
 * Rules it keeps, because a measurement that lies is worse than none:
 *
 *  - **One clock per number.** Marks are `performance.now()` on this page. The worker's numbers
 *    are durations it measured on its own clock and sent back; no timestamp ever crosses from
 *    the worker, because the two clocks have different time origins.
 *  - **Missing is `null`, never 0.** A stage that did not happen in a run is reported as
 *    'not_measured'. Zero would read as "instant".
 *  - **No sums of overlapping spans.** The primary number, stop → transcript, is one interval
 *    between two marks; the components are shown beside it as evidence, not added up into it.
 *  - **The time spent speaking is not latency.** stop → transcript starts when the recording
 *    stopped (push-to-talk released, Stop pressed, or the endpointer's end of speech — its
 *    trailing-silence wait is reported separately), never when the recording started.
 *  - **Cheap, and only while measuring.** A trace is a few numbers. The frame sampler runs only
 *    between a trace's start and its end; nothing samples while nobody is testing.
 *  - **Classification never acts.** "Slow" is a label: no threshold cancels a transcription.
 *
 * Dual export (window.NEXUS_STT_PERF / module.exports); everything that judges is pure and tested.
 */
(function (global) {
    'use strict';

    const STAGES = Object.freeze([
        'test_started',
        'microphone_request_started',
        'microphone_permission_completed',
        'microphone_capture_started',
        'first_audio_frame',
        'recording_stopped',
        'audio_analysis_started',
        'audio_analysis_completed',
        'audio_preprocessing_started',
        'audio_preprocessing_completed',
        'model_load_started',
        'model_download_completed',
        'model_runtime_ready',
        'model_warmup_completed',
        'worker_request_queued',
        'worker_inference_started',
        'worker_inference_completed',
        'transcript_validation_completed',
        'transcript_displayed',
        'chat_message_submitted',
        'llm_response_received',
        'tts_playback_started',
        'test_completed',
    ]);

    const DEFAULT_THRESHOLDS = Object.freeze({
        sttWarningMs: 3000,
        sttCriticalMs: 8000,
        firstAudioWarningMs: 2000,
        conversationWarningMs: 12000,
    });

    const THRESHOLD_KEY = 'nexus_stt_perf_thresholds';
    const HISTORY_MAX = 30;
    const NM = 'not_measured';

    function clock() {
        try {
            if (global && global.performance && typeof global.performance.now === 'function') {
                return global.performance.now();
            }
        } catch (_) {}
        return Date.now();
    }

    function round(n) {
        return n == null || !Number.isFinite(n) ? null : Math.round(n);
    }

    // ---- thresholds ------------------------------------------------------------------------

    function thresholds() {
        let saved = {};
        try {
            saved = JSON.parse((global.localStorage && global.localStorage.getItem(THRESHOLD_KEY)) || '{}') || {};
        } catch (_) {}
        const out = Object.assign({}, DEFAULT_THRESHOLDS);
        for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
            if (Number.isFinite(saved[k]) && saved[k] > 0) out[k] = saved[k];
        }
        if (out.sttCriticalMs <= out.sttWarningMs)
            out.sttCriticalMs = Math.max(DEFAULT_THRESHOLDS.sttCriticalMs, out.sttWarningMs * 2);
        return out;
    }

    function setThresholds(patch) {
        const next = Object.assign({}, thresholds(), patch || {});
        try {
            global.localStorage.setItem(THRESHOLD_KEY, JSON.stringify(next));
        } catch (_) {}
        return thresholds();
    }

    /** fast | slow | very_slow | failed | not_measured. Pure. A label, never an action. */
    function classify(sttMs, t, failed) {
        const th = Object.assign({}, DEFAULT_THRESHOLDS, t || {});
        if (failed) return 'failed';
        if (sttMs == null || !Number.isFinite(sttMs) || sttMs < 0) return 'not_measured';
        if (sttMs <= th.sttWarningMs) return 'fast';
        if (sttMs <= th.sttCriticalMs) return 'slow';
        return 'very_slow';
    }

    // ---- traces ----------------------------------------------------------------------------

    let seq = 0;
    const listeners = new Set();
    const history = [];

    function emit(event) {
        for (const fn of Array.from(listeners)) {
            try {
                fn(event);
            } catch (_) {}
        }
        try {
            if (global && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
                global.dispatchEvent(new global.CustomEvent('nexus-stt-perf', { detail: event }));
            }
        } catch (_) {}
    }

    /**
     * A trace for one utterance. `surface`: settings-mic-test | mic-button | vr-ptt | vr-panel |
     * companion | stt-check | benchmark. Marks are kept once (the first time a stage happens),
     * `data` holds facts (model, language, worker timings), `end()` computes metrics, files it in
     * the bounded history and tells listeners.
     */
    function createTrace(opts) {
        const o = opts || {};
        const now = o.now || clock;
        // `startAt`: the trace may begin earlier than its creation (a recognizer run starts at
        // the microphone request; its trace is made once there is an utterance to time).
        const t0 = o.startAt != null ? o.startAt : now();
        const trace = {
            id: `stt${++seq}-${Date.now().toString(36)}`,
            surface: o.surface || 'unknown',
            startedAtIso: new Date().toISOString(),
            marks: {},
            data: Object.assign({}, o.data || {}),
            ended: false,
        };
        const api = {
            id: trace.id,
            trace,
            now,
            mark(stage, at) {
                if (trace.marks[stage] == null) trace.marks[stage] = (at != null ? at : now()) - t0;
                return api;
            },
            has: (stage) => trace.marks[stage] != null,
            set(key, value) {
                trace.data[key] = value;
                return api;
            },
            merge(obj) {
                Object.assign(trace.data, obj || {});
                return api;
            },
            elapsedSince(stage) {
                return trace.marks[stage] == null ? null : now() - t0 - trace.marks[stage];
            },
            end(extra) {
                if (trace.ended) return trace.result;
                trace.ended = true;
                if (extra) Object.assign(trace.data, extra);
                api.mark('test_completed');
                trace.result = summarize(trace, o.thresholds || thresholds());
                record(trace.result);
                return trace.result;
            },
        };
        api.mark('test_started', t0);
        return api;
    }

    function span(marks, a, b) {
        const x = marks[a];
        const y = marks[b];
        return x == null || y == null ? null : round(y - x);
    }

    /**
     * Metrics from a trace. Pure. Every value is a measured interval or null — see the header.
     */
    function metrics(trace) {
        const m = trace.marks || {};
        const d = trace.data || {};
        const wt = d.workerTimings || {};
        const page = d.pageTimings || {};
        const load = d.loadTimings || {};
        const displayed = m.transcript_displayed != null ? 'transcript_displayed' : 'transcript_validation_completed';
        const sttMs = span(m, 'recording_stopped', displayed);
        const audioMs = d.audioMs != null ? round(d.audioMs) : null;
        const inferenceMs = wt.inferenceMs != null ? round(wt.inferenceMs) : null;
        return {
            micAcquisitionMs: span(m, 'microphone_request_started', 'microphone_capture_started'),
            firstAudioFrameMs: span(m, 'microphone_capture_started', 'first_audio_frame'),
            recordedAudioMs: audioMs,
            endpointWaitMs: d.endpointWaitMs != null ? round(d.endpointWaitMs) : null,
            stopToWorkMs: span(m, 'recording_stopped', 'worker_request_queued'),
            analysisMs: span(m, 'audio_analysis_started', 'audio_analysis_completed'),
            preprocessingMs: span(m, 'audio_preprocessing_started', 'audio_preprocessing_completed'),
            workerResampleMs: wt.resampleMs != null ? round(wt.resampleMs) : null,
            modelWaitMs: page.modelWaitMs != null ? round(page.modelWaitMs) : null,
            modelDownloadMs: load.downloadMs != null ? round(load.downloadMs) : null,
            modelInitMs: load.initMs != null ? round(load.initMs) : null,
            modelWarmupMs: load.warmupMs != null ? round(load.warmupMs) : null,
            modelWarmAtStart: d.modelWarmAtStart == null ? null : !!d.modelWarmAtStart,
            workerQueueMs: wt.workerQueueMs != null ? round(wt.workerQueueMs) : null,
            inferenceMs,
            workerRoundTripMs: page.roundTripMs != null ? round(page.roundTripMs) : null,
            messagingMs: page.messagingMs != null ? round(page.messagingMs) : null,
            postprocessingMs: span(m, 'worker_inference_completed', 'transcript_validation_completed'),
            displayDelayMs: span(m, 'transcript_validation_completed', 'transcript_displayed'),
            sttMs,
            realTimeFactor: inferenceMs != null && audioMs ? Math.round((inferenceMs / audioMs) * 100) / 100 : null,
            outputTokens: d.outputTokens == null ? null : d.outputTokens,
            submitToLlmMs: span(m, 'chat_message_submitted', 'llm_response_received'),
            llmToVoiceMs: span(m, 'llm_response_received', 'tts_playback_started'),
            // From the end of speech to her first audible word: the whole conversation, kept apart.
            stopToVoiceMs: span(m, 'recording_stopped', 'tts_playback_started'),
            frames: d.frames || null,
        };
    }

    /**
     * What probably made it slow, from the evidence only. Pure. Answers
     * { likely_bottleneck, confidence, suggestions } — confidence 'dominant' when one measured
     * stage is at least half of stop → transcript, 'partial' at a third, otherwise 'mixed' or
     * 'insufficient-data'. Never one proven cause the numbers do not support.
     */
    function diagnose(mx, ctx) {
        const x = mx || {};
        const c = ctx || {};
        const th = Object.assign({}, DEFAULT_THRESHOLDS, c.thresholds || {});
        const out = { likely_bottleneck: 'none', confidence: 'insufficient-data', suggestions: [] };
        const say = (s) => out.suggestions.push(s);
        if (x.sttMs == null) {
            say('The run did not reach a transcript, so no latency could be measured.');
            return out;
        }
        const parts = [
            ['model_load', x.modelWaitMs],
            ['inference', x.inferenceMs],
            ['worker_queue', x.workerQueueMs],
            ['messaging', x.messagingMs],
            ['audio_processing', (x.analysisMs || 0) + (x.preprocessingMs || 0) + (x.workerResampleMs || 0) || null],
            ['postprocessing', (x.postprocessingMs || 0) + (x.displayDelayMs || 0) || null],
        ].filter(([, v]) => v != null && v > 0);
        if (!parts.length) {
            out.likely_bottleneck = 'unknown';
            say('No stage timings were reported for this run (an older worker, or the browser recognizer).');
        } else {
            parts.sort((a, b) => b[1] - a[1]);
            const [name, ms] = parts[0];
            const share = ms / x.sttMs;
            out.likely_bottleneck = name;
            out.confidence = share >= 0.5 ? 'dominant' : share >= 0.33 ? 'partial' : 'mixed';
        }
        if (c.failed) {
            say('The run failed before a usable transcript; the error in the report says where.');
            return out;
        }
        const slow = x.sttMs > th.sttWarningMs;
        if (out.likely_bottleneck === 'model_load' && out.confidence !== 'mixed') {
            say('Most of the delay came from loading the model. Run the test again with the model warm.');
        }
        if (out.likely_bottleneck === 'inference' && slow) {
            say(
                'Most of the delay occurred inside Whisper inference. Compare Tiny with Base and compare 2D with immersive VR.'
            );
            if (x.realTimeFactor != null && x.realTimeFactor > 1) {
                say(
                    'Inference ran slower than real time (RTF > 1): the model is too heavy for this device as configured.'
                );
            }
        }
        if (out.likely_bottleneck === 'worker_queue' && x.workerQueueMs > 300) {
            say(
                'The request waited behind another transcription in the worker. Avoid starting a new test while one is running.'
            );
        }
        if (x.micAcquisitionMs != null && x.micAcquisitionMs > 1500) {
            say('Microphone setup took unusually long. Check microphone permissions and device state.');
        }
        if (c.xrMode && c.xrMode !== 'browser-2d' && out.likely_bottleneck === 'inference' && slow) {
            say(
                'This ran during XR rendering. Compare the same phrase in the 2D browser to see whether rendering slows inference.'
            );
        }
        if (!slow && x.stopToVoiceMs != null && x.stopToVoiceMs > th.conversationWarningMs) {
            say(
                'Speech recognition completed quickly. The delay occurred after transcription, during the AI response or voice.'
            );
        }
        if (x.frames && x.frames.longGaps > 0 && slow) {
            say(`The page skipped frames during the test (${x.frames.longGaps} gaps over 50 ms): the device was busy.`);
        }
        if (!out.suggestions.length)
            say(
                slow ? 'No single stage dominates; compare several runs.' : 'Speech recognition was within the target.'
            );
        return out;
    }

    function summarize(trace, th) {
        const mx = metrics(trace);
        const failed = !!trace.data.error;
        const status = classify(mx.sttMs, th, failed);
        return {
            id: trace.id,
            surface: trace.surface,
            startedAtIso: trace.startedAtIso,
            status,
            thresholds: th,
            metrics: mx,
            marks: Object.assign({}, trace.marks),
            data: Object.assign({}, trace.data),
            diagnosis: diagnose(mx, { thresholds: th, xrMode: trace.data.xrMode, failed }),
        };
    }

    function record(result) {
        history.push(result);
        while (history.length > HISTORY_MAX) history.shift();
        emit({ type: 'result', result });
    }

    /** min / median / p95 of the samples; p95 only from 5 samples up (fewer cannot carry it). */
    function stats(values) {
        const v = (values || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
        if (!v.length) return { n: 0, min: null, median: null, p95: null, max: null };
        const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
        const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
        return {
            n: v.length,
            min: v[0],
            median: Math.round(mid),
            p95: v.length >= 5 ? at(0.95) : null,
            max: v[v.length - 1],
        };
    }

    // ---- frame sampling (only while a trace runs) ------------------------------------------

    /**
     * Sample frame intervals until stop(). In an XR session the page's own rAF does not run, so
     * the session's is used. Returns stop() → { count, avgMs, p95Ms, maxMs, longGaps }.
     */
    function sampleFrames(env) {
        const g = env || global;
        const deltas = [];
        let last = null;
        let running = true;
        let session = null;
        try {
            const r = g.NEXUS_VIEWER && g.NEXUS_VIEWER.renderer;
            if (r && r.xr && r.xr.isPresenting) session = r.xr.getSession();
        } catch (_) {}
        const raf = session
            ? (fn) => session.requestAnimationFrame(fn)
            : g.requestAnimationFrame && g.requestAnimationFrame.bind(g);
        if (typeof raf !== 'function') return () => null;
        const tick = (t) => {
            if (!running) return;
            if (last != null) deltas.push(t - last);
            last = t;
            if (deltas.length < 2000) raf(tick);
        };
        raf(tick);
        return () => {
            running = false;
            if (!deltas.length) return null;
            const s = stats(deltas);
            const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            return {
                count: deltas.length,
                avgMs: Math.round(avg * 10) / 10,
                p95Ms: s.p95 == null ? null : Math.round(s.p95 * 10) / 10,
                maxMs: Math.round(s.max * 10) / 10,
                longGaps: deltas.filter((d) => d > 50).length,
                source: session ? 'xr-session' : 'window',
            };
        };
    }

    /** Where the page is: browser-2d | immersive-vr | immersive-ar (as the app knows it). */
    function xrMode(env) {
        const g = env || global;
        try {
            const r = g.NEXUS_VIEWER && g.NEXUS_VIEWER.renderer;
            if (r && r.xr && r.xr.isPresenting) {
                const s = r.xr.getSession();
                return s && s.environmentBlendMode && s.environmentBlendMode !== 'opaque'
                    ? 'immersive-ar'
                    : 'immersive-vr';
            }
        } catch (_) {}
        return 'browser-2d';
    }

    // ---- after the transcript: the AI's answer and her voice (observed, never driven) -----------

    /**
     * Watch the DOM for what follows a delivered transcript: the user's message in the chat, the
     * reply, and the status indicator turning 'speaking'. Marks them on the trace (re-filing the
     * result) and stops after `windowMs`. Observing only — nothing in the chat path is changed.
     */
    function watchConversation(t, opts) {
        const o = opts || {};
        const doc = global && global.document;
        if (!doc || typeof global.MutationObserver !== 'function') return () => {};
        const chat = doc.getElementById('chat-history');
        const ind = doc.getElementById('status-indicator');
        const observers = [];
        let done = false;
        const refile = () => {
            const r = t.trace.result;
            if (!r) return;
            const fresh = summarize(t.trace, r.thresholds);
            Object.assign(r, fresh);
            emit({ type: 'updated', result: r });
        };
        const stop = () => {
            if (done) return;
            done = true;
            observers.forEach((ob) => ob.disconnect());
            clearTimeout(timer);
        };
        if (chat) {
            const ob = new global.MutationObserver((list) => {
                for (const m of list) {
                    for (const n of m.addedNodes) {
                        if (!n.classList) continue;
                        if (n.classList.contains('user')) t.mark('chat_message_submitted');
                        else if (n.classList.contains('chat-message') && t.has('chat_message_submitted')) {
                            t.mark('llm_response_received');
                        }
                    }
                }
                refile();
            });
            ob.observe(chat, { childList: true });
            observers.push(ob);
        }
        if (ind) {
            const ob = new global.MutationObserver(() => {
                if (ind.classList.contains('speaking') && t.has('transcript_displayed')) {
                    t.mark('tts_playback_started');
                    refile();
                    stop();
                }
            });
            ob.observe(ind, { attributes: true, attributeFilter: ['class'] });
            observers.push(ob);
        }
        const timer = setTimeout(stop, o.windowMs || 60000);
        return stop;
    }

    const api = {
        STAGES,
        DEFAULT_THRESHOLDS,
        NOT_MEASURED: NM,
        thresholds,
        setThresholds,
        classify,
        createTrace,
        metrics,
        diagnose,
        summarize,
        stats,
        sampleFrames,
        xrMode,
        watchConversation,
        history: (filter) => history.filter((r) => !filter || filter(r)).slice(),
        last: (filter) => {
            for (let i = history.length - 1; i >= 0; i--) if (!filter || filter(history[i])) return history[i];
            return null;
        },
        on(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        _reset() {
            history.length = 0;
            listeners.clear();
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_PERF = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
