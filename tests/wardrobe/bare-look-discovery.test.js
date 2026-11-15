/** Transport/renderer regressions; these metadata fixtures are not visual avatar acceptance. */
const fs = require('fs');
const path = require('path');
const Validator = require('../../src/wardrobe/WardrobePackValidator.js');
const TryOn = require('../../src/wardrobe/TryOnHaulActivity.js');
const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
const Client = require('../../src/wardrobe/WardrobeClient.js').WardrobeClient;
const Controller = require('../../src/wardrobe/WardrobeController.js');
const SOURCE = 'a'.repeat(64);
const LOOK = {
    id: 'look_bare',
    name: 'Bare authored body',
    templateId: 'body-bare-v1',
    bare: true,
    private: true,
    sha256: 'b'.repeat(64),
    sourceAvatarHash: SOURCE,
    vrmUrl: 'https://forge.example/look.vrm',
};

function glb({ tagged = true, garment = false, anatomy = false, primitiveGarment = false } = {}) {
    const json = {
        asset: { version: '2.0' },
        extensions: { VRMC_vrm: { humanoid: { humanBones: { hips: { node: 0 } } } } },
        nodes: [{ mesh: 0 }],
        meshes: [
            {
                primitives: [
                    { material: 0, ...(primitiveGarment ? { extras: { wardrobeForge: { kind: 'garment' } } } : {}) },
                ],
            },
        ],
        materials: [
            {
                name: garment ? 'Test_Bottoms_01_CLOTH' : 'Authored skin',
                ...(anatomy ? { extras: { authoredAnatomy: true } } : {}),
            },
        ],
        ...(tagged ? { extras: { wardrobeForge: { bare: true, templateId: 'body-bare-v1' } } } : {}),
    };
    const encoded = Buffer.from(JSON.stringify(json));
    const length = Math.ceil(encoded.length / 4) * 4;
    const result = Buffer.alloc(20 + length, 0x20);
    result.write('glTF');
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(length, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    encoded.copy(result, 20);
    return new Uint8Array(result);
}

async function listed(looks, privateOpen = true) {
    const library = {
        available: true,
        client: { getWardrobe: jest.fn(async () => ({ looks })) },
        resolveUrl: (x) => x,
    };
    const found = await TryOn.loadLooks({
        library,
        identity: { kind: 'library', slug: 'adult', sha256: SOURCE },
        privateOpen,
    });
    return { found, library };
}

test('Forge bare metadata survives discovery and satisfies everything-off selection', async () => {
    const { found, library } = await listed([LOOK]);
    expect(library.client.getWardrobe).toHaveBeenCalledWith('adult', { includePrivate: true });
    expect(found[0]).toMatchObject(LOOK);
    expect(Engine.undressPlan({ looks: found, naked: true, step: 'all' })).toMatchObject({ state: 'bare', look: LOOK });
});

test('closed Private, wrong source, public bare, and unpinned assets are not offered', async () => {
    expect((await listed([LOOK], false)).found).toEqual([]);
    expect((await listed([{ ...LOOK, sourceAvatarHash: 'c'.repeat(64) }])).found).toEqual([]);
    expect((await listed([{ ...LOOK, private: false }])).found).toEqual([]);
    expect((await listed([{ ...LOOK, sha256: null }])).found).toEqual([]);
});

test('downloaded bytes must be a pinned, tagged bare VRM without retained clothing', async () => {
    for (const [options, expected] of [
        [{}, true],
        [{ tagged: false }, false],
        [{ garment: true }, false],
        [{ primitiveGarment: true }, false],
        [{ garment: true, anatomy: true }, true],
    ]) {
        const bytes = glb(options);
        const sha256 = await Validator.sha256Hex(bytes);
        expect((await Validator.verifyBytes(bytes, { ...LOOK, sha256 })).ok).toBe(expected);
    }
    expect((await Validator.verifyBytes(glb(), { ...LOOK, sha256: null })).ok).toBe(false);
    // A hash of the ordinary, fully clothed bundled VRM is not proof of a bare body.
    const clothed = fs.readFileSync(path.join(__dirname, '../../vendor/avatars/AvatarSample_A.vrm'));
    const sha256 = await Validator.sha256Hex(clothed);
    expect((await Validator.verifyBytes(clothed, { ...LOOK, sha256 })).ok).toBe(false);
});

test('operator session headers are opt-in and never sent to another asset host', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ looks: [] }) }));
    const client = new Client({ baseUrl: 'https://forge.example', fetchImpl });
    client.setAdminSession('operator-session');
    await client.getWardrobe('adult');
    expect(fetchImpl.mock.calls[0][1].headers['X-Wardrobe-Admin']).toBeUndefined();
    await client.getWardrobe('adult', { includePrivate: true });
    expect(fetchImpl.mock.calls[1][1].headers['X-Wardrobe-Admin']).toBe('operator-session');
    expect(fetchImpl.mock.calls[1][1].redirect).toBe('error');
    await client.fetchAsset('https://forge.example/v1/assets/looks/x/look.vrm', { private: true });
    expect(fetchImpl.mock.calls[2][1].headers['X-Wardrobe-Admin']).toBe('operator-session');
    expect(fetchImpl.mock.calls[2][1].redirect).toBe('error');
    await client.fetchAsset('https://unrelated.example/look.vrm', { private: true });
    expect(fetchImpl.mock.calls[3][1].headers).toEqual({});
    client.setAdminSession(null);
    await client.getWardrobe('adult', { includePrivate: true });
    expect(fetchImpl.mock.calls[4][1].headers['X-Wardrobe-Admin']).toBeUndefined();
});

