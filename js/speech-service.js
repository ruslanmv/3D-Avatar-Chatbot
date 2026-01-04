/**
 * Speech Service Module
 * Handles speech-to-text (recognition) and text-to-speech (synthesis)
 */

class SpeechService {
    constructor() {
        // Speech Recognition (Speech-to-Text)
        this.recognition = null;
        this.isRecognitionSupported = false;
        this.isRecognizing = false;
        this.micPermissionGranted = false;
        this.micStream = null;
        this.recognitionCallbacks = {
            onResult: null,
            onInterim: null, // NEW: Callback for interim results
            onError: null,
            onStart: null,
            onEnd: null,
        };

        // VR Fallback (MediaRecorder for Quest)
        this.vrRecorder = null;
        this.vrRecordingChunks = [];

        // STT Provider Configuration
        this.sttConfig = this.loadSTTConfig();
        this.currentSTTProvider = null; // Current active provider
        this.whisperWorker = null; // WASM Whisper worker
        this.whisperModelLoaded = false;

        // Speech Synthesis (Text-to-Speech)
        this.synthesis = window.speechSynthesis;
        this.isSynthesisSupported = 'speechSynthesis' in window;
        this.voices = [];
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.speakingCallbacks = {
            onStart: null,
            onEnd: null,
            onError: null,
        };

        // Recognition options (configurable)
        this.recognitionOptions = {
            continuous: false,
            interimResults: true, // Enable interim results by default
            maxAlternatives: 1,
            lang: 'en-US',
        };

        // Detect browser environment
        this.browserInfo = this.detectBrowser();

        this.initializeSpeechRecognition();
        this.initializeSpeechSynthesis();
    }

