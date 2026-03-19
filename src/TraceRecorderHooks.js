/**
 * TraceRecorderHooks — Non-destructive event listeners that feed TraceRecorder.
 *
 * Wires into the existing NEXUS_* singletons via read-only observation:
 *   - BehaviorEngine state changes (polling)
 *   - Expression/emotion changes (polling VRM expressionManager)
 *   - Blink events (polling blink expression weight)
 *   - Viseme values during lip-sync (polling current viseme weights)
 *   - ProceduralAnimator mode, pose, talk-style, speed (polling)
 *   - Mouse/touch gaze (throttled sampling)
 *   - Chat DOM mutations (MutationObserver)
 *   - Mic button state (MutationObserver)
 *   - XR session custom events (addEventListener)
 *
 * ADDITIVE-ONLY: This file creates its own observers and does not patch
 * any existing module. Safe to load/unload independently.
 *
 * @module TraceRecorderHooks
 */
(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────

    /** Gaze sampling interval (ms). 250ms = 4 Hz, enough for analytics. */
    const GAZE_SAMPLE_MS = 250;

    /** State/mode polling interval (ms). */
    const POLL_INTERVAL_MS = 200;

    /** Expression/viseme sampling interval (ms). 100ms = 10 Hz for smooth replay. */
    const EXPRESSION_SAMPLE_MS = 100;

    /** Blink detection threshold (expression weight above this = blink). */
    const BLINK_THRESHOLD = 0.5;

    /** Expression change threshold (delta below this is noise). */
    const EXPRESSION_EPSILON = 0.05;

    // ── Tracked expressions for VRM models ──────────────────────────────

    const TRACKED_EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
    const TRACKED_VISEMES = ['aa', 'ee', 'oh'];
    const TRACKED_GAZE_EXPR = ['lookLeft', 'lookRight', 'lookUp', 'lookDown'];

    // ── State ───────────────────────────────────────────────────────────

    let _initialized = false;
    let _pollTimer = null;
    let _expressionTimer = null;
    let _gazeSampleTimer = null;
    let _chatObserver = null;
    let _micObserver = null;

    // Track last-seen values for change detection
    let _lastBehaviorState = null;
    let _lastAnimatorMode = null;
    let _lastLipSyncActive = false;
    let _lastBasePose = null;
    let _lastTalkStyle = null;
    let _lastSpeed = null;

    // Expression snapshots (name → weight)
    let _lastEmotionSnapshot = {};
    let _lastVisemeSnapshot = {};
    let _lastBlinkState = false;
    let _lastDominantEmotion = null;

    // ── Helpers ─────────────────────────────────────────────────────────

    function _recorder() {
        return typeof window !== 'undefined' && window.NEXUS_TRACE_RECORDER;
    }

    function _behavior() {
        return typeof window !== 'undefined' && window.NEXUS_BEHAVIOR;
    }

    function _animator() {
        return typeof window !== 'undefined' && window.NEXUS_PROCEDURAL_ANIMATOR;
    }

    function _lipSync() {
        return typeof window !== 'undefined' && window.NEXUS_LIP_SYNC;
    }

    /**
     * Get the VRM expressionManager from whichever path is available.
     * Non-destructive read — never writes.
     */
    function _getExpressionManager() {
        // Path 1: ViewerEngine → AvatarManager → vrmLoader
        const viewer = typeof window !== 'undefined' && window.NEXUS_VIEWER;
        if (viewer?.avatarManager?.vrmLoader?.currentVRM?.expressionManager) {
            return viewer.avatarManager.vrmLoader.currentVRM.expressionManager;
        }
        // Path 2: Legacy global vrmLoader
        const legacy = typeof window !== 'undefined' && window.vrmLoader;
        if (legacy?.currentVRM?.expressionManager) {
            return legacy.currentVRM.expressionManager;
        }
        return null;
    }

    // ── Polling: State + Mode + Pose + Style + Speed ────────────────────

    function _pollStateChanges() {
        const recorder = _recorder();
        if (!recorder || !recorder.isRecording) return;

        const TK = recorder.TraceKind;

        // 1. BehaviorEngine state transitions
        const beh = _behavior();
        if (beh && beh.getState) {
            const state = beh.getState();
            if (state !== _lastBehaviorState) {
                recorder.record(TK.STATE, 'behavior.transition', {
                    from: _lastBehaviorState,
                    to: state,
                });
                _lastBehaviorState = state;
            }
        }

        // 2. ProceduralAnimator mode changes
        const anim = _animator();
        if (anim) {
            // Mode
            if (anim.getMode) {
                const mode = anim.getMode();
                if (mode !== _lastAnimatorMode) {
                    recorder.record(TK.GESTURE, 'animator.mode_change', {
                        from: _lastAnimatorMode,
                        to: mode,
                    });
                    _lastAnimatorMode = mode;
                }
            }

            // Base pose (read from internal state if exposed)
            if (anim.getBasePose) {
                const pose = anim.getBasePose();
                if (pose !== _lastBasePose) {
                    recorder.record(TK.GESTURE, 'animator.pose_change', {
                        from: _lastBasePose,
                        to: pose,
                    });
                    _lastBasePose = pose;
                }
            }

            // Talk style
            if (anim.getTalkStyle) {
                const style = anim.getTalkStyle();
                if (style !== _lastTalkStyle) {
                    recorder.record(TK.GESTURE, 'animator.talk_style_change', {
                        from: _lastTalkStyle,
                        to: style,
                    });
                    _lastTalkStyle = style;
                }
            }

            // Speed multiplier
            if (anim.getSpeed) {
                const speed = anim.getSpeed();
                if (speed !== _lastSpeed) {
                    recorder.record(TK.GESTURE, 'animator.speed_change', {
                        from: _lastSpeed,
                        to: speed,
                    });
                    _lastSpeed = speed;
                }
            }
        }

        // 3. LipSync activity transitions
        const lip = _lipSync();
        if (lip) {
            const active = !!lip.isActive;
            if (active !== _lastLipSyncActive) {
                recorder.record(TK.LIP_SYNC, active ? 'lip_sync.started' : 'lip_sync.stopped', {
                    active,
                });
                _lastLipSyncActive = active;
            }
        }
    }

    // ── Expression + Viseme + Blink Sampling ────────────────────────────

    function _sampleExpressions() {
        const recorder = _recorder();
        if (!recorder || !recorder.isRecording) return;

        const em = _getExpressionManager();
        if (!em) return;

        const TK = recorder.TraceKind;

        // ── Emotions (change-detected, not every sample) ──────────────
        let dominantEmotion = null;
        let dominantWeight = 0;
        const emotionSnapshot = {};

        for (const name of TRACKED_EMOTIONS) {
            try {
                const w = em.getValue(name);
                if (typeof w === 'number' && w > EXPRESSION_EPSILON) {
                    emotionSnapshot[name] = Math.round(w * 1000) / 1000;
                    if (w > dominantWeight) {
                        dominantWeight = w;
                        dominantEmotion = name;
                    }
                }
            } catch (_) {
                /* expression may not exist on this model */
            }
        }

        // Record only when dominant emotion changes
        if (dominantEmotion !== _lastDominantEmotion) {
            recorder.record(TK.EXPRESSION, 'expression.emotion_change', {
                from: _lastDominantEmotion,
                to: dominantEmotion,
                weights: emotionSnapshot,
            });
            _lastDominantEmotion = dominantEmotion;
        }
        _lastEmotionSnapshot = emotionSnapshot;

        // ── Visemes (sample during active lip-sync only) ──────────────
        const lip = _lipSync();
        if (lip && lip.isActive) {
            const visemeSnapshot = {};
            let anyViseme = false;

            for (const v of TRACKED_VISEMES) {
                try {
                    const w = em.getValue(v);
                    if (typeof w === 'number' && w > EXPRESSION_EPSILON) {
                        visemeSnapshot[v] = Math.round(w * 1000) / 1000;
                        anyViseme = true;
                    }
                } catch (_) {}
            }

            if (anyViseme) {
                // Only record when viseme values actually change
                const changed = TRACKED_VISEMES.some(
                    (v) => Math.abs((visemeSnapshot[v] || 0) - (_lastVisemeSnapshot[v] || 0)) > EXPRESSION_EPSILON
                );
                if (changed) {
                    recorder.record(TK.LIP_SYNC, 'lip_sync.viseme_sample', visemeSnapshot);
                    _lastVisemeSnapshot = visemeSnapshot;
                }
            }
        }

        // ── Blink detection ───────────────────────────────────────────
        try {
            const blinkW = em.getValue('blink');
            const isBlinking = typeof blinkW === 'number' && blinkW > BLINK_THRESHOLD;
            if (isBlinking && !_lastBlinkState) {
                recorder.record(TK.EXPRESSION, 'expression.blink', {
                    weight: Math.round(blinkW * 1000) / 1000,
                });
            }
            _lastBlinkState = isBlinking;
        } catch (_) {
            // Try individual eye blinks (some models use blinkLeft/blinkRight)
            try {
                const bL = em.getValue('blinkLeft') || 0;
                const bR = em.getValue('blinkRight') || 0;
                const isBlinking = (bL + bR) / 2 > BLINK_THRESHOLD;
                if (isBlinking && !_lastBlinkState) {
                    recorder.record(TK.EXPRESSION, 'expression.blink', {
                        left: Math.round(bL * 1000) / 1000,
                        right: Math.round(bR * 1000) / 1000,
                    });
                }
                _lastBlinkState = isBlinking;
            } catch (_) {}
        }
    }

    // ── Gaze Sampling ──────────────────────────────────────────────────

    function _sampleGaze() {
        const recorder = _recorder();
        if (!recorder || !recorder.isRecording) return;

        const TK = recorder.TraceKind;

        // Source 1: ProceduralAnimator mouse/touch gaze input
        const anim = _animator();
        if (anim && anim.getGaze) {
            const gaze = anim.getGaze();
            if (gaze) {
                recorder.record(TK.GAZE, 'gaze.input_sample', {
                    x: Math.round(gaze.x * 1000) / 1000,
                    y: Math.round(gaze.y * 1000) / 1000,
                    source: gaze.source || 'mouse',
                });
            }
        }

        // Source 2: VRM expression-based gaze (lookLeft/Right/Up/Down weights)
        const em = _getExpressionManager();
        if (em) {
            const gazeWeights = {};
            let anyGaze = false;
            for (const name of TRACKED_GAZE_EXPR) {
                try {
                    const w = em.getValue(name);
                    if (typeof w === 'number' && w > EXPRESSION_EPSILON) {
                        gazeWeights[name] = Math.round(w * 1000) / 1000;
                        anyGaze = true;
                    }
                } catch (_) {}
            }
            if (anyGaze) {
                recorder.record(TK.GAZE, 'gaze.expression_sample', gazeWeights);
            }
        }
    }

    // ── DOM Observers (parallel to AvatarAliveness, read-only) ─────────

    function _observeChat() {
        const recorder = _recorder();
        if (!recorder) return;

        const chatEl = document.getElementById('chat-history');
        if (!chatEl) return;

        _chatObserver = new MutationObserver((mutations) => {
            if (!recorder.isRecording) return;
            const TK = recorder.TraceKind;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!node.classList || !node.classList.contains('chat-row')) continue;

                    const isUser = node.classList.contains('user-row');
                    const textEl = node.querySelector('.chat-text, .chat-message');
                    const text = textEl ? textEl.textContent.trim() : '';

                    if (isUser) {
                        recorder.record(TK.USER_INPUT, 'chat.user_message', {
                            text_length: text.length,
                            text_preview: text.substring(0, 120),
                        });
                    } else {
                        recorder.record(TK.BOT_OUTPUT, 'chat.bot_response', {
                            text_length: text.length,
                            text_preview: text.substring(0, 120),
                        });
                    }
                }
            }
        });

        _chatObserver.observe(chatEl, { childList: true, subtree: true });
    }

    function _observeMic() {
        const recorder = _recorder();
        if (!recorder) return;

        const micBtn = document.getElementById('listen-btn');
        if (!micBtn) return;

        _micObserver = new MutationObserver(() => {
            if (!recorder.isRecording) return;
            const active = micBtn.classList.contains('active');
            recorder.record(recorder.TraceKind.USER_INPUT, active ? 'mic.activated' : 'mic.deactivated', { active });
        });

        _micObserver.observe(micBtn, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Custom Window Events ───────────────────────────────────────────

    function _observeXREvents() {
        const recorder = _recorder();
        if (!recorder) return;

        const xrEvents = ['vr-session-start', 'vr-session-end', 'ar-session-start', 'ar-session-end'];

        for (const eventName of xrEvents) {
            const handler = () => {
                if (!recorder.isRecording) return;
                recorder.record(recorder.TraceKind.XR_SESSION, 'xr.' + eventName.replace(/-/g, '_'), {
                    event: eventName,
                });
            };
            window.addEventListener(eventName, handler);
        }
    }

    // ── Init / Teardown ─────────────────────────────────────────────────

    function init() {
        if (_initialized) return;
        _initialized = true;

        // State + mode + pose polling (200ms)
        _pollTimer = setInterval(_pollStateChanges, POLL_INTERVAL_MS);

        // Expression + viseme + blink sampling (100ms — 10 Hz)
        _expressionTimer = setInterval(_sampleExpressions, EXPRESSION_SAMPLE_MS);

        // Gaze input sampling (250ms — 4 Hz)
        _gazeSampleTimer = setInterval(_sampleGaze, GAZE_SAMPLE_MS);

        // Observe DOM
        const _tryObserve = () => {
            _observeChat();
            _observeMic();
        };

        if (document.readyState === 'complete') {
            _tryObserve();
        } else {
            window.addEventListener('load', _tryObserve, { once: true });
        }

        // XR events
        _observeXREvents();

        console.log('[TraceRecorderHooks] Initialized — full VRM observation active');
    }

    function teardown() {
        if (!_initialized) return;
        _initialized = false;

        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
        if (_expressionTimer) {
            clearInterval(_expressionTimer);
            _expressionTimer = null;
        }
        if (_gazeSampleTimer) {
            clearInterval(_gazeSampleTimer);
            _gazeSampleTimer = null;
        }
        if (_chatObserver) {
            _chatObserver.disconnect();
            _chatObserver = null;
        }
        if (_micObserver) {
            _micObserver.disconnect();
            _micObserver = null;
        }

        console.log('[TraceRecorderHooks] Torn down');
    }

    // ── Auto-init when recorder is available ────────────────────────────

    function _waitForRecorder() {
        if (_recorder()) {
            init();
            return;
        }
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            if (_recorder()) {
                clearInterval(check);
                init();
            } else if (attempts > 50) {
                clearInterval(check);
                console.warn('[TraceRecorderHooks] NEXUS_TRACE_RECORDER not found after 10s, giving up');
            }
        }, 200);
    }

    _waitForRecorder();

    // ── Expose for manual control ───────────────────────────────────────

    if (typeof window !== 'undefined') {
        window.NEXUS_TRACE_HOOKS = { init, teardown };
    }
})();
