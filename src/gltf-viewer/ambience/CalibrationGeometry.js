/**
 * Where the horizon, the floor and the feet actually land (batch A13).
 *
 * The problem this exists to solve, stated plainly: **fitting an image to the viewport is not
 * the same thing as matching its camera to the 3D camera.** A2–A12 built a correct
 * `background-size: cover` renderer, and it is correct — and a scenic backplate can still read
 * as a cut-out, because the photograph has its own implicit horizon, eye height and vanishing
 * lines, and nothing so far made those agree with the `PerspectiveCamera` the avatar is
 * projected through.
 *
 * Telling an artist or an image model "30 degree vertical FOV" is weak guidance. Telling it
 * "the horizon is at 43.1% of frame height and the feet touch the ground at (50.0%, 78.4%)" is
 * a constraint it can actually satisfy. This module computes those numbers, so the guide comes
 * from the engine rather than from somebody's estimate.
 *
 * ## Screen space here is fractions, not pixels
 *
 * Everything returns `x` and `y` in `0..1` with **y increasing downward**, the way an image
 * editor and a generator both think. 1920×1080 and 1080×1920 then fall out by multiplication,
 * which is why nothing here knows a pixel size.
 *
 * ## Why it reimplements projection instead of calling THREE
 *
 * Two reasons, and the second is the real one.
 *
 * Jest has no WebGL, and `src/gltf-viewer/` code with a top-level `import` cannot be `require`d
 * at all — so a module that reached for `THREE.Vector3.project()` would be untestable, which
 * for the one piece of maths the whole art pipeline rests on is the wrong trade.
 *
 * More importantly the output is a *specification*: a number an artist composes against and a
 * generator is conditioned on. It should be derivable and checkable on its own terms rather
 * than being whatever a particular renderer version happened to produce. `crossCheck()` exists
 * to reconcile the two at runtime — it takes THREE's own projection of a point and reports the
 * disagreement, so drift is visible instead of assumed absent.
 *
 * The inputs are still read from the live camera. Nothing here invents a projection.
 *
 * Exposes: window.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY
 */
