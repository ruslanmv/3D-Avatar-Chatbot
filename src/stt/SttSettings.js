/**
 * SttSettings — ST6/ST8. The SPEECH-TO-TEXT section: applied at once, and a microphone test.
 *
 * Why "applied at once" (ST8). On a Quest the mic test page worked and the app did not: the
 * STT PROVIDER choice was only written by SAVE, and a person who picked "On-device Whisper"
 * and closed Settings with ✕ was still on the browser's recognizer — which in Meta Quest
 * Browser hears nothing. Reproduced with a Quest user agent: closed with ✕ → engine 'browser',
 * no text; with SAVE → engine 'local', the sentence. So the provider, model size, language and
 * microphone now apply the moment they change (SAVE still saves everything, as before).
 *
 * What this section adds, without redesigning the panel (the person asked for small changes in
 * the existing dark/cyan style):
 *  - one helper sentence under STT PROVIDER that says what the chosen provider does with the
 *    voice (and, on a Quest with the browser's recognizer, that it cannot work there);
 *  - under WASM MODEL SIZE, one compact row: download button, status, a progress bar while it
 *    downloads, Remove once it is on the device;
 *  - under STT LANGUAGE, a MICROPHONE TEST: start/stop, a live meter drawn from the real input
 *    level, a status, and what the chosen provider understood. It tells "the microphone hears
 *    sound" apart from "speech was recognised" — the two failures look the same from outside.
 *
 * The test uses the provider, model and language currently chosen. On-device Whisper: the
 * app's own MicrophoneSession and NEXUS_STT.transcribeSamples (same guards as a real turn).
 * The browser's recognizer: that recognizer, with the meter on a second capture. Cloud
 * providers: the meter only, and a pointer to TEST SPEECH RECOGNITION.
 *
 * Built from JS (no index.html markup above the parity harness's frozen lines). The judgements
 * — helper text, status, the test's verdict, the meter's level — are pure and tested.
 */
