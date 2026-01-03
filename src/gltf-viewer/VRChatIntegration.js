/**
 * VR Chat Integration Module
 * Wires together VRChatPanel, AvatarManager, SpeechService, and ChatManager
 * Handles all VR chatbot interactions
 */

export class VRChatIntegration {
    constructor({ avatarManager, vrChatPanel, vrControllers, speechService, chatManager }) {
        this.avatarManager = avatarManager;
        this.vrChatPanel = vrChatPanel;
        this.vrControllers = vrControllers;
        this.speechService = speechService;
        this.chatManager = chatManager;

        this.isInitialized = false;
        this.hasLoadedAvatar = false; // [FIX] Track if we've loaded the 3D model yet
        this.currentAvatarIndex = 0;

        console.log('[VRChatIntegration] Initializing VR chatbot system...');
    }

    /**
     * Initialize the VR chat system
     * @param {string} manifestUrl - Avatar manifest URL
     */
    async initialize(manifestUrl = '/vendor/avatars/avatars.json') {
        try {
            // [FIX] Only load avatar manifest data - do NOT spawn 3D model yet
            // This prevents overlap with desktop avatar system
            const avatars = await this.avatarManager.initFromManifest(manifestUrl);
            console.log(`[VRChatIntegration] Loaded ${avatars.length} avatar definitions (models not spawned yet)`);

            // Set avatars in VR panel
            this.vrChatPanel.setAvatars(avatars);

            // [FIX] Store preferred avatar index but DON'T load it yet
            const savedAvatarName = localStorage.getItem('vr_avatar_name');
            if (savedAvatarName) {
                const idx = avatars.findIndex((a) => a.name === savedAvatarName);
                this.currentAvatarIndex = idx >= 0 ? idx : 0;
            } else {
                this.currentAvatarIndex = 0;
            }

            console.log(`[VRChatIntegration] Will load avatar index ${this.currentAvatarIndex} when menu opens`);

            // Wire up callbacks
            this.setupCallbacks();

            // Register UI interactables with VR controllers
            const interactables = this.vrChatPanel.getInteractables();
            this.vrControllers.registerUIInteractables(interactables);

            // Set up hover effects
            interactables.forEach((mesh) => {
                mesh.userData.onHoverEnter = (m) => this.vrChatPanel.highlightInteractable(m);
                mesh.userData.onHoverExit = (m) => this.vrChatPanel.resetInteractable(m);
            });

            this.isInitialized = true;
            console.log('[VRChatIntegration] ✅ VR chatbot system ready!');

            // Show welcome message
            this.vrChatPanel.appendMessage(
                'bot',
                "Hello! I'm ready to chat in VR. Tap the microphone button to speak."
            );

            return true;
        } catch (error) {
            console.error('[VRChatIntegration] Failed to initialize:', error);
            return false;
        }
    }

    /**
     * Setup all callbacks and event handlers
     */
    setupCallbacks() {
        // Avatar change callback
        this.avatarManager.onAvatarChanged = (avatar) => {
            console.log(`[VRChatIntegration] Avatar changed to: ${avatar.name}`);
            localStorage.setItem('vr_avatar_name', avatar.name);
            this.vrChatPanel.appendMessage('bot', `Switched to ${avatar.name}`);

            // Re-register with VR controllers
            if (this.avatarManager.currentRoot) {
                this.vrControllers.registerAvatar(this.avatarManager.currentRoot);
            }
        };

        // UI button click callback
        this.vrControllers.setUIButtonCallback((name, userData) => {
            this.handleUIClick(name, userData);
        });

        // Speech recognition callbacks
        if (this.speechService) {
            this.speechService.setRecognitionCallbacks({
                onStart: () => {
                    this.vrChatPanel.setStatus('listening');
                    console.log('[VRChatIntegration] 🎤 Listening...');
                },
                onEnd: () => {
                    this.vrChatPanel.setStatus('idle');
                    console.log('[VRChatIntegration] Listening ended');
                },
                onResult: (transcript, confidence) => {
                    console.log(`[VRChatIntegration] Recognized: "${transcript}" (${confidence})`);
                    this.handleUserMessage(transcript);
                },
                onError: (error) => {
                    console.error('[VRChatIntegration] Speech error:', error);
                    this.vrChatPanel.setStatus('idle');
                    this.vrChatPanel.appendMessage('bot', `Speech error: ${error}`);
                },
            });
        }
    }

