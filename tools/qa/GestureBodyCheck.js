/**
 * SG5. Where a gesturing hand is, relative to her own body — for the gesture audit and tuner.
 *
 * A gesture can move a hand thirty centimetres and still be wrong: the first audit passed a
 * "hand to chin" that stopped in front of her stomach, and on a phone a "hello" brought her hand
 * across her front and into her cardigan. Both are questions about where the hand is *on her*,
 * so this answers them in her own frame, built from her bones, so it holds for any avatar size:
 *
 *   x  lateral, positive towards the gesturing side (her right for a right-hand gesture)
 *   y  up, from her hips
 *   z  forward, the way she faces
 *
 * Her torso is an elliptical cylinder around her spine, from just below her hips to her neck,
 * sized from her shoulder span (VRoid and VRM characters are close to these proportions; the
 * margin errs towards "inside", so a pass means the hand is clearly clear of her). A hand or the
 * middle of a forearm inside it is a hand through her body. Crossing her midline to the other
 * side is a hand across her front, which no gesture here means to do.
 *
 * Pure: points in, numbers out. Plain {x, y, z} objects, no THREE, so Jest checks the geometry
 * with made-up skeletons. Exposes: window.NEXUS_GESTURE_BODY_CHECK
 */
(function (global) {
    'use strict';

    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const len = (a) => Math.sqrt(dot(a, a));
    const norm = (a) => {
        const l = len(a) || 1;
        return { x: a.x / l, y: a.y / l, z: a.z / l };
    };
    const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

    /**
     * Her frame, from world positions of: hips, leftUpperLeg, rightUpperLeg, leftUpperArm,
     * rightUpperArm, chest, neck, head.
     */
    function frame(p) {
        const up = { x: 0, y: 1, z: 0 };
        const r = sub(p.rightUpperLeg, p.leftUpperLeg);
        const right = norm({ x: r.x, y: 0, z: r.z });
        const fwd = norm(cross(up, right));
        const origin = p.hips;
        const toLocal = (q) => {
            const d = sub(q, origin);
            return { x: dot(d, right), y: d.y, z: dot(d, fwd) };
        };
        const shoulderR = toLocal(p.rightUpperArm);
        const shoulderL = toLocal(p.leftUpperArm);
        const span = Math.abs(shoulderR.x - shoulderL.x) || 0.3;
        const chest = toLocal(p.chest);
        const neck = toLocal(p.neck);
        const head = toLocal(p.head);
        return {
            toLocal,
            span,
            shoulder: { right: shoulderR, left: shoulderL },
            chest,
            neck,
            head,
            torso: { rx: 0.42 * span, rz: 0.3 * span, z: chest.z, bottom: -0.06, top: neck.y },
        };
    }

    /** A local point seen from the gesturing side: x flipped for the left hand. */
    function sided(q, side) {
        return side === 'left' ? { x: -q.x, y: q.y, z: q.z } : q;
    }

    /** How far inside her torso (0 = outside; 1 = on her spine). */
    function insideTorso(f, q) {
        const t = f.torso;
        if (q.y < t.bottom || q.y > t.top) return 0;
        const e = (q.x / t.rx) ** 2 + ((q.z - t.z) / t.rz) ** 2;
        return e < 1 ? 1 - e : 0;
    }

    /** Where each gesture's hand should be, in her frame seen from the gesturing side. */
    function target(f, id) {
        const sh = f.shoulder.right; // the gesturing side's shoulder, after `sided`
        const reach = sh.y; // shoulder height above the hips: her scale
        const at = (x, y, z) => ({ x, y, z });
        switch (id) {
            case 'wave':
                return { point: at(sh.x + 0.1, sh.y + 0.14, 0.12), tol: 0.1, above: sh.y + 0.05 };
            case 'handOnChest':
                return { point: at(0.05, f.chest.y + 0.04, f.torso.z + f.torso.rz + 0.03), tol: 0.07 };
            case 'chinTouch':
                return { point: at(0.03, f.head.y - 0.09, f.head.z + 0.11), tol: 0.07 };
            case 'hairTuck':
                return { point: at(0.1, f.head.y + 0.02, f.head.z + 0.02), tol: 0.07 };
            case 'palmToYou':
                return { point: at(sh.x * 0.8, reach * 0.62, 0.36), tol: 0.08 };
            case 'shrug':
                return { point: at(sh.x + 0.1, reach * 0.36, 0.2), tol: 0.08 };
            case 'palmsUp':
                return { point: at(sh.x + 0.04, reach * 0.42, 0.26), tol: 0.08 };
            case 'openArms':
                return { point: at(sh.x + 0.3, reach * 0.72, 0.2), tol: 0.1 };
            case 'negate':
                return { point: at(sh.x * 0.7, reach * 0.5, 0.3), tol: 0.08 };
            case 'beat':
                return { point: at(sh.x * 0.8, reach * 0.38, 0.22), tol: 0.08 };
            default:
                return null;
        }
    }

    /**
     * Everything about one gesturing arm, from world positions of its elbow (lowerArm) and hand.
     * `crossCm` is how far past her midline the hand went (0 when it stayed on its own side);
     * gestures that belong at her centre (chest, chin) may come to the midline, not past it.
     */
    function measure(f, side, world, id) {
        const hand = sided(f.toLocal(world.hand), side);
        const elbow = sided(f.toLocal(world.elbow), side);
        const mid = { x: (hand.x + elbow.x) / 2, y: (hand.y + elbow.y) / 2, z: (hand.z + elbow.z) / 2 };
        const goal = target(f, id);
        const centre = id === 'handOnChest' || id === 'chinTouch';
        const allowed = centre ? -0.02 : 0.03; // centre gestures may reach the midline, others keep 3 cm off it
        return {
            hand,
            handInside: insideTorso(f, hand),
            forearmInside: insideTorso(f, mid),
            crossCm: Math.max(0, (allowed - hand.x) * 100),
            aboveShoulderCm: (hand.y - f.shoulder.right.y) * 100,
            toTargetCm: goal ? len(sub(hand, goal.point)) * 100 : null,
            targetTolCm: goal ? goal.tol * 100 : null,
        };
    }

    /** One number for the tuner: reach the target, never enter her, never cross her, little effort. */
    function cost(m, effort) {
        let c = 0;
        if (m.toTargetCm != null) c += Math.max(0, m.toTargetCm - m.targetTolCm * 0.5) ** 2 / 25;
        c += (m.handInside + m.forearmInside) * 400;
        c += m.crossCm * m.crossCm * 4;
        c += (effort || 0) * 0.6;
        return c;
    }

    /** Pass/fail the way the audit reports it. */
    function verdict(m) {
        const flags = [];
        if (m.handInside > 0) flags.push('hand-inside-body');
        if (m.forearmInside > 0) flags.push('forearm-inside-body');
        if (m.crossCm > 0) flags.push('crosses-body');
        if (m.toTargetCm != null && m.toTargetCm > m.targetTolCm) flags.push('missed-target');
        return flags;
    }

    const api = { frame, sided, insideTorso, target, measure, cost, verdict };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_GESTURE_BODY_CHECK = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
