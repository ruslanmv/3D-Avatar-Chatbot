/**
 * A key the deployment owns (batch D13).
 *
 * Before this, every visitor had to bring their own YouTube Data API key or get no search.
 * That is the right default for somebody self-hosting and the wrong one for a site somebody
 * publishes: the operator has a key, and asking each visitor for one turns a working feature
 * into a form.
 *
 * The load-bearing decision is **where the key lives**. Handing it to the page from a config
 * endpoint would be far simpler and would publish it: a Data API key in client JavaScript is
 * readable by anyone who opens the page, and Google's referrer restrictions only bind
 * browsers. So the key stays on the server and the browser calls a route.
 *
 * Three claims:
 *
 *   * the browser never receives the key — asserted against the source of both routes;
 *   * a key the user typed wins, because they meant to use their own quota;
 *   * a deployment with no key is exactly what it was before this batch.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

let Companion;
let Provider;
let Registry;
let Settings;

/** A fetch that answers the deployment route however the test says. */
function serverFetch({
    configured = true,
    results = [{ id: 'srv00000000', name: 'From the site', author: 'Site' }],
    status = 200,
} = {}) {
    return jest.fn(async (url) => {
        const href = String(url);
        if (href.startsWith('/api/yt/search')) {
            if (status !== 200) return { ok: false, status, json: async () => ({ error: 'nope' }) };
            const hasQuery = href.includes('q=');
            return { ok: true, status: 200, json: async () => (hasQuery ? { results } : { configured }) };
        }
        // The direct Data API call, used only when the browser has its own key.
        return {
            ok: true,
            status: 200,
            json: async () => ({
                items: [{ id: { videoId: 'own00000000' }, snippet: { title: 'From your key', channelTitle: 'You' } }],
            }),
        };
    });
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<button id="settings-btn"></button><div id="discovery-providers"></div>';
    localStorage.clear();
    delete window.NEXUS_YT_CONFIG;
    window.__NEXUS_YT_SETTINGS_NOAUTO__ = true;
    window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__ = true;
    window.NEXUS_YT = require('../src/features/youtube/YouTubeLink.js');
    window.NEXUS_YT_SETTINGS = require('../src/features/youtube/YouTubeSettings.js');
    Companion = require('../src/features/youtube/YouTubeCompanion.js');
    window.NEXUS_YT_COMPANION = Companion;
    window.NEXUS_MEDIA_RESULT = require('../src/features/discovery/MediaResult.js');
    Provider = require('../src/features/discovery/providers/youtube.js');
    window.NEXUS_DISCOVERY_YOUTUBE = Provider;
    Registry = require('../src/features/discovery/ProviderRegistry.js');
    window.NEXUS_DISCOVERY = Registry;
    Settings = require('../src/features/discovery/DiscoverySettings.js');
    Registry.reset();
    Registry.register(Provider);
});

// ── the key stays on the server ─────────────────────────────────────────────

describe('the browser never gets the operator key', () => {
    const routes = ['nexus-proxy/youtube-routes.cjs', 'api/yt-search.js'];

    test.each(routes)('%s reads the key from the environment and returns results, not the key', (rel) => {
        const code = codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        expect(code).toContain('process.env.YOUTUBE_API_KEY');
        // The readiness answer is a boolean. A route that returned the key — however
        // convenient for the client — would publish it to every visitor.
        expect(code).toMatch(/configured:\s*Boolean\(key\)/);
        expect(code).not.toMatch(/json\(\{[^}]*\bkey\b\s*[,}]/);
    });

    test('no client file asks for the key over the wire', () => {
        for (const rel of ['src/features/youtube/YouTubeCompanion.js', 'src/features/discovery/providers/youtube.js']) {
            const code = codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
            expect(`${rel} :: ${/YOUTUBE_API_KEY/.test(code)}`).toBe(`${rel} :: false`);
        }
    });

    test('the readiness probe spends no quota — it carries no query', async () => {
        const f = serverFetch();
        await Companion.serverConfigured({ fetchImpl: f });
        const asked = f.mock.calls[0][0];
        expect(asked).toBe('/api/yt/search');
        expect(asked).not.toContain('q=');
    });
});

