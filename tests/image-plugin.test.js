/** @jest-environment jsdom */

let Images;

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
        forCapability(capability) {
            return (
                providers.find(
                    (provider) => provider.status().available && provider.status().capabilities.includes(capability)
                ) || null
            );
        },
    };
    Images = require('../src/features/images/ImagePlugin.js');
});

afterEach(() => {
    delete window.__NEXUS_IMAGE_PLUGIN_NOAUTO__;
    delete window.NEXUS_IMAGE_MEDIA;
    delete window.NEXUS_DISCOVERY;
    delete window.NEXUS_DISCOVERY_SETTINGS;
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

test('the image source appears as an additive Discovery & Media capability exactly once', () => {
    expect(Images.installDiscoveryGroup()).toBe(true);
    expect(Images.installDiscoveryGroup()).toBe(true);
    const imageRows = window.NEXUS_DISCOVERY_SETTINGS.GROUPS.filter((row) => row.id === 'image');
    expect(imageRows).toEqual([{ id: 'image', label: 'Image source', capability: 'image.search' }]);
});

test('providers register without replacing existing discovery providers', () => {
    const original = {
        ID: 'youtube',
        status: () => ({ available: true, capabilities: ['video.search'], reason: 'ok' }),
    };
    window.NEXUS_DISCOVERY.register(original);
    Images.registerProviders();
    const ids = window.NEXUS_DISCOVERY.all().map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(['youtube', 'pexels', 'pollinations']));
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
