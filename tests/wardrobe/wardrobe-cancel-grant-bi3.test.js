/**
 * BI2/BI3. A wear can be cancelled and a private look read with a grant, never the admin token.
 *
 * What must hold:
 * - a wear cancelled while downloading never loads, and its download is aborted;
 * - a wear cancelled after its model landed is rolled back to what she wore before;
 * - restore() during a download wins: the download cannot land on top of her own clothes;
 * - a wear the manager discarded (a newer load came first) is not recorded as worn;
 * - TryOnSession treats a cancelled wear as "kept what she had", not as a failure;
 * - the grant is sent to the configured Forge only, never to another host;
 * - a failed download and a wrong SHA-256 refuse before anything is swapped.
 */
const fs = require('fs');
const path = require('path');

const Validator = require('../../src/wardrobe/WardrobePackValidator.js');

const ORIGINAL = { url: '/vendor/avatars/AvatarSample_A.vrm', name: 'A', index: 0 };

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function loadController() {
    jest.resetModules();
    delete window.NEXUS_WARDROBE_CLIENT;
    window.NEXUS_WARDROBE_CLIENT = require('../../src/wardrobe/WardrobeClient.js');
    return require('../../src/wardrobe/WardrobeController.js');
}

/** A manager whose loads resolve when the test says so, and which drops stale loads like AvatarManager. */
function stage() {
    const loads = [];
    let generation = 0;
    const manager = {
        current: Object.assign({}, ORIGINAL),
        getCurrent() {
            return this.current;
        },
        setAvatarByUrl: jest.fn((url, name) => {
            const mine = ++generation;
            const gate = deferred();
            loads.push({ url, name, gate });
            return gate.promise.then(() => {
                if (mine !== generation) return null;
                manager.current = { url, name };
                return { url };
            });
        }),
    };
    return { manager, loads, viewer: { avatarManager: manager } };
}

