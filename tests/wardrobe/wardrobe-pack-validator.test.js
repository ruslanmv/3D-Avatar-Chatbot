/**
 * W11. Every look crosses one validator: a pack can describe a look, never grant it anything,
 * and a look is offered only on the avatar it was fitted to.
 */
const fs = require('fs');
const path = require('path');
const Validator = require('../../src/wardrobe/WardrobePackValidator.js');

const MANIFEST_URL = 'https://app.example/vendor/wardrobe/wardrobe.json';
const SHA_A = 'b86b0b8a66d48911431d6f920a5211a974226f83aa672eca3f3dfade58ac346e';
const HASH = 'a'.repeat(64);
const SAMPLE_A = { kind: 'library', slug: 'avatar-sample-a', file: 'AvatarSample_A.vrm', sha256: SHA_A, name: 'A' };
const SAMPLE_B = { kind: 'library', slug: 'avatar-sample-b', file: 'AvatarSample_B.vrm', sha256: 'b'.repeat(64) };

function v2(looks, extra = {}) {
    return {
        schemaVersion: 2,
        pack: { id: 'homepilot-default', version: '2026.09.27', generatedBy: '3D-Wardrobe-Forge' },
        sourceName: 'HomePilot',
        visibility: 'public',
        avatars: [{ avatarId: 'avatar-sample-a', sourceSha256: SHA_A, license: { spdx: 'CC0-1.0' } }],
        looks,
        ...extra,
    };
}

function look(fields = {}) {
    return {
        id: 'crop-top-jeans',
        name: 'Crop top & jeans',
        avatarId: 'avatar-sample-a',
        vrmUrl: 'looks/avatar-sample-a/crop-top-jeans/2026.09.27/look.vrm',
        previewUrl: 'looks/avatar-sample-a/crop-top-jeans/2026.09.27/preview.webp',
        sha256: HASH,
        bytes: 1000,
        rating: 'general',
        ...fields,
    };
}

const read = (manifest, options = {}) =>
    Validator.validateManifest(manifest, { manifestUrl: MANIFEST_URL, origin: 'builtin', ...options });

