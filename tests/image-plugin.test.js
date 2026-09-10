/** @jest-environment jsdom */

let Images;

function setBridge(overrides = {}) {
    localStorage.setItem(
        'nexus_llm_settings',
        JSON.stringify({
            ollabridge: Object.assign(
                {
                    base_url: 'https://bridge.example',
                    api_key: '',
                    pair_token: 'pair-secret',
                    auth_mode: 'pair',
                },
                overrides
            ),
        })
    );
}

function responseJson(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : '') },
        json: async () => body,
    };
}

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML =
        '<div id="discovery-providers"></div><button id="settings-btn"></button>' +
        '<div id="chat-history"></div><input id="speech-text"><button id="speak-btn"></button>';
    window.__NEXUS_IMAGE_PLUGIN_NOAUTO__ = true;
    window.NEXUS_DISCOVERY_SETTINGS = {
        GROUPS: [
            { id: 'video', label: 'Video search', capability: 'video.search' },
            { id: 'music', label: 'Music search', capability: 'music.search' },
        ],
        render: jest.fn(),
    };
    const providers = [];
    window.NEXUS_DISCOVERY = {
        register(provider) {
            const at = providers.findIndex((item) => item.ID === provider.ID);
            if (at >= 0) providers[at] = provider;
            else providers.push(provider);
        },
        all() {
            return providers.map((provider) => Object.assign({ provider, id: provider.ID }, provider.status()));
        },
        warm() {
            return Promise.resolve([]);
        },
        preferences() {
            try {
                return JSON.parse(localStorage.getItem('nexus_discovery_settings') || 'null')?.preferences || {};
            } catch (_) {
                return {};
            }
        },
        setPreference(group, providerId) {
            const parsed = JSON.parse(localStorage.getItem('nexus_discovery_settings') || 'null') || {};
            parsed.preferences = Object.assign({}, parsed.preferences, { [group]: providerId });
            localStorage.setItem('nexus_discovery_settings', JSON.stringify(parsed));
        },
        forCapability(capability, options = {}) {
            const ready = providers.filter(
                (provider) => provider.status().available && provider.status().capabilities.includes(capability)
            );
            const group = String(capability).split('.')[0];
            const wanted = options.prefer || this.preferences()[group] || 'auto';
            if (wanted !== 'auto') {
                const named = ready.find((provider) => provider.ID === wanted);
                if (named) return named;
            }
            return ready[0] || null;
        },
    };
    Images = require('../src/features/images/ImagePlugin.js');
});

afterEach(() => {
    delete window.__NEXUS_IMAGE_PLUGIN_NOAUTO__;
    delete window.NEXUS_IMAGE_MEDIA;
    delete window.NEXUS_DISCOVERY;
    delete window.NEXUS_DISCOVERY_SETTINGS;
    delete window.NEXUS_SCREEN;
    delete window.NEXUS_BD_BRIDGE_DISCOVERY;
});

test('intent parsing is narrow and distinguishes AI, real and automatic image requests', () => {
    expect(Images.parseIntent('show me a picture of New York')).toEqual({ query: 'New York', mode: 'auto' });
    expect(Images.parseIntent('generate an image of a robot drinking coffee')).toEqual({
        query: 'a robot drinking coffee',
        mode: 'ai',
    });
    expect(Images.parseIntent('find me a real photo of the Colosseum')).toEqual({
        query: 'the Colosseum',
        mode: 'real',
    });
    expect(Images.parseIntent('/image northern lights')).toEqual({ query: 'northern lights', mode: 'auto' });
    expect(Images.parseIntent('/aiimage watercolor moon base')).toEqual({
        query: 'watercolor moon base',
        mode: 'ai',
    });
    expect(Images.parseIntent('draw a conclusion from these numbers')).toBeNull();
    expect(Images.parseIntent('what do you think about images?')).toBeNull();
});

test('Pexels results are normalized into the plugin image contract', () => {
    const result = Images.normalizePexels(
        {
            id: 123,
            width: 3000,
            height: 2000,
            photographer: 'Ada Photo',
            photographer_url: 'https://www.pexels.com/@ada',
            url: 'https://www.pexels.com/photo/123',
            alt: 'A desk by a window',
            src: {
                large2x: 'https://images.pexels.com/photos/123/large2x.jpeg',
                medium: 'https://images.pexels.com/photos/123/medium.jpeg',
            },
        },
        'desk'
    );
    expect(result).toMatchObject({
        id: '123',
        provider: 'pexels',
        kind: 'image',
        type: 'real',
        creator: 'Ada Photo',
        alt: 'A desk by a window',
        width: 3000,
        height: 2000,
    });
    expect(result.url).toContain('large2x.jpeg');
    expect(result.thumbnail).toContain('medium.jpeg');
});