    /**
     * Handle UI button clicks
     * @param {string} name - Button mesh name
     * @param {Object} userData - Button user data
     */
    handleUIClick(name, userData) {
        console.log(`[VRChatIntegration] Button clicked: ${name}`);

        // Main buttons
        if (name === 'Btn:mic') {
            this.handleMicButton();
        } else if (name === 'Btn:send') {
            this.handleSendButton();
        } else if (name === 'Btn:clear') {
            this.handleClearButton();
        } else if (name === 'Btn:settings') {
            this.handleSettingsButton();
        } else if (name === 'Btn:pin') {
            this.handlePinButton();
        } else if (name === 'Btn:avatar_prev') {
            this.handleAvatarPrev();
        } else if (name === 'Btn:avatar_next') {
            this.handleAvatarNext();
        }
        // Settings buttons
        else if (name === 'Btn:back') {
            this.vrChatPanel.setMode('chat');
        } else if (name === 'Btn:stt') {
            this.handleSTTToggle();
        } else if (name === 'Btn:tts') {
            this.handleTTSToggle();
        }
        // Quick prompts
        else if (name.startsWith('Chip:')) {
            this.handleQuickPrompt(userData.label);
        }
        // Avatar cards
        else if (name.startsWith('AvatarCard:')) {
            this.handleAvatarSwitch(userData.avatarIndex);
        }
    }

    /**
     * Handle microphone button
     */
    handleMicButton() {
        if (!this.speechService || !this.speechService.isRecognitionAvailable()) {
            this.vrChatPanel.appendMessage('bot', 'Speech recognition not available in your browser.');
            return;
        }

        if (!this.vrChatPanel.sttEnabled) {
            this.vrChatPanel.appendMessage('bot', 'Speech recognition is disabled. Enable it in Settings.');
            return;
        }

        if (this.speechService.isRecognizing) {
            this.speechService.stopRecognition();
        } else {
            this.speechService.startRecognition({
                onStart: () => this.vrChatPanel.setStatus('listening'),
                onEnd: () => this.vrChatPanel.setStatus('idle'),
                onResult: (text) => this.handleUserMessage(text),
                onError: (err) => {
                    this.vrChatPanel.setStatus('idle');
                    this.vrChatPanel.appendMessage('bot', `Error: ${err}`);
                },
            });
        }
    }

    /**
     * Handle send button
     */
    handleSendButton() {
        // In VR, we primarily use voice input
        // This could open a VR keyboard in a future version
        this.vrChatPanel.appendMessage('bot', 'Voice input recommended. Tap microphone to speak.');
    }

    /**
     * Handle clear button
     */
    handleClearButton() {
        this.vrChatPanel.clearMessages();
        if (this.chatManager) {
            this.chatManager.clearMessages();
        }
        console.log('[VRChatIntegration] Chat cleared');
    }

    /**
     * Handle settings button
     */
    handleSettingsButton() {
        const newMode = this.vrChatPanel.mode === 'settings' ? 'chat' : 'settings';
        this.vrChatPanel.setMode(newMode);
    }

    /**
     * Handle pin button (toggle head-locked)
     */
    handlePinButton() {
        const isHeadLocked = !this.vrChatPanel.headLocked;
        this.vrChatPanel.setHeadLocked(isHeadLocked);
        this.vrChatPanel.appendMessage('bot', isHeadLocked ? 'Panel locked to view' : 'Panel position fixed');
    }

    /**
     * Handle STT toggle
     */
    handleSTTToggle() {
        const newState = !this.vrChatPanel.sttEnabled;
        this.vrChatPanel.setSTTEnabled(newState);
        console.log(`[VRChatIntegration] STT ${newState ? 'enabled' : 'disabled'}`);
    }

    /**
     * Handle TTS toggle
     */
    handleTTSToggle() {
        const newState = !this.vrChatPanel.ttsEnabled;
        this.vrChatPanel.setTTSEnabled(newState);
        console.log(`[VRChatIntegration] TTS ${newState ? 'enabled' : 'disabled'}`);
    }

    /**
     * Handle quick prompt chip
     * @param {string} prompt - Prompt text
     */
    handleQuickPrompt(prompt) {
        this.handleUserMessage(prompt);
    }

    /**
     * Handle avatar switch
     * @param {number} index - Avatar index
     */
    async handleAvatarSwitch(index) {
        try {
            this.vrChatPanel.setStatus('thinking');
            await this.avatarManager.setAvatarByIndex(index);
            this.currentAvatarIndex = index;
            this.vrChatPanel.setStatus('idle');
        } catch (error) {
            console.error('[VRChatIntegration] Avatar switch failed:', error);
            this.vrChatPanel.appendMessage('bot', 'Failed to switch avatar');
            this.vrChatPanel.setStatus('idle');
        }
    }

    /**
     * Handle avatar previous button
     */
    async handleAvatarPrev() {
        const avatars = this.avatarManager.getAvatars();
        if (!avatars || avatars.length === 0) return;

        const newIndex = (this.currentAvatarIndex - 1 + avatars.length) % avatars.length;
        await this.handleAvatarSwitch(newIndex);
    }