(function (global) {
    'use strict';

    const GROUP_ID = 'stt-local-group';
    const TEST_ID = 'stt-mic-test';
    const STYLE_ID = 'stt-settings-style';
    const MAX_TEST_MS = 8000;
    const SEGMENTS = 14;

    const COPY = Object.freeze({
        wasm: 'Runs on this device — your voice is never uploaded. Works on Meta Quest.',
        webspeech: 'Uses your browser’s recognizer, which sends audio to the browser vendor.',
        webspeechQuest: 'Meta Quest Browser has no recognizer of its own — choose On-device Whisper to talk here.',
        openai: 'Sends each recording to OpenAI with your API key.',
        google: 'Sends each recording to Google Cloud with your API key.',
        italian: 'For Italian, Base is more accurate than Tiny.',
        // ST17. From the first Quest 3 report (Whisper Tiny: 8.3 s inference for 4.1 s of speech)
        // and this repo's measurements (Moonshine Tiny ~6× faster on English).
        fasterEnglish: 'For English, Auto (Moonshine) is several times faster than Whisper on a headset.',
        moonshineEnglishOnly: 'Moonshine understands English only — Whisper Tiny is used for this language.',
    });

    function stt() {
        return (global && global.NEXUS_STT) || null;
    }

    function perf() {
        return (global && global.NEXUS_STT_PERF) || null;
    }

    // Results from the app's own listeners (not the tests) — what "last real use" shows.
    const REAL_SURFACES = new Set([
        'mic-button',
        'vr-ptt',
        'vr-panel',
        'speech-service',
        'companion',
        'companion-ptt',
        'app',
    ]);

    function isQuest() {
        return /OculusBrowser|Quest/i.test((global && global.navigator && global.navigator.userAgent) || '');
    }

    /** The sentence under STT PROVIDER. Pure. */
    function providerText(provider, quest) {
        if (provider === 'wasm') return COPY.wasm;
        if (provider === 'openai') return COPY.openai;
        if (provider === 'google') return COPY.google;
        return quest ? `${COPY.webspeech} ${COPY.webspeechQuest}` : COPY.webspeech;
    }

    /** The model row's status. Pure. */
    function statusText(s) {
        const st = s || {};
        const p = st.progress || {};
        const mb = (n) => (n / 1e6).toFixed(1);
        switch (st.model) {
            case 'downloading':
                return p.total ? `Downloading… ${mb(p.loaded)} of ${mb(p.total)} MB` : 'Downloading…';
            case 'loading':
                return 'Preparing the model…';
            case 'ready':
                return '✓ On this device';
            case 'error':
                return `Could not load: ${st.error || 'unknown error'}`;
            default:
                return `Not downloaded yet (~${(st.config && st.config.downloadMB) || 41} MB)`;
        }
    }

    /** Extra advice for the model row. Pure. */
    function advice(ctx) {
        const c = ctx || {};
        const out = [];
        if (c.provider !== 'wasm') return out;
        const english = /^en/i.test(c.lang || '');
        if (c.size === 'tiny' && /^it/i.test(c.lang || '')) out.push(COPY.italian);
        if (english && /^(tiny|base|small)$/.test(c.size || '')) out.push(COPY.fasterEnglish);
        if (c.size === 'moonshine-tiny' && c.lang && !english) out.push(COPY.moonshineEnglishOnly);
        return out;
    }

    /**
     * ST17. WASM MODEL SIZE gains "Auto" and "Moonshine Tiny", added here so no index.html line
     * moves (the parity harness counts them). Then the saved choice is shown — Auto when nothing
     * was ever saved.
     */
    function addModelChoices(d) {
        const sel = d.getElementById('wasm-model-size');
        const C = global && global.NEXUS_WHISPER_CONFIG;
        if (!sel || !C) return;
        const has = (v) => Array.from(sel.options || []).some((o) => o.value === v);
        if (!has('auto')) {
            const o = d.createElement('option');
            o.value = 'auto';
            o.textContent = 'Auto — fastest for your language (Moonshine for English)';
            sel.insertBefore(o, sel.firstChild);
        }
        if (!has('moonshine-tiny') && C.MODELS['moonshine-tiny']) {
            const o = d.createElement('option');
            o.value = 'moonshine-tiny';
            o.textContent = C.MODELS['moonshine-tiny'].label;
            sel.appendChild(o);
        }
        const saved = stt() ? stt().readSttConfig() : {};
        const want = (saved.wasm && saved.wasm.modelSize) || 'auto';
        if (has(want)) sel.value = want;
    }

    /**
     * Meter level 0..1 from a block of samples: RMS in dBFS mapped from -60 (silence) to -10
     * (loud speech). Real input only — the meter never animates by itself.
     */
    function levelOf(samples) {
        if (!samples || !samples.length) return 0;
        let s = 0;
        for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
        const rms = Math.sqrt(s / samples.length);
        if (!(rms > 0)) return 0;
        const dbfs = 20 * Math.log10(rms);
        return Math.max(0, Math.min(1, (dbfs + 60) / 50));
    }

    /**
     * ST9. Can the meter take its own capture while the browser's recognizer listens? On a phone
     * (and in a headset) only one capture of the microphone receives audio: the test opened the
     * meter's first, so the meter moved and the recognizer heard silence — "Sound detected · no
     * words recognized", while the app's mic button (which runs the recognizer alone) worked.
     * Desktop browsers share the microphone. Pure: answers from the user agent and touch support.
     */
    function browserMeterSafe(env) {
        const e = env || {};
        const ua = String(e.userAgent || '');
        if (/Android|iPhone|iPad|iPod|Mobile|OculusBrowser|Quest/i.test(ua)) return false;
        return !e.touch;
    }

    const SOUND_LEVEL = 0.3; // ≈ -45 dBFS: above a quiet room, below quiet speech

    /**
     * The test's verdict. Pure. Input:
     *  { provider, error: {reason, message}|null, heardSound, analysis, result, failure, quest }
     * `result` is transcribeSamples' answer (or { accept, text } from the browser's recognizer);
     * `failure` a transcription error message. Answers { tone: ok|warn|error, status, text }.
     */
    function verdict(input) {
        const i = input || {};
        if (i.error) {
            const blocked = i.error.reason === 'denied';
            return {
                tone: 'error',
                status: blocked ? 'Microphone blocked' : 'Microphone error',
                text: blocked ? 'Allow the microphone for this site, then try again.' : i.error.message || '',
            };
        }
        // ST9. A recognised sentence proves the microphone works whatever the meter saw (on a phone
        // the browser's recognizer runs without one).
        if (!i.failure && i.result && i.result.accept) {
            return { tone: 'ok', status: 'Mic works · recognized', text: i.result.text };
        }
        const sound = i.heardSound || (i.analysis && i.analysis.peak > 0.02);
        if (!sound && i.levelKnown === false) {
            return {
                tone: 'warn',
                status: 'No speech heard',
                text: i.quest
                    ? COPY.webspeechQuest
                    : 'The browser’s recognizer heard no speech. Speak after “Listening”, a little louder or closer.',
            };
        }
        if (!sound) {
            return {
                tone: 'error',
                status: 'No sound',
                text: 'The microphone opened but heard nothing. Check it is not muted (on Quest: Quick Settings).',
            };
        }
        if (i.provider === 'openai' || i.provider === 'google') {
            return {
                tone: 'ok',
                status: 'Mic works',
                text: 'Use TEST SPEECH RECOGNITION below to try the cloud provider.',
            };
        }
        if (i.failure) return { tone: 'error', status: 'Mic works · recognition failed', text: i.failure };
        if (i.result && i.result.accept) return { tone: 'ok', status: 'Mic works · recognized', text: i.result.text };
        const tail =
            i.provider === 'wasm'
                ? 'Speak a little louder or closer, for a second or more.'
                : i.quest
                  ? COPY.webspeechQuest
                  : 'The browser’s recognizer returned nothing; try again or choose On-device Whisper.';
        return { tone: 'warn', status: 'Sound detected · no words recognized', text: tail };
    }

    // ---- ST11. The performance result, in words ---------------------------------------------

    const STATUS_LABEL = Object.freeze({
        fast: { icon: '✓', text: 'Fast', tone: 'ok' },
        slow: { icon: '⚠️', text: 'Slow transcription', tone: 'warn' },
        very_slow: { icon: '⚠️', text: 'Very slow transcription', tone: 'error' },
        failed: { icon: '✖', text: 'Failed', tone: 'error' },
        not_measured: { icon: '·', text: 'Not measured', tone: 'idle' },
    });

    const BOTTLENECK_LABEL = Object.freeze({
        model_load: 'Loading the speech model',
        inference: 'Whisper inference on this device',
        worker_queue: 'Waiting behind another transcription',
        messaging: 'Moving audio to the worker',
        audio_processing: 'Audio processing',
        postprocessing: 'Checking and showing the text',
        unknown: 'Not enough timings to tell',
        none: '—',
    });

    function sec(ms) {
        return ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
    }

    function msText(ms) {
        return ms == null ? 'not measured' : `${Math.round(ms).toLocaleString('en-US')} ms`;
    }

    /**
     * A performance result for people. Pure. { headline, tone, rows: [[label, value]], bottleneck,
     * suggestions } — only measured rows (a stage that did not happen is left out, not shown as 0).
     */
    function perfSummary(result) {
        if (!result) return null;
        const m = result.metrics || {};
        const d = result.data || {};
        const th = result.thresholds || {};
        const st = STATUS_LABEL[result.status] || STATUS_LABEL.not_measured;
        const rows = [];
        const add = (label, value) => {
            if (value != null && value !== '') rows.push([label, value]);
        };
        add('Time after microphone stopped', m.sttMs == null ? null : msText(m.sttMs));
        add('Target', th.sttWarningMs ? msText(th.sttWarningMs) : null);
        add(
            'Provider',
            d.provider === 'webspeech'
                ? 'Browser recognizer'
                : d.provider === 'local-whisper'
                  ? 'On-device Whisper'
                  : null
        );
        add(
            'Model',
            d.model
                ? /^moonshine/.test(d.model)
                    ? 'Moonshine Tiny (English)'
                    : `Whisper ${d.model[0].toUpperCase()}${d.model.slice(1)}`
                : null
        );
        add(
            'Backend',
            d.runtime && d.runtime.backend
                ? String(d.runtime.backend).toUpperCase()
                : d.backend
                  ? String(d.backend).toUpperCase()
                  : null
        );
        add(
            'Model already loaded',
            m.modelWarmAtStart == null ? null : m.modelWarmAtStart ? 'Yes' : 'No (loaded during this test)'
        );
        add('Audio duration', m.recordedAudioMs == null ? null : msText(m.recordedAudioMs));
        add('Whisper inference', m.inferenceMs == null ? null : msText(m.inferenceMs));
        add('Real-time factor', m.realTimeFactor == null ? null : String(m.realTimeFactor));
        add('Waiting for the model', m.modelWaitMs ? msText(m.modelWaitMs) : null);
        add('Queue in the worker', m.workerQueueMs == null ? null : msText(m.workerQueueMs));
        add(
            'Audio processing',
            m.analysisMs == null && m.preprocessingMs == null
                ? null
                : msText((m.analysisMs || 0) + (m.preprocessingMs || 0) + (m.workerResampleMs || 0))
        );
        add('Microphone setup', m.micAcquisitionMs == null ? null : msText(m.micAcquisitionMs));
        add('Tokens produced', m.outputTokens == null ? null : String(m.outputTokens));
        add('Mode', d.xrMode || null);
        add(
            'Frames during transcription',
            m.frames ? `${m.frames.count} frames, avg ${m.frames.avgMs} ms, ${m.frames.longGaps} long gaps` : null
        );
        const diag = result.diagnosis || {};
        return {
            headline: `${st.icon} ${st.text}`,
            tone: st.tone,
            short: m.sttMs == null ? st.text : `${sec(m.sttMs)} after you stopped · ${st.text}`,
            rows,
            bottleneck: BOTTLENECK_LABEL[diag.likely_bottleneck] || null,
            confidence: diag.confidence || null,
            suggestions: diag.suggestions || [],
        };
    }

    // ---- applying choices at once -----------------------------------------------------------

    function applyNow(d) {
        const svc = global && global.SpeechService;
        if (!svc || typeof svc.saveSTTConfig !== 'function') return;
        const val = (id) => {
            const el = d.getElementById(id);
            return el ? el.value : undefined;
        };
        const patch = {};
        if (val('stt-provider') !== undefined) patch.provider = val('stt-provider');
        if (val('stt-language') !== undefined) patch.language = val('stt-language');
        if (val('stt-microphone') !== undefined) patch.microphoneDeviceId = val('stt-microphone');
        const size = val('wasm-model-size');
        if (size !== undefined)
            patch.wasm = Object.assign({}, (svc.getSTTConfig && svc.getSTTConfig().wasm) || {}, { modelSize: size });
        try {
            svc.saveSTTConfig(patch);
            if (patch.language && typeof svc.setRecognitionOptions === 'function') {
                svc.setRecognitionOptions({ lang: patch.language });
            }
        } catch (err) {
            if (global.console) global.console.warn('[SttSettings] could not apply the STT choice:', err);
        }
    }

    // ---- the microphone test ----------------------------------------------------------------

    function createMicTest(d, ui) {
        let run = null;

        function show(state) {
            ui.button.textContent = state.running ? '■ Stop' : '🎤 Test microphone';
            ui.button.setAttribute('aria-pressed', state.running ? 'true' : 'false');
            ui.status.textContent = state.status || '';
            ui.status.className = `stt-chip stt-${state.tone || 'idle'}`;
            ui.text.textContent = state.text || '';
            ui.text.className = `stt-heard${state.tone === 'ok' && state.recognized ? ' stt-heard-ok' : ''}`;
        }

        function meter(level) {
            const lit = Math.round(level * SEGMENTS);
            ui.segments.forEach((seg, k) => seg.classList.toggle('on', k < lit));
        }

        async function finish(r, why) {
            if (run !== r || r.done) return;
            r.done = true;
            clearTimeout(r.timer);
            if (r.trace) {
                r.trace.mark('recording_stopped');
                const P = perf();
                r.stopFrames = P ? P.sampleFrames(global) : null;
            }
            // While the result is worked out (Whisper can take seconds), a click must not start a
            // second recording whose meter the first run's result would then sit on top of.
            ui.button.disabled = true;
            try {
                if (r.lease) r.lease.close();
            } catch (_) {}
            try {
                if (r.sr) r.sr.stop();
            } catch (_) {}
            meter(0);
            const A = global.NEXUS_STT_AUDIO;
            const samples = A && r.chunks.length ? A.concat(r.chunks) : new Float32Array(0);
            const analysis = A && samples.length ? A.analyze(samples, r.rate) : null;
            const base = { provider: r.provider, heardSound: r.heard, analysis, quest: isQuest() };
            if (why === 'error') return end(r, verdict(Object.assign(base, { error: r.error })));
            if (r.provider === 'webspeech') return finishBrowser(r, base);
            if (!(r.heard || (analysis && analysis.peak > 0.02))) return end(r, verdict(base));
            if (r.provider === 'wasm') {
                const ready = stt().status().model === 'ready';
                // ST11. A live count from the moment the microphone stopped, and a notice once it
                // passes the warning threshold. Labels only: the transcription is never cancelled.
                const warnAt = perf() ? perf().thresholds().sttWarningMs : 3000;
                const t0 = Date.now();
                const tick = () => {
                    if (run !== r) return;
                    const ms = Date.now() - t0;
                    const loading = !ready && stt().status().model !== 'ready';
                    show({
                        running: false,
                        status: loading
                            ? `⏳ Downloading the speech model (first time)… ${sec(ms)}`
                            : ms > warnAt
                              ? `⚠️ Transcription is taking longer than expected… ${sec(ms)}`
                              : `⏳ Transcribing… ${sec(ms)}`,
                        tone: ms > warnAt ? 'warn' : 'busy',
                        text: '',
                    });
                };
                tick();
                r.ticker = setInterval(tick, 100);
                try {
                    const res = await stt().transcribeSamples(samples, r.rate, { language: r.lang, trace: r.trace });
                    return end(r, verdict(Object.assign(base, { result: res })), res.accept);
                } catch (err) {
                    if (r.trace) r.trace.set('error', (err && (err.code || err.message)) || 'error');
                    return end(r, verdict(Object.assign(base, { failure: (err && err.message) || String(err) })));
                }
            }
            return end(r, verdict(base));
        }

        /** ST9. The browser recognizer's verdict, once it has ended (or after a grace period). */
        async function finishBrowser(r, base) {
            if (!r.srEnded) {
                show({ running: false, status: 'Finishing…', tone: 'busy', text: r.srInterim || '' });
                await new Promise((res) => {
                    r.onSrEnd = res;
                    setTimeout(res, 3000); // a recognizer that never fires onend must not hang the test
                });
            }
            const text = (r.srText || r.srInterim || '').trim();
            const err = r.srError;
            if (!text && (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture')) {
                const reason = err === 'not-allowed' ? 'denied' : 'unavailable';
                const message =
                    err === 'audio-capture'
                        ? 'The browser’s recognizer could not open the microphone.'
                        : err === 'service-not-allowed'
                          ? 'The browser’s speech service is not available here.'
                          : '';
                return end(r, verdict(Object.assign(base, { error: { reason, message } })));
            }
            if (!text && err === 'network') {
                return end(
                    r,
                    verdict(Object.assign(base, { failure: 'The browser’s speech service could not be reached.' }))
                );
            }
            const result = text ? { accept: true, text } : { accept: false };
            if (r.trace && text) r.trace.mark('transcript_validation_completed');
            return end(r, verdict(Object.assign(base, { result, heardSound: r.heard, levelKnown: !!r.lease })), !!text);
        }

        function end(r, v, recognized) {
            if (run !== r) return; // a newer test owns the display
            run = null;
            clearInterval(r.ticker);
            ui.button.disabled = false;
            show({ running: false, status: v.status, tone: v.tone, text: v.text, recognized });
            // ST11. The run's timings, beside the verdict. Only a recognised transcript is a
            // measured success; a model failure is 'failed'; anything else is not measured.
            if (r.trace) {
                if (recognized) r.trace.mark('transcript_displayed');
                if (
                    v.tone === 'error' &&
                    r.provider !== 'webspeech' &&
                    !r.trace.trace.data.error &&
                    /failed/i.test(v.status)
                ) {
                    r.trace.set('error', 'recognition-failed');
                }
                const frames = r.stopFrames ? r.stopFrames() : null;
                const result = r.trace.end({ frames });
                if (ui.onResult) ui.onResult(result, recognized ? v.text : null);
            }
        }

        async function start() {
            const mics = global.NEXUS_MIC_SESSION && global.NEXUS_MIC_SESSION.get();
            const provider = (d.getElementById('stt-provider') || {}).value || 'webspeech';
            const lang = (d.getElementById('stt-language') || {}).value || '';
            const deviceId = (d.getElementById('stt-microphone') || {}).value || null;
            const r = { provider, lang, chunks: [], rate: 16000, heard: false, done: false };
            run = r;
            const P = perf();
            if (P) {
                r.trace = P.createTrace({ surface: 'settings-mic-test' });
                r.trace.set('provider', provider === 'wasm' ? 'local-whisper' : provider);
                r.trace.set('xrMode', P.xrMode(global));
                r.trace.set('mode', provider === 'webspeech' ? 'browser-recognizer' : 'settings-test');
                if (provider === 'webspeech') r.trace.set('language', lang || null);
                r.trace.mark('microphone_request_started');
            }
            show({ running: true, status: 'Opening microphone…', tone: 'busy', text: '' });
            if (provider === 'webspeech') return startBrowser(r, mics, deviceId);
            if (provider === 'wasm' && stt())
                stt()
                    .preload()
                    .catch(() => {}); // download while they speak
            r.lease = mics.open({
                owner: 'stt-settings-test',
                deviceId,
                onFrames: (samples, rate) => {
                    if (run !== r || r.done) return;
                    if (r.trace && !r.chunks.length) r.trace.mark('first_audio_frame');
                    r.rate = rate;
                    r.chunks.push(samples);
                    const level = levelOf(samples);
                    meter(level);
                    if (level >= SOUND_LEVEL && !r.heard) {
                        r.heard = true;
                        show({
                            running: true,
                            status: 'Sound detected',
                            tone: 'ok',
                            text: 'Keep talking, then press Stop.',
                        });
                    }
                },
                onEnded: (why) => {
                    if (why !== 'closed' && run === r && !r.done) finish(r);
                },
            });
            const opened = await r.lease.ready;
            if (run !== r || r.done) return;
            if (!opened.ok) {
                r.error = opened;
                return finish(r, 'error');
            }
            if (r.trace) {
                r.trace.mark('microphone_permission_completed');
                r.trace.mark('microphone_capture_started');
            }
            show({ running: true, status: 'Listening — speak now', tone: 'busy', text: '' });
            if (provider === 'webspeech') {
                const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
                if (SR) {
                    try {
                        const sr = new SR();
                        sr.lang = lang || 'en-US';
                        sr.continuous = true;
                        sr.interimResults = false;
                        sr.onresult = (e) => {
                            for (let k = e.resultIndex; k < e.results.length; k++) {
                                if (e.results[k].isFinal)
                                    r.srText = `${r.srText || ''} ${e.results[k][0].transcript}`.trim();
                            }
                        };
                        sr.onend = () => (r.srEnded = true);
                        sr.onerror = () => (r.srEnded = true);
                        sr.start();
                        r.sr = sr;
                    } catch (_) {
                        r.srEnded = true;
                    }
                }
            }
            r.timer = setTimeout(() => finish(r), MAX_TEST_MS);
        }

        /**
         * ST9. Test the browser's recognizer the way the app's mic button runs it (src/main.js
         * initSpeechRecognition: the same class, not continuous, interim results, the chosen
         * language) and start it FIRST. The meter gets its own capture only where the browser
         * shares the microphone (desktop); elsewhere the status follows the recognizer's own
         * sound and speech events, and the meter stays dark rather than pretend.
         */
        function startBrowser(r, mics, deviceId) {
            let SR = null;
            try {
                SR = global.NEXUS_STT && global.NEXUS_STT.recognitionClass ? global.NEXUS_STT.recognitionClass() : null;
            } catch (_) {}
            SR = SR || global.SpeechRecognition || global.webkitSpeechRecognition;
            if (!SR) {
                r.error = { reason: 'unavailable', message: 'This browser has no speech recognizer.' };
                return finish(r, 'error');
            }
            const sr = new SR();
            r.sr = sr;
            sr.lang = r.lang || 'en-US';
            sr.continuous = false;
            sr.interimResults = true;
            sr.maxAlternatives = 1;
            const heardSomething = () => {
                if (run !== r || r.done || r.heard) return;
                r.heard = true;
                show({ running: true, status: 'Sound detected', tone: 'ok', text: r.srInterim || 'Keep talking…' });
            };
            sr.onaudiostart = () => {
                if (r.trace) {
                    r.trace.mark('microphone_permission_completed');
                    r.trace.mark('microphone_capture_started');
                }
            };
            // The browser decides the end of speech itself; that is when "stopped" is, for it.
            sr.onspeechend = () => {
                if (r.trace) r.trace.mark('recording_stopped');
            };
            sr.onstart = () => {
                if (run === r && !r.done && !r.heard) {
                    show({
                        running: true,
                        status: 'Listening — speak now',
                        tone: 'busy',
                        // On a phone or headset the recognizer needs the microphone to itself.
                        text: r.lease ? '' : 'The level meter is off while the browser’s recognizer listens.',
                    });
                }
            };
            sr.onsoundstart = heardSomething;
            sr.onspeechstart = heardSomething;
            sr.onresult = (e) => {
                let interim = '';
                for (let k = e.resultIndex; k < e.results.length; k++) {
                    const t = (e.results[k][0] && e.results[k][0].transcript) || '';
                    if (e.results[k].isFinal) r.srText = `${r.srText || ''} ${t}`.trim();
                    else interim += t;
                }
                r.srInterim = interim.trim();
                heardSomething();
                if (run === r && !r.done) {
                    show({
                        running: true,
                        status: 'Sound detected',
                        tone: 'ok',
                        text: (r.srText || r.srInterim || '').trim(),
                    });
                }
            };
            sr.onerror = (e) => {
                r.srError = (e && e.error) || 'unknown';
            };
            sr.onend = () => {
                r.srEnded = true;
                if (r.onSrEnd) r.onSrEnd();
                if (run === r && !r.done) finish(r); // the recognizer stops by itself after a sentence
            };
            try {
                sr.start();
            } catch (err) {
                r.error = { reason: 'unavailable', message: String((err && err.message) || err) };
                return finish(r, 'error');
            }
            if (
                mics &&
                browserMeterSafe({
                    userAgent: global.navigator && global.navigator.userAgent,
                    touch: 'ontouchstart' in global,
                })
            ) {
                r.lease = mics.open({
                    owner: 'stt-settings-meter',
                    deviceId,
                    onFrames: (samples) => {
                        if (run !== r || r.done) return;
                        const level = levelOf(samples);
                        meter(level);
                        if (level >= SOUND_LEVEL) heardSomething();
                    },
                });
            }
            r.timer = setTimeout(() => {
                try {
                    sr.stop();
                } catch (_) {}
                setTimeout(() => finish(r), 3500);
            }, MAX_TEST_MS);
        }

        ui.button.addEventListener('click', () => {
            if (run && !run.done && run.provider === 'webspeech' && run.sr && !run.stopping) {
                // Stop listening and let the recognizer deliver its last words (onend finishes).
                run.stopping = true;
                if (run.trace) run.trace.mark('recording_stopped');
                try {
                    run.sr.stop();
                } catch (_) {}
                const r = run;
                setTimeout(() => finish(r), 3500);
                return;
            }
            if (run && !run.done) finish(run);
            else {
                start().catch((err) => {
                    run = null;
                    ui.button.disabled = false;
                    show({ running: false, tone: 'error', status: 'Microphone error', text: String(err) });
                });
            }
        });
        show({ running: false, status: 'Not tested', tone: 'idle', text: '' });
        return { stop: () => run && finish(run) };
    }

    // ---- DOM --------------------------------------------------------------------------------

    function injectStyle(d) {
        if (d.getElementById(STYLE_ID)) return;
        const s = d.createElement('style');
        s.id = STYLE_ID;
        // Scoped to the two blocks this module draws, in the panel's own colours. No glow, no cards.
        s.textContent = `
#${GROUP_ID}, #${TEST_ID} { margin-top: 8px; }
#${GROUP_ID} .stt-row, #${TEST_ID} .stt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
#${GROUP_ID} .stt-note, #${TEST_ID} .stt-note { font-size: 0.85rem; color: var(--text-muted); margin: 6px 0 0; }
#${GROUP_ID} .secondary-btn, #${TEST_ID} .secondary-btn { min-height: 44px; font-size: 0.8rem; }
#${GROUP_ID} .stt-linkbtn { background: none; border: 0; color: var(--text-secondary); text-decoration: underline; cursor: pointer; min-height: 44px; font: inherit; font-size: 0.85rem; }
#${GROUP_ID} .stt-track { flex: 1 1 160px; height: 6px; border-radius: 3px; background: rgba(0, 229, 255, 0.12); overflow: hidden; }
#${GROUP_ID} .stt-bar { height: 100%; width: 0; background: var(--primary); transition: width 120ms linear; }
#${TEST_ID} .stt-meter { display: flex; gap: 3px; align-items: flex-end; height: 22px; }
#${TEST_ID} .stt-meter span { width: 6px; height: 100%; border-radius: 2px; background: rgba(0, 229, 255, 0.15); }
#${TEST_ID} .stt-meter span.on { background: var(--accent-green); }
#${TEST_ID} .stt-chip { font-size: 0.8rem; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-secondary); }
#${TEST_ID} .stt-ok { color: var(--accent-green); border-color: rgba(0, 255, 136, 0.5); }
#${TEST_ID} .stt-warn { color: var(--accent-orange); border-color: rgba(255, 145, 0, 0.5); }
#${TEST_ID} .stt-error { color: var(--status-error); border-color: rgba(255, 82, 82, 0.5); }
#${TEST_ID} .stt-busy { color: var(--primary); }
#${TEST_ID} .stt-heard { margin-top: 8px; min-height: 1.4em; color: var(--text-primary); }
#${TEST_ID} .stt-heard:empty { margin: 0; min-height: 0; }
#${TEST_ID} .stt-heard-ok::before { content: 'Recognized: '; color: var(--text-muted); }
#${TEST_ID} .stt-perf { margin-top: 6px; font-size: 0.85rem; color: var(--text-secondary); }
#${TEST_ID} .stt-perf[hidden] { display: none; }
#${TEST_ID} .stt-perf-line { color: var(--text-primary); }
#${TEST_ID} .stt-perf-line.stt-warn { color: var(--accent-orange); }
#${TEST_ID} .stt-perf-line.stt-error { color: var(--status-error); }
#${TEST_ID} .stt-perf-line.stt-ok { color: var(--accent-green); }
#${TEST_ID} details { margin-top: 6px; }
#${TEST_ID} summary { cursor: pointer; min-height: 32px; line-height: 32px; color: var(--text-secondary); }
#${TEST_ID} table { width: 100%; border-collapse: collapse; margin: 4px 0; }
#${TEST_ID} td { padding: 2px 6px 2px 0; vertical-align: top; }
#${TEST_ID} td:first-child { color: var(--text-muted); white-space: nowrap; }
#${TEST_ID} .stt-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 6px; }
#${TEST_ID} .stt-actions a { color: var(--text-secondary); }
#${TEST_ID} pre { max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 0.72rem; background: rgba(0, 0, 0, 0.3); padding: 6px; border-radius: 6px; }
#${TEST_ID} select.stt-th { min-height: 36px; }
#${TEST_ID} .stt-last { margin-top: 6px; font-size: 0.8rem; color: var(--text-muted); }
`;
        (d.head || d.documentElement).appendChild(s);
    }

    function el(d, tag, cls, text) {
        const e = d.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
    }

    function render(d) {
        const s = stt();
        const select = d.getElementById('stt-provider');
        const provider = select ? select.value : 'webspeech';
        const help = d.getElementById('stt-provider-help');
        if (help) help.textContent = providerText(provider, isQuest());
        const group = d.getElementById(GROUP_ID);
        if (!group || !s) return;
        const status = s.status();
        group.querySelector('[data-stt="status"]').textContent = statusText(status);
        const p = status.progress;
        const busy = status.model === 'downloading' || status.model === 'loading';
        const fraction = status.model === 'ready' ? 1 : p && p.fraction != null ? p.fraction : 0;
        group.querySelector('[data-stt="bar"]').style.width = `${Math.round(fraction * 100)}%`;
        group.querySelector('[data-stt="track"]').hidden = !busy;
        group.querySelector('[data-stt="download"]').hidden = status.model === 'ready' || busy;
        group.querySelector('[data-stt="remove"]').hidden = status.model !== 'ready';
        const sizeSel = d.getElementById('wasm-model-size');
        const langSel = d.getElementById('stt-language');
        const adv = advice({ provider, size: sizeSel && sizeSel.value, lang: langSel && langSel.value });
        const note = group.querySelector('[data-stt="advice"]');
        note.textContent = adv.join(' ');
        note.hidden = !adv.length;
    }

    // ---- ST11. The performance block under the test -------------------------------------------

    async function reportText(result, transcript) {
        const R = global.NEXUS_STT_REPORT;
        const D = global.NEXUS_STT_DIAGNOSTICS;
        if (!R) return '';
        const P = perf();
        const env =
            D && D.environment
                ? await D.environment(global, {
                      sttLanguage: result.data && result.data.language,
                      xrMode: result.data && result.data.xrMode,
                  })
                : null;
        return R.toText(R.build(result, env, { transcript, history: P ? P.history() : [] }));
    }

    async function copyText(text) {
        try {
            if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
                await global.navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        // Fallback for browsers without the async clipboard (or without permission for it).
        try {
            const ta = global.document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            global.document.body.appendChild(ta);
            ta.select();
            const ok = global.document.execCommand && global.document.execCommand('copy');
            ta.remove();
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    function buildPerfUi(d, test) {
        const box = el(d, 'div', 'stt-perf');
        box.hidden = true;
        const line = el(d, 'div', 'stt-perf-line');
        line.setAttribute('aria-live', 'polite');
        const details = el(d, 'details');
        details.appendChild(el(d, 'summary', null, 'Performance details'));
        const table = el(d, 'table');
        const why = el(d, 'p', 'stt-note');
        const tips = el(d, 'ul', 'stt-note');
        const thRow = el(d, 'div', 'stt-actions');
        const thLabel = el(d, 'label', null, 'Warn when slower than ');
        const thSel = el(d, 'select', 'select-input stt-th');
        for (const ms of [2000, 3000, 5000, 8000]) {
            const o = el(d, 'option', null, `${ms / 1000} s`);
            o.value = String(ms);
            thSel.appendChild(o);
        }
        thLabel.appendChild(thSel);
        thRow.appendChild(thLabel);
        const preview = el(d, 'details');
        preview.appendChild(
            el(d, 'summary', null, 'Report preview (shows your browser and platform; no audio, no transcript)')
        );
        const pre = el(d, 'pre');
        preview.appendChild(pre);
        details.appendChild(table);
        details.appendChild(why);
        details.appendChild(tips);
        details.appendChild(thRow);
        details.appendChild(preview);
        const actions = el(d, 'div', 'stt-actions');
        const copy = el(d, 'button', 'secondary-btn', 'Copy diagnostic report');
        copy.type = 'button';
        const copied = el(d, 'span', 'stt-note');
        copied.style.margin = '0';
        const adv = el(d, 'a', null, 'Advanced speech test ↗');
        adv.href = 'stt-check.html';
        adv.target = '_blank';
        adv.rel = 'noopener';
        actions.appendChild(copy);
        actions.appendChild(adv);
        actions.appendChild(copied);
        box.appendChild(line);
        box.appendChild(details);
        box.appendChild(actions);
        const last = el(d, 'div', 'stt-last');
        last.hidden = true;
        test.appendChild(box);
        test.appendChild(last);

        let current = null;
        let currentText = null;

        function show(result, transcript) {
            current = result;
            currentText = transcript || null;
            const sum = perfSummary(result);
            if (!sum) return;
            box.hidden = false;
            line.textContent = sum.short;
            line.className = `stt-perf-line stt-${sum.tone}`;
            table.textContent = '';
            for (const [k, v] of sum.rows) {
                const tr = el(d, 'tr');
                tr.appendChild(el(d, 'td', null, k));
                tr.appendChild(el(d, 'td', null, v));
                table.appendChild(tr);
            }
            why.textContent = sum.bottleneck
                ? `Likely bottleneck: ${sum.bottleneck}${sum.confidence ? ` (${sum.confidence})` : ''}`
                : '';
            tips.textContent = '';
            for (const t of sum.suggestions) tips.appendChild(el(d, 'li', null, t));
            const P = perf();
            if (P) thSel.value = String(P.thresholds().sttWarningMs);
            copied.textContent = '';
            pre.textContent = '';
        }

        preview.addEventListener('toggle', async () => {
            if (preview.open && current) pre.textContent = await reportText(current, currentText);
        });
        thSel.addEventListener('change', () => {
            const P = perf();
            if (!P || !current) return;
            P.setThresholds({ sttWarningMs: Number(thSel.value) });
            current.thresholds = P.thresholds();
            current.status = P.classify(
                current.metrics.sttMs,
                current.thresholds,
                !!(current.data && current.data.error)
            );
            current.diagnosis = P.diagnose(current.metrics, {
                thresholds: current.thresholds,
                xrMode: current.data.xrMode,
            });
            show(current, currentText);
        });
        copy.addEventListener('click', async () => {
            if (!current) return;
            const ok = await copyText(await reportText(current, currentText));
            copied.textContent = ok ? 'Copied.' : 'Could not copy — open the report preview and select it.';
        });

        // The app's own listeners: the last real microphone use, beside the test.
        const P = perf();
        if (P) {
            const showLast = (r) => {
                if (!r || !REAL_SURFACES.has(r.surface)) return;
                const sum = perfSummary(r);
                last.hidden = false;
                last.textContent = `Last real use (${r.surface}): ${sum.short}`;
            };
            showLast(P.last((r) => REAL_SURFACES.has(r.surface)));
            P.on((e) => {
                if (e && e.result) showLast(e.result);
            });
        }
        return { show };
    }

    function mount(doc) {
        const d = doc || (global && global.document);
        if (!d || !stt()) return false;
        if (d.getElementById(GROUP_ID)) {
            render(d);
            return true;
        }
        const select = d.getElementById('stt-provider');
        const providerGroup = select && select.closest ? select.closest('.input-group') : null;
        if (!providerGroup) return false;
        injectStyle(d);

        // 1. The helper sentence under STT PROVIDER: reuse the existing line, left-aligned.
        const help = providerGroup.querySelector('.voice-status');
        if (help) {
            help.id = 'stt-provider-help';
            help.style.textAlign = 'left';
        }

        // 2. The model row, inside the WASM block (shown only for On-device Whisper).
        addModelChoices(d);
        const sizeSel = d.getElementById('wasm-model-size');
        const sizeGroup = sizeSel && sizeSel.closest ? sizeSel.closest('.input-group') : null;
        const group = el(d, 'div');
        group.id = GROUP_ID;
        const row = el(d, 'div', 'stt-row');
        const download = el(d, 'button', 'secondary-btn', '⬇ Download model');
        download.type = 'button';
        download.setAttribute('data-stt', 'download');
        const status = el(d, 'span', 'stt-note');
        status.setAttribute('data-stt', 'status');
        status.setAttribute('aria-live', 'polite');
        status.style.margin = '0';
        const remove = el(d, 'button', 'stt-linkbtn', 'Remove');
        remove.type = 'button';
        remove.setAttribute('data-stt', 'remove');
        const track = el(d, 'div', 'stt-track');
        track.setAttribute('data-stt', 'track');
        const bar = el(d, 'div', 'stt-bar');
        bar.setAttribute('data-stt', 'bar');
        track.appendChild(bar);
        row.appendChild(download);
        row.appendChild(status);
        row.appendChild(remove);
        row.appendChild(track);
        const note = el(d, 'p', 'stt-note');
        note.setAttribute('data-stt', 'advice');
        group.appendChild(row);
        group.appendChild(note);
        if (sizeGroup) sizeGroup.appendChild(group);
        else providerGroup.appendChild(group);

        // 3. The microphone test, right under STT LANGUAGE.
        const langSel = d.getElementById('stt-language');
        const langGroup = langSel && langSel.closest ? langSel.closest('.input-group') : null;
        if (langGroup && langGroup.parentNode && global.NEXUS_MIC_SESSION) {
            const test = el(d, 'div', 'input-group');
            test.id = TEST_ID;
            test.appendChild(el(d, 'label', 'input-label', 'MICROPHONE TEST'));
            const trow = el(d, 'div', 'stt-row');
            const button = el(d, 'button', 'secondary-btn', '🎤 Test microphone');
            button.type = 'button';
            const chip = el(d, 'span', 'stt-chip stt-idle', 'Not tested');
            chip.setAttribute('aria-live', 'polite');
            const meterEl = el(d, 'div', 'stt-meter');
            meterEl.setAttribute('aria-hidden', 'true');
            const segments = [];
            for (let k = 0; k < SEGMENTS; k++) segments.push(meterEl.appendChild(el(d, 'span')));
            trow.appendChild(button);
            trow.appendChild(chip);
            trow.appendChild(meterEl);
            const heard = el(d, 'div', 'stt-heard');
            heard.setAttribute('aria-live', 'polite');
            test.appendChild(trow);
            test.appendChild(heard);
            const perfUi = buildPerfUi(d, test);
            langGroup.parentNode.insertBefore(test, langGroup.nextSibling);
            createMicTest(d, { button, status: chip, text: heard, segments, onResult: perfUi.show });
        }

        download.addEventListener('click', () => {
            stt()
                .preload()
                .catch(() => {})
                .then(() => render(d));
            render(d);
        });
        remove.addEventListener('click', () => {
            stt()
                .clearCache()
                .catch(() => {})
                .then(() => render(d));
        });
        const changed = () => {
            applyNow(d);
            render(d);
        };
        for (const id of ['stt-provider', 'wasm-model-size', 'stt-language', 'stt-microphone']) {
            const s = d.getElementById(id);
            if (s) s.addEventListener('change', changed);
        }
        try {
            global.addEventListener('nexus-stt', (e) => {
                const t = e.detail && e.detail.type;
                if (t === 'model-state' || t === 'model-progress' || t === 'config') render(d);
            });
        } catch (_) {}
        render(d);
        return true;
    }

    const out = {
        GROUP_ID,
        TEST_ID,
        COPY,
        providerText,
        statusText,
        advice,
        levelOf,
        verdict,
        perfSummary,
        addModelChoices,
        browserMeterSafe,
        SOUND_LEVEL,
        mount,
        render,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = out;
    if (global) {
        global.NEXUS_STT_SETTINGS = out;
        const d = global.document;
        if (d && typeof module === 'undefined') {
            if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => mount(d));
            else mount(d);
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
