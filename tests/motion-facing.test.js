/**
 * Facing math regression (the "hello spins her 90° left" bug).
 *
 * Setup mirrors the real app: ViewerEngine rests VRM roots at
 * rotation.y = π because VRM forward is −Z, and the desktop camera sits at
 * +Z. "Face the user" must therefore be a NO-OP at rest. The old
 * _faceTarget used atan2(dx, dz) — the +Z-forward yaw — so every ambient
 * look_at (mandated on every reply) dragged the avatar toward facing AWAY:
 * ~90–110° on the first reply, ~40° on the next, and so on. A second bug —
 * JS % keeps the dividend's sign — made diffs below −π unwind as whole
 * extra revolutions after a "turn around".
 */

/* global describe, test, expect, beforeEach */

const MI = require('../src/xr/MotionIntegration');

const TWO_PI = 2 * Math.PI;

/** A minimal stand-in for avatarManager.currentRoot (VRM, rest yaw = π). */
function vrmRootAtRest() {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: Math.PI, z: 0 },
        userData: { isVRM: true },
    };
}

let root;
beforeEach(() => {
    root = vrmRootAtRest();
    MI.onAvatarChanged(root, null);
});

describe('_normAngle — smallest signed angle, both signs', () => {
    test('handles the negative side that JS % breaks', () => {
        expect(MI._normAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 10);
        expect(MI._normAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 10);
        expect(MI._normAngle(TWO_PI)).toBeCloseTo(0, 10);
        expect(MI._normAngle(-TWO_PI)).toBeCloseTo(0, 10);
        expect(Math.abs(MI._normAngle(Math.PI))).toBeCloseTo(Math.PI, 10);
    });
});

describe('_faceTarget — face the user, and STAY facing the user', () => {
    test('at rest, facing the desktop camera is a no-op (the reported bug)', () => {
        // Desktop camera: (0, 1.4, 2.8) — straight ahead of the resting VRM.
        MI._faceTarget({ x: 0, z: 2.8 }, 1);
        expect(Math.abs(MI._normAngle(root.rotation.y - Math.PI))).toBeLessThan(1e-6);
        // And it must be idempotent: replies arrive forever.
        for (let i = 0; i < 5; i++) MI._faceTarget({ x: 0, z: 2.8 }, 0.6);
        expect(Math.abs(MI._normAngle(root.rotation.y - Math.PI))).toBeLessThan(1e-6);
    });

    test('converges to a side target by the shortest way, monotonically', () => {
        const target = MI._normAngle(Math.atan2(3, 0) + Math.PI); // camera to her left
        let prev = Math.abs(MI._normAngle(target - root.rotation.y));
        for (let i = 0; i < 6; i++) {
            MI._faceTarget({ x: 3, z: 0 }, 0.6);
            const diff = Math.abs(MI._normAngle(target - root.rotation.y));
            expect(diff).toBeLessThanOrEqual(prev + 1e-9); // never overshoots the long way
            prev = diff;
        }
        expect(prev).toBeLessThan(0.05);
    });

    test('a full revolution of drift cannot cause an extra spin', () => {
        // Simulate the old unwrapped turn integrator leaving 2π of drift.
        root.rotation.y = Math.PI + TWO_PI;
        MI._faceTarget({ x: 0, z: 2.8 }, 1);
        // One step, wrapped, facing the camera — not 3π and another lap.
        expect(Math.abs(root.rotation.y)).toBeLessThanOrEqual(Math.PI + 1e-9);
        expect(Math.abs(MI._normAngle(root.rotation.y - Math.PI))).toBeLessThan(1e-6);
    });

    test('non-VRM roots keep their +Z forward convention', () => {
        root = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, userData: {} };
        MI.onAvatarChanged(root, null);
        MI._faceTarget({ x: 0, z: 3 }, 1); // +Z target for a +Z-forward model
        expect(Math.abs(MI._normAngle(root.rotation.y))).toBeLessThan(1e-6);
    });
});