describe('validateManifest', () => {
    test('a v1 manifest still lists, with the source the drawer always showed', () => {
        const result = read(
            { looks: [{ id: 'look_1', name: 'Evening', vrmUrl: 'looks/a/look.vrm' }] },
            {
                legacySource: 'static',
            }
        );
        expect(result.ok).toBe(true);
        expect(result.looks).toHaveLength(1);
        expect(result.looks[0]).toMatchObject({
            id: 'look_1',
            source: 'static',
            avatarId: null,
            rating: null,
            vrmUrl: 'https://app.example/vendor/wardrobe/looks/a/look.vrm',
        });
    });

    test('a v2 look keeps its hash, size, pack and the source hash of the avatar it was fitted to', () => {
        const [normalized] = read(v2([look()])).looks;
        expect(normalized.key).toBe('builtin:homepilot-default:avatar-sample-a:crop-top-jeans');
        expect(normalized.sha256).toBe(HASH);
        expect(normalized.bytes).toBe(1000);
        expect(normalized.fit.sourceSha256).toBe(SHA_A);
        expect(normalized.pack).toEqual({ id: 'homepilot-default', version: '2026.09.27', schemaVersion: 2 });
        expect(normalized.sourceLabel).toBe('HomePilot');
    });

    test('the same look id for two avatars is two looks, never merged', () => {
        const manifest = v2([look(), look({ avatarId: 'avatar-sample-b' })]);
        manifest.avatars.push({ avatarId: 'avatar-sample-b', sourceSha256: 'b'.repeat(64) });
        const keys = read(manifest).looks.map((entry) => entry.key);
        expect(new Set(keys).size).toBe(2);
    });

    test('a pack cannot grant itself anything: permission fields are not carried', () => {
        const [normalized] = read(
            v2([look({ depictsAdult: true, trusted: true, private: false, declaredBy: 'operator' })], {
                depictsAdult: true,
                trusted: true,
            })
        ).looks;
        ['depictsAdult', 'trusted', 'private', 'declaredBy'].forEach((field) =>
            expect(normalized).not.toHaveProperty(field)
        );
    });

    test('an unknown rating counts as the strictest', () => {
        expect(read(v2([look({ rating: 'family-friendly' })])).looks[0].rating).toBe('intimate');
    });

    test.each([
        ['javascript:alert(1)', 'javascript: URLs are not allowed'],
        ['data:model/gltf-binary;base64,AAAA', 'data: URLs are not allowed'],
        ['blob:https://app.example/x', 'blob: URLs are not allowed'],
        ['../../avatars/AvatarSample_A.vrm', 'leaves the pack folder'],
        ['looks/%2e%2e/%2e%2e/secret.vrm', 'leaves the pack folder'],
        ['//evil.example/look.vrm', 'protocol-relative'],
        ['looks\\a\\look.vrm', 'backslashes'],
        ['http://evil.example/look.vrm', 'http: URLs are not allowed'],
        ['/vendor/avatars/AvatarSample_A.vrm', 'absolute paths are not allowed'],
        ['looks/a/look.glb', 'not a .vrm file'],
    ])('refuses vrmUrl %s, and still lists the rest', (url, reason) => {
        const result = read(v2([look({ id: 'bad', vrmUrl: url }), look()]));
        expect(result.ok).toBe(true);
        expect(result.looks.map((entry) => entry.id)).toEqual(['crop-top-jeans']);
        expect(result.rejected[0].id).toBe('bad');
        expect(result.rejected[0].reason).toContain(reason);
    });

    test('https and same-origin http are allowed; site paths only where the manifest is ours', () => {
        expect(read(v2([look({ vrmUrl: 'https://cdn.example/look.vrm' })])).looks).toHaveLength(1);
        const local = Validator.validateManifest(v2([look({ vrmUrl: 'http://localhost:8080/x/look.vrm' })]), {
            manifestUrl: 'http://localhost:8080/vendor/wardrobe/wardrobe.json',
        });
        expect(local.looks).toHaveLength(1);
        const site = read(v2([look({ vrmUrl: '/vendor/wardrobe/looks/look.vrm' })]), { allowRootPaths: true });
        expect(site.looks).toHaveLength(1);
    });

    test('a v2 look must name its hash, and sizes have limits', () => {
        expect(read(v2([look({ sha256: undefined })])).rejected[0].reason).toContain('sha256');
        expect(read(v2([look({ sha256: 'not-a-hash' })])).rejected[0].reason).toContain('SHA-256');
        expect(read(v2([look({ bytes: Validator.LIMITS.vrmBytes + 1 })])).rejected[0].reason).toContain('bytes');
    });

    test('a manifest that cannot be used fails whole, with a reason', () => {
        expect(read(null).reason).toBe('not a wardrobe manifest');
        expect(read({ schemaVersion: 3, looks: [] }).reason).toContain('newer Wardrobe Forge');
        expect(read({ schemaVersion: 2 }).reason).toContain('no looks');
    });
});

