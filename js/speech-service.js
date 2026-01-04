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

        this.initializeSpeechRecognition();
        this.initializeSpeechSynthesis();
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

            // Configure recognition with options
            this.applyRecognitionOptions();

            // Set up event handlers
            this.recognition.onstart = () => {
                this.isRecognizing = true;
                console.log('Speech recognition started');
                if (this.recognitionCallbacks.onStart) {
                    this.recognitionCallbacks.onStart();
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
                    this.recognitionCallbacks.onInterim(interimTranscript.trim());
                }

                // Call result callback for final transcripts
                if (finalTranscript && this.recognitionCallbacks.onResult) {
                    const confidence = event.results[event.resultIndex][0].confidence || 1.0;
                    console.log(`Speech recognized: "${finalTranscript.trim()}" (confidence: ${confidence})`);
                    this.recognitionCallbacks.onResult(finalTranscript.trim(), confidence);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.isRecognizing = false;

                let errorMessage = 'Speech recognition failed';
                let errorContext = '';

                switch (event.error) {
                    case 'no-speech':
                        errorMessage = 'No speech detected. Please try again.';
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

                if (this.recognitionCallbacks.onError) {
                    this.recognitionCallbacks.onError(errorMessage, errorContext);
                }
            };

            this.recognition.onend = () => {
                this.isRecognizing = false;
                console.log('Speech recognition ended');
                if (this.recognitionCallbacks.onEnd) {
                    this.recognitionCallbacks.onEnd();
                }
            };
        } else {
            console.warn('Speech Recognition API not supported in this browser');
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
        console.log(`Loaded ${this.voices.length} voices`);

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
     * Get default or preferred voice
     */
    getPreferredVoice() {
        const savedVoiceName = AppConfig.speech.selectedVoice;

        if (savedVoiceName) {
            const savedVoice = this.voices.find((voice) => voice.name === savedVoiceName);
            if (savedVoice) {
                return savedVoice;
            }
        }

        // Find a good default voice (prefer English, female voices)
        const englishVoices = this.voices.filter((voice) => voice.lang.startsWith('en'));
        const femaleVoices = englishVoices.filter(
            (voice) =>
                voice.name.toLowerCase().includes('female') ||
                voice.name.toLowerCase().includes('samantha') ||
                voice.name.toLowerCase().includes('victoria')
        );

        return femaleVoices[0] || englishVoices[0] || this.voices[0];
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
    speak(text, callbacks = {}) {
        if (!this.isSynthesisSupported) {
            console.warn('Speech synthesis not supported');
            if (callbacks.onError) {
                callbacks.onError('Text-to-speech is not supported in your browser');
            }
            return false;
        }

        // Stop any current speech
        this.stopSpeaking();

        // Create utterance
        this.currentUtterance = new SpeechSynthesisUtterance(text);

        // Set voice
        const voice = this.getPreferredVoice();
        if (voice) {
            this.currentUtterance.voice = voice;
        }

        // Set properties from config
        this.currentUtterance.rate = AppConfig.speech.rate;
        this.currentUtterance.pitch = AppConfig.speech.pitch;
        this.currentUtterance.volume = AppConfig.speech.volume;

        // Set callbacks
        this.speakingCallbacks = callbacks;

        this.currentUtterance.onstart = () => {
            this.isSpeaking = true;
            console.log('Started speaking:', text);
            if (this.speakingCallbacks.onStart) {
                this.speakingCallbacks.onStart();
            }
        };

        this.currentUtterance.onend = () => {
            this.isSpeaking = false;
            console.log('Finished speaking');
            if (this.speakingCallbacks.onEnd) {
                this.speakingCallbacks.onEnd();
            }
        };

        this.currentUtterance.onerror = (event) => {
            this.isSpeaking = false;
            console.error('Speech synthesis error:', event);
            if (this.speakingCallbacks.onError) {
                this.speakingCallbacks.onError('Text-to-speech failed');
            }
        };

        // Speak
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
     * Stop speaking
     */
    stopSpeaking() {
        if (this.isSpeaking || this.synthesis.speaking) {
            this.synthesis.cancel();
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
}

// Create a singleton instance
const speechService = new SpeechService();

// Export for use in other modules
window.SpeechService = speechService;
