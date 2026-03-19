/**
 * FaceTracker — Webcam face tracking with MediaPipe FaceLandmarker.
 *
 * Implements VRoid Hub–style face tracking:
 *   1. Opens user's webcam (front camera on mobile)
 *   2. Detects 478 facial landmarks + 52 ARKit blend shape scores
 *   3. Maps ARKit blend shapes → VRM expressions in real-time
 *   4. Triggers camera zoom to face on start, zoom-out on stop
 *   5. Pauses BehaviorEngine expressions & LipSync while active
 *
 * Industry standard: uses MediaPipe Vision Tasks (WASM, ~2MB, browser-only).
 * ARKit blend shape mapping follows Apple's ARKit face tracking specification
 * as used by VRoid Hub, VSeeFace, and VMagicMirror.
 *
 * Platform support:
 *   Desktop  — rear/front webcam, 640×480, 30fps detection
 *   Mobile   — front camera (facingMode: 'user'), 480×360, 20fps
 *   VR       — disabled (VR has VRGazeController for HMD tracking)
 *
 * Exposes:
 *   window.NEXUS_FACE_TRACKER = {
 *       start, stop, isActive, independentEyes, setIndependentEyes,
 *       getBlendShapes, getDebugInfo
 *   }
 *
 * @module FaceTracker
 */
