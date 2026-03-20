/**
 * VRGazeController — "Follow-Me Eyes" for VR
 * -------------------------------------------
 * Makes the avatar look at the user's head (HMD) position in VR space.
 *
 * Technique (inspired by AAA NPC gaze — Half-Life: Alyx, God of War, RDR2):
 *
 *   1. Each frame, get the XR camera world position (= user's head/eyes).
 *   2. Get the avatar head bone world position.
 *   3. Compute the direction vector from avatar head → user head.
 *   4. Compute yaw/pitch in world space (both VRM and GLB face +Z after loading).
 *   5. Normalize to the -1..1 range that ProceduralAnimator's mouse system expects.
 *   6. Feed via setGazeOverride() — head bone rotates toward the user.
 *   7. Directly apply VRM eye expressions (lookLeft/Right/Up/Down) so eyes
 *      lead head rotation — the AAA "eyes snap first" pattern.
 *
 * Natural gaze behaviors (researched from AAA games & VR UX guidelines):
 *   - Eyes lead head rotation by a small amount (faster saccade response)
 *   - Micro-saccades: tiny random eye jitter to avoid "dead stare"
 *   - Blink on large gaze shifts (saccade-suppression, a real human reflex)
 *   - Soft dead-zone: when user is nearly centered, reduce head movement (eyes only)
 *   - Smooth damping: head follows with natural inertia, not instant snap
 *   - Comfort clamps: head doesn't rotate past natural limits
 *
 * Toggle: can be enabled/disabled via VR settings panel (default: ON).
 */

const THREE = window.THREE;

