'use strict';

/**
 * AvatarLocomotionSystem — State machine for avatar walking / following.
 * ======================================================================
 * ADDITIVE / NON-DESTRUCTIVE: This file is 100% standalone.
 * It reads from VRIntimacySystem's distance data and drives
 * AnimationBlendController + avatar root position.
 *
 * State machine:
 *   IDLE ──(dist > walkTrigger)──→ TURNING
 *   TURNING ──(facing OK)──→ WALKING
 *   WALKING ──(dist < stopDist)──→ STOPPING
 *   STOPPING ──(fade done)──→ IDLE
 *
 * Integration points (search "LOCOMOTION_HOOK" in other files):
 *   - ViewerEngine.js: calls update(dt) in animation loop
 *   - VRIntimacySystem.js: provides distance/position data via setProximityData()
 *
 * To remove entirely:
 *   1. Delete this file, AnimationBlendController.js, LocomotionConfig.js
 *   2. Remove <script> tags from index.html
 *   3. Remove LOCOMOTION_HOOK lines from ViewerEngine.js and VRIntimacySystem.js
 *
 * Exposes: window.NEXUS_LOCOMOTION
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[AvatarLocomotionSystem] THREE not found');
        return;
    }

    // ── States ──
    var STATE = {
        IDLE: 'idle',
        TURNING: 'turning',
        WALKING: 'walking',
        STOPPING: 'stopping',
    };

    // ── Internal state ──
    var state = STATE.IDLE;
    var avatarRoot = null;
    var initialized = false;
    var preloaded = false;

    // Proximity data (set each frame by integration hook)
    var proximityData = {
        distance: 0,
        userHeadPos: new THREE.Vector3(),
        avatarPos: new THREE.Vector3(),
        isVR: false,
    };

    // Stopping timer
    var stoppingTimer = 0;

    // Walk target position (where avatar is moving toward)
    var walkTarget = new THREE.Vector3();

    // ── ARC_POINTER_HOOK: External walk-to-point target ──
    // When set, avatar walks to this fixed point instead of toward user
    var pointWalkTarget = null; // null = follow-user mode, Vector3 = walk-to-point mode
    var pointWalkArrivalDist = 0.2; // How close to point before stopping (metres)

    // Temp vectors
    var _tmpA = new THREE.Vector3();
    var _tmpB = new THREE.Vector3();
    var _tmpDir = new THREE.Vector3();

    // ── Get config helper ──
    function cfg(key) {
        var c = window.NEXUS_LOCOMOTION_CONFIG;
        return c ? c.get(key) : null;
    }

    // ── Check if feature is enabled ──
    function isEnabled() {
        var c = window.NEXUS_LOCOMOTION_CONFIG;
        return c && c.isEnabled() && initialized && avatarRoot;
    }

    // ── Initialize with avatar ──
    function init(root, vrm) {
        avatarRoot = root;

        var blend = window.NEXUS_ANIMATION_BLEND;
        if (blend) {
            blend.init(root, vrm);
        }

        state = STATE.IDLE;
        initialized = true;
        preloaded = false;

        console.log('[AvatarLocomotionSystem] Initialized');
    }

    // ── Preload walk/run clips (call after init) ──
    function preload() {
        if (preloaded) return Promise.resolve(true);

        var blend = window.NEXUS_ANIMATION_BLEND;
        if (!blend) return Promise.resolve(false);

        return blend.preloadAll().then(function (ok) {
            preloaded = ok;
            if (ok) console.log('[AvatarLocomotionSystem] Walk/run clips preloaded');
            return ok;
        });
    }

    // ── Set proximity data (called each frame from VRIntimacySystem hook) ──
    function setProximityData(dist, userHead, avatarPos, isVR) {
        proximityData.distance = dist;
        proximityData.userHeadPos.copy(userHead);
        proximityData.avatarPos.copy(avatarPos);
        proximityData.isVR = isVR;
    }

    // ── Main update (call every frame from ViewerEngine) ──
    function update(dt) {
        if (!isEnabled()) return;
        if (isNaN(dt) || dt <= 0) return;

        // proximityData.isVR is fed by VRIntimacySystem each frame.
        // For follow-user auto-walk (IDLE state), we need it to know
        // the user's distance. But for point-walk (arc pointer),
        // the state machine is already TURNING/WALKING/STOPPING and
        // must keep running regardless. Also check renderer directly
        // as a fallback — if we're in XR, we're in VR.
        var inVR = proximityData.isVR;
        if (!inVR) {
            var viewer = window.NEXUS_VIEWER;
            inVR = !!viewer?.renderer?.xr?.isPresenting;
        }
        if (!inVR) return;

        // Ensure preloaded (non-blocking — let state machine run even
        // if animations failed, so the avatar still moves physically)
        if (!preloaded) {
            preload();
        }

        var blend = window.NEXUS_ANIMATION_BLEND;

        var dist = proximityData.distance;
        var walkTrigger = cfg('walkTriggerDistance') || 1.8;
        var stopDist = cfg('stopDistance') || 0.95;
        var hysteresis = cfg('hysteresisBand') || 0.15;
        var debug = cfg('debug');

        switch (state) {
            case STATE.IDLE:
                // Follow-user auto-walk only works with proximity data
                if (proximityData.isVR && blend) {
                    _updateIdle(dt, dist, walkTrigger, hysteresis, blend, debug);
                }
                break;
            case STATE.TURNING:
                _updateTurning(dt, dist, stopDist, blend, debug);
                break;
            case STATE.WALKING:
                _updateWalking(dt, dist, stopDist, hysteresis, blend, debug);
                break;
            case STATE.STOPPING:
                _updateStopping(dt, blend, debug);
                break;
        }

        // Update blend controller when active
        if (blend) blend.update(dt);
    }

    // ── State: IDLE ──
    function _updateIdle(dt, dist, walkTrigger, hysteresis, blend, debug) {
        // Check if user has walked far enough to trigger locomotion
        if (dist > walkTrigger + hysteresis) {
            // Check if puppet mode is active (don't walk during manual manipulation)
            var viewer = window.NEXUS_VIEWER;
            if (viewer && viewer.vrPuppetInteraction) {
                var puppetMode = viewer.vrPuppetInteraction.state?.mode;
                if (puppetMode === 'rootTranslate' || puppetMode === 'rootDualTransform') {
                    return; // User is manually moving avatar
                }
            }

            // Transition to TURNING
            state = STATE.TURNING;
            _updateWalkTarget();

            // Tell ProceduralAnimator to go upper-body-only if configured
            if (cfg('upperBodyOnlyDuringWalk')) {
                _setProceduralUpperBodyOnly(true);
            }

            // Activate blend controller and start walk animation
            blend.setActive(true);
            blend.transitionTo('walk', cfg('idleToWalkFade') || 0.35);

            // Tell ClipAnimationLoader to stop its clip (avoid conflicting mixers)
            var clipLoader = window.NEXUS_CLIP_LOADER;
            if (clipLoader) clipLoader.stopClip();

            if (debug) console.log('[Locomotion] IDLE → TURNING (dist:', dist.toFixed(2) + 'm)');
        }
    }

    // ── State: TURNING ──
    function _updateTurning(dt, dist, stopDist, blend, debug) {
        // Turn avatar to face walk target
        if (pointWalkTarget) {
            walkTarget.copy(pointWalkTarget);
        } else {
            _updateWalkTarget();
        }
        var facingOk = _turnTowardTarget(dt);

        // If user came back close (follow mode only), abort
        if (!pointWalkTarget && dist < stopDist) {
            state = STATE.STOPPING;
            stoppingTimer = cfg('walkToIdleFade') || 0.45;
            if (blend) blend.fadeOutAll(stoppingTimer);
            if (debug) console.log('[Locomotion] TURNING → STOPPING (user returned)');
            return;
        }

        // Once facing is roughly aligned, start moving
        if (facingOk) {
            state = STATE.WALKING;
            if (debug) console.log('[Locomotion] TURNING → WALKING');
        }
    }

    // ── State: WALKING ──
    function _updateWalking(dt, dist, stopDist, hysteresis, blend, debug) {
        // In point-walk mode, target is fixed; in follow mode, track user
        if (pointWalkTarget) {
            walkTarget.copy(pointWalkTarget);
        } else {
            _updateWalkTarget();
        }

        // Turn toward target while walking
        _turnTowardTarget(dt);

        // Move root position toward target
        var speed = cfg('walkSpeed') || 0.85;
        var lerpFactor = cfg('rootLerpFactor') || 4.0;

        // Direction from avatar to walk target (on XZ plane)
        var rootPos = avatarRoot.position;
        _tmpDir.set(walkTarget.x - rootPos.x, 0, walkTarget.z - rootPos.z);
        var remaining = _tmpDir.length();

        if (remaining > 0.01) {
            _tmpDir.normalize();

            // Move at walk speed, but also dampen as we approach
            var moveAmount = Math.min(speed * dt, remaining);

            // Smooth approach using lerp factor
            var smoothMove = moveAmount * Math.min(1, lerpFactor * dt);
            // But ensure minimum movement to avoid getting stuck
            smoothMove = Math.max(smoothMove, moveAmount * 0.5);

            rootPos.x += _tmpDir.x * smoothMove;
            rootPos.z += _tmpDir.z * smoothMove;

            // Keep grounded
            if (cfg('rootYLocked')) {
                rootPos.y = 0;
            }
        }

        // ── Arrival check ──
        if (pointWalkTarget) {
            // Point-walk mode: check distance to target point
            if (remaining < pointWalkArrivalDist) {
                state = STATE.STOPPING;
                stoppingTimer = cfg('walkToIdleFade') || 0.45;
                if (blend) blend.fadeOutAll(stoppingTimer);
                _setProceduralUpperBodyOnly(false);
                pointWalkTarget = null; // Clear point-walk mode
                if (debug) console.log('[Locomotion] WALKING → STOPPING (arrived at point)');
            }
        } else {
            // Follow-user mode: check proximity to user
            if (dist < stopDist - hysteresis) {
                state = STATE.STOPPING;
                stoppingTimer = cfg('walkToIdleFade') || 0.45;
                if (blend) blend.fadeOutAll(stoppingTimer);
                _setProceduralUpperBodyOnly(false);
                if (debug) console.log('[Locomotion] WALKING → STOPPING (dist:', dist.toFixed(2) + 'm)');
            }
        }
    }

    // ── State: STOPPING ──
    function _updateStopping(dt, blend, debug) {
        stoppingTimer -= dt;
        if (stoppingTimer <= 0) {
            state = STATE.IDLE;
            if (blend) blend.setActive(false);
            if (debug) console.log('[Locomotion] STOPPING → IDLE');
        }
    }

    // ── Update walk target (where avatar should walk to) ──
    function _updateWalkTarget() {
        // Target is the desired distance from user (not right on top of them)
        var desired = cfg('stopDistance') || 0.95;
        var userPos = proximityData.userHeadPos;

        // Direction from user to avatar current position (on XZ plane)
        _tmpA.set(avatarRoot.position.x - userPos.x, 0, avatarRoot.position.z - userPos.z);
        var len = _tmpA.length();

        if (len > 0.01) {
            _tmpA.normalize();
            // Target point: desired distance from user, along current approach direction
            walkTarget.set(userPos.x + _tmpA.x * desired, 0, userPos.z + _tmpA.z * desired);
        } else {
            // Edge case: avatar directly on user — pick arbitrary direction
            walkTarget.set(userPos.x, 0, userPos.z + desired);
        }
    }

    // ── Turn avatar root to face walk direction ──
    function _turnTowardTarget(dt) {
        if (!avatarRoot) return true;

        var rootPos = avatarRoot.position;
        _tmpDir.set(walkTarget.x - rootPos.x, 0, walkTarget.z - rootPos.z);

        if (_tmpDir.lengthSq() < 0.001) return true;

        // VRM forward is −Z and ViewerEngine rests VRM roots at rotation.y = π
        // (see ViewerEngine's root.rotation.set(0, isVRM ? Math.PI : 0, 0)), so
        // the bare +Z-forward yaw would turn her BACK toward the walk target —
        // she would approach the user walking backwards. Plain GLB roots rest
        // at 0 and face +Z, hence the switch. The quaternion slerp below
        // already takes the shortest path, so no angle wrapping is needed here.
        var vrmForward = !!(avatarRoot.userData && avatarRoot.userData.isVRM);
        var targetYaw = Math.atan2(_tmpDir.x, _tmpDir.z) + (vrmForward ? Math.PI : 0);
        var targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);

        var turnSpeed = cfg('turnSpeed') || 3.0;
        var slerpT = Math.min(1, turnSpeed * dt);
        avatarRoot.quaternion.slerp(targetQ, slerpT);

        // Check if close enough to target facing
        var angleDiff = avatarRoot.quaternion.angleTo(targetQ);
        var threshold = cfg('turnThreshold') || 0.4;
        return angleDiff < threshold;
    }

    // ── Tell ProceduralAnimator to skip lower body ──
    function _setProceduralUpperBodyOnly(enabled) {
        // We use a custom flag that ProceduralAnimator can check
        // This is set on the window so it's fully non-destructive
        window._NEXUS_LOCOMOTION_UPPER_BODY_ONLY = !!enabled;
    }

    // ── ARC_POINTER_HOOK: Walk to a specific world-space XZ point ──
    // Called by TeleportArcPointer when user confirms a target
    function walkToPoint(x, z) {
        if (!avatarRoot || !initialized) return;

        // Kick off preload if needed (non-blocking — avatar will move
        // even without walk animation if clips failed retargeting)
        if (!preloaded) {
            preload();
        }

        var blend = window.NEXUS_ANIMATION_BLEND;

        // Set the fixed walk target
        pointWalkTarget = new THREE.Vector3(x, 0, z);

        // If already walking, just update the target
        if (state === STATE.WALKING || state === STATE.TURNING) {
            walkTarget.set(x, 0, z);
            return;
        }

        // Start walking
        walkTarget.set(x, 0, z);
        state = STATE.TURNING;

        // Stop any conflicting clip
        var clipLoader = window.NEXUS_CLIP_LOADER;
        if (clipLoader) clipLoader.stopClip();

        // Tell ProceduralAnimator to go upper-body-only
        if (cfg('upperBodyOnlyDuringWalk')) {
            _setProceduralUpperBodyOnly(true);
        }

        // Activate walk animation (if blend controller has clips loaded)
        if (blend) {
            blend.setActive(true);
            blend.transitionTo('walk', cfg('idleToWalkFade') || 0.35);
        }

        console.log('[Locomotion] walkToPoint:', x.toFixed(2), z.toFixed(2));
    }

    // ── Force stop walking (e.g., on avatar change, mode change) ──
    function forceStop() {
        var blend = window.NEXUS_ANIMATION_BLEND;
        if (blend && blend.isActive()) {
            blend.fadeOutAll(0.2);
            blend.setActive(false);
        }
        state = STATE.IDLE;
        stoppingTimer = 0;
        pointWalkTarget = null;
        _setProceduralUpperBodyOnly(false);
    }

    // ── Get current state ──
    function getState() {
        return state;
    }

    function isWalking() {
        return state === STATE.WALKING || state === STATE.TURNING;
    }

    // ── Cleanup ──
    function dispose() {
        forceStop();
        var blend = window.NEXUS_ANIMATION_BLEND;
        if (blend) blend.dispose();
        avatarRoot = null;
        initialized = false;
        preloaded = false;
    }

    // ── Expose ──
    window.NEXUS_LOCOMOTION = {
        init: init,
        preload: preload,
        update: update,
        setProximityData: setProximityData,
        walkToPoint: walkToPoint, // ARC_POINTER_HOOK: walk to specific XZ point
        forceStop: forceStop,
        getState: getState,
        isWalking: isWalking,
        dispose: dispose,
    };

    console.log('[AvatarLocomotionSystem] Loaded — avatar locomotion state machine ready');
})();
