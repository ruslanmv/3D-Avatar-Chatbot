/**
 * The background manager (batch A4).
 *
 * This is the batch where resources can actually leak, so the tests are written around the two
 * failures that would be invisible in a screenshot and obvious after twenty minutes of use:
 *
 *   1. **A stale load winning.** Click Forest, Beach, Lake quickly and the *arrival* order is the
 *      network's business, not the user's. If the last arrival wins, somebody who ended on Lake
 *      is looking at Forest with no way to describe what went wrong.
 *   2. **A texture freed while it is still on screen.** `dispose()` before the swap frees
 *      something the renderer may sample this frame — a black flash on a good driver, a lost
 *      context on a bad one. Ordering is asserted directly, not implied.
 *
 * Everything is injected, because jsdom has no WebGL. The fake texture records the calls that
 * would be GPU work so the test can assert on them without a GPU.
 */

const Manager = require('../src/gltf-viewer/ambience/ViewportBackgroundManager.js');
const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
const Cover = require('../src/gltf-viewer/ambience/coverTransform.js');

/** Just enough THREE for the manager: a Color, and the constants it reads. */
const THREE_STUB = {
    Color: class Color {
        constructor(hex) {
            this.hex = hex;
            this.isColor = true;
        }
    },
    sRGBEncoding: 3001,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    RepeatWrapping: 1000,
    NearestFilter: 1003,
};

const BG_COLORS = { black: 0x000000, dark: 0x1a1a2e, gray: 0x808080, light: 0xb0b0b0, white: 0xf5f5f5 };

let disposeLog;

function fakeTexture(id, width = 1672, height = 941) {
    return {
        id,
        image: { width, height },
        isTexture: true,
        repeat: {
            x: 1,
            y: 1,
            set(x, y) {
                this.x = x;
                this.y = y;
            },
        },
        offset: {
            x: 0,
            y: 0,
            set(x, y) {
                this.x = x;
                this.y = y;
            },
        },
        disposed: false,
        dispose() {
            this.disposed = true;
            disposeLog.push(this.id);
        },
    };
}

const SCENES = [
    {
        id: 'ambient:ocean:day',
        type: 'image',
        label: 'Ocean',
        src: 'assets/ambient/light/ocean-sunrise.webp',
        focalPoint: 'center',
        intensity: 1,
        category: 'relax',
        tags: ['sea'],
    },
    {
        id: 'ambient:forest:day',
        type: 'image',
        label: 'Forest',
        src: 'assets/ambient/light/forest.webp',
        focalPoint: 'center top',
        intensity: 0.8,
        category: 'nature',
        tags: ['forest'],
    },
    {
        id: 'ambient:lake:day',
        type: 'image',
        label: 'Lake',
        src: 'assets/ambient/light/lake.webp',
        focalPoint: 'center',
        intensity: 1,
        category: 'nature',
        tags: ['lake'],
    },
];

/**
 * A manager wired to fakes. `loader` controls how and when a load settles, which is the whole
 * point — the interesting cases are all about timing.
 */
function rig(options) {
    const opts = options || {};
    const scene = { background: null, backgroundIntensity: 1 };
    const textures = new Map();
    const pending = [];

    const loadTexture =
        opts.loadTexture ||
        ((src) => {
            const texture = fakeTexture(src, opts.imageWidth || 1672, opts.imageHeight || 941);
            textures.set(src, texture);
            if (opts.deferred) {
                return new Promise((resolve, reject) => pending.push({ src, texture, resolve, reject }));
            }
            return Promise.resolve(texture);
        });

    const manager = Manager.attach({
        three: THREE_STUB,
        scene,
        catalog: Catalog,
        cover: Cover,
        colors: BG_COLORS,
        loadTexture,
        getViewportSize: opts.getViewportSize || (() => ({ w: 1920, h: 1080 })),
    });

    return { manager, scene, textures, pending };
}

let warn;

