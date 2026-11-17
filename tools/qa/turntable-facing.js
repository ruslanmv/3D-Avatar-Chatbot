/**
 * RP2. Which way is she facing? Measured from her own shoulders, not assumed from her file format.
 *
 * `look-turntable.mjs` makes the clothed pictures a person reviews a character from, and each
 * picture is named by its view ("front", "left", "back", "right") in the review packet that lists
 * it by SHA-256. The tool took the app's own framing as "front". The app turns every VRM by π
 * (`AvatarManager`, `ViewerEngine`: "VRM spec: forward = -Z"), which is right for VRM 0.x and
 * wrong for VRM 1.0, whose humanoid faces +Z. So for a VRM 1.0 file (Model Girl,
 * AvatarSample_O) the picture filed as "front" showed her back and "back" showed her face: a
 * reviewer asked to cite what they looked at by view would cite the wrong one, and nothing in
 * the sheet said so.
 *
 * Reading the spec version would only move the assumption. This reads the pose instead: with
 * `up` = +Y, her forward is (left shoulder − right shoulder) × up. If that points away from the
 * camera she is shown from behind, and the turntable adds π before it starts. Pure: numbers in,
 * numbers out, so it is tested without WebGL (tests/look-turntable-facing.test.js).
 */
(function (global) {
    'use strict';

    /**
     * @param {{x:number,y:number,z:number}} left   her left upper arm (or shoulder), world space
     * @param {{x:number,y:number,z:number}} right  her right upper arm, world space
     * @param {{x:number,y:number,z:number}} toCamera  camera position minus her position
     * @returns {{offset:number, facing:'camera'|'away'|'unknown', dot:number}}
     *   offset: radians to add to her yaw so the "front" picture is her front (0 or π).
     */
    function facingOffset(left, right, toCamera) {
        const ok = (v) => v && [v.x, v.y, v.z].every(Number.isFinite);
        if (!ok(left) || !ok(right) || !ok(toCamera)) return { offset: 0, facing: 'unknown', dot: 0 };
        // (L − R) × (0, 1, 0) = (−(Lz − Rz), 0, Lx − Rx): horizontal by construction.
        const ax = left.x - right.x;
        const az = left.z - right.z;
        const fx = -az;
        const fz = ax;
        const cx = toCamera.x;
        const cz = toCamera.z;
        const fl = Math.hypot(fx, fz);
        const cl = Math.hypot(cx, cz);
        // Shoulders on top of each other, or the camera straight overhead: no answer, so no change.
        if (fl < 1e-6 || cl < 1e-6) return { offset: 0, facing: 'unknown', dot: 0 };
        const dot = (fx * cx + fz * cz) / (fl * cl);
        // Only a clear back view is corrected; a side-on start (|dot| small) is left as framed.
        if (dot < -0.5) return { offset: Math.PI, facing: 'away', dot };
        return { offset: 0, facing: dot > 0.5 ? 'camera' : 'unknown', dot };
    }

    const api = { facingOffset };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TURNTABLE_FACING = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
