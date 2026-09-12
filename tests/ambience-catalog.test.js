/**
 * The background catalogue (batch A2).
 *
 * Two things are being guarded here, and only one of them is "does the list work".
 *
 * The first is that the five colours Settings has always offered keep their exact ids, because
 * a user with `desktop_bg = "white"` stored today must still boot to white after this feature
 * lands. Those ids are a contract with existing installs, not an implementation detail.
 *
 * The second is the path rule. This is the only door a path from a data file walks through on
 * its way to a texture loader, and it is the door a *remote* catalogue will later use too. So
 * the rejection cases are the substance of this file: an absolute URL, a `data:` URI, a
 * traversal, a scheme that would be executable. Each one is a way a mistaken or tampered
 * catalogue could reach somewhere it should not, and each must be refused at ingest rather than
 * discovered at fetch time.
 *
 * Rejection is also always *soft*. Nine good scenes must survive one bad line.
 */

const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
const fs = require('fs');
const path = require('path');

const SHIPPED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/ambient/backgrounds.json'), 'utf-8'));

function scene(overrides) {
    return {
        id: 'ambient:test:day',
        type: 'image',
        label: 'Test Scene',
        variantLabel: 'Day',
        src: 'assets/ambient/light/test.webp',
        thumb: 'assets/ambient/light/test.webp',
        focalPoint: 'center',
        intensity: 1,
        category: 'relax',
        tags: ['sea', 'relax'],
        ...overrides,
    };
}

let warn;

beforeEach(() => {
    Catalog.reset();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
});