beforeEach(() => {
    disposeLog = [];
    Catalog.reset();
    Catalog.ingest(SCENES);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
});

describe('applying a background', () => {
    test('an image becomes scene.background', async () => {
        const { manager, scene } = rig();
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(true);
        expect(scene.background.isTexture).toBe(true);
        expect(manager.current()).toBe('ambient:ocean:day');
        expect(manager.hasImage()).toBe(true);
    });

    test('a colour becomes a THREE.Color built from BG_COLORS', async () => {
        const { manager, scene } = rig();
        await manager.apply('white');
        expect(scene.background.isColor).toBe(true);
        expect(scene.background.hex).toBe(BG_COLORS.white);
        expect(manager.hasImage()).toBe(false);
    });

    test('every one of the five colours works, unchanged', async () => {
        const { manager, scene } = rig();
        for (const [id, hex] of Object.entries(BG_COLORS)) {
            await manager.apply(id);
            expect(scene.background.hex).toBe(hex);
            expect(manager.current()).toBe(id);
        }
    });

    test('per-scene intensity reaches scene.backgroundIntensity', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:forest:day');
        expect(scene.backgroundIntensity).toBe(0.8);
    });

    test('a later scene does not inherit the previous one intensity', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:forest:day');
        await manager.apply('ambient:ocean:day');
        expect(scene.backgroundIntensity).toBe(1);
    });

    test('switching to a colour resets the intensity', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:forest:day');
        await manager.apply('black');
        expect(scene.backgroundIntensity).toBe(1);
    });

    test('re-selecting what is already showing is a no-op, with no reload', async () => {
        const { manager } = rig();
        await manager.apply('ambient:ocean:day');
        expect(manager.loads).toBe(1);
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(false);
        expect(manager.loads).toBe(1);
    });

    test('it never touches scene.environment or any light', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        // The background is a picture behind the avatar. An LDR photo through PMREM would cost a
        // render target to produce flat, sunless lighting, so avatar illumination is left alone.
        expect('environment' in scene).toBe(false);
    });
});

describe('the texture is configured the way r147 needs', () => {
    test('sRGB, clamped, no mips, linear filtering', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const t = scene.background;
        expect(t.encoding).toBe(THREE_STUB.sRGBEncoding);
        expect(t.wrapS).toBe(THREE_STUB.ClampToEdgeWrapping);
        expect(t.wrapT).toBe(THREE_STUB.ClampToEdgeWrapping);
        expect(t.generateMipmaps).toBe(false);
        expect(t.minFilter).toBe(THREE_STUB.LinearFilter);
        expect(t.needsUpdate).toBe(true);
    });

    test('it is never set to repeat, which would tile instead of crop', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        expect(scene.background.wrapS).not.toBe(THREE_STUB.RepeatWrapping);
    });

    test('mapping is left alone, so three draws a flat quad and not a 360 sky', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        expect(scene.background.mapping).toBeUndefined();
    });

    test('a three without the constants still produces a usable texture', async () => {
        // A stub, an older build, a partial global: configuration must degrade rather than throw.
        const scene = { background: null, backgroundIntensity: 1 };
        const manager = Manager.attach({
            three: { Color: THREE_STUB.Color },
            scene,
            catalog: Catalog,
            cover: Cover,
            colors: BG_COLORS,
            loadTexture: (src) => Promise.resolve(fakeTexture(src)),
            getViewportSize: () => ({ w: 800, h: 600 }),
        });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(true);
        expect(scene.background.generateMipmaps).toBe(false);
    });
});

