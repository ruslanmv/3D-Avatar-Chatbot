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
    // Default false for safety.
    let allowWithMixer = false;

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
            leftUpperArm: null,
            rightUpperArm: null,
            leftLowerArm: null,
            rightLowerArm: null,
        };

        root.traverse((o) => {
            if (!o || !o.isBone) return;
            const n = (o.name || '').toLowerCase();

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
    // Improved T-Pose Fix (geometry-based)
    // ---------------------------
    function fixTPose() {
        if (!bones) return;

        // Update world matrices to ensure accurate position data
        if (avatarRoot) avatarRoot.updateWorldMatrix(true, true);

        // Fix left arm
        if (bones.leftUpperArm && bones.leftLowerArm) {
            applyNaturalArmPose(bones.leftUpperArm, bones.leftLowerArm, 'left');
        }

        // Fix right arm
        if (bones.rightUpperArm && bones.rightLowerArm) {
            applyNaturalArmPose(bones.rightUpperArm, bones.rightLowerArm, 'right');
        }
    }

    function applyNaturalArmPose(upperArm, lowerArm, side) {
        // Get current arm direction in world space
        const upperPos = new THREE.Vector3();
        const lowerPos = new THREE.Vector3();

        upperArm.getWorldPosition(upperPos);
        lowerArm.getWorldPosition(lowerPos);

        const currentDir = new THREE.Vector3().subVectors(lowerPos, upperPos).normalize();

        // Define natural standing pose target direction (in world space)
        // Arms should point: mostly down, slightly forward, slightly outward
        const down = new THREE.Vector3(0, -1, 0);
        const forward = new THREE.Vector3(0, 0, 1);
        const outward = new THREE.Vector3(side === 'left' ? -1 : 1, 0, 0);

        // Blend vectors for natural pose
        const targetDir = new THREE.Vector3()
            .addScaledVector(down, 1.0) // Primary: down
            .addScaledVector(forward, 0.2) // Slight forward lean
            .addScaledVector(outward, 0.15) // Slight outward angle
            .normalize();

        // Calculate rotation quaternion from current to target
        const rotQuat = new THREE.Quaternion().setFromUnitVectors(currentDir, targetDir);

        // Apply rotation in parent space (convert from world to local)
        const parentQuat = new THREE.Quaternion();
        if (upperArm.parent) {
            upperArm.parent.getWorldQuaternion(parentQuat);
            parentQuat.invert();
            rotQuat.premultiply(parentQuat);
        }

        // Apply the rotation to current quaternion
        upperArm.quaternion.multiply(rotQuat);

        // Limit rotation to avoid extreme poses (clamp to ~70° max rotation)
        const maxAngle = Math.PI * 0.4; // ~72 degrees
        const angle = upperArm.quaternion.angleTo(new THREE.Quaternion()); // Angle from identity
        if (angle > maxAngle) {
            // Scale down to max allowed angle
            const axis = new THREE.Vector3();
            upperArm.quaternion.normalize();
            const currentAngle = 2 * Math.acos(THREE.MathUtils.clamp(upperArm.quaternion.w, -1, 1));
            if (currentAngle > maxAngle) {
                // Extract axis and reduce angle
                const sinHalfAngle = Math.sqrt(1 - upperArm.quaternion.w * upperArm.quaternion.w);
                if (sinHalfAngle > 0.001) {
                    axis.set(
                        upperArm.quaternion.x / sinHalfAngle,
                        upperArm.quaternion.y / sinHalfAngle,
                        upperArm.quaternion.z / sinHalfAngle
                    );
                    upperArm.quaternion.setFromAxisAngle(axis, maxAngle);
                }
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

        // If no baked animations, apply natural standing pose (geometry-based T-pose fix)
        if (!hasBakedAnimations) {
            // Use geometry-aware quaternion rotation for reliable arm positioning
            // Works across different rig conventions (Mixamo, VRM, custom)
            fixTPose();
            // Re-capture to treat this as new rest pose:
            captureRestPose(avatarRoot);
        }

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
    }

    function update(timeSec, dtSec) {
        if (!avatarRoot || !bones) return;

        // expire mode
        if (mode !== 'idle' && performance.now() > modeUntilMs) mode = 'idle';

        // If mixer is active and we are not allowed, bail (do not fight baked clips)
        if (hasBakedAnimations && !allowWithMixer) return;

        // Reset touched bones each frame to avoid drift
        const touched = [
            bones.hips,
            bones.spine,
            bones.chest,
            bones.neck,
            bones.head,
            bones.leftUpperArm,
            bones.rightUpperArm,
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
        // Mode overlays (simple)
        // ---------------------------
        if (mode === 'thinking') {
            // slight head tilt + slow sway
            if (bones.head) {
                const tilt = Math.sin(timeSec * 1.4) * 0.12;
                applyOffsetEuler(bones.head, new THREE.Euler(0.1, 0.0, tilt));
            }
            if (bones.hips) {
                const sway = Math.sin(timeSec * 1.2) * 0.08;
                applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
            }
        } else if (mode === 'happy') {
            // chest up + tiny bounce
            if (bones.chest) {
                const up = Math.sin(timeSec * 3.2) * 0.06;
                applyOffsetEuler(bones.chest, new THREE.Euler(-0.1 + up, 0, 0));
            }
            if (bones.hips) {
                const bounce = Math.sin(timeSec * 3.2) * 0.04;
                applyOffsetEuler(bones.hips, new THREE.Euler(bounce, 0, 0));
            }
        } else if (mode === 'dance') {
            if (bones.hips) {
                const sway = Math.sin(timeSec * 5.0) * 0.18;
                applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
            }
            if (bones.chest) {
                const twist = Math.sin(timeSec * 6.0) * 0.12;
                applyOffsetEuler(bones.chest, new THREE.Euler(0, twist, 0));
            }
        } else if (mode === 'talk') {
            // small nod
            if (bones.head) {
                const nod = Math.sin(timeSec * 10.0) * 0.06;
                applyOffsetEuler(bones.head, new THREE.Euler(nod, 0, 0));
            }
            if (bones.chest) {
                const breathTalk = Math.sin(timeSec * 6.0) * 0.03;
                applyOffsetEuler(bones.chest, new THREE.Euler(breathTalk, 0, 0));
            }
        }
    }

    // expose
    window.NEXUS_PROCEDURAL_ANIMATOR = {
        registerAvatar,
        update,
        setMode,
        setAllowWithMixer,
    };
})();
