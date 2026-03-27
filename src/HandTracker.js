/**
 * HandTracker — Webcam hand/finger tracking with MediaPipe HandLandmarker.
 *
 * Implements VRoid Hub–style hand tracking:
 *   1. Reuses the webcam stream from FaceTracker (shared video element)
 *   2. Detects 21 hand landmarks per hand (up to 2 hands)
 *   3. Solves wrist rotation + 15 finger joint angles per hand
 *   4. Maps to VRM humanoid finger bones in real-time
 *
 * Hand solver implements the same algorithm as KalidoKit Hand.solve():
 *   - Palm orientation → wrist rotation (3 DOF)
 *   - Consecutive landmark triplets → joint flexion angles
 *   - Biomechanical constraints (clamp to human-feasible range)
 *
 * Platform support:
 *   Desktop  — 2 hands, 30fps detection
 *   Mobile   — 2 hands, 15fps detection (reduced for performance)
 *   VR       — disabled (VR has VRControllers for hand input)
 *
 * Exposes:
 *   window.NEXUS_HAND_TRACKER = {
 *       start, stop, isActive, getHandData, getDebugInfo
 *   }
 *
 * @module HandTracker
 */
(function (global) {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────

    const DESKTOP_DETECT_INTERVAL_MS = 33; // ~30fps
    const MOBILE_DETECT_INTERVAL_MS = 66; // ~15fps

    /** Smoothing lerp factor for joint rotations. */
    const JOINT_SMOOTHING = 0.35;

    /** MediaPipe Vision CDN path (same as FaceTracker). */
    const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

    /** Hand Landmarker model asset. */
    const HAND_LANDMARKER_MODEL =
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    // ── MediaPipe Hand Landmark Indices ──────────────────────────────────
    //
    // 0: Wrist
    // 1: Thumb_CMC, 2: Thumb_MCP, 3: Thumb_IP, 4: Thumb_TIP
    // 5: Index_MCP, 6: Index_PIP, 7: Index_DIP, 8: Index_TIP
    // 9: Middle_MCP, 10: Middle_PIP, 11: Middle_DIP, 12: Middle_TIP
    // 13: Ring_MCP, 14: Ring_PIP, 15: Ring_DIP, 16: Ring_TIP
    // 17: Pinky_MCP, 18: Pinky_PIP, 19: Pinky_DIP, 20: Pinky_TIP

    const LM = {
        WRIST: 0,
        THUMB_CMC: 1,
        THUMB_MCP: 2,
        THUMB_IP: 3,
        THUMB_TIP: 4,
        INDEX_MCP: 5,
        INDEX_PIP: 6,
        INDEX_DIP: 7,
        INDEX_TIP: 8,
        MIDDLE_MCP: 9,
        MIDDLE_PIP: 10,
        MIDDLE_DIP: 11,
        MIDDLE_TIP: 12,
        RING_MCP: 13,
        RING_PIP: 14,
        RING_DIP: 15,
        RING_TIP: 16,
        PINKY_MCP: 17,
        PINKY_PIP: 18,
        PINKY_DIP: 19,
        PINKY_TIP: 20,
    };

    // Finger definitions: [proximal, intermediate, distal] landmark triplets
    // Each triplet: [parent, joint, child] — angle is measured at `joint`
    const FINGER_DEFS = {
        Thumb: {
            proximal: [LM.WRIST, LM.THUMB_CMC, LM.THUMB_MCP],
            intermediate: [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP],
            distal: [LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
        },
        Index: {
            proximal: [LM.WRIST, LM.INDEX_MCP, LM.INDEX_PIP],
            intermediate: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP],
            distal: [LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
        },
        Middle: {
            proximal: [LM.WRIST, LM.MIDDLE_MCP, LM.MIDDLE_PIP],
            intermediate: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP],
            distal: [LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
        },
        Ring: {
            proximal: [LM.WRIST, LM.RING_MCP, LM.RING_PIP],
            intermediate: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP],
            distal: [LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
        },
        Little: {
            proximal: [LM.WRIST, LM.PINKY_MCP, LM.PINKY_PIP],
            intermediate: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP],
            distal: [LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
        },
    };

    // Biomechanical constraints (radians) — max flexion per joint type
    const CONSTRAINTS = {
        Thumb: {
            proximal: { min: -0.4, max: 0.8 },
            intermediate: { min: -0.2, max: 1.2 },
            distal: { min: -0.2, max: 1.0 },
        },
        Index: { proximal: { min: -0.3, max: 1.6 }, intermediate: { min: 0, max: 2.0 }, distal: { min: 0, max: 1.4 } },
        Middle: { proximal: { min: -0.3, max: 1.6 }, intermediate: { min: 0, max: 2.0 }, distal: { min: 0, max: 1.4 } },
        Ring: { proximal: { min: -0.3, max: 1.6 }, intermediate: { min: 0, max: 2.0 }, distal: { min: 0, max: 1.4 } },
        Little: { proximal: { min: -0.3, max: 1.6 }, intermediate: { min: 0, max: 2.0 }, distal: { min: 0, max: 1.4 } },
    };

    // ── Math Helpers ─────────────────────────────────────────────────────

    function _clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }
    function _lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /** Angle between three 3D points at the middle point (in radians, 0..PI). */
    function _angleBetween3D(a, b, c) {
        const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
        const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };

        const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
        const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y + ba.z * ba.z);
        const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y + bc.z * bc.z);

        if (magBA < 1e-6 || magBC < 1e-6) return 0;

        const cosAngle = _clamp(dot / (magBA * magBC), -1, 1);
        return Math.acos(cosAngle);
    }

    /** Cross product of two 3D vectors. */
    function _cross(a, b) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x,
        };
    }

    /** Normalize a 3D vector. */
    function _normalize(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (len < 1e-6) return { x: 0, y: 0, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }

    /** Subtract two 3D vectors. */
    function _sub(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    // ── Hand Solver ─────────────────────────────────────────────────────
    //
    // Implements the same algorithm as KalidoKit Hand.solve():
    //   1. Palm orientation → wrist rotation
    //   2. Finger joint angles via consecutive landmark triplets
    //   3. Biomechanical clamping

    /**
     * Solve wrist rotation from palm orientation.
     * Uses landmarks 0 (wrist), 5 (index MCP), 17 (pinky MCP) to define palm plane.
     *
     * @param {Array} lm - 21 hand landmarks [{x,y,z}, ...]
     * @param {string} side - 'Left' or 'Right'
     * @returns {{ x: number, y: number, z: number }} Euler rotation in radians
     */
    function _solveWrist(lm, side) {
        const wrist = lm[LM.WRIST];
        const indexMCP = lm[LM.INDEX_MCP];
        const pinkyMCP = lm[LM.PINKY_MCP];
        const middleMCP = lm[LM.MIDDLE_MCP];

        // Forward direction: wrist → middle finger MCP
        const forward = _normalize(_sub(middleMCP, wrist));

        // Palm normal: cross product of (wrist→index) × (wrist→pinky)
        const toIndex = _sub(indexMCP, wrist);
        const toPinky = _sub(pinkyMCP, wrist);
        const palmNormal = _normalize(_cross(toIndex, toPinky));

        // Compute Euler angles from forward + up vectors
        // Yaw (Y rotation): horizontal direction of forward
        const yaw = Math.atan2(forward.x, forward.z);

        // Pitch (X rotation): vertical tilt
        const pitch = Math.asin(_clamp(-forward.y, -1, 1));

        // Roll (Z rotation): palm twist (using palm normal projected)
        const roll = Math.atan2(palmNormal.x, palmNormal.y);

        // Mirror for right hand
        const mirror = side === 'Right' ? -1 : 1;

        return {
            x: _clamp(pitch, -Math.PI / 2, Math.PI / 2),
            y: _clamp(yaw * mirror, -Math.PI / 2, Math.PI / 2),
            z: _clamp(roll * mirror, -Math.PI / 3, Math.PI / 3),
        };
    }

    /**
     * Solve all finger joint angles for one hand.
     *
     * @param {Array} lm - 21 hand landmarks [{x,y,z}, ...]
     * @param {string} side - 'Left' or 'Right'
     * @returns {Object} VRM bone name → { x, y, z } rotation
     */
    function _solveHand(lm, side) {
        if (!lm || lm.length < 21) return null;

        const result = {};

        // Wrist rotation
        const wristRot = _solveWrist(lm, side);
        result[side.toLowerCase() + 'Hand'] = wristRot;

        // Finger joints
        const sidePrefix = side.toLowerCase();
        const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
        const jointNames = ['Proximal', 'Intermediate', 'Distal'];

        for (const finger of fingerNames) {
            const def = FINGER_DEFS[finger];
            const constraint = CONSTRAINTS[finger];

            for (const joint of jointNames) {
                const jointKey = joint.toLowerCase();
                const triplet = def[jointKey];
                if (!triplet) continue;

                const [a, b, c] = triplet;
                // Angle at the middle point: straight = PI, fully bent = 0
                const rawAngle = _angleBetween3D(lm[a], lm[b], lm[c]);

                // Convert: straight arm (PI) → 0 flexion, fully bent (0) → max flexion
                const flexion = Math.PI - rawAngle;

                // Apply biomechanical constraints
                const clamped = _clamp(flexion, constraint[jointKey].min, constraint[jointKey].max);

                // VRM bone name: e.g., "leftIndexProximal"
                const boneName = sidePrefix + finger + joint;

                // Primary rotation is Z-axis (curl) for fingers, X for thumb
                if (finger === 'Thumb') {
                    result[boneName] = { x: clamped * 0.7, y: 0, z: clamped * 0.3 };
                } else {
                    result[boneName] = { x: 0, y: 0, z: clamped };
                }
            }
        }

        return result;
    }

    // ── State ────────────────────────────────────────────────────────────

    let _active = false;
    let _initializing = false;
    let _handLandmarker = null;
    let _detectTimer = null;
    let _lastDetectTime = 0;
    let _applyRafId = null;

    /** Current solved hand data: { left: {...bones}, right: {...bones} } */
    let _currentHandData = { left: null, right: null };

    /** Smoothed bone rotations for each hand. */
    let _smoothedBones = {};

    /** Whether hands are currently detected. */
    let _handsDetected = { left: false, right: false };

    /** Timestamp when each hand was last seen (for fade-out). */
    let _lastSeenTime = { left: 0, right: 0 };

    /** Fade-out duration when hand is lost (ms). */
    const HAND_LOST_FADE_MS = 500;

    // ── Helpers ──────────────────────────────────────────────────────────

    function _isMobile() {
        return global.NEXUS_VIEWER?.mobileSupport?.isMobile?.() || false;
    }

    function _isVR() {
        return global.NEXUS_VIEWER?.renderer?.xr?.isPresenting || false;
    }

    function _getVideoElement() {
        // Reuse FaceTracker's video element (shared webcam)
        // Try the exposed API first, then fall back to DOM query
        const fromAPI = global.NEXUS_FACE_TRACKER?._getVideoElement?.();
        if (fromAPI) return fromAPI;
        // Fallback: FaceTracker creates a hidden video element
        return document.querySelector('video[data-facetracker]') || null;
    }

    function _getVRMHumanoid() {
        const viewer = global.NEXUS_VIEWER;
        const vrm = viewer?.avatarManager?._currentVRM;
        if (!vrm) return null;
        // VRM 1.0 uses vrm.humanoid, VRM 0.x uses vrm.humanoid.humanBones
        return vrm.humanoid || null;
    }

    /** Get the loaded VRM instance (for expression manager access). */
    function _getVRM() {
        return global.NEXUS_VIEWER?.avatarManager?._currentVRM || null;
    }

    function _dispatchEvent(name, detail) {
        global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }

    // ── MediaPipe Initialization ─────────────────────────────────────────

    async function _initHandLandmarker() {
        let HandLandmarker, FilesetResolver;

        if (global.__MEDIAPIPE_VISION__) {
            HandLandmarker = global.__MEDIAPIPE_VISION__.HandLandmarker;
            FilesetResolver = global.__MEDIAPIPE_VISION__.FilesetResolver;
        } else {
            const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
            HandLandmarker = vision.HandLandmarker;
            FilesetResolver = vision.FilesetResolver;
            global.__MEDIAPIPE_VISION__ = vision;
        }

        // Reuse cached fileset from FaceTracker if available (avoids re-downloading WASM)
        const filesetResolver = global.__MEDIAPIPE_FILESET__ || (await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN));

        _handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: HAND_LANDMARKER_MODEL,
                delegate: 'GPU',
            },
            numHands: 2,
            runningMode: 'VIDEO',
        });

        console.log('[HandTracker] MediaPipe HandLandmarker initialized');
    }

    // ── Detection Loop ───────────────────────────────────────────────────

    function _startDetectionLoop() {
        const intervalMs = _isMobile() ? MOBILE_DETECT_INTERVAL_MS : DESKTOP_DETECT_INTERVAL_MS;

        _detectTimer = setInterval(() => {
            const videoEl = _getVideoElement();
            if (!_handLandmarker || !videoEl || videoEl.readyState < 2) return;

            const now = performance.now();
            if (now - _lastDetectTime < intervalMs * 0.8) return;
            _lastDetectTime = now;

            try {
                const results = _handLandmarker.detectForVideo(videoEl, now);

                // Reset detection state
                const detected = { left: false, right: false };
                const newData = { left: null, right: null };

                if (results.landmarks && results.landmarks.length > 0) {
                    for (let i = 0; i < results.landmarks.length; i++) {
                        const landmarks = results.worldLandmarks?.[i] || results.landmarks[i];
                        const handedness = results.handednesses?.[i]?.[0];

                        if (!handedness || !landmarks) continue;

                        // MediaPipe handedness is from camera's perspective (mirrored)
                        // So "Left" from camera = user's Right hand
                        const isFlipped = global.NEXUS_FACE_TRACKER?.isFlipped?.() || false;
                        let side;
                        if (isFlipped) {
                            side = handedness.categoryName === 'Left' ? 'Left' : 'Right';
                        } else {
                            side = handedness.categoryName === 'Left' ? 'Right' : 'Left';
                        }

                        const solved = _solveHand(landmarks, side);
                        if (solved) {
                            const key = side.toLowerCase();
                            newData[key] = solved;
                            detected[key] = true;
                            _lastSeenTime[key] = now;
                        }
                    }
                }

                _currentHandData = newData;
                _handsDetected = detected;
            } catch (err) {
                if (err.message && !err.message.includes('Timestamp')) {
                    console.warn('[HandTracker] Detection error:', err.message);
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

    // ── Apply Loop (per-frame bone updates) ──────────────────────────────

    function _applyLoop() {
        if (!_active) return;

        const humanoid = _getVRMHumanoid();
        if (humanoid) {
            _applyHandBones(humanoid, 'left');
            _applyHandBones(humanoid, 'right');
        }

        _applyRafId = requestAnimationFrame(_applyLoop);
    }

    /**
     * Apply solved hand bone rotations to VRM humanoid.
     * Includes temporal smoothing and fade-out when hand is lost.
     */
    function _applyHandBones(humanoid, side) {
        const data = _currentHandData[side];
        const now = performance.now();
        const timeSinceLost = now - (_lastSeenTime[side] || 0);

        // Fade multiplier: 1.0 when visible, fades to 0 over HAND_LOST_FADE_MS
        let fadeMul = 1.0;
        if (!_handsDetected[side]) {
            if (timeSinceLost > HAND_LOST_FADE_MS) {
                // Fully faded — clear smoothed state and skip
                _clearHandBones(humanoid, side);
                return;
            }
            fadeMul = 1.0 - timeSinceLost / HAND_LOST_FADE_MS;
        }

        if (!data) return;

        for (const [boneName, targetRot] of Object.entries(data)) {
            // Get the VRM bone node
            const boneNode = _getBoneNode(humanoid, boneName);
            if (!boneNode) continue;

            // Initialize smoothed state
            if (!_smoothedBones[boneName]) {
                _smoothedBones[boneName] = { x: 0, y: 0, z: 0 };
            }

            const smoothed = _smoothedBones[boneName];

            // Temporal smoothing
            smoothed.x = _lerp(smoothed.x, targetRot.x * fadeMul, JOINT_SMOOTHING);
            smoothed.y = _lerp(smoothed.y, targetRot.y * fadeMul, JOINT_SMOOTHING);
            smoothed.z = _lerp(smoothed.z, targetRot.z * fadeMul, JOINT_SMOOTHING);

            // Apply rotation to bone
            // VRM normalized bones expect rotation relative to rest pose
            boneNode.rotation.set(smoothed.x, smoothed.y, smoothed.z);
        }
    }

    function _getBoneNode(humanoid, boneName) {
        if (typeof humanoid.getNormalizedBoneNode === 'function') {
            return humanoid.getNormalizedBoneNode(boneName);
        }
        if (typeof humanoid.getRawBoneNode === 'function') {
            return humanoid.getRawBoneNode(boneName);
        }
        return null;
    }

    /** Clear all bone rotations for one hand (return to rest pose). */
    function _clearHandBones(humanoid, side) {
        const prefix = side.toLowerCase();
        const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
        const jointNames = ['Proximal', 'Intermediate', 'Distal'];

        // Hand bone
        const handBone = _getBoneNode(humanoid, prefix + 'Hand');
        if (handBone) handBone.rotation.set(0, 0, 0);

        // Finger bones
        for (const finger of fingerNames) {
            for (const joint of jointNames) {
                const boneName = prefix + finger + joint;
                const bone = _getBoneNode(humanoid, boneName);
                if (bone) bone.rotation.set(0, 0, 0);
                if (_smoothedBones[boneName]) {
                    _smoothedBones[boneName] = { x: 0, y: 0, z: 0 };
                }
            }
        }
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

    // ── Public API ───────────────────────────────────────────────────────

    async function start() {
        if (_active || _initializing) return;
        if (_isVR()) {
            console.warn('[HandTracker] Hand tracking not available in VR mode — use VR controllers');
            return;
        }

        _initializing = true;
        _dispatchEvent('handtracker-initializing');
        console.log('[HandTracker] Starting hand tracking...');

        try {
            // Wait for webcam video element (may still be initializing)
            let videoEl = _getVideoElement();
            if (!videoEl) {
                console.log('[HandTracker] Waiting for FaceTracker webcam...');
                // Wait up to 5 seconds for FaceTracker to start
                for (let i = 0; i < 50 && !videoEl; i++) {
                    await new Promise(function (r) {
                        setTimeout(r, 100);
                    });
                    videoEl = _getVideoElement();
                }
            }

            if (!videoEl) {
                _initializing = false;
                console.warn('[HandTracker] No webcam available — start FaceTracker first');
                _dispatchEvent('handtracker-error', { reason: 'no_webcam' });
                return;
            }

            // Wait for video to be ready (readyState >= 2 = HAVE_CURRENT_DATA)
            if (videoEl.readyState < 2) {
                console.log('[HandTracker] Waiting for video data...');
                await new Promise(function (resolve) {
                    function check() {
                        if (videoEl.readyState >= 2) {
                            resolve();
                            return;
                        }
                        setTimeout(check, 100);
                    }
                    check();
                });
            }

            if (!_handLandmarker) {
                console.log('[HandTracker] Loading MediaPipe HandLandmarker model...');
                await _initHandLandmarker();
            }

            _startDetectionLoop();
            _startApplyLoop();

            _active = true;
            _initializing = false;
            _dispatchEvent('handtracker-started');
            console.log(
                '[HandTracker] Hand tracking started (' +
                    (_isMobile()
                        ? 'mobile ' + MOBILE_DETECT_INTERVAL_MS + 'ms'
                        : 'desktop ' + DESKTOP_DETECT_INTERVAL_MS + 'ms') +
                    ')'
            );
        } catch (err) {
            _initializing = false;
            console.error('[HandTracker] Failed to start:', err);
            _dispatchEvent('handtracker-error', { reason: err.message });
        }
    }

    function stop() {
        if (!_active) return;

        _active = false;
        _stopDetectionLoop();
        _stopApplyLoop();

        // Return hands to rest pose
        const humanoid = _getVRMHumanoid();
        if (humanoid) {
            _clearHandBones(humanoid, 'left');
            _clearHandBones(humanoid, 'right');
        }

        _currentHandData = { left: null, right: null };
        _smoothedBones = {};
        _dispatchEvent('handtracker-stopped');
        console.log('[HandTracker] Hand tracking stopped');
    }

    // ── Expose ───────────────────────────────────────────────────────────

    global.NEXUS_HAND_TRACKER = {
        start: start,
        stop: stop,
        get isActive() {
            return _active;
        },

        /** Get current solved hand data for external consumers. */
        getHandData: function () {
            return _currentHandData;
        },

        /** Get debug info for overlay. */
        getDebugInfo: function () {
            return {
                active: _active,
                handsDetected: { ..._handsDetected },
                boneCount: Object.keys(_smoothedBones).length,
            };
        },
    };

    console.log('[HandTracker] Initialized');
})(window);
