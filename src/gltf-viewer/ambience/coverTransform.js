/**
 * Making a scenic image behave like `background-size: cover` (batch A1).
 *
 * Three.js draws a `scene.background` texture on a full-viewport NDC quad, which means it
 * **stretches**: a 16:9 photo in a portrait window is squashed, and that is the whole problem
 * this file exists to solve.
 *
 * The way out is a detail of the vendored r147 renderer. `WebGLBackground.render()` copies the
 * texture's own matrix into the background shader's UV transform:
 *
 *     planeMesh.material.uniforms.uvTransform.value.copy( background.matrix );
 *         — vendor/three-0.147.0/build/three.module.js:14008
 *
 * and three composes that matrix from `texture.offset` and `texture.repeat` on every render
 * (because `matrixAutoUpdate` defaults to true). So "show me a sub-rectangle of this image,
 * scaled to fill the viewport" is expressible as two two-component numbers — no custom shader,
 * no extra mesh, no second scene, no second renderer.
 *
 * ## Why it is a pure function in its own file
 *
 * Nothing here touches Three.js, the DOM or WebGL — it takes numbers and returns numbers. That
 * is deliberate: jsdom has no WebGL, so arithmetic kept separate from the renderer is the only
 * part of this feature that can be tested properly, and it is also the part most likely to be
 * quietly wrong. The manager (A4) does the texture work; this does the maths.
 *
 * ## The maths
 *
 *     if image is wider than the viewport → crop left/right, repeat = (view/image, 1)
 *     otherwise                          → crop top/bottom, repeat = (1, image/view)
 *
 * `repeat` is therefore never above 1 on either axis, so the visible window is always a
 * sub-rectangle of the image: cover, never stretch, and never tiled — which is also why the
 * caller must leave the texture on `ClampToEdgeWrapping` rather than `RepeatWrapping`.
 *
 * The vertical offset inverts the focal point because `TextureLoader` sets `flipY = true`, so
 * the image's top row lives at `v = 1`. That inversion is the one line here that looks wrong
 * and is right; the tests pin it from both ends.
 *
 * Exposes: window.NEXUS_AMBIENCE_COVER_TRANSFORM
 */
(function (global) {
    'use strict';

    /** Dead centre, and the answer to every focal point we cannot make sense of. */
    const CENTER = Object.freeze({ x: 0.5, y: 0.5 });

    /** What a caller gets when the inputs are unusable: the whole image, undistorted by us. */
    function identity() {
        return { repeat: { x: 1, y: 1 }, offset: { x: 0, y: 0 } };
    }

    function usableAspect(value) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }

    function clamp01(value) {
        if (!Number.isFinite(value)) return 0.5;
        return value < 0 ? 0 : value > 1 ? 1 : value;
    }

    /**
     * Cover transform for one image in one viewport.
     *
     * @param {number} imageAspect  image width / height
     * @param {number} viewAspect   viewport width / height
     * @param {{x:number,y:number}} [focal] 0..1, x from the LEFT, y from the TOP
     * @returns {{repeat:{x:number,y:number}, offset:{x:number,y:number}}}
     */
    function computeCoverTransform(imageAspect, viewAspect, focal) {
        // A zero-height viewport happens for real: a collapsed panel, a hidden canvas, a phone
        // mid-rotation. Returning the identity shows the image undistorted rather than dividing
        // by zero and handing NaN to the GPU, where it renders as nothing at all.
        if (!usableAspect(imageAspect) || !usableAspect(viewAspect)) {
            return identity();
        }

        const fx = clamp01(focal && typeof focal.x === 'number' ? focal.x : CENTER.x);
        const fy = clamp01(focal && typeof focal.y === 'number' ? focal.y : CENTER.y);

        let rx = 1;
        let ry = 1;
        if (imageAspect > viewAspect) {
            rx = viewAspect / imageAspect; // image is wider: keep its height, crop its sides
        } else {
            ry = imageAspect / viewAspect; // image is narrower: keep its width, crop top/bottom
        }

        return {
            repeat: { x: rx, y: ry },
            offset: {
                x: fx * (1 - rx),
                // flipY: v = 1 is the image's top row, so a focal point measured from the top
                // has to be read from the other end. focal.y = 0 must put the window at v = 1.
                y: (1 - fy) * (1 - ry),
            },
        };
    }

    const HORIZONTAL = { left: 0, right: 1 };
    const VERTICAL = { top: 0, bottom: 1 };
    const PERCENT = /^-?\d+(?:\.\d+)?%$/;

    /**
     * Read a CSS-style `background-position` into focal fractions.
     *
     * Accepts what a content author would reasonably write — `center`, `top`, `center top`,
     * `left bottom`, `45% center`, `30% 70%` — and, like CSS, does not care whether the
     * keywords arrive in x,y order.
     *
     * Anything it cannot make sense of returns centre rather than throwing. A malformed focal
     * point in a catalogue entry should cost a slightly-off crop, not a missing background: the
     * image is still the right image, and a thrown error here would take the whole scene down.
     *
     * @param {string} input
     * @returns {{x:number,y:number}} 0..1, x from the left, y from the top
     */
    function parseFocalPoint(input) {
        if (typeof input !== 'string') return { ...CENTER };
        const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!tokens.length || tokens.length > 2) return { ...CENTER };

        let x = null;
        let y = null;
        const numbers = [];
        let centers = 0;

        for (const token of tokens) {
            if (token in HORIZONTAL) {
                if (x !== null) return { ...CENTER }; // "left right" is not a position
                x = HORIZONTAL[token];
            } else if (token in VERTICAL) {
                if (y !== null) return { ...CENTER };
                y = VERTICAL[token];
            } else if (token === 'center') {
                centers += 1;
            } else if (PERCENT.test(token)) {
                numbers.push(clamp01(parseFloat(token) / 100));
            } else {
                // An unknown word means we are guessing at the author's intent, and a wrong
                // guess is worse than the documented default.
                return { ...CENTER };
            }
        }

        // Percentages fill the axes still open, in CSS order: x first, then y.
        for (const value of numbers) {
            if (x === null) x = value;
            else if (y === null) y = value;
            else return { ...CENTER }; // three values for two axes
        }

        // `center` is axis-agnostic, so it fills whatever is left. One `center` beside one
        // keyword leaves exactly one axis open; a bare `center` leaves both.
        if (centers > 0) {
            if (x === null) x = 0.5;
            else if (y === null) y = 0.5;
            if (centers > 1) {
                if (x === null) x = 0.5;
                if (y === null) y = 0.5;
            }
        }

        return { x: x === null ? 0.5 : x, y: y === null ? 0.5 : y };
    }

    const api = { computeCoverTransform, parseFocalPoint, CENTER };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_AMBIENCE_COVER_TRANSFORM = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
