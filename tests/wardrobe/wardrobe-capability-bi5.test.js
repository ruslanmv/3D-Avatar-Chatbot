/**
 * BI5. A signed-in person holds a short-lived capability; a public page holds no long-lived grant.
 *
 * Forge AC1 issues a capability to a verified account: the read grant of BI2, bound to that
 * account and the avatars it may see, for at most fifteen minutes. This is the app's half.
 *
 * What must hold:
 * - a grant in the page's own configuration (served to every visitor) is used only when it is
 *   short-lived; a thirty-day operator grant there is refused, and so is one that cannot be read;
 * - the grant a person stored on their own device is not judged by that rule;
 * - with `forge.capabilityUrl`, the client asks the site's own server for a capability for the
 *   avatar on stage (same-origin cookies, no identity in the body beyond the avatar), sends it
 *   as X-Wardrobe-Grant, reuses it while it lives and renews it before it runs out;
 * - a capability that cannot be had is not an error: no header (or the device's grant), once
 *   warned, and the wardrobe still answers;
 * - a look download carries the live capability only to the configured Forge's origin.
 */
function grant(claims) {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${body}.c2lnbmF0dXJl`;
}
const NOW = 1_800_000_000;
const OPERATOR = grant({ v: 1, scope: 'private-read', slugs: ['avatar-sample-a'], iat: NOW, exp: NOW + 30 * 86400 });
const CAPABILITY = grant({
    v: 1,
    scope: 'private-read',
    slugs: ['avatar-sample-a'],
    iat: NOW,
    exp: NOW + 300,
    sub: 'acct-1',
});

function loadConfig(site, device) {
    jest.resetModules();
    window.localStorage.clear();
    delete window.NEXUS_WARDROBE_CONFIG;
    if (site) window.NEXUS_WARDROBE_CONFIG = site;
    const Config = require('../../src/wardrobe/WardrobeConfig.js');
    if (device) window.localStorage.setItem(Config.GRANT_KEY, device);
    return Config;
}

describe('BI5 no long-lived grant from public configuration', () => {
    let warn;
    beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    test('an operator grant in the page configuration is refused, and said so once', () => {
        const Config = loadConfig({ forge: { grant: OPERATOR } });
        const resolved = Config.resolveWardrobeConfig();
        expect(resolved.grant).toBe('');
        expect(resolved.grantRefused).toBe('long-lived');
        Config.resolveWardrobeConfig();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).not.toContain(OPERATOR); // the grant itself is never logged
    });

    test('a grant that cannot be read is refused too', () => {
        const Config = loadConfig({ forge: { grant: 'not.a-grant' } });
        expect(Config.resolveWardrobeConfig()).toMatchObject({ grant: '', grantRefused: 'unreadable' });
    });

    test('a short-lived grant in the page configuration is honoured', () => {
        const Config = loadConfig({ forge: { grant: CAPABILITY } });
        expect(Config.resolveWardrobeConfig()).toMatchObject({ grant: CAPABILITY, grantRefused: '' });
        expect(Config.describeGrant(CAPABILITY)).toMatchObject({ sub: 'acct-1', lifetime: 300 });
        expect(Config.SITE_GRANT_MAX_S).toBe(900);
    });

    test("the device's own grant is not judged by the public rule, and replaces a refused one", () => {
        const Config = loadConfig({ forge: { grant: OPERATOR } }, OPERATOR);
        expect(Config.resolveWardrobeConfig()).toMatchObject({ grant: OPERATOR, grantRefused: 'long-lived' });
        const alone = loadConfig(null, OPERATOR);
        expect(alone.resolveWardrobeConfig()).toMatchObject({ grant: OPERATOR, grantRefused: '' });
    });

    test('the capability endpoint comes from the site configuration only', () => {
        const Config = loadConfig({ forge: { capabilityUrl: '/api/wardrobe/capability' } });
        expect(Config.resolveWardrobeConfig().capabilityUrl).toBe('/api/wardrobe/capability');
        expect(loadConfig().resolveWardrobeConfig().capabilityUrl).toBe('');
    });
});

function loadClient() {
    jest.resetModules();
    return require('../../src/wardrobe/WardrobeClient.js').WardrobeClient;
}

/** A page: its own server (capabilities) and a Forge, with every request recorded. */
function network(capabilities) {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => {
        calls.push({ url: String(url), init: init || {} });
        if (String(url) === '/api/wardrobe/capability') {
            const next = capabilities.shift();
            if (!next) return { ok: false, status: 401, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => next };
        }
        return { ok: true, status: 200, json: async () => ({ looks: [] }) };
    });
    const forge = () => calls.filter((c) => c.url.startsWith('https://forge.test'));
    const site = () => calls.filter((c) => c.url === '/api/wardrobe/capability');
    return { fetchImpl, calls, forge, site };
}

describe('BI5 the client holds a capability, in memory, for the avatar on stage', () => {
    let warn;
    beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    function client(net, extra) {
        const Client = loadClient();
        let now = NOW * 1000;
        const made = new Client({
            baseUrl: 'https://forge.test',
            fetchImpl: net.fetchImpl,
            capabilityUrl: '/api/wardrobe/capability',
            capabilityFor: () => 'avatar-sample-a',
            now: () => now,
            ...extra,
        });
        return { made, tick: (ms) => (now += ms) };
    }

    test('asked of the site with its own cookies, sent to Forge, reused, renewed before it expires', async () => {
        const net = network([
            { token: 'first.capability', expiresIn: 300 },
            { token: 'second.capability', expiresIn: 300 },
        ]);
        const { made, tick } = client(net);
        await made.request('/v1/wardrobes/avatar-sample-a');
        await made.request('/v1/library/avatar-sample-a/prebuilt');
        expect(net.site()).toHaveLength(1);
        const asked = net.site()[0].init;
        expect(asked).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
        expect(JSON.parse(asked.body)).toEqual({ avatars: ['avatar-sample-a'] }); // nothing says who is asking
        expect(net.forge().map((c) => c.init.headers['X-Wardrobe-Grant'])).toEqual([
            'first.capability',
            'first.capability',
        ]);
        tick(250 * 1000); // inside the last minute of its five
        await made.request('/v1/wardrobes/avatar-sample-a');
        expect(net.site()).toHaveLength(2);
        expect(net.forge()[2].init.headers['X-Wardrobe-Grant']).toBe('second.capability');
        expect(window.localStorage.length).toBe(0); // never stored
    });

    test('two requests at once ask the site once', async () => {
        const net = network([{ token: 'only.one', expiresIn: 300 }]);
        const { made } = client(net);
        await Promise.all([
            made.request('/v1/a'),
            made.request('/v1/b'),
            made.downloadHeadersNow('https://forge.test/x'),
        ]);
        expect(net.site()).toHaveLength(1);
    });

    test('refused by the site: no grant header, warned once, the request still goes', async () => {
        const net = network([]);
        const { made } = client(net);
        await expect(made.request('/v1/wardrobes/avatar-sample-a')).resolves.toEqual({ looks: [] });
        await made.request('/v1/wardrobes/avatar-sample-a');
        expect(net.forge().every((c) => !('X-Wardrobe-Grant' in c.init.headers))).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test("anything that is not a capability is not sent, and the device's grant stands in", async () => {
        for (const bad of [
            { token: 'no-dot', expiresIn: 300 },
            { token: 'a.b', expiresIn: 0 },
            { expiresIn: 300 },
            null,
        ]) {
            const net = network([bad]);
            const { made } = client(net, { grant: 'device.grant' });
            await made.request('/v1/x');
            expect(net.forge()[0].init.headers['X-Wardrobe-Grant']).toBe('device.grant');
        }
    });

    test('no avatar on stage, or no capability endpoint: exactly as before', async () => {
        const net = network([{ token: 'unused.capability', expiresIn: 300 }]);
        const { made } = client(net, { capabilityFor: () => '', grant: 'device.grant' });
        await made.request('/v1/x');
        expect(net.site()).toHaveLength(0);
        expect(net.forge()[0].init.headers['X-Wardrobe-Grant']).toBe('device.grant');
        const Client = loadClient();
        const plain = new Client({ baseUrl: 'https://forge.test', fetchImpl: net.fetchImpl, grant: 'device.grant' });
        expect(plain.downloadHeaders('https://forge.test/v1/assets/looks/x/look.vrm')).toEqual({
            'X-Wardrobe-Grant': 'device.grant',
        });
    });

    test('a look download carries the live capability to its own Forge and to nowhere else', async () => {
        const net = network([{ token: 'live.capability', expiresIn: 300 }]);
        const { made } = client(net);
        expect(await made.downloadHeadersNow('https://forge.test/v1/assets/looks/x/look.vrm')).toEqual({
            'X-Wardrobe-Grant': 'live.capability',
        });
        expect(await made.downloadHeadersNow('https://elsewhere.test/look.vrm')).toEqual({});
        expect(await made.downloadHeadersNow('/vendor/wardrobe/looks/a/look.vrm')).toEqual({
            'X-Wardrobe-Grant': 'live.capability', // relative to the Forge: its own origin
        });
    });
});
