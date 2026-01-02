// Minimal evented controller interface for the UI.
// The UI talks ONLY to this controller. The controller delegates to an adapter implementation.
//
// Usage:
//   const controller = new MatrixController(new JsFolderAdapter());
//   controller.on('message', (msg) => ...)
//   await controller.sendMessage("hi")

(function () {
    class MatrixController {
        constructor(adapter) {
            this.adapter = adapter;
            this.handlers = new Map();
        }

        on(eventName, handler) {
            if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
            this.handlers.get(eventName).add(handler);
            return () => this.handlers.get(eventName).delete(handler);
        }

        emit(eventName, payload) {
            const set = this.handlers.get(eventName);
            if (!set) return;
            for (const fn of set) {
                try {
                    fn(payload);
                } catch (e) {
                    console.error(e);
                }
            }
        }

        async init() {
            await this.adapter.init({
                emit: (name, payload) => this.emit(name, payload),
            });
        }

        async sendMessage(text) {
            return await this.adapter.sendMessage(text);
        }

        startVoice() {
            return this.adapter.startVoice();
        }

        stopVoice() {
            return this.adapter.stopVoice();
        }

        setPersonality(id) {
            return this.adapter.setPersonality(id);
        }

        clearHistory() {
            return this.adapter.clearHistory();
        }

        saveSettings({ apiKey, model, autoSpeak }) {
            return this.adapter.saveSettings({ apiKey, model, autoSpeak });
        }

        getSettings() {
            return this.adapter.getSettings();
        }

        getPersonalities() {
            return this.adapter.getPersonalities();
        }
    }

    window.MatrixController = MatrixController;
})();
