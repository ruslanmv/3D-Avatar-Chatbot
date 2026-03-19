/**
 * WorldStateBridge — tracks and syncs VR spatial state with HomePilot.
 *
 * Captures user head/hand positions from WebXR and sends updates
 * to the HomePilot world-state service. Also receives avatar
 * motion plans from the backend.
 *
 * Additive module: does not modify any existing code.
 *
 * @module WorldStateBridge
 */

const WorldStateBridge = (() => {
    'use strict';

    /** @type {string} HomePilot backend base URL */
    let _backendUrl = '';

    /** @type {number} Update interval in ms */
    let _updateIntervalMs = 100;

    /** @type {number|null} Interval timer ID */
    let _intervalId = null;

    /** @type {Object} Latest world state snapshot */
    let _localState = {
        user: {
            position: { x: 0, y: 0, z: 0 },
            head_position: { x: 0, y: 1.6, z: 0 },
            head_rotation_y_deg: 0,
            left_hand: null,
            right_hand: null,
            velocity_mps: 0,
        },
        avatars: {},
        anchors: [],
    };

    /** @type {XRFrame|null} */
    let _lastXRFrame = null;

    /**
     * Initialize the bridge.
     * @param {Object} options
     * @param {string} options.backendUrl - HomePilot backend URL
     * @param {number} [options.updateIntervalMs=100]
     */
    function init(options) {
        _backendUrl = (options.backendUrl || '').replace(/\/$/, '');
        _updateIntervalMs = options.updateIntervalMs || 100;
    }

    /**
     * Start sending world-state updates to the backend.
     */
    function startSync() {
        if (_intervalId) return;
        _intervalId = setInterval(_pushState, _updateIntervalMs);
    }

    /**
     * Stop syncing.
     */
    function stopSync() {
        if (_intervalId) {
            clearInterval(_intervalId);
            _intervalId = null;
        }
    }

    /**
     * Update user state from a WebXR frame.
     * @param {XRFrame} frame
     * @param {XRReferenceSpace} refSpace
     */
    function updateFromXRFrame(frame, refSpace) {
        _lastXRFrame = frame;

        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose) {
            const pos = viewerPose.transform.position;
            _localState.user.position = { x: pos.x, y: pos.y, z: pos.z };
            _localState.user.head_position = { x: pos.x, y: pos.y, z: pos.z };

            // Extract Y rotation from orientation quaternion
            const q = viewerPose.transform.orientation;
            const siny = 2 * (q.w * q.y - q.z * q.x);
            _localState.user.head_rotation_y_deg = Math.asin(Math.max(-1, Math.min(1, siny))) * (180 / Math.PI);
        }

        // Hand tracking (if available)
        const inputSources = frame.session.inputSources;
        for (const source of inputSources) {
            if (source.gripSpace) {
                const gripPose = frame.getPose(source.gripSpace, refSpace);
                if (gripPose) {
                    const p = gripPose.transform.position;
                    const handData = { x: p.x, y: p.y, z: p.z };
                    if (source.handedness === 'left') {
                        _localState.user.left_hand = handData;
                    } else if (source.handedness === 'right') {
                        _localState.user.right_hand = handData;
                    }
                }
            }
        }
    }

    /**
     * Update user state from non-XR (desktop/mobile) camera.
     * @param {THREE.Camera} camera
     */
    function updateFromCamera(camera) {
        if (!camera) return;
        _localState.user.position = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
        };
        _localState.user.head_position = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
        };
        _localState.user.head_rotation_y_deg = (camera.rotation.y * 180) / Math.PI;
    }

    /**
     * Set room anchors (seats, surfaces, etc.).
     * @param {Array<{id: string, type: string, position: {x: number, y: number, z: number}}>} anchors
     */
    function setAnchors(anchors) {
        _localState.anchors = anchors;
    }

    /**
     * Update an avatar's local state (after motion execution).
     * @param {string} personaId
     * @param {Object} state
     */
    function updateAvatarState(personaId, state) {
        _localState.avatars[personaId] = {
            ...(_localState.avatars[personaId] || {}),
            ...state,
            updated_at: Date.now() / 1000,
        };
    }

    /**
     * Get the current local state snapshot.
     * @returns {Object}
     */
    function getState() {
        return JSON.parse(JSON.stringify(_localState));
    }

    /**
     * Get user-to-avatar distance.
     * @param {string} personaId
     * @returns {number|null}
     */
    function getUserAvatarDistance(personaId) {
        const avatar = _localState.avatars[personaId];
        if (!avatar || !avatar.position) return null;
        const u = _localState.user.position;
        const a = avatar.position;
        return Math.sqrt((u.x - a.x) ** 2 + (u.y - a.y) ** 2 + (u.z - a.z) ** 2);
    }

    /**
     * Push state to backend (fire-and-forget).
     * @private
     */
    async function _pushState() {
        if (!_backendUrl) return;
        try {
            await fetch(`${_backendUrl}/world-state/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(_localState),
            });
        } catch (_) {
            // Silent fail — best-effort sync
        }
    }

    return {
        init,
        startSync,
        stopSync,
        updateFromXRFrame,
        updateFromCamera,
        setAnchors,
        updateAvatarState,
        getState,
        getUserAvatarDistance,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorldStateBridge;
}
