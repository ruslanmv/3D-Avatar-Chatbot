/**
 * SttRouter — ST2. Which engine turns her listener's audio into text. Pure.
 *
 * Three recognizers in this app (the mic button in src/main.js, the VR panel through
 * js/speech-service.js, and the companion's hands-free call in src/CompanionMode.js) used the
 * browser's own SpeechRecognition. In desktop and Android Chrome that streams the audio to
 * Google and works. In Meta Quest Browser the API exists but has no service behind it: it
 * starts, shows the microphone, and ends with no transcript. The presence of
 * `webkitSpeechRecognition` therefore proves nothing on a Quest, and this router never treats
 * it as proof.
 *
 * The person's choice is the existing Settings ▸ SPEECH-TO-TEXT ▸ STT PROVIDER, stored by
 * SpeechService as `stt_config.provider`. Its "WASM Whisper" option used to lead to a worker
 * that answered with a placeholder; it is now the on-device engine (ST1), so choosing it is
 * what turns on-device recognition on, for all three recognizers at once.
 *
 *   decide(...) → { engine: 'local' | 'browser' | 'unavailable', reason }
 *
 *  - 'local'       on-device Whisper (provider 'wasm', or `?localStt=1`), where it can run
 *  - 'browser'     the browser's own recognizer — what every surface had before ST, unchanged
 *  - 'remote'      HV1: SonicAgent through OllaBridge Cloud (provider 'sonicagent-stream'). The
 *                  recognizer itself checks consent and pairing at start, before any audio moves.
 *  - 'unavailable' on-device was chosen but cannot run here. NOT silently replaced by the
 *                  browser's recognizer: a person who chose on-device recognition chose to keep
 *                  their voice on the device, and on a Quest the browser's would not work anyway.
 *
 * Off by default (provider 'webspeech'), as QUEST_STT_PLAN.md ST6 asks for the beta; a Quest
 * person who taps the mic and gets nothing is told where the switch is (`hint`).
 */
(function (global) {
    'use strict';

    /** What the browser offers, measured — never inferred from the user agent. */
    function capabilities(env) {
        const g = env || global || {};
        const nav = g.navigator || {};
        return {
            secure: g.isSecureContext !== false,
            worker: typeof g.Worker === 'function',
            wasm: typeof g.WebAssembly === 'object' && g.WebAssembly !== null,
            audio: typeof (g.AudioContext || g.webkitAudioContext) === 'function',
            mic: !!(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function'),
            worklet: typeof g.AudioWorkletNode === 'function',
            webgpu: !!nav.gpu,
            websocket: typeof g.WebSocket === 'function',
        };
    }

    /** Can on-device Whisper run with these capabilities? { ok } or { ok: false, reason }. */
    function localSupport(caps) {
        const c = caps || {};
        if (!c.secure) return { ok: false, reason: 'insecure-context' };
        if (!c.mic) return { ok: false, reason: 'no-microphone-api' };
        if (!c.audio) return { ok: false, reason: 'no-web-audio' };
        if (!c.worker) return { ok: false, reason: 'no-workers' };
        if (!c.wasm) return { ok: false, reason: 'no-webassembly' };
        return { ok: true };
    }

    /** `?localStt=1` forces on-device, `?localStt=0` forces the browser's; anything else: no say. */
    function forcedFrom(search) {
        const m = /[?&]localStt=([^&#]*)/.exec(String(search || ''));
        if (!m) return null;
        if (m[1] === '1' || m[1] === 'true') return 'local';
        if (m[1] === '0' || m[1] === 'false') return 'browser';
        return null;
    }

    /**
     * HV1. Can the remote engine (SonicAgent through OllaBridge Cloud) run here? It needs the
     * microphone and Web Audio like on-device, and a WebSocket; it needs no WASM or workers.
     */
    function remoteSupport(caps) {
        const c = caps || {};
        if (!c.secure) return { ok: false, reason: 'insecure-context' };
        if (!c.mic) return { ok: false, reason: 'no-microphone-api' };
        if (!c.audio) return { ok: false, reason: 'no-web-audio' };
        if (c.websocket === false) return { ok: false, reason: 'no-websocket' };
        return { ok: true };
    }

    function decide(input) {
        const i = input || {};
        // HV1. 'sonicagent-stream' is chosen only in STT PROVIDER, never inferred. `?localStt`
        // still wins (it is a person forcing a choice for this page), and remote never becomes
        // the browser's recognizer when it cannot run: like on-device, the choice was where the
        // audio goes, and quietly sending it to another service would break that.
        if (i.provider === 'sonicagent-stream' && !i.forced) {
            const remote = remoteSupport(i.capabilities);
            return remote.ok
                ? { engine: 'remote', reason: 'setting' }
                : { engine: 'unavailable', reason: remote.reason };
        }
        const support = localSupport(i.capabilities);
        const wantLocal = i.forced === 'local' || (i.forced !== 'browser' && i.provider === 'wasm');
        if (!wantLocal) return { engine: 'browser', reason: i.forced === 'browser' ? 'forced' : 'setting' };
        if (!support.ok) return { engine: 'unavailable', reason: support.reason };
        return { engine: 'local', reason: i.forced === 'local' ? 'forced' : 'setting' };
    }

    const UNAVAILABLE = Object.freeze({
        'insecure-context': 'On-device speech recognition needs the page to be opened over HTTPS.',
        'no-microphone-api': 'This browser gives pages no microphone, so on-device speech recognition cannot run.',
        'no-web-audio': 'This browser has no Web Audio, which on-device speech recognition needs.',
        'no-workers': 'This browser cannot run on-device speech recognition (no Web Workers).',
        'no-webassembly': 'This browser cannot run on-device speech recognition (no WebAssembly).',
        'no-websocket': 'This browser cannot open the connection remote speech recognition needs (no WebSocket).',
    });

    /**
     * A sentence for a Quest user whose browser recognizer just failed or heard nothing, or null.
     * Only on a Quest, only while the browser engine is in use: elsewhere that recognizer works,
     * and a hint there would be noise.
     */
    function hint(input) {
        const i = input || {};
        if (!i.isQuest || i.engine !== 'browser') return null;
        return (
            'Meta Quest Browser cannot turn speech into text by itself. Turn on on-device recognition: ' +
            'Settings ▸ SPEECH-TO-TEXT ▸ STT PROVIDER ▸ On-device Whisper.'
        );
    }

    const api = { capabilities, localSupport, remoteSupport, forcedFrom, decide, hint, UNAVAILABLE };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_ROUTER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