function controller({ failTag = false, drift = false } = {}) {
    const original = { url: 'original.vrm', name: 'Adult companion', index: 0 };
    const manager = {
        current: original,
        currentRoot: { userData: {} },
        getCurrent() {
            return this.current;
        },
        setAvatarByUrl: jest.fn(async function (url, name, index) {
            this.current = { url: drift && url.startsWith('blob:') ? 'other-character.vrm' : url, name, index };
            this.currentRoot = {
                userData: {
                    ...(url.startsWith('blob:') && !failTag
                        ? { wardrobeForge: { bare: true, templateId: 'body-bare-v1' } }
                        : {}),
                },
            };
        }),
    };
    const verified = { bare: true, sha256: LOOK.sha256, url: 'blob:verified#look.vrm', revoke: jest.fn() };
    const instance = new Controller({
        forge: { resolveUrl: (x) => x },
        viewer: { avatarManager: manager },
        verifyLook: jest.fn(async () => verified),
    });
    return { instance, manager, verified, original };
}

test('success requires the actual loaded scene tag and supports redress', async () => {
    const { instance, manager } = controller();
    await instance.applyLook(LOOK);
    expect(manager.getCurrent().url).toBe('blob:verified#look.vrm');
    expect(manager.currentRoot.userData.wardrobeForge.bare).toBe(true);
    await instance.restore();
    expect(manager.getCurrent().url).toBe('original.vrm');
});

test('a failed renderer confirmation restores the previous outfit and revokes the failed blob', async () => {
    const { instance, manager, verified } = controller({ failTag: true });
    await expect(instance.applyLook(LOOK)).rejects.toMatchObject({ reason: 'not-rendered' });
    expect(manager.getCurrent().url).toBe('original.vrm');
    expect(instance.activeLook).toBeNull();
    expect(verified.revoke).toHaveBeenCalledTimes(1);
});

test('a superseded bare load cannot replace a newly selected character during rollback', async () => {
    const { instance, manager } = controller({ drift: true });
    await expect(instance.applyLook(LOOK)).rejects.toMatchObject({ reason: 'not-rendered' });
    expect(manager.getCurrent().url).toBe('other-character.vrm');
    expect(manager.setAvatarByUrl).toHaveBeenCalledTimes(1);
});
