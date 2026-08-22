'use strict';

/**
 * CameraFraming — the composition maths behind auto-framing.
 * ==========================================================
 *
 * Reported: the character sits low in the viewport with a band of dead space
 * above her and her feet nearly touching the bottom edge.
 *
 * The tempting explanation is that framing goes stale on resize —
 * `ViewerEngine.resize()` re-frames on mobile only. It is the wrong
 * explanation. In three.js `PerspectiveCamera.fov` is the VERTICAL field of
 * view and does not change with `aspect`; aspect only widens or narrows the
 * frame. So the visible HEIGHT at a given distance is aspect-invariant, and a
 * standing figure — whose height is the limiting axis at every aspect — needs
 * exactly the same distance on a 1:2 panel as on a 21:9 one. Measured on a
 * 1.6 m × 0.55 m figure through a 50° lens, the fit distance is 2.3161 at
 * aspect 0.5, 1.0, 1.78 and 2.4 alike. Resizing cannot be the cause.
 *
 * The cause is the composition bias. Both framing paths raise the camera
 * TARGET above the subject's centre:
 *
 *     frameObject:                    target.y += size.y * 0.12
 *     _reframeAvatarPreserveAppearance: center.y + size.y * (portrait ? 0.12 : 0.08)
 *
 * Raising the target raises the point the camera looks at, which pushes the
 * subject DOWN in frame. With a 1.35 fit offset, a bias of 0.12 leaves 0.472 m
 * of headroom against 0.088 m of footroom — a 5.4:1 split, which is precisely
 * the reported picture. 0.08 still gives 2.7:1.
 *
 * Pure module: numbers in, numbers out. No THREE, no DOM. The arithmetic is
 * the part that can be wrong, so it is the part that is testable.
 *
 * @module CameraFraming
 */

