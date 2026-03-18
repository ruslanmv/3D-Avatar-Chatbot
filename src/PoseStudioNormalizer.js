'use strict';

/**
 * PoseStudioNormalizer — Simple helpers for quick-apply relaxed / portrait poses
 * during Pose Studio editing. Complements (does NOT replace) NEXUS_POSE_NORMALIZER.
 *
 * IMPORTANT: All rotation values are calibrated to match NaturalPosePlugin presets
 * (relaxedStanding = 40° upper arm Z rotation = 0.698 rad) and are scaled by the
 * global intensity from PoseNormalizer settings. This ensures Pose Studio produces
 * the same visual result as the general T-pose correction — no additive compounding.
 *
 * At the default intensity of 0.80:
 *   upper arm effective rotation = 0.698 × 0.80 = 0.558 rad ≈ 32°
 *   Close to VRPoseSystem's lecturerNeutral (36°) without body overlap.
 *
 * Exposes: window.NEXUS_POSE_STUDIO_NORMALIZER
 */
(function () {
    // ── Base rotation values (full-strength, intensity=1.0) ──
    // Aligned with NaturalPosePlugin.relaxedStanding preset:
    //   upperArm  Z: 40° = 0.698 rad  (was 0.9 rad — too aggressive, caused body overlap)
    //   shoulder  Z: 5°  = 0.087 rad  (unchanged from NaturalPosePlugin)
    //   lowerArm  Z: 8°  = 0.14 rad   (slight elbow bend)
    //   lowerArm  X: 0.08 rad         (natural forearm rotation)
    var BASE = {
        shoulder: 0.087, // 5°  — NaturalPosePlugin relaxedStanding
        upperArm: 0.698, // 40° — NaturalPosePlugin relaxedStanding
        lowerArmZ: 0.14, // 8°  — NaturalPosePlugin relaxedStanding
        lowerArmX: 0.08, // natural forearm rotation
        neckX: 0.01,
        headX: -0.01,
    };

    /**
     * Read global intensity from PoseNormalizer → AnimationPresets (single source of truth).
     * Falls back to AnimationPresets.DEFAULT_POSE_INTENSITY if PoseNormalizer is not loaded yet.
     */
    function _getGlobalIntensity() {
        var pn = window.NEXUS_POSE_NORMALIZER;
        if (pn && pn.getSettings) {
            var s = pn.getSettings();
            if (s.intensity != null) return s.intensity;
        }
        var ap = window.NEXUS_ANIMATION_PRESETS;
        return ap && ap.DEFAULT_POSE_INTENSITY != null ? ap.DEFAULT_POSE_INTENSITY : 1.0;
    }

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
            var intensity = _getGlobalIntensity();

            var leftShoulder = rigMap.getBone('leftShoulder');
            var rightShoulder = rigMap.getBone('rightShoulder');
            var leftUpperArm = rigMap.getBone('leftUpperArm');
            var rightUpperArm = rigMap.getBone('rightUpperArm');
            var leftLowerArm = rigMap.getBone('leftLowerArm');
            var rightLowerArm = rigMap.getBone('rightLowerArm');
            var neck = rigMap.getBone('neck');
            var head = rigMap.getBone('head');

            safeRotateZ(leftShoulder, -BASE.shoulder * intensity);
            safeRotateZ(rightShoulder, BASE.shoulder * intensity);

            safeRotateZ(leftUpperArm, -BASE.upperArm * intensity);
            safeRotateZ(rightUpperArm, BASE.upperArm * intensity);

            safeRotateZ(leftLowerArm, -BASE.lowerArmZ * intensity);
            safeRotateZ(rightLowerArm, BASE.lowerArmZ * intensity);

            safeRotateX(leftLowerArm, BASE.lowerArmX * intensity);
            safeRotateX(rightLowerArm, BASE.lowerArmX * intensity);

            safeRotateX(neck, BASE.neckX * intensity);
            safeRotateX(head, BASE.headX * intensity);
        },

        applyPortraitPose: function (rigMap) {
            this.applyRelaxedStandingPose(rigMap);

            var intensity = _getGlobalIntensity();
            var head = rigMap.getBone('head');
            var neck = rigMap.getBone('neck');
            var leftUpperArm = rigMap.getBone('leftUpperArm');
            var rightUpperArm = rigMap.getBone('rightUpperArm');

            // Additional portrait adjustments (raise arms slightly back)
            safeRotateZ(leftUpperArm, 0.15 * intensity);
            safeRotateZ(rightUpperArm, -0.15 * intensity);
            safeRotateX(neck, -0.02 * intensity);
            safeRotateX(head, 0.03 * intensity);
        },
    };

    window.NEXUS_POSE_STUDIO_NORMALIZER = PoseStudioNormalizer;
})();
