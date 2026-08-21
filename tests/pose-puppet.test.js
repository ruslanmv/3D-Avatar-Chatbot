/**
 * Tests for PosePuppetIK — chain data integrity and a real CCD convergence
 * check on a synthetic 3-joint arm, using the vendored three.js build.
 */

/* global describe, test, expect, beforeAll */

const THREE = require('../vendor/three-0.147.0/build/three.min.js');

beforeAll(() => {
    global.THREE = THREE;
    if (typeof window !== 'undefined') window.THREE = THREE;
});

const Puppet = require('../src/PosePuppetIK');

/** Rig-key vocabulary Pose Studio actually exposes. */
const KNOWN_KEYS = [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'leftShoulder',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightShoulder',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
];

describe('PosePuppetIK chain definitions', () => {
    test('every chain only references known rig keys', () => {
        for (const [effector, chain] of Object.entries(Puppet.CHAINS)) {
            expect(KNOWN_KEYS).toContain(effector);
            for (const joint of chain) {
                expect(KNOWN_KEYS).toContain(joint.key);
                expect(joint.w).toBeGreaterThan(0);
                expect(joint.w).toBeLessThanOrEqual(1);
            }
        }
    });

    test('weights fall off child → parent (natural whole-body feel)', () => {
        for (const chain of Object.values(Puppet.CHAINS)) {
            for (let i = 1; i < chain.length; i++) {
                expect(chain[i].w).toBeLessThanOrEqual(chain[i - 1].w);
            }
        }
    });

    test('primary effectors exist for hands, feet and head', () => {
        for (const key of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head']) {
            expect(Puppet.hasChain(key)).toBe(true);
        }
    });
});

describe('PosePuppetIK solver', () => {
    /** Build a simple arm: shoulder → upper(0.3) → lower(0.3) → hand(0.25). */
    function buildArmRig() {
        const root = new THREE.Object3D();
        const upper = new THREE.Object3D();
        const lower = new THREE.Object3D();
        const hand = new THREE.Object3D();
        upper.position.set(0.2, 1.4, 0);
        lower.position.set(0.3, 0, 0);
        hand.position.set(0.3, 0, 0);
        root.add(upper);
        upper.add(lower);
        lower.add(hand);
        root.updateMatrixWorld(true);

        const bones = {
            rightUpperArm: upper,
            rightLowerArm: lower,
            rightHand: hand,
            rightShoulder: null, // absent joints must be skipped gracefully
            chest: null,
            spine: null,
        };
        return {
            root,
            bones,
            getBone(key) {
                return bones[key] || null;
            },
        };
    }

    test('drags the effector toward the target and reports moved bones', () => {
        const rig = buildArmRig();
        const hand = rig.getBone('rightHand');
        const target = new THREE.Vector3(0.45, 1.0, 0.25);
        const before = hand.getWorldPosition(new THREE.Vector3()).distanceTo(target);

        let changed = [];
        for (let i = 0; i < 6; i++) {
            changed = Puppet.solve(rig, 'rightHand', target);
        }
        const after = hand.getWorldPosition(new THREE.Vector3()).distanceTo(target);

        expect(after).toBeLessThan(before * 0.35);
        expect(changed).toContain('rightHand');
        expect(changed).toContain('rightLowerArm');
        expect(changed).toContain('rightUpperArm');
        expect(changed).not.toContain('rightShoulder'); // missing bone skipped
    });

    test('unreachable targets are clamped instead of exploding', () => {
        const rig = buildArmRig();
        const far = new THREE.Vector3(10, 10, 10);
        expect(() => {
            for (let i = 0; i < 4; i++) Puppet.solve(rig, 'rightHand', far);
        }).not.toThrow();
        const q = rig.getBone('rightUpperArm').quaternion;
        expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
    });

    test('screenTarget projects onto the camera-facing plane through the anchor', () => {
        const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
        cam.position.set(0, 1.4, 3);
        cam.lookAt(0, 1.4, 0);
        cam.updateMatrixWorld(true);

        const anchor = new THREE.Vector3(0.2, 1.4, 0);
        const center = Puppet.screenTarget(cam, new THREE.Vector2(0, 0), anchor);
        expect(center).not.toBeNull();
        // Same depth plane as the anchor (camera looks down -Z)
        expect(Math.abs(center.z - anchor.z)).toBeLessThan(1e-3);
        // Pointer to the right moves the target to the right
        const right = Puppet.screenTarget(cam, new THREE.Vector2(0.5, 0), anchor);
        expect(right.x).toBeGreaterThan(center.x);
    });

    test('missing chain or rig returns an empty change set', () => {
        expect(Puppet.solve(null, 'rightHand', new THREE.Vector3())).toEqual([]);
        const rig = buildArmRig();
        expect(Puppet.solve(rig, 'notABone', new THREE.Vector3())).toEqual([]);
    });

    test('setEnabled persists and reports', () => {
        Puppet.setEnabled(false);
        expect(Puppet.isEnabled()).toBe(false);
        Puppet.setEnabled(true);
        expect(Puppet.isEnabled()).toBe(true);
    });
});

