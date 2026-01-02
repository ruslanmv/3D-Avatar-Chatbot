// Adapter implementation that reuses the existing /js folder modules:
// - AppConfig (config.js)
// - OpenAIService (openai-service.js)
// - SpeechService (speech-service.js)
//
// This adapter emits events the UI can listen to:
// - state: { value: 'idle'|'listening'|'thinking'|'speaking'|'error' }
// - message: { role: 'user'|'assistant'|'system', text: string, ts: number }
// - toast: { text: string }
// - error: { text: string }

(function () {
  class JsFolderAdapter {
    constructor() {
      this.emit = () => {};
      this.speech = null;
      this.isListening = false;
    }

    async init({ emit }) {
      this.emit = emit;

      // Initialize OpenAI conversation with current personality
      const personality = AppConfig.getCurrentPersonality();
      OpenAIService.initialize(personality);

      // Speech singleton (optional)
      this.speech = window.SpeechService || null;

      this._setState('idle');
      this.emit('toast', { text: AppConfig.isConfigured() ? 'connected' : 'add api key in settings' });

      // UI-only welcome
      this.emit('message', {
        role: 'assistant',
        text: 'Wake up, Neo. Open settings, paste your API key, then transmit.',
        ts: Date.now(),
      });
    }

    getPersonalities() {
      return AppConfig.personalities;
    }

    setPersonality(id) {
      AppConfig.savePersonality(id);
      const p = AppConfig.getCurrentPersonality();
      OpenAIService.changePersonality(p);
      this._toast(`persona: ${p.name}`);
    }

    clearHistory() {
      OpenAIService.clearHistory();
      this._toast('cleared');
      this.emit('message', { role: 'assistant', text: 'Context cleared.', ts: Date.now() });
    }

    getSettings() {
      return {
        apiKey: AppConfig.openai.apiKey,
        model: AppConfig.openai.model,
        autoSpeak: AppConfig.speech.autoSpeak,
      };
    }

    saveSettings({ apiKey, model, autoSpeak }) {
      if (typeof apiKey === 'string') AppConfig.saveApiKey(apiKey.trim());
      if (typeof model === 'string' && model.trim()) AppConfig.saveModel(model.trim());
      if (typeof autoSpeak === 'boolean') AppConfig.saveSpeechSettings({ autoSpeak });

      OpenAIService.changePersonality(AppConfig.getCurrentPersonality());
      this._toast(AppConfig.isConfigured() ? 'settings saved' : 'settings saved (api key invalid?)');
    }

    async sendMessage(text) {
      const msg = (text || '').trim();
      if (!msg) return;

      this.emit('message', { role: 'user', text: msg, ts: Date.now() });

      try {
        this._setState('thinking');
        const reply = await OpenAIService.sendMessage(msg);
        this.emit('message', { role: 'assistant', text: reply, ts: Date.now() });

        if (AppConfig.speech.autoSpeak && this.speech && this.speech.isSynthesisAvailable()) {
          this.speech.speak(reply, {
            onStart: () => this._setState('speaking'),
            onEnd: () => this._setState('idle'),
            onError: () => this._setState('idle'),
          });
        } else {
          this._setState('idle');
        }
        return reply;
      } catch (e) {
        const text = e?.message || 'Request failed';
        this._setState('error');
        this.emit('error', { text });
        this.emit('message', { role: 'assistant', text: `ERROR: ${text}`, ts: Date.now() });
        this._setState('idle');
        throw e;
      }
    }

    startVoice() {
      if (!this.speech || !this.speech.isRecognitionAvailable()) {
        this._toast('speech recognition not supported');
        return;
      }
      if (this.isListening) return;
      this.isListening = true;

      this.speech.startRecognition({
        onStart: () => this._setState('listening'),
        onEnd: () => {
          this.isListening = false;
          this._setState('idle');
        },
        onError: (errMsg) => {
          this.isListening = false;
          this._toast(errMsg || 'Speech error');
          this._setState('idle');
        },
        onResult: async (transcript) => {
          if (!transcript) return;
          this._toast('voice captured');
          await this.sendMessage(transcript);
        },
      });
    }

    stopVoice() {
      if (!this.speech || !this.isListening) return;
      this.isListening = false;
      this.speech.stopRecognition();
      this._setState('idle');
    }

    _setState(value) {
      this.emit('state', { value });
    }

    _toast(text) {
      this.emit('toast', { text: String(text || '') });
    }
  }

  window.JsFolderAdapter = JsFolderAdapter;
})();