test('image source and AI generator appear as additive Discovery & Media capabilities exactly once', () => {
    expect(Images.installDiscoveryGroup()).toBe(true);
    expect(Images.installDiscoveryGroup()).toBe(true);
    const imageRows = window.NEXUS_DISCOVERY_SETTINGS.GROUPS.filter(
        (row) => row.id === 'image' || row.id === 'imageGenerator'
    );
    expect(imageRows).toEqual([
        { id: 'image', label: 'Image source', capability: 'image.search' },
        { id: 'imageGenerator', label: 'AI image generator', capability: 'image.generate' },
    ]);
});

test('providers register without replacing existing discovery providers', () => {
    const original = {
        ID: 'youtube',
        status: () => ({ available: true, capabilities: ['video.search'], reason: 'ok' }),
    };
    window.NEXUS_DISCOVERY.register(original);
    Images.registerProviders();
    const ids = window.NEXUS_DISCOVERY.all().map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(['youtube', 'pexels', 'pollinations', 'homepilot-remote']));
});

test('Pexels personal key is isolated in its own setting and makes the provider ready', () => {
    expect(Images.PexelsProvider.status().available).toBe(false);
    Images.setPexelsKey('pexels-user-key');
    expect(localStorage.getItem(Images.PEXELS_KEY_STORE)).toBe('pexels-user-key');
    expect(Images.PexelsProvider.status()).toMatchObject({ available: true, reason: 'ok' });
});

test('supported aspect ratios map to deterministic dimensions', () => {
    expect(Images.dimensions('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(Images.dimensions('16:9')).toEqual({ width: 1280, height: 720 });
    expect(Images.dimensions('9:16')).toEqual({ width: 720, height: 1280 });
    expect(Images.dimensions('unknown')).toEqual({ width: 1024, height: 1024 });
});

test('HomePilot Remote reuses the existing OllaBridge pairing instead of a new browser secret', () => {
    setBridge();
    expect(Images.readBridgeSettings()).toEqual({ base: 'https://bridge.example', auth: 'pair-secret' });
    expect(Images.HomePilotProvider.status()).toMatchObject({
        configured: true,
        available: false,
        capabilities: ['image.generate'],
    });
});

test('HomePilot Remote is available only when the paired bridge reports image generation enabled', async () => {
    setBridge();
    const fetch = jest.fn(async (url, options) => {
        expect(url).toBe(`https://bridge.example${Images.HOMEPILOT_CAPABILITY_PATH}`);
        expect(options.headers.Authorization).toBe('Bearer pair-secret');
        return responseJson({ available: true, device: 'Studio PC' });
    });
    await Images.HomePilotProvider.ready({ force: true, fetch, now: 1000 });
    expect(Images.HomePilotProvider.status()).toMatchObject({ available: true, reason: 'ok' });
});

test('AI generator preference can select HomePilot Remote independently from image source', async () => {
    setBridge();
    Images.registerProviders();
    await Images.HomePilotProvider.ready({
        force: true,
        now: 1000,
        fetch: async () => responseJson({ available: true }),
    });
    window.NEXUS_DISCOVERY.setPreference('image', 'pexels');
    window.NEXUS_DISCOVERY.setPreference('imageGenerator', 'homepilot-remote');

    const generator = await Images.chooseProvider('ai');
    expect(generator.ID).toBe('homepilot-remote');
    expect(Images.generatorPreference()).toBe('homepilot-remote');
});

test('HomePilot generation keeps bridge auth in headers and turns proxied bytes into an object URL', async () => {
    setBridge();
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = jest.fn(() => 'blob:homepilot-image');
    const fetch = jest.fn(async (url, options) => {
        expect(options.headers.Authorization).toBe('Bearer pair-secret');
        if (url.endsWith(Images.HOMEPILOT_GENERATE_PATH)) {
            expect(JSON.parse(options.body)).toMatchObject({ prompt: 'a moon base', mode: 'imagine', count: 1 });
            return responseJson({ results: [{ url: '/v1/media/proxy/files/moon.png' }] });
        }
        expect(url).toBe('https://bridge.example/v1/media/proxy/files/moon.png');
        return {
            ok: true,
            status: 200,
            headers: { get: () => 'image/png' },
            blob: async () => new Blob(['png'], { type: 'image/png' }),
        };
    });

    const results = await Images.HomePilotProvider.search('a moon base', { fetch, ratio: '16:9', seed: 7 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
        provider: 'homepilot-remote',
        kind: 'image',
        type: 'ai',
        width: 1280,
        height: 720,
        url: 'blob:homepilot-image',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    window.URL.createObjectURL = originalCreateObjectURL;
});