/**
 * PiperWasmTTSProvider — Client-side TTS via Piper WASM.
 *
 * Runs entirely in the browser (no API key needed).
 * Uses @mintplex-labs/piper-tts-web which loads ONNX models from HuggingFace
 * and synthesizes speech via WebAssembly.
 *
 * Models are downloaded on first use and cached by the browser (OPFS).
 *
 * @see https://github.com/Mintplex-Labs/piper-tts-web
 * @see https://rhasspy.github.io/piper-samples/
 */

'use strict';

(function () {
    /* ----------------------------------------------------------
       CDN URL for the ESM module
       ---------------------------------------------------------- */
    const CDN_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/piper-tts-web.js';

    /* ----------------------------------------------------------
       Voice catalog — curated from @mintplex-labs/piper-tts-web PATH_MAP.
       Covers all languages supported by the settings Language dropdown.
       Sorted: medium quality first, then low/high, female before male.
       @see https://rhasspy.github.io/piper-samples/

       MULTI-SPEAKER MODELS (`multi: true`) — piper-tts-web hardcodes
       `const speakerId = 0`, so for these models it ALWAYS synthesizes
       speaker 0 and the other speakers are unreachable. A gender tag on such
       a model is therefore a promise about speaker 0 only. Where the model's
       speaker_id_map identifies speaker 0 (e.g. es_ES-sharvard = {"M":0,"F":1}
       → male; fr_FR-upmc = {"jessica":0,"pierre":1} → female) the tag below is
       that speaker's real gender. Where speaker 0 is an anonymous corpus ID
       (LibriTTS-R 3922, MLS 2422, ARU 03) the gender is honestly 'unknown' so
       the "Prefer Female/Male" filter never promises what it can't deliver.
       `speakers` counts are read from each model's own .onnx.json config.

       RUNTIME COMPATIBILITY — only models with `num_symbols: 256` work here.
       piper-tts-web generates phoneme IDs with its own bundled (modern)
       piper_phonemize WASM, passing ONLY `espeak.voice` from the config; the
       model's own phoneme_id_map is never consulted. Older piper 0.2.0 models
       have a 130-symbol embedding table, so they receive IDs outside their
       range, ONNX throws (OrtRun), and speak() silently falls back to ENGLISH.
       Sixteen such models were listed here — every one of them "worked" in the
       dropdown and then spoke English, which is why Spanish appeared broken.
       They are removed; `node tests/piper-catalog-audit.mjs` now fails on any
       model that is not 256-symbol, so none can come back by accident.
       ---------------------------------------------------------- */
    const PIPER_VOICES = [
        // ── English (US) ──
        { id: 'en_US-hfc_female-medium', name: 'HFC Female', lang: 'en-US', gender: 'female', quality: 'medium' },
        { id: 'en_US-lessac-high', name: 'Lessac (HQ)', lang: 'en-US', gender: 'female', quality: 'high' },
        { id: 'en_US-ljspeech-high', name: 'LJSpeech (HQ)', lang: 'en-US', gender: 'female', quality: 'high' },
        { id: 'en_US-lessac-medium', name: 'Lessac', lang: 'en-US', gender: 'female', quality: 'medium' },
        { id: 'en_US-kristin-medium', name: 'Kristin', lang: 'en-US', gender: 'female', quality: 'medium' },
        // 904 speakers; plays speaker 0 = LibriTTS-R corpus ID "3922" (gender
        // not published) — not offered under a gender preference.
        {
            id: 'en_US-libritts_r-medium',
            name: 'LibriTTS-R (multi-speaker)',
            lang: 'en-US',
            gender: 'unknown',
            quality: 'medium',
            speakers: 904,
            multi: true,
        },
        { id: 'en_US-amy-medium', name: 'Amy', lang: 'en-US', gender: 'female', quality: 'medium' },
        { id: 'en_US-hfc_male-medium', name: 'HFC Male', lang: 'en-US', gender: 'male', quality: 'medium' },
        { id: 'en_US-ryan-medium', name: 'Ryan', lang: 'en-US', gender: 'male', quality: 'medium' },
        { id: 'en_US-joe-medium', name: 'Joe', lang: 'en-US', gender: 'male', quality: 'medium' },
        { id: 'en_US-john-medium', name: 'John', lang: 'en-US', gender: 'male', quality: 'medium' },
        { id: 'en_US-bryce-medium', name: 'Bryce', lang: 'en-US', gender: 'male', quality: 'medium' },
        { id: 'en_US-norman-medium', name: 'Norman', lang: 'en-US', gender: 'male', quality: 'medium' },
        // 18 speakers; plays speaker 0 = CMU Arctic "awb" (male).
        {
            id: 'en_US-arctic-medium',
            name: 'Arctic (awb)',
            lang: 'en-US',
            gender: 'male',
            quality: 'medium',
            speakers: 18,
            multi: true,
        },
        // ── English (UK) ──
        { id: 'en_GB-alba-medium', name: 'Alba', lang: 'en-GB', gender: 'female', quality: 'medium' },
        { id: 'en_GB-cori-high', name: 'Cori (HQ)', lang: 'en-GB', gender: 'female', quality: 'high' },
        { id: 'en_GB-cori-medium', name: 'Cori', lang: 'en-GB', gender: 'female', quality: 'medium' },
        { id: 'en_GB-jenny_dioco-medium', name: 'Jenny Dioco', lang: 'en-GB', gender: 'female', quality: 'medium' },
        { id: 'en_GB-alan-medium', name: 'Alan', lang: 'en-GB', gender: 'male', quality: 'medium' },
        {
            id: 'en_GB-northern_english_male-medium',
            name: 'Northern Male',
            lang: 'en-GB',
            gender: 'male',
            quality: 'medium',
        },
        // 12 speakers; plays speaker 0 = ARU corpus ID "03" (gender not
        // published) — not offered under a gender preference.
        {
            id: 'en_GB-aru-medium',
            name: 'Aru (multi-speaker)',
            lang: 'en-GB',
            gender: 'unknown',
            quality: 'medium',
            speakers: 12,
            multi: true,
        },
        // ── Español ──
        // NO FEMALE SPANISH VOICE EXISTS in the official Piper catalog that this
        // runtime can play. The two candidates both fail: mls_10246 is a 130-
        // symbol piper 0.2.0 model (throws, falls back to English — this is what
        // "Spanish doesn't work" was), and sharvard's female speaker sits at
        // index 1 of a 2-speaker map {"M":0,"F":1} while the runtime is hardwired
        // to speaker 0, the MALE one. So "Prefer Female" + Español falls back to
        // a male voice here; for a female Spanish voice use the built-in engine,
        // whose device voices (Google español, Mónica, Helena…) are female.
        // Claude (Mexico) is the only HIGH-quality official Spanish model.
        {
            id: 'es_ES-sharvard-medium',
            name: 'SHarvard (male speaker)',
            lang: 'es-ES',
            gender: 'male',
            quality: 'medium',
            speakers: 2,
            multi: true,
        },
        { id: 'es_ES-davefx-medium', name: 'DaveFX', lang: 'es-ES', gender: 'male', quality: 'medium' },
        { id: 'es_MX-ald-medium', name: 'Ald (Mexico)', lang: 'es-ES', gender: 'male', quality: 'medium' },
        { id: 'es_MX-claude-high', name: 'Claude (Mexico, HQ)', lang: 'es-ES', gender: 'male', quality: 'high' },
        // ── Français ──
        { id: 'fr_FR-siwis-medium', name: 'Siwis', lang: 'fr-FR', gender: 'female', quality: 'medium' },
        { id: 'fr_FR-tom-medium', name: 'Tom', lang: 'fr-FR', gender: 'male', quality: 'medium' },
        // 2 speakers; speaker_id_map is {"jessica":0,"pierre":1} and the runtime
        // plays speaker 0 — so this is JESSICA (female), not the male voice the
        // catalog used to promise. Pierre is unreachable.
        {
            id: 'fr_FR-upmc-medium',
            name: 'UPMC (Jessica)',
            lang: 'fr-FR',
            gender: 'female',
            quality: 'medium',
            speakers: 2,
            multi: true,
        },
        // ── Deutsch ──
        { id: 'de_DE-thorsten-high', name: 'Thorsten (HQ)', lang: 'de-DE', gender: 'male', quality: 'high' },
        { id: 'de_DE-thorsten-medium', name: 'Thorsten', lang: 'de-DE', gender: 'male', quality: 'medium' },
        // 8 "speakers" are Thorsten's emotions {"amused":0,…}; the runtime plays
        // speaker 0 = "amused". Still Thorsten, so the male tag holds.
        {
            id: 'de_DE-thorsten_emotional-medium',
            name: 'Thorsten Emotional (amused)',
            lang: 'de-DE',
            gender: 'male',
            quality: 'medium',
            speakers: 8,
            multi: true,
        },
        // 236 speakers; plays speaker 0 = MLS corpus ID "2422" (gender not
        // published) — not offered under a gender preference.
        {
            id: 'de_DE-mls-medium',
            name: 'MLS (multi-speaker)',
            lang: 'de-DE',
            gender: 'unknown',
            quality: 'medium',
            speakers: 236,
            multi: true,
        },
        // ── Italiano ──
        { id: 'it_IT-paola-medium', name: 'Paola', lang: 'it-IT', gender: 'female', quality: 'medium' },
        // ── Português (BR) ──
        // Piper publishes no Brazilian FEMALE model — "Prefer Female" here
        // falls back to a male voice (the matrix test marks it ⚠).
        { id: 'pt_BR-faber-medium', name: 'Faber', lang: 'pt-BR', gender: 'male', quality: 'medium' },
        // ── 中文 (Chinese, Mandarin) ──
        { id: 'zh_CN-huayan-medium', name: 'Huayan', lang: 'zh-CN', gender: 'female', quality: 'medium' },
        // ── 日本語 (no Piper voices exist — the app steers to the built-in engine) ──
        // ── 한국어 (no Piper voices exist — the app steers to the built-in engine) ──
    ];

    /* ----------------------------------------------------------
       State
       ---------------------------------------------------------- */
    let _predict = null; // The predict() function from the module
    let _TtsSession = null; // TtsSession class ref (needed to bust singleton cache)
    let _flush = null; // flush() — clears OPFS model cache
    let _audioCtx = null;
    let _currentSource = null; // AudioBufferSourceNode for stop()
    let _selectedVoiceId = localStorage.getItem('piper_voice') || 'en_US-hfc_female-medium';
    let _lastSpokenVoiceId = null; // Track which model is actually loaded
    let _loading = false;

    /* ----------------------------------------------------------
       Lazy-load the @mintplex-labs/piper-tts-web ESM module
       ---------------------------------------------------------- */
    async function _loadModule() {
        if (_predict) return _predict;
        if (_loading) {
            // Wait for ongoing load
            while (_loading) {
                await new Promise((r) => setTimeout(r, 100));
            }
            return _predict;
        }

        _loading = true;
        try {
            console.log('[PiperWasm] loading module from CDN...');
            const mod = await import(/* webpackIgnore: true */ CDN_URL);

            // The module exports: predict, download, remove, stored, flush, voices, TtsSession
            if (typeof mod.predict !== 'function') {
                throw new Error('predict() not found in piper-tts-web module');
            }
            _predict = mod.predict;
            _TtsSession = mod.TtsSession || null;
            _flush = typeof mod.flush === 'function' ? mod.flush : null;
            console.log(
                '[PiperWasm] module loaded successfully (TtsSession:',
                !!_TtsSession,
                ', flush:',
                !!_flush,
                ')'
            );
            return _predict;
        } catch (err) {
            console.error('[PiperWasm] failed to load module:', err);
            throw err;
        } finally {
            _loading = false;
        }
    }

    function _getAudioContext() {
        if (!_audioCtx || _audioCtx.state === 'closed') {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
            _audioCtx.resume();
        }
        return _audioCtx;
    }

    /* ----------------------------------------------------------
       Provider interface
       ---------------------------------------------------------- */
    const PiperWasmProvider = {
        displayName: 'Piper (offline, no API key)',

        async init() {
            // Pre-load the module so first speak() is faster
            await _loadModule();
        },

        /**
         * Synthesize and play speech.
         *
         * @param {string} text
         * @param {object} opts  { rate, pitch, onEnd, onError }
         */
        async speak(text, opts) {
            const { rate = 1.0, onEnd, onError } = opts || {};

            try {
                const predict = await _loadModule();
                const ctx = _getAudioContext();

                // WORKAROUND: piper-tts-web uses a singleton TtsSession that
                // caches the first loaded ONNX model. When the voiceId changes,
                // we must null the singleton so predict() creates a fresh session
                // that downloads and loads the new voice model.
                if (_lastSpokenVoiceId && _lastSpokenVoiceId !== _selectedVoiceId && _TtsSession) {
                    console.log(
                        '[PiperWasm] voice model changed, resetting TtsSession singleton:',
                        _lastSpokenVoiceId,
                        '→',
                        _selectedVoiceId
                    );
                    _TtsSession._instance = null;
                }

                // predict() returns a Blob (audio/x-wav)
                console.log(
                    '[PiperWasm] synthesizing with voice:',
                    _selectedVoiceId,
                    '| text:',
                    text.slice(0, 60) + '...'
                );
                let audioBlob;
                try {
                    audioBlob = await predict({ voiceId: _selectedVoiceId, text });
                } catch (predictErr) {
                    // If OPFS quota exceeded, flush cache and retry once
                    const isQuota =
                        predictErr &&
                        (String(predictErr).includes('QuotaExceeded') || String(predictErr).includes('NotReadable'));
                    if (isQuota && _flush) {
                        console.warn('[PiperWasm] OPFS quota hit, flushing cache and retrying...');
                        await _flush();
                        if (_TtsSession) _TtsSession._instance = null;
                        audioBlob = await predict({ voiceId: _selectedVoiceId, text });
                    } else {
                        throw predictErr;
                    }
                }

                _lastSpokenVoiceId = _selectedVoiceId;

                if (!audioBlob || audioBlob.size === 0) {
                    throw new Error('Piper returned empty audio');
                }

                // Decode WAV blob into AudioBuffer
                const arrayBuffer = await audioBlob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                // Stop any previous playback
                _stopCurrent();

                // Play via AudioBufferSourceNode
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = Math.max(0.25, Math.min(4.0, rate));
                source.connect(ctx.destination);

                source.onended = () => {
                    _currentSource = null;
                    if (typeof onEnd === 'function') onEnd();
                };

                _currentSource = source;
                source.start(0);
                console.log('[PiperWasm] playing audio (' + audioBlob.size + ' bytes)');
            } catch (err) {
                console.error('[PiperWasm] speak error:', err);
                _currentSource = null;

                // ONNX model errors (phoneme out of bounds) — try fallback voice
                const isModelError = err && String(err).includes('OrtRun');
                if (isModelError && _TtsSession) {
                    const fallback = _selectedVoiceId.startsWith('en_')
                        ? 'en_US-hfc_female-medium'
                        : 'en_US-hfc_female-medium'; // safe English fallback
                    console.warn(
                        '[PiperWasm] model error for',
                        _selectedVoiceId,
                        '— retrying with fallback:',
                        fallback
                    );
                    _TtsSession._instance = null;
                    _lastSpokenVoiceId = null;
                    const prevVoice = _selectedVoiceId;
                    _selectedVoiceId = fallback;
                    try {
                        const predict = await _loadModule();
                        const audioBlob = await predict({ voiceId: fallback, text });
                        _lastSpokenVoiceId = fallback;
                        if (audioBlob && audioBlob.size > 0) {
                            const ctx = _getAudioContext();
                            const buf = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
                            _stopCurrent();
                            const source = ctx.createBufferSource();
                            source.buffer = buf;
                            source.playbackRate.value = Math.max(0.25, Math.min(4.0, rate));
                            source.connect(ctx.destination);
                            source.onended = () => {
                                _currentSource = null;
                                if (typeof onEnd === 'function') onEnd();
                            };
                            _currentSource = source;
                            source.start(0);
                            console.log('[PiperWasm] fallback playing (' + audioBlob.size + ' bytes)');
                            _selectedVoiceId = prevVoice; // restore user selection
                            return;
                        }
                    } catch (fallbackErr) {
                        console.error('[PiperWasm] fallback also failed:', fallbackErr);
                    }
                    _selectedVoiceId = prevVoice;
                }

                if (typeof onError === 'function') onError(err);
            }
        },

        stop() {
            _stopCurrent();
        },

        isAvailable() {
            return typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined';
        },

        getVoices() {
            return PIPER_VOICES.map((v) => ({ ...v }));
        },

        /** Get/set the selected voice model ID. */
        getSelectedVoice() {
            return _selectedVoiceId;
        },

        setSelectedVoice(voiceId) {
            const prev = _selectedVoiceId;
            _selectedVoiceId = voiceId || 'en_US-hfc_female-medium';
            localStorage.setItem('piper_voice', _selectedVoiceId);
            console.log('[PiperWasm] voice changed:', prev, '→', _selectedVoiceId);
        },
    };

    function _stopCurrent() {
        if (_currentSource) {
            try {
                _currentSource.stop();
            } catch (_) {}
            _currentSource = null;
        }
    }

    /* ----------------------------------------------------------
       Register with TTSProvider
       ---------------------------------------------------------- */
    if (window.TTSProvider) {
        window.TTSProvider.registerProvider('piper-wasm', PiperWasmProvider);
    } else {
        // TTSProvider not loaded yet — wait for DOMContentLoaded
        window.addEventListener('DOMContentLoaded', () => {
            if (window.TTSProvider) {
                window.TTSProvider.registerProvider('piper-wasm', PiperWasmProvider);
            } else {
                console.warn('[PiperWasm] TTSProvider not found; provider not registered');
            }
        });
    }

    // Also expose for direct access if needed
    window.PiperWasmTTSProvider = PiperWasmProvider;
})();
