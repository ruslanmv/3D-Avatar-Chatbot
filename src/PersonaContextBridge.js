/**
 * PersonaContextBridge.js
 * Lightweight bridge that fetches persona context from OllaBridge
 * and applies it to avatar expression, TTS voice, and response behaviour.
 *
 * ADDITIVE — does not modify any existing module's internals.
 * Other modules opt-in by calling PersonaContextBridge methods.
 *
 * Architecture: Global namespace (no ES6 modules)
 * Usage: Access via window.PersonaContextBridge
 */

'use strict';

(function (global) {
    const CACHE_KEY = 'nexus_persona_context';
    const CACHE_TTL_MS = 60_000; // 1 minute client-side cache

    /**
     * Emotion → avatar animation mode mapping.
     * Maps HomePilot emotional_base values to ProceduralAnimator modes.
     */
    const EMOTION_MODE_MAP = {
        // Warm / positive
        compassionate: 'happy',
        warm: 'happy',
        friendly: 'happy',
        cheerful: 'happy',
        playful: 'happy',
        enthusiastic: 'happy',
        loving: 'happy',

        // Calm / neutral
        calm: 'idle',
        neutral: 'idle',
        professional: 'idle',
        steady: 'idle',
        serene: 'idle',
        grounded: 'idle',
        balanced: 'idle',

        // Thoughtful / analytical
        curious: 'thinking',
        analytical: 'thinking',
        reflective: 'thinking',
        contemplative: 'thinking',
        philosophical: 'thinking',

        // Energetic
        energetic: 'dance',
        excited: 'dance',
        wild: 'dance',
        chaotic: 'dance',
        intense: 'dance',
    };

    /**
     * Map HomePilot pause_style to TTS rate modifier.
     */
    const PAUSE_RATE_MAP = {
        natural: 1.0,
        dramatic: 0.85,
        rapid: 1.2,
        calm: 0.9,
    };

    class PersonaContextBridge {
        constructor() {
            this._context = null;
            this._fetchedAt = 0;
            this._fetching = null; // Dedup in-flight requests
            this._lastModel = null;

            // Try to restore from sessionStorage for faster first render
            try {
                const cached = sessionStorage.getItem(CACHE_KEY);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && parsed.context && parsed.fetchedAt) {
                        const age = Date.now() - parsed.fetchedAt;
                        if (age < CACHE_TTL_MS * 10) {
                            // Allow stale-while-revalidate
                            this._context = parsed.context;
                            this._fetchedAt = parsed.fetchedAt;
                            this._lastModel = parsed.model || null;
                            console.log('[PersonaContext] Restored cached context for', parsed.model);
                        }
                    }
                }
            } catch (_) {}
        }

        /**
         * Fetch persona context from OllaBridge for the given model.
         * Results are cached client-side. Safe to call on every chat turn —
         * only actually fetches when cache is stale or model changed.
         *
         * @param {object} opts
         * @param {string} opts.baseUrl  - OllaBridge base URL
         * @param {string} opts.model    - Model name (e.g. "persona:xxx")
         * @param {string} [opts.authToken] - Bearer token or API key
         * @returns {Promise<object|null>} Persona context or null on failure
         */
        async fetchContext({ baseUrl, model, authToken = '' }) {
            // Only meaningful for persona/personality models
            if (!model || (!model.startsWith('persona:') && !model.startsWith('personality:'))) {
                return null;
            }

            // Check cache validity
            const now = Date.now();
            if (this._context && this._lastModel === model && now - this._fetchedAt < CACHE_TTL_MS) {
                return this._context;
            }

            // Dedup concurrent requests
            if (this._fetching) {
                return this._fetching;
            }

            this._fetching = this._doFetch(baseUrl, model, authToken);
            try {
                const ctx = await this._fetching;
                return ctx;
            } finally {
                this._fetching = null;
            }
        }

        /**
         * Get cached context synchronously (may be null).
         * Useful for animation loops that can't await.
         */
        getContext() {
            return this._context;
        }

        /**
         * Clear cached context (e.g. on model switch).
         */
        clear() {
            this._context = null;
            this._fetchedAt = 0;
            this._lastModel = null;
            try {
                sessionStorage.removeItem(CACHE_KEY);
            } catch (_) {}
        }

        // -----------------------------------------------------------
        // Avatar expression helpers
        // -----------------------------------------------------------

        /**
         * Get the ProceduralAnimator mode that matches the persona's
         * emotional baseline. Falls back to 'idle'.
         *
         * @returns {string} Animation mode name
         */
        getDefaultAvatarMode() {
            if (!this._context) return 'idle';
            const base = (this._context.dynamics?.emotional_base || '').toLowerCase();
            return EMOTION_MODE_MAP[base] || 'idle';
        }

        /**
         * Apply the persona's default expression to the avatar.
         * Safe to call when no context is loaded (no-op).
         */
        applyDefaultExpression() {
            const mode = this.getDefaultAvatarMode();
            if (mode === 'idle') return; // Don't override natural idle

            try {
                window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(mode, 5000);
            } catch (_) {}
        }

        // -----------------------------------------------------------
        // TTS voice helpers
        // -----------------------------------------------------------

        /**
         * Get TTS parameter overrides derived from persona voice_style.
         * Returns an object with { rate, pitch } that can be applied
         * to SpeechSynthesisUtterance or SpeechSettings.
         *
         * @param {object} [currentSettings] - Current TTS settings to blend with
         * @returns {{ rate: number, pitch: number } | null}
         */
        getVoiceOverrides(currentSettings = {}) {
            if (!this._context?.voice) return null;

            const voice = this._context.voice;
            const currentRate = currentSettings.rate ?? 1.0;
            const currentPitch = currentSettings.pitch ?? 1.0;

            // Apply persona bias as a multiplier on the user's settings
            const rateBias = voice.rate_bias ?? 1.0;
            const pitchBias = voice.pitch_bias ?? 1.0;
            const pauseAdj = PAUSE_RATE_MAP[voice.pause_style] ?? 1.0;

            return {
                rate: Math.max(0.1, Math.min(3.0, currentRate * rateBias * pauseAdj)),
                pitch: Math.max(0.1, Math.min(2.0, currentPitch * pitchBias)),
            };
        }

        // -----------------------------------------------------------
        // Response style helpers
        // -----------------------------------------------------------

        /**
         * Check whether the persona uses emoji in responses.
         * UI can use this to enable/disable emoji rendering.
         */
        usesEmoji() {
            return this._context?.response?.use_emoji ?? false;
        }

        /**
         * Get the persona's preferred response length.
         * @returns {"short"|"medium"|"long"|null}
         */
        getResponseLength() {
            return this._context?.response?.max_length ?? null;
        }

        /**
         * Get user facts known to the persona (from HomePilot LTM).
         * @returns {object} key→value map (e.g. {name: "Marco", job: "engineer"})
         */
        getUserFacts() {
            return this._context?.user_facts ?? {};
        }

        /**
         * Get user preferences known to the persona.
         * @returns {object} key→value map
         */
        getUserPreferences() {
            return this._context?.user_preferences ?? {};
        }

        // -----------------------------------------------------------
        // Safety
        // -----------------------------------------------------------

        /**
         * Check if the persona requires an adult gate before interaction.
         */
        requiresAdultGate() {
            return this._context?.safety?.requires_adult_gate ?? false;
        }

        // -----------------------------------------------------------
        // Internals
        // -----------------------------------------------------------

        async _doFetch(baseUrl, model, authToken) {
            const url = `${baseUrl.replace(/\/$/, '')}/v1/persona/context/${encodeURIComponent(model)}`;
            const headers = { Accept: 'application/json' };
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            try {
                const res = await fetch(url, { method: 'GET', headers });
                if (!res.ok) {
                    console.warn('[PersonaContext] Failed to fetch context:', res.status);
                    return this._context; // Keep stale
                }

                const data = await res.json();
                if (!data.ok || !data.context) {
                    console.warn('[PersonaContext] Unexpected response:', data.error || 'no context');
                    return this._context;
                }

                this._context = data.context;
                this._fetchedAt = Date.now();
                this._lastModel = model;

                // Persist to sessionStorage for fast restore
                try {
                    sessionStorage.setItem(
                        CACHE_KEY,
                        JSON.stringify({
                            context: this._context,
                            fetchedAt: this._fetchedAt,
                            model: model,
                        })
                    );
                } catch (_) {}

                console.log('[PersonaContext] Loaded context for', model, this._context);
                return this._context;
            } catch (err) {
                console.warn('[PersonaContext] Fetch error:', err.message);
                return this._context; // Keep stale
            }
        }
    }

    // Singleton
    global.PersonaContextBridge = new PersonaContextBridge();
})(typeof window !== 'undefined' ? window : globalThis);
