/**
 * SttDiagnosticReport — ST14. One speech-recognition run, as a report a person can paste.
 *
 * The person testing wears a headset and cannot open DevTools, so the evidence has to leave the
 * page as text they choose to copy, download or share. This builds that text from an
 * SttPerformance result and a QuestAudioDiagnostics environment, in a versioned shape
 * (`schema_version` 1, `kind` 'quest-stt-performance') so a later reader knows what it holds.
 *
 * What it never contains, whatever the inputs hold: audio samples, the transcript's text (only
 * whether one was accepted and its length, unless the caller explicitly opts in), chat content,
 * API keys or tokens, authentication headers, URL query strings or credentials, IP addresses,
 * microphone device ids, serial numbers. Fields are picked from a list — nothing is copied
 * wholesale — and every free-text string (error messages, model ids) goes through `scrub`.
 * The user agent is kept: the page shows that before export, because it names the browser
 * and platform.
 *
 * Nothing here sends anything anywhere. Dual export, pure, tested.
 */
(function (global) {
    'use strict';

    const SCHEMA_VERSION = 1;
    const KIND = 'quest-stt-performance';

    const SECRET_PATTERNS = [
        [/\b(sk|pk|rk|hf|gh[pousr]|xox[abpr])[-_][A-Za-z0-9_-]{8,}\b/g, '[redacted-key]'],
        [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
        [/\b(api[_-]?key|token|secret|password|auth|session|key)\s*[:=]\s*["']?[^\s"'&,;]+/gi, '$1=[redacted]'],
        [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]'],
        // An IP stands alone: not inside a version string. The first Quest report lost its browser
        // version to this pattern ("OculusBrowser/[redacted-ip].31.893927508" for 144.0.0.36.31…).
        [/(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w.-])/g, '[redacted-ip]'],
        [/\b[0-9a-f]{64}\b/gi, '[redacted-id]'], // device ids are 64-hex in Chromium
    ];

    /** Remove secrets, credentials, URL queries and IPs from a string. Pure. */
    function scrub(value) {
        if (value == null) return value;
        let s = String(value);
        // URLs: keep scheme, host and path; drop user:pass@, ?query and #fragment.
        s = s.replace(/\b(https?:\/\/)(?:[^\s/@]+@)?([^\s/?#]+)([^\s?#]*)(?:\?[^\s#]*)?(?:#\S*)?/gi, '$1$2$3');
        for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
        return s.length > 300 ? `${s.slice(0, 300)}…` : s;
    }

    const NM = 'not_measured';
    /** 'tiny' → 'whisper-tiny'; 'moonshine-tiny' stays itself. */
    const modelName = (m) => (!m ? 'unknown' : /^moonshine/.test(m) ? m : `whisper-${m}`);
    const num = (v) => (v == null || !Number.isFinite(v) ? NM : Math.round(v));

    function pick(obj, keys) {
        const out = {};
        for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
        return out;
    }

    const ENV_KEYS = [
        'device_family',
        'browser_name',
        'browser_version',
        'browser_engine',
        'chromium_version',
        'user_agent',
        'platform',
        'browser_language',
        'stt_language',
        'screen',
        'viewport',
        'device_pixel_ratio',
        'max_touch_points',
        'hardware_concurrency',
        'device_memory_gb',
        'horizon_os_version',
        'headset_model',
        'secure_context',
        'cross_origin_isolated',
        'webassembly',
        'wasm_simd',
        'shared_array_buffer',
        'wasm_threads_available',
        'web_workers',
        'audio_worklet',
        'web_audio',
        'media_recorder',
        'get_user_media',
        'webgpu_available',
        'webgpu_in_use',
        'webxr',
        'xr_mode',
        'storage',
        'js_heap',
    ];

    function environmentPart(env) {
        const e = pick(env || {}, ENV_KEYS);
        if (e.user_agent) e.user_agent = scrub(e.user_agent);
        if (env && env.client_hints && typeof env.client_hints === 'object') {
            e.client_hints = pick(env.client_hints, ['brands', 'mobile', 'platform', 'platformVersion', 'model']);
            if (e.client_hints.model && e.client_hints.model !== 'not_exposed') {
                e.client_hints.model_source = 'browser-reported (not verified hardware)';
            }
        }
        // Manual fields stay apart from detected ones and say where they came from.
        if (env && env.manual) {
            const m = pick(env.manual, [
                'headset_model',
                'horizon_os_version',
                'quest_browser_version',
                'test_environment',
            ]);
            for (const k of Object.keys(m)) m[k] = scrub(m[k]);
            e.manual = Object.assign({ source: 'user-entered' }, m);
            if (m.headset_model) {
                e.headset_model = m.headset_model;
                e.headset_model_source = 'user-entered';
            }
            if (m.horizon_os_version) {
                e.horizon_os_version = m.horizon_os_version;
                e.horizon_os_version_source = 'user-entered';
            }
        }
        return e;
    }

    /**
     * build(result, env, opts) → the report object.
     * `result`: an SttPerformance result. `opts`: { surface, includeTranscript, transcript,
     * app: { version, commit }, history: [results] (bounded summary only), benchmark }.
     */
    function build(result, env, opts) {
        const r = result || {};
        const o = opts || {};
        const m = r.metrics || {};
        const d = r.data || {};
        const th = r.thresholds || {};
        const rt = d.runtime || {};
        const report = {
            schema_version: SCHEMA_VERSION,
            kind: KIND,
            timestamp: new Date().toISOString(),
            run_started: r.startedAtIso || null,
            app: {
                version: scrub((o.app && o.app.version) || 'unknown'),
                commit: scrub((o.app && o.app.commit) || 'unknown'),
                surface: o.surface || r.surface || 'unknown',
            },
            environment: environmentPart(env),
            stt: {
                provider: d.provider || 'unknown',
                model: modelName(d.model),
                model_family:
                    d.family || (d.model && /^moonshine/.test(d.model) ? 'moonshine' : d.model ? 'whisper' : 'unknown'),
                model_choice: d.modelChoice || 'unknown',
                model_id: scrub(d.modelId || 'unknown'),
                model_revision: d.revision || 'unknown',
                dtype: d.dtype || rt.dtype || 'unknown',
                runtime: rt.runtime || 'transformers.js',
                runtime_version: d.runtimeVersion || rt.runtimeVersion || 'unknown',
                backend: rt.backend || d.backend || 'unknown',
                wasm_threads: rt.wasmThreads == null ? 'not_exposed' : rt.wasmThreads,
                language: d.language || 'unknown',
                mode: d.mode || 'unknown',
                xr_mode: d.xrMode || 'unknown',
                warm_model: d.modelWarmAtStart == null ? NM : !!d.modelWarmAtStart,
                status: r.status || NM,
                threshold_ms: th.sttWarningMs || NM,
                critical_threshold_ms: th.sttCriticalMs || NM,
                stop_to_transcript_ms: num(m.sttMs),
                audio_duration_ms: num(m.recordedAudioMs),
                inference_ms: num(m.inferenceMs),
                real_time_factor: m.realTimeFactor == null ? NM : m.realTimeFactor,
                queue_ms: num(m.workerQueueMs),
                messaging_ms: num(m.messagingMs),
                worker_round_trip_ms: num(m.workerRoundTripMs),
                model_wait_ms: num(m.modelWaitMs),
                model_download_ms: num(m.modelDownloadMs),
                model_init_ms: num(m.modelInitMs),
                model_warmup_ms: num(m.modelWarmupMs),
                analysis_ms: num(m.analysisMs),
                preprocessing_ms: num(m.preprocessingMs),
                worker_resample_ms: num(m.workerResampleMs),
                postprocessing_ms: num(m.postprocessingMs),
                display_delay_ms: num(m.displayDelayMs),
                encoder_ms: NM, // Transformers.js does not expose the encoder/decoder split
                decoder_ms: NM,
                mic_acquisition_ms: num(m.micAcquisitionMs),
                first_audio_frame_ms: num(m.firstAudioFrameMs),
                endpoint_wait_ms: num(m.endpointWaitMs),
                output_tokens: m.outputTokens == null ? NM : m.outputTokens,
                max_new_tokens: d.maxNewTokens == null ? NM : d.maxNewTokens,
                input_sample_rate: d.inputRate || NM,
                input_samples: d.inputSamples || NM,
                transcript_accepted: d.accepted == null ? NM : !!d.accepted,
                rejected_reason: d.rejectedReason || null,
                error: d.error ? scrub(d.error) : null,
                frames: m.frames || NM,
            },
            // HV7. Present only for a remote (SonicAgent) run, so an on-device report is unchanged.
            ...(d.provider === 'sonicagent-stream'
                ? {
                      remote: {
                          backend: 'sonicagent',
                          link_reused: d.remoteLinkReused == null ? NM : !!d.remoteLinkReused,
                          session_ms: num(m.remoteSessionMs),
                          connect_ms: num(m.remoteConnectMs),
                          first_frame_ms: num(m.remoteFirstFrameMs),
                          commit_to_final_ms: num(m.remoteCommitToFinalMs),
                          server_stt_ms: num(m.remoteServerSttMs),
                          transport_ms: num(m.remoteTransportMs),
                          endpointing: (d.remoteOptions && d.remoteOptions.endpointing) || NM,
                          protocol_options: d.remoteOptions
                              ? {
                                    endpointing: d.remoteOptions.endpointing || NM,
                                    output_frame_ms: d.remoteOptions.output_frame_ms || NM,
                                    flow_control: d.remoteOptions.flow_control || NM,
                                    tts_queue: d.remoteOptions.tts_queue == null ? NM : !!d.remoteOptions.tts_queue,
                                }
                              : NM,
                      },
                  }
                : {}),
            conversation: {
                submit_to_llm_ms: num(m.submitToLlmMs),
                llm_to_voice_ms: num(m.llmToVoiceMs),
                stop_to_first_voice_ms: num(m.stopToVoiceMs),
            },
            diagnosis: r.diagnosis
                ? {
                      likely_bottleneck: r.diagnosis.likely_bottleneck,
                      confidence: r.diagnosis.confidence,
                      suggestions: (r.diagnosis.suggestions || []).map(scrub),
                  }
                : null,
        };
        if (o.includeTranscript && o.transcript) report.stt.transcript = scrub(o.transcript);
        else if (o.transcript) report.stt.transcript_chars = String(o.transcript).length;
        if (Array.isArray(o.history) && o.history.length) {
            report.history = o.history.slice(-20).map((h) => ({
                surface: h.surface,
                status: h.status,
                model: modelName(h.data && h.data.model),
                language: (h.data && h.data.language) || 'unknown',
                xr_mode: (h.data && h.data.xrMode) || 'unknown',
                warm_model: h.data && h.data.modelWarmAtStart != null ? !!h.data.modelWarmAtStart : NM,
                audio_ms: num(h.metrics && h.metrics.recordedAudioMs),
                stt_ms: num(h.metrics && h.metrics.sttMs),
                inference_ms: num(h.metrics && h.metrics.inferenceMs),
                rtf: h.metrics && h.metrics.realTimeFactor != null ? h.metrics.realTimeFactor : NM,
            }));
        }
        if (o.benchmark) report.benchmark = o.benchmark;
        return report;
    }

    /** Pretty JSON for the clipboard / a file. */
    function toText(report) {
        return JSON.stringify(report, null, 2);
    }

    /** A filename that sorts by time and says what it is. */
    function fileName(report) {
        const t = (report && report.timestamp ? report.timestamp : new Date().toISOString()).replace(/[:.]/g, '-');
        return `stt-report-${t}.json`;
    }

    const api = { SCHEMA_VERSION, KIND, scrub, build, toText, fileName };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_REPORT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
