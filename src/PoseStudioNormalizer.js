'use strict';

/**
 * PoseStudioNormalizer — Simple helpers for quick-apply relaxed / portrait poses
 * during Pose Studio editing. Complements (does NOT replace) NEXUS_POSE_NORMALIZER.
 *
 * Exposes: window.NEXUS_POSE_STUDIO_NORMALIZER
 */
(function () {
    function safeRotateZ(bone, radians) {
        if (!bone) return;
        bone.rotation.z += radians;
        bone.updateMatrixWorld(true);
    }

    function safeRotateX(bone, radians) {
        if (!bone) return;
        bone.rotation.x += radians;
        bone.updateMatrixWorld(true);
    }

    var PoseStudioNormalizer = {
        applyRelaxedStandingPose: function (rigMap) {
            var leftShoulder = rigMap.getBone('leftShoulder');
            var rightShoulder = rigMap.getBone('rightShoulder');
            var leftUpperArm = rigMap.getBone('leftUpperArm');
            var rightUpperArm = rigMap.getBone('rightUpperArm');
            var leftLowerArm = rigMap.getBone('leftLowerArm');
            var rightLowerArm = rigMap.getBone('rightLowerArm');
            var neck = rigMap.getBone('neck');
            var head = rigMap.getBone('head');

            safeRotateZ(leftShoulder, -0.08);
            safeRotateZ(rightShoulder, 0.08);

            safeRotateZ(leftUpperArm, -0.9);
            safeRotateZ(rightUpperArm, 0.9);

            safeRotateZ(leftLowerArm, -0.12);
            safeRotateZ(rightLowerArm, 0.12);

            safeRotateX(leftLowerArm, 0.08);
            safeRotateX(rightLowerArm, 0.08);

            safeRotateX(neck, 0.01);
            safeRotateX(head, -0.01);
        },

        applyPortraitPose: function (rigMap) {
            this.applyRelaxedStandingPose(rigMap);

            var head = rigMap.getBone('head');
            var neck = rigMap.getBone('neck');
            var leftUpperArm = rigMap.getBone('leftUpperArm');
            var rightUpperArm = rigMap.getBone('rightUpperArm');

            safeRotateZ(leftUpperArm, 0.15);
            safeRotateZ(rightUpperArm, -0.15);
            safeRotateX(neck, -0.02);
            safeRotateX(head, 0.03);
        },
    };

    window.NEXUS_POSE_STUDIO_NORMALIZER = PoseStudioNormalizer;
})();
