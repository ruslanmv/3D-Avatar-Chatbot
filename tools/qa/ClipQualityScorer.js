/**
 * AN1. Clip quality checks for the animation review (audits/animations/run.mjs): one clip,
 * stepped through at fixed times on one avatar → the faults an animator looks for.
 *
 * MotionAuditScorer answers "is she standing, upright, legs below her hips, moving?". These are
 * the other questions a mocap or animation review asks of every clip before it ships:
 *
 *   feet-through-floor  a foot well below the floor for a real part of the clip
 *   knee-reversed       a knee bending backwards (the shin folds forward of the thigh's line)
 *   foot-skate          a foot that is planted on the floor slides along it
 *   hand-in-body        a hand or forearm inside her torso
 *   pop                 a bone turns further in one 1/30 s step than any performance does
 *   loop-seam           the last frame of a looping clip does not meet its first (a hitch every
 *                       time it wraps); judged only where the category is meant to loop
 *   travels / turns     the hips leave the spot, or her facing swings, in a clip meant in place
 *
 * Every limit is in her own proportions or in seconds, so a 0.69 m and a 0.98 m avatar are judged
 * alike. Pure: numbers in, verdict out — no DOM, no Three.js. Jest requires it directly; the
 * audit loads it in Node.
 */
(function (global) {
    'use strict';

    const LIMITS = Object.freeze({
        floorPenM: 0.04, // a foot this far below its standing height is in the floor
        floorShare: 0.2, // ...for this share of the clip: fail
        kneeBendDeg: 12, // a knee bent at least this much has a direction to judge
        kneeBackM: 0.025, // knee this far behind the hip–ankle line (in her forward axis): reversed
        kneeShare: 0.2, // ...for this share of the clip: fail
        plantedM: 0.025, // a foot within this of its standing height counts as planted
        skateMps: 0.3, // planted and sliding faster than this
        skateShare: 0.15, // ...for this share of the planted time: warn
        insideShare: 0.1, // a hand or forearm inside her torso for this share: warn
        popDegPerStep: 40, // one bone turning more than this in 1/30 s is a glitch, not a move
        seamDeg: 20, // a looping clip's last and first frame this far apart on a major bone
        travelM: 0.5, // hips leaving the spot by more than this
        turnDeg: 60, // facing swinging by more than this
    });

    /** Where each category is meant to be: drives which checks apply. */
    const CATEGORY = Object.freeze({
        idle: { posture: 'stand', loops: true, inPlace: true },
        dance: { posture: 'stand', loops: true, inPlace: false },
        emotion: { posture: 'stand', loops: false, inPlace: true },
        vrma: { posture: 'stand', loops: false, inPlace: false },
        action: { posture: 'any', loops: false, inPlace: false },
        exercise: { posture: 'any', loops: true, inPlace: false },
        sitting: { posture: 'sit', loops: true, inPlace: true },
        laying: { posture: 'lay', loops: true, inPlace: true },
        kneeling: { posture: 'low', loops: true, inPlace: true },
    });

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const len = (a) => Math.sqrt(dot(a, a));
    const round = (v, n = 3) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(n));

    function angleDeg(a, b) {
        const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        return 2 * Math.acos(Math.min(1, d)) * 57.29578;
    }

    /** Knee bend (degrees) and how far the knee sits behind the hip–ankle line along `fwd`. */
    function knee(hip, kneeP, ankle, fwd) {
        const thigh = sub(kneeP, hip);
        const shin = sub(ankle, kneeP);
        const c = dot(thigh, shin) / (len(thigh) * len(shin) || 1);
        const bend = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
        const mid = [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2, (hip[2] + ankle[2]) / 2];
        return { bend, ahead: dot(sub(kneeP, mid), fwd) };
    }

    /**
     * @param {object} input
     * @param {string} input.category - manifest category ('idle', 'dance', 'vrma', …)
     * @param {'stand'|'sit'|'lay'|'low'|'bend'} [input.posture] - a reviewed clip's own posture
     * @param {number} [input.ground] - the floor's height; with samples' `soles`, judges the floor by it
     * @param {number} input.dt - seconds between samples
     * @param {{footY:[number,number]}} input.stand - standing foot heights (her floor contact)
     * @param {Array<object>} input.samples - one per step: { hips, feet:[l,r], legs:{left:{hip,knee,ankle},right:…},
     *   fwd:[x,0,z], yawDeg, inside:number (hand/forearm depth inside the torso, 0 = outside), quats:{bone:[x,y,z,w]} }
     * @returns {{flags:string[], fails:string[], warns:string[], metrics:object}}
     */
    function score(input) {
        const base = CATEGORY[input.category] || CATEGORY.action;
        // A reviewed clip may name its own posture (audits/animations/clip-intent.json).
        const cat = input.posture ? Object.assign({}, base, { posture: input.posture }) : base;
        const s = input.samples || [];
        const dt = input.dt || 1 / 30;
        const footY = (input.stand && input.stand.footY) || [0, 0];
        const fails = [];
        const warns = [];
        const m = {};
        if (s.length < 2) return { flags: ['too-few-samples'], fails: ['too-few-samples'], warns, metrics: m };

        // Floor: the lowest point of a foot (ankle or toes) below the ground, when the samples
        // carry it; else the ankle against its standing height. A foot lying flat — kneeling,
        // sitting — brings the ankle lower than standing without entering the floor.
        const ground = typeof input.ground === 'number' ? input.ground : null;
        let below = 0;
        let deepest = 0;
        for (const x of s) {
            const d =
                ground !== null && Array.isArray(x.soles)
                    ? Math.min(x.soles[0], x.soles[1]) - ground
                    : Math.min(x.feet[0][1] - footY[0], x.feet[1][1] - footY[1]);
            deepest = Math.min(deepest, d);
            if (d < -LIMITS.floorPenM) below++;
        }
        m.floorPenCm = round(-deepest * 100, 1);
        m.floorShare = round(below / s.length, 2);
        if (below / s.length >= LIMITS.floorShare) fails.push('feet-through-floor');

        // Knees: bending backwards. Not judged lying down, where "forward" is not her front.
        if (cat.posture !== 'lay') {
            let rev = 0;
            let worst = 0;
            for (const x of s) {
                let bad = false;
                for (const side of ['left', 'right']) {
                    const L = x.legs && x.legs[side];
                    if (!L) continue;
                    const k = knee(L.hip, L.knee, L.ankle, x.fwd);
                    if (k.bend >= LIMITS.kneeBendDeg && k.ahead < -LIMITS.kneeBackM) {
                        bad = true;
                        worst = Math.max(worst, -k.ahead);
                    }
                }
                if (bad) rev++;
            }
            m.kneeReversedShare = round(rev / s.length, 2);
            m.kneeBehindCm = round(worst * 100, 1);
            if (rev / s.length >= LIMITS.kneeShare) fails.push('knee-reversed');
        }

        // Foot skate: planted feet that slide.
        let planted = 0;
        let sliding = 0;
        let fastest = 0;
        for (let i = 1; i < s.length; i++) {
            for (const f of [0, 1]) {
                const a = s[i - 1].feet[f];
                const b = s[i].feet[f];
                const onFloor =
                    Math.abs(a[1] - footY[f]) < LIMITS.plantedM && Math.abs(b[1] - footY[f]) < LIMITS.plantedM;
                if (!onFloor) continue;
                planted++;
                const v = Math.hypot(b[0] - a[0], b[2] - a[2]) / dt;
                fastest = Math.max(fastest, v);
                if (v > LIMITS.skateMps) sliding++;
            }
        }
        m.skateShare = planted ? round(sliding / planted, 2) : 0;
        m.skateMaxMps = round(fastest, 2);
        if (planted && sliding / planted >= LIMITS.skateShare) warns.push('foot-skate');

        // Hands inside her torso.
        const inside = s.filter((x) => (x.inside || 0) > 0).length;
        m.insideShare = round(inside / s.length, 2);
        if (inside / s.length >= LIMITS.insideShare) warns.push('hand-in-body');

        // Pops: the largest single-step turn of any bone.
        let pop = 0;
        let popBone = null;
        for (let i = 1; i < s.length; i++) {
            const qa = s[i - 1].quats || {};
            const qb = s[i].quats || {};
            for (const k of Object.keys(qb)) {
                if (!qa[k]) continue;
                const d = angleDeg(qa[k], qb[k]) * (1 / 30 / dt);
                if (d > pop) [pop, popBone] = [d, k];
            }
        }
        m.maxStepDeg = round(pop, 1);
        m.maxStepBone = popBone;
        if (pop > LIMITS.popDegPerStep) warns.push('pop');

        // Loop seam: the last frame against the first.
        if (cat.loops) {
            const a = s[0].quats || {};
            const b = s[s.length - 1].quats || {};
            let seam = 0;
            for (const k of Object.keys(a)) if (b[k]) seam = Math.max(seam, angleDeg(a[k], b[k]));
            const hipsGap = len(sub(s[s.length - 1].hips, s[0].hips));
            m.seamDeg = round(seam, 1);
            m.seamHipsCm = round(hipsGap * 100, 1);
            if (seam > LIMITS.seamDeg || hipsGap > 0.1) warns.push('loop-seam');
        }

        // Travel and turning, for clips meant in place.
        let travel = 0;
        let turn = 0;
        for (const x of s) {
            travel = Math.max(travel, Math.hypot(x.hips[0] - s[0].hips[0], x.hips[2] - s[0].hips[2]));
            let dy = Math.abs(x.yawDeg - s[0].yawDeg) % 360;
            if (dy > 180) dy = 360 - dy;
            turn = Math.max(turn, dy);
        }
        m.travelM = round(travel, 2);
        m.turnDeg = round(turn, 0);
        if (cat.inPlace && travel > LIMITS.travelM) warns.push('travels');
        if (cat.inPlace && turn > LIMITS.turnDeg) warns.push('turns');

        return { flags: [...fails, ...warns], fails, warns, metrics: m };
    }

    const api = { score, knee, LIMITS, CATEGORY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CLIP_QUALITY_SCORER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
