'use strict';

/**
 * ClipAnimationLoader — Loads BVH and VRMA animation files for avatar playback.
 * ===============================================================================
 * Production fixes in this version:
 *   - Prefers VRM normalized humanoid bones over raw bones
 *   - Drops translation/root-motion tracks for BVH and VRMA clips
 *   - Applies safer BVH quaternion retargeting using target bind/rest pose
 *   - Rejects clips that retarget too few tracks
 *   - Supports both playClip(path, loop) and playClip(path, options)
 *   - Tracks current clip state and performs safer mixer cleanup
 *   - Uses explicit canonical humanoid mapping for dance BVH files
 *   - Separates required vs optional dance bones
 *   - Supports per-bone correction quaternions for basis mismatch fixes
 *
 * Exposes: window.NEXUS_CLIP_LOADER
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[ClipAnimationLoader] THREE not found');
        return;
    }

    var manifest = null;
    var loadedClips = {};
    var loadingQueue = {};
    var currentMixer = null;
    var currentAction = null;
    var currentClipPath = null;
    var currentCategory = null;
    var clipIsPlaying = false;
    var avatarRoot = null;
    var avatarVRM = null;
    var bvhLoader = null;
    var basePath = 'vendor/animations';
    var cachedBoneMap = null;

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

    var BVH_TO_AVATAR_SAMPLE_A = {};
    assignMap(BVH_TO_AVATAR_SAMPLE_A, REQUIRED_DANCE_MAP);
    assignMap(BVH_TO_AVATAR_SAMPLE_A, OPTIONAL_DANCE_MAP);

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

    var BVH_TO_VRM_MAP = {
        hips: 'hips',
        hip: 'hips',
        pelvis: 'hips',
        root: 'hips',
        spine: 'spine',
        spine1: 'chest',
        spine2: 'upperChest',
        chest: 'chest',
        upperchest: 'upperChest',
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
        lefttoe: 'leftToes',
        righttoe: 'rightToes',
        // Canonical J_Bip names (dance_1.bvh)
        jbipchips: 'hips',
        jbipcspine: 'spine',
        jbipcchest: 'chest',
        jbipcupperchest: 'upperChest',
        jbipcneck: 'neck',
        jbipchead: 'head',
        jadjlfaceeye: 'leftEye',
        jadjrfaceeye: 'rightEye',
        jbiplshoulder: 'leftShoulder',
        jbiplupperarm: 'leftUpperArm',
        jbipllowerarm: 'leftLowerArm',
        jbiplhand: 'leftHand',
        jbiprshoulder: 'rightShoulder',
        jbiprupperarm: 'rightUpperArm',
        jbiprlowerarm: 'rightLowerArm',
        jbiprhand: 'rightHand',
        jbiplupleg: 'leftUpperLeg',
        jbiplupperleg: 'leftUpperLeg',
        jbipllowerleg: 'leftLowerLeg',
        jbiplfoot: 'leftFoot',
        jbipltoebase: 'leftToes',
        jbiprupleg: 'rightUpperLeg',
        jbiprupperleg: 'rightUpperLeg',
        jbiprlowerleg: 'rightLowerLeg',
        jbiprfoot: 'rightFoot',
        jbiprtoebase: 'rightToes',
        jbiplthumb1: 'leftThumbProximal',
        jbiplthumb2: 'leftThumbIntermediate',
        jbiplthumb3: 'leftThumbDistal',
        jbiplindex1: 'leftIndexProximal',
        jbiplindex2: 'leftIndexIntermediate',
        jbiplindex3: 'leftIndexDistal',
        jbiplmiddle1: 'leftMiddleProximal',
        jbiplmiddle2: 'leftMiddleIntermediate',
        jbiplmiddle3: 'leftMiddleDistal',
        jbiplring1: 'leftRingProximal',
        jbiplring2: 'leftRingIntermediate',
        jbiplring3: 'leftRingDistal',
        jbipllittle1: 'leftLittleProximal',
        jbipllittle2: 'leftLittleIntermediate',
        jbipllittle3: 'leftLittleDistal',
        jbiprthumb1: 'rightThumbProximal',
        jbiprthumb2: 'rightThumbIntermediate',
        jbiprthumb3: 'rightThumbDistal',
        jbiprindex1: 'rightIndexProximal',
        jbiprindex2: 'rightIndexIntermediate',
        jbiprindex3: 'rightIndexDistal',
        jbiprmiddle1: 'rightMiddleProximal',
        jbiprmiddle2: 'rightMiddleIntermediate',
        jbiprmiddle3: 'rightMiddleDistal',
        jbiprring1: 'rightRingProximal',
        jbiprring2: 'rightRingIntermediate',
        jbiprring3: 'rightRingDistal',
        jbiprlittle1: 'rightLittleProximal',
        jbiprlittle2: 'rightLittleIntermediate',
        jbiprlittle3: 'rightLittleDistal',
    };

    // ── Utility helpers ──
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
    function getMixerRoot() {
        if (avatarVRM && avatarVRM.scene) return avatarVRM.scene;
        return avatarRoot;
    }
    function resetPlaybackState() {
        currentAction = null;
        currentClipPath = null;
        currentCategory = null;
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
    function countOwnKeys(o) {
        return o ? Object.keys(o).length : 0;
    }

    function getCorrectionQuaternionForBone(vrmName) {
        var arr = BONE_CORRECTION_PRESETS[vrmName];
        if (!arr || !isArray(arr) || arr.length !== 4) return null;
        return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]).normalize();
    }

    function getRequiredBoneMap(fullMap) {
        var out = {};
        for (var i = 0; i < REQUIRED_DANCE_BONES.length; i++) {
            var b = REQUIRED_DANCE_BONES[i];
            if (fullMap[b]) out[b] = fullMap[b];
        }
        return out;
    }
    function getOptionalBoneMap(fullMap) {
        var out = {};
        for (var i = 0; i < OPTIONAL_DANCE_BONES.length; i++) {
            var b = OPTIONAL_DANCE_BONES[i];
            if (fullMap[b]) out[b] = fullMap[b];
        }
        return out;
    }

    function isCanonicalDancePair(path) {
        var lp = String(path || '')
            .replace(/\\/g, '/')
            .toLowerCase();
        if (lp !== 'dance/dance_1.bvh' && lp !== 'vendor/animations/dance/dance_1.bvh') return false;
        var n =
            safeGet(avatarVRM, ['meta', 'name']) ||
            safeGet(avatarVRM, ['meta', 'title']) ||
            safeGet(avatarVRM, ['userData', 'vrmMeta', 'name']) ||
            safeGet(avatarRoot, ['userData', 'vrmMeta', 'name']) ||
            '';
        var r = safeGet(avatarRoot, ['name']) || '';
        var j = (String(n) + ' ' + String(r)).toLowerCase();
        return j.indexOf('avatarsample_a') >= 0 || j.indexOf('avatarsample a') >= 0;
    }

    function getBVHLoader() {
        if (bvhLoader) return bvhLoader;
        if (THREE.BVHLoader) {
            bvhLoader = new THREE.BVHLoader();
            return bvhLoader;
        }
        if (window.BVHLoader) {
            bvhLoader = new window.BVHLoader();
            return bvhLoader;
        }
        return null;
    }

    // ── Bone mapping ──
    function buildAvatarBoneMap(root) {
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

        // Strategy 1: VRM humanoid API
        //
        // IMPORTANT: use getRawBoneNode (not getNormalizedBoneNode).
        // Normalized bones are proxy objects NOT in the scene graph —
        // AnimationMixer cannot find them by name.  Raw bones are the
        // actual Three.js Object3D nodes in the scene hierarchy, so
        // tracks like "J_Bip_C_Hips.quaternion" resolve correctly.
        //
        // VRoid Hub uses @pixiv/three-vrm's createVRMAnimationClip()
        // which targets raw bones for the same reason.
        var humanoid = null;
        if (avatarVRM && avatarVRM.humanoid) humanoid = avatarVRM.humanoid;
        if (!humanoid && root.userData && root.userData.vrmHumanoid) humanoid = root.userData.vrmHumanoid;
        if (humanoid) {
            var getBone = null;
            // Prefer raw bones for AnimationMixer compatibility
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
                console.log('[ClipAnimationLoader] Bone map via VRM humanoid:', Object.keys(map).length, 'bones');
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
            console.log('[ClipAnimationLoader] Bone map via canonical names:', Object.keys(exact).length, 'bones');
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
        console.log('[ClipAnimationLoader] Bone map via fuzzy match:', Object.keys(map).length, 'bones');
        return map;
    }

    function buildSourceBVHBoneMap(skeleton) {
        var map = {};
        if (!skeleton || !skeleton.bones) return map;
        for (var i = 0; i < skeleton.bones.length; i++) {
            var bone = skeleton.bones[i];
            if (!bone) continue;
            var norm = normalizeBoneKey(bone.name);
            var vrm = BVH_TO_VRM_MAP[norm] || null;
            if (vrm && !map[vrm]) map[vrm] = bone;
            if (!map[bone.name]) map[bone.name] = bone;
            if (!map[norm]) map[norm] = bone;
        }
        return map;
    }

    function getTrackBoneAndProperty(trackName) {
        var m = String(trackName || '').match(/\.bones\[(.+?)\]\.(.+)/);
        if (m) return { boneName: m[1], property: m[2] };
        var p = String(trackName || '').split('.');
        return { boneName: p[0], property: p.slice(1).join('.') };
    }

    function resolveTargetBone(boneMap, sourceBoneName, explicitMap) {
        var norm = normalizeBoneKey(sourceBoneName),
            vrmName = null;
        if (explicitMap) {
            for (var h in explicitMap) {
                if (!Object.prototype.hasOwnProperty.call(explicitMap, h)) continue;
                if (normalizeBoneKey(explicitMap[h]) === norm || explicitMap[h] === sourceBoneName) {
                    vrmName = h;
                    break;
                }
            }
        }
        if (!vrmName) vrmName = BVH_TO_VRM_MAP[norm] || sourceBoneName;
        var target = boneMap[vrmName] || boneMap[sourceBoneName] || null;
        if (!target) {
            for (var k in boneMap) {
                if (!Object.prototype.hasOwnProperty.call(boneMap, k)) continue;
                if (String(k).toLowerCase() === String(vrmName).toLowerCase() || normalizeBoneKey(k) === norm) {
                    target = boneMap[k];
                    break;
                }
            }
        }
        return { targetBone: target, vrmName: vrmName };
    }

    function retargetQuaternionValues(trackValues, sourceBone, targetBone, vrmName) {
        if (!trackValues || !sourceBone || !targetBone) return trackValues;
        var out = cloneQuaternionArray(trackValues);
        var sRest = sourceBone.quaternion ? sourceBone.quaternion.clone() : new THREE.Quaternion();
        var tRest = targetBone.quaternion ? targetBone.quaternion.clone() : new THREE.Quaternion();
        var sRestInv = sRest.clone().invert();
        var correction = getCorrectionQuaternionForBone(vrmName);
        var qS = new THREE.Quaternion(),
            qD = new THREE.Quaternion(),
            qO = new THREE.Quaternion();
        for (var i = 0; i < out.length; i += 4) {
            qS.set(out[i], out[i + 1], out[i + 2], out[i + 3]).normalize();
            qD.copy(sRestInv).multiply(qS).normalize();
            qO.copy(tRest).multiply(qD).normalize();
            if (correction) qO.multiply(correction).normalize();
            out[i] = qO.x;
            out[i + 1] = qO.y;
            out[i + 2] = qO.z;
            out[i + 3] = qO.w;
        }
        return out;
    }

    // ── BVH retargeting ──
    function retargetBVHClip(clip, sourceSkeleton, targetRoot, clipPath) {
        if (!clip || !clip.tracks) return clip;
        if (!cachedBoneMap) cachedBoneMap = buildAvatarBoneMap(targetRoot);
        var boneMap = cachedBoneMap;
        if (!boneMap || Object.keys(boneMap).length === 0) {
            console.warn('[ClipAnimationLoader] No avatar bones — cannot retarget BVH');
            clip._retargetFailed = true;
            return clip;
        }
        var sourceBoneMap = buildSourceBVHBoneMap(sourceSkeleton);
        var newTracks = [],
            keptCount = 0,
            quatCount = 0,
            requiredMapped = {},
            requiredHitCount = 0;
        var useCanonical = isCanonicalDancePair(clipPath);
        var explicitMap = useCanonical ? BVH_TO_AVATAR_SAMPLE_A : null;
        if (useCanonical) console.log('[ClipAnimationLoader] Using canonical mapping for:', clipPath);

        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i],
                info = getTrackBoneAndProperty(track.name);
            var srcName = info.boneName,
                property = info.property;
            if (!srcName || !property) continue;
            var ti = resolveTargetBone(boneMap, srcName, explicitMap);
            var targetBone = ti.targetBone,
                vrmName = ti.vrmName;
            if (!targetBone) continue;
            if (property === 'position' || property === 'scale') continue; // drop translation/scale

            if (property === 'quaternion' && track.values && track.values.length >= 4) {
                var norm = normalizeBoneKey(srcName);
                var sBone = sourceBoneMap[vrmName] || sourceBoneMap[srcName] || sourceBoneMap[norm] || null;
                if (!sBone && explicitMap && explicitMap[vrmName])
                    sBone =
                        sourceBoneMap[explicitMap[vrmName]] ||
                        sourceBoneMap[normalizeBoneKey(explicitMap[vrmName])] ||
                        null;
                if (!sBone) continue;
                var retargeted = retargetQuaternionValues(track.values, sBone, targetBone, vrmName);
                newTracks.push(
                    new THREE.QuaternionKeyframeTrack(
                        targetBone.name + '.quaternion',
                        track.times.slice ? track.times.slice(0) : track.times,
                        retargeted
                    )
                );
                quatCount++;
                if (REQUIRED_DANCE_BONES.indexOf(vrmName) >= 0 && !requiredMapped[vrmName]) {
                    requiredMapped[vrmName] = true;
                    requiredHitCount++;
                }
            }
        }

        if (newTracks.length === 0) {
            console.warn('[ClipAnimationLoader] No BVH tracks retargeted:', clip.name);
            clip._retargetFailed = true;
            return clip;
        }
        if (quatCount < 6) {
            console.warn('[ClipAnimationLoader] Too few quaternion tracks:', clip.name, '(' + quatCount + ')');
            clip._retargetFailed = true;
            return clip;
        }
        if (useCanonical && requiredHitCount < Math.max(12, Math.floor(REQUIRED_DANCE_BONES.length * 0.75))) {
            console.warn(
                '[ClipAnimationLoader] Insufficient required bone coverage:',
                clip.name,
                '(' + requiredHitCount + '/' + REQUIRED_DANCE_BONES.length + ')'
            );
            clip._retargetFailed = true;
            return clip;
        }
        console.log(
            '[ClipAnimationLoader] BVH retargeted',
            newTracks.length,
            '/',
            clip.tracks.length,
            'tracks for:',
            clip.name
        );
        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    // ── VRMA retargeting ──
    /**
     * Extract VRMC_vrm_animation extension from a loaded glTF result.
     *
     * THREE.js GLTFLoader may dispose gltf.parser after load, making
     * gltf.parser.json inaccessible.  We try multiple paths:
     *   1. gltf.parser.json (works if parser not disposed)
     *   2. gltf.userData.gltfExtensions (VRM plugin path)
     *   3. Scene-level userData (fallback)
     */
    function _extractVRMAExtension(gltf) {
        // Path 1: parser.json (may be disposed in THREE.js r147+)
        var ext = safeGet(gltf, ['parser', 'json', 'extensions', 'VRMC_vrm_animation']);
        var nodes = safeGet(gltf, ['parser', 'json', 'nodes']);
        if (ext && nodes) return { ext: ext, nodes: nodes };

        // Path 2: userData.gltfExtensions (VRM plugin stores here)
        ext = safeGet(gltf, ['userData', 'gltfExtensions', 'VRMC_vrm_animation']);
        if (ext) {
            nodes = safeGet(gltf, ['parser', 'json', 'nodes']) || safeGet(gltf, ['userData', 'gltfNodes']);
            if (ext && nodes) return { ext: ext, nodes: nodes };
        }

        // Path 3: Reconstruct from the scene's node tree
        // VRMA files loaded by GLTFLoader have all nodes accessible in scene.children
        // Build node list from the scene hierarchy
        ext =
            safeGet(gltf, ['scene', 'userData', 'gltfExtensions', 'VRMC_vrm_animation']) ||
            safeGet(gltf, ['scenes', 0, 'userData', 'gltfExtensions', 'VRMC_vrm_animation']);
        if (ext) {
            // Build node name list from scene traversal
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

    /**
     * Build node name → humanoid bone name mapping from VRMA extension.
     *
     * VRMA files contain a VRMC_vrm_animation extension that maps humanoid
     * bone names (e.g., "hips") to node indices, and the node list maps
     * indices to names (e.g., "J_Bip_C_Hips").  This builds the reverse
     * mapping: "J_Bip_C_Hips" → "hips" so animation tracks targeting
     * "J_Bip_C_Hips.quaternion" can be retargeted to the avatar's actual
     * bone for "hips".
     */
    function _buildVRMANodeToHumanoid(vrmAnimExt, nodes) {
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

    function retargetVRMAClip(clip, gltf) {
        if (!clip || !clip.tracks) return clip;
        if (!cachedBoneMap) cachedBoneMap = buildAvatarBoneMap(avatarRoot);
        var boneMap = cachedBoneMap;
        if (!boneMap || Object.keys(boneMap).length === 0) {
            console.warn('[ClipAnimationLoader] VRMA retarget: no avatar bone map');
            clip._retargetFailed = true;
            return clip;
        }

        // Extract VRMC_vrm_animation extension (tries multiple access paths)
        var vrmaData = _extractVRMAExtension(gltf);
        var nodeNameToHumanoid = {};
        if (vrmaData) {
            nodeNameToHumanoid = _buildVRMANodeToHumanoid(vrmaData.ext, vrmaData.nodes);
        }

        // If extension extraction failed, build a fallback mapping from
        // common VRoid bone names (J_Bip_*) to VRM humanoid names.
        // This handles cases where gltf.parser.json is disposed.
        if (Object.keys(nodeNameToHumanoid).length === 0) {
            console.warn('[ClipAnimationLoader] VRMA extension not accessible, using fallback J_Bip mapping');
            nodeNameToHumanoid = _buildJBipFallbackMap();
        }

        var newTracks = [];
        var skippedCount = 0;
        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i],
                parts = String(track.name || '').split('.'),
                trackNode = parts[0],
                property = parts.slice(1).join('.');
            if (!trackNode || !property) continue;

            // Skip position/scale — only retarget rotations (prevents root motion)
            if (property === 'position' || property === 'scale') continue;

            // Map VRMA node name → VRM humanoid name → avatar bone
            var humanoidName = nodeNameToHumanoid[trackNode] || trackNode;
            var targetBone = boneMap[humanoidName] || boneMap[trackNode] || null;
            if (!targetBone) {
                skippedCount++;
                continue;
            }
            if (property === 'quaternion')
                newTracks.push(
                    new THREE.QuaternionKeyframeTrack(targetBone.name + '.quaternion', track.times, track.values)
                );
        }
        if (newTracks.length === 0) {
            console.warn(
                '[ClipAnimationLoader] VRMA retarget failed: 0 tracks mapped (' +
                    skippedCount +
                    ' skipped). nodeNameToHumanoid has ' +
                    Object.keys(nodeNameToHumanoid).length +
                    ' entries, boneMap has ' +
                    Object.keys(boneMap).length +
                    ' entries'
            );
            clip._retargetFailed = true;
            return clip;
        }
        console.log(
            '[ClipAnimationLoader] VRMA retargeted',
            newTracks.length,
            '/',
            clip.tracks.length,
            'tracks for:',
            clip.name,
            '(' + skippedCount + ' skipped)'
        );
        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    /**
     * Fallback mapping for VRoid-standard J_Bip bone names.
     * Used when VRMC_vrm_animation extension cannot be extracted from
     * the VRMA file (e.g., gltf.parser disposed after load in THREE.js r147+).
     */
    function _buildJBipFallbackMap() {
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
            // Finger bones
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

    // ── Manifest ──
    function loadManifest() {
        return fetch(basePath + '/manifest.json')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                manifest = data || {};
                if (data && data.basePath) basePath = data.basePath;
                console.log(
                    '[ClipAnimationLoader] Manifest loaded:',
                    manifest && manifest.categories ? Object.keys(manifest.categories).length : 0,
                    'categories'
                );
                return manifest;
            })
            .catch(function (err) {
                console.warn('[ClipAnimationLoader] Could not load manifest:', err);
                manifest = null;
                return null;
            });
    }

    // ── Loaders ──
    function loadBVH(path) {
        if (loadedClips[path]) return Promise.resolve(loadedClips[path]);
        if (loadingQueue[path]) return loadingQueue[path];
        var loader = getBVHLoader();
        if (!loader) {
            console.warn('[ClipAnimationLoader] BVHLoader not available');
            return Promise.resolve(null);
        }
        loadingQueue[path] = fetch(basePath + '/' + path)
            .then(function (res) {
                if (!res.ok) {
                    delete loadingQueue[path];
                    return null;
                }
                return res.text();
            })
            .then(function (text) {
                if (!text) return null;
                var trimmed = String(text)
                    .replace(/^\uFEFF/, '')
                    .trimStart();
                if (trimmed.charAt(0) === '<') {
                    console.warn('[ClipAnimationLoader] Got HTML instead of BVH:', path);
                    delete loadingQueue[path];
                    return null;
                }
                if (trimmed.indexOf('HIERARCHY') !== 0) {
                    console.warn('[ClipAnimationLoader] Invalid BVH:', path);
                    delete loadingQueue[path];
                    return null;
                }
                var result = loader.parse(text);
                if (!result || !result.clip) {
                    delete loadingQueue[path];
                    return null;
                }
                var clip = result.clip;
                clip.name = path
                    .split('/')
                    .pop()
                    .replace(/\.bvh$/i, '');
                if (avatarRoot) clip = retargetBVHClip(clip, result.skeleton, avatarRoot, path);
                if (!clip || clip._retargetFailed) {
                    delete loadingQueue[path];
                    return null;
                }
                loadedClips[path] = clip;
                delete loadingQueue[path];
                return clip;
            })
            .catch(function (err) {
                console.warn('[ClipAnimationLoader] Failed to load BVH:', path, err);
                delete loadingQueue[path];
                return null;
            });
        return loadingQueue[path];
    }

    function loadVRMA(path) {
        if (loadedClips[path]) return Promise.resolve(loadedClips[path]);
        if (loadingQueue[path]) return loadingQueue[path];
        loadingQueue[path] = new Promise(function (resolve) {
            var gltfLoader = safeGet(window, ['NEXUS_VIEWER', 'gltfLoader']);
            if (!gltfLoader && THREE.GLTFLoader) gltfLoader = new THREE.GLTFLoader();
            if (!gltfLoader) {
                console.warn('[ClipAnimationLoader] No GLTFLoader for VRMA');
                resolve(null);
                return;
            }
            gltfLoader.load(
                basePath + '/' + path,
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
                        delete loadingQueue[path];
                        resolve(null);
                        return;
                    }
                    loadedClips[path] = clip;
                    delete loadingQueue[path];
                    resolve(clip);
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

    function loadClip(path) {
        if (!path || typeof path !== 'string') return Promise.resolve(null);
        var lower = path.toLowerCase();
        if (lower.slice(-4) === '.bvh') return loadBVH(path);
        if (lower.slice(-5) === '.vrma') return loadVRMA(path);
        return Promise.resolve(null);
    }

    // ── Playback ──
    function playClip(path, loopOrOptions) {
        if (!avatarRoot) {
            try {
                var v = window.NEXUS_VIEWER;
                if (v && v.avatarManager && v.avatarManager.currentRoot)
                    registerAvatar(v.avatarManager.currentRoot, v.avatarManager._currentVRM);
            } catch (_) {}
            if (!avatarRoot) {
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
            var mixerRoot = getMixerRoot();
            if (!mixerRoot) return false;
            if (!currentMixer || currentMixer.getRoot() !== mixerRoot) {
                if (currentMixer) {
                    try {
                        currentMixer.stopAllAction();
                    } catch (_) {}
                }
                currentMixer = new THREE.AnimationMixer(mixerRoot);
            }

            // VRoid Hub–style exclusive clip playback:
            // ProceduralAnimator yields entirely while clip plays,
            // preventing breathing/head-look from fighting the VRMA.
            if (window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer) {
                window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false);
            }

            currentAction = currentMixer.clipAction(clip);
            currentAction.enabled = true;
            currentAction.clampWhenFinished = !opts.loop;
            currentAction.setLoop(opts.loop ? THREE.LoopRepeat : THREE.LoopOnce, opts.loop ? Infinity : 1);
            currentAction.reset().fadeIn(opts.fadeIn).play();
            currentClipPath = path;
            currentCategory = opts.category || null;
            clipIsPlaying = true;
            console.log('[ClipAnimationLoader] Playing:', clip.name, opts.loop ? '(loop)' : '(once)');
            return true;
        });
    }

    function stopClip(options) {
        options = options || {};
        var fadeOut = typeof options.fadeOut === 'number' ? options.fadeOut : 0.3;
        if (currentAction) {
            try {
                currentAction.fadeOut(fadeOut);
            } catch (_) {}
            currentAction = null;
        }
        currentClipPath = null;
        currentCategory = null;
        clipIsPlaying = false;

        // Restore ProceduralAnimator control when clip stops
        // (skip during clip-to-clip transitions to avoid flicker)
        if (!options._skipRestore && window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer) {
            window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(true);
        }

        return Promise.resolve(true);
    }

    function update(dt) {
        if (currentMixer && typeof dt === 'number' && isFinite(dt) && dt > 0) currentMixer.update(dt);
    }

    // ── Avatar registration ──
    function registerAvatar(root, vrm) {
        avatarRoot = root || null;
        avatarVRM = vrm || null;
        if (!avatarVRM) {
            try {
                var v = window.NEXUS_VIEWER;
                if (v && v.avatarManager) avatarVRM = v.avatarManager._currentVRM || null;
            } catch (_) {}
        }
        loadedClips = {};
        loadingQueue = {};
        cachedBoneMap = null;
        if (currentMixer) {
            try {
                currentMixer.stopAllAction();
            } catch (_) {}
            currentMixer = null;
        }
        resetPlaybackState();
        if (avatarRoot) {
            cachedBoneMap = buildAvatarBoneMap(avatarRoot);
            console.log('[ClipAnimationLoader] Avatar registered. Bones:', Object.keys(cachedBoneMap).join(', '));
            console.log(
                '[ClipAnimationLoader] Required dance bones:',
                Object.keys(getRequiredBoneMap(cachedBoneMap)).join(', ')
            );
        }
    }

    // ── Helpers ──
    function getManifest() {
        return manifest;
    }
    function getCategories() {
        return manifest && manifest.categories ? manifest.categories : {};
    }
    function getCurrentPlaybackState() {
        return { clip: currentClipPath, category: currentCategory, isPlaying: clipIsPlaying };
    }

    function getAllAnimations() {
        if (!manifest || !manifest.categories) return [];
        var result = [],
            cats = manifest.categories,
            keys = Object.keys(cats);
        for (var c = 0; c < keys.length; c++) {
            var cat = cats[keys[c]] || {},
                files = cat.files || [];
            for (var f = 0; f < files.length; f++) {
                var file = files[f],
                    name = String(file)
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
        if (!manifest || !manifest.emotionMapping) return;
        var files = manifest.emotionMapping[emotionId];
        if (files && files.length) loadClip(files[0]);
    }

    function playEmotionClip(emotionId, loop) {
        if (!manifest || !manifest.emotionMapping) return Promise.resolve(false);
        var files = manifest.emotionMapping[emotionId];
        if (!files || !files.length) return Promise.resolve(false);
        return playClip(files[Math.floor(Math.random() * files.length)], !!loop);
    }

    function playPreferredClip(files, options) {
        if (!files || !files.length) return Promise.resolve(false);
        return playClip(files[0], options || {});
    }

    function playIntentClip(intent, options) {
        if (!manifest) return Promise.resolve(false);
        var files =
            (manifest.intentMapping && manifest.intentMapping[intent]) ||
            (manifest.emotionMapping && manifest.emotionMapping[intent]) ||
            null;
        if (!files || !files.length) return Promise.resolve(false);
        return playPreferredClip(files, options || {});
    }

    // ── Auto-load manifest ──
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadManifest);
    else loadManifest();

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
        getCurrentPlaybackState: getCurrentPlaybackState,
        getAllAnimations: getAllAnimations,
        preloadEmotion: preloadEmotion,
        playEmotionClip: playEmotionClip,
        playPreferredClip: playPreferredClip,
        playIntentClip: playIntentClip,
        REQUIRED_DANCE_BONES: REQUIRED_DANCE_BONES,
        OPTIONAL_DANCE_BONES: OPTIONAL_DANCE_BONES,
        REQUIRED_DANCE_MAP: REQUIRED_DANCE_MAP,
        OPTIONAL_DANCE_MAP: OPTIONAL_DANCE_MAP,
        BVH_TO_AVATAR_SAMPLE_A: BVH_TO_AVATAR_SAMPLE_A,
        LIKELY_CORRECTION_BONES: LIKELY_CORRECTION_BONES,
        BONE_CORRECTION_PRESETS: BONE_CORRECTION_PRESETS,
    };

    console.log('[ClipAnimationLoader] Initialized — BVH/VRMA clip loading system');
})();
