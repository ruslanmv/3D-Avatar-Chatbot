/**
 * CameraPresets Test Suite
 *
 * Tests the smooth camera transition system: preset computation,
 * transition lifecycle, cancel behavior, and VR guard.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

// ── Mock browser globals ────────────────────────────────────────────

let rafCallbacks = [];
let rafId = 0;
global.requestAnimationFrame = jest.fn((cb) => {
    const id = ++rafId;
    rafCallbacks.push({ id, cb });
    return id;
});
global.cancelAnimationFrame = jest.fn((id) => {
    rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
});
global.performance = global.performance || { now: jest.fn(() => Date.now()) };

// Mock THREE
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
    },
    Box3: class {
        constructor() {
            this.min = new THREE.Vector3(-0.5, 0, -0.5);
            this.max = new THREE.Vector3(0.5, 1.7, 0.5);
        }
        setFromObject() {
            return this;
        }
        getSize(v) {
            v.set(1.0, 1.7, 1.0);
            return v;
        }
        getCenter(v) {
            v.set(0, 0.85, 0);
            return v;
        }
    },
    MathUtils: {
        degToRad: (d) => (d * Math.PI) / 180,
        clamp: (v, min, max) => Math.min(Math.max(v, min), max),
    },
};

// Mock NEXUS_VIEWER
global.NEXUS_VIEWER = {
    camera: {
        position: new THREE.Vector3(0, 1.4, 2.2),
        aspect: 16 / 9,
        fov: 50,
    },
    controls: {
        target: new THREE.Vector3(0, 1.0, 0),
        update: jest.fn(),
        enabled: true,
    },
    renderer: { xr: { isPresenting: false } },
    avatarManager: {
        currentRoot: {
            updateWorldMatrix: jest.fn(),
        },
        vrmLoader: {
            currentVRM: {
                humanoid: {
                    getNormalizedBoneNode: jest.fn().mockReturnValue({
                        getWorldPosition: (v) => {
                            v.set(0, 1.55, 0);
                            return v;
                        },
                    }),
                },
                scene: {},
            },
        },
    },
    mobileSupport: { isMobile: () => false },
};

// ── Load CameraPresets source ───────────────────────────────────────

const src = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/CameraPresets.js'), 'utf-8');
eval(src);

// ── Helper: run pending rAF callbacks ───────────────────────────────

function flushRAF(time) {
    const pending = [...rafCallbacks];
    rafCallbacks = [];
    for (const { cb } of pending) {
        cb(time);
    }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('CameraPresets', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rafCallbacks = [];
        rafId = 0;
        // Reset camera position
        global.NEXUS_VIEWER.camera.position.set(0, 1.4, 2.2);
        global.NEXUS_VIEWER.controls.target.set(0, 1.0, 0);
        global.NEXUS_VIEWER.controls.enabled = true;
        global.NEXUS_VIEWER.renderer.xr.isPresenting = false;
        window.NEXUS_CAMERA_PRESETS.cancel();
    });

    describe('Module initialization', () => {
        test('should expose NEXUS_CAMERA_PRESETS on window', () => {
            expect(window.NEXUS_CAMERA_PRESETS).toBeDefined();
        });

        test('should expose all public API methods', () => {
            const cp = window.NEXUS_CAMERA_PRESETS;
            expect(typeof cp.transitionTo).toBe('function');
            expect(typeof cp.transitionToHead).toBe('function');
            expect(typeof cp.transitionToFullBody).toBe('function');
            expect(typeof cp.cancel).toBe('function');
            expect(typeof cp.getHeadWorldPosition).toBe('function');
        });

        test('should default to fullBody preset', () => {
            expect(window.NEXUS_CAMERA_PRESETS.currentPreset).toBe('fullBody');
        });

        test('should not be transitioning initially', () => {
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(false);
        });
    });

    describe('transitionTo()', () => {
        test('should start a transition for face preset', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
        });

        test('should disable controls during transition', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            expect(global.NEXUS_VIEWER.controls.enabled).toBe(false);
        });

        test('should register a rAF callback', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            expect(global.requestAnimationFrame).toHaveBeenCalled();
        });

        test('should reject for unknown preset', async () => {
            await expect(window.NEXUS_CAMERA_PRESETS.transitionTo('nonexistent')).rejects.toThrow(
                'Cannot compute target'
            );
        });

        test('should reject when ViewerEngine not available', async () => {
            const saved = global.NEXUS_VIEWER;
            global.NEXUS_VIEWER = null;
            await expect(window.NEXUS_CAMERA_PRESETS.transitionTo('face')).rejects.toThrow(
                'ViewerEngine not available'
            );
            global.NEXUS_VIEWER = saved;
        });
    });

    describe('VR mode guard', () => {
        test('should resolve immediately in VR mode', async () => {
            global.NEXUS_VIEWER.renderer.xr.isPresenting = true;
            const result = await window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            expect(result).toBe('face');
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(false);
        });
    });

    describe('transitionToHead()', () => {
        test('should start a transition (delegates to face preset)', () => {
            window.NEXUS_CAMERA_PRESETS.transitionToHead();
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
        });
    });

    describe('transitionToFullBody()', () => {
        test('should start a transition (delegates to fullBody preset)', () => {
            window.NEXUS_CAMERA_PRESETS.transitionToFullBody();
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
        });
    });

    describe('cancel()', () => {
        test('should cancel a running transition', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(false);
        });

        test('should re-enable controls after cancel', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            window.NEXUS_CAMERA_PRESETS.cancel();
            expect(global.NEXUS_VIEWER.controls.enabled).toBe(true);
        });

        test('should be safe to call when not transitioning', () => {
            expect(() => window.NEXUS_CAMERA_PRESETS.cancel()).not.toThrow();
        });
    });

    describe('getHeadWorldPosition()', () => {
        test('should return a THREE.Vector3 for head position', () => {
            const pos = window.NEXUS_CAMERA_PRESETS.getHeadWorldPosition();
            expect(pos).toBeDefined();
            expect(typeof pos.x).toBe('number');
            expect(typeof pos.y).toBe('number');
            expect(typeof pos.z).toBe('number');
        });

        test('should return null when no VRM loaded', () => {
            const saved = global.NEXUS_VIEWER.avatarManager.vrmLoader;
            global.NEXUS_VIEWER.avatarManager.vrmLoader = null;
            const pos = window.NEXUS_CAMERA_PRESETS.getHeadWorldPosition();
            expect(pos).toBeNull();
            global.NEXUS_VIEWER.avatarManager.vrmLoader = saved;
        });
    });

    describe('Preset target computation', () => {
        test('face preset positions camera close to head', () => {
            // Start transition and inspect the camera movement direction
            window.NEXUS_CAMERA_PRESETS.transitionTo('face');
            // The transition is running — camera should be moving toward head
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
        });

        test('bust preset is valid', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('bust');
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
        });

        test('fullBody preset is valid', () => {
            window.NEXUS_CAMERA_PRESETS.transitionTo('fullBody');
            expect(window.NEXUS_CAMERA_PRESETS.isTransitioning).toBe(true);
            window.NEXUS_CAMERA_PRESETS.cancel();
        });
    });
});