    /**
     * Detect browser environment
     * @returns {object} Browser detection info
     */
    detectBrowser() {
        const ua = navigator.userAgent;
        const info = {
            isQuest: ua.includes('Quest') || ua.includes('Oculus'),
            isChrome: ua.includes('Chrome') && !ua.includes('Edge'),
            isEdge: ua.includes('Edge'),
            isSafari: ua.includes('Safari') && !ua.includes('Chrome'),
            isFirefox: ua.includes('Firefox'),
            userAgent: ua,
        };

        // Log browser detection
        console.log('[SpeechService] Browser:', info.isQuest ? '🥽 Quest VR' : '🖥️ Desktop');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT Browser detected', {
                browser: info.isQuest ? 'Quest' : info.isChrome ? 'Chrome' : 'Other',
            });
        }

        return info;
    }

    /**
     * Initialize Speech Recognition
     */
    initializeSpeechRecognition() {
        // Check for Speech Recognition API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (SpeechRecognition) {
            this.isRecognitionSupported = true;
            this.recognition = new SpeechRecognition();

            console.log('[SpeechService] ✅ Web Speech Recognition available');
            console.log('[SpeechService] 📊 Recognition implementation:', SpeechRecognition.name);
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.info('STT Web Speech API available');
            }

            // Configure recognition with options
            this.applyRecognitionOptions();

            // Set up event handlers
            this.recognition.onstart = () => {
                this.isRecognizing = true;
                const timestamp = new Date().toISOString();
                console.log(`[SpeechService] 🎙️ Speech recognition started at ${timestamp}`);
                console.log('[SpeechService] 📋 Options:', {
                    continuous: this.recognition.continuous,
                    interimResults: this.recognition.interimResults,
                    lang: this.recognition.lang,
                    maxAlternatives: this.recognition.maxAlternatives,
                });
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT started', { timestamp });
                }
                if (this.recognitionCallbacks.onStart) {
                    this.recognitionCallbacks.onStart();
                }

                // Start monitoring audio levels
                this._startAudioMonitoring();
            };

            this.recognition.onaudiostart = () => {
                console.log('[SpeechService] 🔊 Audio capture started - browser is now listening to microphone');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT audio capture started');
                }
            };

            this.recognition.onaudioend = () => {
                console.log('[SpeechService] 🔇 Audio capture ended');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT audio capture ended');
                }
                this._stopAudioMonitoring();
            };

            this.recognition.onsoundstart = () => {
                console.log('[SpeechService] 🔊 Sound detected - audio is being picked up!');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT sound detected');
                }
            };

            this.recognition.onsoundend = () => {
                console.log('[SpeechService] 🔇 Sound ended');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT sound ended');
                }
            };

            this.recognition.onspeechstart = () => {
                console.log('[SpeechService] 🗣️ Speech detected - recognition is processing speech!');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT speech detected');
                }
            };

            this.recognition.onspeechend = () => {
                console.log('[SpeechService] 🗣️ Speech ended');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT speech ended');
                }
            };

            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                // Process all results from the current index
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    const transcript = result[0].transcript;

                    if (result.isFinal) {
                        finalTranscript += `${transcript} `;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                // Call interim callback if available
                if (interimTranscript && this.recognitionCallbacks.onInterim) {
                    console.log(`[SpeechService] 📝 Interim: "${interimTranscript.trim()}"`);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT interim', { text: interimTranscript.trim() });
                    }
                    this.recognitionCallbacks.onInterim(interimTranscript.trim());
                }

                // Call result callback for final transcripts
                if (finalTranscript && this.recognitionCallbacks.onResult) {
                    const confidence = event.results[event.resultIndex][0].confidence || 1.0;
                    const confidencePercent = Math.round(confidence * 100);
                    console.log(
                        `[SpeechService] ✅ Final: "${finalTranscript.trim()}" (${confidencePercent}% confidence)`
                    );
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT final', {
                            text: finalTranscript.trim(),
                            confidence: confidencePercent,
                        });
                    }
                    this.recognitionCallbacks.onResult(finalTranscript.trim(), confidence);
                }
            };

            this.recognition.onerror = (event) => {
                const timestamp = new Date().toISOString();
                console.error(`[SpeechService] ⚠️ Error at ${timestamp}: ${event.error}`);
                console.error('[SpeechService] 📊 Error details:', {
                    error: event.error,
                    message: event.message,
                    timestamp,
                    wasRecognizing: this.isRecognizing,
                });
                this.isRecognizing = false;

                let errorMessage = 'Speech recognition failed';
                let errorContext = '';

                switch (event.error) {
                    case 'no-speech':
                        errorMessage = 'No speech detected. Please try again.';
                        console.warn('[SpeechService] ⚠️ NO-SPEECH DEBUG INFO:');
                        console.warn('  - Microphone permission: granted');
                        console.warn('  - Recognition started: YES');
                        console.warn(
                            '  - Audio events received: Check logs above for 🔊 onaudiostart, onsoundstart, onspeechstart'
                        );
                        console.warn('  - Timeout: ~8 seconds passed without detecting speech');
                        console.warn('  - SOLUTION: Check microphone settings, increase volume, speak louder');
                        console.warn('  - TRY: Use test-microphone.html to verify microphone is working');
                        break;
                    case 'audio-capture':
                        errorMessage = 'Microphone not found or permission denied.';
                        errorContext = 'Please check your microphone connection.';
                        break;
                    case 'not-allowed':
                        errorMessage = 'Microphone access denied.';
                        errorContext = 'Please allow microphone access in your browser settings.';
                        this.micPermissionGranted = false;
                        break;
                    case 'network':
                        errorMessage = 'Network error occurred.';
                        errorContext = 'Speech recognition requires an internet connection in most browsers.';
                        break;
                    case 'aborted':
                        errorMessage = 'Speech recognition was aborted.';
                        break;
                    case 'service-not-allowed':
                        errorMessage = 'Speech recognition service not allowed.';
                        errorContext = 'This may happen in VR or incognito mode.';
                        break;
                }

                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.error('STT error', { error: event.error, message: errorMessage });
                }

                if (this.recognitionCallbacks.onError) {
                    this.recognitionCallbacks.onError(errorMessage, errorContext);
                }
            };

            this.recognition.onend = () => {
                this.isRecognizing = false;
                console.log('[SpeechService] ⏹️ Speech recognition ended');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT ended');
                }
                if (this.recognitionCallbacks.onEnd) {
                    this.recognitionCallbacks.onEnd();
                }
            };
        } else {
            console.warn('[SpeechService] ❌ Speech Recognition API not supported in this browser');
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.warn('STT not supported', { browser: this.browserInfo.userAgent });
            }
        }
    }

    /**
     * Apply recognition options to the recognition instance
     */
    applyRecognitionOptions() {
        if (!this.recognition) {
            return;
        }

        this.recognition.continuous = this.recognitionOptions.continuous;
        this.recognition.interimResults = this.recognitionOptions.interimResults;
        this.recognition.lang = this.recognitionOptions.lang;
        this.recognition.maxAlternatives = this.recognitionOptions.maxAlternatives;
    }

    /**
     * Initialize Speech Synthesis
     */
    initializeSpeechSynthesis() {
        if (this.isSynthesisSupported) {
            // Load voices
            this.loadVoices();

            // Voices may load asynchronously
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = () => {
                    this.loadVoices();
                };
            }
        } else {
            console.warn('Speech Synthesis API not supported in this browser');
        }
    }

    /**
     * Load available voices
     */
    loadVoices() {
        this.voices = this.synthesis.getVoices();
        console.log(`[SpeechService] 🔊 Loaded ${this.voices.length} voices`);

        if (this.voices.length === 0) {
            console.warn('[SpeechService] ⚠️ Voices empty; will retry on voiceschanged');
        } else {
            const preview = this.voices.slice(0, 5).map((v) => `${v.name} (${v.lang})`);
            console.log('[SpeechService] 🔊 First voices:', preview);
        }

        // Dispatch custom event for voice list update
        window.dispatchEvent(new CustomEvent('voicesLoaded', { detail: this.voices }));
    }

    /**
     * Get available voices
     */
    getVoices() {
        return this.voices;
    }

    /**
     * Ensure voices are loaded (Quest/VR timing fix)
     * On some browsers (Quest especially), speechSynthesis.getVoices() returns []
     * until voiceschanged fires. This ensures voices are loaded before selecting.
     * @param {number} timeoutMs - Maximum time to wait for voices (default: 1500ms)
     * @returns {Promise<boolean>} True if voices loaded, false if timeout
     */
    async _ensureVoicesLoaded(timeoutMs = 1500) {
        if (this.voices && this.voices.length) {
            return true;
        }

        // Try loading immediately
        this.loadVoices();
        if (this.voices.length) {
            return true;
        }

        // Wait for voiceschanged (common on Quest/Chrome)
        return new Promise((resolve) => {
            let done = false;

            const finish = (ok) => {
                if (done) {
                    return;
                }
                done = true;
                resolve(ok);
            };

            const t = setTimeout(() => finish(false), timeoutMs);

            const handler = () => {
                clearTimeout(t);
                this.loadVoices();
                finish(this.voices.length > 0);
            };

            // Modern listener
            if (speechSynthesis.addEventListener) {
                speechSynthesis.addEventListener('voiceschanged', handler, { once: true });
            } else {
                // Fallback
                const prev = speechSynthesis.onvoiceschanged;
                speechSynthesis.onvoiceschanged = (e) => {
                    if (typeof prev === 'function') {
                        prev(e);
                    }
                    handler();
                };
            }
        });
    }

    /**
     * Get speech preferences from localStorage (shared with desktop/VR settings)
     * Removes dependency on global AppConfig
     * @returns {object} Speech preferences with safe defaults
     */
    _getSpeechPrefs() {
        const defaults = {
            speechVoice: '', // voice NAME
            speechVoiceURI: '', // voice URI
            speechRate: 0.9,
            speechPitch: 1.0,
            speechVolume: 1.0,
            speechLang: 'en-US',
            ttsEnabled: true,
        };

        try {
            const raw = localStorage.getItem('nexus_settings_v1');
            if (!raw) {
                return defaults;
            }

            const s = JSON.parse(raw);

            // Back-compat safety:
            // Some older builds accidentally stored URI in speechVoice.
            // We only treat speechVoice as a URI if it "looks like" one.
            const speechVoiceRaw = s.speechVoice || s.selectedVoice || '';
            const looksLikeURI =
                typeof speechVoiceRaw === 'string' &&
                (speechVoiceRaw.includes('://') || speechVoiceRaw.startsWith('urn:') || speechVoiceRaw.includes('.'));

            return {
                ...defaults,

                // ✅ Name (only if it doesn't look like a URI)
                speechVoice: looksLikeURI ? '' : speechVoiceRaw,

                // ✅ URI from explicit field first; fallback to legacy mistake if it looks like URI
                speechVoiceURI: s.speechVoiceURI || (looksLikeURI ? speechVoiceRaw : ''),

                speechRate: typeof s.speechRate === 'number' ? s.speechRate : defaults.speechRate,
                speechPitch: typeof s.speechPitch === 'number' ? s.speechPitch : defaults.speechPitch,
                speechVolume: typeof s.speechVolume === 'number' ? s.speechVolume : defaults.speechVolume,
                speechLang: s.speechLang || defaults.speechLang,
                ttsEnabled: typeof s.ttsEnabled === 'boolean' ? s.ttsEnabled : defaults.ttsEnabled,
            };
        } catch (e) {
            console.warn('[SpeechService] ⚠️ Failed reading speech prefs from localStorage:', e);
            return defaults;
        }
    }

    /**
     * Get default or preferred voice
     */
    getPreferredVoice() {
        const prefs = this._getSpeechPrefs();

        console.log('[SpeechService] 🔎 getPreferredVoice()', {
            speechVoice: prefs.speechVoice,
            speechVoiceURI: prefs.speechVoiceURI,
            lang: prefs.speechLang,
            voicesLoaded: this.voices?.length || 0,
        });

        // 1) Exact URI match (best)
        if (prefs.speechVoiceURI) {
            const byURI = this.voices.find((v) => v.voiceURI === prefs.speechVoiceURI);
            if (byURI) {
                return byURI;
            }
            console.warn('[SpeechService] ⚠️ Saved voiceURI not found:', prefs.speechVoiceURI);
        }

        // 2) Exact name match (backwards compatible)
        if (prefs.speechVoice) {
            const byName = this.voices.find((v) => v.name === prefs.speechVoice);
            if (byName) {
                return byName;
            }
            console.warn('[SpeechService] ⚠️ Saved voice name not found:', prefs.speechVoice);
        }

        // 3) Language fallback
        const lang = prefs.speechLang || 'en-US';
        const base = lang.split('-')[0].toLowerCase();

        const langVoices = this.voices.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
        const pool = langVoices.length ? langVoices : this.voices;

        // 4) Friendly heuristic fallback
        const preferred = pool.find((v) => /female|samantha|victoria|zira|google/i.test(v.name)) || pool[0] || null;

        return preferred;
    }

    /**
     * Request microphone permission using getUserMedia
     * This is especially important for VR and ensures permission before starting recognition
     * @returns {Promise<boolean>} True if permission granted
     */
    async requestMicrophonePermission() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('getUserMedia not supported');
            return false;
        }

        if (this.micPermissionGranted && this.micStream) {
            return true;
        }

        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.micStream = stream;
            this.micPermissionGranted = true;
            console.log('✅ Microphone permission granted');

            // Stop the stream - we don't need to keep it open
            // The Web Speech API will request it again when needed
            setTimeout(() => {
                if (this.micStream) {
                    this.micStream.getTracks().forEach((track) => track.stop());
                }
            }, 100);

            return true;
        } catch (error) {
            console.error('Microphone permission denied:', error);
            this.micPermissionGranted = false;
            return false;
        }
    }

    /**
     * Check if microphone permission is granted
     * @returns {boolean}
     */
    hasMicrophonePermission() {
        return this.micPermissionGranted;
    }

    /**
     * Set recognition options
     * @param {object} options - Recognition options
     */
    setRecognitionOptions(options = {}) {
        this.recognitionOptions = {
            ...this.recognitionOptions,
            ...options,
        };
        this.applyRecognitionOptions();
        console.log('Recognition options updated:', this.recognitionOptions);
    }

    /**
     * Set persistent recognition callbacks (used by VRChatIntegration)
     * These are used as defaults and can be overridden per startRecognition call.
     * @param {object} callbacks - Recognition callbacks
     */
    setRecognitionCallbacks(callbacks = {}) {
        this.recognitionCallbacks = {
            ...this.recognitionCallbacks,
            ...callbacks,
        };
        console.log('[SpeechService] ✅ Recognition callbacks registered:', Object.keys(callbacks));
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT recognition callbacks registered', { keys: Object.keys(callbacks) });
        }
    }

    /**
     * Start speech recognition
     * @param {object} callbacks - Event callbacks
     * @param {boolean} requestPermission - Whether to request mic permission first (default: true)
     */
    async startRecognition(callbacks = {}, requestPermission = true) {
        if (!this.isRecognitionSupported) {
            const error = 'Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.';
            if (callbacks.onError) {
                callbacks.onError(error);
            }
            return false;
        }

        if (this.isRecognizing) {
            console.warn('Speech recognition already in progress');
            return false;
        }

        // Request microphone permission first (important for VR)
        if (requestPermission && !this.micPermissionGranted) {
            const granted = await this.requestMicrophonePermission();
            if (!granted) {
                const error = 'Microphone permission required for speech recognition';
                if (callbacks.onError) {
                    callbacks.onError(error, 'Please allow microphone access when prompted.');
                }
                return false;
            }
        }

        // Set callbacks
        this.recognitionCallbacks = { ...this.recognitionCallbacks, ...callbacks };

        try {
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('Failed to start recognition:', error);
            if (callbacks.onError) {
                callbacks.onError('Failed to start speech recognition', error.message);
            }
            return false;
        }
    }

    /**
     * Stop speech recognition
     */
    stopRecognition() {
        if (this.isRecognizing && this.recognition) {
            this.recognition.stop();
        }
    }

    /**
     * Speak text using text-to-speech
     * @param text
     * @param callbacks
     */
    async speak(text, callbacks = {}) {
        if (!this.isSynthesisSupported) {
            console.warn('Speech synthesis not supported');
            if (callbacks.onError) {
                callbacks.onError('Text-to-speech is not supported in your browser');
            }
            return false;
        }

        const prefs = this._getSpeechPrefs();

        // Respect desktop/VR toggle
        if (!prefs.ttsEnabled) {
            console.log('[SpeechService] 🔇 TTS disabled (prefs.ttsEnabled=false). Skipping speak().');
            if (callbacks.onEnd) {
                callbacks.onEnd();
            }
            return true;
        }

        // ✅ Quest/VR timing fix: ensure voices are actually available
        await this._ensureVoicesLoaded();

        // Stop any current speech
        this.stopSpeaking();

        this.currentUtterance = new SpeechSynthesisUtterance(text);

        // ✅ Apply language (helps selection)
        this.currentUtterance.lang = prefs.speechLang || 'en-US';

        // Set voice
        const voice = this.getPreferredVoice();
        if (voice) {
            this.currentUtterance.voice = voice;
        }

        // Apply properties
        this.currentUtterance.rate = prefs.speechRate;
        this.currentUtterance.pitch = prefs.speechPitch;
        this.currentUtterance.volume = prefs.speechVolume;

        console.log('[SpeechService] 🗣️ speak()', {
            textPreview: String(text).slice(0, 60),
            lang: this.currentUtterance.lang,
            rate: this.currentUtterance.rate,
            pitch: this.currentUtterance.pitch,
            volume: this.currentUtterance.volume,
            selectedVoice: this.currentUtterance.voice?.name || '(default)',
            selectedVoiceURI: this.currentUtterance.voice?.voiceURI || '(none)',
            voicesLoaded: this.voices.length,
        });

        this.speakingCallbacks = callbacks;

        this.currentUtterance.onstart = () => {
            this.isSpeaking = true;
            if (this.speakingCallbacks.onStart) {
                this.speakingCallbacks.onStart();
            }
        };

        this.currentUtterance.onend = () => {
            this.isSpeaking = false;
            if (this.speakingCallbacks.onEnd) {
                this.speakingCallbacks.onEnd();
            }
        };

        this.currentUtterance.onerror = (event) => {
            this.isSpeaking = false;

            // ✅ Ignore "interrupted" errors (non-fatal - happens when user speaks while TTS is active)
            if (event.error === 'interrupted') {
                console.log('[SpeechService] TTS interrupted (user is speaking, non-fatal)');
                if (this.speakingCallbacks.onEnd) {
                    this.speakingCallbacks.onEnd();
                }
                return;
            }

            console.error('[SpeechService] Speech synthesis error:', event.error);
            if (this.speakingCallbacks.onError) {
                this.speakingCallbacks.onError('Text-to-speech failed');
            }
        };

        try {
            this.synthesis.speak(this.currentUtterance);
            return true;
        } catch (error) {
            console.error('Failed to speak:', error);
            if (callbacks.onError) {
                callbacks.onError('Failed to start text-to-speech');
            }
            return false;
        }
    }

    /**
     * Stop speaking (improved to prevent interrupted errors)
     */
    stopSpeaking() {
        try {
            if (this.isSpeaking || this.synthesis.speaking) {
                this.synthesis.cancel();
                this.isSpeaking = false;
                this.currentUtterance = null;
            }
        } catch (e) {
            console.warn('[SpeechService] Error stopping speech (non-fatal):', e);
            this.isSpeaking = false;
        }
    }

    /**
     * Pause speaking
     */
    pauseSpeaking() {
        if (this.isSpeaking) {
            this.synthesis.pause();
        }
    }

    /**
     * Resume speaking
     */
    resumeSpeaking() {
        if (this.synthesis.paused) {
            this.synthesis.resume();
        }
    }

    /**
     * Check if currently speaking
     */
    isSpeakingNow() {
        return this.isSpeaking || this.synthesis.speaking;
    }

    /**
     * Check if speech recognition is available
     */
    isRecognitionAvailable() {
        return this.isRecognitionSupported;
    }

    /**
     * Check if speech synthesis is available
     */
    isSynthesisAvailable() {
        return this.isSynthesisSupported;
    }

    /**
     * Set recognition language
     * @param lang
     */
    setRecognitionLanguage(lang) {
        if (this.recognition) {
            this.recognition.lang = lang;
        }
    }

    /**
     * Get supported features
     */
    getFeatures() {
        return {
            recognition: this.isRecognitionSupported,
            synthesis: this.isSynthesisSupported,
            voiceCount: this.voices.length,
        };
    }

    /**
     * Test speech capabilities
     */
    async testCapabilities() {
        const results = {
            recognition: false,
            synthesis: false,
            error: null,
        };

        // Test recognition
        if (this.isRecognitionSupported) {
            try {
                // Just check if we can create instance
                results.recognition = true;
            } catch (error) {
                results.error = `Recognition test failed: ${error.message}`;
            }
        }

        // Test synthesis
        if (this.isSynthesisSupported) {
            try {
                const testUtterance = new SpeechSynthesisUtterance('Test');
                testUtterance.volume = 0; // Silent test
                this.synthesis.speak(testUtterance);
                this.synthesis.cancel();
                results.synthesis = true;
            } catch (error) {
                results.error = `${results.error || ''} Synthesis test failed: ${error.message}`;
            }
        }

        return results;
    }

    /**
     * Start VR fallback recording using MediaRecorder
     * Used when Web Speech API is not available (e.g., Quest Browser)
     * @param {object} callbacks - Event callbacks
     * @returns {Promise<boolean>} Success status
     */
    async startVRFallbackRecording(callbacks = {}) {
        console.log('[SpeechService] 🎙️ Starting VR fallback recording (MediaRecorder)');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT VR fallback started');
        }

        try {
            // Request microphone access with selected device
            const stream = await navigator.mediaDevices.getUserMedia(this._getAudioConstraints());

            // Create MediaRecorder
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.vrRecorder = new MediaRecorder(stream, { mimeType });
            this.vrRecordingChunks = [];

            console.log(`[SpeechService] Recording with ${mimeType}`);

            // Handle recording events
            this.vrRecorder.onstart = () => {
                console.log('[SpeechService] 🎤 VR recording started');
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.info('STT VR recording active');
                }
                this.isRecognizing = true;
                if (callbacks.onStart) {
                    callbacks.onStart();
                }
            };

            this.vrRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.vrRecordingChunks.push(event.data);
                    console.log(`[SpeechService] Recorded chunk: ${event.data.size} bytes`);
                }
            };

            this.vrRecorder.onerror = (event) => {
                console.error('[SpeechService] ⚠️ VR recording error:', event.error);
                if (window.NEXUS_LOGGER) {
                    window.NEXUS_LOGGER.error('STT VR recording error', { error: String(event.error) });
                }
                if (callbacks.onError) {
                    callbacks.onError('recording-error', String(event.error || event));
                }
                this.isRecognizing = false;
                stream.getTracks().forEach((track) => track.stop());
            };

            this.vrRecorder.onstop = async () => {
                console.log('[SpeechService] ⏹️ VR recording stopped, processing...');
                this.isRecognizing = false;

                if (callbacks.onEnd) {
                    callbacks.onEnd();
                }

                try {
                    // Create blob from recorded chunks
                    const blob = new Blob(this.vrRecordingChunks, { type: this.vrRecorder.mimeType });
                    console.log(`[SpeechService] Recorded ${blob.size} bytes, sending to server...`);

                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT VR sending audio to server', { size: blob.size });
                    }

                    // Send to server for transcription
                    const formData = new FormData();
                    formData.append('audio', blob, 'speech.webm');

                    const response = await fetch('/api/stt', {
                        method: 'POST',
                        body: formData,
                    });

                    if (!response.ok) {
                        throw new Error(`STT server error: HTTP ${response.status}`);
                    }

                    const result = await response.json();
                    const transcript = result.text || '';
                    const confidence = result.confidence || 1.0;

                    console.log(
                        `[SpeechService] ✅ VR transcription: "${transcript}" (${Math.round(confidence * 100)}%)`
                    );
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT VR result', { text: transcript, confidence });
                    }

                    if (callbacks.onResult) {
                        callbacks.onResult(transcript, confidence);
                    }
                } catch (error) {
                    console.error('[SpeechService] ⚠️ VR transcription failed:', error);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.error('STT VR transcription failed', { error: error.message });
                    }
                    if (callbacks.onError) {
                        callbacks.onError('stt-upload-failed', error.message);
                    }
                } finally {
                    // Clean up stream
                    stream.getTracks().forEach((track) => track.stop());
                    this.vrRecordingChunks = [];
                }
            };

            // Start recording
            this.vrRecorder.start();
            return true;
        } catch (error) {
            console.error('[SpeechService] ⚠️ Failed to start VR recording:', error);
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.error('STT VR mic failed', { error: error.message });
            }
            if (callbacks.onError) {
                callbacks.onError('mic-failed', error.message);
            }
            this.isRecognizing = false;
            return false;
        }
    }

    /**
     * Stop VR fallback recording
     */
    stopVRFallbackRecording() {
        if (this.vrRecorder && this.vrRecorder.state !== 'inactive') {
            console.log('[SpeechService] Stopping VR recording...');
            this.vrRecorder.stop();
        }
        this.isRecognizing = false;
    }

    // ============================================================================
    // UNIFIED STT API - Automatic Provider Fallback
    // ============================================================================

    /**
     * Get audio constraints with selected microphone
     * @returns {object} Audio constraints for getUserMedia
     */
    _getAudioConstraints() {
        if (this.sttConfig.microphoneDeviceId) {
            console.log(`[SpeechService] 🎤 Using selected microphone: ${this.sttConfig.microphoneDeviceId}`);
            return {
                audio: {
                    deviceId: { exact: this.sttConfig.microphoneDeviceId },
                },
            };
        } else {
            console.log('[SpeechService] 🎤 Using browser default microphone');
            return { audio: true };
        }
    }

    /**
     * Load STT configuration from localStorage
     * @returns {object} STT configuration
     */
    loadSTTConfig() {
        const defaultConfig = {
            provider: 'webspeech', // 'webspeech' | 'wasm' | 'openai' | 'google'
            language: 'en-US',
            interimResults: true,
            microphoneDeviceId: '', // Empty = use browser default microphone
            wasm: {
                modelSize: 'base', // 'tiny' | 'base' | 'small'
                modelPath: '/models/whisper',
            },
            openai: {
                apiKey: '', // Empty = use main API key
                model: 'whisper-1',
            },
            google: {
                apiKey: '',
                model: 'default', // 'default' | 'latest_long' | 'latest_short'
            },
        };

        try {
            const saved = localStorage.getItem('stt_config');
            return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
        } catch (error) {
            console.warn('[SpeechService] Failed to load STT config:', error);
            return defaultConfig;
        }
    }

    /**
     * Save STT configuration to localStorage
     * @param {object} config - Configuration object
     */
    saveSTTConfig(config) {
        try {
            this.sttConfig = { ...this.sttConfig, ...config };
            localStorage.setItem('stt_config', JSON.stringify(this.sttConfig));
            console.log('[SpeechService] STT config saved:', this.sttConfig);
        } catch (error) {
            console.error('[SpeechService] Failed to save STT config:', error);
        }
    }

    /**
     * Get current STT configuration
     * @returns {object} Current configuration
     */
    getSTTConfig() {
        return { ...this.sttConfig };
    }

    /**
     * Save TTS configuration to unified localStorage (nexus_settings_v1)
     * This ensures desktop TTS settings are available in VR mode
     * @param {object} config - TTS configuration object
     * @param {string} config.speechVoice - Voice URI to use
     * @param {number} config.speechRate - Speech rate (0.1-10)
     * @param {number} config.speechPitch - Speech pitch (0-2)
     * @param {number} config.speechVolume - Speech volume (0-1)
     * @param {string} config.speechLang - Speech language code
     * @param {boolean} config.ttsEnabled - Whether TTS is enabled
     */
    saveTTSConfig(config) {
        try {
            // Read existing nexus_settings_v1 or create new
            let settings = {};
            const raw = localStorage.getItem('nexus_settings_v1');
            if (raw) {
                try {
                    settings = JSON.parse(raw);
                } catch (e) {
                    console.warn('[SpeechService] Failed to parse existing nexus_settings_v1, creating new:', e);
                }
            }

            // Merge TTS config into settings
            settings = {
                ...settings,
                ...config,
            };

            // Save back to localStorage
            localStorage.setItem('nexus_settings_v1', JSON.stringify(settings));
            console.log('[SpeechService] ✅ TTS config saved to nexus_settings_v1:', config);
        } catch (error) {
            console.error('[SpeechService] ❌ Failed to save TTS config:', error);
        }
    }

    /**
     * Check if Web Speech API is available
     * @returns {boolean}
     */
    isWebSpeechAvailable() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * Check if MediaRecorder is available (for WASM fallback)
     * @returns {boolean}
     */
    isMediaRecorderAvailable() {
        return (
            typeof window.MediaRecorder !== 'undefined' &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
        );
    }

    /**
     * Check if WASM Whisper is available
     * @returns {boolean}
     */
    isWASMWhisperAvailable() {
        return typeof Worker !== 'undefined' && this.isMediaRecorderAvailable();
    }

    /**
     * Unified STT entry point with automatic fallback
     * Falls back in order: Web Speech → WASM Whisper → OpenAI → Google
     * @param {object} callbacks - Event callbacks
     * @returns {Promise<boolean>} Success status
     */
    async startSTT(callbacks = {}) {
        console.log('[SpeechService] 🎙️ Starting STT with provider:', this.sttConfig.provider);

        // Try preferred provider first
        switch (this.sttConfig.provider) {
            case 'webspeech':
                if (this.isWebSpeechAvailable()) {
                    this.currentSTTProvider = 'webspeech';
                    return this.startRecognition(callbacks);
                }
                console.warn('[SpeechService] Web Speech not available, trying fallback...');
                break;

            case 'wasm':
                if (this.isWASMWhisperAvailable()) {
                    this.currentSTTProvider = 'wasm';
                    return this.startWASMWhisper(callbacks);
                }
                console.warn('[SpeechService] WASM Whisper not available, trying fallback...');
                break;

            case 'openai':
                this.currentSTTProvider = 'openai';
                return this.startOpenAIWhisper(callbacks);

            case 'google':
                this.currentSTTProvider = 'google';
                return this.startGoogleSTT(callbacks);
        }

        // Automatic fallback chain
        if (this.isWebSpeechAvailable()) {
            console.log('[SpeechService] Fallback: Using Web Speech API');
            this.currentSTTProvider = 'webspeech';
            return this.startRecognition(callbacks);
        }

        if (this.isWASMWhisperAvailable()) {
            console.log('[SpeechService] Fallback: Using WASM Whisper');
            this.currentSTTProvider = 'wasm';
            return this.startWASMWhisper(callbacks);
        }

        // Try OpenAI/Google as last resort
        if (this.sttConfig.openai.apiKey || this.sttConfig.provider === 'openai') {
            console.log('[SpeechService] Fallback: Using OpenAI Whisper API');
            this.currentSTTProvider = 'openai';
            return this.startOpenAIWhisper(callbacks);
        }

        if (this.sttConfig.google.apiKey || this.sttConfig.provider === 'google') {
            console.log('[SpeechService] Fallback: Using Google Cloud STT');
            this.currentSTTProvider = 'google';
            return this.startGoogleSTT(callbacks);
        }

        // No STT available
        console.error('[SpeechService] ❌ No STT providers available!');
        if (callbacks.onError) {
            callbacks.onError(
                'stt-unavailable',
                'No speech-to-text providers available. Please enable microphone or configure API keys.'
            );
        }
        return false;
    }

    /**
     * Stop current STT session
     */
    stopSTT() {
        console.log('[SpeechService] Stopping STT (provider:', this.currentSTTProvider, ')');

        switch (this.currentSTTProvider) {
            case 'webspeech':
                this.stopRecognition();
                break;
            case 'wasm':
                this.stopWASMWhisper();
                break;
            case 'openai':
            case 'google':
                this.stopVRFallbackRecording();
                break;
        }

        this.currentSTTProvider = null;
    }

    // ============================================================================
    // WASM Whisper Implementation
    // ============================================================================

    /**
     * Start WASM Whisper transcription
     * @param {object} callbacks - Event callbacks
     * @returns {Promise<boolean>}
     */
    async startWASMWhisper(callbacks = {}) {
        console.log('[SpeechService] 🎙️ Starting WASM Whisper transcription');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT WASM Whisper started');
        }

        try {
            // Ensure worker is loaded
            await this._ensureWhisperWorker();

            // Request microphone access with selected device
            const stream = await navigator.mediaDevices.getUserMedia(this._getAudioConstraints());

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.vrRecorder = new MediaRecorder(stream, { mimeType });
            this.vrRecordingChunks = [];

            this.vrRecorder.onstart = () => {
                console.log('[SpeechService] 🎤 WASM recording started');
                this.isRecognizing = true;
                if (callbacks.onStart) {
                    callbacks.onStart();
                }
            };

            this.vrRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.vrRecordingChunks.push(event.data);
                }
            };

            this.vrRecorder.onstop = async () => {
                console.log('[SpeechService] ⏹️ WASM recording stopped, transcribing...');
                this.isRecognizing = false;

                if (callbacks.onEnd) {
                    callbacks.onEnd();
                }

                try {
                    const blob = new Blob(this.vrRecordingChunks, { type: this.vrRecorder.mimeType });
                    console.log(`[SpeechService] Transcribing ${blob.size} bytes with WASM...`);

                    // Convert audio to PCM and transcribe
                    const transcript = await this._transcribeWithWhisperWasm(blob);

                    console.log(`[SpeechService] ✅ WASM transcription: "${transcript}"`);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT WASM result', { text: transcript });
                    }

                    if (callbacks.onResult) {
                        callbacks.onResult(transcript, 1.0); // WASM doesn't return confidence
                    }
                } catch (error) {
                    console.error('[SpeechService] ⚠️ WASM transcription failed:', error);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.error('STT WASM failed', { error: error.message });
                    }
                    if (callbacks.onError) {
                        callbacks.onError('wasm-transcription-failed', error.message);
                    }
                } finally {
                    stream.getTracks().forEach((track) => track.stop());
                    this.vrRecordingChunks = [];
                }
            };

            this.vrRecorder.start();
            return true;
        } catch (error) {
            console.error('[SpeechService] ⚠️ Failed to start WASM Whisper:', error);
            if (callbacks.onError) {
                callbacks.onError('wasm-mic-failed', error.message);
            }
            this.isRecognizing = false;
            return false;
        }
    }

    /**
     * Stop WASM Whisper transcription
     */
    stopWASMWhisper() {
        if (this.vrRecorder && this.vrRecorder.state !== 'inactive') {
            console.log('[SpeechService] Stopping WASM recording...');
            this.vrRecorder.stop();
        }
        this.isRecognizing = false;
    }

    /**
     * Ensure Whisper worker is loaded
     * @returns {Promise<void>}
     */
    async _ensureWhisperWorker() {
        if (this.whisperWorker && this.whisperModelLoaded) {
            return;
        }

        console.log('[SpeechService] Loading Whisper WASM worker...');

        return new Promise((resolve, reject) => {
            try {
                this.whisperWorker = new Worker('/workers/whisper-worker.js');

                this.whisperWorker.onmessage = (event) => {
                    const { type, error } = event.data;

                    if (type === 'model-loaded') {
                        this.whisperModelLoaded = true;
                        console.log('[SpeechService] ✅ Whisper model loaded');
                        resolve();
                    } else if (type === 'model-load-error') {
                        console.error('[SpeechService] ❌ Whisper model load failed:', error);
                        reject(new Error(error));
                    }
                };

                this.whisperWorker.onerror = (error) => {
                    console.error('[SpeechService] ❌ Worker error:', error);
                    reject(error);
                };

                // Load model
                this.whisperWorker.postMessage({
                    type: 'load-model',
                    modelSize: this.sttConfig.wasm.modelSize,
                    modelPath: this.sttConfig.wasm.modelPath,
                });
            } catch (error) {
                console.error('[SpeechService] ❌ Failed to create worker:', error);
                reject(error);
            }
        });
    }

    /**
     * Transcribe audio with Whisper WASM
     * @param {Blob} audioBlob - Audio blob
     * @returns {Promise<string>} Transcript
     */
    async _transcribeWithWhisperWasm(audioBlob) {
        // Convert blob to PCM Float32Array @ 16kHz
        const pcmData = await this._decodeBlobToMonoPCM(audioBlob);

        return new Promise((resolve, reject) => {
            const onMessage = (event) => {
                const { type, transcript, error } = event.data;

                if (type === 'transcription-complete') {
                    this.whisperWorker.removeEventListener('message', onMessage);
                    resolve(transcript);
                } else if (type === 'transcription-error') {
                    this.whisperWorker.removeEventListener('message', onMessage);
                    reject(new Error(error));
                }
            };

            this.whisperWorker.addEventListener('message', onMessage);

            // Send audio to worker
            this.whisperWorker.postMessage(
                {
                    type: 'transcribe',
                    audio: pcmData,
                    language: this.sttConfig.language.split('-')[0], // 'en-US' → 'en'
                },
                [pcmData.buffer]
            );
        });
    }

    /**
     * Decode audio blob to mono PCM Float32Array @ 16kHz
     * @param {Blob} blob - Audio blob
     * @returns {Promise<Float32Array>} PCM data
     */
    async _decodeBlobToMonoPCM(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get mono channel
        let pcm = audioBuffer.getChannelData(0);

        // Resample to 16kHz if needed
        if (audioBuffer.sampleRate !== 16000) {
            pcm = this._resampleFloat32(pcm, audioBuffer.sampleRate, 16000);
        }

        return pcm;
    }

    /**
     * Resample Float32Array to target sample rate
     * @param {Float32Array} samples - Input samples
     * @param {number} fromRate - Source sample rate
     * @param {number} toRate - Target sample rate
     * @returns {Float32Array} Resampled data
     */
    _resampleFloat32(samples, fromRate, toRate) {
        if (fromRate === toRate) {
            return samples;
        }

        const ratio = fromRate / toRate;
        const newLength = Math.round(samples.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexInt = Math.floor(srcIndex);
            const fraction = srcIndex - srcIndexInt;

            const sample1 = samples[srcIndexInt] || 0;
            const sample2 = samples[srcIndexInt + 1] || samples[srcIndexInt] || 0;

            // Linear interpolation
            result[i] = sample1 + (sample2 - sample1) * fraction;
        }

        return result;
    }

    // ============================================================================
    // OpenAI Whisper API Implementation
    // ============================================================================

    /**
     * Start OpenAI Whisper API transcription
     * @param {object} callbacks - Event callbacks
     * @returns {Promise<boolean>}
     */
    async startOpenAIWhisper(callbacks = {}) {
        console.log('[SpeechService] 🎙️ Starting OpenAI Whisper API transcription');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT OpenAI Whisper started');
        }

        try {
            // Request microphone access with selected device
            const stream = await navigator.mediaDevices.getUserMedia(this._getAudioConstraints());

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.vrRecorder = new MediaRecorder(stream, { mimeType });
            this.vrRecordingChunks = [];

            this.vrRecorder.onstart = () => {
                console.log('[SpeechService] 🎤 OpenAI recording started');
                this.isRecognizing = true;
                if (callbacks.onStart) {
                    callbacks.onStart();
                }
            };

            this.vrRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.vrRecordingChunks.push(event.data);
                }
            };

            this.vrRecorder.onstop = async () => {
                console.log('[SpeechService] ⏹️ OpenAI recording stopped, uploading...');
                this.isRecognizing = false;

                if (callbacks.onEnd) {
                    callbacks.onEnd();
                }

                try {
                    const blob = new Blob(this.vrRecordingChunks, { type: this.vrRecorder.mimeType });
                    console.log(`[SpeechService] Uploading ${blob.size} bytes to OpenAI...`);

                    const formData = new FormData();
                    formData.append('file', blob, 'audio.webm');
                    formData.append('model', this.sttConfig.openai.model);
                    formData.append('language', this.sttConfig.language.split('-')[0]);

                    const apiKey = this.sttConfig.openai.apiKey || AppConfig?.openai?.apiKey || '';
                    if (!apiKey) {
                        throw new Error('OpenAI API key not configured');
                    }

                    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                        },
                        body: formData,
                    });

                    if (!response.ok) {
                        const error = await response.text();
                        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
                    }

                    const result = await response.json();
                    const transcript = result.text || '';

                    console.log(`[SpeechService] ✅ OpenAI transcription: "${transcript}"`);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT OpenAI result', { text: transcript });
                    }

                    if (callbacks.onResult) {
                        callbacks.onResult(transcript, 1.0);
                    }
                } catch (error) {
                    console.error('[SpeechService] ⚠️ OpenAI transcription failed:', error);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.error('STT OpenAI failed', { error: error.message });
                    }
                    if (callbacks.onError) {
                        callbacks.onError('openai-transcription-failed', error.message);
                    }
                } finally {
                    stream.getTracks().forEach((track) => track.stop());
                    this.vrRecordingChunks = [];
                }
            };

            this.vrRecorder.start();
            return true;
        } catch (error) {
            console.error('[SpeechService] ⚠️ Failed to start OpenAI Whisper:', error);
            if (callbacks.onError) {
                callbacks.onError('openai-mic-failed', error.message);
            }
            this.isRecognizing = false;
            return false;
        }
    }

    // ============================================================================
    // Google Cloud STT Implementation
    // ============================================================================

    /**
     * Start Google Cloud STT transcription
     * @param {object} callbacks - Event callbacks
     * @returns {Promise<boolean>}
     */
    async startGoogleSTT(callbacks = {}) {
        console.log('[SpeechService] 🎙️ Starting Google Cloud STT');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('STT Google Cloud started');
        }

        try {
            // Request microphone access with selected device
            const stream = await navigator.mediaDevices.getUserMedia(this._getAudioConstraints());

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.vrRecorder = new MediaRecorder(stream, { mimeType });
            this.vrRecordingChunks = [];

            this.vrRecorder.onstart = () => {
                console.log('[SpeechService] 🎤 Google recording started');
                this.isRecognizing = true;
                if (callbacks.onStart) {
                    callbacks.onStart();
                }
            };

            this.vrRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.vrRecordingChunks.push(event.data);
                }
            };

            this.vrRecorder.onstop = async () => {
                console.log('[SpeechService] ⏹️ Google recording stopped, uploading...');
                this.isRecognizing = false;

                if (callbacks.onEnd) {
                    callbacks.onEnd();
                }

                try {
                    const blob = new Blob(this.vrRecordingChunks, { type: this.vrRecorder.mimeType });
                    console.log(`[SpeechService] Uploading ${blob.size} bytes to Google Cloud...`);

                    // Convert blob to base64
                    const base64Audio = await this._blobToBase64(blob);

                    const apiKey = this.sttConfig.google.apiKey;
                    if (!apiKey) {
                        throw new Error('Google Cloud API key not configured');
                    }

                    const requestBody = {
                        config: {
                            encoding: 'WEBM_OPUS',
                            sampleRateHertz: 48000,
                            languageCode: this.sttConfig.language,
                            model: this.sttConfig.google.model,
                        },
                        audio: {
                            content: base64Audio.split(',')[1], // Remove data:audio/webm;base64, prefix
                        },
                    };

                    const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestBody),
                    });

                    if (!response.ok) {
                        const error = await response.text();
                        throw new Error(`Google Cloud API error: ${response.status} - ${error}`);
                    }

                    const result = await response.json();
                    const transcript = result.results?.[0]?.alternatives?.[0]?.transcript || '';
                    const confidence = result.results?.[0]?.alternatives?.[0]?.confidence || 1.0;

                    console.log(
                        `[SpeechService] ✅ Google transcription: "${transcript}" (${Math.round(confidence * 100)}%)`
                    );
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('STT Google result', { text: transcript, confidence });
                    }

                    if (callbacks.onResult) {
                        callbacks.onResult(transcript, confidence);
                    }
                } catch (error) {
                    console.error('[SpeechService] ⚠️ Google transcription failed:', error);
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.error('STT Google failed', { error: error.message });
                    }
                    if (callbacks.onError) {
                        callbacks.onError('google-transcription-failed', error.message);
                    }
                } finally {
                    stream.getTracks().forEach((track) => track.stop());
                    this.vrRecordingChunks = [];
                }
            };

            this.vrRecorder.start();
            return true;
        } catch (error) {
            console.error('[SpeechService] ⚠️ Failed to start Google Cloud STT:', error);
            if (callbacks.onError) {
                callbacks.onError('google-mic-failed', error.message);
            }
            this.isRecognizing = false;
            return false;
        }
    }

    /**
     * Convert blob to base64
     * @param {Blob} blob - Audio blob
     * @returns {Promise<string>} Base64 string
     */
    async _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ============================================================================
    // Audio Level Monitoring (for debugging)
    // ============================================================================

    /**
     * Start monitoring audio levels during speech recognition
     * This helps debug microphone issues
     */
    async _startAudioMonitoring() {
        try {
            console.log('[SpeechService] 🎚️ Starting audio level monitoring...');

            // Request microphone access for monitoring with selected device
            const stream = await navigator.mediaDevices.getUserMedia(this._getAudioConstraints());

            // Get audio devices info
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter((d) => d.kind === 'audioinput');
            console.log(`[SpeechService] 🎤 Available microphones: ${audioInputs.length}`);
            audioInputs.forEach((device, index) => {
                const isSelected = this.sttConfig.microphoneDeviceId === device.deviceId;
                const marker = isSelected ? '✅ [SELECTED]' : '  ';
                console.log(`  ${marker} ${index + 1}. ${device.label || `Microphone ${index + 1}`}`);
            });

            // Create audio context for level monitoring
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(stream);

            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            microphone.connect(analyser);

            // Store for cleanup
            this._audioMonitoring = {
                stream,
                audioContext,
                analyser,
                microphone,
                intervalId: null,
            };

            let logCount = 0;
            const maxLogs = 10; // Log levels for first 10 checks

            // Monitor audio levels every 500ms
            this._audioMonitoring.intervalId = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);

                // Calculate average volume
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;
                const percentage = (average / 255) * 100;
                const db = average > 0 ? 20 * Math.log10(average / 255) : -100;

                // Log first few checks
                if (logCount < maxLogs) {
                    console.log(`[SpeechService] 🎚️ Audio level: ${db.toFixed(1)} dB (${percentage.toFixed(0)}%)`);
                    logCount++;

                    if (logCount === maxLogs) {
                        console.log('[SpeechService] 🎚️ (Audio level logging stopped - check passed)');
                    }
                }

                // Alert if significant audio detected
                if (percentage > 5 && logCount >= maxLogs) {
                    // console.log(`[SpeechService] 🔊 Audio spike detected: ${db.toFixed(1)} dB`);
                }
            }, 500);
        } catch (error) {
            console.warn('[SpeechService] ⚠️ Could not start audio monitoring:', error.message);
            console.warn('  This is OK - monitoring is optional for debugging only');
        }
    }

    /**
     * Stop audio level monitoring
     */
    _stopAudioMonitoring() {
        if (this._audioMonitoring) {
            console.log('[SpeechService] 🎚️ Stopping audio level monitoring');

            if (this._audioMonitoring.intervalId) {
                clearInterval(this._audioMonitoring.intervalId);
            }

            if (this._audioMonitoring.stream) {
                this._audioMonitoring.stream.getTracks().forEach((track) => track.stop());
            }

            if (this._audioMonitoring.audioContext) {
                this._audioMonitoring.audioContext.close();
            }

            this._audioMonitoring = null;
        }
    }
}

// Create a singleton instance
const speechService = new SpeechService();

// Export for use in other modules
window.SpeechService = speechService;
