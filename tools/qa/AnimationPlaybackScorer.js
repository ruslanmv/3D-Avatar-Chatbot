/**
 * AX16. Pure verdicts for one avatar × one clip/pose sample.
 *
 * The playback harness (tools/qa/animation-audit.mjs --play) measures bone
 * positions and a frame check in the browser; this module turns those numbers
 * into a stable ok / warn / fail so CSVs and the lab page stay comparable run
 * to run. No DOM, no Three.js — Jest requires it directly.
 *
 * What "broken" means here (and what it does not):
 *   - fail: the clip did not load, bones went NaN, the frame is near-black, or
 *     a known ruin (legs inverted / T-pose on a clip that should move).
 *   - warn: weak motion, hips in the wrong place for a posture, or a clip the
 *     inventory already marks experimental (Mixamo-origin VRMA).
 *   - ok: load succeeded and samples look like a living pose.
 *
 * Headless SwiftShader evidence of framing and retarget, never of frame rate.
 *
 * Dual export (IIFE): browser global + Jest/CommonJS, same shape as
 * CharacterQualityScorer — package.json is "type":"module".
 */
(function (global) {
    'use strict';

    /** Bones sampled each frame. Names match three-vrm normalized humanoid. */
    const SAMPLE_BONES = Object.freeze([
        'hips',
        'spine',
        'chest',
        'head',
        'leftUpperArm',
        'rightUpperArm',
        'leftUpperLeg',
        'rightUpperLeg',
        'leftLowerLeg',
        'rightLowerLeg',
    ]);

    function dist(a, b) {
        if (!a || !b) return 0;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function quatDelta(a, b) {
        if (a == null || b == null || a.qx == null || b.qx == null) return 0;
        // 1 - |dot| is 0 when equal, grows as orientations diverge.
        const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
        return 1 - Math.min(1, dot);
    }

    function maxMotion(rest, samples) {
        if (!rest || !Array.isArray(samples) || !samples.length) return 0;
        let max = 0;
        for (const s of samples) {
            for (const bone of SAMPLE_BONES) {
                if (!rest[bone] || !s[bone]) continue;
                const d = dist(rest[bone], s[bone]);
                const q = quatDelta(rest[bone], s[bone]);
                // Quaternion delta is unitless; scale so ~0.05 matches a clear pose change.
                const combined = Math.max(d, q * 0.5);
                if (combined > max) max = combined;
            }
        }
        return max;
    }

    function hasNaN(map) {
        if (!map) return false;
        for (const bone of Object.keys(map)) {
            const v = map[bone];
            if (!v) continue;
            if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return true;
        }
        return false;
    }

    /**
     * Legs look inverted when both thighs point the wrong way along Y
     * (Mixamo-origin VRMA on VRM 0.x — see addons/vrma-dance/README).
     *
     * Upper-leg *joints* stay near the pelvis even when the bone is flipped
     * ~180°; the tell is the hip→knee (upperLeg→lowerLeg) direction, which
     * goes from "knee below thigh" at rest to "knee above thigh" when inverted.
     */
    function legsInverted(rest, sample) {
        if (!rest || !sample) return false;
        const thighFlipped = (side) => {
            const ru = rest[side + 'UpperLeg'];
            const rl = rest[side + 'LowerLeg'];
            const su = sample[side + 'UpperLeg'];
            const sl = sample[side + 'LowerLeg'];
            if (!ru || !rl || !su || !sl) return false;
            const restDy = rl.y - ru.y;
            const dy = sl.y - su.y;
            // Rest thigh points down; inverted retarget points it up.
            if (restDy < -0.04 && dy > 0.04) return true;
            // Same defect as a large upper-leg quaternion flip (~180°).
            const q = quatDelta(ru, su);
            return q > 0.85 && dy > 0;
        };
        return thighFlipped('left') && thighFlipped('right');
    }

    /** Arms stuck in a classic T-pose: nearly horizontal, little change from rest T. */
    function looksLikeTPose(rest, sample) {
        if (!rest || !sample) return false;
        const armSpan = (m) => {
            const l = m.leftUpperArm;
            const r = m.rightUpperArm;
            if (!l || !r) return 0;
            return Math.abs(l.x - r.x);
        };
        const span = armSpan(sample);
        const restSpan = armSpan(rest);
        // Wide arm span that barely changed → still T-posed.
        return span > 0.55 && Math.abs(span - restSpan) < 0.08;
    }

    /**
     * Score one playback sample.
     * @returns {{ verdict:'ok'|'warn'|'fail', flags:string[], motion:number, hipsY:number|null }}
     */
    function score(input) {
        const flags = [];
        const played = !!(input && input.played);
        const rest = input && input.rest;
        const samples = (input && input.samples) || [];
        const last = samples.length ? samples[samples.length - 1] : null;
        const motion = Math.round(maxMotion(rest, samples) * 1000) / 1000;
        const hipsY = last && last.hips ? Math.round(last.hips.y * 1000) / 1000 : null;
        const expectedMotion = input && input.expectedMotion !== false;

        if (input && input.loadError) flags.push('load-error');
        if (!played) flags.push('play-failed');
        if (hasNaN(rest) || samples.some(hasNaN)) flags.push('nan-bones');
        // Animation audits run on the app's black void: the world-preview luma
        // gate would false-warn every healthy clip. Opt in with blackBackground.
        if (input && input.frame && input.frame.verdict === 'near-black frame' && !(input && input.blackBackground))
            flags.push('near-black');
        if (legsInverted(rest, last)) flags.push('legs-inverted');
        if (expectedMotion && looksLikeTPose(rest, last) && motion < 0.05) flags.push('t-pose');
        if (expectedMotion && motion < 0.012 && played) flags.push('no-motion');
        if (input && input.experimental) flags.push('experimental');

        const kind = (input && input.kind) || '';
        const category = String((input && input.category) || '').toLowerCase();
        if (rest && last && rest.hips && last.hips) {
            const drop = rest.hips.y - last.hips.y;
            // Standing height: the harness's fresh-avatar measurement when given, else this rest.
            const standY = input && Number.isFinite(input.standingHipsY) ? input.standingHipsY : rest.hips.y;
            // Pose Navigator sitting often rotates the legs without a large world-Y
            // hip drop (root stays planted). Only clip playback is judged on height.
            if (kind !== 'pose' && (category === 'sitting' || category === 'sit') && drop < 0.05 && motion > 0)
                flags.push('sit-not-lowered');
            if (kind !== 'pose' && (category === 'laying' || category === 'lay' || category === 'lying')) {
                if (last.hips.y > rest.hips.y * 0.55) flags.push('lay-not-lowered');
            }
            if (!/lay|lying|sit|kneel|ground/.test(category) && last.hips.y < standY * 0.25)
                flags.push('hips-underground');
            // The opposite failure: Mixamo-origin VRMA (waving, backflip, the hip-hop/samba dances)
            // carry an absolute root track that lifts her 2.3–3.5 m — out of frame, gone. Nothing
            // flagged it, so backflip.vrma scored "ok" at 3.4 m. 1.6× the standing hips is above any
            // jump the shipped clips make and far below the floats measured.
            if (last.hips.y > standY * 1.6) flags.push('hips-floating');
        }

        let verdict = 'ok';
        // near-black is warn, not fail: animation audits run on the app's black void,
        // so the world-preview luma gate would false-fail every healthy clip.
        const failFlags = ['load-error', 'play-failed', 'nan-bones', 'legs-inverted', 't-pose', 'hips-floating'];
        const warnFlags = [
            'near-black',
            'no-motion',
            'experimental',
            'sit-not-lowered',
            'lay-not-lowered',
            'hips-underground',
        ];
        if (flags.some((f) => failFlags.includes(f))) verdict = 'fail';
        else if (flags.some((f) => warnFlags.includes(f))) verdict = 'warn';

        return { verdict, flags, motion, hipsY };
    }

    /** CSV header shared by every per-avatar report. */
    const CSV_HEADER = [
        'avatar',
        'avatarFile',
        'kind',
        'category',
        'id',
        'path',
        'played',
        'verdict',
        'flags',
        'motion',
        'hipsY',
        'frameMean',
        'frameSd',
        'frameVerdict',
        'shot',
        'error',
    ].join(',');

    function csvEscape(v) {
        const s = v == null ? '' : String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    function toCsvRow(row) {
        return [
            row.avatar,
            row.avatarFile,
            row.kind,
            row.category,
            row.id,
            row.path,
            row.played ? '1' : '0',
            row.verdict,
            (row.flags || []).join('|'),
            row.motion,
            row.hipsY,
            row.frameMean,
            row.frameSd,
            row.frameVerdict,
            row.shot || '',
            row.error || '',
        ]
            .map(csvEscape)
            .join(',');
    }

    function rowsToCsv(rows) {
        return [CSV_HEADER, ...rows.map(toCsvRow)].join('\n') + '\n';
    }

    const api = {
        SAMPLE_BONES,
        CSV_HEADER,
        score,
        maxMotion,
        legsInverted,
        looksLikeTPose,
        toCsvRow,
        rowsToCsv,
        csvEscape,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_ANIMATION_PLAYBACK_SCORER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
