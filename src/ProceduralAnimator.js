'use strict';

/**
 * NEXUS ProceduralAnimator (GLOBAL script)
 * ---------------------------------------
 * Purpose: add "life" to static/idle rigs:
 * - Fixes T-pose-ish rest by applying a gentle arm-down rest offset (only when no baked clips)
 * - Breathing sway (spine/chest)
 * - Subtle head look to mouse (idle)
 * - Simple "modes" for UI quick actions: idle | happy | thinking | dance | talk
 *
 * Safe-by-default:
 * - Does NOT fight baked animations unless you explicitly call setAllowWithMixer(true)
 * - Stores rest pose and applies offsets relative to rest
 *
 * Exposes:
 *   window.NEXUS_PROCEDURAL_ANIMATOR = { registerAvatar, update, setMode, setAllowWithMixer }
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

    // Mouse input (normalized -1..1)
    const mouse = { x: 0, y: 0 };
    let inputInit = false;

    // Rest pose cache
    const rest = new Map(); // bone.uuid -> { pos: Vector3, quat: Quaternion }

    // Mode system
    let mode = 'idle';
    let modeUntilMs = 0;

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
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });
        inputInit = true;
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
            leftUpperArm: null,
            rightUpperArm: null,
            leftLowerArm: null,
            rightLowerArm: null,
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

    // ---------------------------
    // T-Pose Fix — lower arms to natural resting pose
    // Uses unified PoseNormalizer when available, falls back to legacy Euler offsets.
    // ---------------------------
    function fixTPose() {
        if (!bones) return;

        // Prefer unified PoseNormalizer (world-space alignment)
        if (window.NEXUS_POSE_NORMALIZER && avatarRoot) {
            const opts = {};
            // Pass VRM humanoid rig for Tier 1 bone detection (stored by AvatarManager)
            if (avatarRoot.userData?.vrmHumanoid) {
                opts.rig = avatarRoot.userData.vrmHumanoid;
            }
            window.NEXUS_POSE_NORMALIZER.applyRelaxedStandingPose(avatarRoot, opts);
            console.log('[ProceduralAnimator] T-pose fix: delegated to PoseNormalizer');
            return;
        }

        // Legacy fallback: fixed Euler offsets
        console.warn('[ProceduralAnimator] PoseNormalizer not available, using legacy T-pose fix');
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
        // Works across different rig conventions (Mixamo, VRM, custom)
        fixTPose();
        // Re-capture to treat this as new rest pose:
        captureRestPose(avatarRoot);

        mode = 'idle';
        modeUntilMs = 0;

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
    }

    function update(timeSec, dtSec) {
        if (!avatarRoot || !bones) return;

        // expire mode
        if (mode !== 'idle' && performance.now() > modeUntilMs) {
            mode = 'idle';
            forceMode = false; // Disable force mode when returning to idle
        }

        // If mixer is active and we are not allowed, bail (do not fight baked clips)
        // UNLESS forceMode is enabled (quick actions override this)
        if (hasBakedAnimations && !allowWithMixer && !forceMode) return;

        // Reset touched bones each frame to avoid drift
        // Include all bones that might be modified by procedural animations
        const touched = [
            bones.hips,
            bones.spine,
            bones.chest,
            bones.neck,
            bones.head,
            bones.leftUpperArm,
            bones.rightUpperArm,
            bones.leftLowerArm,
            bones.rightLowerArm,
        ];
        touched.forEach((b) => b && restoreToRest(b));

        // ---------------------------
        // Base idle life
        // ---------------------------
        // Breathing
        if (bones.spine) {
            const breath = Math.sin(timeSec * 2.0) * 0.04;
            applyOffsetEuler(bones.spine, new THREE.Euler(breath, 0, 0));
        }
        if (bones.chest && bones.chest !== bones.spine) {
            const breath2 = Math.sin(timeSec * 2.0 + 0.7) * 0.03;
            applyOffsetEuler(bones.chest, new THREE.Euler(breath2, 0, 0));
        }

        // Head look (mouse)
        if (bones.head) {
            const yawT = THREE.MathUtils.clamp(mouse.x * 0.55, -0.7, 0.7);
            const pitchT = THREE.MathUtils.clamp(mouse.y * 0.25, -0.45, 0.45);

            const ud = (bones.head.userData.__nexus_proc ||= { yaw: 0, pitch: 0 });
            ud.yaw = damp(ud.yaw, yawT, 10, dtSec || 0.016);
            ud.pitch = damp(ud.pitch, pitchT, 10, dtSec || 0.016);

            applyOffsetEuler(bones.head, new THREE.Euler(ud.pitch, ud.yaw, 0));
        }

        // ---------------------------
        // Mode overlays - EXAGGERATED for visibility
        // ---------------------------
        if (mode === 'thinking') {
            // More pronounced head tilt + body sway
            if (bones.head) {
                const tilt = Math.sin(timeSec * 1.4) * 0.25; // Increased from 0.12
                applyOffsetEuler(bones.head, new THREE.Euler(0.15, 0.0, tilt));
            }
            if (bones.hips) {
                const sway = Math.sin(timeSec * 1.2) * 0.15; // Increased from 0.08
                applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
            }
            if (bones.chest) {
                const twist = Math.sin(timeSec * 1.3) * 0.1;
                applyOffsetEuler(bones.chest, new THREE.Euler(0, -twist, 0));
            }
        } else if (mode === 'happy') {
            // Energetic bounce + chest up
            if (bones.chest) {
                const up = Math.sin(timeSec * 3.2) * 0.12; // Doubled from 0.06
                applyOffsetEuler(bones.chest, new THREE.Euler(-0.15 + up, 0, 0));
            }
            if (bones.hips) {
                const bounce = Math.sin(timeSec * 3.2) * 0.1; // Increased from 0.04
                applyOffsetEuler(bones.hips, new THREE.Euler(bounce, 0, 0));
            }
            // Add arm waves for happy
            if (bones.leftUpperArm) {
                const wave = Math.sin(timeSec * 3.0) * 0.3;
                applyOffsetEuler(bones.leftUpperArm, new THREE.Euler(wave, 0, 0));
            }
            if (bones.rightUpperArm) {
                const wave = Math.sin(timeSec * 3.0 + Math.PI) * 0.3; // Phase shifted
                applyOffsetEuler(bones.rightUpperArm, new THREE.Euler(wave, 0, 0));
            }
        } else if (mode === 'dance') {
            // Exaggerated dance motion
            if (bones.hips) {
                const sway = Math.sin(timeSec * 5.0) * 0.35; // Increased from 0.18
                applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
            }
            if (bones.chest) {
                const twist = Math.sin(timeSec * 6.0) * 0.25; // Increased from 0.12
                applyOffsetEuler(bones.chest, new THREE.Euler(0, twist, 0));
            }
            // Add arm movements for dance
            if (bones.leftUpperArm) {
                const armMove = Math.sin(timeSec * 4.0) * 0.4;
                applyOffsetEuler(bones.leftUpperArm, new THREE.Euler(armMove, 0, Math.sin(timeSec * 3.0) * 0.2));
            }
            if (bones.rightUpperArm) {
                const armMove = Math.sin(timeSec * 4.0 + Math.PI) * 0.4;
                applyOffsetEuler(
                    bones.rightUpperArm,
                    new THREE.Euler(armMove, 0, Math.sin(timeSec * 3.0 + Math.PI) * 0.2)
                );
            }
        } else if (mode === 'talk') {
            // Visible nodding
            if (bones.head) {
                const nod = Math.sin(timeSec * 10.0) * 0.12;
                applyOffsetEuler(bones.head, new THREE.Euler(nod, 0, 0));
            }
            if (bones.chest) {
                const breathTalk = Math.sin(timeSec * 6.0) * 0.06;
                applyOffsetEuler(bones.chest, new THREE.Euler(breathTalk, 0, 0));
            }
            // Jaw bone fallback for Tier C models (no morph targets)
            if (bones.jaw) {
                const jawOpen = (Math.sin(timeSec * 12.0) + 1) * 0.5 * 0.25; // 0..0.25 rad
                applyOffsetEuler(bones.jaw, new THREE.Euler(jawOpen, 0, 0));
            }
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
        console.log('[ProceduralAnimator] Pose settings changed — re-applying T-pose fix');

        // Restore original bind pose before re-applying correction
        if (window.NEXUS_POSE_NORMALIZER?.restoreNeutralPose) {
            window.NEXUS_POSE_NORMALIZER.restoreNeutralPose(avatarRoot);
        }

        // Re-apply the T-pose fix with updated settings
        fixTPose();

        // Re-capture rest pose so breathing/head-look animate from the new base
        captureRestPose(avatarRoot);
    });

    // expose
    window.NEXUS_PROCEDURAL_ANIMATOR = {
        registerAvatar,
        unregisterAvatar,
        update,
        setMode,
        setAllowWithMixer,
    };
})();
