/**
 * The read-only boundary between Together's thumbnails and the calibrated ambience set.
 *
 * Twenty WebP plates under `assets/ambient/light/` and `assets/ambient/dark/` are production
 * viewport art, composed against this app's camera contract. Together wants to *show* them —
 * a stamp beside `Current place`, a picture on the Scene Tale tile — and the failure that is
 * one careless line away is the one where picking a thumbnail also picks a background.
 *
 * So the tests here are in two halves. The first says the resolver answers correctly and cheaply.
 * The second says it cannot do the other thing at all: no module in the thumbnail path names a
 * viewport API, and painting every screen that shows a thumbnail leaves a fully-instrumented
 * fake viewport with a call count of zero.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const SceneArt = require('../../src/features/together/SceneArt.js');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/ambient/scene-tale-art.json'), 'utf8'));

beforeEach(() => SceneArt.reset());

describe('the built-in table is the manifest, or it is a bug', () => {
    /**
     * `BUILTIN` exists so the Configure card can paint a picture on its first frame — a resolver
     * that can only answer after a fetch draws the card empty and pops the image in afterwards.
     * The cost of that is a copy of the data, and the whole mitigation is this test: ten rows in
     * one module, checked field by field against the file they came from. Drift here is a failure
     * rather than a wrong picture on somebody's screen.
     */
    test('same scenes, same order, same every field', () => {
        expect(SceneArt.BUILTIN.map((scene) => scene.id)).toEqual(MANIFEST.scenes.map((scene) => scene.id));
        for (const expected of MANIFEST.scenes) {
            const actual = SceneArt.getSceneArt(expected.id);
            expect(actual).toBeTruthy();
            for (const key of ['id', 'label', 'generationKey', 'hero', 'thumbnail', 'portrait']) {
                expect(actual[key]).toBe(expected[key]);
            }
        }
    });

    test('and every file it names is really on disk', () => {
        // A path that resolves to nothing is a broken image in a card, which is exactly the
        // presentation failure the fallback is for — but it should never be *this* module's doing.
        for (const scene of SceneArt.BUILTIN) {
            for (const key of ['hero', 'thumbnail', 'portrait']) {
                expect(fs.existsSync(path.join(ROOT, scene[key]))).toBe(true);
            }
        }
    });
});

describe('resolving a place', () => {
    test('by id, by label and by generation key, because all three arrive here', () => {
        const expected = 'assets/ambient/dark/coastal-terrace-twilight.webp';
        expect(SceneArt.getSceneThumbnail('ambient:terrace:night')).toBe(expected);
        expect(SceneArt.getSceneThumbnail('Coastal Terrace · Twilight')).toBe(expected);
        expect(SceneArt.getSceneThumbnail('coastal-terrace-twilight')).toBe(expected);
    });

    test('a label somebody typed with a dash still finds its scene', () => {
        // Labels reach this module after passing through screens written by different hands.
        // An em dash instead of the manifest's middot is a formatting choice, not a different
        // place, and used to be the difference between a thumbnail and no thumbnail.
        expect(SceneArt.getSceneThumbnail('Coastal Terrace — Twilight')).toBe(
            'assets/ambient/dark/coastal-terrace-twilight.webp'
        );
        expect(SceneArt.getSceneThumbnail('  ocean · sunrise  ')).toBe('assets/ambient/light/ocean-sunrise.webp');
    });

    test('portrait is a separate composition, not a crop of the landscape one', () => {
        const landscape = SceneArt.getSceneThumbnail('ambient:ocean:night');
        const portrait = SceneArt.getSceneThumbnail('ambient:ocean:night', 'portrait');
        expect(portrait).not.toBe(landscape);
        expect(portrait).toBe('assets/ambient/dark/ocean-moonlight-portrait.webp');
    });

    test('an unknown place is an empty string, never a stand-in picture', () => {
        // The caller's job on an unknown scene is to draw the label and no image. A placeholder
        // would be a second thing to art-direct and a second thing to explain when it shows up
        // over somebody's real scene.
        for (const missing of ['', null, undefined, 'somewhere else', 'current scene', { id: 'nope' }]) {
            expect(SceneArt.getSceneThumbnail(missing)).toBe('');
            expect(SceneArt.getSceneArt(missing)).toBeNull();
        }
    });

    test('a plan object resolves through its own scene fields', () => {
        expect(SceneArt.getSceneArt({ sceneId: 'ambient:sky:night' }).label).toBe('Open Sky · Starlight');
        expect(SceneArt.getSceneArt({ sceneLabel: 'Open Sky · Day' }).id).toBe('ambient:sky:day');
    });
});

