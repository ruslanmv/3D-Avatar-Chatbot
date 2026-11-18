/**
 * PoseTransition — UN23. How a change of pose travels through her body.
 *
 * What it replaces. VRPoseSystem blended every preset change the same way: every bone, hips to
 * fingertips, slerped from where it was to where it was going over one fixed duration (0.5 s from
 * Pose Studio, 0.6 s from Private) on a single smoothstep curve. Two things read as a puppet:
 *
 *   1. Distance did not count. A head tilt and "standing → lying open on the floor" both took
 *      half a second, so the big changes — exactly the ones in the adult presets, where she goes
 *      from standing to the floor, from kneeling to her back — whipped the whole body through
 *      90°+ in a blink, and the hips dropped as fast as a hand turning.
 *   2. Everything started and stopped together. A person moving into a pose leads with the
 *      pelvis and trunk; the limbs follow and the hands and feet arrive last (overlapping
 *      action). All bones on one curve is the rigid, "rotated as one object" look.
 *
 * What this does instead, as pure numbers so it is testable without WebGL:
 *
 *   durationFor(base, maxAngle, hipsTravel)
 *            The caller's duration stays the floor — a small change keeps it exactly — and is
 *            stretched for a large one: past 60° of the biggest single-bone rotation, up to 1.9×
 *            at 180°, plus up to 0.35× more for hips travelling half a metre (sitting to the
 *            floor). Capped at 1.6 s so a pose never feels like it is not answering. 0 stays 0:
 *            instant means instant (ViewerEngine restores and PoseEditor's reset rely on it).
 *   delayFor(boneKey)
 *            Where in the blend a bone starts: trunk at 0, neck/head/shoulders and thighs a
 *            little later, elbows and knees later, hands, feet and fingers last. Every bone still
 *            ends at t = 1, so the blend is exactly as long as it says.
 *   weight(t, delay)
 *            Smootherstep (6t⁵ − 15t⁴ + 10t³) over the bone's own window: zero velocity AND zero
 *            acceleration at both ends, so there is no jolt when a bone starts or lands — the old
 *            smoothstep had a step in acceleration at both ends.
 *
 * Fail soft: unknown bone names get the limb delay, a missing or NaN input gives the caller's own
 * duration back. VRPoseSystem falls back to its old single-curve blend if this global is absent.
 */
(function (global) {
    'use strict';

    const DEG = Math.PI / 180;

    // How far into the blend each bone starts, as a fraction of the whole blend.
    const CORE = ['hips', 'spine', 'chest', 'upperChest'];
    const NEAR = ['neck', 'leftShoulder', 'rightShoulder', 'leftUpperLeg', 'rightUpperLeg'];
    const MID = ['head', 'leftUpperArm', 'rightUpperArm', 'leftLowerLeg', 'rightLowerLeg'];
    const LIMB = ['leftLowerArm', 'rightLowerArm', 'leftFoot', 'rightFoot'];
    // Hands, toes, fingers and anything unlisted (eyes, jaw) arrive last.
    const DELAYS = { core: 0, near: 0.06, mid: 0.12, limb: 0.18, tip: 0.24 };

    const BIG_FROM = 60 * DEG; // below this the caller's duration is kept exactly
    const BIG_SPAN = 120 * DEG; // 60° → 180° maps onto the full stretch
    const ANGLE_STRETCH = 0.9; // up to 1.9× the base duration
    const HIPS_FULL = 0.5; // metres of hips travel for the full extra
    const HIPS_STRETCH = 0.35;
    const MAX_SECONDS = 1.6;

    function clamp01(x) {
        return x < 0 ? 0 : x > 1 ? 1 : x;
    }

    function delayFor(boneKey) {
        if (CORE.indexOf(boneKey) >= 0) return DELAYS.core;
        if (NEAR.indexOf(boneKey) >= 0) return DELAYS.near;
        if (MID.indexOf(boneKey) >= 0) return DELAYS.mid;
        if (LIMB.indexOf(boneKey) >= 0) return DELAYS.limb;
        return DELAYS.tip;
    }

    /** Smootherstep: 0 → 1 with zero velocity and acceleration at both ends. */
    function smootherstep(x) {
        const t = clamp01(x);
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /** A bone's blend weight at overall progress t (0..1), starting at its delay. */
    function weight(t, delay) {
        const d = Number.isFinite(delay) ? Math.min(Math.max(delay, 0), 0.9) : 0;
        if (!Number.isFinite(t)) return 1;
        return smootherstep((t - d) / (1 - d));
    }

    /** Angle in radians between two unit quaternions given as {x, y, z, w}. */
    function angleBetween(a, b) {
        if (!a || !b) return 0;
        const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
        return 2 * Math.acos(Math.min(1, dot));
    }

    /** The largest single-bone rotation between two maps of boneKey → quaternion. */
    function maxAngle(fromMap, toMap) {
        let max = 0;
        if (!fromMap || !toMap || typeof fromMap.forEach !== 'function') return 0;
        fromMap.forEach(function (from, key) {
            const to = toMap.get(key);
            const a = angleBetween(from, to);
            if (a > max) max = a;
        });
        return max;
    }

    /** The blend's length in seconds: the caller's base, stretched for a large change. */
    function durationFor(base, angle, hipsTravel) {
        if (!Number.isFinite(base) || base <= 0) return base > 0 ? base : 0;
        const a = Number.isFinite(angle) ? angle : 0;
        const h = Number.isFinite(hipsTravel) ? Math.abs(hipsTravel) : 0;
        const scale = 1 + clamp01((a - BIG_FROM) / BIG_SPAN) * ANGLE_STRETCH + clamp01(h / HIPS_FULL) * HIPS_STRETCH;
        return Math.max(base, Math.min(base * scale, MAX_SECONDS));
    }

    const api = {
        delayFor: delayFor,
        weight: weight,
        smootherstep: smootherstep,
        angleBetween: angleBetween,
        maxAngle: maxAngle,
        durationFor: durationFor,
        MAX_SECONDS: MAX_SECONDS,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_TRANSITION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
