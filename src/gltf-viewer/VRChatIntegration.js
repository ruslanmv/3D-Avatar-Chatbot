/**
 * VR Chat Integration Module (Fixed & Production Ready)
 * -----------------------------------------------------
 * Fixes:
 * - Proper named export: `export class VRChatIntegration` (matches ViewerEngine import)
 * - No avatar overlap: uses ONE shared AvatarManager (desktop + VR)
 * - VR avatar stays synced with desktop (same AvatarManager currentRoot)
 * - Works with your panel controls:
 *    - Btn:pin          -> vrChatPanel.togglePinned()
 *    - Btn:avatar_prev  -> vrChatPanel.prevAvatar()  + avatarManager.setAvatarByIndex()
 *    - Btn:avatar_next  -> vrChatPanel.nextAvatar()  + avatarManager.setAvatarByIndex()
 *
 * Notes:
 * - This module does NOT create any second avatar. It always reuses avatarManager.currentRoot.
 * - If no avatar exists yet, it loads the currently selected avatar index once.
 */

export class VRChatIntegration {
  constructor({ avatarManager, vrChatPanel, vrControllers, speechService, chatManager }) {
    if (!avatarManager || !vrChatPanel || !vrControllers) {
      throw new Error('[VRChatIntegration] avatarManager, vrChatPanel, and vrControllers are required.');
    }

    this.avatarManager = avatarManager;
    this.vrChatPanel = vrChatPanel;
    this.vrControllers = vrControllers;
    this.speechService = speechService || null;
    this.chatManager = chatManager || null;

    this.isInitialized = false;
    this._callbacksWired = false;

    this.currentAvatarIndex = 0;

    // Keep a stable reference for optional bot bridging
    this._boundHandleBot = (text) => this.handleBotResponse(text);

    console.log('[VRChatIntegration] Constructed');
  }