(function (global) {
    'use strict';

    const DEG2RAD = Math.PI / 180;

    /**
     * The three projections this app actually ships, named once.
     *
     * There are two, and until A13 there were three. `MobileSupport` called its non-portrait
     * value `desktopFOV = 35`, but its listeners are only attached for phones and tablets — so a
     * desktop never reached that branch and kept `ViewerEngine`'s constructor value of 30, while
     * a tablet or a sideways phone got 35. Three projections, one named after the device that
     * never used it.
     *
     * Survivable behind a flat colour; not once a backplate has to agree with the camera. An
     * image composed for 30° is measurably wrong at 35° and its horizon lands in the wrong
     * place. Landscape is now 30 everywhere, and these two profiles are the whole set.
     */
    const PROFILES = Object.freeze({
        landscape: Object.freeze({ id: 'landscape', fovDeg: 30, aspect: 16 / 9, fitOffset: 1.35, biasY: 0.04 }),
        portrait: Object.freeze({ id: 'portrait', fovDeg: 42, aspect: 9 / 16, fitOffset: 1.4, biasY: 0.04 }),
    });

    /**
     * The camera is not level, and this is the number that says so.
     *
     * `ViewerEngine.frameObject` places the eye at `target + normalize(0, 0.03, 1) * distance` —
     * a slight lift, looking very slightly down at the subject. About 1.7°.
     *
     * It is tiny and it is not negligible. A first draft of this module assumed a level camera
     * and reported the horizon at exactly 50% of frame height for both profiles, which is a
     * clean, memorable and wrong number to hand an artist. The horizon is the strongest cue in
     * a backplate; being a percent and a half out is visible.
     */
    const EYE_LIFT = 0.03;

    function num(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]);
        if (!(len > 0)) return [0, 0, 0];
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    /**
     * The camera's orthonormal basis, the way a look-at camera builds one.
     *
     * Degenerate cases are real: a camera directly above its target makes `forward` parallel to
     * world up and the cross product collapses. Falling back to a fixed right vector keeps the
     * basis usable instead of handing NaN to everything downstream — a guide that silently
     * became NaN would be a blank overlay with no explanation.
     */
    function basis(eye, target) {
        const forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
        let right = cross(forward, [0, 1, 0]);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-8) right = [1, 0, 0];
        right = normalize(right);
        const up = normalize(cross(right, forward));
        return { forward, right, up };
    }

    /**
     * Project one world point to screen fractions.
     *
     * @returns {{x:number, y:number, behind:boolean}} `behind` is true when the point is at or
     *   behind the camera plane, where a perspective divide is meaningless. Reported rather than
     *   clamped, because a foot anchor that lands behind the camera means the caller's framing
     *   is wrong and should say so, not quietly draw a marker at the edge.
     */
    function project(point, view) {
        const eye = view.eye;
        const b = basis(eye, view.target);
        const v = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
        const z = dot(v, b.forward);
        if (!(z > 1e-9)) return { x: 0.5, y: 0.5, behind: true };

        const vFov = view.fovDeg * DEG2RAD;
        const tanV = Math.tan(vFov / 2);
        const tanH = tanV * view.aspect;

        const ndcX = dot(v, b.right) / z / tanH;
        const ndcY = dot(v, b.up) / z / tanV;
        return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2, behind: false };
    }

    /**
     * Where a level ground plane's horizon sits, as a fraction of frame height.
     *
     * The horizon is the vanishing line of every direction parallel to the ground, so it is
     * found by projecting a *direction* rather than a point: push one horizontal direction to
     * infinity and see where it lands. With a level camera it is exactly the middle of the
     * frame; pitch it down and the horizon rises, which is the single strongest cue an artist
     * needs and the one most often got wrong by eye.
     */
    function horizonY(view) {
        const b = basis(view.eye, view.target);
        const direction = [b.forward[0], 0, b.forward[2]];
        const flat = normalize(direction);
        // A camera pointing straight down has no horizon in frame at all.
        if (Math.hypot(flat[0], flat[1], flat[2]) < 1e-8) return null;

        const z = dot(flat, b.forward);
        if (!(z > 1e-9)) return null;
        const tanV = Math.tan((view.fovDeg * DEG2RAD) / 2);
        const ndcY = dot(flat, b.up) / z / tanV;
        return (1 - ndcY) / 2;
    }

    /**
     * The camera placement the app would choose for an avatar of this size.
     *
     * Mirrors `CameraFraming.fitDistance` deliberately rather than importing it — that module is
     * loaded as a global in the browser and the duplication here is nine lines of arithmetic
     * against a permanent cross-check in the tests, which is cheaper than a load-order
     * dependency in a development-only tool.
     */
    function frameFor(profile, avatar) {
        const sizeY = num(avatar.height, 1.6);
        const sizeX = num(avatar.width, sizeY * 0.4);
        const fitOffset = num(profile.fitOffset, 1.35);
        const vFov = profile.fovDeg * DEG2RAD;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * profile.aspect);
        const byHeight = (sizeY * fitOffset) / (2 * Math.tan(vFov / 2));
        const byWidth = (sizeX * fitOffset) / (2 * Math.tan(hFov / 2));
        const distance = Math.max(byHeight, byWidth);

        const footY = num(avatar.footY, 0);
        // The bias lifts the look-at point, which pushes the subject down in frame and leaves
        // headroom. Same convention and same default as CameraFraming.
        const centreY = footY + sizeY / 2 + num(profile.biasY, 0) * sizeY;

        // And the eye sits slightly above the target, exactly as frameObject places it.
        const lift = normalize([0, EYE_LIFT, 1]);
        const eye = [0, centreY + lift[1] * distance, lift[2] * distance];
        const pitchDeg = Math.atan2(eye[1] - centreY, eye[2]) / DEG2RAD;
        return {
            distance,
            eye,
            target: [0, centreY, 0],
            pitchDeg,
            fovDeg: profile.fovDeg,
            aspect: profile.aspect,
        };
    }

    /**
     * The full guide for one profile: everything an artist or a generator needs to compose a
     * backplate that this camera will agree with.
     *
     * @param {object} profile one of PROFILES, or the same shape read from a live camera
     * @param {object} avatar `{height, width, footY}` in metres, from the real avatar bounds
     * @param {object} [options] `{keepClear: [0.30, 0.70]}` — the central band kept free of
     *   dominant foreground detail. A rule of art production, not of geometry, so it is an
     *   input rather than a constant.
     */
    function guide(profile, avatar, options) {
        const opts = options || {};
        const view = frameFor(profile, avatar || {});
        const sizeY = num((avatar || {}).height, 1.6);
        const footY = num((avatar || {}).footY, 0);

        const feet = project([0, footY, 0], view);
        const head = project([0, footY + sizeY, 0], view);
        const horizon = horizonY(view);
        const keepClear = Array.isArray(opts.keepClear) ? opts.keepClear : [0.3, 0.7];

        // Depth lines on the ground plane, for an artist to align a floor against. Spaced by
        // metres in world space, which is why they bunch towards the horizon on screen — that
        // convergence is the perspective cue the whole exercise is about.
        const depths = Array.isArray(opts.depths) ? opts.depths : [0.5, 1, 2, 4, 8, 16];
        const groundLines = depths
            .map((metres) => {
                const p = project([0, footY, -metres], view);
                return { metres, y: p.y, behind: p.behind };
            })
            .filter((line) => !line.behind && line.y >= 0 && line.y <= 1);

        return {
            profile: profile.id || 'custom',
            fovDeg: view.fovDeg,
            aspect: view.aspect,
            camera: {
                distance: view.distance,
                eyeHeight: view.eye[1],
                targetHeight: view.target[1],
                // Downward pitch, from the eye lift frameObject applies. Small, and the reason
                // the horizon is not at the middle of the frame.
                pitchDeg: view.pitchDeg,
            },
            horizonY: horizon,
            footAnchor: { x: feet.x, y: feet.y },
            headTopY: head.y,
            safeZone: { x0: keepClear[0], x1: keepClear[1], y0: head.y, y1: feet.y },
            groundLines,
        };
    }

    /**
     * Reconcile this module's projection with the renderer's own.
     *
     * The guide is a specification and is computed independently, so "independently" has to be
     * checkable rather than merely asserted. Hand this THREE's projection of the same point
     * (`vector.project(camera)`, converted to the same fractions) and it reports the
     * disagreement. The overlay calls it at runtime and warns above the tolerance, so a change
     * in either place surfaces as a number instead of as art that quietly stops lining up.
     */
    function crossCheck(ours, theirs, tolerance) {
        const tol = num(tolerance, 0.002);
        const dx = Math.abs(num(ours.x, 0) - num(theirs.x, 0));
        const dy = Math.abs(num(ours.y, 0) - num(theirs.y, 0));
        return { dx, dy, agrees: dx <= tol && dy <= tol, tolerance: tol };
    }

    /** Fractions → pixels, for a master of a given size. */
    function toPixels(g, width, height) {
        const w = num(width, 1920);
        const h = num(height, 1080);
        return {
            width: w,
            height: h,
            horizonY: g.horizonY == null ? null : Math.round(g.horizonY * h),
            footAnchor: { x: Math.round(g.footAnchor.x * w), y: Math.round(g.footAnchor.y * h) },
            headTopY: Math.round(g.headTopY * h),
            safeZone: {
                x0: Math.round(g.safeZone.x0 * w),
                x1: Math.round(g.safeZone.x1 * w),
                y0: Math.round(g.safeZone.y0 * h),
                y1: Math.round(g.safeZone.y1 * h),
            },
        };
    }

    const api = {
        PROFILES,
        basis,
        crossCheck,
        frameFor,
        guide,
        horizonY,
        project,
        toPixels,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
