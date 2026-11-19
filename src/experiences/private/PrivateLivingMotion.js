/**
 * LM1. Her body alive inside a held position: breathing, rocking, arching, her head going back,
 * her face, and her own hands on her body. A procedural layer over whatever Pose Studio preset
 * Private holds her in.
 *
 * ## Why a layer
 *
 * A position in Private is a preset (`PrivatePoseController` → `VRPoseSystem.applyPreset`) that the
 * pose system writes once and then holds: from the blend's last frame until the next request she
 * is a statue. Measured on the closer positions: hips, chest and head moved 0.0 mm over a minute
 * of straddling them. Nothing breaks the evening faster than a body that does not breathe while
 * the voice says it cannot catch its breath.
 *
 * New clips were not the answer. There are no free clips of this (the VA research found none), a
 * clip owns the whole skeleton and would throw away the measured, grounded preset under it, and
 * every clip is another download on a Quest. A few rotations on the spine, the pelvis and the
 * arms, computed each frame, cost nothing to ship and work on every position at once.
 *
 * ## How it stays out of the pose's way
 *
 * The pose system calls `apply` each frame after it has blended or solved, just before it copies
 * its rig onto her skeleton, and restores every value this layer touched at the start of the
 * next frame — but only where the value is still the one the layer wrote, so a preset applied
 * between frames is never overwritten with the old one (VRPoseSystem.setLayer). The held pose is
 * never edited: the next blend starts from what she shows, and releasing her writes the claim's
 * snapshot back exactly as before.
 *
 * ## Directions from her own bones
 *
 * Every axis is read off her skeleton each frame: "up" is hips to head, "right" is hip joint to hip
 * joint, "forward" is their cross product. Nothing assumes which way the model faces (a VRM 1.0
 * faces +Z, a VRM 0.x −Z: VA1) or that "up" is the world's up — on all fours her up is along the
 * floor, lying down it is along the bed — so one rule is right in every position. Arching is a
 * turn about her "right": positive takes her head backwards, whichever way she faces.
 *
 * ## Who decides how much
 *
 * Intensity is ConsentFlow's level, moved only by the person (CLAUDE.md, adult experience). This
 * reads it and never writes it. Self-touch follows the same steps as everything else in Private:
 * nothing below the third step; from the third, her hands on her breast and her belly (the two
 * places that measured right, PLACE_LEVEL). Care mode
 * keeps her still apart from breathing. Hands that hold her up (all fours) or hold them
 * (straddling, hands on their shoulders) are never taken for touching.
 *
 * Exposes: window.NEXUS_PRIVATE_LIVING
 */
