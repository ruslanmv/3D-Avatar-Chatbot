/**
 * PW. AvatarAdultDeclaration: an adult experience never runs with an avatar that is not declared
 * adult by Wardrobe Forge's operator. Fails closed on every unknown.
 */
const A = require('../../src/features/together/AvatarAdultDeclaration.js');

const lib = (slug, extra) => ({ kind: 'library', slug, name: slug, sha256: 'abc', ...extra });

describe('decide', () => {
    test('yes only for a library avatar Forge lists as depictsAdult with matching bytes', () => {
        expect(A.decide(lib('a'), [{ slug: 'a', depictsAdult: true }], true)).toMatchObject({ ok: true });
    });
    test.each([
        ['an external avatar', { kind: 'external', name: 'Mine.vrm' }, [], null],
        ['no identity', null, [], null],
        ['Forge unreachable', lib('a'), null, null],
        ['not listed', lib('a'), [{ slug: 'b', depictsAdult: true }], null],
        ['listed, not declared', lib('a'), [{ slug: 'a', depictsAdult: false }], null],
        ['declared as a string', lib('a'), [{ slug: 'a', depictsAdult: 'true' }], null],
        ['bytes differ', lib('a'), [{ slug: 'a', depictsAdult: true }], false],
    ])('no for %s, with a sentence', (_, identity, published, same) => {
        const r = A.decide(identity, published, same);
        expect(r.ok).toBe(false);
        expect(r.why).toMatch(/\w+/);
    });
});

describe('check', () => {
    afterEach(() => A._reset());
    function page(identity, published, url = 'vendor/avatars/a.vrm') {
        const g = {
            NEXUS_VIEWER: { avatarManager: { getCurrent: () => ({ url }) } },
            NEXUS_WARDROBE: { service: {} },
            NEXUS_AVATAR_IDENTITY: { matchesPublished: () => true, resolve: () => identity },
            NEXUS_TRY_ON_GENERATOR: {
                TryOnGenerator: class {
                    identity() {
                        return identity;
                    }
                    get library() {
                        return { library: async () => published };
                    }
                },
            },
        };
        return g;
    }

    test('asks Forge through the wardrobe and answers yes for a declared avatar', async () => {
        expect(await A.check(page(lib('a'), [{ slug: 'a', depictsAdult: true }]))).toMatchObject({ ok: true });
    });

    test('no wardrobe, no generator, or a throw: no', async () => {
        expect((await A.check({})).ok).toBe(false);
        const g = page(lib('a'), null);
        g.NEXUS_AVATAR_IDENTITY.resolve = () => {
            throw new Error('boom');
        };
        expect((await A.check(g)).ok).toBe(false);
    });

    test('a "no" is never cached: Forge coming back is enough', async () => {
        const g = page(lib('a'), null);
        expect((await A.check(g)).ok).toBe(false);
        const ok = page(lib('a'), [{ slug: 'a', depictsAdult: true }]);
        expect((await A.check(ok)).ok).toBe(true);
    });

    test('a "yes" is only for the same avatar', async () => {
        const g = page(lib('a'), [{ slug: 'a', depictsAdult: true }]);
        expect((await A.check(g)).ok).toBe(true);
        const other = page({ kind: 'external', name: 'other' }, [], 'vendor/avatars/other.vrm');
        expect((await A.check(other)).ok).toBe(false);
    });
});

test('the avatar on screen is judged, not the wardrobe’s pinned original — except a worn look', () => {
    const Id = require('../../src/wardrobe/AvatarIdentity.js');
    const g = (url) => ({
        NEXUS_AVATAR_IDENTITY: Id,
        NEXUS_VIEWER: { avatarManager: { getCurrent: () => ({ url, name: 'x' }) } },
    });
    const W = {
        service: {
            controller: {
                original: { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'A' },
                activeLook: { id: 'look' },
                wornUrl: 'blob:http://x/1#look.vrm',
            },
        },
    };
    expect(A.whoIsOnScreen(g('vendor/avatars/fem_vroid.vrm'), W)).toMatchObject({ kind: 'library', slug: 'fem-vroid' });
    expect(A.whoIsOnScreen(g('blob:http://x/1#look.vrm'), W)).toMatchObject({
        kind: 'library',
        slug: 'avatar-sample-a',
    });
});

test('the page wiring of Intimate always passes the declaration check', () => {
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../src/features/together/activities/playground.js'),
        'utf8'
    );
    expect(src).toMatch(/avatarAdult: \(\) =>\s*window\.NEXUS_AVATAR_ADULT/);
    expect(src).toMatch(/if \(this\.avatarAdult\) \{\s*let declared = null;/);
});

