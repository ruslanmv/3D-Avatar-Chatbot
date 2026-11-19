/**
 * ID1. Her standing idle with relaxed arms, solved for her own body.
 *
 * Every preset before this lowered the arms by one fixed angle from the T-pose (40° "relaxed",
 * 55° "natural idle"), and one angle cannot suit every body: on the avatars measured on 2026-11-19
 * (tools/qa/idle-pose-check.mjs) the arms hung about 25° out from her sides with the hands some
 * 21 cm outside the thigh line — the stiff A-pose the owner reported. A procedural lowering also
 * knows nothing of her hips or her dress (Animaze and VMagicMirror say as much of their own).
 *
 * So the angle is solved from her skeleton: where her shoulder is, how long her arm is, where her
 * thigh is, and the hand placed a small gap outside the thigh (room for a dress). The rest follows
 * the brief and common practice against a "stiff" idle:
 *
 *   - a slight bend at both elbows, one more than the other, so the pose is not symmetrical;
 *   - forearms turned a little so the palms face slightly inward, toward the thighs;
 *   - wrists relaxed, nearly in line with the forearms;
 *   - fingers gently curled, more toward the little finger (a natural cascade), thumbs relaxed.
 *
 * Pure: numbers in, rotations out ([axis x, y, z, degrees] per VRM normalized bone, relative to
 * the T-pose, the convention NaturalPosePlugin uses — +Z lowers the left arm). The plugin measures
 * her and applies them; tests check the geometry here.
 */
(function (global) {
    'use strict';

    /** The hand's outer edge sits this far outside the thigh's centre line, per metre of height. */
    const THIGH_HALF = 0.05;
    const GAP = 0.045;
    /** Elbows: left a little, right a little more. */
    const ELBOW = Object.freeze({ left: 10, right: 17 });
    /** Forearm turn so the palms face slightly inward. */
    const PALM_IN = 12;
    /** Fingers, proximal / intermediate / distal, degrees of curl: a cascade toward the little finger. */
    const CURL = Object.freeze({
        Index: [8, 14, 9],
        Middle: [11, 18, 11],
        Ring: [14, 21, 13],
        Little: [17, 24, 15],
    });
    const THUMB = Object.freeze([30, 14, 8]);
    /** Arm angle limits below horizontal: never into the hip, never back toward a T. */
    const MIN_DOWN = 62;
    const MAX_DOWN = 84;

    /**
     * Degrees to lower an arm from horizontal so the hand lands at `target` metres from the body's
     * centre line: shoulder at `shoulderX`, arm (shoulder to wrist) `length` long. Clamped.
     */
    function armDown({ shoulderX, length, target }) {
        const reach = (Number(target) - Math.abs(Number(shoulderX))) / Number(length);
        if (!Number.isFinite(reach) || Number(length) <= 0) return 72;
        const down = (Math.acos(Math.max(-1, Math.min(1, reach))) * 180) / Math.PI;
        return Math.max(MIN_DOWN, Math.min(MAX_DOWN, Math.round(down)));
    }

    /**
     * Her measured body → the idle's rotations. `body` holds, from her T-pose: `height` (head to
     * feet), and per side `shoulderX`, `armLength`, `thighX` (all distances from the centre line).
     */
    function solve(body) {
        const height = Number(body && body.height) > 0 ? Number(body.height) : 1.55;
        const bones = {};
        const sides = { left: 1, right: -1 };
        const angles = {};
        for (const [side, sign] of Object.entries(sides)) {
            const b = (body && body[side]) || {};
            const target = Math.abs(Number(b.thighX) || 0.09) + (THIGH_HALF + GAP) * height;
            const down = armDown({ shoulderX: b.shoulderX || 0.18, length: b.armLength || 0.5, target });
            angles[side] = down;
            const Side = side;
            bones[`${Side}Shoulder`] = [0, 0, sign, 4];
            bones[`${Side}UpperArm`] = [0, 0, sign, down];
            // Elbow bend forward (the plugin's convention: -Y for the left, +Y for the right), then the
            // palm turned in about the forearm's own axis, composed by the plugin in this order.
            bones[`${Side}LowerArm`] = [0, -sign, 0, ELBOW[side]];
            bones[`${Side}LowerArmTwist`] = [sign, 0, 0, PALM_IN];
            bones[`${Side}Hand`] = [0, 0, sign, 3];
            for (const [finger, curl] of Object.entries(CURL)) {
                ['Proximal', 'Intermediate', 'Distal'].forEach((joint, i) => {
                    // Toward the palm: the same sign as lowering the arm (seen bending backward when
                    // the other way, on AvatarSample_A, 2026-11-19).
                    bones[`${side}${finger}${joint}`] = [0, 0, sign, curl[i]];
                });
            }
            ['Proximal', 'Intermediate', 'Distal'].forEach((joint, i) => {
                // In toward the index finger, not out from the hand.
                bones[`${side}Thumb${joint}`] = [0, sign, 0.5 * sign, THUMB[i]];
            });
        }
        return { bones, angles };
    }

    const api = { solve, armDown, ELBOW, CURL, THUMB, PALM_IN, MIN_DOWN, MAX_DOWN };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_RELAXED_IDLE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
