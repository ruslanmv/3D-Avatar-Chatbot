/**
 * A key that is set, and a route that never answers (batch M8).
 *
 * Reported against a real Vercel preview: `YOUTUBE_API_KEY` configured, the app still saying
 *
 *     YouTube search isn't connected.
 *     [ Set up YouTube ]
 *
 * The key was fine. The route was fine. Vercel's Deployment Protection was on for that
 * preview, so the probe got this:
 *
 *     GET /api/yt/search  →  302  https://vercel.com/sso-api?url=…
 *
 * The redirect crosses to another origin, the browser refuses to let the page read it, the
 * probe caught an exception and reported "not configured" — and the app then pointed the
 * operator at the single thing that was not the problem.
 *
 * It also explains the symptom that looks impossible: it worked on their desktop, where they
 * were signed into Vercel and the cookie rode along, and failed on their phone, where they
 * were not.
 */

const Companion = require('../src/features/youtube/YouTubeCompanion.js');

/** A fetch that answers the readiness probe with whatever the deployment would. */
const respond = (r) => () => Promise.resolve(r);

const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    json: async () => body,
});

describe('why the deployment cannot search', () => {
    test('a key that is set reads as configured', async () => {
        const out = await Companion.serverStatus({ fetchImpl: respond(json({ configured: true })) });
        expect(out).toEqual({ configured: true, reason: 'ok' });
    });

    test('no key reads as no-key', async () => {
        const out = await Companion.serverStatus({ fetchImpl: respond(json({ configured: false })) });
        expect(out).toEqual({ configured: false, reason: 'no-key' });
    });

    test('an opaque redirect is a login wall, not a missing key', async () => {
        // What `redirect: 'manual'` turns Vercel's 302 into. Following it instead would make
        // this indistinguishable from a network failure, which is how it was misreported.
        const out = await Companion.serverStatus({
            fetchImpl: respond({ ok: false, status: 0, type: 'opaqueredirect', json: async () => ({}) }),
        });
        expect(out).toEqual({ configured: false, reason: 'protected' });
    });

    test('and so is a visible 3xx', async () => {
        const out = await Companion.serverStatus({ fetchImpl: respond(json({}, 302)) });
        expect(out.reason).toBe('protected');
    });

    test('a 200 that is not JSON is a login page wearing the route’s URL', async () => {
        const out = await Companion.serverStatus({
            fetchImpl: respond({
                ok: true,
                status: 200,
                type: 'basic',
                json: async () => {
                    throw new Error('Unexpected token < in JSON');
                },
            }),
        });
        expect(out.reason).toBe('protected');
    });

    test('a 404 means the route was never deployed', async () => {
        // A different fix again: redeploy with the api/ folder, not add a key, not log in.
        const out = await Companion.serverStatus({ fetchImpl: respond(json({}, 404)) });
        expect(out).toEqual({ configured: false, reason: 'no-route' });
    });

    test('a network failure is unreachable, and stays a guess', async () => {
        const out = await Companion.serverStatus({
            fetchImpl: () => Promise.reject(new Error('offline')),
        });
        expect(out).toEqual({ configured: false, reason: 'unreachable' });
    });

    test('a 500 is unreachable rather than any of the specific ones', async () => {
        expect((await Companion.serverStatus({ fetchImpl: respond(json({}, 500)) })).reason).toBe('unreachable');
    });

    test('the probe refuses to follow the redirect, which is what makes it legible', async () => {
        let seen = null;
        await Companion.serverStatus({
            fetchImpl: (url, opts) => {
                seen = opts;
                return Promise.resolve(json({ configured: true }));
            },
        });
        expect(seen).toEqual({ redirect: 'manual' });
    });
});

describe('the old boolean still answers', () => {
    test('so nothing that only wanted yes or no had to change', async () => {
        expect(await Companion.serverConfigured({ fetchImpl: respond(json({ configured: true })) })).toBe(true);
        expect(await Companion.serverConfigured({ fetchImpl: respond(json({}, 302)) })).toBe(false);
    });
});

describe('what the operator is told', () => {
    const Registry = require('../src/features/discovery/ProviderRegistry.js');

    // Distinct IDs: the registry keys providers by ID, so two called `fake` are one provider
    // registered twice — which quietly made an earlier version of the precedence test assert
    // nothing at all.
    const providerWith = (reason, id = reason) => ({
        ID: id,
        status: () => ({ id, configured: false, available: false, capabilities: [], reason }),
    });

    beforeEach(() => Registry.reset());

    test('a transport reason outranks a missing key', () => {
        // Telling somebody to add a key while the route is behind a login wall sends them to
        // the only place the problem is not.
        // Registered protected-first on purpose: last-one-wins would return 'protected'
        // either way, so this order is the one that actually exercises the precedence.
        Registry.register(providerWith('protected'));
        Registry.register(providerWith('no-key'));
        expect(Registry.why('video.search')).toBe('protected');
    });

    test.each([['protected'], ['no-route'], ['unreachable']])('%s reaches the UI as itself', (reason) => {
        Registry.register(providerWith(reason));
        expect(Registry.why('video.search')).toBe(reason);
    });

    test('and a genuine missing key is still a missing key', () => {
        Registry.register(providerWith('no-key'));
        expect(Registry.why('video.search')).toBe('no-key');
    });
});
