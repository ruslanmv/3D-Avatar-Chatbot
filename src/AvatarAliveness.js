/**
 * AvatarAliveness — Phase 3 Bootstrap
 *
 * Wires EmotionEngine, LipSyncEngine, and BehaviorEngine together.
 * Hooks BehaviorEngine.update() into the existing render loop by wrapping
 * NEXUS_PROCEDURAL_ANIMATOR.update() — purely additive, no file modifications.
 *
 * Detects chat events via MutationObserver on #chat-history.
 * Detects mic events via listen-btn class changes.
 * Detects speech via BehaviorEngine's internal speechSynthesis polling.
 *
 * Load order (all via <script defer>):
 *   1. EmotionEngine.js
 *   2. LipSyncEngine.js
 *   3. BehaviorEngine.js
 *   4. AvatarAliveness.js  ← this file
 */
(function (global) {
    'use strict';

    // Wait until the viewer engine and procedural animator are ready
    let _checkInterval = null;
    let _attempts = 0;
    const MAX_ATTEMPTS = 60; // 30 seconds at 500ms intervals

    _checkInterval = setInterval(function () {
        _attempts++;

        // Need at minimum: the procedural animator (render loop hook)
        // and the behavior engine (loaded before us via defer)
        const hasAnimator = !!global.NEXUS_PROCEDURAL_ANIMATOR;
        const hasBehavior = !!global.NEXUS_BEHAVIOR;
        const hasViewer = !!global.NEXUS_VIEWER;

        if (!hasBehavior || !hasAnimator) {
            if (_attempts >= MAX_ATTEMPTS) {
                clearInterval(_checkInterval);
                console.warn('[AvatarAliveness] Timed out waiting for dependencies');
            }
            return;
        }

        clearInterval(_checkInterval);
        _boot(hasViewer);
    }, 500);

    // =========================================================================
    // BOOT
    // =========================================================================

    function _boot(viewerReady) {
        console.log('[AvatarAliveness] Booting Phase 3 engines...');

        // 1. Hook into the animation loop
        _hookRenderLoop();

        // 2. Observe chat for user/bot messages
        _observeChat();

        // 3. Observe mic button for listening state
        _observeMic();

        // 4. Listen for AR/VR session events
        _listenXREvents();

        console.log('[AvatarAliveness] Phase 3 active — avatar is alive');
    }

    // =========================================================================
    // RENDER LOOP HOOK
    // =========================================================================

    function _hookRenderLoop() {
        const animator = global.NEXUS_PROCEDURAL_ANIMATOR;
        if (!animator || !animator.update) {
            console.warn('[AvatarAliveness] No NEXUS_PROCEDURAL_ANIMATOR.update to hook');
            return;
        }

        // Wrap the existing update function
        const originalUpdate = animator.update;

        animator.update = function (t, dt) {
            // Run the original procedural animator first
            originalUpdate(t, dt);

            // Then run the behavior engine
            if (global.NEXUS_BEHAVIOR) {
                try {
                    global.NEXUS_BEHAVIOR.update(dt, t);
                } catch (e) {
                    console.warn('[AvatarAliveness] BehaviorEngine update error:', e);
                }
            }

            // Update ClipAnimationLoader mixer (BVH/VRMA playback)
            if (global.NEXUS_CLIP_LOADER && global.NEXUS_CLIP_LOADER.update) {
                try {
                    global.NEXUS_CLIP_LOADER.update(dt || 0.016);
                } catch (e) {
                    // Silent — clip loader is optional
                }
            }
        };

        console.log('[AvatarAliveness] Hooked into render loop');
    }

    // =========================================================================
    // CHAT OBSERVER
    // =========================================================================

    function _observeChat() {
        const chatEl = document.getElementById('chat-history');
        if (!chatEl) {
            console.warn('[AvatarAliveness] #chat-history not found — retrying in 2s');
            setTimeout(_observeChat, 2000);
            return;
        }

        const observer = new MutationObserver(function (mutations) {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!node.classList || !node.classList.contains('chat-row')) continue;

                    const msg = node.querySelector('.chat-message');
                    if (!msg) continue;

                    const textEl = msg.querySelector('.message-text');
                    const text = textEl ? textEl.textContent : '';

                    if (msg.classList.contains('user')) {
                        // User sent a message
                        if (global.NEXUS_BEHAVIOR) {
                            global.NEXUS_BEHAVIOR.onUserMessage(text);
                        }
                    } else {
                        // Bot responded
                        if (global.NEXUS_BEHAVIOR) {
                            // Try to extract HomePilot directives from the last response
                            const directives = _getLastDirectives();
                            global.NEXUS_BEHAVIOR.onBotResponse(text, directives);
                        }
                    }
                }
            }
        });

        observer.observe(chatEl, { childList: true });
        console.log('[AvatarAliveness] Chat observer active');
    }

    /**
     * Attempt to get the latest HomePilot avatar directives.
     * These are stored by VRChatIntegration or BridgeResponseAdapter
     * when an OllaBridge response comes in.
     */
    function _getLastDirectives() {
        try {
            // Check if PersonaContextBridge has directives
            if (typeof global.PersonaContextBridge !== 'undefined') {
                const ctx = global.PersonaContextBridge.getContext?.();
                if (ctx && ctx.avatar_directives) {
                    return ctx.avatar_directives;
                }
            }
        } catch (_) {}
        return null;
    }

    // =========================================================================
    // MIC OBSERVER
    // =========================================================================

    function _observeMic() {
        const listenBtn = document.getElementById('listen-btn');
        if (!listenBtn) {
            // Retry — button may not exist yet
            setTimeout(_observeMic, 2000);
            return;
        }

        // Watch for the 'active' class toggle (set by main.js voice system)
        const observer = new MutationObserver(function (mutations) {
            for (const mutation of mutations) {
                if (mutation.attributeName !== 'class') continue;

                const isActive = listenBtn.classList.contains('active');
                if (isActive) {
                    global.NEXUS_BEHAVIOR?.onListeningStart?.();
                } else {
                    global.NEXUS_BEHAVIOR?.onListeningEnd?.();
                }
            }
        });

        observer.observe(listenBtn, { attributes: true, attributeFilter: ['class'] });
        console.log('[AvatarAliveness] Mic observer active');
    }

    // =========================================================================
    // XR SESSION EVENTS
    // =========================================================================

    function _listenXREvents() {
        // Pause micro-idle behavior during XR sessions
        // (VR has its own panel, AR has its own overlay)
        global.addEventListener('ar-session-start', function () {
            // Keep behavior running but lock to IDLE (no micro-idle drift)
            if (global.NEXUS_BEHAVIOR) {
                global.NEXUS_BEHAVIOR.setState(global.NEXUS_BEHAVIOR.State.IDLE);
            }
        });

        global.addEventListener('vr-session-start', function () {
            if (global.NEXUS_BEHAVIOR) {
                global.NEXUS_BEHAVIOR.setState(global.NEXUS_BEHAVIOR.State.IDLE);
            }
        });
    }
})(window);
