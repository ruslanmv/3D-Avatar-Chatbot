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
        this._speechService = speechService;
        this.chatManager = chatManager;

        this.isInitialized = false;
        this.hasLoadedAvatar = false; // [FIX] Track if we've loaded the 3D model yet
        this.currentAvatarIndex = 0;

        console.log('[VRChatIntegration] Initializing VR chatbot system...');
    }

    /**
     * Lazy getter for speechService — resolves from window.SpeechService if the
     * initial reference was null (script load order race condition).
     */
    get speechService() {
        if (!this._speechService && window.SpeechService) {
            this._speechService = window.SpeechService;
            console.log('[VRChatIntegration] Late-bound speechService from window.SpeechService');
        }
        return this._speechService;
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

            // Sync panel counter to match initial index
            this.vrChatPanel.currentAvatarIndex = this.currentAvatarIndex;
            this.vrChatPanel.redraw();
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

            // Set up push-to-talk for VR controllers
            this.setupPushToTalk();

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
                    if (window.NEXUS_BEHAVIOR) {
                        window.NEXUS_BEHAVIOR.onListeningStart();
                    }
                    console.log('[VRChatIntegration] 🎤 Listening...');
                },
                onEnd: () => {
                    this.vrChatPanel.setStatus('idle');
                    if (window.NEXUS_BEHAVIOR) {
                        window.NEXUS_BEHAVIOR.onListeningEnd();
                    }
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
     * Setup push-to-talk for VR controllers
     * Enables hands-free voice input using Y button or grip on left controller
     */
    setupPushToTalk() {
        if (!this.speechService || !this.vrControllers) {
            console.warn('[VRChatIntegration] Cannot setup push-to-talk: missing dependencies');
            return;
        }

        this.vrControllers.setPushToTalkCallbacks(
            // On PTT start (button pressed)
            async () => {
                if (!this.vrChatPanel.sttEnabled) {
                    console.log('[VRChatIntegration] Push-to-talk ignored: STT disabled');
                    return;
                }

                // Check if Web Speech API is available, otherwise use VR fallback
                const useFallback = !this.speechService.isRecognitionAvailable();

                if (useFallback) {
                    console.log('[VRChatIntegration] Using VR fallback recording (MediaRecorder)');
                    if (window.NEXUS_LOGGER) {
                        window.NEXUS_LOGGER.info('VR PTT using fallback', { method: 'MediaRecorder' });
                    }
                }

                // Request microphone permission if not granted
                if (!this.speechService.hasMicrophonePermission()) {
                    this.vrChatPanel.appendMessage('bot', 'Requesting microphone permission...');
                    const granted = await this.speechService.requestMicrophonePermission();
                    if (!granted) {
                        this.vrChatPanel.appendMessage('bot', 'Microphone permission denied.');
                        return;
                    }
                    this.vrChatPanel.appendMessage('bot', '✅ Microphone ready!');
                }

                // Use VR fallback if Web Speech API not available
                if (useFallback) {
                    await this.speechService.startVRFallbackRecording({
                        onStart: () => {
                            this.vrChatPanel.setStatus('listening');
                            this.vrChatPanel.setTranscript('Recording...', 'interim');
                            console.log('[VRChatIntegration] 🎤 VR Fallback recording started');
                        },
                        onResult: (text, confidence) => {
                            const confidencePercent = Math.round(confidence * 100);
                            console.log(`[VRChatIntegration] ✅ VR Fallback result: "${text}" (${confidencePercent}%)`);

                            this.vrChatPanel.setTranscript(text, 'final');
                            this.vrChatPanel.appendMessage(
                                'bot',
                                `🎤 Heard: "${text}" (${confidencePercent}% confidence)`
                            );

                            setTimeout(() => {
                                this.vrChatPanel.clearTranscript();
                                this.handleUserMessage(text);
                            }, 1500);
                        },
                        onError: (error, context) => {
                            console.error('[VRChatIntegration] VR Fallback error:', error);
                            this.vrChatPanel.setStatus('idle');
                            this.vrChatPanel.clearTranscript();
                            const errorMsg = context ? `${error}: ${context}` : error;
                            this.vrChatPanel.appendMessage('bot', `Speech error: ${errorMsg}`);
                        },
                        onEnd: () => {
                            this.vrChatPanel.setStatus('idle');
                        },
                    });
                    return;
                }

                // Use standard Web Speech API
                await this.speechService.startRecognition({
                    onStart: () => {
                        this.vrChatPanel.setStatus('listening');
                        this.vrChatPanel.setTranscript('Listening...', 'interim');
                        console.log('[VRChatIntegration] 🎤 PTT: Listening...');
                    },
                    onInterim: (interimText) => {
                        console.log('[VRChatIntegration] 📝 PTT Interim:', interimText);
                        this.vrChatPanel.setTranscript(interimText, 'interim');
                    },
                    onResult: (text, confidence) => {
                        const confidencePercent = Math.round(confidence * 100);
                        console.log(
                            `[VRChatIntegration] ✅ PTT Transcribed: "${text}" (${confidencePercent}% confidence)`
                        );

                        // Show final transcript
                        this.vrChatPanel.setTranscript(text, 'final');
                        this.vrChatPanel.appendMessage('bot', `🎤 Heard: "${text}" (${confidencePercent}% confidence)`);

                        // Send to chatbot after brief delay to show transcript
                        setTimeout(() => {
                            this.vrChatPanel.clearTranscript();
                            console.log(`[VRChatIntegration] 📤 PTT Sending to chatbot: "${text}"`);
                            this.handleUserMessage(text);
                        }, 1500);
                    },
                    onError: (error, context) => {
                        console.error('[VRChatIntegration] PTT error:', error);
                        this.vrChatPanel.setStatus('idle');
                        this.vrChatPanel.clearTranscript();
                        const errorMsg = context ? `${error}\n${context}` : error;
                        this.vrChatPanel.appendMessage('bot', `Speech error: ${errorMsg}`);
                    },
                    onEnd: () => {
                        this.vrChatPanel.setStatus('idle');
                    },
                });
            },
            // On PTT end (button released)
            () => {
                if (this.speechService.isRecognizing) {
                    // Stop either Web Speech or VR fallback recording
                    if (!this.speechService.isRecognitionAvailable()) {
                        this.speechService.stopVRFallbackRecording();
                    } else {
                        this.speechService.stopRecognition();
                    }
                    console.log('[VRChatIntegration] 🎤 PTT: Stopped');
                }
            }
        );

        console.log('[VRChatIntegration] ✅ Push-to-talk enabled (hold Y button or grip on left controller)');
    }

    /**
     * Handle UI button clicks
     * @param {string} name - Button mesh name
     * @param {object} userData - Button user data
     */
    handleUIClick(name, userData, hitPoint) {
        console.log(`[VRChatIntegration] Button clicked: ${name}`);

        // Let panel handle its own built-in actions (STT/TTS toggles with desktop settings sync)
        if (this.vrChatPanel.handleUIAction && this.vrChatPanel.handleUIAction(name, userData)) {
            console.log('[VRChatIntegration] Handled by panel built-in action');
            return;
        }

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
        }
        // Quick prompts
        else if (name.startsWith('Chip:')) {
            this.handleQuickPrompt(userData.label);
        }
        // Avatar cards
        else if (name.startsWith('AvatarCard:')) {
            this.handleAvatarSwitch(userData.avatarIndex);
        }
        // Chat area tap — check for attachment card hits
        else if (name === 'ChatArea:tap' && hitPoint) {
            this._handleChatAreaTap(hitPoint);
        }
    }

    /**
     * Convert a 3D hit point on the chat panel to canvas coordinates
     * and check if an attachment card was tapped.
     */
    _handleChatAreaTap(hitPoint) {
        const panel = this.vrChatPanel;
        if (!panel || !panel.handleAttachmentTap) {
            return;
        }

        // Convert world hit point to panel-local coordinates
        const localPoint = panel.group.worldToLocal(hitPoint.clone());

        // Panel-local → canvas pixel coordinates
        // Panel origin is center; canvas origin is top-left
        const canvasX = (localPoint.x / panel.panelWidth + 0.5) * panel.canvasW;
        const canvasY = (0.5 - localPoint.y / panel.panelHeight) * panel.canvasH;

        const attachment = panel.handleAttachmentTap(canvasX, canvasY);
        if (attachment) {
            console.log('[VRChatIntegration] Attachment card tapped:', attachment.name);
            if (window.VRMediaPanel) {
                window.VRMediaPanel.show(attachment);
            }
        }
    }

    /**
     * Handle microphone button (improved with permission handling for VR)
     * Uses the unified startSTT() API with automatic fallback chain:
     *   Web Speech → WASM Whisper → OpenAI → Google
     * Falls back to VR MediaRecorder if no STT provider is available.
     */
    async handleMicButton() {
        if (!this.speechService) {
            console.error('[VRChatIntegration] SpeechService not available');
            this.vrChatPanel.appendMessage('bot', 'Speech service not loaded. Please reload the page.');
            return;
        }

        if (!this.vrChatPanel.sttEnabled) {
            this.vrChatPanel.appendMessage('bot', 'Speech recognition is disabled. Enable it in Settings.');
            return;
        }

        // Toggle off if already listening
        if (this.speechService.isRecognizing) {
            // Stop either standard STT or VR fallback
            if (typeof this.speechService.stopSTT === 'function') {
                this.speechService.stopSTT();
            } else if (
                typeof this.speechService.stopVRFallbackRecording === 'function' &&
                !this.speechService.isRecognitionAvailable()
            ) {
                this.speechService.stopVRFallbackRecording();
            } else {
                this.speechService.stopRecognition();
            }
            this.vrChatPanel.setStatus('idle');
            return;
        }

        // Request microphone permission first (critical for VR)
        if (
            typeof this.speechService.hasMicrophonePermission === 'function' &&
            !this.speechService.hasMicrophonePermission()
        ) {
            this.vrChatPanel.setStatus('thinking');
            this.vrChatPanel.appendMessage('bot', 'Requesting microphone permission...');

            const granted = await this.speechService.requestMicrophonePermission();
            if (!granted) {
                this.vrChatPanel.setStatus('idle');
                this.vrChatPanel.appendMessage(
                    'bot',
                    'Microphone permission denied. Please allow mic access in browser settings.'
                );
                return;
            }
            this.vrChatPanel.appendMessage('bot', 'Microphone ready! Tap mic again to speak.');
            this.vrChatPanel.setStatus('idle');
            return;
        }

        // Shared callbacks for all STT paths
        const sttCallbacks = {
            onStart: () => {
                this.vrChatPanel.setStatus('listening');
                this.vrChatPanel.setTranscript('Listening...', 'interim');
                console.log('[VRChatIntegration] 🎤 Listening...');
            },
            onInterim: (interimText) => {
                console.log('[VRChatIntegration] Interim:', interimText);
                this.vrChatPanel.setTranscript(interimText, 'interim');
            },
            onEnd: () => {
                this.vrChatPanel.setStatus('idle');
                console.log('[VRChatIntegration] Listening ended');
            },
            onResult: (text, confidence) => {
                const pct = Math.round((confidence || 0) * 100);
                console.log(`[VRChatIntegration] 🎤 Transcribed: "${text}" (${pct}%)`);
                this.vrChatPanel.setTranscript(text, 'final');
                this.vrChatPanel.appendMessage('bot', `🎤 Heard: "${text}" (${pct}% confidence)`);
                setTimeout(() => {
                    this.vrChatPanel.clearTranscript();
                    this.handleUserMessage(text);
                }, 1500);
            },
            onError: (error, context) => {
                console.error('[VRChatIntegration] Speech error:', error);
                this.vrChatPanel.setStatus('idle');
                this.vrChatPanel.clearTranscript();
                const errorMsg = context ? `${error}\n${context}` : error;
                this.vrChatPanel.appendMessage('bot', `Speech error: ${errorMsg}`);
            },
        };

        // Try unified startSTT (auto-fallback chain) if available
        if (typeof this.speechService.startSTT === 'function') {
            console.log('[VRChatIntegration] Using unified startSTT() with auto-fallback');
            const started = await this.speechService.startSTT(sttCallbacks);
            if (started) {
                return;
            }
            console.warn('[VRChatIntegration] startSTT returned false, trying VR fallback');
        }

        // Try VR MediaRecorder fallback
        if (typeof this.speechService.startVRFallbackRecording === 'function') {
            console.log('[VRChatIntegration] Using VR fallback recording (MediaRecorder)');
            await this.speechService.startVRFallbackRecording(sttCallbacks);
            return;
        }

        // Last resort: try legacy startRecognition
        if (this.speechService.isRecognitionAvailable?.()) {
            console.log('[VRChatIntegration] Using legacy startRecognition');
            await this.speechService.startRecognition(sttCallbacks);
            return;
        }

        this.vrChatPanel.appendMessage(
            'bot',
            'No speech recognition available. Check browser settings or configure an API key in Settings.'
        );
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

            // Sync panel counter so the displayed index matches
            this.vrChatPanel.currentAvatarIndex = index;
            this.vrChatPanel.redraw();

            const newRoot = this.avatarManager.currentRoot;
            if (!newRoot) {
                console.warn('[VRChatIntegration] Avatar switch: no currentRoot after load');
                this.vrChatPanel.setStatus('idle');
                return;
            }

            console.log('[VRChatIntegration] Avatar switched — re-registering with all VR systems...');

            // Register with ProceduralAnimator
            if (window.NEXUS_PROCEDURAL_ANIMATOR) {
                window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(newRoot);
            }

            // Re-register with VR controllers (for grab/turntable)
            if (this.vrControllers) {
                this.vrControllers.registerAvatar(newRoot);
            }

            // Re-register with VR bone grabber (for direct bone manipulation)
            const viewer = window.NEXUS_VIEWER;
            if (viewer) {
                if (viewer.vrBoneGrabber) {
                    viewer.vrBoneGrabber.setAvatar(newRoot);
                    if (window.poseEditor) {
                        viewer.vrBoneGrabber.setPoseEditor(window.poseEditor);
                    }
                    console.log('[VRChatIntegration] VRBoneGrabber re-registered with new avatar');
                }

                // Re-register with VR pose system (for IK + presets)
                if (viewer.vrPoseSystem) {
                    viewer.vrPoseSystem.setAvatar(newRoot);
                    viewer.vrPoseSystem.setEnabled(true);
                    console.log('[VRChatIntegration] VRPoseSystem re-registered with new avatar');
                }

                // Re-register with VR puppet interaction (for handles + two-hand transform)
                if (viewer.vrPuppetInteraction) {
                    viewer.vrPuppetInteraction.setAvatar(newRoot);
                    console.log('[VRChatIntegration] VRPuppetInteraction re-registered with new avatar');
                }

                // Re-register with passthrough enhancer
                if (viewer.passthroughEnhancer) {
                    viewer.passthroughEnhancer.setAvatarRoot(newRoot);
                }
            }

            console.log('[VRChatIntegration] All VR systems re-registered after avatar switch');
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
        if (!avatars || avatars.length === 0) {
            return;
        }

        const newIndex = (this.currentAvatarIndex - 1 + avatars.length) % avatars.length;
        await this.handleAvatarSwitch(newIndex);
    }

    /**
     * Handle avatar next button
     */
    async handleAvatarNext() {
        const avatars = this.avatarManager.getAvatars();
        if (!avatars || avatars.length === 0) {
            return;
        }

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
            // Phase 3: Register with ProceduralAnimator
            if (window.NEXUS_PROCEDURAL_ANIMATOR) {
                window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(this.avatarManager.currentRoot);
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
        // Phase 3: Register with ProceduralAnimator
        if (this.avatarManager.currentRoot && window.NEXUS_PROCEDURAL_ANIMATOR) {
            window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(this.avatarManager.currentRoot);
        }
    }

    /**
     * Handle user message (from voice or quick prompt)
     * @param {string} text - User message text
     */
    handleUserMessage(text) {
        if (!text || text.trim().length === 0) {
            return;
        }

        console.log(`[VRChatIntegration] User: ${text}`);

        // Phase 3: Notify BehaviorEngine of user message
        if (window.NEXUS_BEHAVIOR) {
            window.NEXUS_BEHAVIOR.onUserMessage(text);
        }

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

        // ✅ Add user message to chat session history
        if (window.chatHistory) {
            window.chatHistory.addMessage('user', text);
        }

        try {
            // 1) Ensure LLMManager instance exists (uses same settings as desktop)
            if (!window._nexusLLM) {
                if (typeof window.LLMManager !== 'function') {
                    throw new Error(
                        'LLMManager not loaded. Ensure src/LLMManager.js is included before VRChatIntegration.'
                    );
                }
                console.log('[VRChatIntegration] Creating LLMManager instance for VR');
                window._nexusLLM = new window.LLMManager();
            }

            // 2) Get settings and send message to configured AI provider
            const settings = window._nexusLLM.getSettings();
            const systemPrompt =
                settings.system_prompt ||
                'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.';

            // ✅ Get conversation history for context
            const history = window.chatHistory ? window.chatHistory.getHistory() : [];

            console.log('[VRChatIntegration] Sending to AI:', {
                provider: settings.provider,
                useProxy: settings.proxy?.enable_proxy,
                textPreview: text.slice(0, 50),
                historyMessages: history.length,
            });

            // Phase 5: Try structured response first (includes attachments, directives)
            let reply;
            if (typeof window._nexusLLM.sendMessageStructured === 'function') {
                const rawResponse = await window._nexusLLM.sendMessageStructured(text, systemPrompt, history);

                // Use BridgeResponseAdapter if available, otherwise extract text
                if (window.BridgeResponseAdapter) {
                    reply = window.BridgeResponseAdapter.normalizeResponse(rawResponse);
                } else {
                    reply = rawResponse?.choices?.[0]?.message?.content || rawResponse?.text || 'No response';
                }
            } else {
                reply = await window._nexusLLM.sendMessage(text, systemPrompt, history);
            }

            // 3) Show + speak AI response
            this.handleBotResponse(reply);
        } catch (error) {
            console.error('[VRChatIntegration] AI processing error:', error);
            const errorMsg = 'Sorry, I encountered an error processing your message.';
            this.handleBotResponse(errorMsg);
        }
    }

    /**
     * Handle bot response — accepts either plain string or normalized response object.
     *
     * @param {string | object} response - plain text or { text, attachments, avatar_directives, persona_context }
     */
    handleBotResponse(response) {
        // Normalise input: accept string or structured object
        let text, attachments, directives;
        if (typeof response === 'string') {
            text = response;
            attachments = [];
            directives = {};
        } else {
            text = response.text || '';
            attachments = response.attachments || [];
            directives = response.avatar_directives || {};
        }

        console.log(`[VRChatIntegration] Bot: ${text}`, {
            attachments: attachments.length,
            directives: Object.keys(directives).length,
        });

        // --- Text rendering ---
        if (attachments.length > 0) {
            // Use rich message if panel supports it
            if (typeof this.vrChatPanel.appendRichMessage === 'function') {
                this.vrChatPanel.appendRichMessage({
                    role: 'bot',
                    text,
                    attachments,
                    directives,
                });
            } else {
                this.vrChatPanel.appendMessage('bot', text);
            }
        } else {
            this.vrChatPanel.appendMessage('bot', text);
        }

        // --- Desktop chat manager ---
        if (this.chatManager) {
            if (attachments.length > 0 && typeof this.chatManager.addRichMessage === 'function') {
                this.chatManager.addRichMessage(text, 'bot', attachments);
            } else {
                this.chatManager.addMessage(text, 'bot');
            }
        }

        // --- Chat history ---
        if (window.chatHistory) {
            window.chatHistory.addMessage('assistant', text);
        }

        // --- Phase 6: Apply avatar directives ---
        if (directives.emotion || directives.pose) {
            this._applyAvatarDirectives(directives);
        }

        // --- VR Media Panel ---
        if (attachments.length > 0 && window.VRMediaPanel) {
            const imgAttachment = attachments.find((a) => a.type === 'image');
            if (imgAttachment) {
                window.VRMediaPanel.show(imgAttachment);
            }
        }

        // --- Phase 3: Notify BehaviorEngine of bot response ---
        if (window.NEXUS_BEHAVIOR) {
            window.NEXUS_BEHAVIOR.onBotResponse(text, directives);
        }

        // --- TTS (use text only, never speak attachment metadata) ---
        try {
            if (this.vrChatPanel.ttsEnabled && this.speechService && this.speechService.isSynthesisAvailable()) {
                console.log('[VRChatIntegration] TTS enabled, speaking response');
                this.vrChatPanel.setStatus('speaking');

                // Get speech rate from settings
                const rate = window.SpeechSettings?.rate || 1.0;

                this.speechService.speak(text, {
                    onStart: () => {
                        this.vrChatPanel.setStatus('speaking');
                        // Phase 3: Start lip-sync and notify behavior engine
                        if (window.NEXUS_LIP_SYNC) {
                            window.NEXUS_LIP_SYNC.start(text, rate);
                        }
                        if (window.NEXUS_BEHAVIOR) {
                            window.NEXUS_BEHAVIOR.onSpeechStart();
                        }
                    },
                    onEnd: () => {
                        this.vrChatPanel.setStatus('idle');
                        // Phase 3: Stop lip-sync and notify behavior engine
                        if (window.NEXUS_LIP_SYNC) {
                            window.NEXUS_LIP_SYNC.stop();
                        }
                        if (window.NEXUS_BEHAVIOR) {
                            window.NEXUS_BEHAVIOR.onSpeechEnd();
                        }
                    },
                    onError: () => {
                        this.vrChatPanel.setStatus('idle');
                        if (window.NEXUS_LIP_SYNC) {
                            window.NEXUS_LIP_SYNC.stop();
                        }
                        if (window.NEXUS_BEHAVIOR) {
                            window.NEXUS_BEHAVIOR.onSpeechEnd();
                        }
                    },
                });
            } else {
                this.vrChatPanel.setStatus('idle');
            }
        } catch (e) {
            console.error('[VRChatIntegration] TTS error (non-fatal):', e);
            this.vrChatPanel.setStatus('idle');
        }
    }

    /**
     * Apply per-message avatar directives (Phase 6).
     * @param {object} directives - { emotion, pose, gesture }
     * @private
     */
    _applyAvatarDirectives(directives) {
        const animator = window.NEXUS_PROCEDURAL_ANIMATOR;
        if (!animator || typeof animator.setMode !== 'function') {
            return;
        }

        // Map emotion to animation mode
        const EMOTION_MODE = {
            happy: 'happy',
            excited: 'dance',
            energetic: 'dance',
            sad: 'idle',
            thinking: 'thinking',
            curious: 'thinking',
            calm: 'idle',
            neutral: 'idle',
            presenting: 'happy',
        };

        const emotion = (directives.emotion || '').toLowerCase();
        const mode = EMOTION_MODE[emotion];
        if (mode) {
            animator.setMode(mode, 5000); // 5 second duration for per-message override
            console.log(`[VRChatIntegration] Avatar directive: emotion=${emotion} → mode=${mode}`);
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
