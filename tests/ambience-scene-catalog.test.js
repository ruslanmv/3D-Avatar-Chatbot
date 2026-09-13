/**
 * The scene library, and the boundary it exists to hold (batch A17).
 *
 * Two halves, and only one of them is about listing things.
 *
 * The listing half is ordinary: sources go in, one ordered list comes out, a bad entry costs
 * itself and not the source it arrived with.
 *
 * The other half is a security boundary, and it is worth being explicit about what it protects.
 * A scene manifest in this app can carry `profileOverlay` and `guidedScript` — see
 * `OVERLAY_FIELDS` in `src/features/together/activities/scene-journey.js`, which is how a scene
 * sets `initiative`, `allowNsfw` and what she says unprompted. Shipped inside the application
 * that is a feature. Arriving in a downloaded pack it is a stranger configuring the assistant.
 * So everything here about `trust` is testing that the second case cannot happen, including the
 * ways it could happen by accident: a source registered with no trust, a field added to a
 * manifest later, a validator that is not loaded.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
const Library = require('../src/features/ambience/SceneCatalog.js');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/ambient/backgrounds.json'), 'utf-8'));

/** A source file with its comments removed, so an assertion cannot match the prose about it. */
function stripComments(file) {
    return fs
        .readFileSync(path.join(root, file), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scene(extra) {
    return {
        id: 'user:rooftop',
        type: 'image',
        label: 'Tokyo Rooftop',
        variantLabel: 'Rain',
        src: 'assets/ambient/light/open-sky.webp',
        tags: ['city', 'rain'],
        ...extra,
    };
}

beforeEach(() => {
    Library.reset();
    Catalog.reset();
    // The path rule lives on the viewport catalogue and is borrowed, never copied. Under jsdom
    // the module has to be on the global for that lookup to find it, exactly as index.html does.
    window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
});

afterEach(() => {
    Library.reset();
    Catalog.reset();
    delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
});

describe('the trust boundary', () => {
    test('a user-content scene loses its behavioural fields', () => {
        Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene({ profileOverlay: { initiative: { budgetPerSession: 999 } }, guidedScript: ['hi'] })],
        });
        const entry = Library.get('user:rooftop');
        expect(entry).not.toBeNull();
        expect(entry.profileOverlay).toBeUndefined();
        expect(entry.guidedScript).toBeUndefined();
    });

    test('and the import is told what was taken, not left to guess', () => {
        Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene({ profileOverlay: { allowNsfw: true } })],
        });
        expect(Library.get('user:rooftop').strippedFields).toEqual(['profileOverlay']);
    });

    test('a field that was empty is not reported as stripped', () => {
        // Every built-in manifest carries `guidedScript: null`. Counting that would make a clean
        // pack look like it had tried something.
        Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene({ guidedScript: null, profileOverlay: undefined })],
        });
        expect(Library.get('user:rooftop').strippedFields).toEqual([]);
    });

    test('a source with no trust stated is treated as untrusted', () => {
        // The direction a mistake has to fail in. A source added later by someone who did not
        // read this file must not get system trust by omission.
        Library.registerSource('mystery', { scenes: [scene({ profileOverlay: { allowNsfw: true } })] });
        const entry = Library.get('user:rooftop');
        expect(entry.trust).toBe(Library.TRUST.USER);
        expect(entry.profileOverlay).toBeUndefined();
    });

    test('an unrecognised trust value is treated as untrusted too', () => {
        Library.registerSource('mystery', { trust: 'trusted-honestly', scenes: [scene({ guidedScript: ['x'] })] });
        expect(Library.get('user:rooftop').trust).toBe(Library.TRUST.USER);
    });

    test('a system scene keeps everything, because that is the point of the distinction', () => {
        const overlay = { idleProfile: 'curious-outdoor' };
        const kept = Library.applyTrust({ id: 'builtin', profileOverlay: overlay }, Library.TRUST.SYSTEM);
        expect(kept.manifest.profileOverlay).toBe(overlay);
        expect(kept.removed).toEqual([]);
    });

    test('every manifest field scene-journey reads is classified, behavioural or not', () => {
        // The coupling worth pinning, and pinned so that a *new* field fails it rather than only
        // a removed one. Whatever scene-journey reads off a manifest is either scenery — which
        // an imported pack may set — or behaviour, which it may not. A third door added there
        // lands in neither list and this goes red until somebody decides which it is.
        const journey = stripComments('src/features/together/activities/scene-journey.js');
        const read = new Set((journey.match(/manifest\.([a-zA-Z][a-zA-Z0-9_]*)/g) || []).map((m) => m.split('.')[1]));
        expect(read.size).toBeGreaterThan(4);

        // Scenery and identity: pictures, sound, light, where she stands, what it is called.
        const scenery = ['id', 'title', 'skybox', 'ambient', 'fallbackColor', 'lighting', 'anchors', 'avatarPlacement'];
        const unclassified = [...read].filter((f) => !scenery.includes(f) && !Library.BEHAVIOUR_FIELDS.includes(f));
        expect(unclassified).toEqual([]);

        // And the behavioural ones are really there to be kept out, not a list of names nothing
        // uses any more.
        for (const field of Library.BEHAVIOUR_FIELDS) expect(read.has(field)).toBe(true);
    });

    test('stripping copies rather than editing the manifest it was given', () => {
        // An importer may want to show the original. Mutating the caller's object would make
        // "what did this pack contain" unanswerable a moment after the question is asked.
        const original = { id: 'x', profileOverlay: { allowNsfw: true } };
        Library.applyTrust(original, Library.TRUST.USER);
        expect(original.profileOverlay).toEqual({ allowNsfw: true });
    });
});

