'use strict';

/**
 * NEXUS ProceduralAnimator (GLOBAL script)
 * ---------------------------------------
 * Purpose: add "life" to static/idle rigs:
 * - Fixes T-pose-ish rest by applying a gentle arm-down rest offset (only when no baked clips)
 * - Base standing poses (lecturerNeutral, presenterOpen, anchorGrounded, + mature poses)
 * - Breathing sway (spine/chest)
 * - Subtle head look to mouse (idle)
 * - Simple "modes" for UI quick actions: idle | happy | thinking | dance | talk
 * - Speaking gesture styles (explainCalm, explainEmphasis, broadcastAnchor)
 *
 * Safe-by-default:
 * - Does NOT fight baked animations unless you explicitly call setAllowWithMixer(true)
 * - Stores rest pose and applies offsets relative to rest
 *
 * Exposes:
 *   window.NEXUS_PROCEDURAL_ANIMATOR = {
 *     registerAvatar, update, setMode, setAllowWithMixer,
 *     setBasePose, setTalkStyle, setEditMode, unregisterAvatar
 *   }
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[ProceduralAnimator] THREE not found on window. (vendor globals missing)');
        return;
    }

    // ---------------------------
    // Internal state
    // ---------------------------
    let avatarRoot = null;
    let bones = null;

    // If model has baked clips (AnimationMixer driven), default is to NOT modify bones.
    let hasBakedAnimations = false;

    // If true, we still allow subtle head look/breath even with mixer.
    // Default true — procedural animations (breathing, head look) always active
    // as a safe fallback for avatars without designed animations.
    let allowWithMixer = true;

    // Force mode: when true, procedural animations ALWAYS run (used for quick actions)
    let forceMode = false;

    // Edit mode: when true, Pose Studio is active — skip all procedural bone updates
    let editMode = false;

    // Animation override: when true, animations play even during editMode
    // Used when user explicitly triggers an animation from the Pose Studio panel
    let animOverride = false;

    // Mouse/touch input (normalized -1..1)
    const mouse = { x: 0, y: 0 };
    let inputInit = false;

    // Gaze override: when non-null, head bone ignores mouse/touch and uses these values
    let gazeOverride = null; // { x: number, y: number } | null

    // Face tracking: when active, mouse/touch input is ignored and head uses webcam rotation
    let faceTrackingActive = false;
    let faceTrackingHead = null; // { yaw, pitch, roll } or null

    // Rest pose cache
    const rest = new Map(); // bone.uuid -> { pos: Vector3, quat: Quaternion }

    // Mode system
    let mode = 'idle';
    let modeUntilMs = 0;

    // Base standing pose and talk gesture style
    let basePose = 'lecturerNeutral';
    let talkStyle = 'explainCalm';

    // Small per-bone smoothed targets stored in userData
    function damp(current, target, lambda, dt) {
        // THREE.MathUtils.damp exists in newer versions. Fallback to exp smoothing.
        if (THREE.MathUtils && typeof THREE.MathUtils.damp === 'function') {
            return THREE.MathUtils.damp(current, target, lambda, dt);
        }
        const t = 1 - Math.exp(-lambda * (dt || 0.016));
        return current + (target - current) * t;
    }

    function ensureInput() {
        if (inputInit) return;
        window.addEventListener('mousemove', (e) => {
            if (gazeOverride || faceTrackingActive) return; // skip during gaze override or face tracking
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });
        // Touch tracking for mobile — skip touches on UI controls
        window.addEventListener(
            'touchmove',
            (e) => {
                if (gazeOverride || faceTrackingActive) return;
                var t = e.touches[0];
                if (!t) return;
                var el = document.elementFromPoint(t.clientX, t.clientY);
                if (el && el.closest('.voice-btn-compact, .chat-input, .send-btn, .chat-input-bar')) return;
                mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
            },
            { passive: true }
        );
        inputInit = true;
    }

    function setGazeOverride(coords) {
        gazeOverride = coords; // { x, y } or null
        if (coords) {
            mouse.x = coords.x;
            mouse.y = coords.y;
        }
    }

    /**
     * Enable/disable face tracking mode.
     * When active, mouse/touch input is ignored for head rotation.
     */
    function setFaceTrackingActive(active) {
        faceTrackingActive = !!active;
    }

    /**
     * Set head rotation from face tracking webcam data.
     * Pass null to release head back to mouse follow.
     * @param {number|null} yaw
     * @param {number} [pitch]
     * @param {number} [roll]
     */
    function setFaceTrackingHead(yaw, pitch, roll) {
        if (yaw === null || yaw === undefined) {
            faceTrackingHead = null;
        } else {
            faceTrackingHead = { yaw, pitch: pitch || 0, roll: roll || 0 };
        }
    }

    // ---------------------------
    // Bone discovery (heuristics)
    // ---------------------------
    function findBones(root) {
        const map = {
            head: null,
            neck: null,
            spine: null,
            chest: null,
            hips: null,
            jaw: null,
            leftShoulder: null,
            rightShoulder: null,
            leftUpperArm: null,
            rightUpperArm: null,
            leftLowerArm: null,
            rightLowerArm: null,
            leftHand: null,
            rightHand: null,
            // Finger bones: Proximal + Intermediate + Distal (30 bones total)
            // Required for camera-based hand tracking (MediaPipe HandLandmarker)
            leftThumbProximal: null,
            leftThumbIntermediate: null,
            leftThumbDistal: null,
            leftIndexProximal: null,
            leftIndexIntermediate: null,
            leftIndexDistal: null,
            leftMiddleProximal: null,
            leftMiddleIntermediate: null,
            leftMiddleDistal: null,
            leftRingProximal: null,
            leftRingIntermediate: null,
            leftRingDistal: null,
            leftLittleProximal: null,
            leftLittleIntermediate: null,
            leftLittleDistal: null,
            rightThumbProximal: null,
            rightThumbIntermediate: null,
            rightThumbDistal: null,
            rightIndexProximal: null,
            rightIndexIntermediate: null,
            rightIndexDistal: null,
            rightMiddleProximal: null,
            rightMiddleIntermediate: null,
            rightMiddleDistal: null,
            rightRingProximal: null,
            rightRingIntermediate: null,
            rightRingDistal: null,
            rightLittleProximal: null,
            rightLittleIntermediate: null,
            rightLittleDistal: null,
            leftUpperLeg: null,
            rightUpperLeg: null,
            leftLowerLeg: null,
            rightLowerLeg: null,
            leftFoot: null,
            rightFoot: null,
        };

        root.traverse((o) => {
            if (!o || !o.isBone) return;
            const n = (o.name || '').toLowerCase();

            // jaw (for Tier C talk fallback)
            if (
                !map.jaw &&
                (n === 'jaw' || n === 'jawbone' || n === 'jaw_bone' || (n.includes('jaw') && !n.includes('upper')))
            ) {
                map.jaw = o;
                return;
            }

            // core
            if (!map.head && n.includes('head')) map.head = o;
            else if (!map.neck && (n.includes('neck') || n.includes('cervical'))) map.neck = o;
            else if (!map.hips && (n.includes('hip') || n.includes('pelvis') || n === 'hips' || n.includes('root')))
                map.hips = o;
            else if (!map.spine && (n.includes('spine') || n.includes('abdomen') || n.includes('body'))) map.spine = o;
            else if (!map.chest && (n.includes('chest') || n.includes('thorax') || n.includes('upperchest')))
                map.chest = o;
            // shoulders
            else if (!map.leftShoulder && n.includes('left') && n.includes('shoulder') && !n.includes('arm')) {
                map.leftShoulder = o;
            } else if (!map.rightShoulder && n.includes('right') && n.includes('shoulder') && !n.includes('arm')) {
                map.rightShoulder = o;
            }
            // arms (upper)
            else if (
                !map.leftUpperArm &&
                n.includes('left') &&
                (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
            ) {
                map.leftUpperArm = o;
            } else if (
                !map.rightUpperArm &&
                n.includes('right') &&
                (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
            ) {
                map.rightUpperArm = o;
            }
            // arms (lower/forearm)
            else if (!map.leftLowerArm && n.includes('left') && (n.includes('lowerarm') || n.includes('forearm'))) {
                map.leftLowerArm = o;
            } else if (!map.rightLowerArm && n.includes('right') && (n.includes('lowerarm') || n.includes('forearm'))) {
                map.rightLowerArm = o;
            }
            // hands
            else if (!map.leftHand && n.includes('left') && n.includes('hand') && !n.includes('arm')) {
                map.leftHand = o;
            } else if (!map.rightHand && n.includes('right') && n.includes('hand') && !n.includes('arm')) {
                map.rightHand = o;
            }
            // legs (upper)
            else if (!map.leftUpperLeg && n.includes('left') && (n.includes('upperleg') || n.includes('thigh'))) {
                map.leftUpperLeg = o;
            } else if (!map.rightUpperLeg && n.includes('right') && (n.includes('upperleg') || n.includes('thigh'))) {
                map.rightUpperLeg = o;
            }
            // legs (lower)
            else if (
                !map.leftLowerLeg &&
                n.includes('left') &&
                (n.includes('lowerleg') || n.includes('shin') || n.includes('calf'))
            ) {
                map.leftLowerLeg = o;
            } else if (
                !map.rightLowerLeg &&
                n.includes('right') &&
                (n.includes('lowerleg') || n.includes('shin') || n.includes('calf'))
            ) {
                map.rightLowerLeg = o;
            }
            // feet
            else if (!map.leftFoot && n.includes('left') && n.includes('foot')) {
                map.leftFoot = o;
            } else if (!map.rightFoot && n.includes('right') && n.includes('foot')) {
                map.rightFoot = o;
            }
        });

        // fallback preference
        if (!map.chest && map.spine) map.chest = map.spine;

        // Try to find lowerArm from upperArm children if not found by name
        if (map.leftUpperArm && !map.leftLowerArm) {
            map.leftLowerArm = map.leftUpperArm.children.find((c) => c.isBone) || null;
        }
        if (map.rightUpperArm && !map.rightLowerArm) {
            map.rightLowerArm = map.rightUpperArm.children.find((c) => c.isBone) || null;
        }

        // ── Finger bone discovery via VRM humanoid API ──
        // VRM finger bone names vary between models, so heuristic name matching
        // is unreliable. The VRM humanoid API provides a standard interface.
        var humanoid =
            root.userData?.vrm?.humanoid ||
            root.userData?.vrmHumanoid ||
            window.NEXUS_VIEWER?.avatarManager?._currentVRM?.humanoid;
        if (humanoid && typeof humanoid.getNormalizedBoneNode === 'function') {
            var fingerNames = [
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
            for (var fi = 0; fi < fingerNames.length; fi++) {
                var fn = fingerNames[fi];
                if (!map[fn]) {
                    // getRawBoneNode gives us the actual skeleton bone (not normalized proxy)
                    var rawBone = typeof humanoid.getRawBoneNode === 'function' ? humanoid.getRawBoneNode(fn) : null;
                    if (rawBone) {
                        map[fn] = rawBone;
                    }
                }
            }
        }

        return map;
    }

    function captureRestPose(root) {
        rest.clear();
        root.traverse((o) => {
            if (!o || !o.isBone) return;
            rest.set(o.uuid, {
                pos: o.position.clone(),
                quat: o.quaternion.clone(),
            });
        });
    }

    function restoreToRest(bone) {
        const r = rest.get(bone.uuid);
        if (!r) return;
        bone.position.copy(r.pos);
        bone.quaternion.copy(r.quat);
    }

    function applyOffsetEuler(bone, euler) {
        const r = rest.get(bone.uuid);
        if (!r) return;
        const qOff = new THREE.Quaternion().setFromEuler(euler);
        bone.quaternion.copy(r.quat).multiply(qOff);
    }

    /**
     * Additive offset — multiplies on TOP of the bone's current quaternion.
     * Use this after applyBasePose() so animations layer on the base pose
     * rather than replacing it.
     */
    function applyAdditiveEuler(bone, euler) {
        const qOff = new THREE.Quaternion().setFromEuler(euler);
        bone.quaternion.multiply(qOff);
    }

    // ---------------------------
    // Helper: degrees to radians shorthand
    // ---------------------------
    function deg(x) {
        return THREE.MathUtils.degToRad(x);
    }

    // ---------------------------
    // Base standing pose system (reads from AnimationPresets)
    // ---------------------------
    const AP = window.NEXUS_ANIMATION_PRESETS;

    function applyPoseOffsetMap(map) {
        if (!map) return;
        Object.entries(map).forEach(([boneKey, euler]) => {
            const bone = bones?.[boneKey];
            if (!bone) return;
            applyOffsetEuler(bone, euler);
        });
    }

    function getBasePoseMap(name) {
        // Use centralized presets if available
        if (AP && AP.getBasePoseEulerMap) {
            return AP.getBasePoseEulerMap(THREE, name);
        }
        return null;
    }

    function applyBasePose() {
        applyPoseOffsetMap(getBasePoseMap(basePose));
    }

    // ---------------------------
    // Speaking gesture styles — data-driven from AnimationPresets
    // ---------------------------

    /**
     * Apply a data-driven animation definition (talk style or mode anim).
     *
     * Uses HYBRID compositing to prevent compounding:
     *   - ARM CHAIN bones (shoulders, arms, hands, fingers): ADDITIVE on base pose
     *     → preserves the base pose's arm-lowering offsets (prevents A-pose)
     *   - BODY CORE bones (hips, spine, chest, head, neck, legs, feet): FROM REST
     *     → prevents double-rotation (base pose + mode = spinning/wild motion)
     *
     * This matches AAA practice: body animations define complete poses from
     * neutral, while arm positioning preserves the character's resting stance.
     */
    var _armChainBones = {
        leftShoulder: 1,
        rightShoulder: 1,
        leftUpperArm: 1,
        rightUpperArm: 1,
        leftLowerArm: 1,
        rightLowerArm: 1,
        leftHand: 1,
        rightHand: 1,
        leftThumbProximal: 1,
        leftThumbIntermediate: 1,
        leftThumbDistal: 1,
        leftIndexProximal: 1,
        leftIndexIntermediate: 1,
        leftIndexDistal: 1,
        leftMiddleProximal: 1,
        leftMiddleIntermediate: 1,
        leftMiddleDistal: 1,
        leftRingProximal: 1,
        leftRingIntermediate: 1,
        leftRingDistal: 1,
        leftLittleProximal: 1,
        leftLittleIntermediate: 1,
        leftLittleDistal: 1,
        rightThumbProximal: 1,
        rightThumbIntermediate: 1,
        rightThumbDistal: 1,
        rightIndexProximal: 1,
        rightIndexIntermediate: 1,
        rightIndexDistal: 1,
        rightMiddleProximal: 1,
        rightMiddleIntermediate: 1,
        rightMiddleDistal: 1,
        rightRingProximal: 1,
        rightRingIntermediate: 1,
        rightRingDistal: 1,
        rightLittleProximal: 1,
        rightLittleIntermediate: 1,
        rightLittleDistal: 1,
    };

    function applyAnimDef(animDef, timeSec) {
        if (!animDef || !AP) return;
        var boneKeys = Object.keys(animDef);
        for (var i = 0; i < boneKeys.length; i++) {
            var boneKey = boneKeys[i];
            var bone = bones?.[boneKey];
            if (!bone) continue;
            var channels = animDef[boneKey];
            if (!channels) continue;
            var euler = AP.evalAnimChannels(THREE, channels, timeSec);
            if (_armChainBones[boneKey]) {
                // Arm chain: additive on base pose (keeps arms at sides)
                applyAdditiveEuler(bone, euler);
            } else {
                // Body core: from rest (prevents compounding with base pose)
                applyOffsetEuler(bone, euler);
            }
        }
    }

    /**
     * Find a talk style definition from presets and apply it.
     */
    function applyTalkStyle(timeSec) {
        if (!AP) return;
        var styleId = (talkStyle || 'explainCalm').toLowerCase();
        var allStyles = (AP.TALK_STYLES || []).concat(AP.ADULT_TALK_STYLES || []);
        for (var i = 0; i < allStyles.length; i++) {
            if (allStyles[i].id.toLowerCase() === styleId) {
                applyAnimDef(allStyles[i].anim, timeSec);
                return;
            }
        }
        // Fallback: first style
        if (allStyles.length > 0 && allStyles[0].anim) {
            applyAnimDef(allStyles[0].anim, timeSec);
        }
    }

    // ---------------------------
    // T-Pose Fix — lower arms to natural resting pose
    // Uses unified PoseNormalizer when available, falls back to legacy Euler offsets.
    // ---------------------------
    function fixTPose() {
        if (!bones) return;

        // ── PRIMARY: NaturalPosePlugin (VRM normalized bone API — industry standard) ──
        // Uses the same technique as VRoid Hub: sets quaternion rotations on
        // normalized proxy bones relative to T-pose.  vrm.update() syncs them
        // to raw bones automatically each frame.
        if (window.NEXUS_NATURAL_POSE && avatarRoot) {
            const applied = window.NEXUS_NATURAL_POSE.apply(avatarRoot);
            if (applied) {
                console.log('[ProceduralAnimator] T-pose fix: NaturalPosePlugin (VRM normalized bones)');
                return;
            }
        }

        // ── FALLBACK: PoseNormalizer (world-space alignment — legacy) ──
        if (window.NEXUS_POSE_NORMALIZER && avatarRoot) {
            const opts = {};
            if (avatarRoot.userData?.vrmHumanoid) {
                opts.rig = avatarRoot.userData.vrmHumanoid;
            }
            window.NEXUS_POSE_NORMALIZER.applyRelaxedStandingPose(avatarRoot, opts);
            console.log('[ProceduralAnimator] T-pose fix: PoseNormalizer (world-space fallback)');
            return;
        }

        // ── LAST RESORT: fixed Euler offsets ──
        console.warn('[ProceduralAnimator] No pose plugins available, using legacy Euler fix');
        const angle = Math.PI / 4.5;

        if (bones.leftUpperArm) {
            const r = rest.get(bones.leftUpperArm.uuid);
            if (r) {
                const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle));
                bones.leftUpperArm.quaternion.copy(r.quat).multiply(offset);
            }
        }

        if (bones.rightUpperArm) {
            const r = rest.get(bones.rightUpperArm.uuid);
            if (r) {
                const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -angle));
                bones.rightUpperArm.quaternion.copy(r.quat).multiply(offset);
            }
        }

        const elbowBend = Math.PI / 12;
        if (bones.leftLowerArm) {
            const r = rest.get(bones.leftLowerArm.uuid);
            if (r) {
                const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -elbowBend, 0));
                bones.leftLowerArm.quaternion.copy(r.quat).multiply(offset);
            }
        }
        if (bones.rightLowerArm) {
            const r = rest.get(bones.rightLowerArm.uuid);
            if (r) {
                const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, elbowBend, 0));
                bones.rightLowerArm.quaternion.copy(r.quat).multiply(offset);
            }
        }
    }

    // ---------------------------
    // Public API
    // ---------------------------
    function registerAvatar(root, hasClips) {
        ensureInput();

        avatarRoot = root || null;
        hasBakedAnimations = !!hasClips;

        if (!avatarRoot) {
            bones = null;
            rest.clear();
            return;
        }

        bones = findBones(avatarRoot);
        captureRestPose(avatarRoot);

        // Snapshot original bind pose for PoseNormalizer's restoreNeutralPose
        if (window.NEXUS_POSE_NORMALIZER?.snapshotOriginalPose) {
            window.NEXUS_POSE_NORMALIZER.snapshotOriginalPose(avatarRoot);
        }

        // ALWAYS apply natural standing pose fix (geometry-based T-pose correction)
        // Some models have baked animations but still start in T-pose
        // Use geometry-aware quaternion rotation for reliable arm positioning
        fixTPose();

        // Force VRM to sync normalized bones → raw skeleton NOW so that
        // captureRestPose() below picks up the corrected arm positions.
        // Without this, the rest pose would still be T-pose on raw bones and
        // vrm.update() in the render loop would overwrite procedural offsets.
        const _vrm =
            window.NEXUS_VIEWER?.avatarManager?._currentVRM ||
            window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM;
        if (_vrm?.update) {
            _vrm.update(0);
        }

        // Re-capture to treat this as new rest pose:
        captureRestPose(avatarRoot);

        mode = 'waiting';
        modeUntilMs = 0;

        // ── CRITICAL: Apply first frame immediately ──
        // Without this, the avatar displays the NaturalPosePlugin-only pose
        // (arms at 55° from horizontal = A-pose) until the render loop's
        // first update() call. In Genshin Impact and AAA games, the very
        // first visible frame is already the natural standing idle.
        // Force one update(0,0) to apply base pose + waiting mode NOW.
        try {
            update(0, 0);
        } catch (_) {}

        console.log('[ProceduralAnimator] Registered avatar. bakedClips=', hasBakedAnimations, 'bones=', {
            head: !!bones.head,
            spine: !!bones.spine,
            hips: !!bones.hips,
            leftUpperArm: !!bones.leftUpperArm,
            rightUpperArm: !!bones.rightUpperArm,
            leftLowerArm: !!bones.leftLowerArm,
            rightLowerArm: !!bones.rightLowerArm,
        });
    }

    function setAllowWithMixer(v) {
        allowWithMixer = !!v;
    }

    function setMode(nextMode, durationMs) {
        mode = (nextMode || 'idle').toLowerCase();
        const dur = Number.isFinite(durationMs) ? durationMs : 1200;
        modeUntilMs = performance.now() + Math.max(0, dur);

        // Enable force mode for non-idle modes (quick actions)
        // This makes procedural animations visible even with baked animations
        forceMode = mode !== 'idle';

        // Enable animation override so animations play even during Pose Studio editMode
        // When returning to idle, disable the override so the editor regains control
        animOverride = mode !== 'idle';
    }

    function setBasePose(nextPose) {
        basePose = (nextPose || 'lecturerNeutral').trim();
        console.log('[ProceduralAnimator] Base pose set:', basePose);
    }

    function setTalkStyle(nextStyle) {
        talkStyle = (nextStyle || 'explainCalm').trim();
        console.log('[ProceduralAnimator] Talk style set:', talkStyle);
    }

    function update(timeSec, dtSec) {
        if (!avatarRoot || !bones) return;

        // Pose Studio is active — do not fight the editor
        // UNLESS user explicitly triggered an animation from the panel (animOverride)
        if (editMode && !animOverride) return;

        // Apply speed multiplier to animation time
        timeSec = timeSec * speedMultiplier;

        // expire mode
        if (mode !== 'idle' && performance.now() > modeUntilMs) {
            mode = 'idle';
            forceMode = false; // Disable force mode when returning to idle
            animOverride = false; // Re-enable editMode protection
        }

        // If mixer is active and we are not allowed, bail (do not fight baked clips)
        // UNLESS forceMode is enabled (quick actions override this)
        if (hasBakedAnimations && !allowWithMixer && !forceMode) return;

        // Reset touched bones each frame to avoid drift
        // Include all bones that might be modified by procedural animations
        //
        // ── LOCOMOTION_HOOK: When walking, skip lower-body bones so walk clip
        // drives hips/legs while ProceduralAnimator controls upper body only.
        // Non-destructive: if _NEXUS_LOCOMOTION_UPPER_BODY_ONLY is undefined/false,
        // behaviour is unchanged. To remove: delete the locomotionWalking check.
        const locomotionWalking = !!window._NEXUS_LOCOMOTION_UPPER_BODY_ONLY;
        const touched = locomotionWalking
            ? [
                  // Upper body only — let walk animation control hips/spine
                  bones.chest,
                  bones.neck,
                  bones.head,
                  bones.leftUpperArm,
                  bones.rightUpperArm,
                  bones.leftLowerArm,
                  bones.rightLowerArm,
                  bones.leftHand,
                  bones.rightHand,
              ]
            : [
                  bones.hips,
                  bones.spine,
                  bones.chest,
                  bones.neck,
                  bones.head,
                  bones.leftShoulder,
                  bones.rightShoulder,
                  bones.leftUpperArm,
                  bones.rightUpperArm,
                  bones.leftLowerArm,
                  bones.rightLowerArm,
                  bones.leftHand,
                  bones.rightHand,
                  // Leg bones — must be reset so animations can keep feet planted
                  bones.leftUpperLeg,
                  bones.rightUpperLeg,
                  bones.leftLowerLeg,
                  bones.rightLowerLeg,
                  bones.leftFoot,
                  bones.rightFoot,
                  // Finger proximal bones
                  bones.leftThumbProximal,
                  bones.leftIndexProximal,
                  bones.leftMiddleProximal,
                  bones.leftRingProximal,
                  bones.leftLittleProximal,
                  bones.rightThumbProximal,
                  bones.rightIndexProximal,
                  bones.rightMiddleProximal,
                  bones.rightRingProximal,
                  bones.rightLittleProximal,
              ];
        touched.forEach((b) => b && restoreToRest(b));

        // ---------------------------
        // Base standing pose (replaces T-pose as visual default)
        // ---------------------------
        applyBasePose();

        // ---------------------------
        // Determine which bones the active mode controls
        // so we don't double-apply breathing/head on those bones.
        // ---------------------------
        var activeModeAnim = mode !== 'idle' && mode !== 'talk' && AP && AP.MODE_ANIMS ? AP.MODE_ANIMS[mode] : null;
        var modeControlsSpine = !!(activeModeAnim && activeModeAnim.spine);
        var modeControlsChest = !!(activeModeAnim && activeModeAnim.chest);
        var modeControlsHead = !!(activeModeAnim && activeModeAnim.head);

        // ---------------------------
        // Base idle life (params from AnimationPresets)
        // ---------------------------
        var idleP =
            AP && AP.IDLE_PARAMS
                ? AP.IDLE_PARAMS
                : {
                      breathing: { spine: { freq: 2.0, amp: 0.04 }, chest: { freq: 2.0, phase: 0.7, amp: 0.03 } },
                      headLook: { yawScale: 0.55, pitchScale: 0.25, yawClamp: 0.7, pitchClamp: 0.45, dampLambda: 10 },
                  };

        // Breathing (additive on base pose) — skipped when mode has its own spine/chest
        //
        // Natural breathing anatomy:
        //   - Spine: minimal pitch (X). Heavy X-axis rotation pitches head
        //     forward/backward, causing VR nausea.  Real breathing lifts the
        //     ribcage upward (slight -Z rotation lifts shoulders) with only
        //     a tiny forward pitch.
        //   - Chest: primary expansion.  Chest lifts slightly up and forward.
        //     Phase offset from spine simulates wave propagation.
        //
        // Frequency: 0.2-0.27 Hz = 12-16 breaths/min (resting adult).
        if (bones.spine && !modeControlsSpine) {
            var bp = idleP.breathing.spine;
            var breathX = Math.sin(timeSec * bp.freq * Math.PI * 2) * bp.amp;
            applyAdditiveEuler(bones.spine, new THREE.Euler(breathX, 0, 0));
        }
        if (bones.chest && bones.chest !== bones.spine && !modeControlsChest) {
            var cp = idleP.breathing.chest;
            var breathPhase = timeSec * cp.freq * Math.PI * 2 + (cp.phase || 0);
            var breathChestX = Math.sin(breathPhase) * cp.amp;
            // Subtle shoulder lift on inhale (Z-axis) — keeps head stable
            var breathChestZ = Math.sin(breathPhase) * cp.amp * 0.3;
            applyAdditiveEuler(bones.chest, new THREE.Euler(breathChestX, 0, -breathChestZ));
        }

        // Head look — skipped when mode has its own head channels (dance, happy, etc.)
        if (bones.head && !modeControlsHead) {
            var hl = idleP.headLook;
            var ud = (bones.head.userData.__nexus_proc ||= { yaw: 0, pitch: 0, roll: 0 });

            if (faceTrackingHead) {
                // Face tracking active — use webcam head rotation directly
                // Negate yaw for mirror effect (webcam is mirrored)
                // Negate pitch: MediaPipe positive pitch = look up, but
                // VRM/Three.js positive X rotation = head tilts DOWN.
                // VRoid Hub inverts pitch so user looking up → avatar looks up.
                var ftYaw = THREE.MathUtils.clamp(-faceTrackingHead.yaw, -hl.yawClamp, hl.yawClamp);
                var ftPitch = THREE.MathUtils.clamp(-faceTrackingHead.pitch, -hl.pitchClamp, hl.pitchClamp);
                var ftRoll = THREE.MathUtils.clamp(faceTrackingHead.roll, -0.35, 0.35);

                ud.yaw = damp(ud.yaw, ftYaw, hl.dampLambda, dtSec || 0.016);
                ud.pitch = damp(ud.pitch, ftPitch, hl.dampLambda, dtSec || 0.016);
                ud.roll = damp(ud.roll || 0, ftRoll, hl.dampLambda, dtSec || 0.016);

                applyAdditiveEuler(bones.head, new THREE.Euler(ud.pitch, ud.yaw, ud.roll));
            } else {
                // Mouse/touch follow (default behavior)
                var yawT = THREE.MathUtils.clamp(mouse.x * hl.yawScale, -hl.yawClamp, hl.yawClamp);
                var pitchT = THREE.MathUtils.clamp(mouse.y * hl.pitchScale, -hl.pitchClamp, hl.pitchClamp);

                ud.yaw = damp(ud.yaw, yawT, hl.dampLambda, dtSec || 0.016);
                ud.pitch = damp(ud.pitch, pitchT, hl.dampLambda, dtSec || 0.016);
                ud.roll = damp(ud.roll || 0, 0, hl.dampLambda, dtSec || 0.016);

                applyAdditiveEuler(bones.head, new THREE.Euler(ud.pitch, ud.yaw, ud.roll));
            }
        }

        // ---------------------------
        // Mode overlays — data-driven from AnimationPresets
        // ---------------------------
        if (mode === 'talk') {
            // Speaking gesture animation — dispatches to active talkStyle
            applyTalkStyle(timeSec);
            // Jaw bone fallback for Tier C models (no morph targets)
            if (bones.jaw && AP && AP.IDLE_PARAMS) {
                var jp = AP.IDLE_PARAMS.jawTalk;
                var jawOpen = (Math.sin(timeSec * jp.freq) + 1) * 0.5 * jp.amp;
                applyAdditiveEuler(bones.jaw, new THREE.Euler(jawOpen, 0, 0));
            }
        } else if (mode !== 'idle' && AP && AP.MODE_ANIMS && AP.MODE_ANIMS[mode]) {
            // Data-driven mode animation (happy, thinking, dance, flirt, tease, intimate, etc.)
            applyAnimDef(AP.MODE_ANIMS[mode], timeSec);
        }
    }

    function unregisterAvatar(root) {
        if (avatarRoot === root || !root) {
            avatarRoot = null;
            bones = null;
            rest.clear();
            hasBakedAnimations = false;
            mode = 'idle';
            modeUntilMs = 0;
            forceMode = false;
            console.log('[ProceduralAnimator] Unregistered avatar');
        }
    }

    // ---------------------------
    // Listen for pose settings changes — re-apply pose in real-time
    // ---------------------------
    window.addEventListener('pose-settings-changed', () => {
        if (!avatarRoot || !bones) return;
        console.log('[ProceduralAnimator] Pose settings changed — re-applying pose');

        // For VRM models using NaturalPosePlugin, re-apply and re-sync rest pose
        if (window.NEXUS_NATURAL_POSE?.isActive() && window.NEXUS_NATURAL_POSE.isVRM()) {
            window.NEXUS_NATURAL_POSE.apply(avatarRoot);
            // Force VRM sync so rest pose captures corrected raw bones
            const _v =
                window.NEXUS_VIEWER?.avatarManager?._currentVRM ||
                window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM;
            if (_v?.update) _v.update(0);
            captureRestPose(avatarRoot);
            return;
        }

        // For GLB models: restore bind pose, re-apply, re-capture rest
        if (window.NEXUS_POSE_NORMALIZER?.restoreNeutralPose) {
            window.NEXUS_POSE_NORMALIZER.restoreNeutralPose(avatarRoot);
        }
        fixTPose();
        captureRestPose(avatarRoot);
    });

    function setEditMode(enabled) {
        editMode = !!enabled;
        if (enabled) {
            animOverride = false; // Reset override when entering edit mode
        }
    }

    // Animation speed multiplier (affects procedural animation tempo)
    let speedMultiplier = 1.0;

    function setSpeed(s) {
        speedMultiplier = Math.max(0.1, Math.min(4.0, Number(s) || 1.0));
        console.log('[ProceduralAnimator] Speed set:', speedMultiplier + 'x');
    }

    function getSpeed() {
        return speedMultiplier;
    }

    // expose
    window.NEXUS_PROCEDURAL_ANIMATOR = {
        registerAvatar,
        unregisterAvatar,
        update,
        setMode,
        setAllowWithMixer,
        setEditMode,
        setBasePose,
        setTalkStyle,
        setSpeed,
        getSpeed,
        setGazeOverride,
        setFaceTrackingActive,
        setFaceTrackingHead,
        captureRestPose,
    };
})();