// ── which key answers ───────────────────────────────────────────────────────

describe('whose quota', () => {
    test('with no key of their own, the deployment key answers', async () => {
        const f = serverFetch();
        const out = await Companion.search('lofi', { fetchImpl: f });
        expect(out).toEqual([{ id: 'srv00000000', name: 'From the site', author: 'Site' }]);
    });

    test('a key in Settings wins — they meant to use their own quota', async () => {
        localStorage.setItem('nexus_discovery_settings', JSON.stringify({ youtube: { apiKey: 'mine' } }));
        const f = serverFetch();
        const out = await Companion.search('lofi', { fetchImpl: f });
        expect(out[0].name).toBe('From your key');
        expect(f.mock.calls.every(([u]) => !String(u).startsWith('/api/yt/search'))).toBe(true);
    });

    test('a deployment with no key is exactly what it was before', async () => {
        const f = serverFetch({ configured: false, status: 503 });
        // `null` is the signal every caller already understands as "hide the affordance".
        await expect(Companion.search('lofi', { fetchImpl: f })).resolves.toBeNull();
    });

    test('a host with no such route at all is not an error', async () => {
        const f = jest.fn(async () => {
            throw new Error('404');
        });
        await expect(Companion.serverConfigured({ fetchImpl: f })).resolves.toBe(false);
        await expect(Companion.serverSearch('lofi', { fetchImpl: f })).resolves.toBeNull();
    });
});

// ── what the provider and Settings report ───────────────────────────────────

describe('readiness', () => {
    test('is not claimed before the probe answers', () => {
        // Reporting available too early is the dead-provider-shown-as-working failure.
        expect(Provider.status()).toMatchObject({ available: false, reason: 'checking' });
    });

    test('becomes available on the deployment key, with its own reason', async () => {
        await Provider.ready({ fetchImpl: serverFetch({ configured: true }) });
        expect(Provider.status()).toMatchObject({ available: true, reason: 'deployment' });
    });

    test("says the key is the user's when it is", async () => {
        localStorage.setItem('nexus_discovery_settings', JSON.stringify({ youtube: { apiKey: 'mine' } }));
        await Provider.ready({ fetchImpl: serverFetch({ configured: false }) });
        expect(Provider.status()).toMatchObject({ available: true, reason: 'ok' });
    });

    test('stays no-key when neither has one', async () => {
        await Provider.ready({ fetchImpl: serverFetch({ configured: false }) });
        expect(Provider.status()).toMatchObject({ available: false, reason: 'no-key' });
    });

    test('the registry warms every provider that needs it, and never rejects', async () => {
        Registry.register({
            ID: 'broken',
            status: () => ({ id: 'broken', configured: false, available: false, capabilities: [], reason: 'x' }),
            ready: () => Promise.reject(new Error('boom')),
        });
        await expect(Registry.warm({ fetchImpl: serverFetch() })).resolves.toEqual(expect.any(Array));
    });

    test('Settings tells a visitor they need nothing', async () => {
        await Provider.ready({ fetchImpl: serverFetch({ configured: true }) });
        Settings.render(document);
        expect(document.querySelector('.nexus-discovery-status').textContent).toBe('Ready · provided by this site');
    });
});

// ── the deployment surface ──────────────────────────────────────────────────

describe('deployment', () => {
    test('Vercel routes /api/yt/search at the function and gives it a budget', () => {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
        expect(cfg.functions['api/yt-search.js']).toBeTruthy();
        expect(cfg.rewrites.some((r) => r.source === '/api/yt/search' && r.destination === '/api/yt-search')).toBe(
            true
        );
    });

    test('the local proxy serves the same path, so the client has one', () => {
        const code = fs.readFileSync(path.join(ROOT, 'nexus-proxy/youtube-routes.cjs'), 'utf8');
        expect(code).toContain("app.get('/api/yt/search'");
    });
});
