'use strict';

/**
 * ClipAnimationShared — Shared state, constants, bone maps, and utilities
 * for the clip animation system (BVH + VRMA loaders).
 *
 * All sub-modules (BVHAnimationLoader, VRMAAnimationLoader, ClipAnimationLoader)
 * communicate through window.__CLIP_ANIM_STATE__ which holds mutable state,
 * and window.__CLIP_ANIM_CONST__ which holds read-only constants/utilities.
 *
 * Load order: this file MUST load before BVHAnimationLoader, VRMAAnimationLoader,
 * and ClipAnimationLoader.
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[ClipAnimationShared] THREE not found');
        return;
    }

    // =========================================================================
    // BONE CONSTANTS
    // =========================================================================

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

    var REQUIRED_DANCE_BONES = [
        'hips',
        'spine',
        'chest',
        'upperChest',
        'neck',
        'head',
        'leftShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightShoulder',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
        'leftUpperLeg',
        'leftLowerLeg',
        'leftFoot',
        'leftToes',
        'rightUpperLeg',
        'rightLowerLeg',
        'rightFoot',
        'rightToes',
    ];

    var OPTIONAL_DANCE_BONES = [
        'leftEye',
        'rightEye',
        'leftThumbMetacarpal',
        'rightThumbMetacarpal',
        'leftThumbProximal',
        'leftThumbIntermediate',
        'leftThumbDistal',
        'leftIndexProximal',
        'leftIndexIntermediate',
        'leftIndexDistal',
        'leftMiddleProximal',
        'leftMiddleIntermediate',
        'leftMiddleDistal',
        'leftRingProximal',
        'leftRingIntermediate',
        'leftRingDistal',
        'leftLittleProximal',
        'leftLittleIntermediate',
        'leftLittleDistal',
        'rightThumbProximal',
        'rightThumbIntermediate',
        'rightThumbDistal',
        'rightIndexProximal',
        'rightIndexIntermediate',
        'rightIndexDistal',
        'rightMiddleProximal',
        'rightMiddleIntermediate',
        'rightMiddleDistal',
        'rightRingProximal',
        'rightRingIntermediate',
        'rightRingDistal',
        'rightLittleProximal',
        'rightLittleIntermediate',
        'rightLittleDistal',
    ];

    var REQUIRED_DANCE_MAP = {
        hips: 'J_Bip_C_Hips',
        spine: 'J_Bip_C_Spine',
        chest: 'J_Bip_C_Chest',
        upperChest: 'J_Bip_C_UpperChest',
        neck: 'J_Bip_C_Neck',
        head: 'J_Bip_C_Head',
        leftShoulder: 'J_Bip_L_Shoulder',
        leftUpperArm: 'J_Bip_L_UpperArm',
        leftLowerArm: 'J_Bip_L_LowerArm',
        leftHand: 'J_Bip_L_Hand',
        rightShoulder: 'J_Bip_R_Shoulder',
        rightUpperArm: 'J_Bip_R_UpperArm',
        rightLowerArm: 'J_Bip_R_LowerArm',
        rightHand: 'J_Bip_R_Hand',
        leftUpperLeg: 'J_Bip_L_UpperLeg',
        leftLowerLeg: 'J_Bip_L_LowerLeg',
        leftFoot: 'J_Bip_L_Foot',
        leftToes: 'J_Bip_L_ToeBase',
        rightUpperLeg: 'J_Bip_R_UpperLeg',
        rightLowerLeg: 'J_Bip_R_LowerLeg',
        rightFoot: 'J_Bip_R_Foot',
        rightToes: 'J_Bip_R_ToeBase',
    };

    var OPTIONAL_DANCE_MAP = {
        leftEye: 'J_Adj_L_FaceEye',
        rightEye: 'J_Adj_R_FaceEye',
        leftThumbProximal: 'J_Bip_L_Thumb1',
        leftThumbIntermediate: 'J_Bip_L_Thumb2',
        leftThumbDistal: 'J_Bip_L_Thumb3',
        leftIndexProximal: 'J_Bip_L_Index1',
        leftIndexIntermediate: 'J_Bip_L_Index2',
        leftIndexDistal: 'J_Bip_L_Index3',
        leftMiddleProximal: 'J_Bip_L_Middle1',
        leftMiddleIntermediate: 'J_Bip_L_Middle2',
        leftMiddleDistal: 'J_Bip_L_Middle3',
        leftRingProximal: 'J_Bip_L_Ring1',
        leftRingIntermediate: 'J_Bip_L_Ring2',
        leftRingDistal: 'J_Bip_L_Ring3',
        leftLittleProximal: 'J_Bip_L_Little1',
        leftLittleIntermediate: 'J_Bip_L_Little2',
        leftLittleDistal: 'J_Bip_L_Little3',
        rightThumbProximal: 'J_Bip_R_Thumb1',
        rightThumbIntermediate: 'J_Bip_R_Thumb2',
        rightThumbDistal: 'J_Bip_R_Thumb3',
        rightIndexProximal: 'J_Bip_R_Index1',
        rightIndexIntermediate: 'J_Bip_R_Index2',
        rightIndexDistal: 'J_Bip_R_Index3',
        rightMiddleProximal: 'J_Bip_R_Middle1',
        rightMiddleIntermediate: 'J_Bip_R_Middle2',
        rightMiddleDistal: 'J_Bip_R_Middle3',
        rightRingProximal: 'J_Bip_R_Ring1',
        rightRingIntermediate: 'J_Bip_R_Ring2',
        rightRingDistal: 'J_Bip_R_Ring3',
        rightLittleProximal: 'J_Bip_R_Little1',
        rightLittleIntermediate: 'J_Bip_R_Little2',
        rightLittleDistal: 'J_Bip_R_Little3',
    };

    var LIKELY_CORRECTION_BONES = [
        'leftUpperArm',
        'rightUpperArm',
        'leftLowerArm',
        'rightLowerArm',
        'leftHand',
        'rightHand',
    ];

    var BONE_CORRECTION_PRESETS = {
        leftUpperArm: [0, 0, 0, 1],
        rightUpperArm: [0, 0, 0, 1],
        leftLowerArm: [0, 0, 0, 1],
        rightLowerArm: [0, 0, 0, 1],
        leftHand: [0, 0, 0, 1],
        rightHand: [0, 0, 0, 1],
    };

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    function hasFn(obj, name) {
        return !!(obj && typeof obj[name] === 'function');
    }

    function safeGet(obj, path) {
        var c = obj;
        for (var i = 0; i < path.length; i++) {
            if (!c) return null;
            c = c[path[i]];
        }
        return c || null;
    }

    function normalizeBoneKey(name) {
        return String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
    }

    function cloneQuaternionArray(v) {
        var o = new Float32Array(v.length);
        for (var i = 0; i < v.length; i++) o[i] = v[i];
        return o;
    }

    function assignMap(t, s) {
        for (var k in s) {
            if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
        }
        return t;
    }

    function isArray(v) {
        return Object.prototype.toString.call(v) === '[object Array]';
    }

    // =========================================================================
    // BONE MAPPING (shared by BVH + VRMA)
    // =========================================================================

    function buildAvatarBoneMap(root, avatarVRM) {
        var map = {};
        if (!root) return map;
        var allBones = [],
            byName = {};
        root.traverse(function (o) {
            if (o && o.isBone) {
                allBones.push(o);
                if (o.name && !byName[o.name]) byName[o.name] = o;
            }
        });

        // Strategy 1: VRM humanoid API (raw bones for AnimationMixer)
        var humanoid = null;
        if (avatarVRM && avatarVRM.humanoid) humanoid = avatarVRM.humanoid;
        if (!humanoid && root.userData && root.userData.vrmHumanoid) humanoid = root.userData.vrmHumanoid;
        if (humanoid) {
            var getBone = null;
            if (typeof humanoid.getRawBoneNode === 'function') getBone = humanoid.getRawBoneNode.bind(humanoid);
            else if (typeof humanoid.getNormalizedBoneNode === 'function')
                getBone = humanoid.getNormalizedBoneNode.bind(humanoid);
            if (getBone) {
                for (var i = 0; i < VRM_BONES.length; i++) {
                    try {
                        var node = getBone(VRM_BONES[i]);
                        if (node) map[VRM_BONES[i]] = node;
                    } catch (_) {}
                }
                for (var j = 0; j < OPTIONAL_DANCE_BONES.length; j++) {
                    try {
                        var on = getBone(OPTIONAL_DANCE_BONES[j]);
                        if (on) map[OPTIONAL_DANCE_BONES[j]] = on;
                    } catch (_) {}
                }
            }
            if (Object.keys(map).length > 5) {
                console.log('[ClipAnim] Bone map via VRM humanoid:', Object.keys(map).length, 'bones');
                return map;
            }
        }

        // Strategy 2: exact canonical name match
        var exact = {};
        var cmaps = [REQUIRED_DANCE_MAP, OPTIONAL_DANCE_MAP];
        for (var c = 0; c < cmaps.length; c++) {
            var m = cmaps[c];
            for (var hn in m) {
                if (!Object.prototype.hasOwnProperty.call(m, hn)) continue;
                var eb = byName[m[hn]] || null;
                if (eb) exact[hn] = eb;
            }
        }
        if (Object.keys(exact).length >= REQUIRED_DANCE_BONES.length * 0.8) {
            console.log('[ClipAnim] Bone map via canonical names:', Object.keys(exact).length, 'bones');
            return exact;
        }

        // Strategy 3: fuzzy name match
        map = {};
        for (var b = 0; b < allBones.length; b++) {
            var bone = allBones[b],
                n = normalizeBoneKey(bone.name);
            if (!map.hips && (n.indexOf('hip') >= 0 || n.indexOf('pelvis') >= 0 || n === 'hips' || n === 'root'))
                map.hips = bone;
            else if (!map.spine && n.indexOf('spine') >= 0 && n.indexOf('1') === -1 && n.indexOf('2') === -1)
                map.spine = bone;
            else if (!map.chest && (n.indexOf('chest') >= 0 || n.indexOf('spine1') >= 0)) map.chest = bone;
            else if (!map.upperChest && (n.indexOf('upperchest') >= 0 || n.indexOf('spine2') >= 0))
                map.upperChest = bone;
            else if (!map.neck && n.indexOf('neck') >= 0) map.neck = bone;
            else if (!map.head && n.indexOf('head') >= 0 && n.indexOf('end') === -1) map.head = bone;
            else if (!map.leftShoulder && n.indexOf('left') >= 0 && n.indexOf('shoulder') >= 0) map.leftShoulder = bone;
            else if (!map.rightShoulder && n.indexOf('right') >= 0 && n.indexOf('shoulder') >= 0)
                map.rightShoulder = bone;
            else if (
                !map.leftUpperArm &&
                n.indexOf('left') >= 0 &&
                (n.indexOf('upperarm') >= 0 ||
                    (n.indexOf('arm') >= 0 && n.indexOf('fore') === -1 && n.indexOf('lower') === -1))
            )
                map.leftUpperArm = bone;
            else if (
                !map.rightUpperArm &&
                n.indexOf('right') >= 0 &&
                (n.indexOf('upperarm') >= 0 ||
                    (n.indexOf('arm') >= 0 && n.indexOf('fore') === -1 && n.indexOf('lower') === -1))
            )
                map.rightUpperArm = bone;
            else if (
                !map.leftLowerArm &&
                n.indexOf('left') >= 0 &&
                (n.indexOf('lowerarm') >= 0 || n.indexOf('forearm') >= 0)
            )
                map.leftLowerArm = bone;
            else if (
                !map.rightLowerArm &&
                n.indexOf('right') >= 0 &&
                (n.indexOf('lowerarm') >= 0 || n.indexOf('forearm') >= 0)
            )
                map.rightLowerArm = bone;
            else if (
                !map.leftHand &&
                n.indexOf('left') >= 0 &&
                n.indexOf('hand') >= 0 &&
                n.indexOf('arm') === -1 &&
                n.indexOf('thumb') === -1 &&
                n.indexOf('index') === -1
            )
                map.leftHand = bone;
            else if (
                !map.rightHand &&
                n.indexOf('right') >= 0 &&
                n.indexOf('hand') >= 0 &&
                n.indexOf('arm') === -1 &&
                n.indexOf('thumb') === -1 &&
                n.indexOf('index') === -1
            )
                map.rightHand = bone;
            else if (
                !map.leftUpperLeg &&
                n.indexOf('left') >= 0 &&
                (n.indexOf('upperleg') >= 0 || n.indexOf('thigh') >= 0 || n.indexOf('upleg') >= 0)
            )
                map.leftUpperLeg = bone;
            else if (
                !map.rightUpperLeg &&
                n.indexOf('right') >= 0 &&
                (n.indexOf('upperleg') >= 0 || n.indexOf('thigh') >= 0 || n.indexOf('upleg') >= 0)
            )
                map.rightUpperLeg = bone;
            else if (
                !map.leftLowerLeg &&
                n.indexOf('left') >= 0 &&
                (n.indexOf('lowerleg') >= 0 ||
                    n.indexOf('shin') >= 0 ||
                    (n.indexOf('leg') >= 0 && n.indexOf('upper') === -1 && n.indexOf('thigh') === -1))
            )
                map.leftLowerLeg = bone;
            else if (
                !map.rightLowerLeg &&
                n.indexOf('right') >= 0 &&
                (n.indexOf('lowerleg') >= 0 ||
                    n.indexOf('shin') >= 0 ||
                    (n.indexOf('leg') >= 0 && n.indexOf('upper') === -1 && n.indexOf('thigh') === -1))
            )
                map.rightLowerLeg = bone;
            else if (!map.leftFoot && n.indexOf('left') >= 0 && n.indexOf('foot') >= 0) map.leftFoot = bone;
            else if (!map.rightFoot && n.indexOf('right') >= 0 && n.indexOf('foot') >= 0) map.rightFoot = bone;
            else if (!map.leftToes && n.indexOf('left') >= 0 && n.indexOf('toe') >= 0) map.leftToes = bone;
            else if (!map.rightToes && n.indexOf('right') >= 0 && n.indexOf('toe') >= 0) map.rightToes = bone;
        }
        console.log('[ClipAnim] Bone map via fuzzy match:', Object.keys(map).length, 'bones');
        return map;
    }

    function getRequiredBoneMap(fullMap) {
        var out = {};
        for (var i = 0; i < REQUIRED_DANCE_BONES.length; i++) {
            var b = REQUIRED_DANCE_BONES[i];
            if (fullMap[b]) out[b] = fullMap[b];
        }
        return out;
    }

    function _setHumanoidAutoUpdate(enabled, avatarVRM) {
        var vrm = avatarVRM || safeGet(window, ['NEXUS_VIEWER', 'avatarManager', '_currentVRM']);
        if (vrm && vrm.humanoid && 'autoUpdateHumanBones' in vrm.humanoid) {
            vrm.humanoid.autoUpdateHumanBones = !!enabled;
        }
    }

    // =========================================================================
    // COMBINED CANONICAL MAP
    // =========================================================================

    var BVH_TO_AVATAR_SAMPLE_A = {};
    assignMap(BVH_TO_AVATAR_SAMPLE_A, REQUIRED_DANCE_MAP);
    assignMap(BVH_TO_AVATAR_SAMPLE_A, OPTIONAL_DANCE_MAP);

    // =========================================================================
    // SHARED MUTABLE STATE
    // =========================================================================

    window.__CLIP_ANIM_STATE__ = {
        manifest: null,
        loadedClips: {},
        loadingQueue: {},
        currentMixer: null,
        currentAction: null,
        currentClipPath: null,
        currentCategory: null,
        clipIsPlaying: false,
        avatarRoot: null,
        avatarVRM: null,
        basePath: 'vendor/animations',
        cachedBoneMap: null,
        // VRMA proxy
        vrmaProxyRoot: null,
        vrmaProxyEntries: [],
        vrmaExpressionEntries: [],
        vrmaRootProxy: null,
        isCurrentClipVRMA: false,
    };

    // =========================================================================
    // READ-ONLY CONSTANTS + UTILITIES
    // =========================================================================

    window.__CLIP_ANIM_CONST__ = {
        VRM_BONES: VRM_BONES,
        REQUIRED_DANCE_BONES: REQUIRED_DANCE_BONES,
        OPTIONAL_DANCE_BONES: OPTIONAL_DANCE_BONES,
        REQUIRED_DANCE_MAP: REQUIRED_DANCE_MAP,
        OPTIONAL_DANCE_MAP: OPTIONAL_DANCE_MAP,
        BVH_TO_AVATAR_SAMPLE_A: BVH_TO_AVATAR_SAMPLE_A,
        LIKELY_CORRECTION_BONES: LIKELY_CORRECTION_BONES,
        BONE_CORRECTION_PRESETS: BONE_CORRECTION_PRESETS,
        // Utilities
        hasFn: hasFn,
        safeGet: safeGet,
        normalizeBoneKey: normalizeBoneKey,
        cloneQuaternionArray: cloneQuaternionArray,
        assignMap: assignMap,
        isArray: isArray,
        // Bone mapping
        buildAvatarBoneMap: buildAvatarBoneMap,
        getRequiredBoneMap: getRequiredBoneMap,
        setHumanoidAutoUpdate: _setHumanoidAutoUpdate,
    };

    console.log('[ClipAnimationShared] Initialized');
})();
