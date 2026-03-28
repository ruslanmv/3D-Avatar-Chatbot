'use strict';

/**
 * ClipAnimationLoader — Thin orchestrator for BVH + VRMA animation playback.
 * ==========================================================================
 * Delegates format-specific work to sub-modules:
 *   - ClipAnimationShared.js  → constants, bone maps, shared state
 *   - BVHAnimationLoader.js   → BVH parsing & retargeting
 *   - VRMAAnimationLoader.js  → VRMA proxy pipeline (VRoid Hub approach)
 *
 * This file handles: playback control, manifest, avatar registration,
 * and the public window.NEXUS_CLIP_LOADER API.
 *
 * Load order (all via <script defer>):
 *   1. ClipAnimationShared.js
 *   2. BVHAnimationLoader.js
 *   3. VRMAAnimationLoader.js
 *   4. ClipAnimationLoader.js  ← this file
 *
 * Exposes: window.NEXUS_CLIP_LOADER
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[ClipAnimationLoader] THREE not found');
        return;
    }

    var S = window.__CLIP_ANIM_STATE__;
    var C = window.__CLIP_ANIM_CONST__;
    if (!S || !C) {
        console.warn('[ClipAnimationLoader] ClipAnimationShared not loaded — falling back');
        return;
    }

    var BVH = window.__BVH_LOADER__;
    var VRMA = window.__VRMA_LOADER__;

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function getMixerRoot() {
        if (S.avatarVRM && S.avatarVRM.scene) return S.avatarVRM.scene;
        return S.avatarRoot;
    }

    function resetPlaybackState() {
        S.currentAction = null;
        S.currentClipPath = null;
        S.currentCategory = null;
    }

    // =========================================================================
    // MANIFEST
    // =========================================================================

    function loadManifest() {
        return fetch(S.basePath + '/manifest.json')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                S.manifest = data || {};
                if (data && data.basePath) S.basePath = data.basePath;
                console.log(
                    '[ClipAnimationLoader] Manifest loaded:',
                    S.manifest && S.manifest.categories ? Object.keys(S.manifest.categories).length : 0,
                    'categories'
                );
                return S.manifest;
            })
            .catch(function (err) {
                console.warn('[ClipAnimationLoader] Could not load manifest:', err);
                S.manifest = null;
                return null;
            });
    }

    // =========================================================================
    // LOADING (delegates to BVH / VRMA sub-loaders)
    // =========================================================================

    function loadClip(path) {
        if (!path || typeof path !== 'string') return Promise.resolve(null);
        var lower = path.toLowerCase();
        if (lower.slice(-4) === '.bvh') return BVH ? BVH.loadBVH(path) : Promise.resolve(null);
        if (lower.slice(-5) === '.vrma') return VRMA ? VRMA.loadVRMA(path) : Promise.resolve(null);
        return Promise.resolve(null);
    }

    // =========================================================================
    // PLAYBACK
    // =========================================================================

    function playClip(path, loopOrOptions) {
        if (!S.avatarRoot) {
            try {
                var v = window.NEXUS_VIEWER;
                if (v && v.avatarManager && v.avatarManager.currentRoot)
                    registerAvatar(v.avatarManager.currentRoot, v.avatarManager._currentVRM);
            } catch (_) {}
            if (!S.avatarRoot) {
                console.warn('[ClipAnimationLoader] No avatar — cannot play');
                return Promise.resolve(false);
            }
        }

        var opts = {};
        if (typeof loopOrOptions === 'object' && loopOrOptions !== null) opts = loopOrOptions;
        else opts.loop = !!loopOrOptions;
        if (typeof opts.loop !== 'boolean') opts.loop = true;
        if (typeof opts.fadeIn !== 'number') opts.fadeIn = 0.3;
        if (typeof opts.fadeOut !== 'number') opts.fadeOut = 0.25;

        return loadClip(path).then(function (clip) {
            if (!clip) return false;
            stopClip({ fadeOut: opts.fadeOut, _skipRestore: true });

            // Detect VRMA: the new pipeline targets vrm.scene directly for bone
            // tracks, but VRMRoot + expression proxy tracks still need the proxy
            // root. We create TWO mixers: one on vrm.scene for bone tracks, and
            // the proxy root is mixed into the same mixer since bone tracks
            // reference normalized bone node names that exist under vrm.scene.
            //
            // Official approach: mixer on vrm.scene, bone tracks target normalized
            // node names, VRMRoot + expression proxies are children of a separate
            // root that gets its own mini-mixer (or we add proxy root to scene).
            var isVRMA =
                String(path || '')
                    .toLowerCase()
                    .slice(-5) === '.vrma';
            S.isCurrentClipVRMA = isVRMA;

            // Mixer root:
            // - VRMA: vrm.scene (bone tracks target normalized bone node names)
            // - BVH: vrm.scene or avatar root (raw bone targeting)
            var mixerRoot = getMixerRoot();
            if (!mixerRoot) return false;

            // For VRMA: add proxy root as child of scene so the mixer can find
            // VRMRoot + expression proxy nodes alongside normalized bone nodes.
            if (isVRMA && S.vrmaProxyRoot) {
                // Remove old proxy root if present
                if (S._proxyAddedToScene && S._proxyAddedToScene.parent) {
                    S._proxyAddedToScene.parent.remove(S._proxyAddedToScene);
                }
                mixerRoot.add(S.vrmaProxyRoot);
                S._proxyAddedToScene = S.vrmaProxyRoot;
            }

            if (!S.currentMixer || S.currentMixer.getRoot() !== mixerRoot) {
                if (S.currentMixer) {
                    try {
                        S.currentMixer.stopAllAction();
                    } catch (_) {}
                }
                S.currentMixer = new THREE.AnimationMixer(mixerRoot);
            }

            // ProceduralAnimator yields entirely while clip plays
            if (window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer) {
                window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false);
            }

            // VRMA: autoUpdateHumanBones=true (mixer writes normalized → humanoid syncs to raw)
            // BVH:  autoUpdateHumanBones=false (mixer writes raw bones directly)
            C.setHumanoidAutoUpdate(isVRMA, S.avatarVRM);

            S.currentAction = S.currentMixer.clipAction(clip);
            S.currentAction.enabled = true;
            S.currentAction.clampWhenFinished = !opts.loop;
            S.currentAction.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, opts.loop ? Infinity : 1);
            S.currentAction.reset().fadeIn(opts.fadeIn).play();
            S.currentClipPath = path;
            S.currentCategory = opts.category || null;
            S.clipIsPlaying = true;
            console.log(
                '[ClipAnimationLoader] Playing:',
                clip.name,
                opts.loop ? '(loop)' : '(once)',
                isVRMA ? '(vrm.scene direct)' : '(raw)'
            );
            return true;
        });
    }

    function stopClip(options) {
        options = options || {};
        var fadeOut = typeof options.fadeOut === 'number' ? options.fadeOut : 0.3;
        if (S.currentAction) {
            try {
                S.currentAction.fadeOut(fadeOut);
            } catch (_) {}
            S.currentAction = null;
        }
        S.currentClipPath = null;
        S.currentCategory = null;
        S.clipIsPlaying = false;
        S.isCurrentClipVRMA = false;

        // Restore scene rotation if VRMRoot was animated
        if (VRMA && VRMA.restoreSceneRotation) {
            VRMA.restoreSceneRotation();
        }
        S.vrmaRootProxy = null;

        // Remove proxy root from scene
        if (S._proxyAddedToScene && S._proxyAddedToScene.parent) {
            S._proxyAddedToScene.parent.remove(S._proxyAddedToScene);
            S._proxyAddedToScene = null;
        }

        if (!options._skipRestore && window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer) {
            window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(true);
        }
        if (!options._skipRestore) {
            // Procedural mode: autoUpdateHumanBones=false so ProceduralAnimator
            // can write raw bones (breathing, base pose) without vrm.humanoid.update()
            // overwriting them. Head rotation uses normalized bones directly
            // (applyAdditiveEulerNormalized) and is unaffected by this flag.
            // NaturalPosePlugin's arm corrections are already baked into the
            // rest pose captured by captureRestPose() after fixTPose().
            C.setHumanoidAutoUpdate(false, S.avatarVRM);
        }

        return Promise.resolve(true);
    }

    function update(dt) {
        if (S.currentMixer && typeof dt === 'number' && isFinite(dt) && dt > 0) S.currentMixer.update(dt);

        // VRMA: copy proxy quaternions → normalized bones
        if (VRMA) VRMA.syncProxies();
    }

    // =========================================================================
    // AVATAR REGISTRATION
    // =========================================================================

    function registerAvatar(root, vrm) {
        S.avatarRoot = root || null;
        S.avatarVRM = vrm || null;
        if (!S.avatarVRM) {
            try {
                var v = window.NEXUS_VIEWER;
                if (v && v.avatarManager) S.avatarVRM = v.avatarManager._currentVRM || null;
            } catch (_) {}
        }
        S.loadedClips = {};
        S.loadingQueue = {};
        S.cachedBoneMap = null;
        S.vrmaProxyRoot = null;
        S.vrmaProxyEntries = [];
        S.vrmaExpressionEntries = [];
        S.vrmaRootProxy = null;
        S.isCurrentClipVRMA = false;
        if (S.currentMixer) {
            try {
                S.currentMixer.stopAllAction();
            } catch (_) {}
            S.currentMixer = null;
        }
        resetPlaybackState();
        if (S.avatarRoot) {
            S.cachedBoneMap = C.buildAvatarBoneMap(S.avatarRoot, S.avatarVRM);
            // Start in procedural mode: autoUpdateHumanBones=false so
            // ProceduralAnimator's raw bone writes aren't overwritten.
            C.setHumanoidAutoUpdate(false, S.avatarVRM);
            console.log('[ClipAnimationLoader] Avatar registered. Bones:', Object.keys(S.cachedBoneMap).join(', '));
            console.log(
                '[ClipAnimationLoader] Required dance bones:',
                Object.keys(C.getRequiredBoneMap(S.cachedBoneMap)).join(', ')
            );
        }
    }

    // =========================================================================
    // QUERY HELPERS
    // =========================================================================

    function getManifest() {
        return S.manifest;
    }
    function getCategories() {
        return S.manifest && S.manifest.categories ? S.manifest.categories : {};
    }
    function getCurrentPlaybackState() {
        return { clip: S.currentClipPath, category: S.currentCategory, isPlaying: S.clipIsPlaying };
    }

    function getAllAnimations() {
        if (!S.manifest || !S.manifest.categories) return [];
        var result = [],
            cats = S.manifest.categories,
            keys = Object.keys(cats);
        for (var c = 0; c < keys.length; c++) {
            var cat = cats[keys[c]] || {},
                files = cat.files || [];
            for (var f = 0; f < files.length; f++) {
                var file = files[f];
                var name = String(file)
                    .split('/')
                    .pop()
                    .replace(/\.(bvh|vrma|fbx)$/i, '');
                var label = name
                    .replace(/^(action_|dance_|exercise_|emotion_)/, '')
                    .replace(/_/g, ' ')
                    .replace(/(\d+)$/, ' $1')
                    .trim();
                label = label ? label.charAt(0).toUpperCase() + label.slice(1) : file;
                result.push({
                    id: file,
                    label: label,
                    category: keys[c],
                    categoryLabel: cat.label || keys[c],
                    icon: cat.icon || '',
                });
            }
        }
        return result;
    }

    function preloadEmotion(emotionId) {
        if (!S.manifest || !S.manifest.emotionMapping) return;
        var files = S.manifest.emotionMapping[emotionId];
        if (files && files.length) loadClip(files[0]);
    }

    function playEmotionClip(emotionId, loop) {
        if (!S.manifest || !S.manifest.emotionMapping) return Promise.resolve(false);
        var files = S.manifest.emotionMapping[emotionId];
        if (!files || !files.length) return Promise.resolve(false);
        return playClip(files[Math.floor(Math.random() * files.length)], !!loop);
    }

    function playPreferredClip(files, options) {
        if (!files || !files.length) return Promise.resolve(false);
        return playClip(files[0], options || {});
    }

    function playIntentClip(intent, options) {
        if (!S.manifest) return Promise.resolve(false);
        var files =
            (S.manifest.intentMapping && S.manifest.intentMapping[intent]) ||
            (S.manifest.emotionMapping && S.manifest.emotionMapping[intent]) ||
            null;
        if (!files || !files.length) return Promise.resolve(false);
        return playPreferredClip(files, options || {});
    }

    // =========================================================================
    // AUTO-LOAD MANIFEST
    // =========================================================================

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadManifest);
    else loadManifest();

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    window.NEXUS_CLIP_LOADER = {
        loadManifest: loadManifest,
        loadClip: loadClip,
        playClip: playClip,
        stopClip: stopClip,
        update: update,
        registerAvatar: registerAvatar,
        getManifest: getManifest,
        getCategories: getCategories,
        getCurrentPlaybackState: getCurrentPlaybackState,
        getAllAnimations: getAllAnimations,
        preloadEmotion: preloadEmotion,
        playEmotionClip: playEmotionClip,
        playPreferredClip: playPreferredClip,
        playIntentClip: playIntentClip,
        // Constants (exposed for external use)
        REQUIRED_DANCE_BONES: C.REQUIRED_DANCE_BONES,
        OPTIONAL_DANCE_BONES: C.OPTIONAL_DANCE_BONES,
        REQUIRED_DANCE_MAP: C.REQUIRED_DANCE_MAP,
        OPTIONAL_DANCE_MAP: C.OPTIONAL_DANCE_MAP,
        BVH_TO_AVATAR_SAMPLE_A: C.BVH_TO_AVATAR_SAMPLE_A,
        LIKELY_CORRECTION_BONES: C.LIKELY_CORRECTION_BONES,
        BONE_CORRECTION_PRESETS: C.BONE_CORRECTION_PRESETS,
    };

    console.log('[ClipAnimationLoader] Initialized (orchestrator)');
})();