describe('the cover crop', () => {
    test('it is written onto the texture from the viewport and the focal point', async () => {
        const { manager, scene } = rig({ getViewportSize: () => ({ w: 390, h: 844 }) });
        await manager.apply('ambient:ocean:day');
        const expected = Cover.computeCoverTransform(1672 / 941, 390 / 844, Cover.parseFocalPoint('center'));
        expect(scene.background.repeat.x).toBeCloseTo(expected.repeat.x, 10);
        expect(scene.background.offset.x).toBeCloseTo(expected.offset.x, 10);
    });

    test('the focal point from the entry is honoured', async () => {
        const { manager, scene } = rig({ getViewportSize: () => ({ w: 3440, h: 1440 }) });
        await manager.apply('ambient:forest:day'); // focalPoint: 'center top'
        const top = Cover.computeCoverTransform(1672 / 941, 3440 / 1440, Cover.parseFocalPoint('center top'));
        expect(scene.background.offset.y).toBeCloseTo(top.offset.y, 10);
    });

    test('onResize recomputes without loading or allocating anything', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const texture = scene.background;
        const before = texture.repeat.x;

        expect(manager.onResize(390, 844)).toBe(true);
        expect(scene.background).toBe(texture); // the same object, mutated
        expect(texture.repeat.x).not.toBeCloseTo(before, 6);
        expect(manager.loads).toBe(1);
        expect(disposeLog).toEqual([]);
    });

    test('onResize with a colour showing does nothing', async () => {
        const { manager } = rig();
        await manager.apply('black');
        expect(manager.onResize(390, 844)).toBe(false);
    });

    test('an unmeasurable viewport is skipped rather than producing NaN', async () => {
        const { manager, scene } = rig({ getViewportSize: () => ({ w: 0, h: 0 }) });
        await manager.apply('ambient:ocean:day');
        expect(Number.isFinite(scene.background.repeat.x)).toBe(true);
    });

    test('a getViewportSize that throws does not take the background down', async () => {
        const { manager, scene } = rig({
            getViewportSize: () => {
                throw new Error('detached');
            },
        });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(true);
        expect(scene.background.isTexture).toBe(true);
    });

    test('a texture with no measurable image is applied anyway, uncropped', async () => {
        const { manager, scene } = rig({
            loadTexture: (src) => {
                const t = fakeTexture(src);
                t.image = {};
                return Promise.resolve(t);
            },
        });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(true);
        expect(scene.background.repeat.x).toBe(1);
    });
});

describe('the race — the newest selection always wins', () => {
    test('out-of-order arrivals leave the last click showing', async () => {
        const { manager, scene, pending } = rig({ deferred: true });

        const forest = manager.apply('ambient:forest:day');
        const ocean = manager.apply('ambient:ocean:day');
        const lake = manager.apply('ambient:lake:day');

        // Arrive backwards: the last click resolves first, then the earlier two.
        pending[2].resolve(pending[2].texture);
        pending[1].resolve(pending[1].texture);
        pending[0].resolve(pending[0].texture);
        const [wonForest, wonOcean, wonLake] = await Promise.all([forest, ocean, lake]);

        expect(wonLake).toBe(true);
        expect(wonOcean).toBe(false);
        expect(wonForest).toBe(false);
        expect(manager.current()).toBe('ambient:lake:day');
        expect(scene.background.id).toBe('assets/ambient/light/lake.webp');
    });

    test('the losers dispose their own textures, so nothing leaks', async () => {
        const { manager, pending } = rig({ deferred: true });
        const a = manager.apply('ambient:forest:day');
        const b = manager.apply('ambient:ocean:day');
        const c = manager.apply('ambient:lake:day');
        pending.forEach((p) => p.resolve(p.texture));
        await Promise.all([a, b, c]);

        expect(disposeLog.sort()).toEqual(
            ['assets/ambient/light/forest.webp', 'assets/ambient/light/ocean-sunrise.webp'].sort()
        );
        expect(pending[2].texture.disposed).toBe(false); // the winner stays alive
    });

    test('exactly one texture is alive after twenty switches', async () => {
        const { manager, scene } = rig();
        const ids = ['ambient:ocean:day', 'ambient:forest:day', 'ambient:lake:day'];
        for (let i = 0; i < 20; i += 1) await manager.apply(ids[i % ids.length]);
        // 20 loads, 19 disposals, one survivor: the live background.
        expect(manager.loads).toBe(20);
        expect(disposeLog).toHaveLength(19);
        expect(scene.background.disposed).toBe(false);
    });

    test('a late arrival cannot overwrite a colour chosen afterwards', async () => {
        const { manager, scene, pending } = rig({ deferred: true });
        const image = manager.apply('ambient:ocean:day');
        await manager.apply('black');
        pending[0].resolve(pending[0].texture);
        await expect(image).resolves.toBe(false);
        expect(scene.background.isColor).toBe(true);
    });
});