(function (global) {
    'use strict';

    const TAU = Math.PI * 2;

    /**
     * What each held position does. `rock`: how her pelvis moves (the riding and from-behind
     * positions most, the user's ask; lying down a softer roll). `touch`: which places her hands
     * can reach from there, in the order she goes to them; `null` when her hands are holding her
     * up or holding them. `arch`: how much of the rising arch her spine takes in this position.
     */
    const STYLE = Object.freeze({
        straddle: { rock: 'ride', touch: null, arch: 1 },
        'all-fours': { rock: 'behind', touch: null, arch: 1 },
        'bend-forward': { rock: 'behind', touch: null, arch: 0.6 },
        'knees-up': { rock: 'lying', touch: ['chest', 'belly'], arch: 0.8 },
        'lie-back': { rock: 'lying', touch: ['chest', 'belly'], arch: 0.8 },
        // On her side a rolling pelvis reads as a twitch, not a rhythm: she only breathes.
        'lie-side': { rock: null, touch: null, arch: 0.4 },
        'lie-front': { rock: 'front', touch: null, arch: 0.6 },
        'sit-open': { rock: 'seated', touch: ['chest', 'belly'], arch: 0.7 },
        lounge: { rock: 'seated', touch: ['chest', 'belly'], arch: 0.5 },
        'kneel-wide': { rock: 'kneel', touch: ['chest', 'belly'], arch: 0.9 },
        'kneel-up': { rock: 'kneel', touch: ['chest', 'belly'], arch: 0.8 },
        kneel: { rock: 'kneel', touch: ['chest', 'belly'], arch: 0.6 },
        'arch-back': { rock: 'stand', touch: ['chest', 'belly'], arch: 0.5 },
    });

    /** How far her pelvis rolls (rad) at full intensity, per kind of rocking. */
    const ROCK = Object.freeze({ ride: 0.16, behind: 0.12, lying: 0.07, kneel: 0.08, seated: 0.05, front: 0.04 });

    /**
     * The step at which each place opens for her hands (the steps undressing and positions use).
     *
     * LM2. Only her breast and her belly are offered. Measured on her presets, those land within
     * 4 mm; her thighs and between her legs are 0.54–0.68 m from her shoulder against a 0.46 m reach,
     * so they need her to lean in, and the leaning still missed by 4–11 cm and did not look right.
     * They stay out until they do: `placeOf` keeps them for that work, and the offer stays here.
     */
    const PLACE_LEVEL = Object.freeze({ chest: 3, belly: 3 });

    /** What the model is told her hand is doing, so her words follow her body (UN27). */
    const PLACE_WORDS = Object.freeze({
        thigh: 'stroking your thigh',
        inner: 'sliding along the inside of your thigh',
        belly: 'resting on your belly, moving slowly',
        chest: 'cupping and caressing your breast',
        between: 'between your legs, touching yourself slowly',
    });

    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const smooth = (x) => {
        const t = clamp01(x);
        return t * t * (3 - 2 * t);
    };
    const band = (x, a, b) => smooth((x - a) / (b - a));

    /**
     * How close she is, 0–1, from the person's step and how long the evening has stayed at the
     * closest one (it keeps building there, over three minutes, rather than jumping to the top).
     */
    function arousal(level, secondsAtTop) {
        const base = [0, 0.08, 0.22, 0.45, 0.7][Math.max(0, Math.min(4, Math.round(level) || 0))];
        const build = level >= 4 ? 0.3 * clamp01((secondsAtTop || 0) / 180) : 0;
        return Math.min(1, base + build);
    }

    /**
     * The finish as her body lives it, 0–1, from the seconds since the person said they came:
     * it rises over three seconds, holds through the peak, and ebbs out over the next ten. `null`
     * seconds is no finish.
     */
    function climax(seconds) {
        if (seconds == null || !(seconds >= 0)) return 0;
        if (seconds < 3) return smooth(seconds / 3);
        if (seconds < 7) return 1;
        return 1 - smooth((seconds - 7) / 10);
    }

    /**
     * One hand's program at `t` seconds: the place it is on, the next one, and how far it has slid
     * towards that next one (`mix`, 0–1). Each hand stays 9 s at a place and slides to the next over
     * the last 1.6 s of them; the right hand runs half a cycle behind the left, so the two are
     * rarely in the same place.
     *
     * LM4. A hand on her stays on her. The first version let go between places (weight down to 0
     * and back up), and every time it let go the arm went back towards the preset's own arm — on
     * `sittingOpen` that arm is raised with the forearm across her chin (measured with the layer
     * off: elbow 190 mm above the shoulder) — so between her breast and her belly a forearm swept
     * up across her face. Sliding from place to place keeps the elbow down the whole way; the only
     * return to the preset's arm is when touching ends, and that is the pose as it was made.
     */
    function handAt(t, places, side, level) {
        const open = places.filter((p) => level >= PLACE_LEVEL[p]);
        if (!open.length) return { place: null, next: null, mix: 0, weight: 0 };
        const period = 9;
        const shift = side === 'right' ? period / 2 : 0;
        const k = Math.floor((t + shift) / period);
        const into = (t + shift) / period - k;
        const at = (n) => open[(n + (side === 'right' ? 1 : 0)) % open.length];
        const move = 1.6 / period;
        const mix = into > 1 - move ? smooth((into - (1 - move)) / move) : 0;
        return { place: at(k), next: at(k + 1), mix, weight: 1 };
    }

    /**
     * A stepper: one per evening. `step(dt, ctx)` advances her breath and rhythm by `dt` seconds
     * and returns this frame's layer; it integrates phases, so speeding up never jumps.
     *
     * ctx: `{ pose, level, secondsAtTop, sinceFinish, afterglow, care, speaking }`.
     *
     * Returns `{ pelvis, spine, chest, upperChest, neck, head, face, hands, arousal, climax }`:
     * bone turns are `[arch, twist, lean]` in radians about her own right, up and forward axes
     * (arch > 0 takes her head backwards); `pelvis` is a roll of the hips under a still thigh.
     */
    function create() {
        let t = 0;
        let breath = 0;
        let rock = 0;
        let rockOn = 0; // eased 0–1, so a position's rocking fades in over two seconds
        let touchOn = 0;
        let lastPose = null;
        let since = 0; // seconds in this position

        function step(dt, ctx) {
            const c = ctx || {};
            const d = Math.max(0, Math.min(0.1, Number(dt) || 0));
            t += d;
            if (c.pose !== lastPose) {
                lastPose = c.pose || null;
                since = 0;
            } else since += d;
            const style = (c.pose && STYLE[c.pose]) || null;
            const level = Number(c.level) || 0;
            const a = c.care ? Math.min(0.08, arousal(level, 0)) : arousal(level, c.secondsAtTop);
            const f = c.care ? 0 : climax(c.sinceFinish);
            const glow = c.afterglow && !f ? 1 : 0;

            // Breathing: 13 breaths a minute at rest, up to 40 at the peak; deeper as she builds,
            // and long and deep in the afterglow.
            const rate = 0.22 + 0.24 * a + 0.3 * f - 0.06 * glow;
            breath += rate * TAU * d;
            const depth = 0.014 + 0.03 * a + 0.035 * f + 0.02 * glow;
            // In faster than out: the rise takes 40% of the cycle.
            const ph = (breath / TAU) % 1;
            const b = ph < 0.4 ? smooth(ph / 0.4) : 1 - smooth((ph - 0.4) / 0.6);
            const lift = (b - 0.5) * 2 * depth;

            // Rocking: only from the third step, in positions that have it, slower at first.
            const want = style && style.rock && !c.care ? band(a, 0.3, 0.6) : 0;
            rockOn += (want - rockOn) * Math.min(1, d * 0.5);
            const rockRate = 0.3 + 0.4 * a;
            rock += rockRate * TAU * d;
            // At the peak the rhythm breaks: it tightens, shudders, then lets go.
            const amp = (ROCK[style && style.rock] || 0) * rockOn * (0.5 + 0.5 * a) * (1 - 0.65 * f);
            const shudder = f * (1 - f * 0.4) * 0.018 * Math.sin(t * 23) * Math.sin(t * 3.1);
            const roll = amp * Math.sin(rock);
            const lag = amp * Math.sin(rock - 0.7);

            // The arch builds with her and peaks at the finish; her head tips back with it.
            const archGain = style ? style.arch : 0.3;
            const arch = archGain * (0.03 + 0.09 * a + 0.12 * f);
            const headBack = (0.06 * a + 0.38 * f) * (style ? 1 : 0.5);
            // A slow sway, so she is never still on her other axes either.
            const sway = 0.012 + 0.02 * a;

            const out = {
                arousal: a,
                climax: f,
                pelvis: roll + shudder,
                spine: [arch * 0.35 - lag * 0.55 + lift * 0.3, sway * Math.sin(t * 0.37), 0],
                chest: [arch * 0.35 - lag * 0.2 + lift * 0.6, 0, sway * 0.5 * Math.sin(t * 0.29 + 1)],
                upperChest: [arch * 0.3 + lift, 0, 0],
                neck: [headBack * 0.35 - lift * 0.4, sway * 0.6 * Math.sin(t * 0.23 + 2), 0],
                head: [headBack * 0.65 - lift * 0.3 + shudder * 0.5, sway * Math.sin(t * 0.31), 0],
                face: {
                    // Her face: soft and relaxed as she builds; lips parting near the top and at
                    // the finish. Only `relaxed` and `oh`: emotions and lip sync own the others.
                    relaxed: c.care ? 0 : Math.min(0.85, 0.1 + 0.55 * a + 0.3 * f + 0.25 * glow),
                    oh: c.care || c.speaking ? 0 : Math.min(0.7, 0.25 * band(a, 0.6, 1) + 0.55 * f),
                },
                hands: { left: { place: null, weight: 0 }, right: { place: null, weight: 0 } },
                stroke: [0, 0],
            };

            // Her hands: from the third step, after she has been in the position a few seconds,
            // never in care mode, never with hands that hold her up or hold them.
            const touchWant = style && style.touch && !c.care && level >= 3 && since > 2.5 ? 1 : 0;
            touchOn += (touchWant - touchOn) * Math.min(1, d * 0.7);
            if (style && style.touch && touchOn > 0.001) {
                for (const side of ['left', 'right']) {
                    const h = handAt(t, style.touch, side, level);
                    out.hands[side] = { place: h.place, next: h.next, mix: h.mix, weight: h.weight * touchOn };
                }
            }
            // The stroke: a small slow circle on the skin, faster as she builds.
            const sr = (0.35 + 0.6 * a + 0.3 * f) * t * TAU;
            out.stroke = [Math.sin(sr), Math.cos(sr * 0.8)];
            return out;
        }

        return { step, reset: () => (t = breath = rock = rockOn = touchOn = since = 0) };
    }

    /**
     * What her hands are doing now, in the second person, for RIGHT NOW (UN27): `null` when they
     * are not on her. Read from the same frame that moves them, so her words cannot drift from
     * her body.
     */
    function describe(frame) {
        if (!frame || !frame.hands) return null;
        const parts = [];
        for (const side of ['left', 'right']) {
            const h = frame.hands[side];
            const where = h && (h.mix > 0.5 && h.next ? h.next : h.place);
            if (where && h.weight > 0.5) parts.push(`your ${side} hand ${PLACE_WORDS[where]}`);
        }
        return parts.length ? parts.join(', and ') : null;
    }

    // ---------------------------------------------------------------- applying it to her rig

    /**
     * The bones the layer may touch: the pose system saves these before `apply` and restores them
     * at the start of the next frame (VRPoseSystem.setLayer).
     */
    const BONES = Object.freeze([
        'hips',
        'spine',
        'chest',
        'upperChest',
        'neck',
        'head',
        'leftUpperLeg',
        'rightUpperLeg',
        'leftShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightShoulder',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
    ]);

    /**
     * Her body's frame, from her bones' world positions: `up` (hips → head), `right` (left hip
     * joint → right hip joint, square to up), `forward` (the way her front faces), and a scale
     * (1 at a 1.6 m adult), so offsets on her body are in proportion on every avatar.
     */
    function bodyFrame(rig, THREE) {
        const at = (k) => {
            const n = rig.node(k);
            return n ? n.getWorldPosition(new THREE.Vector3()) : null;
        };
        const hips = at('hips');
        const head = at('head');
        const lHip = at('leftUpperLeg');
        const rHip = at('rightUpperLeg');
        if (!hips || !head || !lHip || !rHip) return null;
        const up = head.clone().sub(hips);
        const torso = up.length();
        if (torso < 1e-4) return null;
        up.normalize();
        const right = rHip.clone().sub(lHip);
        right.addScaledVector(up, -right.dot(up));
        if (right.lengthSq() < 1e-8) return null;
        right.normalize();
        const forward = new THREE.Vector3().crossVectors(up, right).normalize();
        // hips → head is ~0.55 m on a 1.6 m adult.
        return { up, right, forward, scale: torso / 0.55, at };
    }

    /** Turn `bone` by `angle` about a world axis, keeping everything else about it. */
    function turnWorld(bone, axis, angle, THREE) {
        if (!bone || !angle) return;
        const pq = new THREE.Quaternion();
        if (bone.parent) bone.parent.getWorldQuaternion(pq);
        const d = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        const local = pq.clone().invert().multiply(d).multiply(pq);
        bone.quaternion.premultiply(local);
        bone.updateMatrixWorld(true);
    }

    /**
     * Where on her body a hand goes: the point on her skin and the way out of it there, for a
     * place and a side. Offsets are what the closer presets measured on AvatarSample_A, scaled.
     */
    function placeOf(place, side, frame, THREE) {
        const s = frame.scale;
        const sign = side === 'right' ? 1 : -1;
        const hipL = frame.at('leftUpperLeg');
        const hipR = frame.at('rightUpperLeg');
        const own = side === 'right' ? hipR : hipL;
        const other = side === 'right' ? hipL : hipR;
        const knee = frame.at(side === 'right' ? 'rightLowerLeg' : 'leftLowerLeg');
        if (place === 'thigh' || place === 'inner') {
            if (!own || !knee) return null;
            const along = knee.clone().sub(own).normalize();
            // The top of her thigh: her forward and her up, square to the thigh. Forward alone failed
            // kneeling, where the thigh points forward and what is left of forward is noise (a right
            // hand sent to the side of her knee, measured). Standing it is her front; seated or
            // kneeling its top; lying with knees up, the side facing the person.
            const lift = frame.forward.clone().add(frame.up);
            const front = lift.addScaledVector(along, -lift.dot(along));
            if (front.lengthSq() < 1e-6) front.copy(frame.up);
            front.normalize();
            if (place === 'thigh') {
                const p = own
                    .clone()
                    .lerp(knee, 0.3)
                    .addScaledVector(front, 0.075 * s);
                return { point: p, out: front, along };
            }
            const inward = other.clone().sub(own);
            inward.addScaledVector(along, -inward.dot(along)).normalize();
            const out = inward.clone().multiplyScalar(0.8).addScaledVector(front, 0.6).normalize();
            const p = own
                .clone()
                .lerp(knee, 0.16)
                .addScaledVector(inward, 0.055 * s)
                .addScaledVector(front, 0.04 * s);
            return { point: p, out, along };
        }
        const pelvis = hipL.clone().add(hipR).multiplyScalar(0.5);
        if (place === 'between') {
            const p = pelvis
                .clone()
                .addScaledVector(frame.forward, 0.07 * s)
                .addScaledVector(frame.up, -0.06 * s);
            const out = frame.forward.clone().multiplyScalar(0.7).addScaledVector(frame.up, -0.7).normalize();
            return { point: p, out, along: frame.up.clone().negate() };
        }
        if (place === 'belly') {
            const p = pelvis
                .clone()
                .addScaledVector(frame.up, 0.14 * s)
                .addScaledVector(frame.forward, 0.1 * s);
            return { point: p, out: frame.forward.clone(), along: frame.up.clone().negate() };
        }
        if (place === 'chest') {
            const chest = frame.at('upperChest') || frame.at('chest');
            if (!chest) return null;
            const p = chest
                .clone()
                .addScaledVector(frame.forward, 0.1 * s)
                .addScaledVector(frame.right, sign * 0.085 * s)
                .addScaledVector(frame.up, -0.12 * s);
            const out = frame.forward
                .clone()
                .multiplyScalar(0.9)
                .addScaledVector(frame.right, sign * 0.4)
                .normalize();
            return { point: p, out, along: frame.up.clone().negate() };
        }
        return null;
    }

    /**
     * LM2. Two-bone IK for an arm, solved in closed form: upper arm and forearm reach `target`, the
     * elbow bent towards `pole`. The pose system's CCD (made for dragging a hand in VR) starts from
     * whatever the preset left and bends one joint at a time against its clamps: measured on
     * `sittingOpen`, a forearm went into her belly and the other hand hung 16 cm short in the air.
     * Here the elbow is placed where the two lengths meet, on the side `pole` asks for — out and back,
     * away from her body — and each bone is turned to point at it: the same answer every frame.
     * Returns the wrist's distance from the target (m); a target out of reach is reached towards.
     */
    function solveArm(rig, side, target, pole, THREE) {
        const upper = rig.bone(`${side}UpperArm`);
        const lower = rig.bone(`${side}LowerArm`);
        const hand = rig.bone(`${side}Hand`);
        if (!upper || !lower || !hand) return null;
        const w = (n) => n.getWorldPosition(new THREE.Vector3());
        const S = w(upper);
        const a = w(lower).distanceTo(S);
        const b = w(hand).distanceTo(w(lower));
        const toT = target.clone().sub(S);
        const d = Math.min(Math.max(toT.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
        const dir = toT.normalize();
        const cosA = (a * a + d * d - b * b) / (2 * a * d);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
        if (bend.lengthSq() < 1e-8) return null;
        bend.normalize();
        const elbow = S.clone()
            .addScaledVector(dir, a * cosA)
            .addScaledVector(bend, a * sinA);
        const wrist = S.clone().addScaledVector(dir, d);
        const point = (bone, child, to) => {
            const from = w(child).sub(w(bone)).normalize();
            const want = to.clone().sub(w(bone)).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(from, want);
            const axis = new THREE.Vector3(q.x, q.y, q.z);
            const len = axis.length();
            if (len > 1e-7) turnWorld(bone, axis.divideScalar(len), 2 * Math.atan2(len, q.w), THREE);
        };
        point(upper, lower, elbow);
        point(lower, hand, wrist);
        return w(hand).distanceTo(target);
    }

    /** A hand's palm normal from its finger bones, `null` when the avatar has none. */
    function palmOf(rig, side, THREE) {
        const hand = rig.node(side + 'Hand');
        const middle = rig.node(side + 'MiddleProximal');
        const index = rig.node(side + 'IndexProximal');
        const little = rig.node(side + 'LittleProximal');
        if (!hand || !middle || !index || !little) return null;
        const w = (n) => n.getWorldPosition(new THREE.Vector3());
        const wrist = w(hand);
        const fingers = w(middle).sub(wrist);
        const across = w(index).sub(w(little));
        // T-pose, VRM 1.0 (+Z front): left fingers +X, index +Z ⇒ fingers × across = −Y, the palm.
        // The right hand mirrors, so the order flips. Rotations keep handedness: true in any pose.
        const n = side === 'left' ? fingers.clone().cross(across) : across.clone().cross(fingers);
        if (n.lengthSq() < 1e-10 || fingers.lengthSq() < 1e-10) return null;
        return { normal: n.normalize(), fingers: fingers.normalize(), wrist };
    }

    /**
     * Write one frame onto her rig. `rig`: `{ node(key), bone(key), solveArm(side, target),
     * saved(key) }` from the pose system; `THREE` injected. Returns what it did (for tests and
     * the audit): the hands' distance from their targets.
     */
    function apply(rig, frame, THREE) {
        const body = bodyFrame(rig, THREE);
        if (!body || !frame) return null;
        const bone = (k) => rig.bone(k);
        const done = { hands: {} };

        // The pelvis rolls about her hip joints, as a pelvis does — not about the hips bone, which
        // sits above them and slid her knees 9 mm a stroke — and the thighs are turned back, so
        // her knees stay where the pose put them.
        if (frame.pelvis && bone('hips')) {
            const hips = bone('hips');
            const mid = () => {
                const l = rig.node('leftUpperLeg');
                const r = rig.node('rightUpperLeg');
                return l && r
                    ? l
                          .getWorldPosition(new THREE.Vector3())
                          .add(r.getWorldPosition(new THREE.Vector3()))
                          .multiplyScalar(0.5)
                    : null;
            };
            const before = mid();
            turnWorld(hips, body.right, frame.pelvis, THREE);
            const after = mid();
            if (before && after && hips.parent) {
                const toLocal = (v) => hips.parent.worldToLocal(v.clone());
                hips.position.add(toLocal(before).sub(toLocal(after)));
                hips.updateMatrixWorld(true);
            }
            turnWorld(bone('leftUpperLeg'), body.right, -frame.pelvis, THREE);
            turnWorld(bone('rightUpperLeg'), body.right, -frame.pelvis, THREE);
        }
        for (const k of ['spine', 'chest', 'upperChest', 'neck', 'head']) {
            const r = frame[k];
            if (!r) continue;
            turnWorld(bone(k), body.right, r[0], THREE);
            turnWorld(bone(k), body.up, r[1], THREE);
            turnWorld(bone(k), body.forward, r[2], THREE);
        }

        // Her hands: each to its place, by the arm's own IK, held at the frame's weight.
        const active = ['left', 'right'].filter((side) => {
            const h = frame.hands && frame.hands[side];
            return h && h.place && h.weight > 0.001;
        });
        const aim = (side, f) => {
            const h = frame.hands[side];
            let spot = placeOf(h.place, side, f, THREE);
            if (!spot) return null;
            // LM4. Sliding to the next place: point, way out and finger direction all move
            // together, so the palm stays on her skin and turned into it the whole way.
            const next = h.next && h.mix > 0 ? placeOf(h.next, side, f, THREE) : null;
            if (next) {
                const m = h.mix;
                spot = {
                    point: spot.point.clone().lerp(next.point, m),
                    out: spot.out.clone().lerp(next.out, m).normalize(),
                    along: spot.along.clone().lerp(next.along, m).normalize(),
                };
            }
            const tangent = new THREE.Vector3().crossVectors(spot.out, spot.along).normalize();
            const sc = f.scale;
            // The wrist sits off her skin by the palm's thickness, back along the fingers by half a
            // hand, so the palm and fingers, not the wrist, are on the place; plus the stroke.
            const target = spot.point
                .clone()
                .addScaledVector(spot.out, 0.035 * sc)
                .addScaledVector(spot.along, -0.07 * sc)
                .addScaledVector(tangent, 0.022 * sc * (frame.stroke ? frame.stroke[0] : 0))
                .addScaledVector(spot.along, 0.018 * sc * (frame.stroke ? frame.stroke[1] : 0));
            return { spot, target };
        };
        const reachOf = (side) => {
            const w = (k) => (rig.bone(k) ? rig.bone(k).getWorldPosition(new THREE.Vector3()) : null);
            const S = w(`${side}UpperArm`);
            const E = w(`${side}LowerArm`);
            const H = w(`${side}Hand`);
            return S && E && H ? { S, arm: S.distanceTo(E) + E.distanceTo(H) } : null;
        };

        // LM2. She leans in to touch what her arm cannot reach sitting up: measured on her presets,
        // the wrist reaches 0.46 m from the shoulder and her upper thigh is 0.54–0.6 m away. Her
        // spine and chest bend forward just enough for the farthest hand, in proportion to how
        // firmly it is there, so leaning in and sitting back up are as smooth as the hand.
        let body2 = bodyFrame(rig, THREE) || body;
        let lean = 0;
        // Two passes: bending forward swings her shoulder on an arc, not straight at the target, so
        // the first estimate falls short; the second takes up what is left.
        for (let pass = 0; pass < 2; pass += 1) {
            let more = 0;
            for (const side of active) {
                const r = reachOf(side);
                const a = aim(side, body2);
                if (!r || !a) continue;
                const short = a.target.distanceTo(r.S) - 0.96 * r.arm;
                if (short > 0) more = Math.max(more, smooth(frame.hands[side].weight) * (short / (0.35 * body2.scale)));
            }
            more = Math.min(0.6 - lean, more);
            if (more <= 1e-4) break;
            turnWorld(bone('spine'), body2.right, -more * 0.55, THREE);
            turnWorld(bone('chest'), body2.right, -more * 0.45, THREE);
            lean += more;
            body2 = bodyFrame(rig, THREE) || body2;
        }
        done.lean = lean;

        for (const side of active) {
            const h = frame.hands[side];
            const a = aim(side, body2);
            if (!a) continue;
            const { spot, target } = a;
            const after = body2;
            const keys = [`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`];
            const base = keys.map((k) => (bone(k) ? bone(k).quaternion.clone() : null));
            const w = smooth(h.weight);
            // Easing in or out, the wrist travels a straight line from where the pose holds it to the
            // place: blending each bone's rotation alone swung her hand out in an arc (measured: a
            // right arm thrown out to her side halfway between her thigh and her breast).
            const held = rig.bone(`${side}Hand`) ? rig.bone(`${side}Hand`).getWorldPosition(new THREE.Vector3()) : null;
            const goal = held ? held.lerp(target, w) : target;
            try {
                // The elbow out to her side and down towards her hips: up and back (the first try) lifted
                // a forearm across her face on the way to her breast.
                const sideOut = after.right.clone().multiplyScalar(side === 'right' ? 1 : -1);
                const pole = sideOut.addScaledVector(after.forward, -0.25).addScaledVector(after.up, -1.1);
                if (solveArm(rig, side, goal, pole, THREE) == null && rig.solveArm) rig.solveArm(side, goal);
                // The whole hand onto her: palm into her skin, fingers along her body.
                const palm = palmOf(rig, side, THREE);
                if (palm) {
                    const n = spot.out.clone().negate();
                    const fd = spot.along.clone().addScaledVector(n, -spot.along.dot(n));
                    if (fd.lengthSq() > 1e-8) {
                        fd.normalize();
                        const fc = palm.fingers.clone().addScaledVector(palm.normal, -palm.fingers.dot(palm.normal));
                        fc.normalize();
                        const basis = (f, nn) =>
                            new THREE.Matrix4().makeBasis(f, nn, new THREE.Vector3().crossVectors(f, nn));
                        const q = new THREE.Quaternion().setFromRotationMatrix(
                            basis(fd, n).multiply(basis(fc, palm.normal).transpose())
                        );
                        const axis = new THREE.Vector3(q.x, q.y, q.z);
                        const len = axis.length();
                        const angle = 2 * Math.atan2(len, q.w);
                        if (len > 1e-6) turnWorld(bone(`${side}Hand`), axis.divideScalar(len), angle, THREE);
                    }
                }
            } catch (_) {
                /* an arm that cannot reach keeps the pose's */
            }
            // The solve's elbow and palm phase in over the first half of the way.
            const k2 = Math.min(1, w * 2);
            keys.forEach((k, i) => {
                const b = bone(k);
                if (!b || !base[i]) return;
                const solved = b.quaternion.clone();
                b.quaternion.copy(base[i]).slerp(solved, k2);
                b.updateMatrixWorld(true);
            });
            const handNode = rig.node(`${side}Hand`);
            done.hands[side] = {
                target: target.toArray(),
                place: h.place,
                weight: w,
                missMm: handNode
                    ? Math.round(handNode.getWorldPosition(new THREE.Vector3()).distanceTo(target) * 1000)
                    : null,
            };
        }
        return done;
    }

    // ---------------------------------------------------------------- the switch in Settings

    /**
     * LM3. One switch, in Settings under Spicy Mode: "Living motion in Private". On by default,
     * kept on this device. Off means the layer draws nothing — she holds each position as the
     * preset has it, her face goes back to neutral, and the model is told nothing about her hands
     * — while every part of it stays installed, so turning it back on needs no reload and nothing
     * is lost. Read each frame, so the change is live in the middle of an evening.
     *
     * A setting, not conversation: CLEAR leaves it (ConversationReset is the owner of forgetting,
     * and settings are not what it forgets).
     */
    const STORAGE_KEY = 'nexus_private_living_enabled';
    const listeners = new Set();

    function store() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /** Is the living layer on? Absent or unreadable storage is on: it is the shipped default. */
    function isOn() {
        try {
            const st = store();
            return !st || st.getItem(STORAGE_KEY) !== '0';
        } catch (_) {
            return true;
        }
    }

    /** Turn it on or off; tells listeners (the Settings row) when it changed. */
    function setOn(on) {
        const was = isOn();
        try {
            const st = store();
            if (st) st.setItem(STORAGE_KEY, on ? '1' : '0');
        } catch (_) {
            /* private browsing: it stays as it was for this page */
        }
        const now = isOn();
        if (now !== was)
            for (const fn of [...listeners]) {
                try {
                    fn(now);
                } catch (_) {
                    /* one listener must not stop the others */
                }
            }
        return now;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    /**
     * Put the switch into Settings: a row in the Spicy Mode section, beside the toggle it belongs
     * with. Added from here rather than written into `index.html`, because a row there moves every
     * line below it and the parity harness pins those lines (CLAUDE.md, the wardrobe tags). Once
     * per document; a page without the Spicy section gets no row and keeps the default.
     */
    const ROW_ID = 'private-living-toggle';
    function mountSetting(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d || d.getElementById(ROW_ID)) return d ? d.getElementById(ROW_ID) : null;
        const spicy = d.getElementById('spicy-mode-toggle');
        const section = spicy && spicy.closest ? spicy.closest('.config-section') : null;
        if (!section) return null;
        const group = d.createElement('div');
        group.className = 'input-group';
        const label = d.createElement('label');
        label.className = 'spicy-toggle-label';
        const text = d.createElement('span');
        text.textContent = 'Living motion in Private';
        const sw = d.createElement('div');
        sw.className = 'spicy-toggle-switch';
        const box = d.createElement('input');
        box.type = 'checkbox';
        box.id = ROW_ID;
        box.checked = isOn();
        const slider = d.createElement('span');
        slider.className = 'spicy-toggle-slider';
        sw.append(box, slider);
        label.append(text, sw);
        const note = d.createElement('p');
        note.style.cssText = 'font-size: 0.7rem; color: #888; margin: 6px 0 0';
        note.textContent =
            'Breathing, rocking, arching and her hands while she holds a position. Off keeps her still in it.';
        group.append(label, note);
        section.append(group);
        box.addEventListener('change', () => setOn(box.checked));
        onChange((on) => {
            box.checked = on;
        });
        return box;
    }

    // ---------------------------------------------------------------- the runtime in the page

    /**
     * Start the layer on the page's pose system for one Private evening. `read()` returns this
     * frame's `{ pose, level, finishAt, afterglow, care, speaking }` from the bridge; the layer
     * runs only while she holds a position (the pose system calls it only while it holds her).
     * Returns `{ detach(), frame() }`. Fail soft everywhere: this runs inside the render loop.
     */
    function attach(options) {
        const o = options || {};
        const win = o.win || global;
        const vps = o.system || (win && win.vrPoseSystem);
        if (!vps || typeof vps.setLayer !== 'function') return null;
        const stepper = create();
        let last = null;
        let topSince = null;
        const faceSet = new Set();
        const vrm = () => {
            try {
                const m = win.NEXUS_VIEWER && win.NEXUS_VIEWER.avatarManager;
                return (m && m._currentVRM) || null;
            } catch (_) {
                return null;
            }
        };
        const setFace = (face) => {
            const em = vrm() && vrm().expressionManager;
            if (!em || typeof em.setValue !== 'function') return;
            for (const [name, value] of Object.entries(face || {})) {
                try {
                    em.setValue(name, value);
                    faceSet.add(name);
                } catch (_) {
                    /* this avatar has no such expression */
                }
            }
        };
        const layer = {
            keys: BONES,
            apply(dt, rig, THREE) {
                // LM3. Switched off in Settings: draw nothing, put her face back, say nothing.
                if (!isOn()) {
                    layer.idle();
                    return null;
                }
                let ctx = {};
                try {
                    ctx = (typeof o.read === 'function' && o.read()) || {};
                } catch (_) {
                    ctx = {};
                }
                const now = Date.now();
                if ((Number(ctx.level) || 0) >= 4) topSince = topSince == null ? now : topSince;
                else topSince = null;
                last = stepper.step(dt, {
                    pose: ctx.pose || null,
                    level: ctx.level,
                    secondsAtTop: topSince == null ? 0 : (now - topSince) / 1000,
                    sinceFinish: ctx.finishAt ? (now - ctx.finishAt) / 1000 : null,
                    afterglow: ctx.afterglow,
                    care: ctx.care,
                    speaking: ctx.speaking,
                });
                setFace(last.face);
                return apply(rig, last, THREE);
            },
            // The pose system let go of her (stood up, Reset): her face goes back too.
            idle() {
                if (!faceSet.size) return;
                setFace(Object.fromEntries([...faceSet].map((n) => [n, 0])));
                faceSet.clear();
                last = null;
            },
        };
        vps.setLayer(layer);
        return {
            detach() {
                try {
                    if (vps.getLayer && vps.getLayer() === layer) vps.setLayer(null);
                } catch (_) {
                    /* the pose system is gone with the page */
                }
                layer.idle();
            },
            frame: () => last,
            describe: () => (isOn() ? describe(last) : null),
        };
    }

    const api = {
        STYLE,
        ROCK,
        PLACE_LEVEL,
        PLACE_WORDS,
        BONES,
        arousal,
        climax,
        handAt,
        create,
        describe,
        bodyFrame,
        placeOf,
        solveArm,
        apply,
        attach,
        STORAGE_KEY,
        isOn,
        setOn,
        onChange,
        mountSetting,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_LIVING = api;
    // LM3. The Settings row, once the page's markup is there (tests call mountSetting themselves).
    if (typeof document !== 'undefined' && typeof module === 'undefined') {
        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', () => mountSetting(document), { once: true });
        else mountSetting(document);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
