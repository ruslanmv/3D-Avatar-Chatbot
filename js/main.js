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
            this.elements.speechRateValue.textContent = e.target.value + 'x';
        });

        this.elements.speechPitch.addEventListener('input', (e) => {
            this.elements.speechPitchValue.textContent = e.target.value + 'x';
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
     * Handle voice input
     */
    handleVoiceInput() {
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

        SpeechService.startRecognition({
            onResult: (transcript, confidence) => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');

                // Set the transcript as input
                this.elements.chatInput.value = transcript;

                // Automatically send if confidence is high
                if (confidence > 0.7) {
                    this.handleSendMessage();
                } else {
                    AvatarController.idle();
                    ChatManager.showInfo('Please review the transcription and press send.');
                }
            },
            onError: (error) => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');
                ChatManager.showError(error);
                AvatarController.idle();
            },
            onEnd: () => {
                this.showRecordingIndicator(false);
                this.elements.voiceInputBtn.classList.remove('recording');
            }
        });
    }

    /**
     * Speak response using TTS
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
            }
        });
    }

    /**
     * Handle personality change
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
        this.elements.speechRateValue.textContent = AppConfig.speech.rate + 'x';
        this.elements.speechPitch.value = AppConfig.speech.pitch;
        this.elements.speechPitchValue.textContent = AppConfig.speech.pitch + 'x';
        this.elements.showTimestamps.checked = AppConfig.ui.showTimestamps;
        this.elements.soundEffects.checked = AppConfig.ui.soundEffects;

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
            selectedVoice: this.elements.voiceSelect.value
        });

        // Save UI settings
        AppConfig.saveUISettings({
            showTimestamps: this.elements.showTimestamps.checked,
            soundEffects: this.elements.soundEffects.checked
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

        voices.forEach(voice => {
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
     */
    showInitializationError(error) {
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = 'Failed to initialize: ' + error.message;
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
            tokenEstimate: OpenAIService.getTokenCount()
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
