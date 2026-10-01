/**
 * The two seams where the wardrobe feature disagreed with the thing on the other side of it.
 *
 * W1 is the wire contract with Wardrobe Forge. `AvatarInput.license.conditionsOfUse` is typed
 * `dict[str, str]` with a default factory — not optional — so a null is a 422 and so is a
 * boolean value. The client sent exactly that null on the one path the block exists for: the
 * user answering "yes, I have permission" about an avatar whose terms are unknown, which is
 * precisely when there are no conditions to send. Verified against the Forge beta branch's
 * pydantic model: `{'conditionsOfUse': None}` → "Input should be a valid dictionary".
 *
 * W2 is the contract with the user. Snapshot-and-restore had one owner, the controller, and
 * the controller was built only when a Forge server was configured — so in the default static
 * deployment the service swapped avatars itself, nothing was snapshotted, `restore()` returned
 * false, and the drawer said "Original avatar restored" regardless.
 */

/* global describe, test, expect, beforeEach, jest */

function loadWardrobe() {
    jest.resetModules();
    require('../src/wardrobe/WardrobeConfig.js');
    require('../src/wardrobe/WardrobeClient.js');
    require('../src/wardrobe/WardrobeController.js');
    require('../src/wardrobe/StaticWardrobeSource.js');
    require('../src/wardrobe/RemoteWardrobeSource.js');
    return require('../src/wardrobe/WardrobeService.js');
}

/** The parts of AvatarManager this feature actually uses, and a log of what it was asked. */
function fakeAvatarManager(current) {
    return {
        current: current,
        calls: [],
        getCurrent() {
            return this.current;
        },
        async setAvatarByUrl(url, name, index) {
            this.calls.push({ url, name, index });
            this.current = { url, name, index };
            return this.current;
        },
        frameAvatar: jest.fn(),
    };
}

const ORIGINAL = { url: 'https://app.example/mira.vrm', name: 'Mira', index: 3 };

function staticService(manager) {
    const Service = loadWardrobe();
    return new Service({
        config: { staticManifest: '/vendor/wardrobe/wardrobe.json', apiUrl: '', remoteGeneration: false },
        viewer: { avatarManager: manager },
    });
}

beforeEach(() => {
    window.localStorage.clear();
    window.fetch = jest.fn();
    delete window.NEXUS_WARDROBE_CONFIG;
});

describe('W1 — the licence block Forge will accept', () => {
    function bodyOf(fetchImpl) {
        return JSON.parse(fetchImpl.mock.calls[0][1].body);
    }

    function client() {
        const ClientApi = require('../src/wardrobe/WardrobeClient.js');
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ jobId: 'job_1', status: 'queued' }),
        });
        return { api: new ClientApi.WardrobeClient({ baseUrl: 'https://forge.example', fetchImpl }), fetchImpl };
    }

    test('attesting with unknown terms omits conditionsOfUse instead of sending null', async () => {
        const { api, fetchImpl } = client();
        await api.generate({
            avatarUrl: ORIGINAL.url,
            prompt: 'black satin cocktail dress',
            conditionsOfUse: null,
            attestModificationAllowed: true,
        });

        const license = bodyOf(fetchImpl).avatar.license;
        expect(license.userAttestsModificationAllowed).toBe(true);
        expect('conditionsOfUse' in license).toBe(false);
    });

    test('known terms are sent as strings, whatever VRM Manager stored', async () => {
        const { api, fetchImpl } = client();
        await api.generate({
            avatarUrl: ORIGINAL.url,
            prompt: 'burgundy evening dress',
            conditionsOfUse: { modification: 'default', redistribution: true, credit: null, avatarUse: '' },
        });

        const license = bodyOf(fetchImpl).avatar.license;
        expect(license.conditionsOfUse).toEqual({ modification: 'default', redistribution: 'true' });
        for (const value of Object.values(license.conditionsOfUse)) expect(typeof value).toBe('string');
    });

    test('with nothing to say about the licence, no licence block is sent at all', async () => {
        const { api, fetchImpl } = client();
        await api.generate({ avatarUrl: ORIGINAL.url, prompt: 'summer dress' });
        expect('license' in bodyOf(fetchImpl).avatar).toBe(false);
    });
});

describe('W2 — restore works in the static deployment that ships', () => {
    const LOOK = { id: 'look_1', name: 'Evening', vrmUrl: 'https://app.example/looks/evening.vrm' };

    test('wearing a static look snapshots the avatar, and restore puts it back', async () => {
        const manager = fakeAvatarManager({ ...ORIGINAL });
        const service = staticService(manager);
        expect(service.remoteEnabled).toBe(false);

        await service.applyLook(LOOK);
        expect(manager.calls[0]).toEqual({ url: LOOK.vrmUrl, name: 'Evening', index: -1 });

        await expect(service.restore()).resolves.toBe(true);
        expect(manager.calls[1]).toEqual({ url: ORIGINAL.url, name: ORIGINAL.name, index: ORIGINAL.index });
    });

    test('restoring before anything was worn answers false rather than claiming success', async () => {
        const service = staticService(fakeAvatarManager({ ...ORIGINAL }));
        await expect(service.restore()).resolves.toBe(false);
    });

    test('a haul of looks already in the bundle needs no server', async () => {
        const manager = fakeAvatarManager({ ...ORIGINAL });
        const service = staticService(manager);
        const second = { id: 'look_2', name: 'Coat', vrmUrl: 'https://app.example/looks/coat.vrm' };

        const worn = await service.tryOnHaul([LOOK, second], { holdMs: 0 });

        expect(worn.map((look) => look.id)).toEqual(['look_1', 'look_2']);
        expect(manager.calls.map((call) => call.url)).toEqual([LOOK.vrmUrl, second.vrmUrl, ORIGINAL.url]);
    });

    test('a haul entry that is a prompt still refuses, with the reason', async () => {
        const service = staticService(fakeAvatarManager({ ...ORIGINAL }));
        await expect(service.tryOnHaul(['a red dress'], { holdMs: 0 })).rejects.toThrow(/apiUrl/i);
    });
});

describe('W3 — a look is never worn without a way back', () => {
    const LOOK = { id: 'look_1', name: 'Evening', vrmUrl: 'https://app.example/looks/evening.vrm' };

    test('refuses while the startup avatar is still loading, and changes nothing', async () => {
        const manager = fakeAvatarManager(null);
        const service = staticService(manager);

        await expect(service.applyLook(LOOK)).rejects.toThrow(/finish loading/i);
        expect(manager.calls).toHaveLength(0);
    });

    test('and works normally as soon as the avatar has landed', async () => {
        const manager = fakeAvatarManager(null);
        const service = staticService(manager);
        await expect(service.applyLook(LOOK)).rejects.toThrow(/finish loading/i);

        manager.current = { ...ORIGINAL };
        await service.applyLook(LOOK);
        await expect(service.restore()).resolves.toBe(true);
        expect(manager.calls.map((call) => call.url)).toEqual([LOOK.vrmUrl, ORIGINAL.url]);
    });
});
