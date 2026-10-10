/**
 * W11. Sources in order, looks keyed by where they came from, and the drawer offering her
 * only the looks made for her — against the pack this repository actually ships.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vendor/wardrobe/wardrobe.json'), 'utf8'));

function load() {
    jest.resetModules();
    [
        'NEXUS_WARDROBE_PACK_VALIDATOR',
        'NEXUS_WARDROBE_REGISTRY',
        'NEXUS_AVATAR_IDENTITY',
        'NEXUS_WARDROBE_CLIENT',
        'NEXUS_STATIC_WARDROBE_SOURCE',
        'NEXUS_REMOTE_WARDROBE_SOURCE',
        'NEXUS_WARDROBE_CONTROLLER',
        'NEXUS_WARDROBE_SERVICE',
    ].forEach((name) => delete window[name]);
    const Validator = require('../../src/wardrobe/WardrobePackValidator.js');
    const Registry = require('../../src/wardrobe/WardrobeRegistry.js');
    require('../../src/wardrobe/AvatarIdentity.js');
    require('../../src/wardrobe/WardrobeClient.js');
    require('../../src/wardrobe/StaticWardrobeSource.js');
    require('../../src/wardrobe/RemoteWardrobeSource.js');
    const Controller = require('../../src/wardrobe/WardrobeController.js');
    const Service = require('../../src/wardrobe/WardrobeService.js');
    return { Validator, Registry, Controller, Service };
}

function viewerWearing(file) {
    let current = { url: `vendor/avatars/${file}`, name: file, index: 0 };
    const manager = {
        getCurrent: () => current,
        setAvatarByUrl: jest.fn(async (url, name) => {
            current = { url, name };
        }),
    };
    return { viewer: { avatarManager: manager }, manager };
}

describe('WardrobeRegistry', () => {
    test('sources list in priority order, a failing one is skipped, keys never merge by name', async () => {
        const { Registry } = load();
        const registry = new Registry();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        registry.add({ id: 'forge', priority: 3, listLooks: async () => [{ id: 'same', vrmUrl: 'https://f/1.vrm' }] });
        registry.add({ id: 'imported', priority: 2, listLooks: async () => Promise.reject(new Error('cold')) });
        registry.add({ id: 'builtin', priority: 1, listLooks: async () => [{ id: 'same', vrmUrl: '/b/1.vrm' }] });
        const { looks, errors } = await registry.list();
        expect(looks.map((look) => look.key)).toEqual(['builtin:same', 'forge:same']);
        expect(errors).toEqual([{ source: 'imported', error: expect.any(Error) }]);
        warn.mockRestore();
    });

    test('the UI asks what a source can do, and an unavailable one cannot', () => {
        const { Registry } = load();
        const registry = new Registry();
        registry.add({ id: 'builtin', capabilities: { list: true, generate: false }, listLooks: async () => [] });
        expect(registry.can('generate')).toBe(false);
        registry.add({
            id: 'forge',
            capabilities: { list: true, generate: true },
            available: () => false,
            listLooks: async () => [],
        });
        expect(registry.can('generate')).toBe(false);
    });
});

describe('the shipped wardrobe', () => {
    beforeEach(() => {
        window.fetch = jest.fn(async () => ({ ok: true, json: async () => MANIFEST }));
    });

    test('is a public v2 pack of general looks, every one for an avatar this app ships', () => {
        const { Validator } = load();
        const Identity = window.NEXUS_AVATAR_IDENTITY;
        expect(MANIFEST.schemaVersion).toBe(2);
        expect(MANIFEST.visibility).toBe('public');
        const result = Validator.validateManifest(MANIFEST, {
            manifestUrl: 'http://localhost/vendor/wardrobe/wardrobe.json',
        });
        expect(result.rejected).toEqual([]);
        expect(result.looks.length).toBeGreaterThan(0);
        const slugs = Identity.LIBRARY.map((entry) => entry.slug);
        result.looks.forEach((look) => {
            expect(look.rating).toBe('general');
            expect(slugs).toContain(look.avatarId);
        });
    });

    test('the drawer offers her only the looks made for her, labelled with where they came from', async () => {
        const { Service } = load();
        const { viewer } = viewerWearing('AvatarSample_A.vrm');
        const service = new Service({ config: { staticManifest: '/vendor/wardrobe/wardrobe.json' }, viewer });
        const looks = await service.listLooks();
        const expected = MANIFEST.looks.filter((look) => look.avatarId === 'avatar-sample-a');
        expect(looks.map((look) => look.id).sort()).toEqual(expected.map((look) => look.id).sort());
        looks.forEach((look) => expect(look.sourceLabel).toBe('HomePilot'));
    });

    test('an avatar the pack was not made for is offered none of it', async () => {
        const { Service } = load();
        const { viewer } = viewerWearing('Vita.vrm');
        const service = new Service({ config: { staticManifest: '/vendor/wardrobe/wardrobe.json' }, viewer });
        expect(await service.listLooks()).toEqual([]);
    });

    test('a look is worn only as the bytes its pack names, and she keeps what she has on otherwise', async () => {
        const { Controller } = load();
        const { viewer, manager } = viewerWearing('AvatarSample_A.vrm');
        const revoke = jest.fn();
        const verifyLook = jest.fn(async () => ({ url: 'blob:x#look.vrm', revoke }));
        const controller = new Controller({ forge: { resolveUrl: (url) => url }, viewer, verifyLook });

        await controller.applyLook({ name: 'Crop top', vrmUrl: '/v/look.vrm', sha256: 'a'.repeat(64) });
        expect(manager.setAvatarByUrl).toHaveBeenLastCalledWith('blob:x#look.vrm', 'Crop top', -1);
        await controller.restore();
        expect(revoke).toHaveBeenCalledTimes(1);

        // No hash: the old path, unchanged.
        await controller.applyLook({ name: 'Forge look', vrmUrl: 'https://f/look.vrm' });
        expect(manager.setAvatarByUrl).toHaveBeenLastCalledWith('https://f/look.vrm', 'Forge look', -1);

        verifyLook.mockRejectedValueOnce(Object.assign(new Error('mismatch'), { reason: 'look_failed_verification' }));
        const calls = manager.setAvatarByUrl.mock.calls.length;
        await expect(
            controller.applyLook({ name: 'Bad', vrmUrl: '/v/bad.vrm', sha256: 'b'.repeat(64) })
        ).rejects.toThrow('mismatch');
        expect(manager.setAvatarByUrl.mock.calls.length).toBe(calls);
    });

    test('forge: {enabled, baseUrl} names a Forge; enabled false means none, whatever else says so', () => {
        load();
        delete window.NEXUS_WARDROBE_CONFIG_API;
        const Config = require('../../src/wardrobe/WardrobeConfig.js');
        window.NEXUS_WARDROBE_CONFIG = { forge: { enabled: true, baseUrl: 'https://forge.example/' } };
        expect(Config.resolveWardrobeConfig()).toMatchObject({ apiUrl: 'https://forge.example', verifyLooks: true });
        window.localStorage.setItem('wardrobe_forge_url', 'https://stored.example');
        window.NEXUS_WARDROBE_CONFIG = { apiUrl: 'https://old.example', forge: { enabled: false, baseUrl: '' } };
        expect(Config.resolveWardrobeConfig()).toMatchObject({ apiUrl: '', remoteGeneration: false });
        window.localStorage.clear();
        delete window.NEXUS_WARDROBE_CONFIG;
    });
});
