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
 *
 * Two engines can be in play, and they are kept apart on purpose:
 *
 *   stored   what the person picked in Settings ▸ TTS ENGINE, persisted as
 *            `tts_engine`. Only setEngine() — a person's choice — writes it.
 *   active   what speaks right now. Usually the stored engine. It differs when
 *            the Meta Quest switch (src/tts/QuestVoice.js) is on, which puts
 *            Piper in front for the session without touching `tts_engine`, and
 *            when an engine could not start, which falls back to the built-in
 *            voice for the session without touching it either.
 *
 * Writing either of those to storage would make them permanent: the switch could
 * never hand back the engine it replaced, and one flaky network at page load would
 * cost somebody their Piper voice for good.
 */

'use strict';

(function () {
    const BUILTIN = 'web-speech-api';
    const PIPER = 'piper-wasm';
    const STORAGE_KEY = 'tts_engine';
    const EVENT = 'nexus-tts-engine';

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

    function _readStored() {
        try {
            return localStorage.getItem(STORAGE_KEY) || BUILTIN;
        } catch (_) {
            return BUILTIN;
        }
    }

    function _writeStored(name) {
        try {
            localStorage.setItem(STORAGE_KEY, name);
        } catch (_) {
            /* the in-memory choice still applies for this page */
        }
    }

    /* ----------------------------------------------------------
       Active engine state
       ---------------------------------------------------------- */
    let _storedEngine = _readStored();
    let _activeEngine = _storedEngine;
    // Q2. The engine the Quest switch put in front, or null. Memory only — see the header.
    let _override = null;
    let _initialized = false;
    // An engine that failed to start this session, so Settings can say why the built-in
    // voice is speaking. Cleared by the next successful resolve.
    let _lastFailure = null;
    let _lastFailureDetail = null;
    // Every resolve takes a ticket. An init that resolves after a newer resolve has run
    // must not write its outcome over the newer one's.
    let _resolveToken = 0;
    let _booted = false;
    let _bootPromise = null;

    function getEngine() {
        return _activeEngine;
    }

    /** What the person chose in Settings, regardless of what is speaking now. */
    function getStoredEngine() {
        return _storedEngine;
    }

    /** True while the Meta Quest switch, not the person, decided which engine speaks. */
    function isOverridden() {
        return !!_override;
    }

    function lastFailure() {
        return _lastFailure;
    }

    /**
     * The failure behind `lastFailure()`, with what went wrong:
     * `{ engine, code, message }`, or null. Settings shows it as "Selected: … · Currently
     * speaking: … · Reason: …" so a temporary fallback is never mistaken for the chosen voice.
     */
    function lastFailureDetail() {
        return _lastFailureDetail ? Object.assign({}, _lastFailureDetail) : null;
    }

    function _fail(engine, err) {
        _lastFailure = engine;
        _lastFailureDetail = {
            engine,
            code: (err && err.code) || 'init_failed',
            message: String((err && err.message) || err || 'the engine could not start'),
        };
    }

    function _announce(detail) {
        try {
            window.dispatchEvent(
                new CustomEvent(EVENT, {
                    detail: Object.assign(
                        {
                            engine: _activeEngine,
                            stored: _storedEngine,
                            overridden: !!_override,
                            failed: _lastFailure,
                        },
                        detail || {}
                    ),
                })
            );
        } catch (_) {
            /* no CustomEvent (very old webview) — Settings re-reads on open anyway */
        }
    }

    async function setEngine(name) {
        // With an override in front, the active engine is not the person's choice, so
        // "already active" is no reason to skip persisting what they just picked.
        if (name === _activeEngine && _initialized && !_override) return true;

        // Stop any current speech
        try {
            stop();
        } catch (_) {}

        _activeEngine = name;
        _storedEngine = name;
        _override = null;
        _lastFailure = null;
        _lastFailureDetail = null;
        _initialized = false;
        _writeStored(name);

        // Web Speech API needs no init
        if (name === BUILTIN) {
            _initialized = true;
            console.log('[TTSProvider] engine set to: web-speech-api (built-in)');
            _announce({ reason: 'setEngine' });
            return true;
        }

        const provider = _providers[name];
        // HV-FIX. A failure below is for THIS SESSION ONLY. It used to write the built-in
        // voice into `tts_engine`: a person who picked SonicAgent while the gateway had voice
        // switched off lost that choice for good and heard the browser voice on every reload,
        // with nothing saying why. `_resolve()` already worked this way at page load; an
        // explicit choice now does too. Choosing the engine again (Save, TEST VOICE) retries.
        if (!provider) {
            console.warn('[TTSProvider] unknown engine:', name, '— the built-in voice speaks for this session');
            _activeEngine = BUILTIN;
            _initialized = true;
            _fail(name, { code: 'unknown_engine', message: 'this voice engine is not loaded on this page' });
            _announce({ reason: 'init-failed' });
            return false;
        }

        // An explicit choice of an engine that needs switching on (SonicAgent's remote voice)
        // switches it on. Never on page load: that is `_resolve`, which only restores.
        if (typeof provider.onSelected === 'function') {
            try {
                provider.onSelected();
            } catch (err) {
                console.warn('[TTSProvider] onSelected failed for', name, err);
            }
        }

        try {
            await provider.init();
            _initialized = true;
            _lastFailureDetail = null;
            console.log('[TTSProvider] engine ready:', name);
            _announce({ reason: 'setEngine' });
            return true;
        } catch (err) {
            console.error('[TTSProvider] init failed for', name, err);
            _activeEngine = BUILTIN;
            _initialized = true;
            _fail(name, err);
            _announce({ reason: 'init-failed' });
            return false;
        }
    }

    /* ----------------------------------------------------------
       Q2. Page load: make the saved engine the one that speaks
       ---------------------------------------------------------- */

    function _quest() {
        return window.NEXUS_QUEST_VOICE || null;
    }

    function _questCtx() {
        const q = _quest();
        if (!q) return { isQuest: false, on: false };
        try {
            return { isQuest: !!q.detect(), on: !!q.isOn() };
        } catch (_) {
            return { isQuest: false, on: false };
        }
    }

    function _currentLang() {
        try {
            return (
                (window.SpeechSettings && window.SpeechSettings.lang) || localStorage.getItem('speech_lang') || 'en-US'
            );
        } catch (_) {
            return 'en-US';
        }
    }

    /**
     * Decide the active engine from the stored choice and the Quest switch, and start it.
     *
     * Until this existed nothing did it: `_initialized` was set only by setEngine(), which
     * only Settings ▸ Save and TEST VOICE call, so after every reload a person who had chosen
     * Piper heard the built-in voice while Settings went on saying Piper. The engine is
     * marked ready before its init() settles because Piper's speak() loads its own module —
     * waiting would hand the first reply of the session to the built-in voice for no gain.
     */
    async function _resolve(reason) {
        const token = ++_resolveToken;
        const q = _quest();
        const ctx = _questCtx();
        const target = q
            ? q.effectiveEngine({
                  stored: _storedEngine,
                  isQuest: ctx.isQuest,
                  on: ctx.on,
                  piperAvailable: !!_providers[PIPER],
              })
            : _storedEngine;

        let engine = target;
        if (engine !== BUILTIN && !_providers[engine]) {
            console.warn('[TTSProvider] unknown engine:', engine, '— using web-speech-api for this session');
            engine = BUILTIN;
        }

        if (engine !== _activeEngine) {
            try {
                stop();
            } catch (_) {}
        }

        _override = target !== _storedEngine && engine === target ? engine : null;
        _activeEngine = engine;
        _lastFailure = null;
        _lastFailureDetail = null;
        _initialized = true;
        _announce({ reason });

        if (engine === BUILTIN) return true;

        const provider = _providers[engine];
        try {
            if (typeof provider.init === 'function') await provider.init();
        } catch (err) {
            if (token !== _resolveToken) return false;
            // Fail soft and for this session only: the stored choice stays, so the next page
            // load tries again. The built-in voice speaks meanwhile, which beats silence.
            console.warn('[TTSProvider] could not start', engine, '— using the built-in voice for now:', err);
            _activeEngine = BUILTIN;
            _override = null;
            _fail(engine, err);
            _announce({ reason: 'init-failed' });
            return false;
        }
        if (token !== _resolveToken) return true;
        _maybePreload(engine);
        return true;
    }

    /**
     * Q5. With the Quest switch on, fetch Piper's model before the first reply needs it.
     *
     * Deferred to idle time because the avatar's VRM is downloading during page load too,
     * and a 60 MB model competing with it would make both late. A preload that fails is not
     * an error anyone needs to see: the first reply simply loads the model itself.
     */
    function _maybePreload(engine) {
        const q = _quest();
        if (!q || engine !== PIPER || !q.applies(_questCtx())) return;
        const provider = _providers[PIPER];
        if (!provider || typeof provider.warmUp !== 'function') return;
        const run = () => {
            Promise.resolve()
                .then(() => provider.warmUp())
                .catch((err) => console.warn('[TTSProvider] Piper preload failed (first reply will load it):', err));
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: 5000 });
        } else {
            setTimeout(run, 3000);
        }
    }

    /** Run once, after every provider script has registered. Safe to call again. */
    function boot() {
        if (_booted) return _bootPromise;
        _booted = true;
        const q = _quest();
        if (q && typeof q.onChange === 'function') {
            q.onChange(() => {
                _resolve('quest-voice');
            });
        }
        _bootPromise = _resolve('boot');
        return _bootPromise;
    }

    /**
     * Returns true when the active engine is NOT web-speech-api
     * and is ready to handle speak() calls.
     */
    function isActive() {
        if (_activeEngine === BUILTIN || !_initialized || !_providers[_activeEngine]) return false;
        // Q2. An engine the Quest switch chose steps aside for a language it has no voice for
        // (Japanese, Korean): an English model reading kanji is worse than the system voice.
        // An engine the person chose themselves is left alone — that is their call.
        if (_override && !_overrideCovers(_currentLang())) return false;
        return true;
    }

    function _overrideCovers(lang) {
        const q = _quest();
        const provider = _providers[_activeEngine];
        if (!q || !provider || typeof provider.getVoices !== 'function') return true;
        try {
            return q.piperCovers(lang, provider.getVoices());
        } catch (_) {
            return true;
        }
    }

    /**
     * Q4. Should the VR panel's speech go through the active engine? Only with the Quest
     * switch on. Without it the panel keeps speaking through SpeechService's own Web Speech
     * path, exactly as it always has.
     */
    function routesVR() {
        const q = _quest();
        return !!q && q.applies(_questCtx()) && isActive();
    }

    /**
     * Q3. `failed` could not start this reply. Which engine should try it instead, or null
     * to fail the way it always did? QuestVoice decides; this only gathers the facts.
     */
    function fallbackFor(failed, opts) {
        const q = _quest();
        if (!q) return null;
        const ctx = _questCtx();
        return q.fallbackFor({
            failed,
            isQuest: ctx.isQuest,
            on: ctx.on,
            alreadyFellBack: !!(opts && opts.alreadyFellBack),
            webSpeechAvailable:
                typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function',
        });
    }

    /**
     * Speak text using the active provider.
     *
     * @param {string} text
     * @param {object} opts  { rate, pitch, voiceId, onStart, onEnd, onError, engine }
     *   `engine` names a provider to use for this one reply instead of the active one —
     *   how a fallback speaks without changing what is active.
     * @returns {Promise<void>}
     */
    async function speak(text, opts) {
        const o = opts || {};
        const provider = _providers[o.engine || _activeEngine];
        if (!provider) throw new Error('No active TTS provider');
        return provider.speak(text, o);
    }

    /**
     * Stop any current speech. Every registered provider, not only the active one: a reply
     * spoken by a fallback engine is still somebody's voice in the room, and "stop" that
     * missed it would leave two replies talking over each other.
     */
    function stop() {
        for (const provider of Object.values(_providers)) {
            if (provider && typeof provider.stop === 'function') {
                try {
                    provider.stop();
                } catch (_) {}
            }
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
        const engines = [{ id: BUILTIN, name: 'Web Speech API (built-in)' }];
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
        EVENT,
        registerProvider,
        getEngine,
        getStoredEngine,
        isOverridden,
        lastFailure,
        lastFailureDetail,
        setEngine,
        boot,
        isActive,
        routesVR,
        fallbackFor,
        speak,
        stop,
        getVoices,
        listEngines,
    };

    // Providers register as their own deferred scripts run, all before DOMContentLoaded.
    // `document`, not `window`: main.js listens on `document`, the event reaches `document`
    // first, and this script runs before main.js — so the engine is decided by the time
    // main.js reads it into Settings.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        setTimeout(boot, 0);
    }
})();