(function (global) {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────

    /** Desktop webcam constraints. */
    const DESKTOP_VIDEO = { facingMode: 'user', width: 640, height: 480, frameRate: { ideal: 30 } };

    /** Mobile webcam constraints (lower res for performance). */
    const MOBILE_VIDEO = { facingMode: 'user', width: 480, height: 360, frameRate: { ideal: 30 } };

    /** Detection frame interval — desktop targets 30fps, mobile 20fps. */
    const DESKTOP_DETECT_INTERVAL_MS = 33; // ~30fps
    const MOBILE_DETECT_INTERVAL_MS = 50; // ~20fps

    /** Smoothing lerp factor (0..1). Lower = smoother but more latent. */
    const BLEND_SHAPE_SMOOTHING = 0.4;

    /** Minimum blend shape value to apply (noise gate). */
    const BLEND_SHAPE_EPSILON = 0.01;

    /** Smoothing lerp factor for head rotation (lower = smoother). */
    const HEAD_ROTATION_SMOOTHING = 0.3;

    // ── Blink Pipeline (ported from KalidoKit — industry standard) ──────
    //
    // KalidoKit (https://github.com/yeemachine/kalidokit) is the open-source
    // blendshape solver used by VRoid Hub, Kalidoface 3D, and others.
    //
    // For MediaPipe runtime it uses blinkSettings = [0.35, 0.5]:
    //   low  = 0.35 → scores ≤ 0.35 = eyes fully open (1.0 openness)
    //   high = 0.50 → scores ≥ 0.50 = eyes fully closed (0.0 openness)
    //
    // This is then inverted to a *blink closure* weight (0 = open, 1 = shut)
    // via: blinkWeight = 1 - remap(rawBlink, low, high).
    //
    // Additionally, stabilizeBlink lerps L/R eyes together (95/5 weighting)
    // to smooth asymmetric noise, and mirrors the visible eye when the head
    // is turned past maxRot to prevent false winks from camera occlusion.

    /** Lower bound — blink scores at or below this are "eyes fully open". */
    const BLINK_LOW = 0.35;

    /** Upper bound — blink scores at or above this are "eyes fully closed". */
    const BLINK_HIGH = 0.5;

    /** How much eyeWide counters blink (widens eyes when surprised). */
    const EYE_WIDE_BLINK_REDUCTION = 0.6;

    /** Head yaw (radians) beyond which the occluded eye mirrors the visible one. */
    const BLINK_STABILIZE_MAX_ROT = 0.5;

    /**
     * Clamp a value between min and max.
     */
    function _clamp(val, min, max) {
        return Math.max(Math.min(val, max), min);
    }

    /**
     * Remap val from [min, max] → [0, 1], clamped.
     * Matches KalidoKit's remap() helper.
     */
    function _remap(val, min, max) {
        return (_clamp(val, min, max) - min) / (max - min);
    }

    /**
     * Lerp between a and b.  t=0 → a, t=1 → b.
     */
    function _lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Convert a raw ARKit eyeBlink score (0..1) to a blink *closure* weight
     * (0 = fully open, 1 = fully closed).
     *
     * KalidoKit computes an "eye openness" ratio and remaps it with
     * [low, high] thresholds, then we invert to get closure.
     *
     * With BLINK_LOW=0.35, BLINK_HIGH=0.5:
     *   raw ≤ 0.35  →  closure = 0.0  (eyes wide open)
     *   raw = 0.425  →  closure = 0.5  (half closed)
     *   raw ≥ 0.50  →  closure = 1.0  (fully shut)
     *
     * This tight range means only a deliberate blink registers.
     */
    function _remapBlink(raw) {
        // remap into [0,1] where 0 = closed, 1 = open (KalidoKit convention)
        const openness = _remap(raw, BLINK_LOW, BLINK_HIGH);
        // Invert: we need blink closure weight (0=open, 1=shut) — opposite
        // of KalidoKit's openness.  But note: ARKit eyeBlink is already a
        // "closure" score (high = more closed), so remap gives us:
        //   raw ≤ LOW  → openness 0 → ... wait, that's backwards.
        //
        // ARKit eyeBlink: 0 = open, 1 = closed  (closure score)
        // KalidoKit remap(closure, low, high):
        //   closure ≤ low  → 0   (not blinking)
        //   closure ≥ high → 1   (fully blinking)
        // So remap gives us a normalized closure directly.
        return openness;
    }

    /**
     * Stabilize left/right blink values.
     * Port of KalidoKit's stabilizeBlink():
     *
     * 1. Head rotation compensation: when head is turned past maxRot,
     *    the occluded eye mirrors the visible one (prevents false winks).
     *
     * 2. L/R synchronization: lerps both eyes together with 95/5 weighting
     *    so minor L/R differences are smoothed out, but true winks
     *    (large L/R difference when not both closing/opening) are preserved.
     *
     * @param {number} left  - Left eye blink closure (0..1)
     * @param {number} right - Right eye blink closure (0..1)
     * @param {number} headYaw - Head yaw in radians
     * @returns {{left: number, right: number}}
     */
    function _stabilizeBlink(left, right, headYaw) {
        left = _clamp(left, 0, 1);
        right = _clamp(right, 0, 1);

        const diff = Math.abs(left - right);
        const blinkThresh = 0.8; // KalidoKit's wink threshold
        const isClosing = left < 0.3 && right < 0.3;
        const isOpen = left > 0.6 && right > 0.6;

        // Head rotation compensation
        if (headYaw > BLINK_STABILIZE_MAX_ROT) {
            return { left: right, right };
        }
        if (headYaw < -BLINK_STABILIZE_MAX_ROT) {
            return { left, right: left };
        }

        // L/R synchronization with wink preservation
        // If large diff AND not both closing AND not both open → true wink, keep as-is
        // Otherwise lerp together (95% toward the more-open eye)
        const isWink = diff >= blinkThresh && !isClosing && !isOpen;

        return {
            left: isWink ? left : right > left ? _lerp(right, left, 0.95) : _lerp(right, left, 0.05),
            right: isWink ? right : right > left ? _lerp(right, left, 0.95) : _lerp(right, left, 0.05),
        };
    }

    /** Seconds without face detection before dispatching face-lost event. */
    const FACE_LOST_WARN_SEC = 3;

    /** Seconds without face detection before auto-stopping tracking. */
    const FACE_LOST_STOP_SEC = 10;

    /** Duration (ms) for smooth expression fade-out on stop. */
    const FADE_OUT_DURATION_MS = 500;

    /** MediaPipe Vision CDN path. */
    const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

    /** Model asset URL. */
    const FACE_LANDMARKER_MODEL =
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

    // ── ARKit → VRM Blend Shape Mapping ─────────────────────────────────
    //
    // MediaPipe FaceLandmarker outputs 52 ARKit-compatible blend shape scores.
    // We map these to VRM expression names following the industry standard
    // used by VRoid Hub, VSeeFace, VMagicMirror, and Kalidokit.
    //
    // Composite emotions are derived from multiple ARKit inputs.

    /**
     * Given ARKit blend shape categories array, compute VRM expression weights.
     * @param {Array<{categoryName: string, score: number}>} categories
     * @returns {Object<string, number>} VRM expression name → weight (0..1)
     */
    function _mapARKitToVRM(categories) {
        // Build lookup
        const ark = {};
        for (const cat of categories) {
            ark[cat.categoryName] = cat.score;
        }

        const get = (name) => ark[name] || 0;

        const vrm = {};

        // ── Eyes (exact KalidoKit rigFace pipeline) ─────────────────
        //
        // KalidoKit canonical VRM demo does:
        //   1. Face.solve() → eye.l, eye.r (openness, 0=closed 1=open)
        //   2. rigFace() inverts to closure: `1 - eye.l`
        //   3. Temporal lerp: `lerp(newClosure, prevVRMBlink, 0.5)`
        //   4. stabilizeBlink() syncs L/R
        //   5. Sets single `blink` expression (NOT blinkLeft/blinkRight)
        //
        // Our ARKit eyeBlink is already a closure score, so step 2 is
        // handled by _remapBlink. We output a single `blink` value.
        let blinkL = _remapBlink(get('eyeBlinkLeft'));
        let blinkR = _remapBlink(get('eyeBlinkRight'));

        // eyeWide counters blink (surprised expression opens eyes wider)
        const wideL = get('eyeWideLeft');
        const wideR = get('eyeWideRight');
        blinkL = Math.max(0, blinkL - wideL * EYE_WIDE_BLINK_REDUCTION);
        blinkR = Math.max(0, blinkR - wideR * EYE_WIDE_BLINK_REDUCTION);

        // Stabilize: L/R sync + head rotation compensation
        const headYaw = _currentHeadRotation.yaw || 0;
        const stabilized = _stabilizeBlink(blinkL, blinkR, headYaw);

        // Combined blink (always computed — used in synced mode, or as
        // fallback in independent mode for models without blinkLeft/Right).
        vrm.blink = (stabilized.left + stabilized.right) / 2;

        // Independent L/R values — only consumed when _independentEyes is on.
        // Always emitted so the _applyLoop can switch modes live.
        vrm.blinkLeft = stabilized.left;
        vrm.blinkRight = stabilized.right;

        // Eye gaze via expression weights
        vrm.lookUp = (get('eyeLookUpLeft') + get('eyeLookUpRight')) / 2;
        vrm.lookDown = (get('eyeLookDownLeft') + get('eyeLookDownRight')) / 2;
        vrm.lookLeft = (get('eyeLookOutLeft') + get('eyeLookInRight')) / 2;
        vrm.lookRight = (get('eyeLookInLeft') + get('eyeLookOutRight')) / 2;

        // ── Mouth / Visemes ─────────────────────────────────────────
        vrm.aa = get('jawOpen') * 0.8;
        vrm.oh = Math.min(1.0, (get('mouthFunnel') + get('mouthPucker')) / 2 + get('jawOpen') * 0.2);
        vrm.ih = Math.min(1.0, ((get('mouthSmileLeft') + get('mouthSmileRight')) / 2) * (1 - get('jawOpen')));
        vrm.ee = vrm.ih; // VRM 'ee' is equivalent
        vrm.ou = get('mouthPucker') * 0.9;

        // ── Emotions (composite) ────────────────────────────────────
        vrm.happy = Math.min(1.0, (get('mouthSmileLeft') + get('mouthSmileRight')) / 2);
        vrm.sad = Math.min(
            1.0,
            ((get('mouthFrownLeft') + get('mouthFrownRight')) / 2) * 0.8 +
                ((get('browDownLeft') + get('browDownRight')) / 2) * 0.2
        );
        vrm.angry = Math.min(
            1.0,
            ((get('browDownLeft') + get('browDownRight')) / 2) * 0.6 +
                ((get('mouthFrownLeft') + get('mouthFrownRight')) / 2) * 0.3 +
                get('noseSneerLeft') * 0.1
        );
        vrm.surprised = Math.min(
            1.0,
            ((get('eyeWideLeft') + get('eyeWideRight')) / 2) * 0.5 +
                get('jawOpen') * 0.3 +
                ((get('browOuterUpLeft') + get('browOuterUpRight')) / 2) * 0.2
        );

        // ── Extras (brow/jaw for expressive models) ─────────────────
        vrm.browInnerUp = get('browInnerUp');
        vrm.browDownLeft = get('browDownLeft');
        vrm.browDownRight = get('browDownRight');
        vrm.jawOpen = get('jawOpen');

        return vrm;
    }

    // ── State ───────────────────────────────────────────────────────────

    let _active = false;
    let _initializing = false;
    let _videoEl = null;
    let _stream = null;
    let _faceLandmarker = null;
    let _detectTimer = null;
    let _currentBlendShapes = {};
    let _smoothedBlendShapes = {};
    let _applyRafId = null;
    let _lastDetectTime = 0;
    let _faceDetected = false;
    let _currentHeadRotation = { yaw: 0, pitch: 0, roll: 0 };
    let _smoothedHeadRotation = { yaw: 0, pitch: 0, roll: 0 };
    let _faceLostTime = 0; // performance.now() when face was last lost
    let _faceLostWarned = false;
    let _fadeOutRafId = null;

    /** When true, blinkLeft/blinkRight are set independently (winking).
     *  When false (default), only the combined 'blink' expression is used,
     *  matching VRoid Hub / KalidoKit canonical behavior. */
    let _independentEyes = localStorage.getItem('ft_independent_eyes') === 'true';

    // ── Helpers ─────────────────────────────────────────────────────────

    function _isMobile() {
        return global.NEXUS_VIEWER?.mobileSupport?.isMobile?.() || false;
    }

    function _isVR() {
        return global.NEXUS_VIEWER?.renderer?.xr?.isPresenting || false;
    }

    function _getVRMLoader() {
        return global.NEXUS_VIEWER?.avatarManager?.vrmLoader || global.vrmLoader || null;
    }

    function _getExpressionManager() {
        const loader = _getVRMLoader();
        return loader?.currentVRM?.expressionManager || null;
    }

    // ── MediaPipe Initialization ────────────────────────────────────────

    /**
     * Lazily load MediaPipe FaceLandmarker.
     * Uses the global __MEDIAPIPE_VISION__ if pre-loaded via ESM import,
     * otherwise dynamically imports from CDN.
     */
    async function _initFaceLandmarker() {
        let FaceLandmarker, FilesetResolver;

        // Path 1: pre-loaded via ESM module in index.html
        if (global.__MEDIAPIPE_VISION__) {
            FaceLandmarker = global.__MEDIAPIPE_VISION__.FaceLandmarker;
            FilesetResolver = global.__MEDIAPIPE_VISION__.FilesetResolver;
        } else {
            // Path 2: dynamic import from CDN
            const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
            FaceLandmarker = vision.FaceLandmarker;
            FilesetResolver = vision.FilesetResolver;
        }

        const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN);

        _faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: FACE_LANDMARKER_MODEL,
                delegate: 'GPU',
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
        });

        console.log('[FaceTracker] MediaPipe FaceLandmarker initialized');
    }

    // ── Webcam ──────────────────────────────────────────────────────────

    async function _startWebcam() {
        const constraints = {
            audio: false,
            video: _isMobile() ? MOBILE_VIDEO : DESKTOP_VIDEO,
        };

        _stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Create hidden video element (VRoid Hub style — no preview shown)
        _videoEl = document.createElement('video');
        _videoEl.setAttribute('playsinline', '');
        _videoEl.setAttribute('autoplay', '');
        _videoEl.muted = true;
        _videoEl.srcObject = _stream;
        _videoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
        document.body.appendChild(_videoEl);

        await _videoEl.play();
        console.log(`[FaceTracker] Webcam started (${_videoEl.videoWidth}×${_videoEl.videoHeight})`);
    }

    function _stopWebcam() {
        if (_stream) {
            for (const track of _stream.getTracks()) {
                track.stop();
            }
            _stream = null;
        }
        if (_videoEl) {
            _videoEl.pause();
            _videoEl.srcObject = null;
            _videoEl.remove();
            _videoEl = null;
        }
    }

    // ── Head Rotation Extraction ────────────────────────────────────────

    /**
     * Extract yaw/pitch/roll from MediaPipe's 4x4 facial transformation matrix.
     * The matrix is column-major Float32Array(16).
     * We decompose the 3x3 rotation sub-matrix into Euler angles (YXZ order).
     * @param {Float32Array} matrix - 4x4 column-major transformation matrix
     * @returns {{ yaw: number, pitch: number, roll: number }}
     */
    function _extractHeadRotation(matrix) {
        // Column-major: m[col * 4 + row]
        const m00 = matrix[0],
            m01 = matrix[4],
            m02 = matrix[8];
        const m10 = matrix[1],
            m11 = matrix[5],
            m12 = matrix[9];
        const m20 = matrix[2],
            m21 = matrix[6],
            m22 = matrix[10];

        // Euler YXZ decomposition (standard for head tracking)
        const pitch = Math.asin(-Math.max(-1, Math.min(1, m12)));
        let yaw, roll;

        if (Math.abs(m12) < 0.9999) {
            yaw = Math.atan2(m02, m22);
            roll = Math.atan2(m10, m11);
        } else {
            yaw = Math.atan2(-m20, m00);
            roll = 0;
        }

        return { yaw, pitch, roll };
    }

    // ── Detection Loop ──────────────────────────────────────────────────

    function _startDetectionLoop() {
        const intervalMs = _isMobile() ? MOBILE_DETECT_INTERVAL_MS : DESKTOP_DETECT_INTERVAL_MS;

        _detectTimer = setInterval(() => {
            if (!_faceLandmarker || !_videoEl || _videoEl.readyState < 2) return;

            const now = performance.now();
            // Prevent duplicate detections within the same video frame
            if (now - _lastDetectTime < intervalMs * 0.8) return;
            _lastDetectTime = now;

            try {
                const results = _faceLandmarker.detectForVideo(_videoEl, now);

                if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                    if (!_faceDetected) {
                        // Face re-detected — clear loss timers
                        _faceLostTime = 0;
                        _faceLostWarned = false;
                        _dispatchEvent('facetracker-face-found');
                    }
                    _faceDetected = true;
                    _currentBlendShapes = _mapARKitToVRM(results.faceBlendshapes[0].categories);

                    // Extract head rotation from transformation matrix
                    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
                        _currentHeadRotation = _extractHeadRotation(results.facialTransformationMatrixes[0].data);
                    }
                } else {
                    if (_faceDetected) {
                        // Face just lost — start timer
                        _faceLostTime = now;
                    }
                    _faceDetected = false;

                    // Face-loss timeout handling
                    if (_faceLostTime > 0) {
                        const lostSec = (now - _faceLostTime) / 1000;
                        if (lostSec >= FACE_LOST_STOP_SEC) {
                            console.warn('[FaceTracker] Face lost for ' + FACE_LOST_STOP_SEC + 's — auto-stopping');
                            // Defer stop to avoid modifying state inside setInterval callback
                            setTimeout(() => stop(), 0);
                            _dispatchEvent('facetracker-auto-stopped', { reason: 'face_lost_timeout' });
                        } else if (lostSec >= FACE_LOST_WARN_SEC && !_faceLostWarned) {
                            _faceLostWarned = true;
                            _dispatchEvent('facetracker-face-lost');
                        }
                    }
                }
            } catch (err) {
                // Occasionally MediaPipe throws on dropped frames — ignore
                if (err.message && !err.message.includes('Timestamp')) {
                    console.warn('[FaceTracker] Detection error:', err.message);
                }
            }
        }, intervalMs);
    }

    function _stopDetectionLoop() {
        if (_detectTimer) {
            clearInterval(_detectTimer);
            _detectTimer = null;
        }
    }

    // ── Expression Application Loop ─────────────────────────────────────

    /**
     * Per-frame: smooth blend shapes + head rotation and apply to VRM.
     * Runs via rAF for frame-perfect sync with the render loop.
     */
    function _applyLoop() {
        if (!_active) return;

        const em = _getExpressionManager();
        if (em && _faceDetected) {
            // Apply smoothed blend shapes
            for (const [name, targetValue] of Object.entries(_currentBlendShapes)) {
                let smoothed;
                const isBlink = name === 'blink';
                const isIndivBlink = name === 'blinkLeft' || name === 'blinkRight';

                // ── Blink mode routing ────────────────────────────
                //
                // _independentEyes OFF (default, VRoid Hub style):
                //   → Apply combined 'blink', skip blinkLeft/blinkRight
                //
                // _independentEyes ON (winking mode):
                //   → Apply blinkLeft + blinkRight, skip combined 'blink'
                if (!_independentEyes && isIndivBlink) continue;
                if (_independentEyes && isBlink) continue;

                if (isBlink || isIndivBlink) {
                    // ── KalidoKit rigFace temporal lerp ───────────
                    //
                    // lerp(newClosure, currentVRMValue, 0.5)
                    //
                    // Each frame the VRM value moves 50% toward target:
                    //   close: 0→0.5→0.75→0.87→0.94→~1
                    //   open:  1→0.5→0.25→0.12→0.06→~0
                    //
                    // Eyes NEVER stay stuck — they always recover to open.
                    let currentVRM = 0;
                    try {
                        currentVRM = em.getValue(name) || 0;
                    } catch (_) {}
                    smoothed = _lerp(targetValue, currentVRM, 0.5);
                    _smoothedBlendShapes[name] = smoothed;
                } else {
                    // Standard smoothing for all other expressions
                    const prev = _smoothedBlendShapes[name] || 0;
                    smoothed = prev + (targetValue - prev) * BLEND_SHAPE_SMOOTHING;
                    _smoothedBlendShapes[name] = smoothed;
                }

                // Only apply if above noise threshold
                if (smoothed > BLEND_SHAPE_EPSILON || (_smoothedBlendShapes[name] || 0) > BLEND_SHAPE_EPSILON) {
                    try {
                        em.setValue(name, smoothed);
                    } catch (_) {
                        // Expression may not exist on this model — ignore
                    }
                }
            }

            // Smooth and apply head rotation to ProceduralAnimator
            _smoothedHeadRotation.yaw +=
                (_currentHeadRotation.yaw - _smoothedHeadRotation.yaw) * HEAD_ROTATION_SMOOTHING;
            _smoothedHeadRotation.pitch +=
                (_currentHeadRotation.pitch - _smoothedHeadRotation.pitch) * HEAD_ROTATION_SMOOTHING;
            _smoothedHeadRotation.roll +=
                (_currentHeadRotation.roll - _smoothedHeadRotation.roll) * HEAD_ROTATION_SMOOTHING;

            if (global.NEXUS_PROCEDURAL_ANIMATOR?.setFaceTrackingHead) {
                global.NEXUS_PROCEDURAL_ANIMATOR.setFaceTrackingHead(
                    _smoothedHeadRotation.yaw,
                    _smoothedHeadRotation.pitch,
                    _smoothedHeadRotation.roll
                );
            }
        }

        _applyRafId = requestAnimationFrame(_applyLoop);
    }

    function _startApplyLoop() {
        _applyRafId = requestAnimationFrame(_applyLoop);
    }

    function _stopApplyLoop() {
        if (_applyRafId) {
            cancelAnimationFrame(_applyRafId);
            _applyRafId = null;
        }
    }

    // ── Expression Override Management ───────────────────────────────────

    /**
     * Disable AI-driven expressions while face tracking is active.
     * Pauses BehaviorEngine expression output and LipSync visemes.
     */
    function _setExpressionOverride(active) {
        // BehaviorEngine: set override flag
        if (global.NEXUS_BEHAVIOR?.setExpressionOverride) {
            global.NEXUS_BEHAVIOR.setExpressionOverride(active);
        }

        // LipSyncEngine: pause/resume
        if (global.NEXUS_LIP_SYNC?.setPaused) {
            global.NEXUS_LIP_SYNC.setPaused(active);
        }

        // Auto-blink: stop during face tracking to prevent overlap with
        // real-time blink data, restart when tracking stops.
        const loader = _getVRMLoader();
        if (loader) {
            if (active) {
                loader.stopAutoBlink?.();
            } else {
                loader.startAutoBlink?.();
            }
        }

        console.log(`[FaceTracker] Expression override → ${active ? 'ON (face tracking)' : 'OFF (AI-driven)'}`);
    }

    /**
     * Reset all VRM expressions to zero (clean slate).
     */
    function _clearAllExpressions() {
        const em = _getExpressionManager();
        if (!em) return;

        const names = [
            'happy',
            'sad',
            'angry',
            'surprised',
            'neutral',
            'blink',
            'blinkLeft',
            'blinkRight',
            'lookUp',
            'lookDown',
            'lookLeft',
            'lookRight',
            'aa',
            'ee',
            'ih',
            'oh',
            'ou',
            'browInnerUp',
            'browDownLeft',
            'browDownRight',
            'jawOpen',
        ];

        for (const name of names) {
            try {
                em.setValue(name, 0);
            } catch (_) {}
        }
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Start face tracking.
     *
     * Flow:
     *   1. Request webcam permission
     *   2. Initialize MediaPipe FaceLandmarker (lazy, first call only)
     *   3. Disable AI expressions (BehaviorEngine + LipSync)
     *   4. Zoom camera to face (CameraPresets)
     *   5. Begin detection + apply loops
     *
     * @returns {Promise<void>}
     */
    async function start() {
        if (_active || _initializing) {
            console.warn('[FaceTracker] Already active or initializing');
            return;
        }

        // VR: not supported
        if (_isVR()) {
            console.warn('[FaceTracker] Face tracking not available in VR mode');
            _dispatchEvent('facetracker-error', { reason: 'vr_not_supported' });
            return;
        }

        _initializing = true;
        _dispatchEvent('facetracker-initializing');

        try {
            // Step 1: Webcam
            await _startWebcam();
            _dispatchEvent('facetracker-webcam-ready');

            // Step 2: MediaPipe (lazy init — cached after first call)
            if (!_faceLandmarker) {
                await _initFaceLandmarker();
            }
            _dispatchEvent('facetracker-model-ready');

            // Step 3: Disable AI expressions + mouse/touch head follow
            _setExpressionOverride(true);
            if (global.NEXUS_PROCEDURAL_ANIMATOR?.setFaceTrackingActive) {
                global.NEXUS_PROCEDURAL_ANIMATOR.setFaceTrackingActive(true);
            }

            // Step 4: Set quality floor to avoid oscillation during tracking
            if (global.NEXUS_VIEWER?.perfMonitor?.setMinQualityLevel) {
                global.NEXUS_VIEWER.perfMonitor.setMinQualityLevel(2);
            }

            // Step 5: Camera zoom to face
            if (global.NEXUS_CAMERA_PRESETS?.transitionToHead) {
                global.NEXUS_CAMERA_PRESETS.transitionToHead();
            }

            // Step 6: Start loops
            _startDetectionLoop();
            _startApplyLoop();

            _active = true;
            _initializing = false;
            _dispatchEvent('facetracker-started');
            console.log('[FaceTracker] Face tracking started');
        } catch (err) {
            _initializing = false;
            _cleanup();
            _dispatchEvent('facetracker-error', { reason: err.name || 'unknown', message: err.message });

            if (err.name === 'NotAllowedError') {
                console.warn('[FaceTracker] Camera permission denied');
            } else if (err.name === 'NotFoundError') {
                console.warn('[FaceTracker] No camera found');
            } else {
                console.error('[FaceTracker] Failed to start:', err);
            }
            throw err;
        }
    }

    /**
     * Stop face tracking and restore AI-driven animation.
     *
     * Flow:
     *   1. Stop detection + apply loops
     *   2. Release webcam
     *   3. Smooth fade-out of expressions (500ms)
     *   4. Re-enable mouse/touch head follow
     *   5. Re-enable AI expressions (BehaviorEngine + LipSync)
     *   6. Remove quality floor
     *   7. Zoom camera back to full body
     */
    function stop() {
        if (!_active) return;

        _active = false;

        _cleanup();

        // Release head rotation control + re-enable mouse/touch
        if (global.NEXUS_PROCEDURAL_ANIMATOR?.setFaceTrackingHead) {
            global.NEXUS_PROCEDURAL_ANIMATOR.setFaceTrackingHead(null);
        }
        if (global.NEXUS_PROCEDURAL_ANIMATOR?.setFaceTrackingActive) {
            global.NEXUS_PROCEDURAL_ANIMATOR.setFaceTrackingActive(false);
        }

        // Remove quality floor
        if (global.NEXUS_VIEWER?.perfMonitor?.setMinQualityLevel) {
            global.NEXUS_VIEWER.perfMonitor.setMinQualityLevel(0);
        }

        // Smooth fade-out of expressions before handing back to AI
        _fadeOutExpressions(FADE_OUT_DURATION_MS, () => {
            // Re-enable AI-driven expressions after fade completes
            _setExpressionOverride(false);
        });

        // Zoom back to full body
        if (global.NEXUS_CAMERA_PRESETS?.transitionToFullBody) {
            global.NEXUS_CAMERA_PRESETS.transitionToFullBody();
        }

        _dispatchEvent('facetracker-stopped');
        console.log('[FaceTracker] Face tracking stopped');
    }

    /**
     * Smoothly fade all expressions to zero over durationMs.
     * Calls onComplete when done (used to re-enable AI expressions).
     */
    function _fadeOutExpressions(durationMs, onComplete) {
        // Cancel any previous fade
        if (_fadeOutRafId) {
            cancelAnimationFrame(_fadeOutRafId);
            _fadeOutRafId = null;
        }

        const em = _getExpressionManager();
        if (!em || Object.keys(_smoothedBlendShapes).length === 0) {
            _clearAllExpressions();
            if (onComplete) onComplete();
            return;
        }

        // Snapshot current values as starting point
        const startValues = { ..._smoothedBlendShapes };
        const startTime = performance.now();

        function fadeStep() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(1, elapsed / durationMs); // 0..1
            // Ease-out cubic for natural deceleration
            const ease = 1 - Math.pow(1 - t, 3);

            for (const [name, startVal] of Object.entries(startValues)) {
                const val = startVal * (1 - ease);
                try {
                    em.setValue(name, val);
                } catch (_) {}
            }

            if (t < 1) {
                _fadeOutRafId = requestAnimationFrame(fadeStep);
            } else {
                _fadeOutRafId = null;
                _clearAllExpressions();
                if (onComplete) onComplete();
            }
        }

        _fadeOutRafId = requestAnimationFrame(fadeStep);
    }

    /** Internal cleanup (stops loops + webcam, does NOT touch expressions). */
    function _cleanup() {
        _stopDetectionLoop();
        _stopApplyLoop();
        _stopWebcam();
        _faceDetected = false;
        _currentBlendShapes = {};
        // Note: _smoothedBlendShapes kept for fade-out, cleared after fade
        _currentHeadRotation = { yaw: 0, pitch: 0, roll: 0 };
        _smoothedHeadRotation = { yaw: 0, pitch: 0, roll: 0 };
        _faceLostTime = 0;
        _faceLostWarned = false;
    }

    /** Dispatch a custom event on window for UI hooks. */
    function _dispatchEvent(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }

    // ── Expose ──────────────────────────────────────────────────────────

    global.NEXUS_FACE_TRACKER = {
        start,
        stop,
        get isActive() {
            return _active;
        },
        get isInitializing() {
            return _initializing;
        },
        get faceDetected() {
            return _faceDetected;
        },
        getBlendShapes() {
            return { ..._smoothedBlendShapes };
        },
        /** Toggle independent eye blink (true = blinkLeft/blinkRight, false = combined blink). */
        setIndependentEyes(enabled) {
            _independentEyes = !!enabled;
            // When switching modes, clear the now-unused blink expressions
            // so the model doesn't keep stale values from the previous mode.
            const em = _getExpressionManager();
            if (em) {
                try {
                    if (_independentEyes) {
                        em.setValue('blink', 0);
                    } else {
                        em.setValue('blinkLeft', 0);
                        em.setValue('blinkRight', 0);
                    }
                } catch (_) {}
            }
        },
        get independentEyes() {
            return _independentEyes;
        },
        getDebugInfo() {
            return {
                active: _active,
                initializing: _initializing,
                faceDetected: _faceDetected,
                independentEyes: _independentEyes,
                videoSize: _videoEl ? `${_videoEl.videoWidth}x${_videoEl.videoHeight}` : null,
                blendShapeCount: Object.keys(_smoothedBlendShapes).length,
            };
        },
    };

    console.log('[FaceTracker] Module loaded');
})(window);
