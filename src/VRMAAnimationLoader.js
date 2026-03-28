'use strict';

/**
 * VRMAAnimationLoader — VRMA animation loading and retargeting.
 * ================================================================
 * Clean rewrite following the official @pixiv/three-vrm-animation pipeline.
 *
 * Reference: https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-animation
 *
 * Official pipeline (what VRoid Hub does):
 *   1. Load .vrma via GLTFLoader + VRMAnimationLoaderPlugin
 *   2. VRMAnimationLoaderPlugin extracts VRMC_vrm_animation extension
 *   3. createVRMAnimationClip(vrmAnimation, vrm) retargets:
 *      a. Bone rotation tracks → target normalized bone node names on vrm.scene
 *      b. VRM 0.x models: negate X and Z quaternion components (coordinate flip)
 *      c. Hips position → scale by target/animation hips height ratio
 *      d. Expression tracks → target expressionManager property paths
 *      e. LookAt → VRMLookAtQuaternionProxy
 *   4. AnimationMixer on vrm.scene plays the clip
 *   5. vrm.update() syncs normalized → raw bones each frame
 *
 * Key differences from proxy-based approach:
 *   - Mixer targets vrm.scene directly (bone tracks reference normalized node names)
 *   - NO proxy Object3D system needed for bones
 *   - VRM 0.x coordinate system handled via X/Z negation (not w>=0 normalization)
 *   - Hips position included and height-scaled
 *   - VRMRoot + expressions still use proxies (universal compatibility)
 *
 * Depends on: ClipAnimationShared.js (must load first)
 * Exposes: window.__VRMA_LOADER__
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) return;

    var S; // shared state — assigned in _init()
    var C; // shared constants — assigned in _init()

    function _init() {
        S = window.__CLIP_ANIM_STATE__;
        C = window.__CLIP_ANIM_CONST__;
        if (!S || !C) {
            console.warn('[VRMALoader] ClipAnimationShared not loaded');
            return false;
        }
        return true;
    }

    // =====================================================================
    // 1. VRMC_vrm_animation EXTENSION EXTRACTION
    // =====================================================================

    /**
     * Extract VRMC_vrm_animation extension from a loaded glTF result.
     * Tries 3 paths: parser.json → userData → scene-level userData.
     */
    function extractVRMAExtension(gltf) {
        var ext = C.safeGet(gltf, ['parser', 'json', 'extensions', 'VRMC_vrm_animation']);
        var nodes = C.safeGet(gltf, ['parser', 'json', 'nodes']);
        if (ext && nodes) return { ext: ext, nodes: nodes };

        ext = C.safeGet(gltf, ['userData', 'gltfExtensions', 'VRMC_vrm_animation']);
        if (ext) {
            nodes = C.safeGet(gltf, ['parser', 'json', 'nodes']) || C.safeGet(gltf, ['userData', 'gltfNodes']);
            if (ext && nodes) return { ext: ext, nodes: nodes };
        }

        ext =
            C.safeGet(gltf, ['scene', 'userData', 'gltfExtensions', 'VRMC_vrm_animation']) ||
            C.safeGet(gltf, ['scenes', 0, 'userData', 'gltfExtensions', 'VRMC_vrm_animation']);
        if (ext) {
            nodes = [];
            if (gltf.scene) {
                gltf.scene.traverse(function (obj) {
                    if (obj.name) nodes.push({ name: obj.name });
                });
            }
            if (nodes.length > 0) return { ext: ext, nodes: nodes };
        }
        return null;
    }

    // =====================================================================
    // 2. HUMANOID + EXPRESSION MAPPING
    // =====================================================================

    /** Build VRMA node name → humanoid bone name mapping. */
    function buildNodeToHumanoidMap(vrmAnimExt, nodes) {
        var map = {};
        if (!vrmAnimExt || !vrmAnimExt.humanoid || !vrmAnimExt.humanoid.humanBones) return map;
        var hb = vrmAnimExt.humanoid.humanBones;
        for (var bn in hb) {
            if (!Object.prototype.hasOwnProperty.call(hb, bn)) continue;
            var ni = hb[bn].node;
            if (ni !== undefined && nodes[ni] && nodes[ni].name) {
                map[nodes[ni].name] = bn;
            }
        }
        return map;
    }

    /** Build VRMA node name → expression name mapping. */
    function buildNodeToExpressionMap(vrmAnimExt, nodes) {
        var map = {};
        if (!vrmAnimExt) return map;
        var sections = ['expressions', 'blendShapeGroups'];
        for (var s = 0; s < sections.length; s++) {
            var section = vrmAnimExt[sections[s]];
            if (!section) continue;
            // Handle preset/custom subsections
            var subs = ['preset', 'custom'];
            for (var ss = 0; ss < subs.length; ss++) {
                var sub = section[subs[ss]];
                if (!sub) continue;
                for (var name in sub) {
                    if (!Object.prototype.hasOwnProperty.call(sub, name)) continue;
                    var ni = sub[name].node;
                    if (ni !== undefined && nodes[ni] && nodes[ni].name) {
                        map[nodes[ni].name] = name;
                    }
                }
            }
            // Handle flat expression maps
            if (typeof section === 'object' && !section.preset && !section.custom) {
                for (var en in section) {
                    if (!Object.prototype.hasOwnProperty.call(section, en)) continue;
                    if (en === 'preset' || en === 'custom') continue;
                    var eni = section[en].node;
                    if (eni !== undefined && nodes[eni] && nodes[eni].name) {
                        map[nodes[eni].name] = en;
                    }
                }
            }
        }
        return map;
    }

    /** J_Bip fallback for when VRMC_vrm_animation extension is inaccessible. */
    function buildJBipFallbackMap() {
        return {
            J_Bip_C_Hips: 'hips',
            J_Bip_C_Spine: 'spine',
            J_Bip_C_Chest: 'chest',
            J_Bip_C_UpperChest: 'upperChest',
            J_Bip_C_Neck: 'neck',
            J_Bip_C_Head: 'head',
            J_Bip_L_Shoulder: 'leftShoulder',
            J_Bip_L_UpperArm: 'leftUpperArm',
            J_Bip_L_LowerArm: 'leftLowerArm',
            J_Bip_L_Hand: 'leftHand',
            J_Bip_R_Shoulder: 'rightShoulder',
            J_Bip_R_UpperArm: 'rightUpperArm',
            J_Bip_R_LowerArm: 'rightLowerArm',
            J_Bip_R_Hand: 'rightHand',
            J_Bip_L_UpperLeg: 'leftUpperLeg',
            J_Bip_L_LowerLeg: 'leftLowerLeg',
            J_Bip_L_Foot: 'leftFoot',
            J_Bip_L_ToeBase: 'leftToes',
            J_Bip_R_UpperLeg: 'rightUpperLeg',
            J_Bip_R_LowerLeg: 'rightLowerLeg',
            J_Bip_R_Foot: 'rightFoot',
            J_Bip_R_ToeBase: 'rightToes',
            J_Bip_L_Thumb1: 'leftThumbMetacarpal',
            J_Bip_L_Thumb2: 'leftThumbProximal',
            J_Bip_L_Thumb3: 'leftThumbDistal',
            J_Bip_L_Index1: 'leftIndexProximal',
            J_Bip_L_Index2: 'leftIndexIntermediate',
            J_Bip_L_Index3: 'leftIndexDistal',
            J_Bip_L_Middle1: 'leftMiddleProximal',
            J_Bip_L_Middle2: 'leftMiddleIntermediate',
            J_Bip_L_Middle3: 'leftMiddleDistal',
            J_Bip_L_Ring1: 'leftRingProximal',
            J_Bip_L_Ring2: 'leftRingIntermediate',
            J_Bip_L_Ring3: 'leftRingDistal',
            J_Bip_L_Little1: 'leftLittleProximal',
            J_Bip_L_Little2: 'leftLittleIntermediate',
            J_Bip_L_Little3: 'leftLittleDistal',
            J_Bip_R_Thumb1: 'rightThumbMetacarpal',
            J_Bip_R_Thumb2: 'rightThumbProximal',
            J_Bip_R_Thumb3: 'rightThumbDistal',
            J_Bip_R_Index1: 'rightIndexProximal',
            J_Bip_R_Index2: 'rightIndexIntermediate',
            J_Bip_R_Index3: 'rightIndexDistal',
            J_Bip_R_Middle1: 'rightMiddleProximal',
            J_Bip_R_Middle2: 'rightMiddleIntermediate',
            J_Bip_R_Middle3: 'rightMiddleDistal',
            J_Bip_R_Ring1: 'rightRingProximal',
            J_Bip_R_Ring2: 'rightRingIntermediate',
            J_Bip_R_Ring3: 'rightRingDistal',
            J_Bip_R_Little1: 'rightLittleProximal',
            J_Bip_R_Little2: 'rightLittleIntermediate',
            J_Bip_R_Little3: 'rightLittleDistal',
        };
    }

    // =====================================================================
    // 3. COORDINATE SYSTEM HANDLING
    // =====================================================================

    /**
     * Detect VRM model meta version: '0' for VRM 0.x, '1' for VRM 1.0+.
     *
     * This determines whether quaternion values need coordinate system
     * transformation. VRMA animations are in VRM 1.0 space. VRM 0.x models
     * use a different coordinate system (right-handed Z-forward vs
     * left-handed Z-back), requiring X and Z negation.
     */
    function getMetaVersion(vrm) {
        if (!vrm || !vrm.meta) return '0'; // default to 0.x for safety
        // three-vrm v2+: vrm.meta.metaVersion is '0' or '1'
        if (vrm.meta.metaVersion === '1') return '1';
        // VRM 0.x: metaVersion is '0' or undefined
        return '0';
    }

    /**
     * Transform quaternion values for VRM 0.x coordinate system.
     *
     * Official @pixiv/three-vrm-animation formula:
     *   values.map((v, i) => (metaVersion === '0' && i % 2 === 0) ? -v : v)
     *
     * This negates every even-indexed value in the flat array:
     *   [x₀, y₀, z₀, w₀, x₁, y₁, z₁, w₁, ...]
     *    ^       ^           ^       ^
     *    negate  negate      negate  negate
     *
     * Result per quaternion: (x, y, z, w) → (-x, y, -z, w)
     * This flips handedness from VRM 1.0 (VRMA) to VRM 0.x (model).
     */
    function transformQuatForVRM0(values) {
        var out = new Float32Array(values.length);
        for (var i = 0; i < values.length; i++) {
            out[i] = i % 2 === 0 ? -values[i] : values[i];
        }
        return out;
    }

    /**
     * Transform hips position values for VRM 0.x coordinate system.
     *
     * Official formula: negate X and Z (keep Y).
     *   values.map((v, i) => (metaVersion === '0' && i % 3 !== 1) ? -v : v)
     *
     * Result per vector: (x, y, z) → (-x, y, -z)
     */
    function transformPosForVRM0(values) {
        var out = new Float32Array(values.length);
        for (var i = 0; i < values.length; i++) {
            out[i] = i % 3 !== 1 ? -values[i] : values[i];
        }
        return out;
    }

    // =====================================================================
    // 4. RETARGETING — following createVRMAnimationClip()
    // =====================================================================

    /**
     * Retarget a VRMA clip onto the current VRM model.
     *
     * Following the official @pixiv/three-vrm-animation pipeline:
     *   - Bone rotation tracks target normalized bone node names directly
     *   - AnimationMixer on vrm.scene writes to normalized bones
     *   - VRM 0.x models get X/Z negation on quaternion values
     *   - Hips position is included and height-scaled
     *   - VRMRoot and expressions use lightweight proxies
     *   - No per-frame syncProxies() needed for bone quaternions
     */
    function retargetVRMAClip(clip, gltf) {
        if (!_init()) return clip;
        if (!clip || !clip.tracks) return clip;

        var humanoid = S.avatarVRM ? S.avatarVRM.humanoid : null;
        if (!humanoid || !C.hasFn(humanoid, 'getNormalizedBoneNode')) {
            console.warn('[VRMALoader] No VRM humanoid — cannot retarget');
            clip._retargetFailed = true;
            return clip;
        }

        var metaVersion = getMetaVersion(S.avatarVRM);
        var isVRM0 = metaVersion === '0';

        // Extract VRMC_vrm_animation extension
        var vrmaData = extractVRMAExtension(gltf);
        var nodeToHumanoid = vrmaData ? buildNodeToHumanoidMap(vrmaData.ext, vrmaData.nodes) : {};
        if (Object.keys(nodeToHumanoid).length === 0) {
            console.warn('[VRMALoader] Extension inaccessible, using J_Bip fallback');
            nodeToHumanoid = buildJBipFallbackMap();
        }
        var nodeToExpression = vrmaData ? buildNodeToExpressionMap(vrmaData.ext, vrmaData.nodes) : {};

        // Proxy root for VRMRoot + expression tracks (lightweight)
        var proxyRoot = new THREE.Object3D();
        proxyRoot.name = '__vrma_proxy_root';
        var exprProxyEntries = [];
        var vrmaRootProxy = null;

        var newTracks = [];
        var _dbg = { mapped: [], skipped: [], filtered: [], special: [] };

        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i];
            var parts = String(track.name || '').split('.');
            var trackNode = parts[0];
            var property = parts.slice(1).join('.');
            if (!trackNode || !property) continue;

            // ── Scale tracks: always skip ──
            if (property === 'scale') {
                _dbg.filtered.push(trackNode + '.scale');
                continue;
            }

            // ── VRMRoot: scene-level orientation ──
            if (trackNode === 'VRMRoot' && property === 'quaternion') {
                var rootName = '__vrma_root';
                vrmaRootProxy = new THREE.Object3D();
                vrmaRootProxy.name = rootName;
                proxyRoot.add(vrmaRootProxy);
                var rootValues = isVRM0 ? transformQuatForVRM0(track.values) : track.values;
                newTracks.push(new THREE.QuaternionKeyframeTrack(rootName + '.quaternion', track.times, rootValues));
                _dbg.special.push('VRMRoot (' + track.times.length + ' kf)');
                continue;
            }

            // ── lookAt: gaze direction ──
            if (trackNode === 'lookAt') {
                _dbg.special.push('lookAt.' + property + ' (ignored)');
                continue;
            }

            // ── Expression tracks ──
            var exprName = nodeToExpression[trackNode];
            if (exprName) {
                // VRMA encodes expressions as translation.x on dedicated nodes
                if (property === 'translation' || property === 'position') {
                    // Extract X component from vec3 values → scalar weight
                    var weightValues = new Float32Array(track.times.length);
                    for (var wi = 0; wi < track.times.length; wi++) {
                        weightValues[wi] = track.values[wi * 3]; // X component
                    }
                    var exprProxyName = '__vrma_expr_' + exprName;
                    var exprProxy = new THREE.Object3D();
                    exprProxy.name = exprProxyName;
                    exprProxy.userData = { weight: 0 };
                    proxyRoot.add(exprProxy);
                    exprProxyEntries.push({ proxy: exprProxy, expressionName: exprName });
                    newTracks.push(
                        new THREE.NumberKeyframeTrack(exprProxyName + '.userData[weight]', track.times, weightValues)
                    );
                    _dbg.mapped.push(exprName + ' (expr)');
                } else if (property === 'weight' || property === 'number') {
                    // Some VRMA files store expressions as direct weight tracks
                    var exprProxyName = '__vrma_expr_' + exprName;
                    var exprProxy = new THREE.Object3D();
                    exprProxy.name = exprProxyName;
                    exprProxy.userData = { weight: 0 };
                    proxyRoot.add(exprProxy);
                    exprProxyEntries.push({ proxy: exprProxy, expressionName: exprName });
                    newTracks.push(
                        new THREE.NumberKeyframeTrack(exprProxyName + '.userData[weight]', track.times, track.values)
                    );
                    _dbg.mapped.push(exprName + ' (expr)');
                }
                continue;
            }

            // ── Humanoid bone tracks ──
            var humanoidName = nodeToHumanoid[trackNode] || trackNode;

            if (property === 'quaternion') {
                // Look up the normalized bone node on the TARGET VRM
                var normNode = null;
                try {
                    normNode = humanoid.getNormalizedBoneNode(humanoidName);
                } catch (_) {}
                if (!normNode) {
                    _dbg.skipped.push(trackNode + '→' + humanoidName);
                    continue;
                }

                // Official approach: target normalized bone node name directly.
                // The AnimationMixer on vrm.scene finds these nodes by name.
                var targetName = normNode.name;
                var qValues = isVRM0 ? transformQuatForVRM0(track.values) : track.values;
                newTracks.push(new THREE.QuaternionKeyframeTrack(targetName + '.quaternion', track.times, qValues));
                _dbg.mapped.push(humanoidName);
            } else if (property === 'position' || property === 'translation') {
                // Only hips has meaningful position data in VRMA
                if (humanoidName !== 'hips') {
                    _dbg.filtered.push(trackNode + '.' + property);
                    continue;
                }
                var normNode = null;
                try {
                    normNode = humanoid.getNormalizedBoneNode('hips');
                } catch (_) {}
                if (!normNode) {
                    _dbg.skipped.push('hips.position');
                    continue;
                }

                // Scale hips position by height ratio (official approach)
                var pValues = new Float32Array(track.values);
                if (isVRM0) {
                    pValues = transformPosForVRM0(pValues);
                }
                // TODO: height scaling (animationHipsY / targetHipsY) when available

                newTracks.push(new THREE.VectorKeyframeTrack(normNode.name + '.position', track.times, pValues));
                _dbg.mapped.push('hips (pos)');
            }
        }

        // ── Diagnostics ──
        console.log('[VRMALoader] ── Retarget:', clip.name, '(VRM ' + metaVersion + '.x) ──');
        console.log('[VRMALoader]   Mapped:', _dbg.mapped.length, '→', _dbg.mapped.join(', '));
        if (_dbg.skipped.length) console.warn('[VRMALoader]   Skipped:', _dbg.skipped.join(', '));
        if (_dbg.filtered.length) console.log('[VRMALoader]   Filtered:', _dbg.filtered.join(', '));
        if (_dbg.special.length) console.log('[VRMALoader]   Special:', _dbg.special.join(', '));

        if (newTracks.length === 0) {
            console.warn('[VRMALoader] Retarget failed: 0 tracks');
            clip._retargetFailed = true;
            return clip;
        }

        // Store proxy state for VRMRoot + expressions
        S.vrmaRootProxy = vrmaRootProxy;
        S.vrmaExpressionEntries = exprProxyEntries;
        // Proxy root still needed for VRMRoot + expression mixer
        S.vrmaProxyRoot = proxyRoot;
        // No bone proxy entries needed — mixer targets normalized nodes directly
        S.vrmaProxyEntries = [];

        console.log('[VRMALoader] Retargeted:', newTracks.length, '/', clip.tracks.length, 'tracks for', clip.name);

        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    // =====================================================================
    // 5. LOADING
    // =====================================================================

    function loadVRMA(path) {
        if (!_init()) return Promise.resolve(null);

        if (S.loadedClips[path]) {
            // Restore cached proxy state
            var cached = S.loadedClips[path];
            if (cached._vrmaRootProxy !== undefined) {
                S.vrmaRootProxy = cached._vrmaRootProxy;
                S.vrmaExpressionEntries = cached._vrmaExpressionEntries || [];
                S.vrmaProxyRoot = cached._vrmaProxyRoot || null;
                S.vrmaProxyEntries = [];
            }
            return Promise.resolve(cached);
        }
        if (S.loadingQueue[path]) return S.loadingQueue[path];

        S.loadingQueue[path] = new Promise(function (resolve) {
            var gltfLoader = C.safeGet(window, ['NEXUS_VIEWER', 'gltfLoader']);
            if (!gltfLoader && THREE.GLTFLoader) gltfLoader = new THREE.GLTFLoader();
            if (!gltfLoader) {
                console.warn('[VRMALoader] No GLTFLoader');
                resolve(null);
                return;
            }
            gltfLoader.load(
                S.basePath + '/' + path,
                function (gltf) {
                    var clip = null;
                    if (gltf && gltf.animations && gltf.animations.length > 0) {
                        clip = gltf.animations[0];
                        clip.name = path
                            .split('/')
                            .pop()
                            .replace(/\.vrma$/i, '');
                        clip = retargetVRMAClip(clip, gltf);
                    }
                    if (!clip || clip._retargetFailed) {
                        delete S.loadingQueue[path];
                        resolve(null);
                        return;
                    }
                    // Cache proxy state alongside clip
                    clip._vrmaProxyRoot = S.vrmaProxyRoot;
                    clip._vrmaRootProxy = S.vrmaRootProxy;
                    clip._vrmaExpressionEntries = S.vrmaExpressionEntries || [];
                    S.loadedClips[path] = clip;
                    delete S.loadingQueue[path];
                    resolve(clip);
                },
                undefined,
                function (err) {
                    console.warn('[VRMALoader] Load failed:', path, err);
                    delete S.loadingQueue[path];
                    resolve(null);
                }
            );
        });
        return S.loadingQueue[path];
    }

    // =====================================================================
    // 6. PER-FRAME UPDATE — VRMRoot + Expressions only
    // =====================================================================

    // Original scene quaternion captured when clip starts, restored on stop.
    var _originalSceneQuat = null;

    /**
     * Per-frame sync for VRMRoot scene rotation and expression weights.
     *
     * With the direct-targeting approach, bone quaternions don't need
     * per-frame copying — the mixer writes to normalized bone nodes
     * directly. Only VRMRoot and expressions need manual sync.
     *
     * Call after mixer.update() each frame.
     */
    function syncProxies() {
        var S = window.__CLIP_ANIM_STATE__;
        if (!S || !S.isCurrentClipVRMA || !S.clipIsPlaying) return;

        // ── VRMRoot: scene-level orientation ──
        if (S.vrmaRootProxy && S.avatarVRM && S.avatarVRM.scene) {
            var scene = S.avatarVRM.scene;
            if (!_originalSceneQuat) {
                _originalSceneQuat = scene.quaternion.clone();
            }
            // Compose: original_facing × VRMRoot_animation
            scene.quaternion.copy(_originalSceneQuat).multiply(S.vrmaRootProxy.quaternion);
        }

        // ── Expression weights ──
        var entries = S.vrmaExpressionEntries;
        if (entries && entries.length > 0 && S.avatarVRM) {
            var mgr = S.avatarVRM.expressionManager;
            if (mgr) {
                for (var i = 0; i < entries.length; i++) {
                    var w = entries[i].proxy.userData.weight;
                    if (typeof w === 'number' && isFinite(w)) {
                        try {
                            mgr.setValue(entries[i].expressionName, w);
                        } catch (_) {}
                    }
                }
            }
        }
    }

    /** Restore scene quaternion when clip stops. */
    function restoreSceneRotation() {
        if (_originalSceneQuat) {
            var S = window.__CLIP_ANIM_STATE__;
            if (S && S.avatarVRM && S.avatarVRM.scene) {
                S.avatarVRM.scene.quaternion.copy(_originalSceneQuat);
            }
            _originalSceneQuat = null;
        }
    }

    // =====================================================================
    // 7. PUBLIC API
    // =====================================================================

    window.__VRMA_LOADER__ = {
        loadVRMA: loadVRMA,
        retargetVRMAClip: retargetVRMAClip,
        syncProxies: syncProxies,
        restoreSceneRotation: restoreSceneRotation,
    };

    console.log('[VRMAAnimationLoader] Initialized (official pipeline)');
})();
