'use strict';

/**
 * BVHAnimationLoader — BVH animation loading and retargeting.
 *
 * Handles BVH motion capture files:
 *   1. Parse BVH text via THREE.BVHLoader
 *   2. Build source skeleton bone map
 *   3. Retarget quaternion tracks to avatar bones
 *   4. Apply per-bone correction quaternions
 *
 * Depends on: ClipAnimationShared.js (must load first)
 * Exposes: window.__BVH_LOADER__
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) return;

    var bvhLoader = null;
    var S; // state
    var C; // consts

    function _init() {
        S = window.__CLIP_ANIM_STATE__;
        C = window.__CLIP_ANIM_CONST__;
        if (!S || !C) {
            console.warn('[BVHLoader] ClipAnimationShared not loaded');
            return false;
        }
        return true;
    }

    // =========================================================================
    // BVH → VRM BONE NAME MAP
    // =========================================================================

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
        // Finger bones
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

    // =========================================================================
    // HELPERS
    // =========================================================================

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

    function isCanonicalDancePair(path) {
        var lp = String(path || '')
            .replace(/\\/g, '/')
            .toLowerCase();
        if (lp !== 'dance/dance_1.bvh' && lp !== 'vendor/animations/dance/dance_1.bvh') return false;
        var n =
            C.safeGet(S.avatarVRM, ['meta', 'name']) ||
            C.safeGet(S.avatarVRM, ['meta', 'title']) ||
            C.safeGet(S.avatarVRM, ['userData', 'vrmMeta', 'name']) ||
            C.safeGet(S.avatarRoot, ['userData', 'vrmMeta', 'name']) ||
            '';
        var r = C.safeGet(S.avatarRoot, ['name']) || '';
        var j = (String(n) + ' ' + String(r)).toLowerCase();
        return j.indexOf('avatarsample_a') >= 0 || j.indexOf('avatarsample a') >= 0;
    }

    function buildSourceBVHBoneMap(skeleton) {
        var map = {};
        if (!skeleton || !skeleton.bones) return map;
        for (var i = 0; i < skeleton.bones.length; i++) {
            var bone = skeleton.bones[i];
            if (!bone) continue;
            var norm = C.normalizeBoneKey(bone.name);
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
        var norm = C.normalizeBoneKey(sourceBoneName),
            vrmName = null;
        if (explicitMap) {
            for (var h in explicitMap) {
                if (!Object.prototype.hasOwnProperty.call(explicitMap, h)) continue;
                if (C.normalizeBoneKey(explicitMap[h]) === norm || explicitMap[h] === sourceBoneName) {
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
                if (String(k).toLowerCase() === String(vrmName).toLowerCase() || C.normalizeBoneKey(k) === norm) {
                    target = boneMap[k];
                    break;
                }
            }
        }
        return { targetBone: target, vrmName: vrmName };
    }

    function getCorrectionQuaternionForBone(vrmName) {
        var arr = C.BONE_CORRECTION_PRESETS[vrmName];
        if (!arr || !C.isArray(arr) || arr.length !== 4) return null;
        return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]).normalize();
    }

    function retargetQuaternionValues(trackValues, sourceBone, targetBone, vrmName) {
        if (!trackValues || !sourceBone || !targetBone) return trackValues;
        var out = C.cloneQuaternionArray(trackValues);
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

    // =========================================================================
    // BVH RETARGETING
    // =========================================================================

    function retargetBVHClip(clip, sourceSkeleton, targetRoot, clipPath) {
        if (!_init()) return clip;
        if (!clip || !clip.tracks) return clip;

        if (!S.cachedBoneMap) S.cachedBoneMap = C.buildAvatarBoneMap(targetRoot, S.avatarVRM);
        var boneMap = S.cachedBoneMap;
        if (!boneMap || Object.keys(boneMap).length === 0) {
            console.warn('[BVHLoader] No avatar bones');
            clip._retargetFailed = true;
            return clip;
        }

        var sourceBoneMap = buildSourceBVHBoneMap(sourceSkeleton);
        var newTracks = [],
            quatCount = 0,
            requiredMapped = {},
            requiredHitCount = 0;
        var useCanonical = isCanonicalDancePair(clipPath);
        var explicitMap = useCanonical ? C.BVH_TO_AVATAR_SAMPLE_A : null;
        if (useCanonical) console.log('[BVHLoader] Using canonical mapping for:', clipPath);

        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i],
                info = getTrackBoneAndProperty(track.name);
            var srcName = info.boneName,
                property = info.property;
            if (!srcName || !property) continue;
            var ti = resolveTargetBone(boneMap, srcName, explicitMap);
            if (!ti.targetBone) continue;
            if (property === 'position' || property === 'scale') continue;

            if (property === 'quaternion' && track.values && track.values.length >= 4) {
                var norm = C.normalizeBoneKey(srcName);
                var sBone = sourceBoneMap[ti.vrmName] || sourceBoneMap[srcName] || sourceBoneMap[norm] || null;
                if (!sBone && explicitMap && explicitMap[ti.vrmName])
                    sBone =
                        sourceBoneMap[explicitMap[ti.vrmName]] ||
                        sourceBoneMap[C.normalizeBoneKey(explicitMap[ti.vrmName])] ||
                        null;
                if (!sBone) continue;
                var retargeted = retargetQuaternionValues(track.values, sBone, ti.targetBone, ti.vrmName);
                newTracks.push(
                    new THREE.QuaternionKeyframeTrack(
                        ti.targetBone.name + '.quaternion',
                        track.times.slice ? track.times.slice(0) : track.times,
                        retargeted
                    )
                );
                quatCount++;
                if (C.REQUIRED_DANCE_BONES.indexOf(ti.vrmName) >= 0 && !requiredMapped[ti.vrmName]) {
                    requiredMapped[ti.vrmName] = true;
                    requiredHitCount++;
                }
            }
        }

        if (newTracks.length === 0) {
            console.warn('[BVHLoader] No tracks retargeted:', clip.name);
            clip._retargetFailed = true;
            return clip;
        }
        if (quatCount < 6) {
            console.warn('[BVHLoader] Too few quaternion tracks:', clip.name, '(' + quatCount + ')');
            clip._retargetFailed = true;
            return clip;
        }
        if (useCanonical && requiredHitCount < Math.max(12, Math.floor(C.REQUIRED_DANCE_BONES.length * 0.75))) {
            console.warn(
                '[BVHLoader] Insufficient coverage:',
                clip.name,
                '(' + requiredHitCount + '/' + C.REQUIRED_DANCE_BONES.length + ')'
            );
            clip._retargetFailed = true;
            return clip;
        }
        console.log('[BVHLoader] Retargeted', newTracks.length, '/', clip.tracks.length, 'tracks for:', clip.name);
        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
    }

    // =========================================================================
    // LOADING
    // =========================================================================

    function loadBVH(path) {
        if (!_init()) return Promise.resolve(null);

        if (S.loadedClips[path]) return Promise.resolve(S.loadedClips[path]);
        if (S.loadingQueue[path]) return S.loadingQueue[path];

        var loader = getBVHLoader();
        if (!loader) {
            console.warn('[BVHLoader] BVHLoader not available');
            return Promise.resolve(null);
        }

        S.loadingQueue[path] = fetch(S.basePath + '/' + path)
            .then(function (res) {
                if (!res.ok) {
                    delete S.loadingQueue[path];
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
                    console.warn('[BVHLoader] Got HTML instead of BVH:', path);
                    delete S.loadingQueue[path];
                    return null;
                }
                if (trimmed.indexOf('HIERARCHY') !== 0) {
                    console.warn('[BVHLoader] Invalid BVH:', path);
                    delete S.loadingQueue[path];
                    return null;
                }
                var result = loader.parse(text);
                if (!result || !result.clip) {
                    delete S.loadingQueue[path];
                    return null;
                }
                var clip = result.clip;
                clip.name = path
                    .split('/')
                    .pop()
                    .replace(/\.bvh$/i, '');
                if (S.avatarRoot) clip = retargetBVHClip(clip, result.skeleton, S.avatarRoot, path);
                if (!clip || clip._retargetFailed) {
                    delete S.loadingQueue[path];
                    return null;
                }
                S.loadedClips[path] = clip;
                delete S.loadingQueue[path];
                return clip;
            })
            .catch(function (err) {
                console.warn('[BVHLoader] Failed:', path, err);
                delete S.loadingQueue[path];
                return null;
            });
        return S.loadingQueue[path];
    }

    // =========================================================================
    // EXPOSE
    // =========================================================================

    window.__BVH_LOADER__ = {
        loadBVH: loadBVH,
        retargetBVHClip: retargetBVHClip,
        BVH_TO_VRM_MAP: BVH_TO_VRM_MAP,
    };

    console.log('[BVHAnimationLoader] Initialized');
})();
