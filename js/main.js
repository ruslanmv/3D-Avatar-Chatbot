/**
 * Main Application Module
 * Orchestrates all components and handles user interactions
 */

class ChatbotApplication {
    constructor() {
        this.isInitialized = false;
        this.isProcessing = false;
        this.elements = {};
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('Initializing 3D Avatar Chatbot...');

            // Initialize services
            await this.initializeServices();

            // Get DOM elements
            this.cacheElements();

            // Set up event listeners
            this.setupEventListeners();

            // Initialize UI state
            this.initializeUI();

            // Hide loading screen
            this.hideLoadingScreen();

            this.isInitialized = true;
            console.log('Application initialized successfully');

            // Check if API key is configured
            this.checkConfiguration();
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showInitializationError(error);
        }
    }

    /**
     * Initialize all services
     */
    async initializeServices() {
        // Initialize avatar controller
        await AvatarController.initialize();

        // Initialize chat manager
        ChatManager.initialize();

        // Initialize OpenAI service with current personality
        const personality = AppConfig.getCurrentPersonality();
        OpenAIService.initialize(personality);

        console.log('All services initialized');
    }

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            // Containers
            mainContainer: document.getElementById('mainContainer'),
            loadingScreen: document.getElementById('loadingScreen'),

            // Chat elements
            chatInput: document.getElementById('chatInput'),
            sendBtn: document.getElementById('sendBtn'),
            voiceInputBtn: document.getElementById('voiceInputBtn'),
            clearChatBtn: document.getElementById('clearChatBtn'),

            // Settings
            settingsBtn: document.getElementById('settingsBtn'),
            settingsModal: document.getElementById('settingsModal'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),

            // Personality
            personalitySelect: document.getElementById('personalitySelect'),

            // Avatar controls
            toggleAvatarBtn: document.getElementById('toggleAvatarBtn'),
            resetCameraBtn: document.getElementById('resetCameraBtn'),

            // Indicators
            recordingIndicator: document.getElementById('recordingIndicator'),
            typingIndicator: document.getElementById('typingIndicator'),
            autoSpeakToggle: document.getElementById('autoSpeakToggle'),

            // Settings inputs
            apiKeyInput: document.getElementById('apiKeyInput'),
            modelSelect: document.getElementById('modelSelect'),
            voiceSelect: document.getElementById('voiceSelect'),
            speechRate: document.getElementById('speechRate'),
            speechRateValue: document.getElementById('speechRateValue'),
            speechPitch: document.getElementById('speechPitch'),
            speechPitchValue: document.getElementById('speechPitchValue'),
            showTimestamps: document.getElementById('showTimestamps'),
            soundEffects: document.getElementById('soundEffects'),

            // STT settings
            sttProvider: document.getElementById('stt-provider'),
            wasmModelSize: document.getElementById('wasm-model-size'),
            openaiWhisperModel: document.getElementById('openai-whisper-model'),
            openaiSTTKey: document.getElementById('openai-stt-key'),
            googleSTTKey: document.getElementById('google-stt-key'),
            googleSTTModel: document.getElementById('google-stt-model'),
            sttLanguage: document.getElementById('stt-language'),
            sttInterimResults: document.getElementById('stt-interim-results'),
            testSTT: document.getElementById('test-stt'),
            testSTTStatus: document.getElementById('test-stt-status'),

            // STT provider settings containers
            wasmSTTSettings: document.getElementById('wasm-stt-settings'),
            openaiSTTSettings: document.getElementById('openai-stt-settings'),
            googleSTTSettings: document.getElementById('google-stt-settings'),
        };
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Chat input
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.elements.sendBtn.addEventListener('click', () => {
            this.handleSendMessage();
        });

        // Voice input
        this.elements.voiceInputBtn.addEventListener('click', () => {
            this.handleVoiceInput();
        });

        // Clear chat
        this.elements.clearChatBtn.addEventListener('click', () => {
            this.handleClearChat();
        });

        // Personality selection
        this.elements.personalitySelect.addEventListener('change', (e) => {
            this.handlePersonalityChange(e.target.value);
        });

        // Settings
        this.elements.settingsBtn.addEventListener('click', () => {
            this.openSettings();
        });

        this.elements.saveSettingsBtn.addEventListener('click', () => {
            this.saveSettings();
        });

        // Avatar controls
        this.elements.toggleAvatarBtn.addEventListener('click', () => {
            AvatarController.toggleVisibility();
        });

        this.elements.resetCameraBtn.addEventListener('click', () => {
            AvatarController.resetCamera();
        });

        // Auto-speak toggle
        this.elements.autoSpeakToggle.addEventListener('change', (e) => {
            AppConfig.saveSpeechSettings({ autoSpeak: e.target.checked });
        });

        // Speech rate/pitch sliders
        this.elements.speechRate.addEventListener('input', (e) => {
            this.elements.speechRateValue.textContent = `${e.target.value}x`;
        });

        this.elements.speechPitch.addEventListener('input', (e) => {
            this.elements.speechPitchValue.textContent = `${e.target.value}x`;
        });

        // STT provider selection
        this.elements.sttProvider.addEventListener('change', (e) => {
            this.updateSTTProviderUI(e.target.value);
        });

        // Test STT button
        this.elements.testSTT.addEventListener('click', () => {
            this.testSTT();
        });

        // Window resize
        window.addEventListener('resize', () => {
            AvatarController.handleResize();
        });

        // Voices loaded
        window.addEventListener('voicesLoaded', () => {
            this.populateVoices();
        });

        // Close modal on outside click
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) {
                this.elements.settingsModal.style.display = 'none';
            }
        });

        console.log('Event listeners set up');
    }

    /**
     * Initialize UI state
     */
    initializeUI() {
        // Load saved personality
        const savedPersonality = localStorage.getItem('selected_personality') || 'friendly-kids';
        this.elements.personalitySelect.value = savedPersonality;

        // Load auto-speak preference
        this.elements.autoSpeakToggle.checked = AppConfig.speech.autoSpeak;

        // Populate voices
        this.populateVoices();

        // Focus on input
        this.elements.chatInput.focus();
    }

    /**
     * Handle send message
     */
    async handleSendMessage() {
        const message = this.elements.chatInput.value.trim();

        if (!message || this.isProcessing) {
            return;
        }

        // Check if configured
        if (!AppConfig.isConfigured()) {
            this.showConfigurationPrompt();
            return;
        }

        try {
            this.isProcessing = true;
            this.elements.chatInput.value = '';
            this.elements.sendBtn.disabled = true;

            // Add user message to chat
            ChatManager.addMessage(message, 'user');

            // Show typing indicator
            this.showTypingIndicator(true);

            // Set avatar to thinking
            AvatarController.think();

            // Get response from OpenAI
            const response = await OpenAIService.sendMessage(message);

            // Hide typing indicator
            this.showTypingIndicator(false);

            // Add bot response to chat
            ChatManager.addMessage(response, 'bot');

            // Speak response if auto-speak is enabled
            if (AppConfig.speech.autoSpeak) {
                this.speakResponse(response);
            } else {
                AvatarController.idle();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this.showTypingIndicator(false);
            ChatManager.showError(error.message);
            AvatarController.idle();
        } finally {
            this.isProcessing = false;
            this.elements.sendBtn.disabled = false;
            this.elements.chatInput.focus();
        }
    }

    /**
     * Handle voice input (improved with interim results and permission handling)
     */
    async handleVoiceInput() {
        if (!SpeechService.isRecognitionAvailable()) {
            ChatManager.showError('Voice input is not supported in your browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        if (SpeechService.isRecognizing) {
            // Stop recording
            SpeechService.stopRecognition();
            this.showRecordingIndicator(false);
            this.elements.voiceInputBtn.classList.remove('recording');
            AvatarController.idle();
            return;
        }

        // Start recording
        AvatarController.listen();
        this.showRecordingIndicator(true);
        this.elements.voiceInputBtn.classList.add('recording');

        // Start recognition with interim results
        await SpeechService.startRecognition({
            onStart: () => {
                console.log('🎤 Voice input started');
                this.elements.chatInput.placeholder = 'Listening...';
            },
            onInterim: (interimText) => {
                // Show interim results in real-time
                this.elements.chatInput.value = interimText;
                this.elements.chatInput.style.fontStyle = 'italic';
                this.elements.chatInput.style.opacity = '0.7';
            },
            onResult: (transcript, confidence) => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');

                // Reset input styling
                this.elements.chatInput.style.fontStyle = 'normal';
                this.elements.chatInput.style.opacity = '1';
                this.elements.chatInput.placeholder = 'Type your message...';

                // Set the final transcript
                this.elements.chatInput.value = transcript;

                // Show what was transcribed with confidence level
                const confidencePercent = Math.round(confidence * 100);
                ChatManager.showInfo(
                    `🎤 Transcribed (${confidencePercent}% confidence): "${transcript}"\n` +
                        'Review and press Send, or click the microphone to record again.'
                );

                // Focus on input for easy editing/sending
                AvatarController.idle();
                this.elements.chatInput.focus();
                this.elements.chatInput.select(); // Highlight text for easy review
            },
            onError: (error, context) => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');

                // Reset input styling
                this.elements.chatInput.style.fontStyle = 'normal';
                this.elements.chatInput.style.opacity = '1';
                this.elements.chatInput.placeholder = 'Type your message...';

                // Show error with context if available
                const errorMsg = context ? `${error}\n${context}` : error;
                ChatManager.showError(errorMsg);
                AvatarController.idle();
            },
            onEnd: () => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');
                this.elements.chatInput.placeholder = 'Type your message...';
            },
        });
    }

    /**
     * Speak response using TTS
     * @param text
     */
    speakResponse(text) {
        AvatarController.speak();

        SpeechService.speak(text, {
            onStart: () => {
                console.log('Started speaking');
            },
            onEnd: () => {
                console.log('Finished speaking');
                AvatarController.idle();
            },
            onError: (error) => {
                console.error('TTS error:', error);
                AvatarController.idle();
            },
        });
    }

    /**
     * Handle personality change
     * @param personalityKey
     */
    handlePersonalityChange(personalityKey) {
        AppConfig.savePersonality(personalityKey);
        const personality = AppConfig.personalities[personalityKey];

        if (personality) {
            OpenAIService.changePersonality(personality);
            ChatManager.showInfo(`Personality changed to: ${personality.name} ${personality.icon}`);
        }
    }

    /**
     * Handle clear chat
     */
    handleClearChat() {
        if (confirm('Are you sure you want to clear the chat history?')) {
            ChatManager.clearMessages();
            OpenAIService.clearHistory();

            // Reinitialize with current personality
            const personality = AppConfig.getCurrentPersonality();
            OpenAIService.initialize(personality);

            ChatManager.showInfo('Chat cleared');
        }
    }

    /**
     * Show/hide typing indicator
     * @param show
     */
    showTypingIndicator(show) {
        this.elements.typingIndicator.style.display = show ? 'inline' : 'none';
        if (show) {
            ChatManager.showTypingIndicator();
        } else {
            ChatManager.removeTypingIndicator();
        }
    }

    /**
     * Show/hide recording indicator
     * @param show
     */
    showRecordingIndicator(show) {
        this.elements.recordingIndicator.style.display = show ? 'inline' : 'none';
    }

    /**
     * Open settings modal
     */
    openSettings() {
        // Load current settings
        this.elements.apiKeyInput.value = AppConfig.openai.apiKey || '';
        this.elements.modelSelect.value = AppConfig.openai.model;
        this.elements.speechRate.value = AppConfig.speech.rate;
        this.elements.speechRateValue.textContent = `${AppConfig.speech.rate}x`;
        this.elements.speechPitch.value = AppConfig.speech.pitch;
        this.elements.speechPitchValue.textContent = `${AppConfig.speech.pitch}x`;
        this.elements.showTimestamps.checked = AppConfig.ui.showTimestamps;
        this.elements.soundEffects.checked = AppConfig.ui.soundEffects;

        // Load STT settings
        const sttConfig = SpeechService.getSTTConfig();
        this.elements.sttProvider.value = sttConfig.provider;
        this.elements.wasmModelSize.value = sttConfig.wasm.modelSize;
        this.elements.openaiWhisperModel.value = sttConfig.openai.model;
        this.elements.openaiSTTKey.value = sttConfig.openai.apiKey;
        this.elements.googleSTTKey.value = sttConfig.google.apiKey;
        this.elements.googleSTTModel.value = sttConfig.google.model;
        this.elements.sttLanguage.value = sttConfig.language;
        this.elements.sttInterimResults.checked = sttConfig.interimResults;

        // Update provider-specific UI
        this.updateSTTProviderUI(sttConfig.provider);

        // Show modal
        this.elements.settingsModal.style.display = 'flex';
    }

    /**
     * Save settings
     */
    saveSettings() {
        // Save API key
        const apiKey = this.elements.apiKeyInput.value.trim();
        if (apiKey) {
            AppConfig.saveApiKey(apiKey);
        }

        // Save model
        AppConfig.saveModel(this.elements.modelSelect.value);

        // Save speech settings
        AppConfig.saveSpeechSettings({
            rate: parseFloat(this.elements.speechRate.value),
            pitch: parseFloat(this.elements.speechPitch.value),
            selectedVoice: this.elements.voiceSelect.value,
        });

        // Save UI settings
        AppConfig.saveUISettings({
            showTimestamps: this.elements.showTimestamps.checked,
            soundEffects: this.elements.soundEffects.checked,
        });

        // Save STT settings
        SpeechService.saveSTTConfig({
            provider: this.elements.sttProvider.value,
            language: this.elements.sttLanguage.value,
            interimResults: this.elements.sttInterimResults.checked,
            wasm: {
                modelSize: this.elements.wasmModelSize.value,
            },
            openai: {
                apiKey: this.elements.openaiSTTKey.value.trim(),
                model: this.elements.openaiWhisperModel.value,
            },
            google: {
                apiKey: this.elements.googleSTTKey.value.trim(),
                model: this.elements.googleSTTModel.value,
            },
        });

        // Update recognition options
        SpeechService.setRecognitionOptions({
            lang: this.elements.sttLanguage.value,
            interimResults: this.elements.sttInterimResults.checked,
        });

        // Close modal
        this.elements.settingsModal.style.display = 'none';

        // Show confirmation
        ChatManager.showInfo('Settings saved successfully!');

        // Reload chat to apply timestamp setting
        if (this.elements.showTimestamps.checked !== AppConfig.ui.showTimestamps) {
            location.reload();
        }
    }

    /**
     * Populate voice dropdown
     */
    populateVoices() {
        const voices = SpeechService.getVoices();
        this.elements.voiceSelect.innerHTML = '<option value="">Default</option>';

        voices.forEach((voice) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.name === AppConfig.speech.selectedVoice) {
                option.selected = true;
            }
            this.elements.voiceSelect.appendChild(option);
        });
    }

    /**
     * Update STT provider UI visibility
     * @param provider
     */
    updateSTTProviderUI(provider) {
        // Hide all provider-specific settings
        this.elements.wasmSTTSettings.style.display = 'none';
        this.elements.openaiSTTSettings.style.display = 'none';
        this.elements.googleSTTSettings.style.display = 'none';

        // Show relevant provider settings
        switch (provider) {
            case 'wasm':
                this.elements.wasmSTTSettings.style.display = 'block';
                break;
            case 'openai':
                this.elements.openaiSTTSettings.style.display = 'block';
                break;
            case 'google':
                this.elements.googleSTTSettings.style.display = 'block';
                break;
        }
    }

    /**
     * Test STT functionality
     */
    async testSTT() {
        const statusElement = this.elements.testSTTStatus;

        try {
            statusElement.textContent = 'Starting STT test...';
            statusElement.style.color = '#3b82f6';

            // Start STT with test callbacks
            const started = await SpeechService.startSTT({
                onStart: () => {
                    statusElement.textContent = '🎤 Listening... (speak now)';
                    statusElement.style.color = '#10b981';
                },
                onInterim: (interimText) => {
                    statusElement.textContent = `📝 Interim: "${interimText}"`;
                    statusElement.style.color = '#f59e0b';
                },
                onResult: (transcript, confidence) => {
                    const confidencePercent = Math.round(confidence * 100);
                    statusElement.textContent = `✅ Transcribed: "${transcript}" (${confidencePercent}% confidence)`;
                    statusElement.style.color = '#10b981';
                    console.log('[STT Test] Result:', transcript);

                    // Show success message
                    setTimeout(() => {
                        statusElement.textContent = 'Test completed successfully!';
                    }, 2000);
                },
                onError: (error, context) => {
                    const errorMsg = context ? `${error}: ${context}` : error;
                    statusElement.textContent = `❌ Error: ${errorMsg}`;
                    statusElement.style.color = '#ef4444';
                    console.error('[STT Test] Error:', error, context);
                },
                onEnd: () => {
                    console.log('[STT Test] Recognition ended');
                },
            });

            if (!started) {
                throw new Error('Failed to start STT');
            }

            // Auto-stop after 10 seconds
            setTimeout(() => {
                if (SpeechService.isRecognizing) {
                    SpeechService.stopSTT();
                    statusElement.textContent = 'Test timeout (10s limit)';
                    statusElement.style.color = '#f59e0b';
                }
            }, 10000);
        } catch (error) {
            console.error('[STT Test] Failed:', error);
            statusElement.textContent = `❌ Failed: ${error.message}`;
            statusElement.style.color = '#ef4444';
        }
    }

    /**
     * Check configuration
     */
    checkConfiguration() {
        if (!AppConfig.isConfigured()) {
            setTimeout(() => {
                this.showConfigurationPrompt();
            }, 1000);
        }
    }

    /**
     * Show configuration prompt
     */
    showConfigurationPrompt() {
        ChatManager.showInfo('Please configure your OpenAI API key in settings to start chatting.');
        this.openSettings();
    }

    /**
     * Hide loading screen
     */
    hideLoadingScreen() {
        setTimeout(() => {
            this.elements.loadingScreen.style.opacity = '0';
            this.elements.mainContainer.style.display = 'flex';

            setTimeout(() => {
                this.elements.loadingScreen.style.display = 'none';
            }, 300);
        }, 1000);
    }

    /**
     * Show initialization error
     * @param error
     */
    showInitializationError(error) {
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = `Failed to initialize: ${error.message}`;
            loadingText.style.color = '#ef4444';
        }
    }

    /**
     * Get application info
     */
    getInfo() {
        return {
            version: '1.0.0',
            initialized: this.isInitialized,
            processing: this.isProcessing,
            personality: AppConfig.getCurrentPersonality().name,
            configured: AppConfig.isConfigured(),
            features: SpeechService.getFeatures(),
            messageCount: ChatManager.getMessageCount(),
            tokenEstimate: OpenAIService.getTokenCount(),
        };
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new ChatbotApplication();
    app.init();

    // Expose app instance for debugging
    window.ChatbotApp = app;

    console.log('3D Avatar Chatbot v1.0.0');
    console.log('Ready to chat! 🤖');
});