describe('the five colours are a contract with existing installs', () => {
    test('the ids are exactly what Settings has always stored', () => {
        expect(Catalog.COLOR_IDS).toEqual(['black', 'dark', 'gray', 'light', 'white']);
    });

    test('each resolves without any data file loaded', () => {
        for (const id of Catalog.COLOR_IDS) {
            const entry = Catalog.get(id);
            expect(entry).toMatchObject({ id, type: 'color' });
            expect(entry.swatch).toMatch(/^#[0-9a-f]{6}$/);
        }
    });

    test('the swatches match ViewerEngine.BG_COLORS', () => {
        // ViewerEngine owns the rendered value; this list only has to agree with it. Drift here
        // would show a black swatch on a card that paints grey.
        const src = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/ViewerEngine.js'), 'utf-8');
        const block = src.slice(src.indexOf('static BG_COLORS'));
        for (const entry of Catalog.colors()) {
            const hex = entry.swatch.replace('#', '0x');
            expect(block).toContain(`${entry.id}: ${hex}`);
        }
    });

    test('isColorId separates the two kinds', () => {
        expect(Catalog.isColorId('black')).toBe(true);
        expect(Catalog.isColorId('ambient:ocean:day')).toBe(false);
    });

    test('colours are frozen, so no caller can edit the shared list', () => {
        const entry = Catalog.get('black');
        expect(() => {
            'use strict';
            entry.label = 'Tampered';
        }).toThrow();
        expect(Catalog.get('black').label).toBe('Black');
    });
});

describe('the shipped data file', () => {
    test('every entry is accepted', () => {
        const result = Catalog.ingest(SHIPPED, 'backgrounds.json');
        expect(result.rejected).toBe(0);
        expect(result.accepted).toBe(SHIPPED.scenes.length);
        expect(warn).not.toHaveBeenCalled();
    });

    test('it ships the five scenes in both variants', () => {
        Catalog.ingest(SHIPPED);
        const ids = Catalog.images().map((e) => e.id);
        for (const s of ['ocean', 'lake', 'garden', 'terrace', 'sky']) {
            expect(ids).toContain(`ambient:${s}:day`);
            expect(ids).toContain(`ambient:${s}:night`);
        }
        expect(ids).toHaveLength(10);
    });

    test('every entry carries the metadata the resolver ranks on', () => {
        Catalog.ingest(SHIPPED);
        for (const entry of Catalog.images()) {
            expect(entry.category).not.toBe('');
            expect(entry.tags.length).toBeGreaterThan(2);
        }
    });

    test('every src is a safe relative path under assets/ambient/', () => {
        for (const raw of SHIPPED.scenes) {
            expect(Catalog.isSafeRelativePath(raw.src)).toBe(true);
            expect(raw.src.startsWith('assets/ambient/')).toBe(true);
        }
    });

    test('it carries no executable content', () => {
        // A catalogue is data. A function, a handler or a script-ish string in it would mean the
        // data file had become code, which is the thing the contract forbids outright.
        const flat = JSON.stringify(SHIPPED);
        expect(flat).not.toMatch(/javascript:|<script|function\s*\(|=>/i);
        for (const raw of SHIPPED.scenes) {
            for (const value of Object.values(raw)) {
                expect(typeof value === 'function').toBe(false);
            }
        }
    });
});

describe('path validation — the door a remote catalogue will use', () => {
    test.each([
        ['assets/ambient/light/a.webp', 'a normal relative path'],
        ['a.webp', 'a bare filename'],
        ['assets/ambient/dark/a-b_c.1.webp', 'punctuation we allow'],
    ])('accepts %p (%s)', (value) => {
        expect(Catalog.isSafeRelativePath(value)).toBe(true);
    });

    test.each([
        ['https://cdn.example/a.webp', 'an absolute https URL'],
        ['http://cdn.example/a.webp', 'an absolute http URL'],
        ['//cdn.example/a.webp', 'a protocol-relative URL'],
        ['data:image/webp;base64,AAAA', 'a data URI'],
        ['javascript:alert(1)', 'an executable scheme'],
        ['/etc/passwd', 'an absolute filesystem path'],
        ['../../secrets/a.webp', 'a traversal'],
        ['assets/../../a.webp', 'a traversal in the middle'],
        ['assets/ambient/a.webp?x=1', 'a query string'],
        ['assets/ambient/a.webp#frag', 'a fragment'],
        ['assets/ambient/a b.webp', 'whitespace'],
        ['assets/<script>.webp', 'markup'],
        ['', 'empty'],
        [null, 'null'],
        [undefined, 'undefined'],
        [42, 'a number'],
        [{}, 'an object'],
    ])('refuses %p (%s)', (value) => {
        expect(Catalog.isSafeRelativePath(value)).toBe(false);
    });

    test('an entry with an unsafe src is dropped, and the good ones survive', () => {
        const result = Catalog.ingest([
            scene({ id: 'ambient:good:day' }),
            scene({ id: 'ambient:bad:day', src: 'https://cdn.example/evil.webp' }),
            scene({ id: 'ambient:also:day' }),
        ]);
        expect(result).toEqual({ accepted: 2, rejected: 1 });
        expect(Catalog.images().map((e) => e.id)).toEqual(['ambient:good:day', 'ambient:also:day']);
        expect(warn).toHaveBeenCalled();
    });

    test('an unsafe thumb falls back to src rather than rejecting the scene', () => {
        // The thumbnail is decoration. Losing a whole scene over it would be the wrong trade.
        Catalog.ingest([scene({ thumb: 'https://cdn.example/t.webp' })]);
        const entry = Catalog.get('ambient:test:day');
        expect(entry.thumb).toBe(entry.src);
    });
});

describe('malformed entries are dropped, never thrown', () => {
    test.each([
        [{ id: 'no-namespace', src: 'a.webp', label: 'x' }, 'an id outside the ambient: namespace'],
        [{ id: 'ambient:x', src: 'a.webp', label: 'x' }, 'an id missing its variant'],
        [{ id: 'ambient:X:Day', src: 'a.webp', label: 'x' }, 'an uppercase id'],
        [{ id: 'ambient:a:b', label: 'x' }, 'no src at all'],
        [{ id: 'ambient:a:b', src: 'a.webp' }, 'no label'],
        [{ id: 'ambient:a:b', src: 'a.webp', label: '   ' }, 'a blank label'],
        [null, 'null'],
        ['a string', 'a string instead of an object'],
        [42, 'a number'],
    ])('drops %p (%s)', (raw) => {
        expect(() => Catalog.ingest([raw])).not.toThrow();
        expect(Catalog.images()).toHaveLength(0);
        expect(warn).toHaveBeenCalled();
    });

    test('a duplicate id is refused rather than silently shadowed', () => {
        const result = Catalog.ingest([scene({ label: 'First' }), scene({ label: 'Second' })]);
        expect(result).toEqual({ accepted: 1, rejected: 1 });
        expect(Catalog.get('ambient:test:day').label).toBe('First');
    });

    test('a missing or broken file leaves colours working', () => {
        expect(() => Catalog.ingest(null)).not.toThrow();
        expect(() => Catalog.ingest({})).not.toThrow();
        expect(() => Catalog.ingest('nonsense')).not.toThrow();
        expect(Catalog.hasImages()).toBe(false);
        expect(Catalog.get('black')).toMatchObject({ id: 'black' });
        expect(Catalog.list()).toHaveLength(5);
    });
});

describe('field normalisation', () => {
    test('tags are lowercased, de-duplicated and filtered', () => {
        Catalog.ingest([scene({ tags: ['Sea', 'sea', '  OCEAN  ', 'bad tag', 42, null, 'relax'] })]);
        expect(Catalog.get('ambient:test:day').tags).toEqual(['sea', 'ocean', 'relax']);
    });

    test('non-array tags become an empty list rather than throwing', () => {
        Catalog.ingest([scene({ tags: 'sea,ocean' })]);
        expect(Catalog.get('ambient:test:day').tags).toEqual([]);
    });

    test.each([
        [0, 1],
        [-1, 1],
        [NaN, 1],
        [Infinity, 1],
        ['2', 1],
        [undefined, 1],
        [0.5, 0.5],
        [2, 2],
        [99, 4],
    ])('intensity %p becomes %p', (input, expected) => {
        // It reaches scene.backgroundIntensity, where a negative is black and a huge one is
        // blown out. Clamped rather than trusted.
        Catalog.ingest([scene({ intensity: input })]);
        expect(Catalog.get('ambient:test:day').intensity).toBe(expected);
    });

    test('a missing focalPoint defaults to center', () => {
        Catalog.ingest([scene({ focalPoint: undefined })]);
        expect(Catalog.get('ambient:test:day').focalPoint).toBe('center');
    });

    test('entries are frozen and the accessors hand out copies', () => {
        Catalog.ingest([scene()]);
        const first = Catalog.images();
        first.push('junk');
        expect(Catalog.images()).toHaveLength(1);
    });
});

describe('lookups', () => {
    beforeEach(() => Catalog.ingest(SHIPPED));

    test('get finds colours and images alike', () => {
        expect(Catalog.get('white').type).toBe('color');
        expect(Catalog.get('ambient:garden:night').type).toBe('image');
    });

    test.each([['nope'], ['ambient:mars:day'], [''], [null], [undefined], [42]])(
        'an unknown id %p is null, not a throw',
        (id) => {
            expect(Catalog.get(id)).toBeNull();
            expect(Catalog.has(id)).toBe(false);
        }
    );

    test('list puts colours first, then scenes', () => {
        const list = Catalog.list();
        expect(list.slice(0, 5).every((e) => e.type === 'color')).toBe(true);
        expect(list.slice(5).every((e) => e.type === 'image')).toBe(true);
        expect(list).toHaveLength(15);
    });

    test('hasImages reports whether anything scenic can be offered', () => {
        expect(Catalog.hasImages()).toBe(true);
        Catalog.reset();
        expect(Catalog.hasImages()).toBe(false);
    });

    test('ingest replaces wholesale rather than accumulating', () => {
        Catalog.ingest([scene()]);
        expect(Catalog.images()).toHaveLength(1);
    });
});

describe('load', () => {
    test('uses the injected fetcher and records the source', async () => {
        const fetcher = jest.fn().mockResolvedValue(SHIPPED);
        const result = await Catalog.load({ url: 'x/y.json', fetcher });
        expect(fetcher).toHaveBeenCalledWith('x/y.json');
        expect(result.accepted).toBe(10);
        expect(Catalog.source()).toBe('x/y.json');
    });

    test('defaults to the shipped path', async () => {
        const fetcher = jest.fn().mockResolvedValue({ scenes: [] });
        await Catalog.load({ fetcher });
        expect(fetcher).toHaveBeenCalledWith(Catalog.DEFAULT_SOURCE);
    });

    test('a rejected fetch leaves colours working and does not throw', async () => {
        const result = await Catalog.load({ fetcher: () => Promise.reject(new Error('offline')) });
        expect(result).toEqual({ accepted: 0, rejected: 0 });
        expect(Catalog.hasImages()).toBe(false);
        expect(Catalog.get('black')).toMatchObject({ id: 'black' });
        expect(warn).toHaveBeenCalled();
    });

    test('a fetcher returning nonsense is handled like a failure', async () => {
        await expect(Catalog.load({ fetcher: () => Promise.resolve('<html>404</html>') })).resolves.toEqual({
            accepted: 0,
            rejected: 0,
        });
    });
});