describe('paths, which are borrowed and never re-implemented', () => {
    test.each([
        ['an absolute URL', 'https://example.com/x.webp'],
        ['a data URI', 'data:image/webp;base64,AAA'],
        ['a javascript URI', 'javascript:alert(1)'],
        ['a traversal', 'assets/../../etc/passwd'],
        ['a root-relative path', '/assets/x.webp'],
        ['a missing value', undefined],
    ])('%s is refused', (_label, src) => {
        const result = Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene({ src })] });
        expect(result.accepted).toBe(0);
        expect(result.rejected[0].reason).toMatch(/safe relative path/);
    });

    test('an unsafe thumb falls back to the image rather than failing the scene', () => {
        Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene({ thumb: 'https://example.com/thumb.webp' })],
        });
        const entry = Library.get('user:rooftop');
        expect(entry.thumb).toBe('assets/ambient/light/open-sky.webp');
    });

    test('with no validator loaded the library accepts nothing at all', () => {
        // Fail closed. A check whose whole job is refusing things must not become a pass-through
        // when its implementation is missing — and there is deliberately no local copy of the
        // rule to fall back to, because two copies is how one of them gets lenient.
        delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        const result = Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(result.accepted).toBe(0);
        expect(Library.list()).toEqual([]);
    });

    test('the module holds no path rule of its own', () => {
        const source = stripComments('src/features/ambience/SceneCatalog.js');
        expect(source).toContain('isSafeRelativePath');
        // The tell-tales of a second implementation: a scheme test or a traversal test written
        // here instead of borrowed.
        expect(source).not.toMatch(/\.\.'|"\.\."/);
        expect(source).not.toMatch(/a-z0-9\+\.-/);
    });
});

describe('entries', () => {
    test.each([
        ['no id', { id: '' }, /id must be/],
        ['no label', { label: '' }, /label must be/],
        ['a wrong type', { type: 'video' }, /type must be/],
    ])('%s is rejected with a reason', (_label, extra, pattern) => {
        const result = Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene(extra)] });
        expect(result.accepted).toBe(0);
        expect(result.rejected[0].reason).toMatch(pattern);
    });

    test('one bad entry costs itself, not the source', () => {
        const result = Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene(), scene({ id: 'user:bad', src: 'https://example.com/x.webp' })],
        });
        expect(result.accepted).toBe(1);
        expect(result.rejected).toHaveLength(1);
        expect(Library.list()).toHaveLength(1);
    });

    test('a duplicate id within a source is refused rather than shadowed', () => {
        // Two entries with one id means one can never be selected, and which one wins would
        // depend on iteration order.
        const result = Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene(), scene({ label: 'Another' })],
        });
        expect(result.accepted).toBe(1);
        expect(result.rejected[0].reason).toMatch(/duplicate/);
    });

    test('tags are normalised the way the resolver expects to read them', () => {
        Library.registerSource('imported', {
            trust: Library.TRUST.USER,
            scenes: [scene({ tags: ['City', ' RAIN ', 'city', 42, '<script>'] })],
        });
        expect(Library.get('user:rooftop').tags).toEqual(['city', 'rain']);
    });

    test('an entry is frozen, so a consumer cannot edit the library by accident', () => {
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        const entry = Library.get('user:rooftop');
        expect(() => {
            'use strict';
            entry.label = 'changed';
        }).toThrow();
    });
});

