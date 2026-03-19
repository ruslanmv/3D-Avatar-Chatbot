/**
 * FaceTracker Test Suite
 *
 * Tests the face tracking module: ARKit→VRM mapping, lifecycle,
 * expression override integration, and error handling.
 *
 * Since FaceTracker is an IIFE that attaches to window, we load it
 * by evaluating in a prepared global environment with mocks for
 * THREE, MediaPipe, webcam APIs, and VRM.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

// ── Mock browser globals needed by FaceTracker ──────────────────────

global.requestAnimationFrame = jest.fn((cb) => {
    const id = setTimeout(() => cb(performance.now()), 0);
    return id;
});
global.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));
global.performance = global.performance || { now: () => Date.now() };

// Mock CustomEvent
global.CustomEvent = class CustomEvent {
    constructor(type, opts) {
        this.type = type;
        this.detail = opts?.detail || {};
    }
};

// Track dispatched events
const dispatchedEvents = [];
window.dispatchEvent = jest.fn((ev) => {
    dispatchedEvents.push(ev);
});

// Mock navigator.mediaDevices.getUserMedia
const mockStream = {
    getTracks: () => [{ stop: jest.fn() }],
};
global.navigator.mediaDevices = {
    getUserMedia: jest.fn().mockResolvedValue(mockStream),
};

// Mock HTMLVideoElement behavior
const mockVideoEl = {
    setAttribute: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    remove: jest.fn(),
    muted: false,
    srcObject: null,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    style: { cssText: '' },
};
document.createElement = jest.fn((tag) => {
    if (tag === 'video') return { ...mockVideoEl };
    if (tag === 'div')
        return { textContent: '', style: { cssText: '', opacity: '', transition: '' }, remove: jest.fn() };
    if (tag === 'style') return { id: '', textContent: '', remove: jest.fn() };
    return {};
});
document.body.appendChild = jest.fn();
document.head.appendChild = jest.fn();

// Mock THREE (needed by CameraPresets, referenced indirectly)
global.THREE = {
    Vector3: class {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        clone() {
            return new THREE.Vector3(this.x, this.y, this.z);
        }
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        add(v) {
            this.x += v.x;
            this.y += v.y;
            this.z += v.z;
            return this;
        }
        subVectors(a, b) {
            this.x = a.x - b.x;
            this.y = a.y - b.y;
            this.z = a.z - b.z;
            return this;
        }
        normalize() {
            const l = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1;
            this.x /= l;
            this.y /= l;
            this.z /= l;
            return this;
        }
        multiplyScalar(s) {
            this.x *= s;
            this.y *= s;
            this.z *= s;
            return this;
        }
        lerpVectors(a, b, t) {
            this.x = a.x + (b.x - a.x) * t;
            this.y = a.y + (b.y - a.y) * t;
            this.z = a.z + (b.z - a.z) * t;
            return this;
        }
        getWorldPosition(target) {
            target.x = this.x;
            target.y = this.y;
            target.z = this.z;
            return target;
        }
    },
    Box3: class {
        constructor() {
            this.min = new THREE.Vector3(-1, 0, -1);
            this.max = new THREE.Vector3(1, 1.8, 1);
        }
        setFromObject() {
            return this;
        }
        getSize(v) {
            v.set(2, 1.8, 2);
            return v;
        }
        getCenter(v) {
            v.set(0, 0.9, 0);
            return v;
        }
    },
    MathUtils: {
        degToRad: (d) => (d * Math.PI) / 180,
        clamp: (v, min, max) => Math.min(Math.max(v, min), max),
    },
};

// ── Load FaceTracker source ─────────────────────────────────────────

const faceTrackerSrc = fs.readFileSync(path.resolve(__dirname, '../src/FaceTracker.js'), 'utf-8');

// We need to mock the dynamic import for MediaPipe
// Replace the dynamic import with a mock
const modifiedSrc = faceTrackerSrc.replace(
    /const vision = await import\([^)]+\);/,
    `const vision = { FaceLandmarker: global.__MOCK_FACE_LANDMARKER_CLASS__, FilesetResolver: global.__MOCK_FILESET_RESOLVER__ };`
);

// Mock FaceLandmarker
const mockDetectForVideo = jest.fn().mockReturnValue({
    faceBlendshapes: [
        {
            categories: [
                { categoryName: 'eyeBlinkLeft', score: 0.8 },
                { categoryName: 'eyeBlinkRight', score: 0.7 },
                { categoryName: 'mouthSmileLeft', score: 0.6 },
                { categoryName: 'mouthSmileRight', score: 0.5 },
                { categoryName: 'jawOpen', score: 0.3 },
                { categoryName: 'eyeLookUpLeft', score: 0.1 },
                { categoryName: 'eyeLookUpRight', score: 0.15 },
                { categoryName: 'mouthFunnel', score: 0.2 },
                { categoryName: 'mouthPucker', score: 0.1 },
                { categoryName: 'browDownLeft', score: 0.05 },
                { categoryName: 'browDownRight', score: 0.04 },
                { categoryName: 'mouthFrownLeft', score: 0.02 },
                { categoryName: 'mouthFrownRight', score: 0.03 },
                { categoryName: 'eyeWideLeft', score: 0.1 },
                { categoryName: 'eyeWideRight', score: 0.12 },
                { categoryName: 'browOuterUpLeft', score: 0.05 },
                { categoryName: 'browOuterUpRight', score: 0.06 },
                { categoryName: 'noseSneerLeft', score: 0.01 },
                { categoryName: 'browInnerUp', score: 0.07 },
                { categoryName: 'eyeLookDownLeft', score: 0.0 },
                { categoryName: 'eyeLookDownRight', score: 0.0 },
                { categoryName: 'eyeLookOutLeft', score: 0.0 },
                { categoryName: 'eyeLookInRight', score: 0.0 },
                { categoryName: 'eyeLookInLeft', score: 0.0 },
                { categoryName: 'eyeLookOutRight', score: 0.0 },
            ],
        },
    ],
});

global.__MOCK_FACE_LANDMARKER_CLASS__ = {
    createFromOptions: jest.fn().mockResolvedValue({
        detectForVideo: mockDetectForVideo,
    }),
};
global.__MOCK_FILESET_RESOLVER__ = {
    forVisionTasks: jest.fn().mockResolvedValue({}),
};

// Mock NEXUS_VIEWER
const mockExpressionManager = {
    setValue: jest.fn(),
};
global.NEXUS_VIEWER = {
    camera: { position: new THREE.Vector3(0, 1.4, 2.2), aspect: 1.5, fov: 50 },
    controls: { target: new THREE.Vector3(0, 1, 0), update: jest.fn(), enabled: true },
    renderer: { xr: { isPresenting: false } },
    avatarManager: {
        vrmLoader: {
            currentVRM: {
                expressionManager: mockExpressionManager,
                humanoid: {
                    getNormalizedBoneNode: jest.fn().mockReturnValue({
                        getWorldPosition: (v) => {
                            v.set(0, 1.5, 0);
                            return v;
                        },
                    }),
                },
                scene: {},
            },
            setExpression: jest.fn(),
            setEmotion: jest.fn(),
        },
        currentRoot: {
            updateWorldMatrix: jest.fn(),
            traverse: jest.fn(),
        },
    },
    mobileSupport: { isMobile: () => false },
};

// Mock CameraPresets
global.NEXUS_CAMERA_PRESETS = {
    transitionToHead: jest.fn().mockResolvedValue('face'),
    transitionToFullBody: jest.fn().mockResolvedValue('fullBody'),
};

// Mock BehaviorEngine
global.NEXUS_BEHAVIOR = {
    setExpressionOverride: jest.fn(),
};

// Mock LipSync
global.NEXUS_LIP_SYNC = {
    setPaused: jest.fn(),
};

// Load the module
eval(modifiedSrc);

// ── Tests ───────────────────────────────────────────────────────────

describe('FaceTracker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        dispatchedEvents.length = 0;
    });

    afterEach(() => {
        // Ensure stopped
        if (window.NEXUS_FACE_TRACKER?.isActive) {
            window.NEXUS_FACE_TRACKER.stop();
        }
    });

    describe('Module initialization', () => {
        test('should expose NEXUS_FACE_TRACKER on window', () => {
            expect(window.NEXUS_FACE_TRACKER).toBeDefined();
        });

        test('should expose all public API methods', () => {
            const ft = window.NEXUS_FACE_TRACKER;
            expect(typeof ft.start).toBe('function');
            expect(typeof ft.stop).toBe('function');
            expect(typeof ft.getBlendShapes).toBe('function');
            expect(typeof ft.getDebugInfo).toBe('function');
        });

        test('should start inactive', () => {
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(false);
            expect(window.NEXUS_FACE_TRACKER.isInitializing).toBe(false);
        });
    });

    describe('start()', () => {
        test('should request webcam access', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
                expect.objectContaining({ audio: false, video: expect.any(Object) })
            );
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should set active state to true after start', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(true);
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should dispatch facetracker-started event', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            const events = dispatchedEvents.map((e) => e.type);
            expect(events).toContain('facetracker-started');
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should trigger camera zoom to face', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            expect(global.NEXUS_CAMERA_PRESETS.transitionToHead).toHaveBeenCalled();
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should set expression override on BehaviorEngine', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            expect(global.NEXUS_BEHAVIOR.setExpressionOverride).toHaveBeenCalledWith(true);
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should pause LipSyncEngine', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            expect(global.NEXUS_LIP_SYNC.setPaused).toHaveBeenCalledWith(true);
            window.NEXUS_FACE_TRACKER.stop();
        });

        test('should not start if already active', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            const callCount = navigator.mediaDevices.getUserMedia.mock.calls.length;
            await window.NEXUS_FACE_TRACKER.start(); // second call
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(callCount);
            window.NEXUS_FACE_TRACKER.stop();
        });
    });

    describe('stop()', () => {
        test('should set active state to false', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            window.NEXUS_FACE_TRACKER.stop();
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(false);
        });

        test('should dispatch facetracker-stopped event', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            dispatchedEvents.length = 0;
            window.NEXUS_FACE_TRACKER.stop();
            const events = dispatchedEvents.map((e) => e.type);
            expect(events).toContain('facetracker-stopped');
        });

        test('should re-enable BehaviorEngine expressions', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            jest.clearAllMocks();
            window.NEXUS_FACE_TRACKER.stop();
            expect(global.NEXUS_BEHAVIOR.setExpressionOverride).toHaveBeenCalledWith(false);
        });

        test('should resume LipSyncEngine', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            jest.clearAllMocks();
            window.NEXUS_FACE_TRACKER.stop();
            expect(global.NEXUS_LIP_SYNC.setPaused).toHaveBeenCalledWith(false);
        });

        test('should trigger camera zoom back to full body', async () => {
            await window.NEXUS_FACE_TRACKER.start();
            jest.clearAllMocks();
            window.NEXUS_FACE_TRACKER.stop();
            expect(global.NEXUS_CAMERA_PRESETS.transitionToFullBody).toHaveBeenCalled();
        });

        test('should be no-op if not active', () => {
            expect(() => window.NEXUS_FACE_TRACKER.stop()).not.toThrow();
        });
    });

    describe('getDebugInfo()', () => {
        test('should return debug info with correct structure', () => {
            const info = window.NEXUS_FACE_TRACKER.getDebugInfo();
            expect(info).toHaveProperty('active');
            expect(info).toHaveProperty('initializing');
            expect(info).toHaveProperty('faceDetected');
            expect(info).toHaveProperty('videoSize');
            expect(info).toHaveProperty('blendShapeCount');
        });

        test('should report inactive when not tracking', () => {
            const info = window.NEXUS_FACE_TRACKER.getDebugInfo();
            expect(info.active).toBe(false);
        });
    });

    describe('getBlendShapes()', () => {
        test('should return empty object when not tracking', () => {
            const shapes = window.NEXUS_FACE_TRACKER.getBlendShapes();
            expect(shapes).toEqual({});
        });
    });

    describe('VR mode guard', () => {
        test('should not start in VR mode', async () => {
            const origIsPresenting = global.NEXUS_VIEWER.renderer.xr.isPresenting;
            global.NEXUS_VIEWER.renderer.xr.isPresenting = true;
            await window.NEXUS_FACE_TRACKER.start();
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(false);
            global.NEXUS_VIEWER.renderer.xr.isPresenting = origIsPresenting;
        });
    });

    describe('Error handling', () => {
        test('should handle camera permission denied', async () => {
            navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
                Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
            );
            await expect(window.NEXUS_FACE_TRACKER.start()).rejects.toThrow();
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(false);
        });

        test('should handle no camera found', async () => {
            navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
                Object.assign(new Error('No camera'), { name: 'NotFoundError' })
            );
            await expect(window.NEXUS_FACE_TRACKER.start()).rejects.toThrow();
            expect(window.NEXUS_FACE_TRACKER.isActive).toBe(false);
        });

        test('should dispatch facetracker-error on failure', async () => {
            navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
                Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
            );
            try {
                await window.NEXUS_FACE_TRACKER.start();
            } catch (_) {}
            const errorEvents = dispatchedEvents.filter((e) => e.type === 'facetracker-error');
            expect(errorEvents.length).toBeGreaterThan(0);
        });
    });
});
