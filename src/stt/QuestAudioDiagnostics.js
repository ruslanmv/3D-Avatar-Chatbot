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

    const api = { collect, checklist, judgeRecording, realTimeFactor };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_DIAGNOSTICS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
