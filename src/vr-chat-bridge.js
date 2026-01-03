/**
 * VR Chat Bridge
 * Synchronizes desktop chat and VR chat systems
 * Ensures messages appear in both interfaces
 */

(function () {
    'use strict';

    // Hook into bot responses
    function setupBotResponseHook() {
        // Store original addMessage if it exists
        const originalAddMessage = window.ChatManager?.addMessage;

        if (originalAddMessage && window.ChatManager) {
            // Override addMessage to also send to VR panel
            window.ChatManager.addMessage = function (content, sender = 'user', save = true) {
                // Call original
                const result = originalAddMessage.call(this, content, sender, save);

                // Also send to VR panel if in VR session
                try {
                    const engine = window.viewerEngine || window.engine;
                    if (engine && engine.vrChatIntegration && engine.renderer?.xr?.isPresenting) {
                        if (sender === 'bot') {
                            // Don't re-add bot messages (VRChatIntegration handles this)
                            // But update status
                            engine.vrChatPanel?.setStatus('idle');
                        } else if (sender === 'user') {
                            // Sync user messages from desktop to VR
                            engine.vrChatPanel?.appendMessage('user', content);
                        }
                    }
                } catch (e) {
                    console.warn('[VRChatBridge] Failed to sync to VR:', e);
                }

                return result;
            };

            console.log('[VRChatBridge] ✅ Bot response hook installed');
        }
    }

    // Setup global bot response handler for VR
    window.sendBotResponseToVR = function (text) {
        try {
            const engine = window.viewerEngine || window.engine;
            if (engine && engine.vrChatIntegration) {
                engine.vrChatIntegration.handleBotResponse(text);
            }
        } catch (e) {
            console.error('[VRChatBridge] Failed to send bot response to VR:', e);
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupBotResponseHook);
    } else {
        setupBotResponseHook();
    }

    // Also try again after a short delay (in case ChatManager loads later)
    setTimeout(setupBotResponseHook, 1000);

    console.log('[VRChatBridge] Loaded');
})();
