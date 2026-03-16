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
        this._build();
    }

    PoseRigMap.prototype._build = function () {
        var keys = Object.keys(NAME_ALIASES);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            this.bones[key] = this._findHumanoidBone(key) || this._findFallbackBone(key) || null;
        }
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
