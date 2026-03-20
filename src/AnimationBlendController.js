'use strict';

/**
 * AnimationBlendController — Crossfade controller for locomotion clips.
 * ======================================================================
 * ADDITIVE / NON-DESTRUCTIVE: Works alongside ClipAnimationLoader.
 * Uses its OWN AnimationMixer so it never conflicts with existing clip playback.
 *
 * Pattern: Industry-standard state-based crossfade (same approach as Unity Animator).
 *   - Each state (idle, walk, run) maps to a loaded AnimationClip
 *   - Transitions use Three.js crossFadeTo/crossFadeFrom with configurable durations
 *   - Only ONE state is "dominant" at any time
 *
 * Exposes: window.NEXUS_ANIMATION_BLEND
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[AnimationBlendController] THREE not found');
        return;
    }

    // ── State ──
    var mixer = null; // THREE.AnimationMixer — SEPARATE from ClipAnimationLoader's mixer
    var actions = {}; // { 'idle': AnimationAction, 'walk': AnimationAction, ... }
    var clips = {}; // { 'idle': AnimationClip, 'walk': AnimationClip, ... }
    var currentState = null; // 'idle' | 'walk' | 'run' | null
    var avatarRoot = null;
    var avatarVRM = null;
    var active = false; // Whether blend controller is currently driving the skeleton
    var loadedPaths = {}; // Track which paths have been loaded

    // ── Bone map (reuse ClipAnimationLoader's retargeting) ──
    function getRetargetedClip(bvhPath) {
        // Leverage ClipAnimationLoader's loadClip which handles retargeting
        var loader = window.NEXUS_CLIP_LOADER;
        if (!loader) return Promise.resolve(null);
        return loader.loadClip(bvhPath);
    }

    // ── Initialize mixer for avatar ──
    function init(root, vrm) {
        avatarRoot = root;
        avatarVRM = vrm || null;

        // Create our own mixer (separate from ClipAnimationLoader)
        var mixerRoot = vrm && vrm.scene ? vrm.scene : root;
        mixer = new THREE.AnimationMixer(mixerRoot);

        actions = {};
        clips = {};
        currentState = null;
        active = false;
        loadedPaths = {};

        // Ensure ClipAnimationLoader has this avatar registered so retargeting
        // works when we call loadClip(). Without this, clips may be cached
        // un-retargeted, causing "Can not bind to bones" errors.
        var loader = window.NEXUS_CLIP_LOADER;
        if (loader && typeof loader.registerAvatar === 'function') {
            loader.registerAvatar(root, vrm);
        }

        console.log('[AnimationBlendController] Initialized for avatar');
    }

    // ── Load a clip and register it as a state ──
    function loadState(stateName, bvhPath) {
        if (!mixer) {
            console.warn('[AnimationBlendController] Not initialized — call init() first');
            return Promise.resolve(false);
        }

        if (loadedPaths[stateName] === bvhPath && actions[stateName]) {
            return Promise.resolve(true); // Already loaded
        }

        return getRetargetedClip(bvhPath).then(function (clip) {
            if (!clip) {
                console.warn('[AnimationBlendController] Failed to load clip:', bvhPath);
                return false;
            }

            // Skip clips that failed retargeting — binding them causes
            // "Can not bind to bones as node does not have a skeleton" errors
            if (clip._retargetFailed) {
                console.warn('[AnimationBlendController] Clip failed retargeting, skipping:', bvhPath);
                return false;
            }

            clips[stateName] = clip;

            // Create action
            var action = mixer.clipAction(clip);
            action.setLoop(THREE.LoopRepeat);
            action.clampWhenFinished = false;
            action.setEffectiveWeight(0);
            action.play(); // Play at weight 0 — ready for crossfade

            actions[stateName] = action;
            loadedPaths[stateName] = bvhPath;

            console.log(
                '[AnimationBlendController] State loaded:',
                stateName,
                '←',
                bvhPath,
                '(duration:',
                clip.duration.toFixed(2) + 's)'
            );
            return true;
        });
    }

    // ── Preload all locomotion clips ──
    function preloadAll() {
        var cfg = window.NEXUS_LOCOMOTION_CONFIG;
        if (!cfg) return Promise.resolve(false);

        var clipPaths = cfg.getAll().clips;
        var promises = [];

        if (clipPaths.walk) promises.push(loadState('walk', clipPaths.walk));
        if (clipPaths.run) promises.push(loadState('run', clipPaths.run));
        if (clipPaths.jog) promises.push(loadState('jog', clipPaths.jog));

        return Promise.all(promises).then(function (results) {
            var allOk = results.every(function (r) {
                return r;
            });
            console.log('[AnimationBlendController] Preload complete — all OK:', allOk);
            return allOk;
        });
    }

    // ── Transition to a new state with crossfade ──
    function transitionTo(newState, fadeDuration) {
        if (!mixer) return;
        if (newState === currentState) return;

        fadeDuration = fadeDuration || 0.4;

        var nextAction = actions[newState];
        if (!nextAction) {
            console.warn('[AnimationBlendController] No action for state:', newState);
            return;
        }

        if (currentState && actions[currentState]) {
            var prevAction = actions[currentState];
            // Industry-standard crossfade pattern
            nextAction.reset();
            nextAction.setEffectiveTimeScale(1);
            nextAction.setEffectiveWeight(1);
            nextAction.play();
            prevAction.crossFadeTo(nextAction, fadeDuration, true);
        } else {
            // First transition — just fade in
            nextAction.reset();
            nextAction.setEffectiveTimeScale(1);
            nextAction.setEffectiveWeight(1);
            nextAction.fadeIn(fadeDuration);
            nextAction.play();
        }

        var prev = currentState;
        currentState = newState;

        var cfg = window.NEXUS_LOCOMOTION_CONFIG;
        if (cfg && cfg.get('debug')) {
            console.log(
                '[AnimationBlendController] Transition:',
                prev,
                '→',
                newState,
                '(fade:',
                fadeDuration.toFixed(2) + 's)'
            );
        }
    }

    // ── Fade out all actions (return control to ProceduralAnimator) ──
    function fadeOutAll(fadeDuration) {
        fadeDuration = fadeDuration || 0.5;
        Object.keys(actions).forEach(function (key) {
            if (actions[key]) {
                actions[key].fadeOut(fadeDuration);
            }
        });
        currentState = null;
        active = false;
    }

    // ── Update mixer (call every frame ONLY when active) ──
    function update(dt) {
        if (!mixer || !active) return;
        if (isNaN(dt) || dt <= 0) return; // Guard against NaN — kills crossfade permanently
        mixer.update(dt);
    }

    // ── Activate / deactivate ──
    function setActive(val) {
        active = !!val;
        if (!active) {
            // When deactivating, stop all actions cleanly
            fadeOutAll(0.3);
        }
    }

    function isActive() {
        return active;
    }

    function getCurrentState() {
        return currentState;
    }

    // ── Cleanup ──
    function dispose() {
        if (mixer) {
            mixer.stopAllAction();
            mixer = null;
        }
        actions = {};
        clips = {};
        currentState = null;
        active = false;
    }

    // ── Expose ──
    window.NEXUS_ANIMATION_BLEND = {
        init: init,
        loadState: loadState,
        preloadAll: preloadAll,
        transitionTo: transitionTo,
        fadeOutAll: fadeOutAll,
        update: update,
        setActive: setActive,
        isActive: isActive,
        getCurrentState: getCurrentState,
        dispose: dispose,
    };

    console.log('[AnimationBlendController] Loaded — crossfade animation system ready');
})();