describe('PW8. every public built-in avatar is declared adult in the shipped catalog', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..', '..');
    const Id = require('../../src/wardrobe/AvatarIdentity.js');
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/avatars/avatars.json'), 'utf8'));
    const items = catalog.items;
    afterEach(() => A._reset());

    test('the catalog declares each of its avatars with the boolean, and each file is shipped', () => {
        expect(items.length).toBeGreaterThanOrEqual(17);
        for (const item of items) {
            expect(`${item.file}: ${item.depictsAdult}`).toBe(`${item.file}: true`);
            expect(fs.existsSync(path.join(ROOT, 'vendor/avatars', item.file))).toBe(true);
        }
    });

    test.each(items.map((x) => [x.name, x.file]))(
        '%s on screen from vendor/avatars: Private may start',
        (name, file) => {
            for (const url of [
                `vendor/avatars/${file}`,
                `/vendor/avatars/${file}`,
                `http://app.test/vendor/avatars/${file}`,
            ]) {
                const base = { url, name };
                const declared = A.catalogDeclaration(catalog, base, Id, 'http://app.test');
                expect(declared).toMatchObject({ file });
                expect(A.decide(Id.resolve(base), null, null, declared)).toMatchObject({ ok: true });
            }
        }
    );

    test('AvatarSample A, the reported refusal, now opens — through the page path, with Forge unreachable', async () => {
        const g = {
            NEXUS_AVATAR_IDENTITY: Id,
            NEXUS_VIEWER: {
                avatarManager: {
                    getCurrent: () => ({ url: '/vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A' }),
                },
            },
        };
        const r = await A.check(g, { catalog });
        expect(r).toMatchObject({ ok: true, source: 'catalog' });
        expect(r.why).not.toMatch(/not been declared adult/);
    });

    test.each([
        ['an installed avatar (blob:)', 'blob:http://app.test/1234'],
        ['a data: URL', 'data:model/gltf-binary;base64,AAAA'],
        ['the same file name from another origin', 'https://elsewhere.example/vendor/avatars/AvatarSample_A.vrm'],
        ['a protocol-relative URL', '//elsewhere.example/vendor/avatars/AvatarSample_A.vrm'],
        ['a nested path that merely contains the folder', 'uploads/vendor/avatars/AvatarSample_A.vrm'],
        ['a file in the folder the catalog does not list', 'vendor/avatars/Uploaded_Model.vrm'],
    ])('%s is never declared by the catalog', (_, url) => {
        expect(A.catalogDeclaration(catalog, { url, name: 'AvatarSample A' }, Id, 'http://app.test')).toBeNull();
    });

    test('a declaration must be the boolean, and Forge still vetoes a library file whose bytes differ', () => {
        const base = { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A' };
        const stringly = { items: [{ file: 'AvatarSample_A.vrm', depictsAdult: 'true' }] };
        expect(A.catalogDeclaration(stringly, base, Id)).toBeNull();
        const declared = A.catalogDeclaration(catalog, base, Id);
        expect(A.decide(Id.resolve(base), [], false, declared)).toMatchObject({ ok: false });
    });

    test('a worn Forge look is judged by the declared avatar it was made on', () => {
        const g = {
            NEXUS_AVATAR_IDENTITY: Id,
            NEXUS_VIEWER: {
                avatarManager: { getCurrent: () => ({ url: 'blob:http://app.test/9#look.vrm', name: 'x' }) },
            },
        };
        const W = {
            service: {
                controller: {
                    original: { url: 'vendor/avatars/Vita.vrm', name: 'Vita' },
                    activeLook: { id: 'look' },
                    wornUrl: 'blob:http://app.test/9#look.vrm',
                },
            },
        };
        expect(A.whoIsOnScreen(g, W)).toMatchObject({ kind: 'external', file: 'Vita.vrm' });
        return A.check({ ...g, NEXUS_WARDROBE: W }, { catalog }).then((r) => expect(r).toMatchObject({ ok: true }));
    });
});

test('PW8. an avatar uploaded after a haul is judged as itself, never as the haul’s original', async () => {
    const Id = require('../../src/wardrobe/AvatarIdentity.js');
    const fs = require('fs');
    const path = require('path');
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vendor/avatars/avatars.json'), 'utf8'));
    // What the browser walkthrough found: a haul had snapshotted AvatarSample A, then the person
    // loaded an uploaded VRM (a blob: too). It opened Private as AvatarSample A.
    const controller = {
        original: { url: '/vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A' },
        activeLook: null,
        wornUrl: null,
    };
    const g = {
        NEXUS_AVATAR_IDENTITY: Id,
        NEXUS_WARDROBE: { service: { controller } },
        NEXUS_VIEWER: {
            avatarManager: {
                getCurrent: () => ({ url: 'blob:http://app.test/up#upload.vrm', name: 'AvatarSample_A.vrm' }),
            },
        },
    };
    expect(A.whoIsOnScreen(g, g.NEXUS_WARDROBE)).toMatchObject({ kind: 'external' });
    expect(await A.check(g, { catalog })).toMatchObject({ ok: false });
    A._reset();
    // Still a look in hand, but a different blob on screen: also judged as itself.
    Object.assign(controller, { activeLook: { id: 'x' }, wornUrl: 'blob:http://app.test/other#look.vrm' });
    expect(await A.check(g, { catalog })).toMatchObject({ ok: false });
    A._reset();
});
