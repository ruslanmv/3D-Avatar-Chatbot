'use strict';

/**
 * LocomotionConfig — Toggle & tuning constants for avatar locomotion.
 * ====================================================================
 * ADDITIVE / NON-DESTRUCTIVE: This file is 100% standalone.
 * To remove the locomotion feature entirely:
 *   1. Delete this file, AvatarLocomotionSystem.js, AnimationBlendController.js
 *   2. Remove the 3 <script> tags from index.html
 *   3. Remove the integration hooks (search "LOCOMOTION_HOOK" in ViewerEngine.js & VRIntimacySystem.js)
 *
 * Exposes: window.NEXUS_LOCOMOTION_CONFIG
 */
(function () {
    var config = {
        // ── Master toggle ──
        enabled: true, // On by default — powers Living NPC locomotion (follow/approach)

        // ── Distance thresholds (metres) ──
        // When user walks beyond walkTriggerDistance from avatar, she starts walking
        walkTriggerDistance: 1.8,
        // When avatar gets within stopDistance of user, she stops walking
        stopDistance: 0.95,
        // Hysteresis band — prevents rapid start/stop flicker
        hysteresisBand: 0.15,

        // ── Movement speeds (metres/second) ──
        walkSpeed: 0.85, // Root position movement speed during walk
        runSpeed: 2.2, // Root position movement speed during run (future)
        runTriggerDistance: 3.5, // Distance at which walk upgrades to run (future)

        // ── Animation crossfade durations (seconds) ──
        idleToWalkFade: 0.35,
        walkToIdleFade: 0.45,
        walkToRunFade: 0.3, // Future
        runToWalkFade: 0.4, // Future

        // ── Root motion ──
        rootLerpFactor: 4.0, // How smoothly root position lerps toward target
        rootYLocked: true, // Keep avatar grounded (Y=0)

        // ── Turn-in-place ──
        turnThreshold: 0.4, // Radians — if facing delta > this, turn-in-place before walking
        turnSpeed: 3.0, // Radians/sec — how fast avatar turns to face walk direction

        // ── ProceduralAnimator integration ──
        // When walking, ProceduralAnimator should only control head+upper body,
        // letting the walk clip drive legs/hips/spine
        upperBodyOnlyDuringWalk: true,

        // ── BVH clip paths (relative to vendor/animations/) ──
        clips: {
            walk: 'action/action_walk.bvh',
            run: 'action/action_run.bvh',
            jog: 'action/action_jog.bvh',
        },

        // ── Debug ──
        debug: false,
    };

    // ── Public API ──
    window.NEXUS_LOCOMOTION_CONFIG = {
        get: function (key) {
            return config[key];
        },
        set: function (key, value) {
            if (key in config) {
                config[key] = value;
                if (config.debug) console.log('[LocomotionConfig] Set', key, '=', value);
            }
        },
        getAll: function () {
            return Object.assign({}, config);
        },
        isEnabled: function () {
            return config.enabled;
        },
        toggle: function () {
            config.enabled = !config.enabled;
            console.log('[LocomotionConfig] Locomotion', config.enabled ? 'ENABLED' : 'DISABLED');
            // Dispatch event so UI can react
            window.dispatchEvent(
                new CustomEvent('nexus-locomotion-toggled', {
                    detail: { enabled: config.enabled },
                })
            );
            return config.enabled;
        },
        enable: function () {
            config.enabled = true;
            window.dispatchEvent(new CustomEvent('nexus-locomotion-toggled', { detail: { enabled: true } }));
        },
        disable: function () {
            config.enabled = false;
            window.dispatchEvent(new CustomEvent('nexus-locomotion-toggled', { detail: { enabled: false } }));
        },
    };

    console.log('[LocomotionConfig] Loaded — locomotion feature toggle ready (default: OFF)');
})();