describe('dispose ordering and cleanup', () => {
    test('the previous texture is freed only after the new one is on screen', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const first = scene.background;

        let sceneWhenDisposed;
        first.dispose = function () {
            this.disposed = true;
            disposeLog.push(this.id);
            sceneWhenDisposed = scene.background; // what is showing at the moment of the free
        };

        await manager.apply('ambient:forest:day');
        expect(sceneWhenDisposed).not.toBe(first);
        expect(sceneWhenDisposed.id).toBe('assets/ambient/light/forest.webp');
    });

    test('image → colour disposes the texture', async () => {
        const { manager } = rig();
        await manager.apply('ambient:ocean:day');
        await manager.apply('gray');
        expect(disposeLog).toEqual(['assets/ambient/light/ocean-sunrise.webp']);
    });

    test('dispose() releases the live texture', async () => {
        const { manager } = rig();
        await manager.apply('ambient:ocean:day');
        manager.dispose();
        expect(disposeLog).toHaveLength(1);
        expect(manager.hasImage()).toBe(false);
    });

    test('a texture that refuses to dispose does not take the swap down', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        scene.background.dispose = () => {
            throw new Error('driver says no');
        };
        await expect(manager.apply('ambient:forest:day')).resolves.toBe(true);
        expect(warn).toHaveBeenCalled();
    });
});

describe('failure keeps what is on screen', () => {
    test('a rejected load changes nothing and warns once', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const showing = scene.background;

        const failing = Manager.attach({
            three: THREE_STUB,
            scene,
            catalog: Catalog,
            cover: Cover,
            colors: BG_COLORS,
            loadTexture: () => Promise.reject(new Error('404')),
            getViewportSize: () => ({ w: 1920, h: 1080 }),
        });
        await expect(failing.apply('ambient:forest:day')).resolves.toBe(false);
        expect(scene.background).toBe(showing);
        expect(showing.disposed).toBe(false);
        expect(warn).toHaveBeenCalled();
    });

    test('a loader resolving nothing is treated as a failure', async () => {
        const { scene } = rig();
        const manager = Manager.attach({
            three: THREE_STUB,
            scene,
            catalog: Catalog,
            cover: Cover,
            colors: BG_COLORS,
            loadTexture: () => Promise.resolve(null),
            getViewportSize: () => ({ w: 800, h: 600 }),
        });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(false);
        expect(manager.hasImage()).toBe(false);
    });

    test('a loader that throws synchronously is caught too', async () => {
        const { scene } = rig();
        const manager = Manager.attach({
            three: THREE_STUB,
            scene,
            catalog: Catalog,
            cover: Cover,
            colors: BG_COLORS,
            loadTexture: () => {
                throw new Error('boom');
            },
            getViewportSize: () => ({ w: 800, h: 600 }),
        });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(false);
    });

    test.each([['nope'], ['ambient:mars:day'], [''], [null], [undefined]])(
        'an unknown id %p leaves the background alone',
        async (id) => {
            const { manager, scene } = rig();
            await manager.apply('ambient:ocean:day');
            const showing = scene.background;
            await expect(manager.apply(id)).resolves.toBe(false);
            expect(scene.background).toBe(showing);
        }
    );

    test('with no loader injected, scenic backgrounds decline and colours still work', async () => {
        // A5 null-guards the manager for exactly this shape: a missing script must degrade to
        // colours-only rather than stopping the app from booting.
        const scene = { background: null, backgroundIntensity: 1 };
        const manager = Manager.attach({ three: THREE_STUB, scene, catalog: Catalog, cover: Cover, colors: BG_COLORS });
        await expect(manager.apply('ambient:ocean:day')).resolves.toBe(false);
        await expect(manager.apply('white')).resolves.toBe(true);
        expect(scene.background.hex).toBe(BG_COLORS.white);
    });

    test('a colour with no scene attached reports no change, but records the selection', async () => {
        // The boolean answers "did the scene change", and A9 decides whether to announce a
        // change from it. Returning true here would have the controller emit an event for a
        // frame nobody saw.
        const manager = Manager.attach({ three: THREE_STUB, catalog: Catalog, colors: BG_COLORS });
        await expect(manager.apply('black')).resolves.toBe(false);
        expect(manager.current()).toBe('black');
    });

    test('a colour the catalogue knows but BG_COLORS does not warns about the drift', async () => {
        const scene = { background: null, backgroundIntensity: 1 };
        const manager = Manager.attach({ three: THREE_STUB, scene, catalog: Catalog, colors: { black: 0x000000 } });
        await expect(manager.apply('white')).resolves.toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no colour value'));
    });

    test('no dependencies at all: every call declines instead of throwing', async () => {
        const bare = Manager.attach();
        await expect(bare.apply('black')).resolves.toBe(false);
        expect(bare.onResize(100, 100)).toBe(false);
        expect(bare.reapplyCurrent()).toBe(false);
        expect(() => bare.dispose()).not.toThrow();
    });
});