describe('PosePuppetIK write-rig / visual-rig frame correction', () => {
    /**
     * three-vrm 2.x splits the skeleton in two: the solver rotates the
     * NORMALIZED write bones, while handles are drawn on the RAW visual bones.
     * The frames diverge whenever anything animates the raw skeleton — the very
     * bug that made the overlays float off the body. `frameOffset()` re-expresses
     * the drag target in write-rig space so a grab stays put until the pointer
     * actually moves.
     */
    function buildArm(shoulderRotZ) {
        const root = new THREE.Object3D();
        const upper = new THREE.Object3D();
        const lower = new THREE.Object3D();
        const hand = new THREE.Object3D();
        upper.position.set(0.2, 1.4, 0);
        lower.position.set(0.3, 0, 0);
        hand.position.set(0.3, 0, 0);
        root.add(upper);
        upper.add(lower);
        lower.add(hand);
        upper.rotation.z = shoulderRotZ || 0;
        root.updateMatrixWorld(true);
        return { root, upper, lower, hand };
    }

    function rigFor(writeArm) {
        const bones = {
            rightUpperArm: writeArm.upper,
            rightLowerArm: writeArm.lower,
            rightHand: writeArm.hand,
        };
        return {
            bones,
            getBone(k) {
                return bones[k] || null;
            },
        };
    }

    test('an uncorrected grab snaps the limb across the frame gap', () => {
        const write = buildArm(0); // proxy sits in rest pose
        const visual = buildArm((Math.PI * 50) / 180); // idle clip raised the real arm
        const rig = rigFor(write);

        const anchor = visual.hand.getWorldPosition(new THREE.Vector3());
        const before = write.hand.getWorldPosition(new THREE.Vector3());
        expect(before.distanceTo(anchor)).toBeGreaterThan(0.4); // frames really do diverge

        // Pointer never moved, so the raw screen target is the visual anchor.
        for (let i = 0; i < 6; i++) Puppet.solve(rig, 'rightHand', anchor.clone());
        const after = write.hand.getWorldPosition(new THREE.Vector3());
        expect(before.distanceTo(after)).toBeGreaterThan(0.3); // documents the jump
    });

    test('frameOffset keeps a zero-movement grab perfectly still', () => {
        const write = buildArm(0);
        const visual = buildArm((Math.PI * 50) / 180);
        const rig = rigFor(write);

        const anchor = visual.hand.getWorldPosition(new THREE.Vector3());
        const offset = Puppet.frameOffset(rig, 'rightHand', anchor);
        expect(offset).not.toBeNull();

        const before = write.hand.getWorldPosition(new THREE.Vector3());
        const target = anchor.clone().add(offset); // what the overlays now send
        for (let i = 0; i < 6; i++) Puppet.solve(rig, 'rightHand', target.clone());
        const after = write.hand.getWorldPosition(new THREE.Vector3());

        expect(before.distanceTo(after)).toBeLessThan(0.01);
        expect(Math.abs(write.upper.rotation.z)).toBeLessThan(0.02);
    });

    test('pointer movement still drags the corrected target', () => {
        const write = buildArm(0);
        const visual = buildArm((Math.PI * 50) / 180);
        const rig = rigFor(write);

        const anchor = visual.hand.getWorldPosition(new THREE.Vector3());
        const offset = Puppet.frameOffset(rig, 'rightHand', anchor);

        // Pointer moved 20 cm down: the write-rig hand should track that delta.
        const moved = anchor.clone().add(new THREE.Vector3(0, -0.2, 0));
        const want = moved.clone().add(offset);
        for (let i = 0; i < 8; i++) Puppet.solve(rig, 'rightHand', want.clone());

        const after = write.hand.getWorldPosition(new THREE.Vector3());
        expect(after.distanceTo(want)).toBeLessThan(0.05);
    });

    test('frameOffset degrades safely on bad input', () => {
        const rig = rigFor(buildArm(0));
        expect(Puppet.frameOffset(null, 'rightHand', new THREE.Vector3())).toBeNull();
        expect(Puppet.frameOffset(rig, 'notABone', new THREE.Vector3())).toBeNull();
        expect(Puppet.frameOffset(rig, 'rightHand', null)).toBeNull();
    });
});
