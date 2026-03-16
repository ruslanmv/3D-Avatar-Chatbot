'use strict';

/**
 * PoseState — Capture, apply, and reset skeleton poses.
 * Works with delta quaternions relative to a neutral snapshot.
 *
 * Exposes: window.NEXUS_POSE_STATE
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[PoseState] THREE not found on window.');
        return;
    }

    function quatToArray(q) {
        return [q.x, q.y, q.z, q.w];
    }

    function arrayToQuat(arr) {
        if (!Array.isArray(arr) || arr.length !== 4) {
            return new THREE.Quaternion();
        }
        return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]);
    }

    var PoseState = {
        captureFromRig: function (rigMap, neutralPose) {
            var bones = {};
            var keys = Object.keys(rigMap.bones);

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var bone = rigMap.bones[key];
                if (!bone) continue;

                var current = bone.quaternion.clone();

                if (neutralPose && neutralPose[key] && neutralPose[key].q) {
                    var neutralQ = arrayToQuat(neutralPose[key].q);
                    var delta = neutralQ.clone().invert().multiply(current);
                    bones[key] = { q: quatToArray(delta) };
                } else {
                    bones[key] = { q: quatToArray(current) };
                }
            }

            return {
                version: 1,
                name: 'Untitled Pose',
                createdAt: new Date().toISOString(),
                bones: bones,
            };
        },

        createNeutralSnapshot: function (rigMap) {
            var bones = {};
            var keys = Object.keys(rigMap.bones);

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var bone = rigMap.bones[key];
                if (!bone) continue;
                bones[key] = { q: quatToArray(bone.quaternion.clone()) };
            }

            return bones;
        },

        applyToRig: function (poseState, rigMap, neutralPose, blend) {
            if (!poseState || !poseState.bones) return;
            if (typeof blend !== 'number') blend = 1;

            var keys = Object.keys(poseState.bones);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var data = poseState.bones[key];
                var bone = rigMap.getBone(key);
                if (!bone || !data || !data.q) continue;

                var targetDelta = arrayToQuat(data.q);
                var target = targetDelta.clone();

                if (neutralPose && neutralPose[key] && neutralPose[key].q) {
                    var neutralQ = arrayToQuat(neutralPose[key].q);
                    target = neutralQ.multiply(targetDelta);
                }

                bone.quaternion.slerp(target, blend);
                bone.updateMatrixWorld(true);
            }
        },

        resetToNeutral: function (rigMap, neutralPose) {
            if (!neutralPose) return;
            var keys = Object.keys(rigMap.bones);

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var bone = rigMap.bones[key];
                if (!bone || !neutralPose[key] || !neutralPose[key].q) continue;
                bone.quaternion.copy(arrayToQuat(neutralPose[key].q));
                bone.updateMatrixWorld(true);
            }
        },

        clonePose: function (pose) {
            return JSON.parse(JSON.stringify(pose));
        },
    };

    window.NEXUS_POSE_STATE = PoseState;
})();