describe('reapplyCurrent — what leaving VR calls', () => {
    test('it puts the live texture back with no refetch', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const texture = scene.background;

        // VR entry overwrites the background with a solid colour, behind the manager back.
        scene.background = new THREE_STUB.Color(0x000000);

        expect(manager.reapplyCurrent()).toBe(true);
        expect(scene.background).toBe(texture);
        expect(manager.loads).toBe(1);
        expect(disposeLog).toEqual([]);
    });

    test('it restores the intensity as well as the image', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:forest:day');
        scene.background = new THREE_STUB.Color(0);
        scene.backgroundIntensity = 1;
        manager.reapplyCurrent();
        expect(scene.backgroundIntensity).toBe(0.8);
    });

    test('it recomputes the crop, because the window may have changed in XR', async () => {
        let size = { w: 1920, h: 1080 };
        const { manager, scene } = rig({ getViewportSize: () => size });
        await manager.apply('ambient:ocean:day');
        const wide = scene.background.repeat.x;

        size = { w: 390, h: 844 };
        scene.background = new THREE_STUB.Color(0);
        manager.reapplyCurrent();
        expect(scene.background.repeat.x).not.toBeCloseTo(wide, 6);
    });

    test('with a colour selected it re-applies the colour', async () => {
        const { manager, scene } = rig();
        await manager.apply('dark');
        scene.background = null;
        expect(manager.reapplyCurrent()).toBe(true);
        expect(scene.background.hex).toBe(BG_COLORS.dark);
    });

    test('after dispose it reloads rather than leaving XR black', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        manager.dispose();
        scene.background = new THREE_STUB.Color(0);

        expect(manager.reapplyCurrent()).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(manager.loads).toBe(2);
        expect(scene.background.isTexture).toBe(true);
    });

    test('with nothing ever selected it declines', () => {
        const { manager } = rig();
        expect(manager.reapplyCurrent()).toBe(false);
    });
});

