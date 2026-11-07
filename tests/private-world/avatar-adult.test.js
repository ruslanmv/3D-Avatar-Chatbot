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
    const W = { service: { controller: { original: { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'A' } } } };
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
