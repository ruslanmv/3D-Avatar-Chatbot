'use strict';

/**
 * NEXUS PoseNormalizer (GLOBAL script)
 * ------------------------------------
 * Unified, world-space pose normalization for VRM and GLB humanoid avatars.
 *
 * Replaces the 3 separate T-pose fix implementations that previously lived in:
 *   - VRMLoader.fixTPose()          (simple Euler upper-arm only)
 *   - ProceduralAnimator.fixTPose() (hardcoded Z-axis quaternion)
 *   - vrm-manager.js thumbnail      (name-based bone.rotation.z)
 *
 * Core idea:
 *   Instead of applying fixed Euler angles, we compute each limb's *current*
 *   world-space direction, compare it to a *target* relaxed-standing direction,
 *   and solve a correction quaternion in local bone space.  This is robust
 *   across different bone rolls, rotation orders, and rig conventions.
 *
 * Features:
 *   - Tiered rig detection: VRM humanoid API → generic name-based fallback
 *   - Per-limb world-space alignment (quaternion, not Euler)
 *   - Configurable intensity (0 = raw T-pose, 1 = fully relaxed standing)
 *   - Individual per-bone fine-tuning sliders
 *   - Correction magnitude clamping (prevents deformation on odd rigs)
 *   - Pose presets: relaxedStanding, portrait, presentation
 *   - Settings persistence via localStorage
 *
 * Exposes:
 *   window.NEXUS_POSE_NORMALIZER = {
 *       normalizeAvatarPose, applyRelaxedStandingPose, applyPortraitPose,
 *       applyThumbnailPose, restoreNeutralPose, getSettings, updateSettings,
 *       resetSettings, PRESETS
 *   }
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[PoseNormalizer] THREE not found on window.');
        return;
    }

    // Deep clone helper (avoids structuredClone for Node.js < 17 compat)
    function _deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // =====================================================================
    // SETTINGS — persisted to localStorage, editable from Settings UI
    // =====================================================================
    const STORAGE_KEY = 'nexus_pose_normalizer';

    // Read default intensity from AnimationPresets (single source of truth)
    const _AP = window.NEXUS_ANIMATION_PRESETS;
    const _DEFAULT_INTENSITY = _AP && _AP.DEFAULT_POSE_INTENSITY != null ? _AP.DEFAULT_POSE_INTENSITY : 1.0;

    const DEFAULT_SETTINGS = {
        // Global intensity: 0 = no correction, 1 = full correction
        // Reads from AnimationPresets.DEFAULT_POSE_INTENSITY (single source of truth).
        intensity: _DEFAULT_INTENSITY,

        // Per-bone intensity overrides (multiplied with global intensity)
        bones: {
            leftShoulder: 1.0,
            rightShoulder: 1.0,
            leftUpperArm: 1.0,
            rightUpperArm: 1.0,
            leftLowerArm: 1.0,
            rightLowerArm: 1.0,
            leftHand: 1.0,
            rightHand: 1.0,
            chest: 1.0,
            upperChest: 1.0,
        },

        // Maximum correction angles (radians) — safety clamp
        maxCorrection: {
            shoulder: 0.35, // ~20°
            upperArm: 1.22, // ~70°
            lowerArm: 0.52, // ~30°
            hand: 0.35, // ~20°
            chest: 0.17, // ~10°
        },

        // Active preset name
        preset: 'naturalIdle',
    };

    // =====================================================================
    // POSE PRESETS — target world-space direction vectors per limb
    // =====================================================================
    // Vectors are in world space: +X = right, +Y = up, +Z = toward camera
    // Each vector describes "where should the child end of this bone point?"
    const PRESETS = {
        relaxedStanding: {
            label: 'Relaxed Standing',
            targets: {
                leftUpperArm: new THREE.Vector3(-0.5, -0.82, 0.08),
                rightUpperArm: new THREE.Vector3(0.5, -0.82, 0.08),
                leftLowerArm: new THREE.Vector3(-0.35, -0.9, 0.12),
                rightLowerArm: new THREE.Vector3(0.35, -0.9, 0.12),
                leftHand: new THREE.Vector3(-0.3, -0.92, 0.1),
                rightHand: new THREE.Vector3(0.3, -0.92, 0.1),
                leftShoulder: new THREE.Vector3(-0.98, -0.1, 0.0),
                rightShoulder: new THREE.Vector3(0.98, -0.1, 0.0),
            },
        },
        naturalIdle: {
            label: 'Natural Idle',
            targets: {
                leftUpperArm: new THREE.Vector3(-0.35, -0.9, 0.1),
                rightUpperArm: new THREE.Vector3(0.35, -0.9, 0.1),
                leftLowerArm: new THREE.Vector3(-0.2, -0.95, 0.15),
                rightLowerArm: new THREE.Vector3(0.2, -0.95, 0.15),
                leftHand: new THREE.Vector3(-0.15, -0.96, 0.12),
                rightHand: new THREE.Vector3(0.15, -0.96, 0.12),
                leftShoulder: new THREE.Vector3(-0.97, -0.15, 0.0),
                rightShoulder: new THREE.Vector3(0.97, -0.15, 0.0),
            },
        },
        portrait: {
            label: 'Portrait / Thumbnail',
            targets: {
                leftUpperArm: new THREE.Vector3(-0.25, -0.94, 0.1),
                rightUpperArm: new THREE.Vector3(0.25, -0.94, 0.1),
                leftLowerArm: new THREE.Vector3(-0.12, -0.98, 0.14),
                rightLowerArm: new THREE.Vector3(0.12, -0.98, 0.14),
                leftHand: new THREE.Vector3(-0.1, -0.98, 0.12),
                rightHand: new THREE.Vector3(0.1, -0.98, 0.12),
                leftShoulder: new THREE.Vector3(-0.97, -0.15, 0.0),
                rightShoulder: new THREE.Vector3(0.97, -0.15, 0.0),
            },
        },
        presentation: {
            label: 'Presentation',
            targets: {
                leftUpperArm: new THREE.Vector3(-0.4, -0.88, 0.06),
                rightUpperArm: new THREE.Vector3(0.4, -0.88, 0.06),
                leftLowerArm: new THREE.Vector3(-0.25, -0.94, 0.1),
                rightLowerArm: new THREE.Vector3(0.25, -0.94, 0.1),
                leftHand: new THREE.Vector3(-0.2, -0.95, 0.08),
                rightHand: new THREE.Vector3(0.2, -0.95, 0.08),
                leftShoulder: new THREE.Vector3(-0.98, -0.08, 0.0),
                rightShoulder: new THREE.Vector3(0.98, -0.08, 0.0),
            },
        },
    };

    // Normalize all target vectors once
    Object.values(PRESETS).forEach((preset) => {
        Object.values(preset.targets).forEach((v) => v.normalize());
    });

    // =====================================================================
    // SETTINGS PERSISTENCE
    // =====================================================================
    let settings = loadSettings();

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return mergeDeep(_deepClone(DEFAULT_SETTINGS), parsed);
            }
        } catch (e) {
            console.warn('[PoseNormalizer] Failed to load settings:', e);
        }
        return _deepClone(DEFAULT_SETTINGS);
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('[PoseNormalizer] Failed to save settings:', e);
        }
    }

    function mergeDeep(target, source) {
        for (const key of Object.keys(source)) {
            if (
                source[key] &&
                typeof source[key] === 'object' &&
                !Array.isArray(source[key]) &&
                target[key] &&
                typeof target[key] === 'object'
            ) {
                mergeDeep(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
        return target;
    }

    // =====================================================================
    // RIG DETECTION
    // =====================================================================

    /**
     * Build a normalized bone map from a VRM humanoid or a generic rig.
     *
     * @param {THREE.Object3D} root  - avatar scene root
     * @param {Object|null}    rig   - VRM humanoid object (optional)
     * @returns {Object} map of semantic bone names → THREE.Bone
     */
    function buildRigMap(root, rig) {
        const map = {
            hips: null,
            spine: null,
            chest: null,
            upperChest: null,
            neck: null,
            head: null,
            leftShoulder: null,
            rightShoulder: null,
            leftUpperArm: null,
            rightUpperArm: null,
            leftLowerArm: null,
            rightLowerArm: null,
            leftHand: null,
            rightHand: null,
        };

        // ── Tier 1: VRM humanoid API ──
        if (rig && typeof rig.getNormalizedBoneNode === 'function') {
            const boneNames = Object.keys(map);
            for (const name of boneNames) {
                try {
                    const bone = rig.getNormalizedBoneNode(name);
                    if (bone) map[name] = bone;
                } catch (_) {
                    /* some VRM versions may not have all bones */
                }
            }

            // If we got at least upper arms, VRM tier is good
            if (map.leftUpperArm && map.rightUpperArm) {
                console.log('[PoseNormalizer] Rig detected: VRM humanoid (Tier 1)');
                return map;
            }
        }

        // ── Tier 2: Generic name-based bone detection ──
        const patterns = {
            hips: [/hip/i, /pelvis/i, /^hips$/i, /root/i],
            spine: [/spine/i, /abdomen/i],
            chest: [/chest/i, /thorax/i],
            upperChest: [/upperchest/i, /upper_chest/i],
            neck: [/neck/i, /cervical/i],
            head: [/head/i],
            leftShoulder: [/left.*shoulder/i, /shoulder.*l$/i, /l_shoulder/i],
            rightShoulder: [/right.*shoulder/i, /shoulder.*r$/i, /r_shoulder/i],
            leftUpperArm: [/left.*upper.*arm/i, /upperarm.*l$/i, /l_upperarm/i, /j_buki_l/i],
            rightUpperArm: [/right.*upper.*arm/i, /upperarm.*r$/i, /r_upperarm/i, /j_buki_r/i],
            leftLowerArm: [
                /left.*lower.*arm/i,
                /left.*fore.*arm/i,
                /lowerarm.*l$/i,
                /forearm.*l$/i,
                /l_lowerarm/i,
                /j_ude_l/i,
            ],
            rightLowerArm: [
                /right.*lower.*arm/i,
                /right.*fore.*arm/i,
                /lowerarm.*r$/i,
                /forearm.*r$/i,
                /r_lowerarm/i,
                /j_ude_r/i,
            ],
            leftHand: [/left.*hand/i, /hand.*l$/i, /l_hand/i],
            rightHand: [/right.*hand/i, /hand.*r$/i, /r_hand/i],
        };

        root.traverse((o) => {
            if (!o || !o.isBone) return;
            const n = o.name || '';
            for (const [key, regexes] of Object.entries(patterns)) {
                if (map[key]) continue; // already found
                for (const re of regexes) {
                    if (re.test(n)) {
                        map[key] = o;
                        break;
                    }
                }
            }
        });

        // Infer missing lower arms from upper arm children
        if (map.leftUpperArm && !map.leftLowerArm) {
            map.leftLowerArm = map.leftUpperArm.children.find((c) => c.isBone) || null;
        }
        if (map.rightUpperArm && !map.rightLowerArm) {
            map.rightLowerArm = map.rightUpperArm.children.find((c) => c.isBone) || null;
        }

        // Infer missing hands from lower arm children
        if (map.leftLowerArm && !map.leftHand) {
            map.leftHand = map.leftLowerArm.children.find((c) => c.isBone) || null;
        }
        if (map.rightLowerArm && !map.rightHand) {
            map.rightHand = map.rightLowerArm.children.find((c) => c.isBone) || null;
        }

        const tier = map.leftUpperArm && map.rightUpperArm ? 'Tier 2 (name-based)' : 'Tier 3 (incomplete)';
        console.log('[PoseNormalizer] Rig detected:', tier);
        return map;
    }

    // =====================================================================
    // WORLD-SPACE POSE ALIGNMENT
    // =====================================================================

    const _worldPos = new THREE.Vector3();
    const _childWorldPos = new THREE.Vector3();
    const _currentDir = new THREE.Vector3();
    const _targetDir = new THREE.Vector3();
    const _correction = new THREE.Quaternion();
    const _parentWorldQuat = new THREE.Quaternion();
    const _parentWorldQuatInv = new THREE.Quaternion();
    const _identity = new THREE.Quaternion();
    const _localCorrection = new THREE.Quaternion();

    /**
     * Get the world-space direction vector from a bone to its child bone.
     *
     * @param {THREE.Bone} bone      - parent bone
     * @param {THREE.Bone} childBone - child bone (or next in chain)
     * @returns {THREE.Vector3} normalized direction in world space
     */
    function getBoneDirectionWorld(bone, childBone) {
        bone.getWorldPosition(_worldPos);
        childBone.getWorldPosition(_childWorldPos);
        return _currentDir.subVectors(_childWorldPos, _worldPos).normalize();
    }

    /**
     * Apply a world-space rotation correction to a bone, converting it to local space.
     *
     * @param {THREE.Bone}       bone           - the bone to rotate
     * @param {THREE.Quaternion}  worldCorrection - correction quaternion in world space
     * @param {number}            intensity       - 0..1 blend factor
     * @param {number}            maxAngle        - maximum correction angle in radians
     */
    function applyWorldCorrectionToBone(bone, worldCorrection, intensity, maxAngle) {
        // Clamp correction magnitude
        const angle = 2 * Math.acos(Math.min(1, Math.abs(worldCorrection.w)));
        if (angle > maxAngle) {
            // Scale down the correction
            const scale = maxAngle / angle;
            worldCorrection.slerp(_identity, 1 - scale);
        }

        // Apply intensity blend (slerp factor: 0 = no correction, >1 = amplified)
        if (intensity !== 1.0) {
            worldCorrection.slerp(_identity, 1 - intensity);
        }

        // Convert world correction to local space
        if (bone.parent) {
            bone.parent.getWorldQuaternion(_parentWorldQuat);
            _parentWorldQuatInv.copy(_parentWorldQuat).invert();
            _localCorrection.copy(_parentWorldQuatInv).multiply(worldCorrection).multiply(_parentWorldQuat);
        } else {
            _localCorrection.copy(worldCorrection);
        }

        // Apply: bone.quaternion = localCorrection * bone.quaternion
        bone.quaternion.premultiply(_localCorrection);
    }

    /**
     * Align a single limb segment toward a target world-space direction.
     *
     * @param {THREE.Bone}   bone        - bone to rotate
     * @param {THREE.Bone}   childBone   - child bone (defines current direction)
     * @param {THREE.Vector3} targetDir  - desired direction in world space
     * @param {number}        intensity  - 0..1
     * @param {number}        maxAngle   - max correction in radians
     */
    function alignBoneToTarget(bone, childBone, targetDir, intensity, maxAngle) {
        if (!bone || !childBone) return;

        // Ensure world matrices are up to date
        bone.updateWorldMatrix(true, false);
        childBone.updateWorldMatrix(true, false);

        const currentDir = getBoneDirectionWorld(bone, childBone);
        _targetDir.copy(targetDir).normalize();

        // Compute correction quaternion: rotate currentDir → targetDir
        _correction.setFromUnitVectors(currentDir, _targetDir);

        applyWorldCorrectionToBone(bone, _correction, intensity, maxAngle);
    }

    // =====================================================================
    // MAIN POSE NORMALIZATION
    // =====================================================================

    /**
     * Get the child bone for direction computation.
     * For a given semantic bone, returns the next bone in the chain.
     */
    function getChildBone(boneName, rigMap) {
        const childMap = {
            leftShoulder: 'leftUpperArm',
            rightShoulder: 'rightUpperArm',
            leftUpperArm: 'leftLowerArm',
            rightUpperArm: 'rightLowerArm',
            leftLowerArm: 'leftHand',
            rightLowerArm: 'rightHand',
        };
        const childName = childMap[boneName];
        if (childName && rigMap[childName]) return rigMap[childName];

        // Fallback: use first bone child
        const bone = rigMap[boneName];
        if (bone) {
            return bone.children.find((c) => c.isBone) || null;
        }
        return null;
    }

    /**
     * Get the max correction angle for a bone category.
     */
    function getMaxAngle(boneName) {
        if (boneName.includes('Shoulder') || boneName.includes('shoulder')) {
            return settings.maxCorrection.shoulder;
        }
        if (boneName.includes('UpperArm') || boneName.includes('upperArm')) {
            return settings.maxCorrection.upperArm;
        }
        if (boneName.includes('LowerArm') || boneName.includes('lowerArm')) {
            return settings.maxCorrection.lowerArm;
        }
        if (boneName.includes('Hand') || boneName.includes('hand')) {
            return settings.maxCorrection.hand;
        }
        if (boneName.includes('chest') || boneName.includes('Chest')) {
            return settings.maxCorrection.chest;
        }
        return 0.7; // generic fallback
    }

    /**
     * Apply pose normalization to an avatar.
     *
     * @param {THREE.Object3D} root     - avatar scene root
     * @param {Object}         options
     * @param {Object|null}    options.rig        - VRM humanoid (optional)
     * @param {number}         options.intensity   - 0..1 override (default: from settings)
     * @param {string}         options.preset      - preset name (default: from settings)
     * @returns {Object} rigMap for external use (e.g., re-capture rest pose)
     */
    function normalizeAvatarPose(root, options = {}) {
        if (!root) return null;

        const rig = options.rig || null;
        const globalIntensity = options.intensity != null ? options.intensity : settings.intensity;
        const presetName = options.preset || settings.preset;
        const preset = PRESETS[presetName] || PRESETS.relaxedStanding;

        const rigMap = buildRigMap(root, rig);

        // Ensure world matrices are computed
        root.updateWorldMatrix(false, true);

        // Apply alignment for each target bone
        const targetBones = [
            'leftShoulder',
            'rightShoulder',
            'leftUpperArm',
            'rightUpperArm',
            'leftLowerArm',
            'rightLowerArm',
            'leftHand',
            'rightHand',
        ];

        for (const boneName of targetBones) {
            const bone = rigMap[boneName];
            if (!bone) continue;

            const target = preset.targets[boneName];
            if (!target) continue;

            const childBone = getChildBone(boneName, rigMap);
            if (!childBone) continue;

            // Compute effective intensity: global * per-bone
            const boneIntensity = settings.bones[boneName] != null ? settings.bones[boneName] : 1.0;
            const effectiveIntensity = globalIntensity * boneIntensity;

            if (effectiveIntensity <= 0) continue;

            const maxAngle = getMaxAngle(boneName);
            alignBoneToTarget(bone, childBone, target, effectiveIntensity, maxAngle);
        }

        // Update matrices after all corrections
        root.updateWorldMatrix(false, true);

        console.log(`[PoseNormalizer] Applied "${presetName}" at intensity=${globalIntensity.toFixed(2)}`);
        return rigMap;
    }

    // =====================================================================
    // CONVENIENCE METHODS
    // =====================================================================

    function applyRelaxedStandingPose(root, options = {}) {
        return normalizeAvatarPose(root, { ...options, preset: 'relaxedStanding' });
    }

    function applyPortraitPose(root, options = {}) {
        return normalizeAvatarPose(root, { ...options, preset: 'portrait' });
    }

    function applyThumbnailPose(root, options = {}) {
        return normalizeAvatarPose(root, { ...options, preset: 'portrait' });
    }

    function applyPresentationPose(root, options = {}) {
        return normalizeAvatarPose(root, { ...options, preset: 'presentation' });
    }

    /**
     * Restore all bones to their bind pose (identity local rotations).
     * Useful before re-applying a different preset.
     */
    function restoreNeutralPose(root) {
        if (!root) return;
        root.traverse((o) => {
            if (o.isBone && o.userData.__poseNormalizerOrigQuat) {
                o.quaternion.copy(o.userData.__poseNormalizerOrigQuat);
            }
        });
        root.updateWorldMatrix(false, true);
    }

    /**
     * Snapshot original bone quaternions before normalization.
     * Call this once right after loading, before any pose correction.
     */
    function snapshotOriginalPose(root) {
        if (!root) return;
        root.traverse((o) => {
            if (o.isBone && o.userData) {
                o.userData.__poseNormalizerOrigQuat = o.quaternion.clone();
            }
        });
    }

    // =====================================================================
    // SETTINGS API — for UI integration
    // =====================================================================

    function getSettings() {
        return _deepClone(settings);
    }

    function updateSettings(patch) {
        mergeDeep(settings, patch);
        saveSettings();
        // Dispatch event so ProceduralAnimator re-applies the pose in real-time
        window.dispatchEvent(new Event('pose-settings-changed'));
        return _deepClone(settings);
    }

    function resetSettings() {
        settings = _deepClone(DEFAULT_SETTINGS);
        saveSettings();
        // Dispatch event so ProceduralAnimator re-applies the pose in real-time
        window.dispatchEvent(new Event('pose-settings-changed'));
        return _deepClone(settings);
    }

    function getDefaultSettings() {
        return _deepClone(DEFAULT_SETTINGS);
    }

    // =====================================================================
    // EXPOSE PUBLIC API
    // =====================================================================
    window.NEXUS_POSE_NORMALIZER = {
        normalizeAvatarPose,
        applyRelaxedStandingPose,
        applyPortraitPose,
        applyThumbnailPose,
        applyPresentationPose,
        restoreNeutralPose,
        snapshotOriginalPose,
        buildRigMap,
        getSettings,
        updateSettings,
        resetSettings,
        getDefaultSettings,
        PRESETS,
    };

    console.log('[PoseNormalizer] Module loaded');
})();
