/**
 * HA1. Her hair aside: a mode the person turns on, never a change to any position.
 *
 * Why. Seen from behind on all fours, face down or bent over, long hair (Avatar B's, Model Girl's)
 * hangs off her head straight between the camera and her body: the spring bones do what hair does
 * under gravity, and in those positions gravity points it at the person looking. Moving it is a
 * choice the person makes ("hair aside", the ⋯ chip), so it is its own mode added to the list; the
 * positions themselves are untouched, and a body whose hair is short never notices.
 *
 * How. The hair is still simulated (it still sways and still collides with her head and body); only
 * the direction it falls changes. Every hair joint's gravity is pointed along her own forward
 * (away from someone behind her) and a little down, made stronger, and its stiffness — the pull
 * back to how it was modelled — lowered, so it settles past her shoulders instead of over her back.
 * three-vrm 2.x reads `joint.settings.gravityDir` in world space each frame, so nothing else moves.
 *
 * Snapshot and restore: `apply` copies every value it overwrites, `release` writes those copies
 * back verbatim, so turning it off is exactly her hair as it was. A new avatar (a different VRM)
 * drops the snapshot without writing it anywhere: those joints are gone.
 *
 * Pure parts (`isHairJoint`, `asideDirection`, `asideSettings`) take plain numbers and names so
 * they are tested without WebGL; `apply` takes the VRM and a THREE-like vector factory by injection.
 */
(function (global) {
    'use strict';

    // VRoid exports name hair joints J_Sec_Hair…; older samples HairJoint-… or hair_…; some
    // authors 髪 / 머리카락. The bust, the skirt and accessories never match.
    const HAIR = /hair|髪|머리카락|头发|頭髮/i;

    function isHairJoint(name) {
        return typeof name === 'string' && HAIR.test(name);
    }

    /**
     * The direction her hair falls in this mode, in world space: her forward, flattened to the
     * floor, plus a little down so it rests rather than floats. `forward` is {x, z} of the way she
     * faces; `side` ('front' | 'left' | 'right') tilts it over one shoulder. Returns a unit {x,y,z}.
     */
    function asideDirection(forward, side) {
        let fx = Number(forward && forward.x) || 0;
        let fz = Number(forward && forward.z) || 0;
        let len = Math.hypot(fx, fz);
        if (len < 1e-6) {
            fx = 0;
            fz = 1;
            len = 1;
        }
        fx /= len;
        fz /= len;
        // Her right, seen from above, is forward turned a quarter clockwise.
        const rx = -fz;
        const rz = fx;
        const lean = side === 'left' ? -0.6 : side === 'right' ? 0.6 : 0;
        const down = -0.35;
        const x = fx + rx * lean;
        const z = fz + rz * lean;
        const n = Math.hypot(x, down, z);
        return { x: x / n, y: down / n, z: z / n };
    }

    /** What one joint is set to: stronger pull along `dir`, less spring back to the modelled shape. */
    function asideSettings(before, dir) {
        const power = Math.max(1.2, Number(before && before.gravityPower) || 0);
        const stiffness = Math.min(Number(before && before.stiffness) || 0, 0.4);
        return { gravityPower: power, stiffness, gravityDir: { x: dir.x, y: dir.y, z: dir.z } };
    }

    function jointsOf(vrm) {
        const m = vrm && vrm.springBoneManager;
        if (!m || !m.joints) return [];
        return Array.from(m.joints);
    }

    function jointName(joint) {
        return (joint && joint.bone && joint.bone.name) || '';
    }

    let held = null; // { vrm, side, saved: [{ joint, gravityPower, stiffness, dir: {x,y,z} }] }

    /**
     * Turn it on for `vrm`. `forward` is her facing {x, z} in world space; `side` as above. Calling
     * it again (another side, or she turned) re-aims without taking a second snapshot. Returns how
     * many joints were moved (0: no spring hair, nothing to do).
     */
    function apply(vrm, forward, side) {
        const hair = jointsOf(vrm).filter((j) => isHairJoint(jointName(j)) && j.settings);
        if (!hair.length) return 0;
        if (!held || held.vrm !== vrm) {
            held = {
                vrm,
                side: side || 'front',
                saved: hair.map((joint) => {
                    const s = joint.settings;
                    const d = s.gravityDir || { x: 0, y: -1, z: 0 };
                    return {
                        joint,
                        gravityPower: s.gravityPower,
                        stiffness: s.stiffness,
                        dir: { x: d.x, y: d.y, z: d.z },
                    };
                }),
            };
        }
        held.side = side || held.side || 'front';
        const dir = asideDirection(forward, held.side);
        for (const saved of held.saved) {
            const s = saved.joint.settings;
            const next = asideSettings(saved, dir);
            s.gravityPower = next.gravityPower;
            s.stiffness = next.stiffness;
            if (s.gravityDir && typeof s.gravityDir.set === 'function') {
                s.gravityDir.set(dir.x, dir.y, dir.z);
            } else {
                s.gravityDir = next.gravityDir;
            }
        }
        return held.saved.length;
    }

    /** Back to her hair as it was modelled: the snapshot written back verbatim. */
    function release() {
        if (!held) return false;
        for (const saved of held.saved) {
            const s = saved.joint.settings;
            if (!s) continue;
            s.gravityPower = saved.gravityPower;
            s.stiffness = saved.stiffness;
            if (s.gravityDir && typeof s.gravityDir.set === 'function') {
                s.gravityDir.set(saved.dir.x, saved.dir.y, saved.dir.z);
            } else {
                s.gravityDir = { ...saved.dir };
            }
        }
        held = null;
        return true;
    }

    function isOn(vrm) {
        return Boolean(held && (!vrm || held.vrm === vrm));
    }

    /**
     * Her world forward {x, z} from the avatar root: VRM 0.x faces −Z, VRM 1.0 +Z
     * (`root.userData.vrmForwardNegZ`, VA), turned by the root's world rotation (only its yaw
     * matters here). Reads the root's matrixWorld directly so it needs no THREE in tests.
     */
    function forwardOf(root) {
        const e = root && root.matrixWorld && root.matrixWorld.elements;
        const sign = root && root.userData && root.userData.vrmForwardNegZ === false ? 1 : -1;
        if (!e) return { x: 0, z: sign };
        // Column 2 of the world matrix is the root's local +Z in world space.
        return { x: e[8] * sign, z: e[10] * sign };
    }

    /** The live page: the viewer's current VRM, aimed by her root. */
    function applyCurrent(side) {
        try {
            const v = global && global.NEXUS_VIEWER;
            const am = v && v.avatarManager;
            const vrm = am && am._currentVRM;
            if (!vrm) return 0;
            if (held && held.vrm !== vrm) held = null;
            const root = vrm.scene || null;
            if (root && typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
            return apply(vrm, forwardOf(root), side);
        } catch (err) {
            console.warn('[HairAside] could not move her hair:', err && err.message);
            return 0;
        }
    }

    const api = { isHairJoint, asideDirection, asideSettings, apply, release, isOn, forwardOf, applyCurrent };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_HAIR_ASIDE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
