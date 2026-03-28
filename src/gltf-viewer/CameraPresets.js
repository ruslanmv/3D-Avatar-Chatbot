/**
 * CameraPresets — Smooth animated camera transitions between preset positions.
 *
 * Implements VRoid Hub–style zoom-to-face when face tracking starts,
 * and smooth zoom-out to full-body when tracking stops.
 *
 * Uses requestAnimationFrame lerp with ease-out cubic — no external tween library.
 *
 * Presets:
 *   fullBody — current frameObject() framing (default view)
 *   bust     — chest-height, mid-distance (portrait/conversation framing)
 *   face     — head bone close-up (~0.55m from head, slight upward offset)
 *
 * Platform behavior:
 *   Desktop  — full smooth zoom, OrbitControls re-enabled after transition
 *   Mobile   — same zoom with mobile FOV, touch controls re-enabled
 *   VR       — no-op (user IS the camera in VR)
 *
 * Exposes:
 *   window.NEXUS_CAMERA_PRESETS = {
 *       transitionTo, transitionToHead, transitionToFullBody,
 *       isTransitioning, cancel, getCurrentPreset
 *   }
 *
 * @module CameraPresets
 */
(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────

    /** Default transition duration (ms). */
    const DEFAULT_DURATION_MS = 800;

    /** Mobile transition is shorter for responsiveness. */
    const MOBILE_DURATION_MS = 600;

    /** Face camera padding multiplier (extra margin around portrait box). */
    const FACE_FIT_PADDING = 1.15;

    /** Bust camera distance factor (relative to avatar height). */
    const BUST_DISTANCE_FACTOR = 0.55;

    /** Bust target Y bias (fraction of avatar height above center). */
    const BUST_Y_BIAS = 0.28;

    // ── State ───────────────────────────────────────────────────────────

    let _transitioning = false;
    let _rafId = null;
    let _currentPreset = 'fullBody';
    let _onComplete = null;

    // ── Easing ──────────────────────────────────────────────────────────

    /** Ease-out cubic: fast start, smooth deceleration. */
    function _easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function _getViewer() {
        return typeof window !== 'undefined' && window.NEXUS_VIEWER;
    }

    function _isMobile() {
        const viewer = _getViewer();
        return viewer?.mobileSupport?.isMobile?.() || false;
    }

    function _isVR() {
        const viewer = _getViewer();
        return viewer?.renderer?.xr?.isPresenting || false;
    }

    function _getVRMLoader() {
        const viewer = _getViewer();
        return viewer?.avatarManager?.vrmLoader || window.vrmLoader || null;
    }

    /**
     * Get the world position of the head bone.
     * Falls back to estimating from bounding box for GLB models.
     */
    function _getHeadWorldPosition() {
        const loader = _getVRMLoader();
        if (!loader?.currentVRM) return null;

        const vrm = loader.currentVRM;

        // VRM path: use humanoid bone
        if (vrm.humanoid?.getNormalizedBoneNode) {
            const headBone = vrm.humanoid.getNormalizedBoneNode('head');
            if (headBone) {
                const pos = new THREE.Vector3();
                headBone.getWorldPosition(pos);
                return pos;
            }
        }

        // GLB fallback: estimate from bounding box top
        if (vrm.scene) {
            const box = new THREE.Box3().setFromObject(vrm.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            return new THREE.Vector3(center.x, box.max.y - size.y * 0.08, center.z);
        }

        return null;
    }

    /**
     * Get the avatar bounding box info.
     */
    function _getAvatarBounds() {
        const viewer = _getViewer();
        const root = viewer?.avatarManager?.currentRoot;
        if (!root) return null;

        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        if (!isFinite(box.min.x)) return null;

        return {
            box,
            size: box.getSize(new THREE.Vector3()),
            center: box.getCenter(new THREE.Vector3()),
        };
    }

    // ── Preset Target Computation ───────────────────────────────────────

    /**
     * Compute camera position + target for a given preset.
     * @returns {{ position: THREE.Vector3, target: THREE.Vector3 } | null}
     */
    function _computePresetTarget(preset) {
        const viewer = _getViewer();
        if (!viewer) return null;

        const camera = viewer.camera;
        if (!camera) return null;

        switch (preset) {
            case 'face': {
                // VRoid Hub approach: frame from chest bone to top of model.
                // Adaptive — works for any avatar proportions.
                const loader = _getVRMLoader();
                const vrm = loader?.currentVRM;
                const bounds = _getAvatarBounds();
                if (!bounds) return null;

                // Get chest bone Y (fallback: spine, then 60% of height)
                var chestY = bounds.center.y;
                if (vrm?.humanoid?.getNormalizedBoneNode) {
                    var chestBone =
                        vrm.humanoid.getNormalizedBoneNode('chest') || vrm.humanoid.getNormalizedBoneNode('spine');
                    if (chestBone) {
                        var bonePos = new THREE.Vector3();
                        chestBone.getWorldPosition(bonePos);
                        chestY = bonePos.y;
                    }
                }

                var topY = bounds.box.max.y;
                var portraitHeight = (topY - chestY) * FACE_FIT_PADDING;
                var midY = (chestY + topY) / 2;

                // Distance = height / (2 * tan(FOV/2))
                var vFov = THREE.MathUtils.degToRad(camera.fov);
                var distance = portraitHeight / (2 * Math.tan(vFov / 2));

                var target = new THREE.Vector3(0, midY, bounds.center.z);
                var position = new THREE.Vector3(0, midY, bounds.center.z + distance);

                return { position, target };
            }

            case 'bust': {
                const bounds = _getAvatarBounds();
                if (!bounds) return null;

                const { size, center } = bounds;

                // Target at upper chest
                const target = center.clone();
                target.y += size.y * BUST_Y_BIAS;

                // Distance proportional to avatar height
                const distance = size.y * BUST_DISTANCE_FACTOR;

                const camDir = new THREE.Vector3().subVectors(camera.position, center).normalize();
                camDir.y = 0.06;
                camDir.normalize();

                const position = target.clone().add(camDir.multiplyScalar(distance));

                return { position, target };
            }

            case 'fullBody': {
                // Replicate frameObject logic without actually calling it
                const bounds = _getAvatarBounds();
                if (!bounds) return null;

                const { size, center } = bounds;

                const target = center.clone();
                target.y += size.y * 0.12;

                const aspect = camera.aspect;
                const vFov = THREE.MathUtils.degToRad(camera.fov);
                const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

                const fitOffset = _isMobile() ? 1.4 : 1.35;
                const fitH = size.y / 2 / Math.tan(vFov / 2);
                const fitW = size.x / 2 / Math.tan(hFov / 2);
                let distance = Math.max(fitH, fitW) * fitOffset;

                const maxSize = Math.max(size.x, size.y, size.z);
                const minD = _isMobile()
                    ? THREE.MathUtils.clamp(maxSize * 0.9, 0.5, 1.2)
                    : THREE.MathUtils.clamp(maxSize * 0.9, 0.8, 2.0);
                const maxD = Math.max(6.0, maxSize * 4.0);
                distance = THREE.MathUtils.clamp(distance, minD, maxD);

                const dir = new THREE.Vector3(0, 0.03, 1).normalize();
                const position = target.clone().add(dir.multiplyScalar(distance));

                return { position, target };
            }

            default:
                console.warn('[CameraPresets] Unknown preset:', preset);
                return null;
        }
    }

    // ── Core Transition ─────────────────────────────────────────────────

    /**
     * Smoothly transition the camera to a preset position.
     *
     * @param {string} preset  - 'fullBody' | 'bust' | 'face'
     * @param {number} [durationMs] - Transition duration (auto-detected if omitted)
     * @returns {Promise<string>} Resolves with the preset name when complete
     */
    function transitionTo(preset, durationMs) {
        return new Promise((resolve, reject) => {
            // VR: no-op
            if (_isVR()) {
                console.log('[CameraPresets] Skipping transition in VR mode');
                resolve(preset);
                return;
            }

            const viewer = _getViewer();
            if (!viewer?.camera || !viewer?.controls) {
                reject(new Error('ViewerEngine not available'));
                return;
            }

            const dest = _computePresetTarget(preset);
            if (!dest) {
                reject(new Error('Cannot compute target for preset: ' + preset));
                return;
            }

            // Cancel any running transition
            cancel();

            const duration = durationMs || (_isMobile() ? MOBILE_DURATION_MS : DEFAULT_DURATION_MS);

            // Snapshot start pose
            const startPos = viewer.camera.position.clone();
            const startTarget = viewer.controls.target.clone();
            const endPos = dest.position;
            const endTarget = dest.target;

            // Temporarily disable user controls during transition
            const wasEnabled = viewer.controls.enabled;
            viewer.controls.enabled = false;

            _transitioning = true;
            _onComplete = resolve;

            const startTime = performance.now();

            function _tick(now) {
                const elapsed = now - startTime;
                const rawT = Math.min(elapsed / duration, 1.0);
                const t = _easeOutCubic(rawT);

                // Interpolate position and target
                viewer.camera.position.lerpVectors(startPos, endPos, t);
                viewer.controls.target.lerpVectors(startTarget, endTarget, t);
                viewer.controls.update();

                if (rawT < 1.0) {
                    _rafId = requestAnimationFrame(_tick);
                } else {
                    // Transition complete
                    _transitioning = false;
                    _rafId = null;
                    _currentPreset = preset;
                    viewer.controls.enabled = wasEnabled;
                    viewer.controls.update();

                    console.log(`[CameraPresets] Transition to '${preset}' complete`);
                    if (_onComplete) {
                        _onComplete(preset);
                        _onComplete = null;
                    }
                }
            }

            _rafId = requestAnimationFrame(_tick);
        });
    }

    /** Convenience: zoom to head close-up. */
    function transitionToHead(durationMs) {
        return transitionTo('face', durationMs);
    }

    /** Convenience: zoom out to full-body view. */
    function transitionToFullBody(durationMs) {
        return transitionTo('fullBody', durationMs);
    }

    /** Cancel a running transition. */
    function cancel() {
        if (_rafId) {
            cancelAnimationFrame(_rafId);
            _rafId = null;
        }
        if (_transitioning) {
            _transitioning = false;
            // Re-enable controls
            const viewer = _getViewer();
            if (viewer?.controls) viewer.controls.enabled = true;
            if (_onComplete) {
                _onComplete(_currentPreset);
                _onComplete = null;
            }
        }
    }

    // ── Expose ──────────────────────────────────────────────────────────

    const api = {
        transitionTo,
        transitionToHead,
        transitionToFullBody,
        cancel,
        get isTransitioning() {
            return _transitioning;
        },
        get currentPreset() {
            return _currentPreset;
        },
        // Utility: expose head position for other modules
        getHeadWorldPosition: _getHeadWorldPosition,
    };

    if (typeof window !== 'undefined') {
        window.NEXUS_CAMERA_PRESETS = api;
    }

    console.log('[CameraPresets] Initialized');
})();
