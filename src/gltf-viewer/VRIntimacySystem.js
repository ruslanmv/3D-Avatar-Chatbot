import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';
import { VRContactAnchors } from './VRContactAnchors.js';
import { VRProximityTracker } from './VRProximityTracker.js';
import { VR_INTIMACY_PROFILES, resolveVRIntimacyProfile } from './VRIntimacyProfiles.js';

/**
 * VRIntimacySystem
 * ----------------
 * Additive close-presence orchestration layer.
 *
 * This is intentionally non-explicit:
 * - close conversation
 * - comfort / embrace-safe posture
 * - hand contact
 * - seated close interaction
 * - supported standing presence
 *
 * It uses existing systems:
 * - VRPoseSystem
 * - VRPuppetInteraction
 * - ProceduralAnimator
 *
 * And does NOT replace them.
 */
export class VRIntimacySystem {
    constructor({ scene, camera, renderer, controllers, poseSystem, puppetInteraction }) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controllers = controllers;
        this.poseSystem = poseSystem;
        this.puppetInteraction = puppetInteraction;

        this.avatarRoot = null;
        this.enabled = false;
        this.debug = false;
        this.emotion = 'neutral';

        this.proximity = new VRProximityTracker({ scene, camera });
        this.anchors = new VRContactAnchors({ scene, poseSystem });

        this.currentProfile = VR_INTIMACY_PROFILES.idle;
        this.currentState = 'idle';
        this._profileCooldown = 0;
        this._lastAppliedPose = null;

        this._activeHandContact = null; // { hand, anchorKey, controller }
        this._hoverPulseAt = { left: 0, right: 0 };

