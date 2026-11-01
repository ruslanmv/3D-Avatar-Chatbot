/**
 * QuestAudioDiagnostics — ST0. What this browser can do with a microphone, measured.
 *
 * "The mic icon is on but nothing is heard" has several causes that look identical from inside
 * a headset: no permission, a permission but no audio arriving, audio arriving but no engine to
 * turn it into text. stt-check.html asks each question separately, in order, and this module
 * holds the parts that are judgement rather than plumbing: which capabilities exist, and what a
 * recording's numbers mean ("the microphone is delivering silence" is not the same finding as
 * "permission denied"). Pure, so the judgements are tested.
 */
(function (global) {
    'use strict';

    /** Facts about the environment, read once. Never inferred from the user agent alone. */
    function collect(env) {
        const g = env || global || {};
        const nav = g.navigator || {};
        const R = g.NEXUS_STT_ROUTER;
        const caps = R ? R.capabilities(g) : {};
        let recorderType = null;
        try {
            const MR = g.MediaRecorder;
            if (MR && typeof MR.isTypeSupported === 'function') {
                recorderType =
                    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
                        MR.isTypeSupported(t)
                    ) || null;
            }
        } catch (_) {}
        const ua = String(nav.userAgent || '');
        return {
            userAgent: ua,
            questBrowser: /OculusBrowser|Quest/i.test(ua),
            secureContext: g.isSecureContext !== false,
            crossOriginIsolated: !!g.crossOriginIsolated,
            mediaDevices: !!nav.mediaDevices,
            getUserMedia: caps.mic === true,
            audioContext: caps.audio === true,
            audioWorklet: caps.worklet === true,
            mediaRecorder: typeof g.MediaRecorder === 'function',
            recorderType,
            webAssembly: caps.wasm === true,
            workers: caps.worker === true,
            webgpu: caps.webgpu === true,
            webxr: !!nav.xr,
            webSpeech: typeof (g.SpeechRecognition || g.webkitSpeechRecognition) === 'function',
            hardwareConcurrency: nav.hardwareConcurrency || null,
            deviceMemoryGB: nav.deviceMemory || null,
        };
    }

    /** Rows for the page: { label, ok, detail }. `ok` null means "information, not a check". */
    function checklist(facts) {
        const f = facts || {};
        return [
            {
                label: 'Secure context (HTTPS)',
                ok: f.secureContext,
                detail: f.secureContext ? '' : 'The microphone needs HTTPS.',
            },
            {
                label: 'Microphone API',
                ok: f.getUserMedia,
                detail: f.getUserMedia ? '' : 'navigator.mediaDevices.getUserMedia is missing.',
            },
            { label: 'Web Audio', ok: f.audioContext, detail: '' },
            {
                label: 'AudioWorklet',
                ok: f.audioWorklet ? true : null,
                detail: f.audioWorklet ? '' : 'Missing — the older ScriptProcessor is used instead.',
            },
            { label: 'Web Workers', ok: f.workers, detail: '' },
            { label: 'WebAssembly', ok: f.webAssembly, detail: '' },
            {
                label: 'MediaRecorder',
                ok: null,
                detail: f.mediaRecorder ? f.recorderType || 'no common type' : 'missing',
            },
            { label: 'WebGPU', ok: null, detail: f.webgpu ? 'available (not used yet)' : 'not available' },
            { label: 'WebXR', ok: null, detail: f.webxr ? 'available' : 'not available' },
            {
                label: 'Browser speech recognition',
                ok: null,
                detail: f.webSpeech
                    ? f.questBrowser
                        ? 'present, but Meta Quest Browser has no service behind it'
                        : 'present (sends audio to the browser vendor)'
                    : 'not available',
            },
            {
                label: 'Threads for WebAssembly',
                ok: null,
                detail: f.crossOriginIsolated
                    ? 'cross-origin isolated'
                    : 'single-threaded (page is not cross-origin isolated)',
            },
        ];
    }

    /**
     * What a test recording says about the microphone. `analysis` is SpeechAudio.analyze's.
     * { ok, finding } — the finding is a sentence a person can act on.
     */
    function judgeRecording(analysis) {
        const a = analysis || {};
        if (!a.durationMs)
            return { ok: false, finding: 'No audio arrived at all: the microphone opened but sent nothing.' };
        if (a.invalid) return { ok: false, finding: 'The audio contained invalid samples.' };
        if (!(a.peak > 0.001)) {
            return {
                ok: false,
                finding:
                    'The microphone is delivering silence. Check it is not muted (on Quest: the mic toggle in Quick Settings).',
            };
        }
        if (a.clippedFraction > 0.01)
            return { ok: true, finding: 'Audio arrives, but it is clipping (too loud or too close).' };
        if (!(a.speechMs >= 150))
            return { ok: true, finding: 'Audio arrives, but no speech stood out from the background.' };
        return { ok: true, finding: `Audio arrives with speech (${a.speechMs} ms of it).` };
    }

    /** Real-time factor: inference time over audio time. Below 1 is faster than real time. */
    function realTimeFactor(inferenceMs, audioMs) {
        return audioMs > 0 ? Math.round((inferenceMs / audioMs) * 100) / 100 : null;
    }

    // ---- ST12. The environment, for a report someone can act on ----------------------------
    //
    // Only what a page is told. A website cannot read the Horizon OS version, the exact headset
    // model, the CPU clock or the thermal state; those are 'not_exposed', and a tester may type
    // them in — kept apart and marked 'user-entered', never presented as detected.

    const NOT_EXPOSED = 'not_exposed';
    const UNSUPPORTED = 'unsupported';
    const MANUAL_KEY = 'nexus_stt_manual_env';
    const MANUAL_FIELDS = Object.freeze({
        headset_model: ['Quest 3', 'Quest 3S', 'Quest 2', 'Quest Pro', 'Other'],
        horizon_os_version: null,
        quest_browser_version: null,
        test_environment: ['Browser 2D', 'Immersive VR', 'Mixed reality', 'Air Link'],
    });

    /** Browser and family from a user-agent string. Pure. Versions only when the string has them. */
    function parseBrowser(ua) {
        const u = String(ua || '');
        const pick = (re) => {
            const m = re.exec(u);
            return m ? m[1] : null;
        };
        const quest = /OculusBrowser|Quest/i.test(u);
        let name = 'unknown';
        let version = null;
        if (/OculusBrowser\//.test(u)) {
            name = 'Quest Browser';
            version = pick(/OculusBrowser\/([\d.]+)/);
        } else if (/EdgA?\//.test(u)) {
            name = 'Edge';
            version = pick(/EdgA?\/([\d.]+)/);
        } else if (/SamsungBrowser\//.test(u)) {
            name = 'Samsung Internet';
            version = pick(/SamsungBrowser\/([\d.]+)/);
        } else if (/Firefox\//.test(u)) {
            name = 'Firefox';
            version = pick(/Firefox\/([\d.]+)/);
        } else if (/Chrome\//.test(u)) {
            name = 'Chrome';
            version = pick(/Chrome\/([\d.]+)/);
        } else if (/Safari\//.test(u) && /Version\//.test(u)) {
            name = 'Safari';
            version = pick(/Version\/([\d.]+)/);
        }
        const engine = /Chrome\//.test(u)
            ? 'Blink'
            : /Gecko\//.test(u) && /Firefox/.test(u)
              ? 'Gecko'
              : /AppleWebKit/.test(u)
                ? 'WebKit'
                : 'unknown';
        const family = quest
            ? 'Meta Quest'
            : /Android/.test(u)
              ? 'Android'
              : /iPhone|iPad|iPod/.test(u)
                ? 'iOS'
                : /Windows/.test(u)
                  ? 'Windows'
                  : /Mac OS X/.test(u)
                    ? 'macOS'
                    : /Linux/.test(u)
                      ? 'Linux'
                      : 'unknown';
        return {
            name,
            version: version || NOT_EXPOSED,
            engine,
            chromiumVersion: pick(/Chrome\/([\d.]+)/) || NOT_EXPOSED,
            deviceFamily: family,
            questBrowser: name === 'Quest Browser',
        };
    }

    /** WebAssembly SIMD, by validating a 30-byte module that uses one SIMD instruction. */
    function wasmSimd(g) {
        try {
            const W = g.WebAssembly;
            if (!W || typeof W.validate !== 'function') return UNSUPPORTED;
            return W.validate(
                new Uint8Array([
                    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
                    253, 98, 11,
                ])
            );
        } catch (_) {
            return UNSUPPORTED;
        }
    }

    function manualEnv(g) {
        try {
            const raw = JSON.parse(((g || global).localStorage || {}).getItem(MANUAL_KEY) || '{}') || {};
            const out = {};
            for (const k of Object.keys(MANUAL_FIELDS)) if (raw[k]) out[k] = String(raw[k]).slice(0, 60);
            return out;
        } catch (_) {
            return {};
        }
    }

    function setManualEnv(patch, g) {
        const next = Object.assign(manualEnv(g), patch || {});
        for (const k of Object.keys(next)) if (!(k in MANUAL_FIELDS) || !next[k]) delete next[k];
        try {
            (g || global).localStorage.setItem(MANUAL_KEY, JSON.stringify(next));
        } catch (_) {}
        return manualEnv(g);
    }

    /**
     * The environment snapshot. Async because storage estimates and client hints are. Every
     * field is a measured value, `not_exposed` (the browser does not tell pages) or `unsupported`
     * (the API is missing). `opts.sttLanguage` and `opts.xrMode` come from the app.
     */
    async function environment(env, opts) {
        const g = env || global || {};
        const o = opts || {};
        const nav = g.navigator || {};
        const b = parseBrowser(nav.userAgent);
        const caps = collect(g);
        const manual = manualEnv(g);
        let hints = NOT_EXPOSED;
        try {
            if (nav.userAgentData) {
                const base = {
                    brands: (nav.userAgentData.brands || []).map((x) => `${x.brand} ${x.version}`),
                    mobile: !!nav.userAgentData.mobile,
                    platform: nav.userAgentData.platform || null,
                };
                if (typeof nav.userAgentData.getHighEntropyValues === 'function') {
                    const h = await nav.userAgentData.getHighEntropyValues(['platformVersion', 'model']);
                    base.platformVersion = h.platformVersion || NOT_EXPOSED;
                    base.model = h.model || NOT_EXPOSED; // as the browser reports it — not verified hardware
                }
                hints = base;
            }
        } catch (_) {}
        let storage = UNSUPPORTED;
        try {
            if (nav.storage && typeof nav.storage.estimate === 'function') {
                const e = await nav.storage.estimate();
                storage = {
                    quotaMB: e.quota != null ? Math.round(e.quota / 1e6) : NOT_EXPOSED,
                    usageMB: e.usage != null ? Math.round(e.usage / 1e6) : NOT_EXPOSED,
                    persisted:
                        typeof nav.storage.persisted === 'function' ? await nav.storage.persisted() : NOT_EXPOSED,
                };
            }
        } catch (_) {}
        let heap = NOT_EXPOSED;
        try {
            const m = g.performance && g.performance.memory;
            if (m && m.usedJSHeapSize)
                heap = { usedMB: Math.round(m.usedJSHeapSize / 1e6), limitMB: Math.round(m.jsHeapSizeLimit / 1e6) };
        } catch (_) {}
        const scr = g.screen || {};
        return {
            device_family: b.deviceFamily,
            browser_name: b.name,
            browser_version: b.version,
            browser_engine: b.engine,
            chromium_version: b.chromiumVersion,
            user_agent: String(nav.userAgent || ''),
            client_hints: hints,
            platform: nav.platform || NOT_EXPOSED,
            browser_language: nav.language || NOT_EXPOSED,
            stt_language: o.sttLanguage || NOT_EXPOSED,
            screen: scr.width ? `${scr.width}x${scr.height}` : NOT_EXPOSED,
            viewport: g.innerWidth ? `${g.innerWidth}x${g.innerHeight}` : NOT_EXPOSED,
            device_pixel_ratio: g.devicePixelRatio || NOT_EXPOSED,
            max_touch_points: nav.maxTouchPoints != null ? nav.maxTouchPoints : NOT_EXPOSED,
            hardware_concurrency: nav.hardwareConcurrency || NOT_EXPOSED,
            device_memory_gb: nav.deviceMemory || NOT_EXPOSED,
            horizon_os_version: NOT_EXPOSED,
            headset_model: NOT_EXPOSED,
            secure_context: caps.secureContext,
            cross_origin_isolated: caps.crossOriginIsolated,
            webassembly: caps.webAssembly,
            wasm_simd: wasmSimd(g),
            shared_array_buffer: typeof g.SharedArrayBuffer === 'function',
            // ONNX Runtime threads need SharedArrayBuffer, which browsers only give an isolated page.
            wasm_threads_available: !!(caps.crossOriginIsolated && typeof g.SharedArrayBuffer === 'function'),
            web_workers: caps.workers,
            audio_worklet: caps.audioWorklet,
            web_audio: caps.audioContext,
            media_recorder: caps.mediaRecorder,
            get_user_media: caps.getUserMedia,
            webgpu_available: caps.webgpu,
            webgpu_in_use: false, // the worker runs ONNX Runtime on WASM; WebGPU is not used
            webxr: caps.webxr,
            xr_mode: o.xrMode || 'browser-2d',
            storage,
            js_heap: heap,
            manual: Object.keys(manual).length ? Object.assign({ source: 'user-entered' }, manual) : null,
        };
    }

    const api = {
        collect,
        checklist,
        judgeRecording,
        realTimeFactor,
        parseBrowser,
        wasmSimd,
        environment,
        manualEnv,
        setManualEnv,
        MANUAL_FIELDS,
        NOT_EXPOSED,
        UNSUPPORTED,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_DIAGNOSTICS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