async function flush() {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('BI3 WardrobeController cancellation', () => {
    test('cancelled while downloading: aborted, never loaded, she keeps her look', async () => {
        const Controller = loadController();
        const { manager, viewer } = stage();
        const download = deferred();
        let signal = null;
        const verifyLook = jest.fn((look, options) => {
            signal = options.signal;
            return download.promise;
        });
        const controller = new Controller({ forge: { resolveUrl: (u) => u }, viewer, verifyLook });
        const wear = controller.applyLook({ vrmUrl: 'https://forge.test/v1/assets/looks/x/look.vrm', sha256: 'a' });
        await flush();
        expect(controller.pending).toBe(true);
        expect(controller.cancel()).toBe(true);
        expect(signal.aborted).toBe(true);
        const revoke = jest.fn();
        download.resolve({ url: 'blob:x#look.vrm', revoke });
        await expect(wear).rejects.toMatchObject({ reason: 'wear_cancelled' });
        expect(manager.setAvatarByUrl).not.toHaveBeenCalled();
        expect(revoke).toHaveBeenCalled();
        expect(controller.activeLook).toBeNull();
        expect(controller.cancel()).toBe(false);
    });

    test('cancelled after the model landed: rolled back to what she wore', async () => {
        const Controller = loadController();
        const { manager, loads, viewer } = stage();
        const controller = new Controller({ forge: { resolveUrl: (u) => u }, viewer });
        const wear = controller.applyLook({ vrmUrl: '/looks/bare.vrm', name: 'Bare' });
        await flush();
        controller.cancel();
        loads[0].gate.resolve();
        await flush();
        // The rollback load: back to her own file.
        expect(loads[1].url).toBe(ORIGINAL.url);
        loads[1].gate.resolve();
        await expect(wear).rejects.toMatchObject({ reason: 'wear_cancelled' });
        expect(manager.current.url).toBe(ORIGINAL.url);
        expect(controller.activeLook).toBeNull();
        expect(controller.wornUrl).toBeNull();
    });

    test('restore during a download wins: the look cannot land on top of her clothes', async () => {
        const Controller = loadController();
        const { manager, loads, viewer } = stage();
        const download = deferred();
        const controller = new Controller({
            forge: { resolveUrl: (u) => u },
            viewer,
            verifyLook: () => download.promise,
        });
        // She is wearing a look already.
        const first = controller.applyLook({ vrmUrl: '/looks/lingerie.vrm', name: 'Lingerie' });
        await flush();
        loads[0].gate.resolve();
        await first;
        const wear = controller.applyLook({ vrmUrl: '/looks/bare.vrm', sha256: 'b' });
        await flush();
        const restoring = controller.restore();
        await flush();
        loads[1].gate.resolve();
        await expect(restoring).resolves.toBe(true);
        download.resolve({ url: 'blob:bare#look.vrm', revoke: jest.fn() });
        await expect(wear).rejects.toMatchObject({ reason: 'wear_cancelled' });
        expect(manager.setAvatarByUrl).toHaveBeenCalledTimes(2);
        expect(manager.current.url).toBe(ORIGINAL.url);
        expect(controller.activeLook).toBeNull();
    });

    test('a wear the manager discarded is not recorded as worn', async () => {
        const Controller = loadController();
        const { loads, viewer } = stage();
        const controller = new Controller({ forge: { resolveUrl: (u) => u }, viewer });
        const wear = controller.applyLook({ vrmUrl: '/looks/a.vrm', name: 'A' });
        await flush();
        // Someone else (the avatar picker) loads after it.
        viewer.avatarManager.setAvatarByUrl('/vendor/avatars/B.vrm', 'B');
        loads[0].gate.resolve();
        await expect(wear).rejects.toMatchObject({ reason: 'wear_cancelled', cancelled: 'superseded' });
        expect(controller.activeLook).toBeNull();
        expect(loads).toHaveLength(2); // no rollback over the newer load
    });

    test('a newer wear supersedes an older download', async () => {
        const Controller = loadController();
        const { manager, loads, viewer } = stage();
        const slow = deferred();
        const controller = new Controller({
            forge: { resolveUrl: (u) => u },
            viewer,
            verifyLook: (look) =>
                look.sha256 === 'slow' ? slow.promise : Promise.resolve({ url: look.vrmUrl, revoke() {} }),
        });
        const older = controller.applyLook({ vrmUrl: '/looks/slow.vrm', sha256: 'slow' });
        await flush();
        const newer = controller.applyLook({ vrmUrl: '/looks/fast.vrm', sha256: 'fast', name: 'Fast' });
        await flush();
        loads[0].gate.resolve();
        await newer;
        slow.resolve({ url: 'blob:slow#look.vrm', revoke: jest.fn() });
        await expect(older).rejects.toMatchObject({ reason: 'wear_cancelled' });
        expect(manager.current.url).toBe('/looks/fast.vrm');
        expect(controller.activeLook.name).toBe('Fast');
    });
});

describe('BI3 TryOnSession: cancelled is not failed', () => {
    test('a cancelled wear leaves her in what she wore, with no error', async () => {
        jest.resetModules();
        const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
        const cancelled = Object.assign(new Error('cancelled'), { reason: 'wear_cancelled' });
        const controller = {
            original: ORIGINAL,
            snapshot() {
                return ORIGINAL;
            },
            applyLook: jest.fn().mockRejectedValue(cancelled),
            restore: jest.fn().mockResolvedValue(true),
            cancel: jest.fn(() => true),
        };
        const look = { id: 'bare', key: 'forge:bare', vrmUrl: '/looks/bare.vrm', name: 'Bare' };
        const session = new TryOnSession({ controller, looks: [look] });
        session.begin && session.begin();
        expect(session.cancelPending()).toBe(true);
        const landed = await session.wear(look);
        expect(landed).toBe(false);
        expect(session.error).toBeNull();
    });
});

describe('BI2 the read grant goes only to its own Forge', () => {
    test('config reads the grant: the site first, then this device', () => {
        jest.resetModules();
        window.localStorage.clear();
        const Config = require('../../src/wardrobe/WardrobeConfig.js');
        window.localStorage.setItem(Config.GRANT_KEY, 'device-grant');
        delete window.NEXUS_WARDROBE_CONFIG;
        expect(Config.resolveWardrobeConfig().grant).toBe('device-grant');
        // BI5. The site's grant still comes first, when it is one a public page may carry: a
        // short-lived one. (A long-lived or unreadable one there is refused and the device's
        // stands: tests/wardrobe/wardrobe-capability-bi5.test.js.)
        const short = `${Buffer.from(JSON.stringify({ iat: 1000, exp: 1300, sub: 'acct' })).toString('base64url')}.sig`;
        window.NEXUS_WARDROBE_CONFIG = { forge: { baseUrl: 'https://forge.test', grant: short } };
        expect(Config.resolveWardrobeConfig().grant).toBe(short);
        delete window.NEXUS_WARDROBE_CONFIG;
        window.localStorage.clear();
    });

    test('requests carry X-Wardrobe-Grant; downloads only on the same origin', async () => {
        jest.resetModules();
        const { WardrobeClient } = require('../../src/wardrobe/WardrobeClient.js');
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ looks: [] }) }));
        const client = new WardrobeClient({ baseUrl: 'https://forge.test', grant: 'g1', fetchImpl });
        await client.request('/v1/wardrobes/vroid-model-girl');
        expect(fetchImpl.mock.calls[0][1].headers['X-Wardrobe-Grant']).toBe('g1');
        expect(fetchImpl.mock.calls[0][1].headers['X-Wardrobe-Admin']).toBeUndefined();
        expect(client.downloadHeaders('https://forge.test/v1/assets/looks/import-1/look.vrm')).toEqual({
            'X-Wardrobe-Grant': 'g1',
        });
        expect(client.downloadHeaders('/v1/assets/looks/import-1/look.vrm')).toEqual({ 'X-Wardrobe-Grant': 'g1' });
        expect(client.downloadHeaders('https://elsewhere.test/look.vrm')).toEqual({});
        expect(new WardrobeClient({ baseUrl: 'https://forge.test', fetchImpl }).downloadHeaders('/x')).toEqual({});
    });
});

