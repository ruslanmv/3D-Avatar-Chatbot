/**
 * MotionExecutor — wires MotionDSL handlers to Three.js / VRM.
 *
 * AAA game industry standard: separates "intent" (MotionDSL commands)
 * from "execution" (Three.js transforms, IK, animation blending).
 *
 * Uses frame-rate-independent lerp (LERP with delta time) for smooth
 * motion, consistent across 72Hz (Quest) and 144Hz (PC VR) displays.
 *
 * Additive module: does not modify MotionDSL.js or any existing code.
 * Call MotionExecutor.init(context) once after the scene is ready.
 *
 * @module MotionExecutor
 */

const MotionExecutor = (() => {
    'use strict';

    /** @type {Object} Runtime context (avatar, scene, camera, etc.) */
    let _ctx = null;

    /** @type {number|null} Follow loop interval ID */
    let _followIntervalId = null;

    /** @type {string|null} Current follow target */
    let _followTarget = null;

    /** @type {number} Follow distance in meters */
    let _followDistance = 1.5;

    /**
     * Initialize the executor with runtime context.
     * @param {Object} context
     * @param {THREE.Group} context.avatar - Avatar root group
     * @param {THREE.Scene} context.scene - Three.js scene
     * @param {Function} context.getUserPosition - () => THREE.Vector3
     * @param {Function} [context.getAnchorPosition] - (type) => THREE.Vector3|null
     * @param {Function} [context.setExpression] - (name, weight) => void
     * @param {Function} [context.playAnimation] - (name) => void
     * @param {Function} [context.setLookAtTarget] - (THREE.Vector3) => void
     * @param {number} [context.lerpSpeed=5.0] - Lerp speed multiplier
     */
    function init(context) {
        _ctx = {
            lerpSpeed: 5.0,
            ...context,
        };

        // Register all handlers with MotionDSL
        if (typeof MotionDSL !== 'undefined') {
            _registerAllHandlers();
        }
    }

    /**
     * Register AAA-standard motion handlers with MotionDSL.
     * @private
     */
    function _registerAllHandlers() {
        // ── Locomotion ──────────────────────────────────────────────
        MotionDSL.registerHandler('approach', _handleApproach);
        MotionDSL.registerHandler('retreat', _handleRetreat);
        MotionDSL.registerHandler('follow', _handleFollow);
        MotionDSL.registerHandler('stop_follow', _handleStopFollow);
        MotionDSL.registerHandler('stop', _handleStop);

        // ── Gaze ────────────────────────────────────────────────────
        MotionDSL.registerHandler('look_at', _handleLookAt);

        // ── Expression & Gesture ────────────────────────────────────
        MotionDSL.registerHandler('expression', _handleExpression);
        MotionDSL.registerHandler('gesture', _handleGesture);
        MotionDSL.registerHandler('wave', _handleWave);
        MotionDSL.registerHandler('nod', _handleNod);
        MotionDSL.registerHandler('point', _handlePoint);
        MotionDSL.registerHandler('offer_hand', _handleOfferHand);

        // ── Posture ─────────────────────────────────────────────────
        MotionDSL.registerHandler('sit', _handleSit);
        MotionDSL.registerHandler('stand', _handleStand);
        MotionDSL.registerHandler('idle', _handleIdle);

        // ── Speech sync ─────────────────────────────────────────────
        MotionDSL.registerHandler('speak_start', _handleSpeakStart);
        MotionDSL.registerHandler('speak_end', _handleSpeakEnd);
    }

    // ── Helper: frame-rate-independent smooth movement ────────────

    /**
     * Smoothly move avatar to target position over duration.
     * Uses requestAnimationFrame with delta-time lerp (AAA standard).
     * @param {THREE.Vector3} targetPos
     * @param {number} speed - meters per second
     * @returns {Promise<void>}
     */
    function _smoothMoveTo(targetPos, speed) {
        return new Promise((resolve) => {
            if (!_ctx || !_ctx.avatar) {
                resolve();
                return;
            }

            const avatar = _ctx.avatar;
            const startPos = avatar.position.clone();
            const distance = startPos.distanceTo(targetPos);
            const duration = distance / Math.max(speed, 0.1);
            let elapsed = 0;
            let lastTime = performance.now();

            function step(now) {
                const dt = (now - lastTime) / 1000;
                lastTime = now;
                elapsed += dt;

                const t = Math.min(elapsed / duration, 1.0);
                // Ease-in-out cubic (AAA game standard)
                const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

                avatar.position.lerpVectors(startPos, targetPos, eased);

                if (t >= 1.0) {
                    avatar.position.copy(targetPos);
                    resolve();
                } else {
                    requestAnimationFrame(step);
                }
            }

            requestAnimationFrame(step);
        });
    }

    /**
     * Make avatar face a target point (Y-axis rotation only).
     * @param {THREE.Vector3} targetPos
     * @param {number} speed - rotation speed (0-1, where 1 = instant)
     */
    function _faceTarget(targetPos, speed) {
        if (!_ctx || !_ctx.avatar) return;

        const avatar = _ctx.avatar;
        const dx = targetPos.x - avatar.position.x;
        const dz = targetPos.z - avatar.position.z;
        const targetAngle = Math.atan2(dx, dz);

        // Slerp-like rotation over frames
        const currentY = avatar.rotation.y;
        const diff = targetAngle - currentY;
        // Normalize angle difference
        const normalizedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
        avatar.rotation.y += normalizedDiff * Math.min(speed, 1.0);
    }

    /**
     * Resolve a target string to a world position.
     * @param {string} target - "user", "user_head", "nearest_seat", etc.
     * @returns {THREE.Vector3|null}
     */
    function _resolveTarget(target) {
        if (!_ctx) return null;

        if (target === 'user' || target === 'user_head') {
            if (_ctx.getUserPosition) {
                return _ctx.getUserPosition();
            }
        }

        if (target === 'nearest_seat' && _ctx.getAnchorPosition) {
            return _ctx.getAnchorPosition('seat');
        }

        return null;
    }

    // ── Handler implementations ─────────────────────────────────────

    async function _handleApproach(cmd) {
        const targetPos = _resolveTarget(cmd.target || 'user');
        if (!targetPos || !_ctx || !_ctx.avatar) return;

        const dist = cmd.distance_m || 1.2;
        const speed = cmd.speed || 1.0;

        // Calculate approach position (maintain distance from target)
        const avatarPos = _ctx.avatar.position;
        const direction = targetPos.clone().sub(avatarPos).normalize();
        const approachPos = targetPos.clone().sub(direction.multiplyScalar(dist));
        approachPos.y = avatarPos.y; // Keep feet on ground

        if (_ctx.playAnimation) _ctx.playAnimation('walk');
        await _smoothMoveTo(approachPos, speed);
        _faceTarget(targetPos, 0.8);
        if (_ctx.playAnimation) _ctx.playAnimation('idle');
    }

    async function _handleRetreat(cmd) {
        if (!_ctx || !_ctx.avatar) return;
        const dist = cmd.distance_m || 1.0;
        const userPos = _ctx.getUserPosition ? _ctx.getUserPosition() : null;
        if (!userPos) return;

        const avatar = _ctx.avatar;
        const direction = avatar.position.clone().sub(userPos).normalize();
        const retreatPos = avatar.position.clone().add(direction.multiplyScalar(dist));
        retreatPos.y = avatar.position.y;

        if (_ctx.playAnimation) _ctx.playAnimation('walk_backward');
        await _smoothMoveTo(retreatPos, 0.8);
        if (_ctx.playAnimation) _ctx.playAnimation('idle');
    }

    async function _handleFollow(cmd) {
        _handleStopFollow(); // Clear any existing follow

        _followTarget = cmd.target || 'user';
        _followDistance = cmd.distance_m || 1.5;

        _followIntervalId = setInterval(() => {
            const targetPos = _resolveTarget(_followTarget);
            if (!targetPos || !_ctx || !_ctx.avatar) return;

            const avatarPos = _ctx.avatar.position;
            const dist = avatarPos.distanceTo(targetPos);

            if (dist > _followDistance + 0.3) {
                // Need to catch up
                const direction = targetPos.clone().sub(avatarPos).normalize();
                const step = direction.multiplyScalar(0.02); // ~1.2 m/s at 60fps
                _ctx.avatar.position.add(step);
                _faceTarget(targetPos, 0.5);
                if (_ctx.playAnimation) _ctx.playAnimation('walk');
            } else {
                _faceTarget(targetPos, 0.3);
                if (_ctx.playAnimation) _ctx.playAnimation('idle');
            }
        }, 1000 / 60); // 60Hz update loop
    }

    async function _handleStopFollow() {
        if (_followIntervalId) {
            clearInterval(_followIntervalId);
            _followIntervalId = null;
        }
        _followTarget = null;
    }

    async function _handleStop() {
        _handleStopFollow();
        if (_ctx && _ctx.playAnimation) _ctx.playAnimation('idle');
    }

    async function _handleLookAt(cmd) {
        const targetPos = _resolveTarget(cmd.target || 'user_head');
        if (!targetPos) return;

        if (_ctx && _ctx.setLookAtTarget) {
            _ctx.setLookAtTarget(targetPos);
        }
        _faceTarget(targetPos, cmd.speed || 0.7);
    }

    async function _handleExpression(cmd) {
        if (_ctx && _ctx.setExpression) {
            _ctx.setExpression(cmd.name || 'neutral', cmd.weight || 0.5);
        }
    }

    async function _handleGesture(cmd) {
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation(cmd.name || 'gesture', cmd.side || 'right');
        }
    }

    async function _handleWave(cmd) {
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation('wave', cmd.side || 'right');
        }
    }

    async function _handleNod() {
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation('nod');
        }
    }

    async function _handlePoint(cmd) {
        const targetPos = _resolveTarget(cmd.target || 'forward');
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation('point', cmd.side || 'right');
        }
        if (targetPos) _faceTarget(targetPos, 0.6);
    }

    async function _handleOfferHand(cmd) {
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation('offer_hand', cmd.side || 'right');
        }
    }

    async function _handleSit(cmd) {
        const seatPos = _resolveTarget(cmd.target || 'nearest_seat');
        if (seatPos && _ctx && _ctx.avatar) {
            await _smoothMoveTo(seatPos, 0.8);
        }
        if (_ctx && _ctx.playAnimation) _ctx.playAnimation('sit');
    }

    async function _handleStand() {
        if (_ctx && _ctx.playAnimation) _ctx.playAnimation('stand');
    }

    async function _handleIdle(cmd) {
        if (_ctx && _ctx.playAnimation) {
            _ctx.playAnimation(cmd.name || 'idle_breathing');
        }
    }

    async function _handleSpeakStart() {
        if (_ctx && _ctx.playAnimation) _ctx.playAnimation('talking');
    }

    async function _handleSpeakEnd() {
        if (_ctx && _ctx.playAnimation) _ctx.playAnimation('idle');
    }

    // ── Public API ──────────────────────────────────────────────────

    return {
        init,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MotionExecutor;
}
