/**
 * MotionResponseHandler — connects OllaBridge chat responses to MotionDSL.
 *
 * Extracts x_avatar_directives from chat responses and feeds motion plans
 * to MotionDSL for execution. Also handles avatar state transitions
 * (thinking, speaking, idle) in real time.
 *
 * AAA pattern: "Event Dispatcher" — decouples response parsing from
 * motion execution. The handler is a bridge, not an executor.
 *
 * Additive module: does not modify BridgeResponseAdapter, MotionDSL, or
 * any existing code. Call MotionResponseHandler.init() after MotionDSL
 * and MotionExecutor are ready.
 *
 * @module MotionResponseHandler
 */

const MotionResponseHandler = (() => {
    'use strict';

    /** @type {Object} Runtime context for MotionDSL execution */
    let _motionContext = null;

    /** @type {string|null} Current persona ID */
    let _activePersonaId = null;

    /** @type {Function|null} Callback for avatar state changes */
    let _onStateChange = null;

    /**
     * Initialize the handler.
     * @param {Object} options
     * @param {Object} options.motionContext - Context for MotionDSL.execute()
     * @param {string} [options.personaId] - Active persona ID
     * @param {Function} [options.onStateChange] - (state: string) => void
     */
    function init(options) {
        _motionContext = options.motionContext || {};
        _activePersonaId = options.personaId || null;
        _onStateChange = options.onStateChange || null;
    }

    /**
     * Set the active persona.
     * @param {string} personaId
     */
    function setPersona(personaId) {
        _activePersonaId = personaId;
    }

    /**
     * Process a chat response and extract/execute motion directives.
     *
     * Call this after receiving a response from OllaBridge/HomePilot.
     * Works with both raw response objects and normalized BridgeResponseAdapter output.
     *
     * @param {Object} response - Chat response (raw or normalized)
     * @returns {Promise<void>}
     */
    async function processResponse(response) {
        if (!response) return;

        // Extract directives from various response formats
        const directives = response.x_avatar_directives || response.avatar_directives || response.x_directives || {};

        // ── Avatar state transition ─────────────────────────────────
        const state = directives.state;
        if (state && _onStateChange) {
            _onStateChange(state);
        }

        // ── Emotion application ─────────────────────────────────────
        const emotion = directives.emotion;
        if (emotion && _motionContext && _motionContext.setExpression) {
            const emotionWeightMap = {
                happy: 0.7,
                excited: 0.9,
                warm: 0.5,
                playful: 0.6,
                thoughtful: 0.4,
                concerned: 0.5,
                neutral: 0.0,
            };
            const weight = emotionWeightMap[emotion] || 0.5;
            _motionContext.setExpression(emotion, weight);
        }

        // ── Motion plan execution ───────────────────────────────────
        const motionPlan = directives.motion_plan;
        if (motionPlan && motionPlan.commands && motionPlan.commands.length > 0) {
            if (typeof MotionDSL !== 'undefined') {
                await MotionDSL.execute(motionPlan, _motionContext);

                // Update WorldStateBridge with new avatar state
                if (typeof WorldStateBridge !== 'undefined' && _activePersonaId) {
                    WorldStateBridge.updateAvatarState(_activePersonaId, {
                        state: 'idle',
                        position: _motionContext.avatar
                            ? {
                                  x: _motionContext.avatar.position.x,
                                  y: _motionContext.avatar.position.y,
                                  z: _motionContext.avatar.position.z,
                              }
                            : undefined,
                    });
                }
            }
        }
    }

    /**
     * Signal that the AI is "thinking" (before response arrives).
     * Call this when the chat request is sent.
     */
    function signalThinking() {
        if (_onStateChange) _onStateChange('thinking');
        if (_motionContext && _motionContext.setExpression) {
            _motionContext.setExpression('thinking', 0.4);
        }
    }

    /**
     * Signal that the AI is "speaking" (response is being read aloud).
     */
    function signalSpeaking() {
        if (_onStateChange) _onStateChange('speaking');
    }

    /**
     * Signal that the AI is "idle" (response complete, no speech).
     */
    function signalIdle() {
        if (_onStateChange) _onStateChange('idle');
        if (_motionContext && _motionContext.setExpression) {
            _motionContext.setExpression('neutral', 0.0);
        }
    }

    return {
        init,
        setPersona,
        processResponse,
        signalThinking,
        signalSpeaking,
        signalIdle,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MotionResponseHandler;
}
