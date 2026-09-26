/**
 * W4. Which avatar Forge is asked to dress.
 *
 * The properties that matter: a built-in avatar goes to Forge's library route by slug, a
 * look is never mistaken for an avatar (identity comes from the original, not the current
 * look), and a file merely named like a built-in one is not trusted as one.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Identity = require('../../src/wardrobe/AvatarIdentity.js');

const ROOT = path.resolve(__dirname, '../..');

describe('AvatarIdentity', () => {
    test('each bundled avatar resolves to its Forge slug', () => {
        const slugs = Identity.LIBRARY.map(
            (entry) => Identity.resolve({ url: `vendor/avatars/${entry.file}`, name: entry.file }).slug
        );
        expect(slugs).toEqual(['avatar-sample-a', 'avatar-sample-b', 'avatar-sample-c', 'fem-vroid', 'masc-vroid']);
    });

    test('an absolute URL into the bundled folder, with a query string, is still the library avatar', () => {
        const identity = Identity.resolve({ url: 'https://yourfriend.online/vendor/avatars/AvatarSample_A.vrm?v=3' });
        expect(identity).toMatchObject({ kind: 'library', slug: 'avatar-sample-a' });
    });

    test('the pinned hashes are the bytes this repository ships', () => {
        for (const entry of Identity.LIBRARY) {
            const file = path.join(ROOT, 'vendor', 'avatars', entry.file);
            if (!fs.existsSync(file)) continue; // a checkout without the binaries
            const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            expect(digest).toBe(entry.sha256);
        }
    });

    test('a file only named like a built-in avatar is external', () => {
        for (const url of ['blob:https://yourfriend.online/1234', 'uploads/AvatarSample_A.vrm', 'AvatarSample_A.vrm']) {
            expect(Identity.resolve({ url, name: 'Mine' }).kind).toBe('external');
        }
    });

    test('an external avatar carries its URL and licence terms for the generate route', () => {
        const identity = Identity.resolve(
            { url: 'https://hub.example/models/aiko.vrm', name: 'Aiko' },
            { conditionsOfUse: { modification: 'allow' } }
        );
        expect(identity).toEqual({
            kind: 'external',
            url: 'https://hub.example/models/aiko.vrm',
            file: 'aiko.vrm',
            name: 'Aiko',
            conditionsOfUse: { modification: 'allow' },
        });
    });

    test('before the avatar has loaded there is no identity, with a reason', () => {
        expect(Identity.resolve(null)).toMatchObject({ kind: 'unknown' });
        expect(Identity.resolve({ name: 'x' }).why).toMatch(/finish loading/);
    });

    test('a look is never taken for an avatar: the caller passes the original, not the current', () => {
        // What WardrobeController.snapshot() holds while a look is worn.
        const original = { url: 'vendor/avatars/fem_vroid.vrm', name: 'VRoid Female', index: 4 };
        const current = { url: 'https://forge.example/v1/assets/looks/look_1/look.vrm', name: 'Look', index: -1 };
        expect(Identity.resolve(original).slug).toBe('fem-vroid');
        expect(Identity.resolve(current).kind).toBe('external'); // why the original must be passed
    });

    test('matchesPublished compares against what a running Forge publishes', () => {
        const identity = Identity.resolve({ url: 'vendor/avatars/AvatarSample_B.vrm' });
        const entry = Identity.LIBRARY[1];
        expect(Identity.matchesPublished(identity, [{ slug: entry.slug, sha256: entry.sha256, available: true }])).toBe(
            true
        );
        expect(
            Identity.matchesPublished(identity, [{ slug: entry.slug, sha256: 'f'.repeat(64), available: true }])
        ).toBe(false);
        expect(
            Identity.matchesPublished(identity, [{ slug: entry.slug, sha256: entry.sha256, available: false }])
        ).toBe(false);
        expect(Identity.matchesPublished(identity, [])).toBe(false);
        expect(Identity.matchesPublished(identity, null)).toBe(null);
        expect(Identity.matchesPublished(Identity.resolve({ url: 'x/y.vrm' }), [])).toBe(null);
    });
});