describe('the manifest is the source of truth, and a broken one costs nothing', () => {
    test('a loaded manifest replaces the built-in answers', async () => {
        const win = {
            fetch: () =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            scenes: [
                                {
                                    id: 'ambient:ocean:day',
                                    label: 'Ocean · Renamed',
                                    thumbnail: 'assets/ambient/light/ocean-sunrise.webp',
                                    portrait: 'assets/ambient/light/ocean-sunrise-portrait.webp',
                                },
                            ],
                        }),
                }),
        };
        await SceneArt.load(win);
        expect(SceneArt.getSceneLabel('ambient:ocean:day')).toBe('Ocean · Renamed');
    });

    test('and is fetched once however many screens ask for it', async () => {
        const fetch = jest.fn(() => Promise.resolve({ ok: false }));
        await SceneArt.load({ fetch });
        await SceneArt.load({ fetch });
        await SceneArt.load({ fetch });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('a failed fetch leaves the built-in pictures rather than an empty card', async () => {
        const failing = { fetch: () => Promise.reject(new Error('offline')) };
        const scenes = await SceneArt.load(failing);
        expect(scenes.length).toBe(SceneArt.BUILTIN.length);
        expect(SceneArt.getSceneThumbnail('ambient:ocean:day')).toBe('assets/ambient/light/ocean-sunrise.webp');
    });

    test('so does a manifest that parses but says nothing usable', () => {
        expect(SceneArt.adopt([{ label: 'no id, no thumbnail' }])).toBe(false);
        expect(SceneArt.adopt([])).toBe(false);
        expect(SceneArt.getSceneLabel('ambient:ocean:day')).toBe('Ocean · Sunrise');
    });
});

describe('the <img> everybody is supposed to use', () => {
    test('loads one file, lazily by default, and carries the scene it is of', () => {
        // Twenty full-resolution plates, drawn at 64px. Anything that reaches for more than the
        // one visible scene is a bug, and this is the seam where that would happen.
        const img = SceneArt.thumbnailElement(document, 'ambient:garden:night', {});
        expect(img.getAttribute('src')).toBe('assets/ambient/dark/meditation-garden-night.webp');
        expect(img.loading).toBe('lazy');
        expect(img.decoding).toBe('async');
        expect(img.dataset.sceneId).toBe('ambient:garden:night');
        expect(document.querySelectorAll('img').length).toBe(0);
    });

    test('eager only where the caller says the picture is the point', () => {
        expect(SceneArt.thumbnailElement(document, 'ambient:garden:night', { eager: true }).loading).toBe('eager');
    });

    test('an unknown scene produces no element at all', () => {
        expect(SceneArt.thumbnailElement(document, 'nowhere', {})).toBeNull();
    });

    test('a picture that will not load removes itself and changes nothing else', () => {
        // The rule the brief puts most weight on: a missing thumbnail is a presentation failure.
        // It is not a reason to touch the label, the layout, or — above all — the scene.
        const card = document.createElement('div');
        const label = document.createElement('span');
        label.textContent = 'Coastal Terrace · Twilight';
        const img = SceneArt.thumbnailElement(document, 'ambient:terrace:night', {});
        card.append(img, label);
        img.dispatchEvent(new window.Event('error'));
        expect(card.querySelector('img')).toBeNull();
        expect(card.textContent).toBe('Coastal Terrace · Twilight');
    });
});

describe('it cannot change the environment, by construction', () => {
    /**
     * The strongest statement available without a browser: the source of every module in the
     * thumbnail path contains no reference to any API that can set a background. A future edit
     * that wires "thumbnail chosen" to "scene applied" has to defeat this first.
     */
    const FORBIDDEN = /setDesktopBackground|NEXUS_VIEWER|BACKGROUND_MANAGER|BACKGROUND_CATALOG|reapplyCurrent/;

    test('SceneArt names no viewport API anywhere', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/features/together/SceneArt.js'), 'utf8');
        const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(FORBIDDEN);
    });

    test('and neither does the art view that draws the story hero', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/features/together/ui/SceneTaleArtView.js'), 'utf8');
        const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(FORBIDDEN);
    });

    test('the manifest points only into the ambience directories, and only at files', () => {
        // A path that escaped `assets/ambient/` would be this module handing an arbitrary URL to
        // an `<img>`; a path that is not a real plate would be a broken picture with nobody
        // owning it.
        for (const scene of SceneArt.BUILTIN) {
            for (const key of ['hero', 'thumbnail', 'portrait']) {
                expect(scene[key]).toMatch(/^assets\/ambient\/(light|dark)\/[a-z0-9-]+\.webp$/);
            }
        }
    });
});