  /**
   * Initialize: loads avatar manifest definitions + wires UI callbacks.
   * Does NOT spawn a 3D model by itself.
   */
  async initialize(manifestUrl = '/vendor/avatars/avatars.json') {
    try {
      const avatars = await this.avatarManager.initFromManifest(manifestUrl);
      console.log(`[VRChatIntegration] Loaded ${avatars?.length ?? 0} avatar definitions`);

      this.vrChatPanel.setAvatars(Array.isArray(avatars) ? avatars : []);

      // Restore saved selection (by name if available)
      const savedAvatarName = this._safeGetLocalStorage('vr_avatar_name');
      if (savedAvatarName && Array.isArray(avatars) && avatars.length) {
        const idx = avatars.findIndex((a) => a?.name === savedAvatarName);
        this.currentAvatarIndex = idx >= 0 ? idx : 0;
      } else {
        this.currentAvatarIndex = 0;
      }

      // Keep panel in sync with restored index (if panel supports it)
      if (typeof this.vrChatPanel.setCurrentAvatarIndex === 'function') {
        this.vrChatPanel.setCurrentAvatarIndex(this.currentAvatarIndex);
      } else {
        // fallback: panel stores its own index; try to set via direct property if present
        this.vrChatPanel.currentAvatarIndex = this.currentAvatarIndex;
        this.vrChatPanel.redraw?.();
      }

      if (!this._callbacksWired) {
        this._wireCallbacks();
        this._callbacksWired = true;
      }

      // Register UI interactables with controllers
      const interactables = this.vrChatPanel.getInteractables?.() || [];
      this.vrControllers.registerUIInteractables(interactables);

      // Optional hover effects
      interactables.forEach((mesh) => {
        if (!mesh?.userData) mesh.userData = {};
        mesh.userData.onHoverEnter = (m) => this.vrChatPanel.highlightInteractable?.(m);
        mesh.userData.onHoverExit = (m) => this.vrChatPanel.resetInteractable?.(m);
      });

      // Optional: allow your global sendMessage() pipeline to notify VR of bot messages.
      // If your app already has a bot callback, you can call:
      //   window.VR_CHAT_HANDLE_BOT("text")
      window.VR_CHAT_HANDLE_BOT = this._boundHandleBot;

      this.isInitialized = true;
      this.vrChatPanel.appendMessage?.(
        'bot',
        "Hello! I'm ready to chat in VR. Tap the microphone button to speak."
      );

      console.log('[VRChatIntegration] ✅ Initialized');
      return true;
    } catch (err) {
      console.error('[VRChatIntegration] Failed to initialize:', err);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Ensure VR uses the same shared avatar instance as desktop.
   * - If AvatarManager already has currentRoot: just register it with controllers.
   * - Otherwise: load selected avatar index ONCE (this becomes shared for desktop+VR).
   */
  async syncAvatarFromDesktop() {
    if (!this.isInitialized) return;

    if (this.avatarManager.currentRoot) {
      this.vrControllers.registerAvatar?.(this.avatarManager.currentRoot);
      return;
    }

    try {
      await this.avatarManager.setAvatarByIndex(this.currentAvatarIndex);
      if (this.avatarManager.currentRoot) {
        this.vrControllers.registerAvatar?.(this.avatarManager.currentRoot);
      }
    } catch (err) {
      console.error('[VRChatIntegration] syncAvatarFromDesktop failed:', err);
      this.vrChatPanel.appendMessage?.('bot', 'Failed to load avatar.');
    }
  }

  /**
   * Enable VR Chat UI. Does NOT spawn duplicates.
   */
  async enable() {
    if (!this.isInitialized) {
      console.warn('[VRChatIntegration] Cannot enable - not initialized');
      return;
    }

    this.vrChatPanel.setVisible?.(true);

    // Always bind to existing shared avatar if present; else load once.
    await this.syncAvatarFromDesktop();

    console.log('[VRChatIntegration] Enabled');
  }

  /**
   * Disable VR Chat UI (keeps avatar loaded; desktop stays synced).
   */
  disable() {
    this.vrChatPanel.setVisible?.(false);

    if (this.speechService?.isRecognizing) {
      this.speechService.stopRecognition?.();
    }

    console.log('[VRChatIntegration] Disabled');
  }

  // ---------------------------------------------------------------------------
  // Internal wiring
  // ---------------------------------------------------------------------------

  _wireCallbacks() {
    // Shared avatar change callback (desktop + VR)
    this.avatarManager.onAvatarChanged = (avatar) => {
      const name = avatar?.name || '';
      if (name) this._safeSetLocalStorage('vr_avatar_name', name);

      // Try to keep panel index in sync if avatar includes index
      if (Number.isFinite(avatar?.index)) {
        this.currentAvatarIndex = avatar.index;
        if (typeof this.vrChatPanel.setCurrentAvatarIndex === 'function') {
          this.vrChatPanel.setCurrentAvatarIndex(this.currentAvatarIndex);
        }
      }

      this.vrChatPanel.appendMessage?.('bot', `Switched to ${name || 'avatar'}`);

      if (this.avatarManager.currentRoot) {
        this.vrControllers.registerAvatar?.(this.avatarManager.currentRoot);
      }
    };

    // UI click events from VRControllers
    this.vrControllers.setUIButtonCallback?.((name, userData) => {
      this.handleUIClick(name, userData);
    });

    // Speech recognition callbacks (optional)
    if (this.speechService?.setRecognitionCallbacks) {
      this.speechService.setRecognitionCallbacks({
        onStart: () => this.vrChatPanel.setStatus?.('listening'),
        onEnd: () => this.vrChatPanel.setStatus?.('idle'),
        onResult: (transcript) => this.handleUserMessage(transcript),
        onError: (error) => {
          console.error('[VRChatIntegration] Speech error:', error);
          this.vrChatPanel.setStatus?.('idle');
          this.vrChatPanel.appendMessage?.('bot', `Speech error: ${error}`);
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // UI Click handling
  // ---------------------------------------------------------------------------

  async handleUIClick(name, userData = {}) {
    // Main row
    if (name === 'Btn:mic') return this.handleMicButton();
    if (name === 'Btn:send') return this.handleSendButton();
    if (name === 'Btn:clear') return this.handleClearButton();
    if (name === 'Btn:settings') return this.handleSettingsButton();

    // ✅ Your requested behavior:
    if (name === 'Btn:pin') {
      const pinned = this.vrChatPanel.togglePinned?.() ?? false;
      this.vrChatPanel.appendMessage?.(
        'bot',
        pinned ? 'Panel pinned (frozen). Click pin again to move with your hand.' : 'Panel unpinned (follows hand).'
      );
      return;
    }

    // Settings screen
    if (name === 'Btn:back') return this.vrChatPanel.setMode?.('chat');
    if (name === 'Btn:stt') return this.handleSTTToggle();
    if (name === 'Btn:tts') return this.handleTTSToggle();

    // Avatar navigation (Prev/Next)
    if (name === 'Btn:avatar_prev') {
      const idx = this.vrChatPanel.prevAvatar?.();
      if (Number.isFinite(idx) && idx >= 0) {
        await this._switchAvatarByIndex(idx);
      }
      return;
    }

    if (name === 'Btn:avatar_next') {
      const idx = this.vrChatPanel.nextAvatar?.();
      if (Number.isFinite(idx) && idx >= 0) {
        await this._switchAvatarByIndex(idx);
      }
      return;
    }

    // Optional quick prompts if you add chips later
    if (name?.startsWith('Chip:')) {
      const prompt = userData?.label;
      return this.handleQuickPrompt(prompt);
    }
  }

  async _switchAvatarByIndex(idx) {
    const n = this.avatarManager?.avatars?.length ?? this.vrChatPanel?.avatars?.length ?? 0;
    const safeIdx = Number.isFinite(idx) ? Math.max(0, idx | 0) : -1;
    if (safeIdx < 0) return;

    try {
      this.vrChatPanel.setStatus?.('thinking');
      await this.avatarManager.setAvatarByIndex(safeIdx);
      this.currentAvatarIndex = safeIdx;

      // Save by name if possible
      const name = this.avatarManager?.avatars?.[safeIdx]?.name || this.vrChatPanel?.avatars?.[safeIdx]?.name;
      if (name) this._safeSetLocalStorage('vr_avatar_name', name);

      this.vrChatPanel.setStatus?.('idle');

      if (this.avatarManager.currentRoot) {
        this.vrControllers.registerAvatar?.(this.avatarManager.currentRoot);
      }
    } catch (err) {
      console.error('[VRChatIntegration] Avatar switch failed:', err);
      this.vrChatPanel.setStatus?.('idle');
      this.vrChatPanel.appendMessage?.('bot', 'Failed to switch avatar');
    }
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  handleMicButton() {
    if (!this.speechService || !this.speechService.isRecognitionAvailable?.()) {
      this.vrChatPanel.appendMessage?.('bot', 'Speech recognition not available in your browser.');
      return;
    }

    if (!this.vrChatPanel.sttEnabled) {
      this.vrChatPanel.appendMessage?.('bot', 'Speech recognition is disabled. Enable it in Settings.');
      return;
    }

    if (this.speechService.isRecognizing) {
      this.speechService.stopRecognition?.();
      return;
    }

    this.speechService.startRecognition?.({
      onStart: () => this.vrChatPanel.setStatus?.('listening'),
      onEnd: () => this.vrChatPanel.setStatus?.('idle'),
      onResult: (text) => this.handleUserMessage(text),
      onError: (err) => {
        this.vrChatPanel.setStatus?.('idle');
        this.vrChatPanel.appendMessage?.('bot', `Error: ${err}`);
      },
    });
  }

  handleSendButton() {
    this.vrChatPanel.appendMessage?.('bot', 'Voice input recommended. Tap microphone to speak.');
  }

  handleClearButton() {
    this.vrChatPanel.clearMessages?.();
    this.chatManager?.clearMessages?.();
  }

  handleSettingsButton() {
    const newMode = this.vrChatPanel.mode === 'settings' ? 'chat' : 'settings';
    this.vrChatPanel.setMode?.(newMode);
  }

  handleSTTToggle() {
    const next = !this.vrChatPanel.sttEnabled;
    this.vrChatPanel.setSTTEnabled?.(next);
  }

  handleTTSToggle() {
    const next = !this.vrChatPanel.ttsEnabled;
    this.vrChatPanel.setTTSEnabled?.(next);
  }

  handleQuickPrompt(prompt) {
    if (prompt) this.handleUserMessage(prompt);
  }

  // ---------------------------------------------------------------------------
  // Chat pipeline
  // ---------------------------------------------------------------------------

  handleUserMessage(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;

    this.vrChatPanel.appendMessage?.('user', cleaned);
    this.chatManager?.addMessage?.(cleaned, 'user');

    this.processUserMessage(cleaned);
  }

  async processUserMessage(text) {
    this.vrChatPanel.setStatus?.('thinking');

    try {
      if (typeof window.sendMessage === 'function') {
        await window.sendMessage(text);
        // IMPORTANT:
        // If your sendMessage pipeline does not call window.VR_CHAT_HANDLE_BOT,
        // you can manually call handleBotResponse() from wherever you receive the AI reply.
      } else {
        this.handleBotResponse(`You said: "${text}". AI integration needed.`);
      }
    } catch (err) {
      console.error('[VRChatIntegration] AI processing error:', err);
      this.handleBotResponse('Sorry, I encountered an error processing your message.');
    }
  }

  handleBotResponse(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
      this.vrChatPanel.setStatus?.('idle');
      return;
    }

    this.vrChatPanel.appendMessage?.('bot', cleaned);
    this.chatManager?.addMessage?.(cleaned, 'bot');

    if (this.vrChatPanel.ttsEnabled && this.speechService?.isSynthesisAvailable?.()) {
      this.vrChatPanel.setStatus?.('speaking');
      this.speechService.speak?.(cleaned, {
        onStart: () => this.vrChatPanel.setStatus?.('speaking'),
        onEnd: () => this.vrChatPanel.setStatus?.('idle'),
        onError: () => this.vrChatPanel.setStatus?.('idle'),
      });
    } else {
      this.vrChatPanel.setStatus?.('idle');
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    try {
      if (this.speechService) {
        this.speechService.stopRecognition?.();
        this.speechService.stopSpeaking?.();
      }
    } catch (_) {}

    // Do NOT dispose avatarManager here (shared with desktop)
    this.vrChatPanel?.dispose?.();

    // Remove global hook if it points to us
    if (window.VR_CHAT_HANDLE_BOT === this._boundHandleBot) {
      try {
        delete window.VR_CHAT_HANDLE_BOT;
      } catch (_) {
        window.VR_CHAT_HANDLE_BOT = undefined;
      }
    }

    console.log('[VRChatIntegration] Disposed');
  }

  // ---------------------------------------------------------------------------
  // LocalStorage helpers (safe)
  // ---------------------------------------------------------------------------

  _safeGetLocalStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  _safeSetLocalStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }
}

// Optional global exposure (keep if you rely on it)
window.VRChatIntegration = VRChatIntegration;
