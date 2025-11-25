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
        this.recognitionCallbacks = {
            onResult: null,
            onError: null,
            onStart: null,
            onEnd: null
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
            onError: null
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

            // Configure recognition
            this.recognition.continuous = false; // Stop after first result
            this.recognition.interimResults = false; // Only final results
            this.recognition.lang = 'en-US'; // Default language
            this.recognition.maxAlternatives = 1;

            // Set up event handlers
            this.recognition.onstart = () => {
                this.isRecognizing = true;
                console.log('Speech recognition started');
                if (this.recognitionCallbacks.onStart) {
                    this.recognitionCallbacks.onStart();
                }
            };

            this.recognition.onresult = (event) => {
                const result = event.results[0][0];
                const transcript = result.transcript;
                const confidence = result.confidence;

                console.log(`Speech recognized: "${transcript}" (confidence: ${confidence})`);

                if (this.recognitionCallbacks.onResult) {
                    this.recognitionCallbacks.onResult(transcript, confidence);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.isRecognizing = false;

                let errorMessage = 'Speech recognition failed';
                switch (event.error) {
                    case 'no-speech':
                        errorMessage = 'No speech detected. Please try again.';
                        break;
                    case 'audio-capture':
                        errorMessage = 'Microphone not found or permission denied.';
                        break;
                    case 'not-allowed':
                        errorMessage = 'Microphone access denied. Please allow microphone access.';
                        break;
                    case 'network':
                        errorMessage = 'Network error. Please check your connection.';
                        break;
                }

                if (this.recognitionCallbacks.onError) {
                    this.recognitionCallbacks.onError(errorMessage);
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
            const savedVoice = this.voices.find(voice => voice.name === savedVoiceName);
            if (savedVoice) return savedVoice;
        }

        // Find a good default voice (prefer English, female voices)
        const englishVoices = this.voices.filter(voice => voice.lang.startsWith('en'));
        const femaleVoices = englishVoices.filter(voice =>
            voice.name.toLowerCase().includes('female') ||
            voice.name.toLowerCase().includes('samantha') ||
            voice.name.toLowerCase().includes('victoria')
        );

        return femaleVoices[0] || englishVoices[0] || this.voices[0];
    }

    /**
     * Start speech recognition
     */
    startRecognition(callbacks = {}) {
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

        // Set callbacks
        this.recognitionCallbacks = callbacks;

        try {
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('Failed to start recognition:', error);
            if (callbacks.onError) {
                callbacks.onError('Failed to start speech recognition');
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
            voiceCount: this.voices.length
        };
    }

    /**
     * Test speech capabilities
     */
    async testCapabilities() {
        const results = {
            recognition: false,
            synthesis: false,
            error: null
        };

        // Test recognition
        if (this.isRecognitionSupported) {
            try {
                // Just check if we can create instance
                results.recognition = true;
            } catch (error) {
                results.error = 'Recognition test failed: ' + error.message;
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
                results.error = (results.error || '') + ' Synthesis test failed: ' + error.message;
            }
        }

        return results;
    }
}

// Create a singleton instance
const speechService = new SpeechService();

// Export for use in other modules
window.SpeechService = speechService;