describe('reapplyCurrent(id) — a scene chosen while XR was presenting (A12-1)', () => {
    /**
     * The situation this argument exists for, and the bug it fixes.
     *
     * While a headset session is presenting, `ViewerEngine` records the user's choice in
     * `_desktopBgKey` and deliberately never calls this manager — a flat rectangle must not
     * reach a headset, and in AR it would hide the camera feed. So on exit the manager's own
     * `_id` still points at the scene from *before* the session.
     *
     * The old no-argument `reapplyCurrent()` therefore restored the scene the user had already
     * moved on from, while Settings and `desktop_bg` said the new one. Discovered in A12 by
     * probing rather than by reading, after the first audit pass wrongly recorded this row as
     * passing.
     */
    test('the new selection is applied, not the one the manager remembers', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const beforeXR = scene.background;

        // XR takes the background; the manager is not told about the new choice.
        scene.background = null;

        await manager.reapplyCurrent('ambient:lake:day');
        await Promise.resolve();
        await Promise.resolve();

        expect(manager._id).toBe('ambient:lake:day');
        expect(scene.background).not.toBe(beforeXR);
        expect(scene.background).not.toBeNull();
    });

    test('and the texture the user moved past is freed', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const stale = scene.background;
        scene.background = null;

        await manager.reapplyCurrent('ambient:lake:day');
        await Promise.resolve();
        await Promise.resolve();

        expect(stale.disposed).toBe(true);
    });

    test('an unchanged selection still takes the fast path — no refetch', async () => {
        // The reason the argument is compared rather than always re-applied: leaving VR with
        // nothing changed is the common case, and it must not re-download a texture that is
        // already in memory.
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const live = scene.background;
        const loadsBefore = manager.loads;
        scene.background = null;

        expect(manager.reapplyCurrent('ambient:ocean:day')).toBe(true);
        expect(scene.background).toBe(live);
        expect(manager.loads).toBe(loadsBefore);
    });

    test('omitting the id keeps the old behaviour exactly', async () => {
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        const live = scene.background;
        scene.background = null;

        expect(manager.reapplyCurrent()).toBe(true);
        expect(scene.background).toBe(live);
    });

    test('a colour chosen during XR is applied on exit', async () => {
        // "Take the picture away" is expressible too, and it took the same wrong path.
        const { manager, scene } = rig();
        await manager.apply('ambient:ocean:day');
        scene.background = null;

        manager.reapplyCurrent('black');
        await Promise.resolve();
        await Promise.resolve();

        expect(manager._id).toBe('black');
    });

    test('an id given before anything was ever applied is loaded', async () => {
        // AR forceExit() dispatches its event without restoring anything, so this path can be
        // reached with the manager holding nothing at all.
        const { manager, scene } = rig();
        manager.reapplyCurrent('ambient:ocean:day');
        await Promise.resolve();
        await Promise.resolve();
        expect(scene.background).not.toBeNull();
    });
});