        this._tmpA = new THREE.Vector3();
        this._tmpB = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
    }

    setAvatar(root) {
        this.avatarRoot = root;
        this.proximity.setAvatar(root);
        this.anchors.setAvatar(root);

        if (root) {
            // Keep pose system avatar aligned if not already done elsewhere
            if (typeof this.poseSystem?.setAvatar === 'function') {
                this.poseSystem.setAvatar(root);
            }
        }
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        this.anchors.setVisible(this.enabled && this.debug);
        if (!enabled) {
            this.endAllContacts();
            this.currentProfile = VR_INTIMACY_PROFILES.idle;
            this.currentState = 'idle';
        }
    }

    setDebug(debug) {
        this.debug = !!debug;
        this.anchors.setDebug(this.debug);
    }

    setEmotion(emotion) {
        this.emotion = emotion || 'neutral';
    }

    update(dt) {
        if (!this.enabled || !this.avatarRoot || !this.renderer?.xr?.isPresenting) {
            return;
        }

        this._profileCooldown = Math.max(0, this._profileCooldown - dt);

        this.anchors.update();
        const snapshot = this.proximity.update();
        if (!snapshot) return;

        this.anchors.clearVisualState();

        const desiredProfile = resolveVRIntimacyProfile(snapshot);

        if (desiredProfile.key !== this.currentProfile.key && this._profileCooldown <= 0) {
            this.currentProfile = desiredProfile;
            this.currentState = desiredProfile.key;
            this._applyProfile(desiredProfile);
            this._profileCooldown = 0.4;
        }

        this._updateFacing(snapshot, dt);
        this._updateDistanceBand(snapshot, dt);
        this._updateBehaviorBridge();
        this._updateHandContact(dt);
    }

    endAllContacts() {
        if (this.poseSystem?.isIKActive?.()) {
            this.poseSystem.endIK();
        }
        this._activeHandContact = null;
    }

    _applyProfile(profile) {
        if (!profile) return;

        if (this.poseSystem?.enabled && profile.posePreset && profile.posePreset !== this._lastAppliedPose) {
            this.poseSystem.applyPreset(profile.posePreset, 0.45);
            this._lastAppliedPose = profile.posePreset;
        }

        // Bridge into the existing procedural animator if present
        const pa = window.NEXUS_PROCEDURAL_ANIMATOR;
        pa?.setBasePose?.(profile.basePose || 'lecturerNeutral');
        pa?.setTalkStyle?.(profile.talkStyle || 'explainCalm');
    }

    _updateBehaviorBridge() {
        const pa = window.NEXUS_PROCEDURAL_ANIMATOR;
        if (!pa) return;

        if (this.currentProfile.key === 'comfortEmbrace' || this.currentProfile.key === 'closeConversation') {
            pa.setMode?.('idle');
        }
    }

    _updateFacing(snapshot, dt) {
        if (!this.currentProfile.allowRootFacing) return;
        if (!this.avatarRoot) return;

        // If puppet system is actively moving the avatar root, don't fight it
        const puppetMode = this.puppetInteraction?.state?.mode;
        if (puppetMode === 'rootTranslate' || puppetMode === 'rootDualTransform') {
            return;
        }

        const rootPos = this.avatarRoot.getWorldPosition(this._tmpA);
        const toUser = snapshot.userHead.clone().sub(rootPos);
        toUser.y = 0;

        if (toUser.lengthSq() < 1e-6) return;

        const targetYaw = Math.atan2(toUser.x, toUser.z);
        const targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);

        this.avatarRoot.quaternion.slerp(targetQ, Math.min(1, dt * 2.4));
    }

    _updateDistanceBand(snapshot, dt) {
        if (!this.avatarRoot) return;
        if (this.currentProfile.rootFollow <= 0) return;

        const puppetMode = this.puppetInteraction?.state?.mode;
        if (puppetMode === 'rootTranslate' || puppetMode === 'rootDualTransform') {
            return;
        }

        const rootPos = this.avatarRoot.getWorldPosition(this._tmpA);
        const userPos = snapshot.userHead.clone();
        userPos.y = rootPos.y;

        const toUser = userPos.clone().sub(rootPos);
        const dist = Math.sqrt(toUser.x * toUser.x + toUser.z * toUser.z);

        if (dist < 1e-5) return;

        const desired = this.currentProfile.desiredDistance;
        const delta = dist - desired;

        // Only softly adjust if outside a comfortable band
        if (Math.abs(delta) < 0.06) return;

        toUser.normalize();

        // Move avatar root toward/away from user very gently
        const moveAmount = THREE.MathUtils.clamp(delta * this.currentProfile.rootFollow * dt * 4.0, -0.04, 0.04);

        this.avatarRoot.position.x += toUser.x * moveAmount;
        this.avatarRoot.position.z += toUser.z * moveAmount;
    }

    _updateHandContact() {
        if (!this.currentProfile.allowHandContact) {
            if (this._activeHandContact) this.endAllContacts();
            return;
        }

        const leftController = this.controllers?.controller1 || null;
        const rightController = this.controllers?.controller2 || null;

        this._updateHandHoverAndContact('left', leftController);
        this._updateHandHoverAndContact('right', rightController);
    }

    _updateHandHoverAndContact(hand, controller) {
        if (!controller) return;

        const controllerPos = controller.getWorldPosition(this._tmpB.clone());
        const nearest = this.anchors.findNearest(controllerPos, 0.16, ['leftHand', 'rightHand']);

        if (nearest) {
            this.anchors.setAnchorHovered(nearest.key, true);
            this._maybePulseHaptics(hand, 18);
        }

        const gripPressed = this._isGripPressed(hand);

        // Start contact
        if (gripPressed && nearest && !this._activeHandContact && this.poseSystem?.enabled) {
            const ok = this.poseSystem.startIK(nearest.key, controller);
            if (ok) {
                this._activeHandContact = {
                    hand,
                    anchorKey: nearest.key,
                    controller,
                };
                this.anchors.setAnchorActive(nearest.key, true);
                this.currentProfile = VR_INTIMACY_PROFILES.handContact;
                this.currentState = 'handContact';
                this._applyProfile(this.currentProfile);
                this._maybePulseHaptics(hand, 35);
            }
            return;
        }

        // Maintain contact visuals
        if (this._activeHandContact && this._activeHandContact.hand === hand) {
            this.anchors.setAnchorActive(this._activeHandContact.anchorKey, true);

            if (!gripPressed) {
                this.poseSystem?.endIK?.();
                this._activeHandContact = null;
                this._maybePulseHaptics(hand, 25);
            }
        }
    }

    _isGripPressed(hand) {
        const src = this.controllers?.controllers?.[hand];
        const gp = src?.gamepad;
        return !!gp?.buttons?.[1]?.pressed;
    }

    _maybePulseHaptics(hand, strength = 18) {
        const now = performance.now();
        if (now - this._hoverPulseAt[hand] < 120) return;

        const src = this.controllers?.controllers?.[hand];
        const gp = src?.gamepad;
        const actuator = gp?.hapticActuators?.[0];
        if (actuator?.pulse) {
            actuator.pulse(Math.min(1, strength / 100), 20).catch(() => {});
            this._hoverPulseAt[hand] = now;
        }
    }
}
