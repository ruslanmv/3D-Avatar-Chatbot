'use strict';

/**
 * NEXUS NaturalPosePlugin (GLOBAL script)
 * ----------------------------------------
 * Industry-standard T-pose → natural idle pose correction.
 *
 * Uses the same technique as VRoid Hub and professional VRM viewers:
 *
 *   VRM models:  Apply quaternion rotations via the **normalized bone proxy
 *                system** from @pixiv/three-vrm.  Normalized bones have
 *                identity orientation (quaternion [0,0,0,1]) at T-pose rest,
 *                so we simply set local rotations relative to T-pose.
 *                The VRM library syncs these to raw bones on vrm.update().
 *
 *   GLB models:  Fall back to world-space direction alignment (legacy path
 *                delegated to PoseNormalizer).
 *
 * Design:
 *   - Non-destructive & additive — can be enabled/disabled at any time
 *   - Works alongside ProceduralAnimator (breathing, head-look)
 *   - Pose presets use quaternion arrays [x, y, z, w] relative to T-pose
 *   - Settings-aware: responds to 'pose-settings-changed' events
 *   - Integrates with existing PoseNormalizer settings (intensity, per-bone)
 *
 * Reference — how VRM normalized bones work:
 *   In three-vrm, getNormalizedBoneNode() returns proxy Object3D nodes that
 *   always start with identity quaternion in T-pose.  When you rotate them,
 *   vrm.update() maps these rotations to the actual (raw) skeleton bones,
 *   accounting for different rig conventions, bone rolls, and rotation orders.
 *   This is why VRoid Hub models always look correct regardless of the
 *   underlying skeleton — the normalized layer abstracts it away.
 *
 * Exposes:
 *   window.NEXUS_NATURAL_POSE = {
 *       apply, reset, isActive, getPresets, setPreset, getActivePreset
 *   }
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[NaturalPosePlugin] THREE not found on window.');
        return;
    }

    // =====================================================================
    // POSE PRESETS — quaternion rotations relative to T-pose (identity)
    // =====================================================================
    // Each value is [x, y, z, w] quaternion.
    // For VRM normalized bones, identity [0,0,0,1] = T-pose.
    //
    // Quaternion math reference:
    //   axis-angle → quaternion: q = [axis * sin(angle/2), cos(angle/2)]
    //   Z-axis rotation lowers arms in VRM space (left arm: +Z = down)
    //
    // These values are calibrated to match VRoid Hub's natural standing pose.
    // =====================================================================

    function _quatFromAxisAngle(ax, ay, az, angleDeg) {
        const half = (angleDeg * Math.PI) / 180 / 2;
        const s = Math.sin(half);
        const c = Math.cos(half);
        const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        return [(ax / len) * s, (ay / len) * s, (az / len) * s, c];
    }

    const PRESETS = {
        relaxedStanding: {
            label: 'Relaxed Standing',
            // Arms lowered ~40° from T-pose, slight elbow bend, natural hand droop
            bones: {
                leftShoulder: _quatFromAxisAngle(0, 0, 1, 5),
                rightShoulder: _quatFromAxisAngle(0, 0, 1, -5),
                leftUpperArm: _quatFromAxisAngle(0, 0, 1, 40),
                rightUpperArm: _quatFromAxisAngle(0, 0, 1, -40),
                leftLowerArm: _quatFromAxisAngle(0, -1, 0, 8),
                rightLowerArm: _quatFromAxisAngle(0, 1, 0, 8),
                leftHand: _quatFromAxisAngle(0, 0, 1, 5),
                rightHand: _quatFromAxisAngle(0, 0, 1, -5),
            },
        },
        naturalIdle: {
            label: 'Natural Idle',
            // Arms at sides (~55°), elbows slightly bent, hands naturally rotated
            bones: {
                leftShoulder: _quatFromAxisAngle(0, 0, 1, 8),
                rightShoulder: _quatFromAxisAngle(0, 0, 1, -8),
                leftUpperArm: _quatFromAxisAngle(0, 0, 1, 55),
                rightUpperArm: _quatFromAxisAngle(0, 0, 1, -55),
                leftLowerArm: _quatFromAxisAngle(0, -1, 0, 15),
                rightLowerArm: _quatFromAxisAngle(0, 1, 0, 15),
                leftHand: _quatFromAxisAngle(0, 0, 1, 8),
                rightHand: _quatFromAxisAngle(0, 0, 1, -8),
            },
        },
        portrait: {
            label: 'Portrait / Thumbnail',
            // Arms close to body (~65°), hands near thighs
            bones: {
                leftShoulder: _quatFromAxisAngle(0, 0, 1, 10),
                rightShoulder: _quatFromAxisAngle(0, 0, 1, -10),
                leftUpperArm: _quatFromAxisAngle(0, 0, 1, 65),
                rightUpperArm: _quatFromAxisAngle(0, 0, 1, -65),
                leftLowerArm: _quatFromAxisAngle(0, -1, 0, 20),
                rightLowerArm: _quatFromAxisAngle(0, 1, 0, 20),
                leftHand: _quatFromAxisAngle(0, 0, 1, 10),
                rightHand: _quatFromAxisAngle(0, 0, 1, -10),
            },
        },
        presentation: {
            label: 'Presentation',
            // Slightly open arms (~30°), professional stance
            bones: {
                leftShoulder: _quatFromAxisAngle(0, 0, 1, 4),
                rightShoulder: _quatFromAxisAngle(0, 0, 1, -4),
                leftUpperArm: _quatFromAxisAngle(0, 0, 1, 30),
                rightUpperArm: _quatFromAxisAngle(0, 0, 1, -30),
                leftLowerArm: _quatFromAxisAngle(0, -1, 0, 10),
                rightLowerArm: _quatFromAxisAngle(0, 1, 0, 10),
                leftHand: _quatFromAxisAngle(0, 0, 1, 5),
                rightHand: _quatFromAxisAngle(0, 0, 1, -5),
            },
        },
    };

    // =====================================================================
    // STATE
    // =====================================================================
    let _active = false;
    let _activePreset = 'naturalIdle';
    let _currentHumanoid = null; // VRM humanoid reference
    let _currentRoot = null; // avatar scene root
    let _isVRM = false;

    // =====================================================================
    // VRM NORMALIZED BONE PATH (industry standard)
    // =====================================================================

    /**
     * Apply a pose preset to a VRM model using the normalized bone API.
     *
     * This is the technique used by VRoid Hub:
     *   1. Get normalized bone proxy nodes (identity quat = T-pose)
     *   2. Set quaternion rotations relative to T-pose
     *   3. vrm.update() syncs to raw bones automatically
     *
     * @param {Object} humanoid - VRM humanoid (vrm.humanoid)
     * @param {string} presetName - Preset to apply
     * @param {number} intensity - 0..1 blend factor
     * @param {Object} boneWeights - Per-bone intensity overrides
     */
    function applyVRMPose(humanoid, presetName, intensity, boneWeights) {
        const preset = PRESETS[presetName] || PRESETS.relaxedStanding;
        const identityQuat = new THREE.Quaternion();
        const targetQuat = new THREE.Quaternion();
        const blendedQuat = new THREE.Quaternion();

        for (const [boneName, quatArray] of Object.entries(preset.bones)) {
            const boneNode = humanoid.getNormalizedBoneNode(boneName);
            if (!boneNode) continue;

            // Get per-bone weight from PoseNormalizer settings
            const boneWeight = boneWeights[boneName] != null ? boneWeights[boneName] : 1.0;
            const effectiveIntensity = intensity * boneWeight;

            if (effectiveIntensity <= 0) {
                // Reset to T-pose for this bone
                boneNode.quaternion.set(0, 0, 0, 1);
                continue;
            }

            // Set target quaternion from preset
            targetQuat.set(quatArray[0], quatArray[1], quatArray[2], quatArray[3]);

            // Blend between identity (T-pose) and target based on intensity
            blendedQuat.copy(identityQuat).slerp(targetQuat, effectiveIntensity);

            // Apply to normalized bone — vrm.update() will sync to raw bones
            boneNode.quaternion.copy(blendedQuat);
        }

        console.log(`[NaturalPosePlugin] VRM pose "${presetName}" applied at intensity=${intensity.toFixed(2)}`);
    }

    /**
     * Reset all VRM normalized bones to T-pose (identity).
     */
    function resetVRMPose(humanoid) {
        const boneNames = Object.keys(PRESETS.relaxedStanding.bones);
        for (const boneName of boneNames) {
            const boneNode = humanoid.getNormalizedBoneNode(boneName);
            if (boneNode) {
                boneNode.quaternion.set(0, 0, 0, 1);
            }
        }
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Apply natural pose to the current avatar.
     *
     * @param {THREE.Object3D} root - Avatar scene root
     * @param {Object} options
     * @param {Object|null} options.vrm - Full VRM object (with .humanoid)
     * @param {Object|null} options.humanoid - VRM humanoid (alternative to vrm)
     * @param {string} options.preset - Preset name (default: from settings)
     */
    function apply(root, options = {}) {
        if (!root) return false;

        _currentRoot = root;

        // Resolve VRM humanoid
        const humanoid = options.humanoid || options.vrm?.humanoid || root.userData?.vrmHumanoid || null;

        // Read settings from PoseNormalizer → AnimationPresets (single source of truth)
        const poseNormalizer = window.NEXUS_POSE_NORMALIZER;
        const pnSettings = poseNormalizer?.getSettings() || {};
        const _apFallback = window.NEXUS_ANIMATION_PRESETS?.DEFAULT_POSE_INTENSITY ?? 1.0;
        const intensity = pnSettings.intensity != null ? pnSettings.intensity : _apFallback;
        const boneWeights = pnSettings.bones || {};
        const presetName = options.preset || pnSettings.preset || _activePreset;

        if (humanoid && typeof humanoid.getNormalizedBoneNode === 'function') {
            // ── VRM path: use normalized bone API (industry standard) ──
            _currentHumanoid = humanoid;
            _isVRM = true;
            applyVRMPose(humanoid, presetName, intensity, boneWeights);
            _active = true;
            _activePreset = presetName;
            return true;
        }

        // ── GLB fallback: delegate to PoseNormalizer's world-space alignment ──
        _isVRM = false;
        _currentHumanoid = null;

        if (poseNormalizer) {
            poseNormalizer.applyRelaxedStandingPose(root, options);
            _active = true;
            _activePreset = presetName;
            console.log('[NaturalPosePlugin] GLB fallback: delegated to PoseNormalizer');
            return true;
        }

        console.warn('[NaturalPosePlugin] No VRM humanoid and no PoseNormalizer — cannot apply pose');
        return false;
    }

    /**
     * Reset pose back to T-pose.
     */
    function reset() {
        if (_isVRM && _currentHumanoid) {
            resetVRMPose(_currentHumanoid);
        } else if (_currentRoot && window.NEXUS_POSE_NORMALIZER) {
            window.NEXUS_POSE_NORMALIZER.restoreNeutralPose(_currentRoot);
        }
        _active = false;
        console.log('[NaturalPosePlugin] Pose reset to T-pose');
    }

    function isActive() {
        return _active;
    }

    function getPresets() {
        return Object.entries(PRESETS).map(([key, val]) => ({
            id: key,
            label: val.label,
        }));
    }

    function setPreset(presetName) {
        if (!PRESETS[presetName]) {
            console.warn(`[NaturalPosePlugin] Unknown preset: ${presetName}`);
            return;
        }
        _activePreset = presetName;
        if (_active && _currentRoot) {
            apply(_currentRoot, { preset: presetName });
        }
    }

    function getActivePreset() {
        return _activePreset;
    }

    function isVRM() {
        return _isVRM;
    }

    // =====================================================================
    // EXPOSE
    // =====================================================================
    window.NEXUS_NATURAL_POSE = {
        apply,
        reset,
        isActive,
        isVRM,
        getPresets,
        setPreset,
        getActivePreset,
        PRESETS,
    };

    console.log('[NaturalPosePlugin] Module loaded');
})();