    /**
     * Handle avatar next button
     */
    async handleAvatarNext() {
        const avatars = this.avatarManager.getAvatars();
        if (!avatars || avatars.length === 0) return;

        const newIndex = (this.currentAvatarIndex + 1) % avatars.length;
        await this.handleAvatarSwitch(newIndex);
    }

    /**
     * Sync with desktop avatar instead of creating duplicate
     * This prevents avatar overlap issues
     */
    async syncAvatarFromDesktop() {
        // Check if desktop already loaded an avatar
        if (this.avatarManager.currentRoot) {
            console.log('[VRChatIntegration] Reusing existing desktop avatar (no duplicate)');
            // Just register existing avatar with VR controllers
            if (this.vrControllers && this.vrControllers.registerAvatar) {
                this.vrControllers.registerAvatar(this.avatarManager.currentRoot);
            }
            return;
        }

        // No avatar exists yet - load the preferred one
        console.log('[VRChatIntegration] No existing avatar - loading new one');
        await this.avatarManager.setAvatarByIndex(this.currentAvatarIndex);

        // Register with VR controllers
        if (this.avatarManager.currentRoot && this.vrControllers && this.vrControllers.registerAvatar) {
            this.vrControllers.registerAvatar(this.avatarManager.currentRoot);
        }
    }

    /**
     * Handle user message (from voice or quick prompt)
     * @param {string} text - User message text
     */
    handleUserMessage(text) {
        if (!text || text.trim().length === 0) return;

        console.log(`[VRChatIntegration] User: ${text}`);

        // Add to VR panel
        this.vrChatPanel.appendMessage('user', text);

        // Add to desktop chat manager (if available)
        if (this.chatManager) {
            this.chatManager.addMessage(text, 'user');
        }

        // Process message (send to AI)
        this.processUserMessage(text);
    }

    /**
     * Process user message and get AI response
     * @param {string} text - User message
     */
    async processUserMessage(text) {
        this.vrChatPanel.setStatus('thinking');

        try {
            // Check if sendMessage function exists (from main.js)
            if (typeof window.sendMessage === 'function') {
                // Use existing sendMessage function
                await window.sendMessage(text);
            } else {
                // Fallback: echo response
                const response = `You said: "${text}". AI integration needed.`;
                this.handleBotResponse(response);
            }
        } catch (error) {
            console.error('[VRChatIntegration] AI processing error:', error);
            this.handleBotResponse('Sorry, I encountered an error processing your message.');
        }
    }

    /**
     * Handle bot response
     * @param {string} text - Bot response text
     */
    handleBotResponse(text) {
        console.log(`[VRChatIntegration] Bot: ${text}`);

        // Add to VR panel
        this.vrChatPanel.appendMessage('bot', text);

        // Add to desktop chat manager (if available)
        if (this.chatManager) {
            this.chatManager.addMessage(text, 'bot');
        }

        // Speak response if TTS enabled
        if (this.vrChatPanel.ttsEnabled && this.speechService && this.speechService.isSynthesisAvailable()) {
            this.vrChatPanel.setStatus('speaking');
            this.speechService.speak(text, {
                onStart: () => this.vrChatPanel.setStatus('speaking'),
                onEnd: () => this.vrChatPanel.setStatus('idle'),
                onError: () => this.vrChatPanel.setStatus('idle'),
            });
        } else {
            this.vrChatPanel.setStatus('idle');
        }
    }

    /**
     * Enable VR chat system
     */
    async enable() {
        if (!this.isInitialized) {
            console.warn('[VRChatIntegration] Cannot enable - not initialized');
            return;
        }

        this.vrChatPanel.setVisible(true);

        // [FIX] Sync with desktop avatar to prevent overlap
        if (!this.hasLoadedAvatar) {
            console.log('[VRChatIntegration] First open - syncing avatar...');
            try {
                await this.syncAvatarFromDesktop();
                this.hasLoadedAvatar = true;
                console.log('[VRChatIntegration] ✅ VR avatar ready');
            } catch (error) {
                console.error('[VRChatIntegration] Failed to sync avatar:', error);
                this.vrChatPanel.appendMessage('bot', 'Failed to load avatar');
            }
        }

        console.log('[VRChatIntegration] VR chat enabled');
    }

    /**
     * Disable VR chat system
     */
    disable() {
        this.vrChatPanel.setVisible(false);
        if (this.speechService && this.speechService.isRecognizing) {
            this.speechService.stopRecognition();
        }
        console.log('[VRChatIntegration] VR chat disabled');
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        if (this.speechService) {
            this.speechService.stopRecognition();
            this.speechService.stopSpeaking();
        }
        this.avatarManager?.dispose();
        this.vrChatPanel?.dispose();
        console.log('[VRChatIntegration] Disposed');
    }
}

// Make available globally for easy access
window.VRChatIntegration = VRChatIntegration;