// Reusable vectors (no per-frame allocation for Quest perf)
const _avatarHeadPos = new THREE.Vector3();
const _userHeadPos = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class VRGazeController {
    constructor(renderer, camera) {
        this.renderer = renderer;
        this.camera = camera;
        this.enabled = true;

        /**
         * When true (GAZE: LOCK), BehaviorEngine yields gaze control
         * during LISTENING/THINKING/SPEAKING states so the avatar
         * maintains eye contact throughout conversation.
         * When false (GAZE: ON), BehaviorEngine's state-based gaze
         * patterns (thinking drift, etc.) play normally.
         * Default: true (best conversational experience).
         */
        this.conversationalGaze = true;

        // Current smoothed gaze values (normalized -1..1)
        this._gazeX = 0;
        this._gazeY = 0;

        // Micro-saccade state
        this._saccadeTimer = 0;
        this._saccadeOffsetX = 0;
        this._saccadeOffsetY = 0;
        this._nextSaccadeAt = 0.3 + Math.random() * 0.5;

        // Blink-on-shift state
        this._prevGazeX = 0;
        this._prevGazeY = 0;

        // Smoothed eye yaw/pitch (for smooth VRM expression application)
        this._eyeYaw = 0;
        this._eyePitch = 0;

        // Avatar reference (set externally)
        this._avatarRoot = null;
        this._headBone = null;
    }

    /**
     * Get the VRM expression manager for the current avatar.
     * Uses the same access path as BehaviorEngine._getVRMLoader().
     * Returns null if unavailable (GLB model, or VRM not loaded).
     */
    _getExpressionManager() {
        const viewer = window.NEXUS_VIEWER;
        const vrm = viewer?.avatarManager?._currentVRM;
        return vrm?.expressionManager || null;
    }

    /**
     * Set the avatar root so we can find the head bone.
     */
    setAvatar(avatarRoot) {
        this._avatarRoot = avatarRoot;
        this._headBone = null;
        if (!avatarRoot) return;

        // Find head bone (same heuristics as ProceduralAnimator)
        avatarRoot.traverse((obj) => {
            if (!obj.isBone) return;
            const n = obj.name.toLowerCase();
            if (!this._headBone && n.includes('head') && !n.includes('headset')) {
                this._headBone = obj;
            }
        });

        if (this._headBone) {
            console.log(`[VRGazeController] Head bone found: ${this._headBone.name}`);
        } else {
            console.warn('[VRGazeController] Head bone not found — follow-me gaze will be inactive');
        }
    }

    /**
     * Called every frame from ViewerEngine.animate() during VR.
     * @param {number} dt - delta time in seconds
     */
    update(dt) {
        if (!this.enabled || !this._headBone || !this.renderer.xr.isPresenting) return;

        const animator = window.NEXUS_PROCEDURAL_ANIMATOR;
        if (!animator) return;

        // --- 1. Get user head position (XR camera) ---
        const xrCamera = this.renderer.xr.getCamera();
        if (!xrCamera) return;
        _userHeadPos.setFromMatrixPosition(xrCamera.matrixWorld);

        // --- 2. Get avatar head bone world position ---
        this._headBone.updateWorldMatrix(true, false);
        _avatarHeadPos.setFromMatrixPosition(this._headBone.matrixWorld);

        // --- 3. Direction from avatar head to user head ---
        _dir.subVectors(_userHeadPos, _avatarHeadPos);
        const distance = _dir.length();
        if (distance < 0.01) return; // too close, skip
        _dir.normalize();

        // --- 4. Compute yaw/pitch in WORLD space ---
        // Both VRM and GLB avatars face +Z in world after loading
        // (VRM root gets Math.PI rotation, GLB stays at 0 — both result in +Z facing).
        // Computing in world space avoids root-local coordinate confusion
        // where VRM's local forward is -Z but GLB's is +Z.
        //
        // yaw  = atan2(x, z): positive = user is to avatar's right (+X)
        // pitch = asin(y):    positive = user is above avatar
        const rawYaw = Math.atan2(_dir.x, _dir.z);
        const rawPitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));

        // --- 5. Normalize to -1..1 range ---
        // Map comfortable gaze range (~±60° yaw, ±40° pitch) to -1..1
        const yawNorm = THREE.MathUtils.clamp(rawYaw / (Math.PI / 3), -1, 1);
        const pitchNorm = THREE.MathUtils.clamp(rawPitch / (Math.PI / 4.5), -1, 1);

        // --- 6. Dead zone: if user is nearly centered, reduce head movement ---
        // Eyes handle small offsets; head only kicks in for larger angles.
        // This mimics natural human behavior — eyes move first, head follows.
        const deadZone = 0.15;
        let headYaw = yawNorm;
        let headPitch = pitchNorm;
        if (Math.abs(yawNorm) < deadZone) {
            headYaw = 0;
        } else {
            headYaw = (Math.sign(yawNorm) * (Math.abs(yawNorm) - deadZone)) / (1 - deadZone);
        }
        if (Math.abs(pitchNorm) < deadZone) {
            headPitch = 0;
        } else {
            headPitch = (Math.sign(pitchNorm) * (Math.abs(pitchNorm) - deadZone)) / (1 - deadZone);
        }

        // --- 7. Smooth damping (head has inertia, like a real person) ---
        const dampSpeed = 4.0; // higher = faster tracking
        const t = 1 - Math.exp(-dampSpeed * dt);
        this._gazeX += (headYaw - this._gazeX) * t;
        this._gazeY += (headPitch - this._gazeY) * t;

        // --- 8. Micro-saccades (tiny eye jitter to avoid dead stare) ---
        this._saccadeTimer += dt;
        if (this._saccadeTimer >= this._nextSaccadeAt) {
            this._saccadeTimer = 0;
            this._nextSaccadeAt = 0.2 + Math.random() * 0.6; // 200-800ms intervals
            this._saccadeOffsetX = (Math.random() - 0.5) * 0.03;
            this._saccadeOffsetY = (Math.random() - 0.5) * 0.02;
        }

        // --- 9. Blink on large gaze shifts ---
        const gazeShift = Math.abs(yawNorm - this._prevGazeX) + Math.abs(pitchNorm - this._prevGazeY);
        if (gazeShift > 0.4) {
            // Trigger a quick blink via BehaviorEngine
            const behavior = window.NEXUS_BEHAVIOR;
            if (behavior && behavior._triggerBlink) {
                behavior._triggerBlink();
            }
        }
        this._prevGazeX = yawNorm;
        this._prevGazeY = pitchNorm;

        // --- 10. Feed into ProceduralAnimator via gaze override ---
        animator.setGazeOverride({
            x: this._gazeX,
            y: this._gazeY,
        });

        // --- 11. Directly apply VRM eye expressions (eyes lead head) ---
        // AAA pattern: eyes snap to full target quickly, head follows with
        // damped inertia. The difference = eyes are always ahead of the head.
        //
        // BehaviorEngine._updateGaze() is skipped when _isFollowGazeActive()
        // returns true (GAZE: LOCK in VR), so we MUST drive lookLeft/Right/
        // Up/Down ourselves — otherwise eyes stay frozen during SPEAKING.
        //
        // References:
        //   - Half-Life: Alyx, God of War, Wind Waker NPC gaze systems
        //   - @pixiv/three-vrm LookAt expression type (lookLeft/Right/Up/Down)
        //   - Unity Realistic Eye Movements asset (eyes-lead-head paradigm)
        const eyeTargetYaw = THREE.MathUtils.clamp(yawNorm + this._saccadeOffsetX, -1, 1);
        const eyeTargetPitch = THREE.MathUtils.clamp(pitchNorm + this._saccadeOffsetY, -1, 1);

        // Also feed BehaviorEngine targets — used when GAZE: ON (non-LOCK)
        // where BehaviorEngine._updateGaze() still runs and applies its own
        // smooth eye interpolation. Harmless when LOCK is active since
        // _updateGaze() is skipped in that case.
        const behavior = window.NEXUS_BEHAVIOR;
        if (behavior) {
            behavior.gazeTargetYaw = eyeTargetYaw;
            behavior.gazeTargetPitch = eyeTargetPitch;
        }

        // Directly apply VRM eye expressions (mandatory for GAZE: LOCK mode
        // where BehaviorEngine._updateGaze() is skipped).
        // Smooth eye interpolation — faster than head (6x) for the natural
        // "eyes snap, head follows" AAA feel. Eyes arrive first, head catches up.
        const eyeDamp = 1 - Math.exp(-24.0 * dt);
        this._eyeYaw += (eyeTargetYaw - this._eyeYaw) * eyeDamp;
        this._eyePitch += (eyeTargetPitch - this._eyePitch) * eyeDamp;

        const em = this._getExpressionManager();
        if (em) {
            try {
                em.setValue('lookLeft', Math.max(0, -this._eyeYaw));
                em.setValue('lookRight', Math.max(0, this._eyeYaw));
                em.setValue('lookUp', Math.max(0, this._eyePitch));
                em.setValue('lookDown', Math.max(0, -this._eyePitch));
            } catch (_) {
                /* gaze expressions may not exist on this model */
            }
        }
    }

    /**
     * Release gaze override when VR ends or feature is toggled off.
     */
    release() {
        const animator = window.NEXUS_PROCEDURAL_ANIMATOR;
        if (animator) {
            animator.setGazeOverride(null);
        }
        this._gazeX = 0;
        this._gazeY = 0;
        this._eyeYaw = 0;
        this._eyePitch = 0;

        // Clear VRM eye expressions so BehaviorEngine can resume control
        const em = this._getExpressionManager();
        if (em) {
            try {
                em.setValue('lookLeft', 0);
                em.setValue('lookRight', 0);
                em.setValue('lookUp', 0);
                em.setValue('lookDown', 0);
            } catch (_) {}
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.release();
        } else {
            // Immediately set a gaze override so ProceduralAnimator's mouse
            // fallback path is suppressed from the very first frame.
            // Without this, the first frame uses stale desktop mouse values
            // and the gaze appears to not work until toggled OFF→ON.
            const animator = window.NEXUS_PROCEDURAL_ANIMATOR;
            if (animator) {
                animator.setGazeOverride({ x: this._gazeX, y: this._gazeY });
            }
        }
        console.log(`[VRGazeController] Follow-me gaze ${enabled ? 'ON' : 'OFF'}`);
    }

    dispose() {
        this.release();
        this._avatarRoot = null;
        this._headBone = null;
    }
}
