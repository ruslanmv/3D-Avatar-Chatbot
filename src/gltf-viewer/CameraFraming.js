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

    return { fitDistance, composition, HEADROOM_BIAS };
})();

if (typeof window !== 'undefined') window.NEXUS_CAMERA_FRAMING = CameraFraming;
if (typeof module !== 'undefined' && module.exports) module.exports = CameraFraming;