describe('BI3 verified downloads', () => {
    const avatar = fs.readFileSync(path.join(__dirname, '../../vendor/avatars/AvatarSample_A.vrm'));
    const buffer = avatar.buffer.slice(avatar.byteOffset, avatar.byteOffset + avatar.byteLength);
    const URLImpl = { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() };

    test('headers and the abort signal reach the download', async () => {
        const sha256 = await Validator.sha256Hex(buffer);
        const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
        const abort = new AbortController();
        await Validator.fetchVerified(
            { vrmUrl: 'https://forge.test/v1/assets/looks/a/look.vrm', sha256 },
            { fetchImpl, URLImpl, headers: { 'X-Wardrobe-Grant': 'g' }, signal: abort.signal }
        );
        expect(fetchImpl.mock.calls[0][1]).toEqual({ headers: { 'X-Wardrobe-Grant': 'g' }, signal: abort.signal });
    });

    test('a failed download refuses with its status; a wrong SHA-256 refuses before any blob', async () => {
        URLImpl.createObjectURL.mockClear();
        const missing = jest.fn(async () => ({ ok: false, status: 404 }));
        await expect(
            Validator.fetchVerified(
                { vrmUrl: 'https://forge.test/x.vrm', sha256: 'a'.repeat(64) },
                { fetchImpl: missing }
            )
        ).rejects.toMatchObject({ reason: 'look_download_failed', status: 404 });
        const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
        await expect(
            Validator.fetchVerified(
                { vrmUrl: 'https://forge.test/x.vrm', sha256: 'f'.repeat(64) },
                { fetchImpl, URLImpl }
            )
        ).rejects.toMatchObject({ reason: 'look_failed_verification' });
        expect(URLImpl.createObjectURL).not.toHaveBeenCalled();
    });
});

describe('BI2 Settings keeps the grant on this device', () => {
    test('saves a grant-shaped value, refuses anything else, forgets on empty', () => {
        jest.resetModules();
        window.localStorage.clear();
        const Config = require('../../src/wardrobe/WardrobeConfig.js');
        expect(Config.saveGrant('correct horse battery staple').ok).toBe(false);
        expect(window.localStorage.getItem(Config.GRANT_KEY)).toBeNull();
        expect(Config.saveGrant(' eyJ2IjoxfQ.c2ln ').ok).toBe(true);
        expect(window.localStorage.getItem(Config.GRANT_KEY)).toBe('eyJ2IjoxfQ.c2ln');
        expect(Config.saveGrant('').ok).toBe(true);
        expect(window.localStorage.getItem(Config.GRANT_KEY)).toBeNull();
    });
});
