'use strict';

/**
 * CameraKeyboard — keyboard camera control for the character viewport.
 * ====================================================================
 *
 * The mouse already orbits, dollies and pans through OrbitControls. This adds
 * the keyboard half, following the conventions people already have in their
 * fingers:
 *
 *   + / =   zoom in          Blender's numpad +/-, and every browser, map and
 *   - / _   zoom out         image viewer ever shipped
 *   Shift   precise          Blender / Photoshop modifier convention
 *   1 2 3   full / bust / face
 *   0       reset the view
 *   ← →     orbit around her — the MMO inspect-screen turn
 *   ↑ ↓     orbit up / down
 *   Shift + arrow   slide the frame without rotating it
 *
 * Orbit and pan answer different questions. Orbit is "show me the other side of
 * that skirt"; pan is "I am zoomed in on the boots and they are not centred".
 * Reaching an off-centre detail by orbiting costs you the angle you chose, so
 * both are needed. Neither touches the avatar's own transform — the camera
 * moves, the character never does.
 *
 * The digits are the important ones. Character creators — Genshin, Honkai Star
 * Rail, FF14, Black Desert — all give discrete body / upper / face framings
 * rather than making you hunt with free zoom, because "let me look at her face"
 * is a destination, not a distance. CameraPresets already computes exactly
 * those three, eased and FOV-correct; they were simply unreachable without
 * calling into it from code.
 *
 * Deliberately NOT bound:
 *
 *   W / S           the Unity / Unreal flythrough, but those require holding
 *                   right-mouse to enter camera mode first. A bare letter key
 *                   one tab away from a chat box is a trap.
 *   Ctrl/Cmd +/-    the browser's own page zoom. Intercepting it breaks
 *                   accessibility, so every handler here bails on a modifier.
 *   ← / →           released to Pose Studio, but ONLY while its panel is open
 *                   and only that pair — it never claims ↑ / ↓, and orbiting
 *                   while posing is useful, so the vertical arrows keep working.
 *
 * Additive module: registers one listener and calls the existing public APIs.
 * It modifies no existing code, and removing the script tag removes the
 * feature entirely.
 *
 * @module CameraKeyboard
 */

