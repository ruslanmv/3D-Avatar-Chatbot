/**
 * TTSProvider — Pluggable TTS engine interface + factory.
 *
 * Adds support for alternative TTS backends (e.g. Piper WASM)
 * while keeping the existing Web Speech API path as the default.
 *
 * Usage from speakText():
 *   if (window.TTSProvider && window.TTSProvider.isActive()) {
 *       window.TTSProvider.speak(text, { rate, pitch, onEnd, onError });
 *   } else {
 *       // existing Web Speech API path (unchanged)
 *   }
 */

'use strict';

(function () {
    /* ----------------------------------------------------------
       Provider registry
       ---------------------------------------------------------- */
    const _providers = {}; // name -> provider instance

    /**
     * Register a TTS provider.
     * @param {string} name  Unique key (e.g. "piper-wasm")
     * @param {object} provider  Must implement: init(), speak(text, opts), stop(), isAvailable(), getVoices()
     */
    function registerProvider(name, provider) {
        if (!name || !provider) return;
        _providers[name] = provider;
        console.log('[TTSProvider] registered:', name);
    }

    /* ----------------------------------------------------------
       Active engine state
       ---------------------------------------------------------- */
    let _activeEngine = localStorage.getItem('tts_engine') || 'web-speech-api';
    let _initialized = false;

    function getEngine() {
        return _activeEngine;
    }

    async function setEngine(name) {
        if (name === _activeEngine && _initialized) return true;

        // Stop any current speech
        try {
            stop();
        } catch (_) {}

        _activeEngine = name;
        _initialized = false;
        localStorage.setItem('tts_engine', name);

        // Web Speech API needs no init
        if (name === 'web-speech-api') {
            _initialized = true;
            console.log('[TTSProvider] engine set to: web-speech-api (built-in)');
            return true;
        }

        const provider = _providers[name];
        if (!provider) {
            console.warn('[TTSProvider] unknown engine:', name, '— falling back to web-speech-api');
            _activeEngine = 'web-speech-api';
            _initialized = true;
            localStorage.setItem('tts_engine', 'web-speech-api');
            return false;
        }

        try {
            await provider.init();
            _initialized = true;
            console.log('[TTSProvider] engine ready:', name);
            return true;
        } catch (err) {
            console.error('[TTSProvider] init failed for', name, err);
            _activeEngine = 'web-speech-api';
            _initialized = true;
            localStorage.setItem('tts_engine', 'web-speech-api');
            return false;
        }
    }

    /**
     * Returns true when the active engine is NOT web-speech-api
     * and is ready to handle speak() calls.
     */
    function isActive() {
        return _activeEngine !== 'web-speech-api' && _initialized && !!_providers[_activeEngine];
    }

    /**
     * Speak text using the active provider.
     *
     * @param {string} text
     * @param {object} opts  { rate, pitch, voiceId, onEnd, onError }
     * @returns {Promise<void>}
     */
    async function speak(text, opts) {
        const provider = _providers[_activeEngine];
        if (!provider) throw new Error('No active TTS provider');
        return provider.speak(text, opts || {});
    }

    /** Stop any current speech from the active provider. */
    function stop() {
        const provider = _providers[_activeEngine];
        if (provider && typeof provider.stop === 'function') {
            provider.stop();
        }
    }

    /**
     * Get available voices for the active provider.
     * @returns {Array<{id: string, name: string, lang: string}>}
     */
    function getVoices() {
        const provider = _providers[_activeEngine];
        if (provider && typeof provider.getVoices === 'function') {
            return provider.getVoices();
        }
        return [];
    }

    /**
     * List all registered provider names (for settings UI).
     * Always includes 'web-speech-api'.
     */
    function listEngines() {
        const engines = [{ id: 'web-speech-api', name: 'Web Speech API (built-in)' }];
        for (const [id, prov] of Object.entries(_providers)) {
            engines.push({
                id,
                name: typeof prov.displayName === 'string' ? prov.displayName : id,
            });
        }
        return engines;
    }

    /* ----------------------------------------------------------
       Expose globally
       ---------------------------------------------------------- */
    window.TTSProvider = {
        registerProvider,
        getEngine,
        setEngine,
        isActive,
        speak,
        stop,
        getVoices,
        listEngines,
    };
})();
