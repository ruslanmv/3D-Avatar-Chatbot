'use strict';

/**
 * ClipAnimationLoader — Loads BVH and VRMA animation files for avatar playback.
 * ===============================================================================
 * Reads the animation manifest from vendor/animations/manifest.json,
 * loads BVH files via THREE.BVHLoader, retargets them to the current avatar,
 * and exposes them through AnimationManager for UI selection.
 *
 * Supports:
 *   - .bvh files (via THREE.BVHLoader)
 *   - .vrma files (via @pixiv/three-vrm-animation or GLTFLoader fallback)
 *   - On-demand lazy loading (load clips only when selected)
 *   - Animation manifest with categories for UI organization
 *
 * Exposes: window.NEXUS_CLIP_LOADER
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[ClipAnimationLoader] THREE not found');
        return;
    }

    // ── State ──
    var manifest = null;
    var loadedClips = {}; // path -> THREE.AnimationClip
    var loadingQueue = {}; // path -> Promise
    var currentMixer = null;
    var currentAction = null;
    var avatarRoot = null;
    var avatarVRM = null; // VRM instance (for humanoid bone access)
    var bvhLoader = null;
    var basePath = 'vendor/animations';

    // ── BVH Loader (lazy init) ──
    function getBVHLoader() {
        if (bvhLoader) return bvhLoader;
        if (THREE.BVHLoader) {
            bvhLoader = new THREE.BVHLoader();
            return bvhLoader;
        }
        // Try to create from imported module
        if (window.BVHLoader) {
            bvhLoader = new window.BVHLoader();
            return bvhLoader;
        }
        return null;
    }

    // ── BVH Bone Name Mapping ──
    // Maps common BVH bone names to VRM/standard humanoid names
    var BVH_TO_VRM_MAP = {
        hips: 'hips',
        hip: 'hips',
        pelvis: 'hips',
        spine: 'spine',
        spine1: 'chest',
        spine2: 'upperChest',
        chest: 'chest',
        neck: 'neck',
        head: 'head',
        leftshoulder: 'leftShoulder',
        rightshoulder: 'rightShoulder',
        leftupperarm: 'leftUpperArm',
        leftarm: 'leftUpperArm',
        rightupperarm: 'rightUpperArm',
        rightarm: 'rightUpperArm',
        leftforearm: 'leftLowerArm',
        leftlowerarm: 'leftLowerArm',
        rightforearm: 'rightLowerArm',
        rightlowerarm: 'rightLowerArm',
        lefthand: 'leftHand',
        righthand: 'rightHand',
        leftupleg: 'leftUpperLeg',
        leftupperleg: 'leftUpperLeg',
        leftthigh: 'leftUpperLeg',
        rightupleg: 'rightUpperLeg',
        rightupperleg: 'rightUpperLeg',
        rightthigh: 'rightUpperLeg',
        leftleg: 'leftLowerLeg',
        leftlowerleg: 'leftLowerLeg',
        rightleg: 'rightLowerLeg',
        rightlowerleg: 'rightLowerLeg',
        leftfoot: 'leftFoot',
        rightfoot: 'rightFoot',
        lefttoebase: 'leftToes',
        righttoebase: 'rightToes',
    };

    /**
     * Retarget a BVH clip's track names to match the avatar's bone names.
     */
    /**
     * Build a map of VRM humanoid bone name → actual scene bone object.
     * Uses fuzzy matching (same approach as ProceduralAnimator.findBones).
     */
    function buildAvatarBoneMap(root) {
        var map = {}; // vrm humanoid name → actual bone Object3D

        if (!root) return map;

        // Collect all bones from the scene graph
        var allBones = [];
        root.traverse(function (o) {
            if (o && o.isBone) allBones.push(o);
        });

        // Strategy 1: Try VRM humanoid API first (most accurate)
        var humanoid = avatarVRM?.humanoid;
        if (!humanoid && root.userData?.vrmHumanoid) {
            humanoid = root.userData.vrmHumanoid;
        }
        if (humanoid) {
            var VRM_BONES = [
                'hips',
                'spine',
                'chest',
                'upperChest',
                'neck',
                'head',
                'leftShoulder',
                'rightShoulder',
                'leftUpperArm',
                'rightUpperArm',
                'leftLowerArm',
                'rightLowerArm',
                'leftHand',
                'rightHand',
                'leftUpperLeg',
                'rightUpperLeg',
                'leftLowerLeg',
                'rightLowerLeg',
                'leftFoot',
                'rightFoot',
                'leftToes',
                'rightToes',
            ];
            var getBone =
                typeof humanoid.getRawBoneNode === 'function'
                    ? humanoid.getRawBoneNode.bind(humanoid)
                    : typeof humanoid.getNormalizedBoneNode === 'function'
                      ? humanoid.getNormalizedBoneNode.bind(humanoid)
                      : null;
            if (getBone) {
                for (var i = 0; i < VRM_BONES.length; i++) {
                    try {
                        var node = getBone(VRM_BONES[i]);
                        if (node) map[VRM_BONES[i]] = node;
                    } catch (_) {}
                }
            }
            if (Object.keys(map).length > 5) {
                console.log(
                    '[ClipAnimationLoader] Bone map built via VRM humanoid API:',
                    Object.keys(map).length,
                    'bones'
                );
                return map;
            }
        }

        // Strategy 2: Fuzzy name matching (same as ProceduralAnimator.findBones)
        map = {};
        for (var b = 0; b < allBones.length; b++) {
            var bone = allBones[b];
            var n = (bone.name || '').toLowerCase();

            // hips
            if (!map.hips && (n.includes('hip') || n.includes('pelvis') || n === 'hips' || n === 'root')) {
                map.hips = bone;
            }
            // spine
            else if (!map.spine && n.includes('spine') && !n.includes('1') && !n.includes('2')) {
                map.spine = bone;
            }
            // chest
            else if (!map.chest && (n.includes('chest') || (n.includes('spine') && n.includes('1')))) {
                map.chest = bone;
            }
            // upperChest
            else if (
                !map.upperChest &&
                ((n.includes('upper') && n.includes('chest')) || (n.includes('spine') && n.includes('2')))
            ) {
                map.upperChest = bone;
            }
            // neck
            else if (!map.neck && n.includes('neck')) {
                map.neck = bone;
            }
            // head
            else if (!map.head && n.includes('head') && !n.includes('end')) {
                map.head = bone;
            }
            // left shoulder
            else if (!map.leftShoulder && n.includes('left') && n.includes('shoulder')) {
                map.leftShoulder = bone;
            }
            // right shoulder
            else if (!map.rightShoulder && n.includes('right') && n.includes('shoulder')) {
                map.rightShoulder = bone;
            }
            // left upper arm
            else if (
                !map.leftUpperArm &&
                n.includes('left') &&
                (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
            ) {
                map.leftUpperArm = bone;
            }
            // right upper arm
            else if (
                !map.rightUpperArm &&
                n.includes('right') &&
                (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
            ) {
                map.rightUpperArm = bone;
            }
            // left lower arm
            else if (!map.leftLowerArm && n.includes('left') && (n.includes('lowerarm') || n.includes('forearm'))) {
                map.leftLowerArm = bone;
            }
            // right lower arm
            else if (!map.rightLowerArm && n.includes('right') && (n.includes('lowerarm') || n.includes('forearm'))) {
                map.rightLowerArm = bone;
            }
            // left hand
            else if (
                !map.leftHand &&
                n.includes('left') &&
                n.includes('hand') &&
                !n.includes('arm') &&
                !n.includes('thumb') &&
                !n.includes('index') &&
                !n.includes('middle') &&
                !n.includes('ring') &&
                !n.includes('little')
            ) {
                map.leftHand = bone;
            }
            // right hand
            else if (
                !map.rightHand &&
                n.includes('right') &&
                n.includes('hand') &&
                !n.includes('arm') &&
                !n.includes('thumb') &&
                !n.includes('index') &&
                !n.includes('middle') &&
                !n.includes('ring') &&
                !n.includes('little')
            ) {
                map.rightHand = bone;
            }
            // left upper leg
            else if (
                !map.leftUpperLeg &&
                n.includes('left') &&
                (n.includes('upperleg') || n.includes('thigh') || n.includes('upleg'))
            ) {
                map.leftUpperLeg = bone;
            }
            // right upper leg
            else if (
                !map.rightUpperLeg &&
                n.includes('right') &&
                (n.includes('upperleg') || n.includes('thigh') || n.includes('upleg'))
            ) {
                map.rightUpperLeg = bone;
            }
            // left lower leg
            else if (
                !map.leftLowerLeg &&
                n.includes('left') &&
                (n.includes('lowerleg') ||
                    n.includes('shin') ||
                    (n.includes('leg') && !n.includes('upper') && !n.includes('thigh') && !n.includes('upleg')))
            ) {
                map.leftLowerLeg = bone;
            }
            // right lower leg
            else if (
                !map.rightLowerLeg &&
                n.includes('right') &&
                (n.includes('lowerleg') ||
                    n.includes('shin') ||
                    (n.includes('leg') && !n.includes('upper') && !n.includes('thigh') && !n.includes('upleg')))
            ) {
                map.rightLowerLeg = bone;
            }
            // left foot
            else if (!map.leftFoot && n.includes('left') && n.includes('foot')) {
                map.leftFoot = bone;
            }
            // right foot
            else if (!map.rightFoot && n.includes('right') && n.includes('foot')) {
                map.rightFoot = bone;
            }
            // left toes
            else if (!map.leftToes && n.includes('left') && n.includes('toe')) {
                map.leftToes = bone;
            }
            // right toes
            else if (!map.rightToes && n.includes('right') && n.includes('toe')) {
                map.rightToes = bone;
            }
        }

        console.log('[ClipAnimationLoader] Bone map built via fuzzy matching:', Object.keys(map).length, 'bones');
        return map;
    }

    // Cache the bone map (rebuilt on avatar registration)
    var cachedBoneMap = null;

    function retargetBVHClip(clip, targetRoot) {
        if (!clip || !clip.tracks) return clip;

        // Build or use cached bone map
        if (!cachedBoneMap) {
            cachedBoneMap = buildAvatarBoneMap(targetRoot);
        }
        var boneMap = cachedBoneMap;

        if (Object.keys(boneMap).length === 0) {
            console.warn('[ClipAnimationLoader] No bones found on avatar — cannot retarget');
            return clip;
        }

        var newTracks = [];
        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i];

            // THREE.BVHLoader produces track names in two possible formats:
            //   Format A: ".bones[BoneName].property"  (three.js standard)
            //   Format B: "BoneName.property"          (some loaders)
            // Extract the bone name and property for retargeting.
            var boneName, property;
            var bracketMatch = track.name.match(/\.bones\[(.+?)\]\.(.+)/);
            if (bracketMatch) {
                boneName = bracketMatch[1];
                property = bracketMatch[2];
            } else {
                var parts = track.name.split('.');
                boneName = parts[0];
                property = parts.slice(1).join('.');
            }

            // Map BVH bone name to VRM humanoid name
            var normalized = boneName.toLowerCase().replace(/[^a-z]/g, '');
            var vrmName = BVH_TO_VRM_MAP[normalized] || boneName;

            // Look up the actual avatar bone object
            var targetBone = boneMap[vrmName] || boneMap[boneName];
            if (!targetBone) {
                // Try case-insensitive match
                for (var key in boneMap) {
                    if (key.toLowerCase() === vrmName.toLowerCase() || key.toLowerCase() === normalized) {
                        targetBone = boneMap[key];
                        break;
                    }
                }
            }

            if (targetBone) {
                var newTrack = track.clone();
                newTrack.name = targetBone.name + '.' + property;
                newTracks.push(newTrack);
            }
        }

        if (newTracks.length === 0) {
            console.warn('[ClipAnimationLoader] No tracks could be retargeted for clip:', clip.name);
            clip._retargetFailed = true;
            return clip;
        }

        console.log(
            '[ClipAnimationLoader] Retargeted',
            newTracks.length,
            '/',
            clip.tracks.length,
            'tracks for:',
            clip.name
        );
        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    // ── Load Manifest ──
    function loadManifest() {
        return fetch(basePath + '/manifest.json')
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                manifest = data;
                if (data.basePath) basePath = data.basePath;
                console.log(
                    '[ClipAnimationLoader] Manifest loaded:',
                    Object.keys(data.categories).length,
                    'categories'
                );
                return data;
            })
            .catch(function (err) {
                console.warn('[ClipAnimationLoader] Could not load manifest:', err);
                return null;
            });
    }

    // ── Load a single BVH file ──
    function loadBVH(path) {
        if (loadedClips[path]) return Promise.resolve(loadedClips[path]);
        if (loadingQueue[path]) return loadingQueue[path];

        var loader = getBVHLoader();
        if (!loader) {
            console.warn('[ClipAnimationLoader] BVHLoader not available');
            return Promise.resolve(null);
        }

        var url = basePath + '/' + path;

        // Pre-validate the file is actual BVH data (not an HTML 404 page)
        loadingQueue[path] = fetch(url)
            .then(function (res) {
                if (!res.ok) {
                    console.warn('[ClipAnimationLoader] HTTP ' + res.status + ' for:', path);
                    delete loadingQueue[path];
                    return null;
                }
                return res.text();
            })
            .then(function (text) {
                if (!text) return null;

                // Detect HTML responses (server 404/error pages)
                var trimmed = text.trimStart();
                if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
                    console.warn('[ClipAnimationLoader] Got HTML instead of BVH for:', path);
                    delete loadingQueue[path];
                    return null;
                }

                // Check for valid BVH header
                if (!trimmed.startsWith('HIERARCHY')) {
                    console.warn('[ClipAnimationLoader] Invalid BVH (no HIERARCHY header):', path);
                    delete loadingQueue[path];
                    return null;
                }

                // Parse valid BVH text
                var result = loader.parse(text);
                if (result && result.clip) {
                    var clip = result.clip;
                    clip.name = path.split('/').pop().replace('.bvh', '');
                    if (avatarRoot) {
                        clip = retargetBVHClip(clip, avatarRoot);
                    }
                    loadedClips[path] = clip;
                    delete loadingQueue[path];
                    return clip;
                }
                delete loadingQueue[path];
                return null;
            })
            .catch(function (err) {
                console.warn('[ClipAnimationLoader] Failed to load BVH:', path, err);
                delete loadingQueue[path];
                return null;
            });

        return loadingQueue[path];
    }

    // ── Load a VRMA file (via GLTFLoader) ──
    function loadVRMA(path) {
        if (loadedClips[path]) return Promise.resolve(loadedClips[path]);
        if (loadingQueue[path]) return loadingQueue[path];

        loadingQueue[path] = new Promise(function (resolve) {
            var gltfLoader = window.NEXUS_VIEWER?.gltfLoader;
            if (!gltfLoader && THREE.GLTFLoader) {
                gltfLoader = new THREE.GLTFLoader();
            }
            if (!gltfLoader) {
                console.warn('[ClipAnimationLoader] No GLTFLoader available for VRMA');
                resolve(null);
                return;
            }

            gltfLoader.load(
                basePath + '/' + path,
                function (gltf) {
                    if (gltf.animations && gltf.animations.length > 0) {
                        var clip = gltf.animations[0];
                        clip.name = path.split('/').pop().replace('.vrma', '');

                        // Retarget VRMA: node indices → humanoid bone names → avatar bones
                        clip = retargetVRMAClip(clip, gltf);

                        loadedClips[path] = clip;
                        resolve(clip);
                    } else {
                        resolve(null);
                    }
                    delete loadingQueue[path];
                },
                undefined,
                function (err) {
                    console.warn('[ClipAnimationLoader] Failed to load VRMA:', path, err);
                    delete loadingQueue[path];
                    resolve(null);
                }
            );
        });

        return loadingQueue[path];
    }

    /**
     * Retarget a VRMA clip to the current avatar.
     * VRMA tracks reference nodes from the VRMA file's internal skeleton.
     * The VRMC_vrm_animation extension maps node indices to humanoid bone names.
     * We remap those to the avatar's actual bone names using cachedBoneMap.
     */
    function retargetVRMAClip(clip, gltf) {
        if (!clip || !clip.tracks) return clip;

        // Build bone map if not cached
        if (!cachedBoneMap) {
            cachedBoneMap = buildAvatarBoneMap(avatarRoot);
        }
        var boneMap = cachedBoneMap;

        // Extract VRMC_vrm_animation humanoid bone mapping
        var vrmAnimExt = null;
        try {
            vrmAnimExt = gltf.parser?.json?.extensions?.VRMC_vrm_animation;
        } catch (_) {}
        if (!vrmAnimExt && gltf.userData?.gltfExtensions) {
            vrmAnimExt = gltf.userData.gltfExtensions.VRMC_vrm_animation;
        }

        // Build VRMA node name → humanoid bone name
        var nodeNameToHumanoid = {};
        if (vrmAnimExt && vrmAnimExt.humanoid && vrmAnimExt.humanoid.humanBones) {
            var humanBones = vrmAnimExt.humanoid.humanBones;
            try {
                var nodes = gltf.parser?.json?.nodes || [];
                for (var boneName in humanBones) {
                    if (humanBones.hasOwnProperty(boneName)) {
                        var nodeIdx = humanBones[boneName].node;
                        if (nodeIdx !== undefined && nodes[nodeIdx]) {
                            nodeNameToHumanoid[nodes[nodeIdx].name] = boneName;
                        }
                    }
                }
            } catch (_) {}
        }

        var newTracks = [];
        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i];
            var parts = track.name.split('.');
            var trackNodeName = parts[0];
            var property = parts.slice(1).join('.');

            // Map VRMA node name → humanoid bone name → avatar bone
            var humanoidName = nodeNameToHumanoid[trackNodeName];
            var targetBone = humanoidName ? boneMap[humanoidName] : null;

            // Fallback: direct name match
            if (!targetBone) targetBone = boneMap[trackNodeName];

            if (targetBone) {
                var newTrack = track.clone();
                newTrack.name = targetBone.name + '.' + property;
                newTracks.push(newTrack);
            }
        }

        if (newTracks.length === 0) {
            console.warn('[ClipAnimationLoader] No VRMA tracks retargeted for:', clip.name);
            return clip;
        }

        console.log(
            '[ClipAnimationLoader] VRMA retargeted',
            newTracks.length,
            '/',
            clip.tracks.length,
            'tracks for:',
            clip.name
        );
        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    // ── Load any supported file ──
    function loadClip(path) {
        if (path.endsWith('.bvh')) return loadBVH(path);
        if (path.endsWith('.vrma')) return loadVRMA(path);
        return Promise.resolve(null);
    }

    // ── Play a clip on the current avatar ──
    function playClip(path, loop) {
        if (!avatarRoot) {
            console.warn('[ClipAnimationLoader] No avatar registered — trying to find from NEXUS_VIEWER');
            // Auto-recover: try to register from current viewer state
            try {
                var viewer = window.NEXUS_VIEWER;
                if (viewer && viewer.avatarManager) {
                    var mgr = viewer.avatarManager;
                    if (mgr.currentRoot) {
                        registerAvatar(mgr.currentRoot, mgr._currentVRM);
                    }
                }
            } catch (_) {}
            if (!avatarRoot) {
                console.warn('[ClipAnimationLoader] Still no avatar — cannot play');
                return Promise.resolve(false);
            }
        }

        return loadClip(path).then(function (clip) {
            if (!clip) return false;

            // Stop current
            stopClip();

            // Create mixer if needed — use VRM scene if available for proper bone binding
            if (!currentMixer) {
                var mixerRoot = avatarRoot;
                // VRM models: use vrm.scene which is the proper root with skeleton
                if (avatarVRM && avatarVRM.scene) {
                    mixerRoot = avatarVRM.scene;
                }
                currentMixer = new THREE.AnimationMixer(mixerRoot);
            }

            currentAction = currentMixer.clipAction(clip);
            currentAction.clampWhenFinished = !loop;
            currentAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
            currentAction.reset().fadeIn(0.3).play();

            console.log('[ClipAnimationLoader] Playing:', clip.name, loop ? '(loop)' : '(once)');
            return true;
        });
    }

    // ── Stop current clip ──
    function stopClip() {
        if (currentAction) {
            currentAction.fadeOut(0.3);
            currentAction = null;
        }
    }

    // ── Update mixer (call from animation loop) ──
    function update(dt) {
        if (currentMixer) {
            currentMixer.update(dt);
        }
    }

    // ── Register avatar root ──
    function registerAvatar(root, vrm) {
        avatarRoot = root;
        avatarVRM = vrm || null;

        // Try to find VRM from NEXUS_VIEWER if not passed directly
        if (!avatarVRM) {
            try {
                var viewer = window.NEXUS_VIEWER;
                if (viewer && viewer.avatarManager) {
                    avatarVRM = viewer.avatarManager._currentVRM || null;
                }
            } catch (_) {}
        }

        // Clear cached clips and bone map (need re-retargeting for new avatar)
        loadedClips = {};
        loadingQueue = {};
        cachedBoneMap = null;
        if (currentMixer) {
            currentMixer.stopAllAction();
            currentMixer = null;
        }
        currentAction = null;

        // Pre-build bone map immediately so we can log what we found
        cachedBoneMap = buildAvatarBoneMap(root);
        console.log('[ClipAnimationLoader] Avatar registered. Bones found:', Object.keys(cachedBoneMap).join(', '));
    }

    // ── Get manifest data ──
    function getManifest() {
        return manifest;
    }

    function getCategories() {
        if (!manifest || !manifest.categories) return {};
        return manifest.categories;
    }

    /**
     * Get a flat list of all animations for UI display.
     * Returns: [{ id: path, label: name, category: catKey, icon: catIcon }]
     */
    function getAllAnimations() {
        if (!manifest || !manifest.categories) return [];
        var result = [];
        var cats = manifest.categories;
        var keys = Object.keys(cats);
        for (var c = 0; c < keys.length; c++) {
            var catKey = keys[c];
            var cat = cats[catKey];
            var files = cat.files || [];
            for (var f = 0; f < files.length; f++) {
                var file = files[f];
                var name = file
                    .split('/')
                    .pop()
                    .replace(/\.(bvh|vrma|fbx)$/i, '');
                // Make label human-readable
                var label = name
                    .replace(/^(action_|dance_|exercise_|emotion_)/, '')
                    .replace(/_/g, ' ')
                    .replace(/(\d+)$/, ' $1')
                    .trim();
                label = label.charAt(0).toUpperCase() + label.slice(1);
                result.push({
                    id: file,
                    label: label,
                    category: catKey,
                    categoryLabel: cat.label,
                    icon: cat.icon,
                });
            }
        }
        return result;
    }

    /**
     * Preload clips for a specific emotion (for instant playback).
     */
    function preloadEmotion(emotionId) {
        if (!manifest || !manifest.emotionMapping) return;
        var files = manifest.emotionMapping[emotionId];
        if (!files) return;
        // Load first file for instant access
        loadClip(files[0]);
    }

    /**
     * Play a random clip for an emotion.
     */
    function playEmotionClip(emotionId, loop) {
        if (!manifest || !manifest.emotionMapping) return Promise.resolve(false);
        var files = manifest.emotionMapping[emotionId];
        if (!files || files.length === 0) return Promise.resolve(false);
        var randomFile = files[Math.floor(Math.random() * files.length)];
        return playClip(randomFile, loop);
    }

    // ── Auto-load manifest on script load ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadManifest);
    } else {
        loadManifest();
    }

    // ── Expose ──
    window.NEXUS_CLIP_LOADER = {
        loadManifest: loadManifest,
        loadClip: loadClip,
        playClip: playClip,
        stopClip: stopClip,
        update: update,
        registerAvatar: registerAvatar,
        getManifest: getManifest,
        getCategories: getCategories,
        getAllAnimations: getAllAnimations,
        preloadEmotion: preloadEmotion,
        playEmotionClip: playEmotionClip,
    };

    console.log('[ClipAnimationLoader] Initialized — BVH/VRMA clip loading system');
})();