(function () {
    'use strict';

    /** Preset transition length. Long enough to read, short enough to feel instant. */
    const PRESET_MS = 420;

    /** Digit → CameraPresets name, ordered by increasing closeness. */
    const PRESET_KEYS = { 1: 'fullBody', 2: 'bust', 3: 'face' };

    /** Radians of orbit per arrow press — about 3°, so a held key sweeps smoothly. */
    const PITCH_STEP = 0.05;
    const YAW_STEP = 0.05;

    function _viewer() {
        return typeof window !== 'undefined' ? window.NEXUS_VIEWER : null;
    }

    /** True while the user is typing — the chat box is the usual focus here. */
    function _isTyping(target) {
        if (!target) return false;
        const tag = String(target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || !!target.isContentEditable;
    }

    /** Pose Studio owns the HORIZONTAL arrows while its panel is open. */
    function _poseStudioOpen() {
        if (typeof document === 'undefined') return false;
        const el = document.getElementById('poseStudioRoot');
        return !!el && !el.classList.contains('hidden');
    }

    /** Someone who asked for less motion gets the destination, not the journey. */
    function _reducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_e) {
            return false;
        }
    }

    /**
     * Move the camera along its current view direction.
     *
     * The orbit angle and controls.target are untouched — only the distance
     * changes — so zooming never costs the user the angle they had chosen.
     *
     * @param {number} direction +1 closer, -1 further
     * @param {boolean} fine
     */
    function dolly(direction, fine) {
        const v = _viewer();
        const framing = typeof window !== 'undefined' ? window.NEXUS_CAMERA_FRAMING : null;
        const THREE = typeof window !== 'undefined' ? window.THREE : null;
        if (!v || !v.camera || !v.controls || !framing || !THREE) return false;

        const target = v.controls.target;
        const dir = new THREE.Vector3().subVectors(v.camera.position, target);
        const distance = dir.length();
        if (distance < 1e-6) return false;

        const next = framing.dollyStep({
            distance: distance,
            direction: direction,
            fine: fine,
            minDistance: v.controls.minDistance,
            maxDistance: v.controls.maxDistance,
        });
        if (next == null) return false;

        v.camera.position.copy(target).addScaledVector(dir.normalize(), next);
        v.controls.update();
        return true;
    }

    /**
     * Orbit up or down around the target, clamped short of the poles so the
     * view never flips over.
     *
     * @param {number} sign +1 up, -1 down
     */
    function orbitPitch(sign) {
        const v = _viewer();
        const THREE = typeof window !== 'undefined' ? window.THREE : null;
        if (!v || !v.camera || !v.controls || !THREE) return false;

        const offset = new THREE.Vector3().subVectors(v.camera.position, v.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        const min = typeof v.controls.minPolarAngle === 'number' ? v.controls.minPolarAngle : 0;
        const max = typeof v.controls.maxPolarAngle === 'number' ? v.controls.maxPolarAngle : Math.PI;
        // Stay off the poles: at phi exactly 0 or π the azimuth is undefined and
        // the next mouse orbit snaps.
        const lo = Math.max(min, 0.01);
        const hi = Math.min(max, Math.PI - 0.01);
        const next = Math.min(hi, Math.max(lo, spherical.phi - sign * PITCH_STEP));
        if (Math.abs(next - spherical.phi) < 1e-6) return false;

        spherical.phi = next;
        v.camera.position.copy(v.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        v.camera.lookAt(v.controls.target);
        v.controls.update();
        return true;
    }

    /**
     * Orbit left or right around the character — the MMO inspect-screen turn.
     *
     * The character is not touched. This walks the CAMERA around the target's
     * vertical axis, exactly what dragging horizontally with the mouse does, so
     * you can bring the back of a skirt into view without the avatar moving in
     * world space.
     *
     * @param {number} sign +1 left, -1 right
     */
    function orbitYaw(sign) {
        const v = _viewer();
        const THREE = typeof window !== 'undefined' ? window.THREE : null;
        if (!v || !v.camera || !v.controls || !THREE) return false;

        const offset = new THREE.Vector3().subVectors(v.camera.position, v.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += sign * YAW_STEP;
        v.camera.position.copy(v.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        v.camera.lookAt(v.controls.target);
        v.controls.update();
        return true;
    }

    /**
     * Slide the view sideways or vertically without rotating it.
     *
     * This is what you want once you are zoomed in on a detail: the hem of a
     * skirt or the top of a boot is rarely dead centre, and orbiting to reach
     * it changes the angle you had chosen. Panning keeps the angle and moves
     * the frame.
     *
     * Both the camera AND controls.target move by the same vector, so the orbit
     * pivot travels with the view — pan then orbit spins around what you are
     * now looking at, not around where the character happens to stand. Nothing
     * about the avatar's own transform is touched.
     *
     * @param {number} dx -1 left, +1 right (screen space)
     * @param {number} dy -1 down, +1 up (screen space)
     * @param {boolean} fine
     */
    function panView(dx, dy, fine) {
        const v = _viewer();
        const framing = typeof window !== 'undefined' ? window.NEXUS_CAMERA_FRAMING : null;
        const THREE = typeof window !== 'undefined' ? window.THREE : null;
        if (!v || !v.camera || !v.controls || !framing || !THREE) return false;
        if (v.controls.enablePan === false) return false;

        const distance = v.camera.position.distanceTo(v.controls.target);
        const step = framing.panStep({ distance: distance, fovDeg: v.camera.fov, fine: fine });
        if (!(step > 0)) return false;

        // Screen-space right and up, taken from the camera's own basis so the
        // motion always matches what the key arrow points at, whatever angle
        // the camera has been orbited to.
        const m = v.camera.matrix.elements;
        const right = new THREE.Vector3(m[0], m[1], m[2]).normalize();
        const up = new THREE.Vector3(m[4], m[5], m[6]).normalize();

        const delta = new THREE.Vector3().addScaledVector(right, dx * step).addScaledVector(up, dy * step);
        if (delta.lengthSq() < 1e-12) return false;

        v.camera.position.add(delta);
        v.controls.target.add(delta);
        v.controls.update();
        return true;
    }

    /**
     * Jump to one of the three character-creator framings.
     *
     * @param {string} preset 'fullBody' | 'bust' | 'face'
     */
    function preset(name) {
        const presets = typeof window !== 'undefined' ? window.NEXUS_CAMERA_PRESETS : null;
        if (!presets || typeof presets.transitionTo !== 'function') return false;
        // transitionTo REJECTS when the viewer is missing or the preset cannot
        // be computed (no avatar yet), so the rejection must be swallowed or it
        // surfaces as an unhandled promise rejection in the console.
        try {
            const p = presets.transitionTo(name, _reducedMotion() ? 1 : PRESET_MS);
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_e) {
            return false;
        }
        return true;
    }

    /** Back to the on-load framing. */
    function resetView() {
        const v = _viewer();
        if (!v) return false;
        const root = v.avatarManager && v.avatarManager.currentRoot;
        if (root && typeof v.frameObject === 'function') {
            v.frameObject(root, 1.35);
            return true;
        }
        if (typeof v.resetCamera === 'function') {
            v.resetCamera();
            return true;
        }
        return false;
    }

    /**
     * Route one keydown. Exposed so the mapping is testable without a DOM.
     *
     * @param {{key: string, code?: string, shiftKey?: boolean, ctrlKey?: boolean,
     *          metaKey?: boolean, altKey?: boolean, target?: Object}} e
     * @returns {string|null} The action taken, or null when the key was ignored
     */
    function routeKey(e) {
        if (!e) return null;
        // A modifier means the chord belongs to the browser or the OS —
        // Ctrl/Cmd +/- is page zoom, and taking it breaks accessibility.
        if (e.ctrlKey || e.metaKey || e.altKey) return null;
        if (_isTyping(e.target)) return null;

        const key = e.key;
        const code = e.code;

        if (key === '+' || key === '=' || code === 'NumpadAdd') return 'zoom_in';
        if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'zoom_out';
        if (PRESET_KEYS[key]) return 'preset:' + PRESET_KEYS[key];
        if (key === '0') return 'reset';

        // Arrows: orbit around her, or with Shift slide the frame.
        //
        // Pose Studio binds ArrowLeft / ArrowRight for pose navigation while
        // its panel is open, so those two are released to it — but ONLY those
        // two. It never claims the vertical pair, and being able to orbit while
        // posing is useful, so ArrowUp / ArrowDown keep working throughout.
        const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
        const vertical = key === 'ArrowUp' || key === 'ArrowDown';
        if (!horizontal && !vertical) return null;
        if (horizontal && _poseStudioOpen()) return null;

        if (e.shiftKey) {
            if (key === 'ArrowLeft') return 'pan_left';
            if (key === 'ArrowRight') return 'pan_right';
            return key === 'ArrowUp' ? 'pan_up' : 'pan_down';
        }
        if (key === 'ArrowLeft') return 'yaw_left';
        if (key === 'ArrowRight') return 'yaw_right';
        return key === 'ArrowUp' ? 'pitch_up' : 'pitch_down';
    }

    /** Perform a routed action. @returns {boolean} whether the camera moved */
    function runAction(action, shift) {
        if (!action) return false;
        if (action === 'zoom_in') return dolly(1, !!shift);
        if (action === 'zoom_out') return dolly(-1, !!shift);
        if (action === 'reset') return resetView();
        if (action === 'pitch_up') return orbitPitch(1);
        if (action === 'pitch_down') return orbitPitch(-1);
        if (action === 'yaw_left') return orbitYaw(1);
        if (action === 'yaw_right') return orbitYaw(-1);
        // Shift is "precise" everywhere it appears, so a Shift-pan is a smaller
        // slide, the same way a Shift-zoom is a smaller step.
        if (action === 'pan_left') return panView(-1, 0, !!shift);
        if (action === 'pan_right') return panView(1, 0, !!shift);
        if (action === 'pan_up') return panView(0, 1, !!shift);
        if (action === 'pan_down') return panView(0, -1, !!shift);
        if (action.indexOf('preset:') === 0) return preset(action.slice(7));
        return false;
    }

    function _onKeyDown(e) {
        const action = routeKey(e);
        if (!action) return;
        // Only swallow the key once it is ours: "-" and digits are ordinary
        // characters, and a page that eats them everywhere is broken.
        if (typeof e.preventDefault === 'function') e.preventDefault();
        runAction(action, e.shiftKey);
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', _onKeyDown);
        window.NEXUS_CAMERA_KEYBOARD = {
            routeKey: routeKey,
            runAction: runAction,
            dolly: dolly,
            orbitPitch: orbitPitch,
            orbitYaw: orbitYaw,
            panView: panView,
            preset: preset,
            resetView: resetView,
            PRESET_KEYS: PRESET_KEYS,
        };
        if (typeof console !== 'undefined') {
            console.log('[CameraKeyboard] Ready — +/- zoom, 1/2/3 framing, 0 reset, arrows orbit, Shift+arrows pan');
        }
    }
})();