const CameraFraming = (() => {
    'use strict';

    const DEG2RAD = Math.PI / 180;

    /**
     * How far above the subject's centre the camera target sits, as a fraction
     * of subject height.
     *
     * Zero would centre the bounding box exactly, which reads as slightly
     * bottom-heavy to the eye because a standing figure's visual mass is low.
     * A small positive bias gives the conventional portrait composition — a
     * little more headroom than footroom — without the void the old 0.12
     * produced. At the shipped 1.35 fit offset this is about 1.6:1, against
     * 5.4:1 before.
     */
    const HEADROOM_BIAS = 0.04;

    /**
     * Distance at which a box of `sizeX` × `sizeY` fills the frame, times
     * `fitOffset` for breathing room.
     *
     * Both axes are considered: fitting height alone clips a wide pose (arms
     * out in a dance) on a narrow viewport, and fitting width alone clips a
     * standing figure on a wide one. The larger distance satisfies both.
     *
     * @param {{sizeX: number, sizeY: number, fovDeg: number, aspect: number, fitOffset?: number}} o
     * @returns {number} 0 when the inputs cannot produce a meaningful distance
     */
    function fitDistance(o) {
        const opts = o || {};
        const sizeX = Number(opts.sizeX) || 0;
        const sizeY = Number(opts.sizeY) || 0;
        const fovDeg = Number(opts.fovDeg) || 0;
        const aspect = Number(opts.aspect) || 0;
        const fitOffset = opts.fitOffset == null ? 1.35 : Number(opts.fitOffset);
        if (!(sizeX > 0 || sizeY > 0) || !(fovDeg > 0) || !(aspect > 0) || !(fitOffset > 0)) return 0;

        const vFov = fovDeg * DEG2RAD;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const byHeight = (sizeY * fitOffset) / (2 * Math.tan(vFov / 2));
        const byWidth = (sizeX * fitOffset) / (2 * Math.tan(hFov / 2));
        return Math.max(byHeight, byWidth);
    }

    /**
     * The empty space above and below the subject for a given bias.
     *
     * Half the frame is `sizeY * fitOffset / 2` tall. Biasing the target up by
     * `biasY * sizeY` moves the subject down by the same amount, so:
     *
     *     headroom = sizeY * (fitOffset/2 - 0.5 + biasY)
     *     footroom = sizeY * (fitOffset/2 - 0.5 - biasY)
     *
     * A negative footroom means the feet are outside the frame — the subject is
     * clipped, not merely low.
     *
     * @param {{sizeY: number, fitOffset?: number, biasY?: number}} o
     * @returns {{headroom: number, footroom: number, ratio: number}}
     */
    function composition(o) {
        const opts = o || {};
        const sizeY = Number(opts.sizeY) || 0;
        const fitOffset = opts.fitOffset == null ? 1.35 : Number(opts.fitOffset);
        const biasY = opts.biasY == null ? HEADROOM_BIAS : Number(opts.biasY);
        const margin = fitOffset / 2 - 0.5;
        const headroom = sizeY * (margin + biasY);
        const footroom = sizeY * (margin - biasY);
        const ratio = footroom > 0 ? headroom / footroom : Infinity;
        return { headroom, footroom, ratio };
    }

    /**
     * Per-press dolly factors.
     *
     * Zoom has to be MULTIPLICATIVE. Subtracting a fixed distance crawls when
     * the camera is far out and slams into the model when it is close, because
     * the same metre covers wildly different angular amounts at each range. A
     * ratio covers the same proportion at every range, which is why
     * OrbitControls' own dolly uses 0.95 ^ zoomSpeed rather than a subtraction.
     * Getting this wrong is the usual reason a hand-rolled zoom "feels bad",
     * and it is normally misdiagnosed as a speed-tuning problem.
     */
    const DOLLY_STEP = 0.9; // ~10% closer per press
    const DOLLY_STEP_FINE = 0.97; // with Shift held

    /**
     * The camera distance after one zoom keypress.
     *
     * @param {{distance: number, direction: number, fine?: boolean,
     *          minDistance?: number, maxDistance?: number}} o
     *        direction: +1 to zoom in (closer), -1 to zoom out
     * @returns {number|null} New distance, or null when it would not move
     */
    function dollyStep(o) {
        const opts = o || {};
        const distance = Number(opts.distance) || 0;
        const direction = Number(opts.direction) || 0;
        if (!(distance > 0) || !direction) return null;

        const step = opts.fine ? DOLLY_STEP_FINE : DOLLY_STEP;
        let next = direction > 0 ? distance * step : distance / step;

        const min = Number(opts.minDistance);
        const max = Number(opts.maxDistance);
        if (isFinite(min) && min > 0) next = Math.max(next, min);
        if (isFinite(max) && max > 0) next = Math.min(next, max);

        // Already against a clamp — report "no move" so the caller can leave
        // the camera untouched rather than rewrite an identical value.
        if (Math.abs(next - distance) < 1e-6) return null;
        return next;
    }

    /** Fraction of the visible frame one pan press travels. */
    const PAN_FRACTION = 0.06;
    const PAN_FRACTION_FINE = 0.02;

    /**
     * World distance one pan press should travel.
     *
     * Pan MUST scale with camera distance, for the same reason zoom must be
     * multiplicative: a fixed number of world units is a huge jump when the
     * camera is close to the face and an imperceptible nudge when it is backed
     * off to see the whole body. Expressing the step as a fraction of the
     * VISIBLE FRAME makes one press feel identical at every zoom level.
     *
     * The visible height at distance d is 2 * d * tan(vFov / 2) — the same
     * relation fitDistance inverts, and the same one OrbitControls uses in its
     * own panUp/panLeft.
     *
     * @param {{distance: number, fovDeg: number, fine?: boolean, fraction?: number}} o
     * @returns {number} World units; 0 when the inputs are unusable
     */
    function panStep(o) {
        const opts = o || {};
        const distance = Number(opts.distance) || 0;
        const fovDeg = Number(opts.fovDeg) || 0;
        if (!(distance > 0) || !(fovDeg > 0)) return 0;
        const fraction = opts.fraction == null ? (opts.fine ? PAN_FRACTION_FINE : PAN_FRACTION) : Number(opts.fraction);
        if (!(fraction > 0)) return 0;
        const visibleHeight = 2 * distance * Math.tan((fovDeg * DEG2RAD) / 2);
        return visibleHeight * fraction;
    }

    return {
        fitDistance,
        composition,
        dollyStep,
        panStep,
        HEADROOM_BIAS,
        DOLLY_STEP,
        DOLLY_STEP_FINE,
        PAN_FRACTION,
        PAN_FRACTION_FINE,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_CAMERA_FRAMING = CameraFraming;
if (typeof module !== 'undefined' && module.exports) module.exports = CameraFraming;
