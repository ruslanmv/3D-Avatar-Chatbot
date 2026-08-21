'use strict';

/**
 * PoseRigMap — Unified bone mapping for humanoid avatars.
 * Maps logical bone names to actual skeleton bones via VRM humanoid API
 * or name-based heuristics (for GLB models).
 *
 * Exposes: window.NEXUS_POSE_RIG_MAP (constructor class)
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[PoseRigMap] THREE not found on window.');
        return;
    }

    const NAME_ALIASES = {
        hips: ['hips', 'j_bip_c_hips', 'pelvis'],
        spine: ['spine', 'j_bip_c_spine'],
        chest: ['chest', 'j_bip_c_chest'],
        upperChest: ['upperchest', 'upper_chest', 'j_bip_c_upperchest'],
        neck: ['neck', 'j_bip_c_neck'],
        head: ['head', 'j_bip_c_head'],

        leftShoulder: ['leftshoulder', 'shoulderl', 'l_shoulder', 'j_bip_l_shoulder'],
        rightShoulder: ['rightshoulder', 'shoulderr', 'r_shoulder', 'j_bip_r_shoulder'],

        leftUpperArm: ['leftupperarm', 'upperarml', 'l_upperarm', 'leftarm', 'j_bip_l_upperarm'],
        rightUpperArm: ['rightupperarm', 'upperarmr', 'r_upperarm', 'rightarm', 'j_bip_r_upperarm'],

        leftLowerArm: ['leftlowerarm', 'lowerarml', 'l_lowerarm', 'leftforearm', 'j_bip_l_lowerarm'],
        rightLowerArm: ['rightlowerarm', 'lowerarmr', 'r_lowerarm', 'rightforearm', 'j_bip_r_lowerarm'],

        leftHand: ['lefthand', 'handl', 'l_hand', 'j_bip_l_hand'],
        rightHand: ['righthand', 'handr', 'r_hand', 'j_bip_r_hand'],

        // ── Finger bones (30 bones: 5 fingers × 3 joints × 2 hands) ──
        // VRM humanoid spec: Proximal → Intermediate → Distal per finger
        leftThumbProximal: ['leftthumbproximal', 'l_thumb1', 'j_bip_l_thumb1'],
        leftThumbIntermediate: ['leftthumbintermediate', 'l_thumb2', 'j_bip_l_thumb2'],
        leftThumbDistal: ['leftthumbdistal', 'l_thumb3', 'j_bip_l_thumb3'],
        leftIndexProximal: ['leftindexproximal', 'l_index1', 'j_bip_l_index1'],
        leftIndexIntermediate: ['leftindexintermediate', 'l_index2', 'j_bip_l_index2'],
        leftIndexDistal: ['leftindexdistal', 'l_index3', 'j_bip_l_index3'],
        leftMiddleProximal: ['leftmiddleproximal', 'l_middle1', 'j_bip_l_middle1'],
        leftMiddleIntermediate: ['leftmiddleintermediate', 'l_middle2', 'j_bip_l_middle2'],
        leftMiddleDistal: ['leftmiddledistal', 'l_middle3', 'j_bip_l_middle3'],
        leftRingProximal: ['leftringproximal', 'l_ring1', 'j_bip_l_ring1'],
        leftRingIntermediate: ['leftringintermediate', 'l_ring2', 'j_bip_l_ring2'],
        leftRingDistal: ['leftringdistal', 'l_ring3', 'j_bip_l_ring3'],
        leftLittleProximal: ['leftlittleproximal', 'l_little1', 'l_pinky1', 'j_bip_l_little1'],
        leftLittleIntermediate: ['leftlittleintermediate', 'l_little2', 'l_pinky2', 'j_bip_l_little2'],
        leftLittleDistal: ['leftlittledistal', 'l_little3', 'l_pinky3', 'j_bip_l_little3'],

        rightThumbProximal: ['rightthumbproximal', 'r_thumb1', 'j_bip_r_thumb1'],
        rightThumbIntermediate: ['rightthumbintermediate', 'r_thumb2', 'j_bip_r_thumb2'],
        rightThumbDistal: ['rightthumbdistal', 'r_thumb3', 'j_bip_r_thumb3'],
        rightIndexProximal: ['rightindexproximal', 'r_index1', 'j_bip_r_index1'],
        rightIndexIntermediate: ['rightindexintermediate', 'r_index2', 'j_bip_r_index2'],
        rightIndexDistal: ['rightindexdistal', 'r_index3', 'j_bip_r_index3'],
        rightMiddleProximal: ['rightmiddleproximal', 'r_middle1', 'j_bip_r_middle1'],
        rightMiddleIntermediate: ['rightmiddleintermediate', 'r_middle2', 'j_bip_r_middle2'],
        rightMiddleDistal: ['rightmiddledistal', 'r_middle3', 'j_bip_r_middle3'],
        rightRingProximal: ['rightringproximal', 'r_ring1', 'j_bip_r_ring1'],
        rightRingIntermediate: ['rightringintermediate', 'r_ring2', 'j_bip_r_ring2'],
        rightRingDistal: ['rightringdistal', 'r_ring3', 'j_bip_r_ring3'],
        rightLittleProximal: ['rightlittleproximal', 'r_little1', 'r_pinky1', 'j_bip_r_little1'],
        rightLittleIntermediate: ['rightlittleintermediate', 'r_little2', 'r_pinky2', 'j_bip_r_little2'],
        rightLittleDistal: ['rightlittledistal', 'r_little3', 'r_pinky3', 'j_bip_r_little3'],

        leftUpperLeg: ['leftupperleg', 'upperlegl', 'l_thigh', 'leftthigh', 'j_bip_l_upperleg'],
        rightUpperLeg: ['rightupperleg', 'upperlegr', 'r_thigh', 'rightthigh', 'j_bip_r_upperleg'],

        leftLowerLeg: ['leftlowerleg', 'lowerlegl', 'l_calf', 'leftshin', 'j_bip_l_lowerleg'],
        rightLowerLeg: ['rightlowerleg', 'lowerlegr', 'r_calf', 'rightshin', 'j_bip_r_lowerleg'],

        leftFoot: ['leftfoot', 'footl', 'l_foot', 'j_bip_l_foot'],
        rightFoot: ['rightfoot', 'footr', 'r_foot', 'j_bip_r_foot'],
    };

    function normalizeName(name) {
        return (name || '').toLowerCase().replace(/[\s_\-.]/g, '');
    }

    function findBoneByAliases(root, aliases) {
        var normalizedAliases = aliases.map(normalizeName);
        var found = null;

        root.traverse(function (obj) {
            if (found || !obj.isBone) return;
            var n = normalizeName(obj.name);
            if (normalizedAliases.indexOf(n) !== -1) {
                found = obj;
            }
        });

        return found;
    }

    var VRM_MAP = {
        hips: 'hips',
        spine: 'spine',
        chest: 'chest',
        upperChest: 'upperChest',
        neck: 'neck',
        head: 'head',
        leftShoulder: 'leftShoulder',
        rightShoulder: 'rightShoulder',
        leftUpperArm: 'leftUpperArm',
        rightUpperArm: 'rightUpperArm',
        leftLowerArm: 'leftLowerArm',
        rightLowerArm: 'rightLowerArm',
        leftHand: 'leftHand',
        rightHand: 'rightHand',
        leftThumbProximal: 'leftThumbProximal',
        leftThumbIntermediate: 'leftThumbIntermediate',
        leftThumbDistal: 'leftThumbDistal',
        leftIndexProximal: 'leftIndexProximal',
        leftIndexIntermediate: 'leftIndexIntermediate',
        leftIndexDistal: 'leftIndexDistal',
        leftMiddleProximal: 'leftMiddleProximal',
        leftMiddleIntermediate: 'leftMiddleIntermediate',
        leftMiddleDistal: 'leftMiddleDistal',
        leftRingProximal: 'leftRingProximal',
        leftRingIntermediate: 'leftRingIntermediate',
        leftRingDistal: 'leftRingDistal',
        leftLittleProximal: 'leftLittleProximal',
        leftLittleIntermediate: 'leftLittleIntermediate',
        leftLittleDistal: 'leftLittleDistal',
        rightThumbProximal: 'rightThumbProximal',
        rightThumbIntermediate: 'rightThumbIntermediate',
        rightThumbDistal: 'rightThumbDistal',
        rightIndexProximal: 'rightIndexProximal',
        rightIndexIntermediate: 'rightIndexIntermediate',
        rightIndexDistal: 'rightIndexDistal',
        rightMiddleProximal: 'rightMiddleProximal',
        rightMiddleIntermediate: 'rightMiddleIntermediate',
        rightMiddleDistal: 'rightMiddleDistal',
        rightRingProximal: 'rightRingProximal',
        rightRingIntermediate: 'rightRingIntermediate',
        rightRingDistal: 'rightRingDistal',
        rightLittleProximal: 'rightLittleProximal',
        rightLittleIntermediate: 'rightLittleIntermediate',
        rightLittleDistal: 'rightLittleDistal',
        leftUpperLeg: 'leftUpperLeg',
        rightUpperLeg: 'rightUpperLeg',
        leftLowerLeg: 'leftLowerLeg',
        rightLowerLeg: 'rightLowerLeg',
        leftFoot: 'leftFoot',
        rightFoot: 'rightFoot',
    };

    function PoseRigMap(opts) {
        opts = opts || {};
        this.root = opts.root || null;
        this.vrmHumanoid = opts.vrmHumanoid || null;
        this.bones = {};
        // Visual bones: the RAW skeleton that actually drives the rendered
        // mesh. three-vrm 2.x "normalized" nodes (used in this.bones for
        // writing) are a proxy rig whose world positions do NOT follow
        // animations/presets applied to the raw bones — overlays reading
        // them float away from the body. Read positions from visualBones.
        this.visualBones = {};
        this._build();
    }

    PoseRigMap.prototype._build = function () {
        var keys = Object.keys(NAME_ALIASES);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            this.bones[key] = this._findHumanoidBone(key) || this._findFallbackBone(key) || null;
            this.visualBones[key] = this._findRawBone(key) || this.bones[key];
        }
    };

    PoseRigMap.prototype._findRawBone = function (key) {
        if (!this.vrmHumanoid) return null;
        var humanoidName = VRM_MAP[key];
        if (!humanoidName) return null;
        try {
            if (typeof this.vrmHumanoid.getRawBoneNode === 'function') {
                return this.vrmHumanoid.getRawBoneNode(humanoidName) || null;
            }
            if (typeof this.vrmHumanoid.getBoneNode === 'function') {
                return this.vrmHumanoid.getBoneNode(humanoidName) || null;
            }
        } catch (err) {
            /* fall through to write-rig bone */
        }
        return null;
    };

    PoseRigMap.prototype._findHumanoidBone = function (key) {
        if (!this.vrmHumanoid) return null;
        var humanoidName = VRM_MAP[key];
        if (!humanoidName) return null;

        try {
            if (typeof this.vrmHumanoid.getNormalizedBoneNode === 'function') {
                return this.vrmHumanoid.getNormalizedBoneNode(humanoidName) || null;
            }
            if (typeof this.vrmHumanoid.getRawBoneNode === 'function') {
                return this.vrmHumanoid.getRawBoneNode(humanoidName) || null;
            }
        } catch (err) {
            console.warn('[PoseRigMap] Failed to get humanoid bone ' + humanoidName, err);
        }

        return null;
    };

    PoseRigMap.prototype._findFallbackBone = function (key) {
        if (!this.root) return null;
        return findBoneByAliases(this.root, NAME_ALIASES[key] || []);
    };

    PoseRigMap.prototype.getBone = function (name) {
        return this.bones[name] || null;
    };

    /**
     * Bone on the RAW (rendered) skeleton — use for reading world positions
     * in overlays/gizmos. Falls back to the write bone when no raw rig exists.
     */
    PoseRigMap.prototype.getVisualBone = function (name) {
        return this.visualBones[name] || this.bones[name] || null;
    };

    PoseRigMap.prototype.hasUpperBodyRig = function () {
        return !!(
            this.getBone('head') &&
            this.getBone('neck') &&
            this.getBone('leftUpperArm') &&
            this.getBone('rightUpperArm')
        );
    };

    PoseRigMap.prototype.getSymmetricBonePair = function (key) {
        var pairs = {
            shoulder: ['leftShoulder', 'rightShoulder'],
            upperArm: ['leftUpperArm', 'rightUpperArm'],
            lowerArm: ['leftLowerArm', 'rightLowerArm'],
            hand: ['leftHand', 'rightHand'],
            upperLeg: ['leftUpperLeg', 'rightUpperLeg'],
            lowerLeg: ['leftLowerLeg', 'rightLowerLeg'],
            foot: ['leftFoot', 'rightFoot'],
        };
        var pair = pairs[key];
        if (!pair) return [null, null];
        return [this.getBone(pair[0]), this.getBone(pair[1])];
    };

    PoseRigMap.prototype.toJSON = function () {
        var result = {};
        var keys = Object.keys(this.bones);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var bone = this.bones[key];
            result[key] = bone ? bone.name : null;
        }
        return result;
    };

    window.NEXUS_POSE_RIG_MAP = PoseRigMap;
})();
