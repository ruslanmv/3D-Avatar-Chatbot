/** @jest-environment jsdom */

let Source;
let Settings;
let Web;

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    window.__NEXUS_WEB_SEARCH_NOAUTO__ = true;
    Source = require('../src/features/research/ResearchSource.js');
    Settings = require('../src/features/research/WebSearchSettings.js');
    Web = require('../src/features/research/providers/websearch.js');
    Web.reset();
    window.NEXUS_RESEARCH_SOURCE = Source;
    window.NEXUS_WEB_SEARCH_SETTINGS = Settings;
});

afterEach(() => {
    delete window.__NEXUS_WEB_SEARCH_NOAUTO__;
    delete window.NEXUS_RESEARCH_SOURCE;
    delete window.NEXUS_WEB_SEARCH_SETTINGS;
    delete window.NEXUS_RESEARCH_WEB;
});

test('Disabled is persisted and prevents web requests', async () => {
    Settings.save({ provider: 'disabled', key: 'kept-for-later' });
    expect(Settings.provider()).toBe('disabled');
    expect(Settings.disabled()).toBe(true);
    expect(Settings.own()).toBeNull();
    expect(Web.status()).toMatchObject({ available: false, reason: 'disabled' });

    const fetchImpl = jest.fn();
    expect(await Web.research('news today', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('Auto readiness reports the site provider separately from the user preference', async () => {
    const state = await Web.ready({
        force: true,
        fetchImpl: async (url, options) => {
            expect(url).toBe('/api/research/search');
            expect(options.cache).toBe('no-store');
            return {
                ok: true,
                type: 'basic',
                json: async () => ({ configured: true, provider: 'brave' }),
            };
        },
    });

    expect(Settings.provider()).toBe('');
    expect(state).toMatchObject({
        available: true,
        reason: 'deployment',
        provider: 'brave',
    });
});

test('an own-key provider remains a browser-owned configuration', async () => {
    Settings.save({ provider: 'serper', key: 'browser-test-key' });
    expect(Settings.own()).toMatchObject({ id: 'serper', key: 'browser-test-key' });

    const state = await Web.ready({
        force: true,
        fetchImpl: async () => {
            throw new Error('site readiness must not be probed when an own key is active');
        },
    });
    expect(state).toMatchObject({ available: true, reason: 'own-key', provider: 'serper' });
});
