/** @jest-environment jsdom */

let Registry;
let Settings;
let Images;
let originalCreateObjectURL;

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        type: 'basic',
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : '') },
        json: async () => body,
    };
}

function imageResponse() {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/png' : '') },
        blob: async () => new Blob(['png'], { type: 'image/png' }),
    };
}

beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '<button id="settings-btn"></button><div id="discovery-providers"></div>';

    window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__ = true;
    window.__NEXUS_IMAGE_PLUGIN_NOLOAD__ = true;
    window.__NEXUS_IMAGE_PLUGIN_NOAUTO__ = true;
    delete window.NEXUS_WEB_SEARCH_SETTINGS;
    delete window.NEXUS_RESEARCH_WEB;
    delete window.NEXUS_YT_SETTINGS;
    delete window.NEXUS_DISCOVERY_YOUTUBE;

    Registry = require('../src/features/discovery/ProviderRegistry.js');
    Registry.reset();
    window.NEXUS_DISCOVERY = Registry;

    Settings = require('../src/features/discovery/DiscoverySettings.js');
    window.NEXUS_DISCOVERY_SETTINGS = Settings;

    Images = require('../src/features/images/ImagePlugin.js');
    Images.installDiscoveryGroup();
    Images.registerProviders();

    window.fetch = jest.fn(async () => jsonResponse({ configured: false, reason: 'no-key' }));
    require('../src/features/images/ImageProviderSettings.js');
    await Promise.resolve();
    await Promise.resolve();

    originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = jest.fn(() => 'blob:test-image');
});

afterEach(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    delete window.fetch;
    delete window.NEXUS_IMAGE_MEDIA;
    delete window.NEXUS_DISCOVERY;
    delete window.NEXUS_DISCOVERY_SETTINGS;
    delete window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__;
    delete window.__NEXUS_IMAGE_PLUGIN_NOLOAD__;
    delete window.__NEXUS_IMAGE_PLUGIN_NOAUTO__;
});

test('Pexels own-key mode searches through the same-origin proxy without committing a deployment key', async () => {
    Registry.setPreference('image', 'pexels');
    Images.setPexelsKey('pexels-test-key');

    expect(Images.PexelsProvider.status()).toMatchObject({
        available: true,
        reason: 'ok',
        capabilities: ['image.search'],
    });

    const fetch = jest.fn(async (url, options) => {
        expect(url).toBe('/api/proxy');
        const proxied = JSON.parse(options.body);
        expect(proxied.url).toContain('https://api.pexels.com/v1/search');
        expect(proxied.headers.Authorization).toBe('pexels-test-key');
        return jsonResponse({
            photos: [
                {
                    id: 7,
                    alt: 'A cat',
                    photographer: 'Ada',
                    url: 'https://www.pexels.com/photo/7',
                    src: {
                        large: 'https://images.pexels.com/photos/7/large.jpeg',
                        medium: 'https://images.pexels.com/photos/7/medium.jpeg',
                    },
                },
            ],
        });
    });

    const results = await Images.PexelsProvider.search('cat', { fetch, max: 4 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ provider: 'pexels', type: 'real', title: 'A cat' });
});

test('Pollinations own-key mode sends the key only in the same-origin request header', async () => {
    Registry.setPreference('imageGenerator', 'pollinations');
    Images.setPollinationsKey('pollinations-test-key');

    expect(Images.PollinationsProvider.status()).toMatchObject({
        available: true,
        reason: 'ok',
        capabilities: ['image.generate'],
    });

    const fetch = jest.fn(async (url, options) => {
        expect(url).toBe('/api/images/search');
        expect(options.headers['X-Nexus-Pollinations-Key']).toBe('pollinations-test-key');
        expect(options.body).not.toContain('pollinations-test-key');
        expect(JSON.parse(options.body)).toMatchObject({ provider: 'pollinations', prompt: 'a cat astronaut' });
        return imageResponse();
    });

    const results = await Images.PollinationsProvider.search('a cat astronaut', { fetch, ratio: '1:1', seed: 9 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
        provider: 'pollinations',
        type: 'ai',
        url: 'blob:test-image',
    });
});

test('an AI generator is never used to satisfy a request to find an existing image', async () => {
    Images.setPollinationsKey('pollinations-test-key');
    Registry.setPreference('imageGenerator', 'pollinations');

    const fetch = jest.fn(async (url) => {
        if (String(url).includes('provider=pexels')) return jsonResponse({ configured: false, reason: 'no-key' });
        if (String(url).includes('provider=pollinations')) return jsonResponse({ configured: false, reason: 'no-key' });
        throw new Error(`unexpected request: ${url}`);
    });

    const provider = await Images.chooseProvider('auto', { fetch });
    expect(provider).toBeNull();
    expect(Images.PollinationsProvider.status().capabilities).toEqual(['image.generate']);
});

test('Disabled is a real off switch for both image search and generation', async () => {
    Images.setPexelsKey('pexels-test-key');
    Images.setPollinationsKey('pollinations-test-key');
    Registry.setPreference('image', 'disabled');
    Registry.setPreference('imageGenerator', 'disabled');

    expect(await Images.chooseProvider('real', { fetch: window.fetch })).toBeNull();
    expect(await Images.chooseProvider('ai', { fetch: window.fetch })).toBeNull();
});

test('image settings use capability-first choices and reveal credentials only for own-key mode', () => {
    Registry.setPreference('image', 'pexels');
    Settings.render(document, { warm: false });

    const select = document.getElementById('discovery-image');
    expect([...select.options].map((option) => option.textContent)).toEqual([
        'Auto — recommended',
        'Pexels — my own key',
        'Disabled',
    ]);
    expect(document.getElementById('discovery-image-pexels-key')).not.toBeNull();
    expect(select.closest('.nexus-discovery-row').textContent).toContain('Setup required');

    const input = document.getElementById('discovery-image-pexels-key');
    input.value = 'pexels-test-key';
    input.dispatchEvent(new Event('change'));
    expect(Images.pexelsKey()).toBe('pexels-test-key');

    // Repainting from storage is the behavior that matters on every subsequent Settings open;
    // the event handler also performs an asynchronous forced deployment probe in parallel.
    Settings.render(document, { warm: false });
    const rerendered = document.getElementById('discovery-image').closest('.nexus-discovery-row');
    expect(rerendered.textContent).toContain('Ready · Pexels · using your key');
    expect(rerendered.textContent).toContain('✓ Key saved in this browser');
});

test('Auto keeps credentials hidden and reports the resolved site provider separately from the preference', async () => {
    const fetch = jest.fn(async (url) => {
        if (String(url).includes('provider=pexels')) return jsonResponse({ configured: true, reason: 'deployment' });
        if (String(url).includes('provider=pollinations'))
            return jsonResponse({ configured: true, reason: 'deployment' });
        return jsonResponse({ available: false, reason: 'disabled' });
    });
    await Registry.warm({ fetch, force: true });
    Settings.render(document, { warm: false });

    const searchRow = document.getElementById('discovery-image').closest('.nexus-discovery-row');
    const generatorRow = document.getElementById('discovery-imageGenerator').closest('.nexus-discovery-row');
    expect(document.getElementById('discovery-image').value).toBe('auto');
    expect(document.getElementById('discovery-imageGenerator').value).toBe('auto');
    expect(searchRow.textContent).toContain('Ready · Pexels · provided by this site');
    expect(generatorRow.textContent).toContain('Ready · Pollinations · provided by this site');
    expect(document.querySelector('.nexus-capability-key')).toBeNull();
});