describe('two compositions, one entry (batch A19)', () => {
    /**
     * A plate is composed for one projection. Cropping a 16:9 picture to fill a phone held upright
     * keeps a third of its width and none of its calibration — the horizon moves, and the horizon
     * is the entire contract between the art and the camera. So when a scene ships a portrait
     * composition, a portrait viewport gets it.
     *
     * These entries are ingested locally rather than taken from the shipped catalogue, because the
     * shipped scenes have one picture each and will until a Studio package brings two. That is
     * also why every test here has a one-picture counterpart: the fallback is the common case.
     */
    const TWO = {
        schemaVersion: 1,
        scenes: [
            {
                id: 'ambient:pair:day',
                type: 'image',
                label: 'Pair',
                src: 'assets/ambient/light/open-sky.webp',
                srcPortrait: 'assets/ambient/light/open-sky-portrait.webp',
            },
            {
                id: 'ambient:single:day',
                type: 'image',
                label: 'Single',
                src: 'assets/ambient/light/open-sky.webp',
            },
        ],
    };

    beforeEach(() => {
        Catalog.ingest(TWO, 'a19-test');
    });

    afterEach(() => {
        Catalog.reset();
    });

    test('a landscape viewport gets the wide plate', async () => {
        const { manager, requested } = rigRequests({ w: 1280, h: 720 });
        await manager.apply('ambient:pair:day');
        expect(requested).toEqual(['assets/ambient/light/open-sky.webp']);
    });

    test('a portrait viewport gets the tall one', async () => {
        const { manager, requested } = rigRequests({ w: 390, h: 844 });
        await manager.apply('ambient:pair:day');
        expect(requested).toEqual(['assets/ambient/light/open-sky-portrait.webp']);
    });

    test('an entry with one picture is unchanged in either shape', async () => {
        for (const size of [
            { w: 1280, h: 720 },
            { w: 390, h: 844 },
        ]) {
            const { manager, requested } = rigRequests(size);
            await manager.apply('ambient:single:day');
            expect(requested).toEqual(['assets/ambient/light/open-sky.webp']);
        }
    });

    test('rotating the device swaps the picture rather than re-cropping', async () => {
        // The behaviour a crop cannot give you: turning a phone sideways is not a change of crop,
        // it is a change of which picture is correct.
        let size = { w: 390, h: 844 };
        const { manager, requested } = rigRequests(() => size);
        await manager.apply('ambient:pair:day');
        expect(requested).toEqual(['assets/ambient/light/open-sky-portrait.webp']);

        size = { w: 844, h: 390 };
        manager.onResize(844, 390);
        await flush();
        expect(requested).toEqual([
            'assets/ambient/light/open-sky-portrait.webp',
            'assets/ambient/light/open-sky.webp',
        ]);
    });

    test('a resize that does not change orientation loads nothing', async () => {
        // The common case, and it has to stay free: two vectors written, no allocation, no
        // network. `onResize` runs on every debounced resize.
        let size = { w: 1280, h: 720 };
        const { manager, requested } = rigRequests(() => size);
        await manager.apply('ambient:pair:day');
        size = { w: 1600, h: 900 };
        manager.onResize(1600, 900);
        await flush();
        expect(requested).toHaveLength(1);
    });

    test('rotating an entry with one picture loads nothing either', async () => {
        let size = { w: 1280, h: 720 };
        const { manager, requested } = rigRequests(() => size);
        await manager.apply('ambient:single:day');
        size = { w: 390, h: 844 };
        manager.onResize(390, 844);
        await flush();
        expect(requested).toHaveLength(1);
    });

    test('an unsafe portrait path is dropped and the wide plate is used', async () => {
        // Same door as `src`: the path rule is enforced at ingest, so a catalogue entry can never
        // reach outside this origin whichever field the path arrived in.
        Catalog.ingest(
            {
                schemaVersion: 1,
                scenes: [
                    {
                        id: 'ambient:pair:day',
                        type: 'image',
                        label: 'Pair',
                        src: 'assets/ambient/light/open-sky.webp',
                        srcPortrait: 'https://example.com/elsewhere.webp',
                    },
                ],
            },
            'a19-unsafe'
        );
        const { manager, requested } = rigRequests({ w: 390, h: 844 });
        await manager.apply('ambient:pair:day');
        expect(requested).toEqual(['assets/ambient/light/open-sky.webp']);
    });

    test('with no measurement yet it asks for the wide plate', async () => {
        // Before the canvas has a size. Landscape is what every entry has, and the next resize
        // corrects it — better than failing to draw anything.
        const { manager, requested } = rigRequests(() => null);
        await manager.apply('ambient:pair:day');
        expect(requested).toEqual(['assets/ambient/light/open-sky.webp']);
    });
});

/** A manager that records every source it was asked to load. */
function rigRequests(size) {
    const requested = [];
    const scene = { background: null, backgroundIntensity: 1 };
    const getViewportSize = typeof size === 'function' ? size : () => size;
    const manager = Manager.attach({
        three: THREE_STUB,
        scene,
        catalog: Catalog,
        cover: Cover,
        colors: BG_COLORS,
        loadTexture: (src) => {
            requested.push(src);
            return Promise.resolve(fakeTexture(src, 1672, 941));
        },
        getViewportSize,
    });
    return { manager, scene, requested };
}

/** Let a fire-and-forget reload settle. `onResize` cannot await; the test can. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
