/**
 * XL3 — the HomePilot loading card in the headset (src/gltf-viewer/XRSplash.js).
 *
 * Pinned: the card sits DISTANCE ahead at eye height facing back at the person, follows the gaze
 * lazily (never head-locked), keeps its direction when the person looks straight up or down, shows
 * for at least MIN_MS, stays hidden until a real head pose exists, and disposes all it made.
 */

const S = require('../src/gltf-viewer/XRSplash.js');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('where the card goes', () => {
    test('looking down -Z: 1.6 m ahead at eye height, facing back (yaw 0)', () => {
        const p = S.targetPose({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, S.DISTANCE);
        expect(close(p.x, 0)).toBe(true);
        expect(close(p.y, 1.6)).toBe(true);
        expect(close(p.z, -S.DISTANCE)).toBe(true);
        expect(close(p.yaw, 0)).toBe(true);
    });

    test('looking to the right (+X): the card is to the right, facing back', () => {
        const p = S.targetPose({ x: 1, y: 1.5, z: 2 }, { x: 1, y: 0, z: 0 }, 2);
        expect(close(p.x, 3)).toBe(true);
        expect(close(p.z, 2)).toBe(true);
        // A plane's front is +Z; rotated by yaw it must point back along -X, at the head.
        expect(close(Math.sin(p.yaw), -1)).toBe(true);
    });

    test('only the horizontal direction counts — looking down does not sink the card', () => {
        const level = S.targetPose({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, 1.6);
        const down = S.targetPose({ x: 0, y: 1.6, z: 0 }, { x: 0, y: -0.8, z: -0.6 }, 1.6);
        expect(close(down.y, level.y)).toBe(true);
        expect(close(down.z, level.z)).toBe(true);
    });

    test('looking straight up or down keeps the last direction instead of spinning', () => {
        const p = S.targetPose({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1, z: 0 }, 1.6, 1.2);
        expect(close(p.yaw, 1.2)).toBe(true);
    });
});

describe('lazy follow', () => {
    const a = { x: 0, y: 1.6, z: -1.6, yaw: 0 };
    const b = { x: 1.6, y: 1.6, z: 0, yaw: -Math.PI / 2 };

    test('the first pose snaps; after that it eases', () => {
        expect(S.follow(null, b, 0.016)).toEqual(b);
        const step = S.follow(a, b, 0.016);
        expect(step.x).toBeGreaterThan(0);
        expect(step.x).toBeLessThan(0.2);
    });

    test('frame-rate independent: two half steps land where one full step does', () => {
        const one = S.follow(a, b, 0.2);
        const two = S.follow(S.follow(a, b, 0.1), b, 0.1);
        expect(close(one.x, two.x, 1e-9)).toBe(true);
        expect(close(one.yaw, two.yaw, 1e-9)).toBe(true);
    });

    test('catches up with a turned head within about a second and a half', () => {
        let p = a;
        for (let i = 0; i < 90; i++) p = S.follow(p, b, 1 / 60);
        expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeLessThan(0.05);
    });

    test('turns the short way round across ±π', () => {
        expect(close(S.angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2)).toBe(true);
        const p = S.follow({ x: 0, y: 0, z: 0, yaw: 3.1 }, { x: 0, y: 0, z: 0, yaw: -3.1 }, 0.1);
        expect(p.yaw).toBeGreaterThan(3.1); // went up through π, not down through 0
    });
});

describe('how long it stays', () => {
    test('a fast load still shows the card for MIN_MS', () => {
        expect(S.endAt(1000, 1050)).toBe(1000 + S.MIN_MS);
    });

    test('a slow load shows it until she is ready', () => {
        expect(S.endAt(1000, 6000)).toBe(6000);
    });
});

/** Just enough of THREE for create(): objects that remember what was done to them. */
function fakeThree() {
    const disposed = [];
    class Vec {
        constructor(x = 0, y = 0, z = 0) {
            Object.assign(this, { x, y, z });
        }
        set(x, y, z) {
            Object.assign(this, { x, y, z });
            return this;
        }
    }
    class Obj {
        constructor() {
            this.position = new Vec();
            this.rotation = new Vec();
            this.children = [];
            this.visible = true;
        }
        add(c) {
            this.children.push(c);
        }
    }
    const disposable = (name) =>
        class {
            constructor(...args) {
                this.args = args;
            }
            dispose() {
                disposed.push(name);
            }
        };
    const THREE = {
        Scene: class extends Obj {
            remove(c) {
                this.children = this.children.filter((x) => x !== c);
            }
        },
        Group: Obj,
        Color: class {
            constructor(hex) {
                this.hex = hex;
            }
        },
        Vector3: Vec,
        CanvasTexture: disposable('texture'),
        PlaneGeometry: disposable('plane'),
        RingGeometry: disposable('ring'),
        MeshBasicMaterial: disposable('material'),
        Mesh: class extends Obj {
            constructor(geometry, material) {
                super();
                this.geometry = geometry;
                this.material = material;
            }
        },
        DoubleSide: 2,
    };
    return { THREE, disposed };
}

describe('the card itself', () => {
    const camera = (pos, dir) => ({
        getWorldPosition: (v) => v.set(pos.x, pos.y, pos.z),
        getWorldDirection: (v) => v.set(dir.x, dir.y, dir.z),
    });

    test('on the app colour, hidden until a real head pose, then 1.6 m ahead and visible', () => {
        const { THREE } = fakeThree();
        const splash = S.create(THREE, { image: null });
        expect(splash.scene.background.hex).toBe(S.BACKGROUND);
        const group = splash.scene.children[0];
        expect(group.visible).toBe(false);
        splash.update(0.016, camera({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }));
        expect(group.visible).toBe(true);
        expect(close(group.position.y, 1.7)).toBe(true);
        expect(close(group.position.z, -S.DISTANCE)).toBe(true);
    });

    test('repaints when the icon arrives, and lets go of that listener on dispose', () => {
        const { THREE, disposed } = fakeThree();
        const listeners = {};
        const image = {
            complete: false,
            naturalWidth: 0,
            addEventListener: (t, fn) => (listeners[t] = fn),
            removeEventListener: (t, fn) => listeners[t] === fn && delete listeners[t],
        };
        const splash = S.create(THREE, { image });
        expect(typeof listeners.load).toBe('function');
        splash.dispose();
        expect(listeners.load).toBeUndefined();
        expect(splash.scene.children).toHaveLength(0);
        expect(disposed.sort()).toEqual(['material', 'material', 'plane', 'ring', 'texture']);
    });
});