describe('visibility', () => {
    const [normalized] = read(v2([look()])).looks;

    test('a look shows on the avatar it was made for', () => {
        expect(Validator.visibility(normalized, { identity: SAMPLE_A })).toEqual({ visible: true, reason: null });
    });

    test('never on another avatar, nor on a different version of hers', () => {
        expect(Validator.visibility(normalized, { identity: SAMPLE_B }).reason).toBe('made for another avatar');
        expect(Validator.visibility(normalized, { identity: null }).visible).toBe(false);
        const changed = { ...SAMPLE_A, sha256: 'c'.repeat(64) };
        expect(Validator.visibility(normalized, { identity: changed }).reason).toBe(
            'made for a different version of this avatar'
        );
    });

    test('an unowned (v1 or "default") look belongs to anyone', () => {
        expect(Validator.visibility({ avatarId: null, rating: null }, { unratedAs: 'general' }).visible).toBe(true);
        expect(Validator.visibility({ avatarId: 'default' }, { unratedAs: 'general' }).visible).toBe(true);
    });

    test('a rating only hides: anything but general needs the app’s own private gate', () => {
        const swim = { ...normalized, rating: 'swimwear' };
        expect(Validator.visibility(swim, { identity: SAMPLE_A }).reason).toBe('private');
        expect(Validator.visibility(swim, { identity: SAMPLE_A, privateOpen: 'yes' }).visible).toBe(false);
        expect(Validator.visibility(swim, { identity: SAMPLE_A, privateOpen: true }).visible).toBe(true);
        const unrated = { ...normalized, rating: null };
        expect(Validator.visibility(unrated, { identity: SAMPLE_A }).visible).toBe(false);
        expect(Validator.visibility(unrated, { identity: SAMPLE_A, unratedAs: 'general' }).visible).toBe(true);
    });
});

describe('verifying the bytes', () => {
    const avatar = fs.readFileSync(path.join(__dirname, '../../vendor/avatars/AvatarSample_A.vrm'));
    const buffer = avatar.buffer.slice(avatar.byteOffset, avatar.byteOffset + avatar.byteLength);

    test('a real VRM is read from its header and JSON chunk', () => {
        expect(Validator.inspectVrm(buffer)).toEqual({ ok: true, spec: 'VRM0' });
    });

    test('not a glTF, a truncated one, and one with no humanoid are refused', () => {
        expect(Validator.inspectVrm(Buffer.from('<html>not a model</html>')).reason).toBe('not a binary glTF file');
        expect(Validator.inspectVrm(new Uint8Array(avatar.subarray(0, 4096))).reason).toBe('the file is truncated');
        const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }) + '  ');
        const glb = new Uint8Array(20 + json.length);
        const view = new DataView(glb.buffer);
        view.setUint32(0, 0x46546c67, true);
        view.setUint32(4, 2, true);
        view.setUint32(8, glb.length, true);
        view.setUint32(12, json.length, true);
        view.setUint32(16, 0x4e4f534a, true);
        glb.set(json, 20);
        expect(Validator.inspectVrm(glb).reason).toBe('not a VRM (no humanoid)');
    });

    test('size and SHA-256 must be what the pack says', async () => {
        const sha256 = await Validator.sha256Hex(buffer);
        expect(sha256).toBe(SHA_A);
        expect((await Validator.verifyBytes(buffer, { sha256, bytes: avatar.length })).ok).toBe(true);
        expect((await Validator.verifyBytes(buffer, { sha256, bytes: 5 })).reason).toContain('size');
        const tampered = new Uint8Array(buffer.slice(0));
        tampered[tampered.length - 1] ^= 0xff;
        expect((await Validator.verifyBytes(tampered.buffer, { sha256 })).reason).toContain('SHA-256');
    });

    test('fetchVerified hands the loader a blob URL it reads as a VRM, or refuses with a reason', async () => {
        const sha256 = await Validator.sha256Hex(buffer);
        const URLImpl = { createObjectURL: jest.fn(() => 'blob:https://app.example/1'), revokeObjectURL: jest.fn() };
        const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
        const worn = await Validator.fetchVerified(
            { vrmUrl: 'https://app.example/look.vrm', sha256 },
            {
                fetchImpl,
                URLImpl,
            }
        );
        expect(worn.url).toBe('blob:https://app.example/1#look.vrm');
        worn.revoke();
        expect(URLImpl.revokeObjectURL).toHaveBeenCalledWith('blob:https://app.example/1');

        await expect(
            Validator.fetchVerified({ vrmUrl: 'x.vrm', sha256: HASH }, { fetchImpl, URLImpl })
        ).rejects.toMatchObject({ reason: 'look_failed_verification' });
        expect(URLImpl.createObjectURL).toHaveBeenCalledTimes(1);
    });
});
