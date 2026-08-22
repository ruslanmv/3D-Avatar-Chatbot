'use strict';

/**
 * BVHAnimationLoader — BVH animation loading and retargeting.
 *
 * Handles BVH motion capture files:
 *   1. Parse BVH text via THREE.BVHLoader
 *   2. Resolve BVH joint names to VRM humanoid bones
 *   3. Copy local rotations onto the NORMALIZED rig (avatar-independent),
 *      applying the VRM 0.x handedness flip when the model needs it
 *   4. Carry the hips translation across, scaled to the target's rig
 *
 * Steps 3 and 4 replaced a retarget that multiplied the avatar's live pose
 * into every keyframe and discarded hips motion entirely; see
 * retargetQuaternionValues() for why that could never be avatar-independent.
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

    /**
     * Map BVH local rotations onto the normalized rig.
     *
     * This used to capture the SOURCE and TARGET bones' rest quaternions at
     * retarget time and pre-multiply them into every keyframe:
     *
     *     qOut = tRest * inv(sRest) * qSrc
     *
     * Two things made that wrong. A BVH hierarchy carries no rest rotation —
     * only OFFSET translations — so `sRest` is always identity and the term
     * does nothing. And `tRest` was the target bone's LIVE quaternion, read
     * whenever the clip happened to load. Clips load lazily on first play, by
     * which time the avatar is standing with arms lowered and mid-breath, so
     * that pose was welded into all frames of the animation (the arm-through-
     * face dance). Nothing about it was avatar-independent.
     *
     * The shipped BVH skeletons already use VRM humanoid bone names with
     * identity rest rotations, so their local quaternions are exactly what the
     * normalized rig expects — the same situation as VRMA data. Copy them
     * through, and apply only the VRM 0.x handedness flip the VRMA path has
     * always applied and this one never did.
     *
     * @param {ArrayLike<number>} trackValues - Flat [x,y,z,w, …]
     * @param {boolean} isVRM0 - Target model is VRM 0.x
     * @returns {ArrayLike<number>}
     */
    function retargetQuaternionValues(trackValues, isVRM0) {
        if (!trackValues) return trackValues;
        return isVRM0 ? C.transformQuatForVRM0(trackValues) : C.cloneQuaternionArray(trackValues);
    }

    /**
     * Ratio between the target's hips rest height and the BVH root offset.
     *
     * The shipped BVH skeletons are authored roughly 10x larger than the VRM
     * normalized rig (root OFFSET Y is ~10.7-12.2; normalized hips sit at
     * ~1.05-1.12), so hips translation has to be divided down or the avatar
     * launches off-screen. Falls back to 1 when either height is unknown,
     * which is a no-op rather than a guess.
     *
     * @param {Object} sourceSkeleton - Skeleton returned by THREE.BVHLoader
     * @param {Object} boneMap - Resolved target bones
     * @returns {number}
     */
    function computeHipsScale(sourceSkeleton, boneMap) {
        var srcY = 0;
        var bones = (sourceSkeleton && sourceSkeleton.bones) || [];
        for (var i = 0; i < bones.length; i++) {
            var b = bones[i];
            if (b && b.position && C.normalizeBoneKey(b.name) === 'hips') {
                srcY = Math.abs(b.position.y);
                break;
            }
        }
        if (!srcY && bones.length && bones[0] && bones[0].position) srcY = Math.abs(bones[0].position.y);
        var tgt = boneMap.hips;
        var tgtY = tgt && tgt.position ? Math.abs(tgt.position.y) : 0;
        if (!srcY || !tgtY) return 1;
        return tgtY / srcY;
    }

    /**
     * How far a clip's hips may sit from the avatar's rest height and still
     * count as "standing" — a fraction of the rest height itself.
     *
     * The shipped captures fall into two clean groups. Standing clips land
     * between 0.85 and 1.08 of rest; every genuine posture is far lower —
     * sitting 0.59, kneeling 0.44-0.55, crouch 0.42, laying 0.13. The nearest
     * excluded clip (sit_idle4, 0.591) is 0.41 from rest, more than three
     * times this band, so the exact value is not delicate.
     *
     * @private
     */
    var STANDING_BAND = 0.12;

    /**
     * Scale a hips position track into the target rig, applying the VRM 0.x
     * handedness flip when needed.
     *
     * @param {ArrayLike<number>} values - Flat [x,y,z, …]
     * @param {number} scale
     * @param {boolean} isVRM0
     * @returns {Float32Array}
     */
    function scaleHipsPosition(values, scale, isVRM0, targetHips) {
        var out = new Float32Array(values.length);
        // Vertical only. Clips animate the BODY; where the avatar stands is the
        // locomotion system's business, and it already owns the root. BVH hips
        // channels carry the capture volume's absolute XZ, so letting them
        // through walked her off her mark every time she danced.
        //
        // Pinned to the hips' REST x/z rather than to zero — zero is only the
        // same thing when the rest pose happens to sit on the origin, and
        // otherwise it displaces her for the length of the clip.
        var restX = targetHips && targetHips.position ? targetHips.position.x : 0;
        var restY = targetHips && targetHips.position ? targetHips.position.y : 0;
        var restZ = targetHips && targetHips.position ? targetHips.position.z : 0;

        // A STANDING clip is re-centred on the avatar's own rest height.
        //
        // THREE.BVHLoader bakes OFFSET + channel into the position track
        // (BVHLoader.js:375), so the value written is restY * (1 + channel /
        // OFFSET). Each capture's OFFSET is close to, but not equal to, the
        // hips height it actually stands at, and the residual differs per
        // file: neutral_idle writes 0.965 of rest, neutral4 0.967, neutral
        // 0.974. That is a silent 2-4 cm sink, and because idle clips LOOP it
        // never recovers — the reported symptom was the avatar sitting lower
        // in the viewport after a sit/stand cycle, since the procedural idle
        // she started in holds the hips at exactly rest and neutral_idle does
        // not.
        //
        // Re-centring subtracts the clip's own neutral height and adds the
        // avatar's, so any bob or breathing survives while the standing height
        // becomes the avatar's rather than the capture's. Only clips that
        // never leave the standing band are touched: sit, kneel, crouch,
        // laying, standup and the dances all carry real vertical choreography
        // and are written through unchanged.
        var lo = Infinity;
        var hi = -Infinity;
        var k;
        for (k = 1; k < values.length; k += 3) {
            var v = values[k] * scale;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        var recentre = 0;
        if (restY > 0 && lo <= hi) {
            var band = STANDING_BAND * restY;
            if (Math.abs(lo - restY) <= band && Math.abs(hi - restY) <= band) {
                recentre = restY - (lo + hi) / 2;
            }
        }

        for (var i = 0; i + 2 < values.length; i += 3) {
            out[i] = restX;
            out[i + 1] = values[i + 1] * scale + recentre;
            out[i + 2] = restZ;
        }
        return isVRM0 ? C.transformPosForVRM0(out) : out;
    }

    // =========================================================================
    // BVH RETARGETING
    // =========================================================================

    function retargetBVHClip(clip, sourceSkeleton, targetRoot, clipPath) {
        if (!_init()) return clip;
        if (!clip || !clip.tracks) return clip;

        // Target the NORMALIZED rig: avatar-independent, so one clip plays the
        // same on every model and three-vrm composes normalized → raw itself.
        if (!S.cachedBoneMap) {
            S.cachedBoneMap = C.buildAvatarBoneMap(targetRoot, S.avatarVRM, { normalized: true });
        }
        var boneMap = S.cachedBoneMap;
        if (!boneMap || Object.keys(boneMap).length === 0) {
            console.warn('[BVHLoader] No avatar bones');
            clip._retargetFailed = true;
            return clip;
        }

        var newTracks = [],
            quatCount = 0,
            posCount = 0,
            requiredMapped = {},
            requiredHitCount = 0;
        var isVRM0 = S.avatarVRM ? C.getMetaVersion(S.avatarVRM) === '0' : false;
        var hipsScale = computeHipsScale(sourceSkeleton, boneMap);

        for (var i = 0; i < clip.tracks.length; i++) {
            var track = clip.tracks[i],
                info = getTrackBoneAndProperty(track.name);
            var srcName = info.boneName,
                property = info.property;
            if (!srcName || !property) continue;
            var ti = resolveTargetBone(boneMap, srcName, null);
            if (!ti.targetBone) continue;
            if (property === 'scale') continue;

            if (property === 'quaternion' && track.values && track.values.length >= 4) {
                newTracks.push(
                    new THREE.QuaternionKeyframeTrack(
                        ti.targetBone.name + '.quaternion',
                        track.times.slice ? track.times.slice(0) : track.times,
                        retargetQuaternionValues(track.values, isVRM0)
                    )
                );
                quatCount++;
                if (C.REQUIRED_DANCE_BONES.indexOf(ti.vrmName) >= 0 && !requiredMapped[ti.vrmName]) {
                    requiredMapped[ti.vrmName] = true;
                    requiredHitCount++;
                }
            } else if (property === 'position' && ti.vrmName === 'hips' && track.values) {
                // Hips translation was discarded outright, which cost every
                // clip its bounce, weight shift and travel — and left nothing
                // to put the body back at a sane height afterwards. The BVH
                // skeletons are authored ~10x larger than the normalized rig
                // (root offset Y ~12 vs hips rest Y ~1.1), so scale rather
                // than drop.
                newTracks.push(
                    new THREE.VectorKeyframeTrack(
                        ti.targetBone.name + '.position',
                        track.times.slice ? track.times.slice(0) : track.times,
                        scaleHipsPosition(track.values, hipsScale, isVRM0, ti.targetBone)
                    )
                );
                posCount++;
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
        // Coverage is reported for every clip now that the hardcoded
        // dance_1 x AvatarSample_A special case is gone — but it does NOT
        // fail the clip. That gate only ever ran for that one pair, and
        // widening it would newly reject clips on sparse rigs (a GLB avatar
        // resolves bones by name and can legitimately map fewer). Partial
        // motion beats a silent no-op; `quatCount < 6` above still catches a
        // genuinely unusable retarget.
        if (requiredHitCount < Math.max(12, Math.floor(C.REQUIRED_DANCE_BONES.length * 0.75))) {
            console.warn(
                '[BVHLoader] Partial coverage:',
                clip.name,
                '(' + requiredHitCount + '/' + C.REQUIRED_DANCE_BONES.length + ' required bones) — playing anyway'
            );
        }
        console.log(
            '[BVHLoader] Retargeted',
            newTracks.length,
            '/',
            clip.tracks.length,
            'tracks for:',
            clip.name,
            '(' + quatCount + ' rot, ' + posCount + ' pos)'
        );
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

        S.loadingQueue[path] = fetch(C.resolveClipUrl(path, S.basePath))
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
        // Test seams. Pure maths; the loader itself needs THREE and a live
        // avatar, so these are what the unit tests can reach.
        _scaleHipsPosition: scaleHipsPosition,
        _computeHipsScale: computeHipsScale,
        _STANDING_BAND: STANDING_BAND,
    };

    console.log('[BVHAnimationLoader] Initialized');
})();
