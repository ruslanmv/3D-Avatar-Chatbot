/**
 * MO11. Verdicts for the motion audit (audits/motion/run.mjs): one gesture, pose or chat
 * phrase played on one avatar → ok / warn / fail, with the reasons.
 *
 * Why a second scorer beside AnimationPlaybackScorer: that one judges a clip by hips height and
 * bone motion, and on 2026-11-14 hips height passed two real failures. VRoid's Spin / Model
 * pose / Squat played lying sideways in mid-air with the hips still at standing height, and the
 * Mixamo pack rendered her legs above her head, again at standing hips. So this one also asks
 * the two questions a person asks first:
 *
 *   upright — is her head still above her hips?   (head − hips vs. the standing value)
 *   legs    — are her feet still below her hips?  (both feet well above the hips = flipped)
 *
 * Pure: numbers in, verdict out. No DOM, no Three.js — Jest requires it directly; the browser
 * stage of the pipeline loads it the same way.
 */
(function (global) {
    'use strict';

    // Thresholds, as fractions of the avatar's own standing measurements, so a 0.69 m and a
    // 0.98 m avatar are judged alike.
    const LIMITS = Object.freeze({
        floatRatio: 1.25, // hips above 1.25× standing: off the floor
        sinkRatio: 0.6, // hips below 0.6× standing on a standing gesture: in the floor
        uprightRatio: 0.35, // head-above-hips below 35% of standing: tipped over
        feetAboveHipsM: 0.15, // both feet this far above the hips: legs flipped
        minMotionDeg: 2, // less than this: did not visibly move
    });

    /**
     * @param {object} input
     * @param {'gesture'|'pose'|'phrase'} input.kind
     * @param {boolean} input.played - the app reported it started (or a procedural ran)
     * @param {{hipsY:number, headAboveHips:number}} input.stand - measured before playing
     * @param {Array<{hipsY:number, headY:number, footY:[number,number]}>} input.samples
     * @param {number} input.motionDeg - largest bone rotation change seen, degrees
     * @param {'stand'|'sit'|'lay'|'low'|'bend'|null} [input.posture] - what the action is meant to
     *   do: `low` (kneeling, a dip) and `bend` (bending forward/back) may drop the hips; `bend` may
     *   also bring the head down near hip height, so it is not judged on uprightness
     * @param {boolean} [input.ambient] - idle / talking: little motion is fine
     * @param {string} [input.expectLabel] - phrases: the fast-path label expected
     * @param {string|null} [input.gotLabel] - phrases: the label actually matched
     * @returns {{verdict:'ok'|'warn'|'fail', flags:string[], metrics:object}}
     */
    function score(input) {
        const flags = [];
        const s = (input && input.samples) || [];
        const stand = (input && input.stand) || {};
        const posture = (input && input.posture) || 'stand';
        const metrics = { hipsMin: null, hipsMax: null, uprightMin: null, feetAboveHipsMax: null };

        if (!input || !input.played) flags.push('not-played');
        if (input && input.expectLabel !== undefined && input.gotLabel !== input.expectLabel) {
            flags.push('phrase-not-understood');
        }

        if (s.length && stand.hipsY > 0) {
            const hips = s.map((x) => x.hipsY);
            metrics.hipsMin = round(Math.min(...hips));
            metrics.hipsMax = round(Math.max(...hips));
            if (metrics.hipsMax > stand.hipsY * LIMITS.floatRatio) flags.push('floating');
            if (posture === 'stand' && metrics.hipsMin < stand.hipsY * LIMITS.sinkRatio) flags.push('sinking');
            if (posture === 'sit' && metrics.hipsMin > stand.hipsY * 0.9) flags.push('sit-not-lowered');
            if (posture === 'lay' && metrics.hipsMin > stand.hipsY * 0.55) flags.push('lay-not-lowered');

            if (stand.headAboveHips > 0) {
                const upright = s.map((x) => (x.headY - x.hipsY) / stand.headAboveHips);
                metrics.uprightMin = round(Math.min(...upright));
                if (posture !== 'lay' && posture !== 'bend' && metrics.uprightMin < LIMITS.uprightRatio) {
                    flags.push('tipped-over');
                }
            }
            const feetUp = s
                .filter((x) => Array.isArray(x.footY) && x.footY.length === 2)
                .map((x) => Math.min(x.footY[0], x.footY[1]) - x.hipsY);
            if (feetUp.length) {
                metrics.feetAboveHipsMax = round(Math.max(...feetUp));
                if (posture !== 'lay' && metrics.feetAboveHipsMax > LIMITS.feetAboveHipsM) flags.push('legs-flipped');
            }
        }

        const motion = input && Number.isFinite(input.motionDeg) ? input.motionDeg : null;
        metrics.motionDeg = motion === null ? null : round(motion, 1);
        if (input && input.played && !input.ambient && motion !== null && motion < LIMITS.minMotionDeg) {
            flags.push('no-visible-motion');
        }

        const FAIL = ['not-played', 'phrase-not-understood', 'floating', 'sinking', 'tipped-over', 'legs-flipped'];
        const verdict = flags.some((f) => FAIL.includes(f)) ? 'fail' : flags.length ? 'warn' : 'ok';
        return { verdict, flags, metrics };
    }

    function round(v, d = 3) {
        const k = Math.pow(10, d);
        return Math.round(v * k) / k;
    }

    /** Totals for a list of scored rows. */
    function summarize(rows) {
        const out = { total: 0, ok: 0, warn: 0, fail: 0 };
        for (const r of rows || []) {
            out.total++;
            out[r.verdict] = (out[r.verdict] || 0) + 1;
        }
        return out;
    }

    const api = { LIMITS, score, summarize };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_MOTION_AUDIT_SCORER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
