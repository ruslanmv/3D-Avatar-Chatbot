/**
 * BehaviorEngine — Phase 3 Avatar Aliveness
 *
 * State machine that coordinates all avatar behaviors into a coherent
 * "alive" experience. Single source of truth for what the avatar should
 * be doing at any given moment.
 *
 * States:
 *   IDLE       → default resting state (breathing, blinking, looking at user)
 *   LISTENING  → user mic is active (attentive, slight nod)
 *   THINKING   → waiting for LLM response (gaze drift, head tilt)
 *   SPEAKING   → TTS is playing (lip-sync, emotion, eye contact)
 *   MICRO_IDLE → prolonged idle (micro-expressions, gaze wander)
 *
 * Non-destructive: calls only existing APIs on window.NEXUS_* globals.
 * Detects events by observing DOM (MutationObserver) and polling
 * speechSynthesis.speaking — never modifies existing files.
 *
 * Exposed as window.NEXUS_BEHAVIOR
 */
(function (global) {
    'use strict';

    // =========================================================================
    // CONSTANTS
    // =========================================================================
    const State = {
        IDLE: 'IDLE',
        LISTENING: 'LISTENING',
        THINKING: 'THINKING',
        SPEAKING: 'SPEAKING',
        MICRO_IDLE: 'MICRO_IDLE',
    };

    const MICRO_IDLE_TIMEOUT = 12; // seconds of idle before micro-idle kicks in

    // =========================================================================
    // BEHAVIOR ENGINE
    // =========================================================================

    const engine = {
        state: State.IDLE,
        stateTime: 0, // seconds spent in current state
        totalTime: 0, // total elapsed seconds (from animation loop)

        // Gaze
        gazeYaw: 0, // current gaze yaw (-1 left .. +1 right)
        gazePitch: 0, // current gaze pitch (-1 down .. +1 up)
        gazeTargetYaw: 0,
        gazeTargetPitch: 0,

        // Micro-idle
        _nextMicroExpr: 0, // countdown to next micro-expression
        _microExprActive: false,

        // Nod (listening)
        _nodPhase: 0,

        // Thinking gaze animation
        _thinkGazePhase: 0,

        // Whether we already triggered emotion for current response
        _emotionApplied: false,

        // Speech detection
        _wasSpeaking: false,

        // Initialized flag
        _initialized: false,

        // Face tracking override — when true, skip expression/gaze writes
        _expressionOverride: false,
    };

    // =========================================================================
    // STATE TRANSITIONS
    // =========================================================================

    function setState(next) {
        if (engine.state === next) return;

        const prev = engine.state;
        engine.state = next;
        engine.stateTime = 0;
        engine._emotionApplied = false;

        console.log(`[Behavior] ${prev} → ${next}`);

        _onEnterState(next, prev);
    }

    function getState() {
        return engine.state;
    }

    /**
     * Returns true when an external gaze system owns eye contact and
     * BehaviorEngine should NOT fight by locking gaze to {0,0} or
     * overwriting eye targets during state transitions.
     *
     * Two sources:
     *   1. Desktop — FaceTracker Follow mode (webcam tracks face position)
     *   2. VR     — VRGazeController with conversationalGaze enabled
     *              (GAZE: LOCK in VR settings — maintains eye contact
     *               through LISTENING/THINKING/SPEAKING states)
     *
     * The avatar still enters states normally (animations, emotions,
     * lip-sync all keep working), we only skip the gaze-locking calls.
     */
    function _isFollowGazeActive() {
        // Desktop: FaceTracker Follow mode
        const ft = global.NEXUS_FACE_TRACKER;
        if (ft && ft.isActive && ft.mode === 'follow') return true;

        // VR: VRGazeController with conversational gaze lock
        const viewer = global.NEXUS_VIEWER;
        if (
            viewer?.vrGazeController?.enabled &&
            viewer?.vrGazeController?.conversationalGaze &&
            viewer?.renderer?.xr?.isPresenting
        ) {
            return true;
        }

        return false;
    }

    /**
     * Called once when entering a new state.
     * Sets up ProceduralAnimator mode and initial gaze targets.
     */
    function _onEnterState(state, prev) {
        const animator = global.NEXUS_PROCEDURAL_ANIMATOR;

        // When Follow mode is active, FaceTracker owns gaze every frame.
        // We still set animation modes, emotions, and lip-sync, but skip
        // the gaze locks so the avatar keeps watching the user naturally
        // throughout LISTENING → THINKING → SPEAKING.
        const followActive = _isFollowGazeActive();

        switch (state) {
            case State.IDLE:
                animator?.setMode?.('idle', 1);
                if (!followActive) {
                    animator?.setGazeOverride?.(null); // release — resume pointer tracking
                    engine.gazeTargetYaw = 0;
                    engine.gazeTargetPitch = 0;
                }
                engine._nextMicroExpr = 5 + Math.random() * 4;
                _clearEmotion();
                break;

            case State.LISTENING:
                animator?.setMode?.('idle', 1);
                if (!followActive) {
                    animator?.setGazeOverride?.({ x: 0, y: 0 }); // lock head to camera
                    engine.gazeTargetYaw = 0;
                    engine.gazeTargetPitch = 0;
                }
                engine._nodPhase = 0;
                // Subtle attentive expression
                _setVRMExpression('happy', 0.12);
                break;

            case State.THINKING:
                animator?.setMode?.('thinking', 30000);
                if (!followActive) {
                    animator?.setGazeOverride?.({ x: 0, y: 0 }); // lock head to camera
                    engine._thinkGazePhase = 0;
                    // Look up-left initially
                    engine.gazeTargetYaw = -0.25;
                    engine.gazeTargetPitch = 0.2;
                }
                break;

            case State.SPEAKING:
                animator?.setMode?.('talk', 30000);
                if (!followActive) {
                    animator?.setGazeOverride?.({ x: 0, y: 0 }); // lock head to camera
                    engine.gazeTargetYaw = 0;
                    engine.gazeTargetPitch = 0;
                }
                break;

            case State.MICRO_IDLE:
                animator?.setMode?.('idle', 1);
                if (!followActive) {
                    animator?.setGazeOverride?.(null); // release — resume pointer tracking
                }
                engine._nextMicroExpr = 3 + Math.random() * 3;
                engine._microExprActive = false;
                break;
        }
    }

    // =========================================================================
    // PER-FRAME UPDATE
    // =========================================================================

    /**
     * Main update — call once per frame from the animation loop.
     *
     * @param {number} dt - Delta time in seconds
     * @param {number} t - Total elapsed time in seconds
     */
    function update(dt, t) {
        engine.totalTime = t;
        engine.stateTime += dt;

        // Auto-detect speech state (non-destructive polling)
        _detectSpeechState();

        // Run state-specific per-frame logic
        switch (engine.state) {
            case State.IDLE:
                _updateIdle(dt);
                break;
            case State.LISTENING:
                _updateListening(dt);
                break;
            case State.THINKING:
                _updateThinking(dt);
                break;
            case State.SPEAKING:
                _updateSpeaking(dt);
                break;
            case State.MICRO_IDLE:
                _updateMicroIdle(dt);
                break;
        }

        // Smooth gaze interpolation
        // Skip when:
        //   - _expressionOverride: Imitate mode controls all expressions
        //   - Follow mode active: FaceTracker sets gazeTargetYaw/Pitch + eye
        //     expressions directly each frame (eye leading ahead of head)
        if (!engine._expressionOverride && !_isFollowGazeActive()) {
            _updateGaze(dt);
        }

        // Update LipSyncEngine if available
        if (global.NEXUS_LIP_SYNC) {
            const vrmLoader = _getVRMLoader();
            if (vrmLoader) {
                global.NEXUS_LIP_SYNC.update(dt, vrmLoader);
            }
        }
    }

    // =========================================================================
    // STATE UPDATE FUNCTIONS
    // =========================================================================

    function _updateIdle(dt) {
        // Transition to MICRO_IDLE after timeout
        if (engine.stateTime > MICRO_IDLE_TIMEOUT) {
            setState(State.MICRO_IDLE);
        }
    }

    function _updateListening(dt) {
        // In Follow mode, FaceTracker handles gaze — skip nod animation
        if (_isFollowGazeActive()) return;

        // Periodic subtle nod (attentive listening)
        engine._nodPhase += dt;
        if (engine._nodPhase > 2.5 + Math.random() * 1.5) {
            engine._nodPhase = 0;
            // Trigger a brief nod via gaze pitch
            engine.gazeTargetPitch = -0.08;
            setTimeout(() => {
                engine.gazeTargetPitch = 0;
            }, 300);
        }
    }

    function _updateThinking(dt) {
        // In Follow mode, FaceTracker handles gaze — skip thinking gaze drift
        if (_isFollowGazeActive()) return;

        // Animated gaze: look up-left, then slowly drift back to center
        engine._thinkGazePhase += dt;

        if (engine._thinkGazePhase < 1.5) {
            // Hold up-left gaze
            engine.gazeTargetYaw = -0.25;
            engine.gazeTargetPitch = 0.18;
        } else if (engine._thinkGazePhase < 3.0) {
            // Drift back to center
            const progress = (engine._thinkGazePhase - 1.5) / 1.5;
            engine.gazeTargetYaw = -0.25 * (1 - progress);
            engine.gazeTargetPitch = 0.18 * (1 - progress);
        } else {
            // Reset and loop
            engine._thinkGazePhase = 0;
        }
    }

    function _updateSpeaking(dt) {
        // Emotion is applied once when entering SPEAKING (see onBotResponse)
        // Gaze stays on camera (0, 0)
        // LipSyncEngine handles mouth animation via its own update()
    }

    function _updateMicroIdle(dt) {
        // Slow gaze wander
        if (engine.stateTime % 6 < dt) {
            engine.gazeTargetYaw = (Math.random() - 0.5) * 0.25;
            engine.gazeTargetPitch = (Math.random() - 0.5) * 0.15;
        }

        // Micro-expressions
        engine._nextMicroExpr -= dt;
        if (engine._nextMicroExpr <= 0 && !engine._microExprActive) {
            engine._microExprActive = true;
            _triggerMicroExpression();
            engine._nextMicroExpr = 5 + Math.random() * 6;
        }
    }

    // =========================================================================
    // GAZE CONTROL
    // =========================================================================

    function _updateGaze(dt) {
        // Smooth lerp toward target
        const speed = 0.06; // lower = smoother
        engine.gazeYaw += (engine.gazeTargetYaw - engine.gazeYaw) * speed;
        engine.gazePitch += (engine.gazeTargetPitch - engine.gazePitch) * speed;

        // Apply to VRM look expressions
        const vrmLoader = _getVRMLoader();
        if (!vrmLoader || !vrmLoader.currentVRM?.expressionManager) return;

        try {
            vrmLoader.setExpression('lookLeft', Math.max(0, -engine.gazeYaw));
            vrmLoader.setExpression('lookRight', Math.max(0, engine.gazeYaw));
            vrmLoader.setExpression('lookUp', Math.max(0, engine.gazePitch));
            vrmLoader.setExpression('lookDown', Math.max(0, -engine.gazePitch));
        } catch (_) {
            /* gaze expressions may not exist on this model */
        }
    }

    // =========================================================================
    // MICRO-EXPRESSIONS
    // =========================================================================

    function _triggerMicroExpression() {
        const vrmLoader = _getVRMLoader();
        if (!vrmLoader || !vrmLoader.currentVRM?.expressionManager) {
            engine._microExprActive = false;
            return;
        }

        // Pick a random micro-expression (from centralized presets)
        const micros =
            _AP && _AP.MICRO_EXPRESSIONS
                ? _AP.MICRO_EXPRESSIONS
                : [
                      { expr: 'happy', value: 0.12, duration: 900 },
                      { expr: 'surprised', value: 0.08, duration: 600 },
                  ];

        const micro = micros[Math.floor(Math.random() * micros.length)];

        try {
            vrmLoader.setExpression(micro.expr, micro.value);
        } catch (_) {}

        setTimeout(() => {
            try {
                vrmLoader.setExpression(micro.expr, 0);
            } catch (_) {}
            engine._microExprActive = false;
        }, micro.duration);
    }

    // =========================================================================
    // SPEECH STATE DETECTION (non-destructive polling)
    // =========================================================================

    function _detectSpeechState() {
        const isSpeaking = typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking;

        if (isSpeaking && !engine._wasSpeaking) {
            // Speech just started
            engine._wasSpeaking = true;
            if (engine.state !== State.SPEAKING) {
                setState(State.SPEAKING);
            }
        } else if (!isSpeaking && engine._wasSpeaking) {
            // Speech just ended
            engine._wasSpeaking = false;
            if (engine.state === State.SPEAKING) {
                // LipSync cleanup
                if (global.NEXUS_LIP_SYNC) {
                    global.NEXUS_LIP_SYNC.stop();
                }
                setState(State.IDLE);
            }
        }
    }

    // =========================================================================
    // EVENT HANDLERS (called externally by AvatarAliveness bootstrap)
    // =========================================================================

    /**
     * User sent a message — transition to THINKING.
     * @param {string} text - The user's message text
     */
    function onUserMessage(text) {
        // If we're listening, the user finished speaking → now thinking
        // If we're idle, user typed something → thinking
        if (engine.state !== State.SPEAKING) {
            setState(State.THINKING);
        }
    }

    /**
     * Bot responded — apply emotion and prepare for speech.
     * @param {string} text - The bot's response text
     * @param {object} [directives] - Optional HomePilot avatar directives
     */
    function onBotResponse(text, directives) {
        // Analyze emotion
        if (global.NEXUS_EMOTION_ENGINE && !engine._emotionApplied) {
            engine._emotionApplied = true;
            const result = global.NEXUS_EMOTION_ENGINE.analyze(text, directives);

            // Apply VRM emotion expression
            const vrmLoader = _getVRMLoader();
            if (vrmLoader) {
                try {
                    vrmLoader.setEmotion(result.emotion, result.intensity);
                } catch (_) {}
            }

            // Try to play a matching animation clip (for GLBs with baked animations)
            const clipNames = EMOTION_CLIP_MAP[result.emotion];
            if (clipNames) {
                for (const cn of clipNames) {
                    if (_playClip(cn)) break;
                }
            }

            console.log(
                `[Behavior] Emotion: ${result.detected} (${result.source}) → ` +
                    `VRM:${result.emotion}@${result.intensity.toFixed(2)}, mode:${result.mode}`
            );
        }

        // Start lip-sync with the response text
        if (global.NEXUS_LIP_SYNC) {
            // Get speech rate from settings (if available)
            const rate = global.SpeechSettings?.rate || 1.0;
            global.NEXUS_LIP_SYNC.start(text, rate);
        }

        // Transition happens automatically when speechSynthesis.speaking is detected
        // But if TTS is disabled, go back to idle after a moment
        if (typeof speechSynthesis === 'undefined' || !('speechSynthesis' in window)) {
            setState(State.IDLE);
        }
    }

    /**
     * Microphone activated — transition to LISTENING.
     */
    function onListeningStart() {
        setState(State.LISTENING);
    }

    /**
     * Microphone deactivated — back to IDLE (or THINKING if message was sent).
     */
    function onListeningEnd() {
        if (engine.state === State.LISTENING) {
            setState(State.IDLE);
        }
    }

    /**
     * TTS started speaking (explicit notification, supplements polling).
     */
    function onSpeechStart() {
        if (engine.state !== State.SPEAKING) {
            setState(State.SPEAKING);
        }
    }

    /**
     * TTS finished speaking (explicit notification, supplements polling).
     */
    function onSpeechEnd() {
        if (global.NEXUS_LIP_SYNC) {
            global.NEXUS_LIP_SYNC.stop();
        }
        _clearEmotion();
        if (engine.state === State.SPEAKING) {
            setState(State.IDLE);
        }
    }

    // =========================================================================
    // VRM HELPERS
    // =========================================================================

    function _getVRMLoader() {
        return global.NEXUS_VIEWER?.avatarManager?.vrmLoader || null;
    }

    /**
     * Try to play a named animation clip on the current avatar.
     * Returns true if the clip was found and played.
     */
    function _playClip(name) {
        const mgr = global.NEXUS_VIEWER?.avatarManager;
        if (!mgr) return false;
        return !!mgr.playAnimation(name);
    }

    /**
     * Map emotion to animation clip names (for GLBs with baked clips).
     * Falls back through multiple possible names.
     * Reads from centralized AnimationPresets when available.
     */
    const _AP = global.NEXUS_ANIMATION_PRESETS;
    const EMOTION_CLIP_MAP =
        _AP && _AP.EMOTION_CLIP_MAP
            ? _AP.EMOTION_CLIP_MAP
            : {
                  happy: ['Happy', 'Dance', 'Yes', 'ThumbsUp', 'Wave'],
                  sad: ['Sad', 'Death', 'No', 'Sitting'],
                  angry: ['Angry', 'Punch', 'No'],
                  surprised: ['Surprised', 'Jump', 'Wave'],
                  thinking: ['Idle', 'Standing'],
              };

    function _setVRMExpression(name, value) {
        if (engine._expressionOverride) return; // face tracking owns expressions
        const vrmLoader = _getVRMLoader();
        if (!vrmLoader) return;
        try {
            vrmLoader.setExpression(name, value);
        } catch (_) {}
    }

    function _clearEmotion() {
        const vrmLoader = _getVRMLoader();
        if (!vrmLoader) return;
        try {
            vrmLoader.setEmotion('neutral', 0);
        } catch (_) {}
    }

    // =========================================================================
    // EXPOSE
    // =========================================================================

    global.NEXUS_BEHAVIOR = {
        // State
        setState: setState,
        getState: getState,
        State: State, // expose enum for external use

        // Per-frame update
        update: update,

        // Event handlers
        onUserMessage: onUserMessage,
        onBotResponse: onBotResponse,
        onSpeechStart: onSpeechStart,
        onSpeechEnd: onSpeechEnd,
        onListeningStart: onListeningStart,
        onListeningEnd: onListeningEnd,

        // Face tracking override — when true, BehaviorEngine skips expression writes
        setExpressionOverride: function (active) {
            engine._expressionOverride = !!active;
        },
    };

    console.log('[BehaviorEngine] Initialized');
})(window);