describe('sources', () => {
    beforeEach(() => {
        Catalog.ingest(manifest, 'test');
    });

    test('the ten built-ins arrive as system-trusted', () => {
        const result = Library.adoptBuiltins(Catalog);
        expect(result.accepted).toBe(10);
        expect(Library.list()).toHaveLength(10);
        expect(Library.list().every((s) => s.trust === Library.TRUST.SYSTEM)).toBe(true);
        expect(Library.list().every((s) => s.source === 'builtin')).toBe(true);
    });

    test('adopting twice replaces rather than duplicates', () => {
        Library.adoptBuiltins(Catalog);
        Library.adoptBuiltins(Catalog);
        expect(Library.list()).toHaveLength(10);
    });

    test('built-ins are listed before anything added later', () => {
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        Library.adoptBuiltins(Catalog);
        const list = Library.list();
        expect(list[0].source).toBe('builtin');
        expect(list[list.length - 1].source).toBe('imported');
    });

    test('a source can be removed, and takes only its own scenes with it', () => {
        Library.adoptBuiltins(Catalog);
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(Library.removeSource('imported')).toBe(true);
        expect(Library.list()).toHaveLength(10);
    });

    test('the summary is what a Built-in / My scenes split would render from', () => {
        Library.adoptBuiltins(Catalog);
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(Library.sources()).toEqual(
            expect.arrayContaining([
                { name: 'builtin', trust: 'system', count: 10 },
                { name: 'imported', trust: 'user-content', count: 1 },
            ])
        );
    });

    test('adopting with no catalogue present is a no-op, not a crash', () => {
        delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        expect(Library.adoptBuiltins(null)).toEqual({ accepted: 0, rejected: [] });
    });
});

describe('change notification', () => {
    test('listeners hear about a new source', () => {
        const seen = [];
        Library.onChange((list) => seen.push(list.length));
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(seen).toEqual([1]);
    });

    test('unsubscribing works', () => {
        const seen = [];
        const off = Library.onChange(() => seen.push(1));
        off();
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(seen).toEqual([]);
    });

    test('a listener that throws does not silence the others', () => {
        // The grid and the resolver both listen. One broken consumer must not cost the other the
        // news that a scene has just been imported.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const seen = [];
        Library.onChange(() => {
            throw new Error('boom');
        });
        Library.onChange(() => seen.push(1));
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        expect(seen).toEqual([1]);
        warn.mockRestore();
    });

    test('removing a source notifies, and removing a missing one does not', () => {
        Library.registerSource('imported', { trust: Library.TRUST.USER, scenes: [scene()] });
        const seen = [];
        Library.onChange(() => seen.push(1));
        expect(Library.removeSource('nope')).toBe(false);
        expect(seen).toEqual([]);
        Library.removeSource('imported');
        expect(seen).toEqual([1]);
    });
});

describe('the module keeps the house shape', () => {
    test('it is loaded by boot.js, before the modules that read it', () => {
        const boot = fs.readFileSync(path.join(root, 'src/behavior/boot.js'), 'utf-8');
        const self = boot.indexOf('src/features/ambience/SceneCatalog.js');
        const resolver = boot.indexOf('src/features/ambience/SceneAmbienceResolver.js');
        expect(self).toBeGreaterThan(-1);
        expect(self).toBeLessThan(resolver);
    });

    test('it has no top-level import or export, so Jest can require it', () => {
        const source = stripComments('src/features/ambience/SceneCatalog.js');
        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/^\s*export\s/m);
        expect(source).toContain('module.exports');
    });
});
