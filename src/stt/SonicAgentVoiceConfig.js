/**
 * SonicAgentVoiceConfig — HV1/HV6. Whether remote voice may run, and the way to OllaBridge.
 *
 * Remote voice sends the person's microphone off the device, so three separate things must all
 * be true before a single sample leaves, and each has its own owner:
 *
 *  1. **The feature is on** — `enabled`, off by default for everyone, existing users included.
 *  2. **The person agreed** — `consent`, given only by an explicit action in Settings after the
 *     sentence below is shown. Turning the feature on does not imply it, and a provider that
 *     fails never grants or revokes it.
 *  3. **There is somewhere to send it** — the OllaBridge Cloud this app already pairs with for
 *     chat (Settings ▸ LLM). Remote voice reuses that pairing token; SonicAgent's own key never
 *     reaches the browser (OllaBridge holds it, HV2).
 *
 * Stored as one JSON object under `nexus_sonic_voice`, a new key: no existing setting
 * (`stt_config`, `tts_engine`) changes shape, and deleting this key is a complete rollback.
 * Choosing the remote engine itself still happens where every engine is chosen — STT PROVIDER
 * and TTS ENGINE — and a remote failure never writes either (HV6).
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_sonic_voice';
    const LLM_KEY = 'nexus_llm_settings';
    /** The engine id in STT PROVIDER and TTS ENGINE. */
    const ENGINE = 'sonicagent-stream';

    const CONSENT_TEXT = 'Your microphone audio will be sent to OllaBridge Cloud and SonicAgent for transcription.';
    const TTS_NOTICE =
        "The text of your avatar's replies is sent through OllaBridge Cloud to SonicAgent to generate speech.";

    const DEFAULTS = Object.freeze({
        enabled: false,
        consent: false,
        consentAt: null,
        language: '', // '' → the app's language (speech-to-text)
        ttsLanguage: '', // HV9: '' → same as `language`; her voice may speak another language
        voice: '', // '' → the preset for the language and profile
        profile: 'companion', // HV9: 'companion' | 'secretary' | 'all'
        ttsEnginePrevious: '', // HV9: the engine before "Voice & Speaking Style" changed it
        autoFallback: false, // HV6: off; never silently send audio somewhere else
        speakWhileStreaming: false, // HV5: off until the person turns it on
        jitterMs: 120, // HV4: playback starts once this much audio is buffered
    });

    const listeners = new Set();

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function get() {
        const s = storage();
        let saved = {};
        try {
            saved = (s && JSON.parse(s.getItem(KEY) || '{}')) || {};
        } catch (_) {
            saved = {};
        }
        const out = Object.assign({}, DEFAULTS);
        for (const k of Object.keys(DEFAULTS)) if (k in saved) out[k] = saved[k];
        out.enabled = out.enabled === true;
        out.consent = out.consent === true;
        out.autoFallback = out.autoFallback === true;
        out.speakWhileStreaming = out.speakWhileStreaming === true;
        out.jitterMs = Math.min(400, Math.max(40, Number(out.jitterMs) || DEFAULTS.jitterMs));
        return out;
    }

    function set(patch) {
        const next = Object.assign(get(), patch || {});
        const s = storage();
        try {
            if (s) s.setItem(KEY, JSON.stringify(next));
        } catch (_) {
            /* the in-memory listeners still hear it */
        }
        for (const fn of Array.from(listeners)) {
            try {
                fn(next);
            } catch (_) {}
        }
        return next;
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    /** The OllaBridge Cloud this app chats through, if it is set up: { baseUrl, token } or null. */
    function gatewayInfo() {
        const s = storage();
        let ob = {};
        try {
            ob = (JSON.parse((s && s.getItem(LLM_KEY)) || '{}') || {}).ollabridge || {};
        } catch (_) {
            ob = {};
        }
        const baseUrl = String(ob.base_url || '')
            .trim()
            .replace(/\/+$/, '');
        const pair = String(ob.pair_token || '').trim();
        const key = String(ob.api_key || '').trim();
        const token = ob.auth_mode === 'apikey' ? key || pair : pair || key;
        if (!/^https?:\/\//i.test(baseUrl) || !token) return null;
        return { baseUrl, token };
    }

    /**
     * Can remote voice run right now? { ok } or { ok: false, code } — the code goes through
     * RemoteSttEvents.errorFor for the sentence. Checked at the moment audio would leave, not
     * when Settings was last saved: consent withdrawn a second ago is withdrawn.
     */
    function allowed(kind) {
        const c = get();
        if (!c.enabled) return { ok: false, code: 'disabled' };
        if (kind !== 'tts' && !c.consent) return { ok: false, code: 'no_consent' };
        if (!gatewayInfo()) return { ok: false, code: 'not_configured' };
        return { ok: true };
    }

    function appLanguage() {
        try {
            const raw =
                (global.AppLanguage && global.AppLanguage.code) ||
                (global.localStorage && global.localStorage.getItem('speech_lang')) ||
                (global.navigator && global.navigator.language) ||
                'en';
            return String(raw).slice(0, 2).toLowerCase();
        } catch (_) {
            return 'en';
        }
    }

    function language() {
        return (get().language || appLanguage()).slice(0, 2).toLowerCase();
    }

    /** HV9. Her voice's language: its own setting, else the speech-to-text language. */
    function ttsLanguage() {
        return (get().ttsLanguage || get().language || appLanguage()).slice(0, 2).toLowerCase();
    }

    // ---- which Piper voice SonicAgent should use ------------------------------------------------

    let installed = null; // voice ids SonicAgent reported, once capabilities have been read
    let library = null; // HV9: the normalized voice library, once GET /v1/voice/voices answered

    function rememberLibrary(lib) {
        library = lib || null;
        if (library) installed = library.voices.filter((v) => v.playable).map((v) => v.id);
        return library;
    }

    function rememberCapabilities(caps) {
        const voices = caps && caps.tts && Array.isArray(caps.tts.voices) ? caps.tts.voices : null;
        if (voices) installed = voices.map(String);
        return installed;
    }

    /**
     * The voice for `language`. Pure given its inputs:
     *   1. the voice chosen in this section, if any — the person's choice wins;
     *   2. the first installed voice for the language, "medium" quality first.
     * Never a voice of another language: an Italian reply in an English voice is worse than an
     * error that says no Italian voice is installed. Returns null when there is none.
     */
    function pickVoice(input) {
        const i = input || {};
        const lang = String(i.language || '')
            .slice(0, 2)
            .toLowerCase();
        const list = Array.isArray(i.installed) ? i.installed : null;
        const speaks = (id) =>
            String(id || '')
                .toLowerCase()
                .startsWith(lang + '_');
        if (i.chosen) return i.chosen;
        if (!list) return null;
        const mine = list.filter(speaks);
        return mine.find((id) => /-medium$/.test(id)) || mine[0] || null;
    }

    /**
     * The SonicAgent voice to speak with: VoiceSelectionPolicy's answer for the current language,
     * speaking style, explicit pick and gender preference — null when there is none. HV-FIX: the
     * on-device Piper voice (`piper_voice`) is no longer a candidate; it is another engine's
     * namespace, and it made Companion/Secretary change a label instead of the voice.
     */
    function voiceFor(lang) {
        const P = global && global.NEXUS_VOICE_POLICY;
        if (P) {
            const input = P.inputFromSettings(api, global.localStorage);
            if (lang)
                input.language =
                    P.locale(lang) || (input.language.slice(0, 2) === lang.slice(0, 2) ? input.language : lang);
            return P.resolve(input).voice;
        }
        return pickVoice({ language: lang || ttsLanguage(), installed, chosen: get().voice || null });
    }

    // ---- the OllaBridge voice client ----------------------------------------------------------

    function gatewayError(status, body, retryAfter) {
        const detail = (body && (body.detail || body)) || {};
        // A gateway deployed before the voice bridge has no /v1/voice routes at all: say that,
        // rather than "HTTP 404", so nobody hunts for a bug in the browser.
        const missing = status === 404 && !detail.error;
        const err = new Error(
            missing
                ? 'This OllaBridge Cloud has no voice routes (/v1/voice). The voice bridge must be deployed there.'
                : detail.message || `OllaBridge voice answered HTTP ${status}`
        );
        err.code = missing
            ? 'voice_routes_missing'
            : detail.error || (status === 401 ? 'unauthenticated' : 'backend_unavailable');
        err.status = status;
        err.retryAfter = Number(retryAfter || detail.retry_after) || null;
        return err;
    }

    function createGateway(deps) {
        const d = deps || {};
        const doFetch = d.fetch || (global && global.fetch && global.fetch.bind(global));
        const info = d.info || gatewayInfo;

        async function call(method, path, body, opts) {
            const g = info();
            if (!g) {
                const err = new Error('OllaBridge Cloud is not set up.');
                err.code = 'not_configured';
                throw err;
            }
            const headers = Object.assign({ Authorization: `Bearer ${g.token}` }, (opts && opts.headers) || {});
            let payload = body;
            if (body && !(body instanceof (global.FormData || function () {}))) {
                headers['Content-Type'] = 'application/json';
                payload = JSON.stringify(body);
            }
            let res;
            try {
                res = await doFetch(g.baseUrl + path, { method, headers, body: payload });
            } catch (_) {
                const err = new Error('OllaBridge Cloud cannot be reached.');
                err.code = 'backend_unavailable';
                throw err;
            }
            const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (!res.ok) {
                let parsed = null;
                try {
                    parsed = await res.json();
                } catch (_) {}
                throw gatewayError(
                    res.status,
                    parsed,
                    res.headers && res.headers.get && res.headers.get('retry-after')
                );
            }
            if (opts && opts.binary) return { bytes: await res.arrayBuffer(), type };
            return res.json();
        }

        return {
            baseUrl: () => (info() || {}).baseUrl || '',
            capabilities: (fresh) => call('GET', '/v1/voice/capabilities' + (fresh ? '?fresh=1' : '')),
            createStreamSession: (body) => call('POST', '/v1/voice/stream-sessions', body),
            voices: (fresh) => call('GET', '/v1/voice/voices' + (fresh ? '?fresh=1' : '')),
            warmVoice: (voiceId) => call('POST', '/v1/voice/voices/warm', { voice_id: voiceId }),
            speech: (body) => call('POST', '/v1/voice/speech', body, { binary: true }),
            transcribe: (form) => call('POST', '/v1/voice/transcriptions', form),
        };
    }

    let sharedGateway = null;

    const api = {
        KEY,
        ENGINE,
        CONSENT_TEXT,
        TTS_NOTICE,
        DEFAULTS,
        get,
        set,
        onChange,
        isEnabled: () => get().enabled,
        hasConsent: () => get().consent,
        grantConsent: () => set({ consent: true, consentAt: new Date().toISOString() }),
        revokeConsent: () => set({ consent: false, consentAt: null }),
        allowed,
        language,
        ttsLanguage,
        rememberLibrary,
        library: () => library,
        pickVoice,
        voiceFor,
        rememberCapabilities,
        installedVoices: () => (installed ? installed.slice() : null),
        gatewayInfo,
        createGateway,
        gateway() {
            if (!sharedGateway) sharedGateway = createGateway();
            return sharedGateway;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SONIC_VOICE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
