/** @jest-environment jsdom */

let Images;
let Experience;

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML =
        '<div id="discovery-providers"></div><button id="settings-btn"></button>' +
        '<div id="chat-history"></div><input id="speech-text"><button id="speak-btn"></button>';
    window.__NEXUS_IMAGE_PLUGIN_NOAUTO__ = true;
    window.__NEXUS_IMAGE_EXPERIENCE_NOAUTO__ = true;
    window.NEXUS_DISCOVERY_SETTINGS = {
        GROUPS: [],
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
        preferences() {
            return {};
        },
        warm() {
            return Promise.resolve([]);
        },
        forCapability(capability) {
            return providers.find(
                (provider) => provider.status().available && provider.status().capabilities.includes(capability)
            );
        },
    };

    Images = require('../src/features/images/ImagePlugin.js');
    Experience = require('../src/features/images/ImageExperience.js');
    Images.installDiscoveryGroup();
    Images.registerProviders();
});

afterEach(() => {
    delete window.__NEXUS_IMAGE_PLUGIN_NOAUTO__;
    delete window.__NEXUS_IMAGE_EXPERIENCE_NOAUTO__;
    delete window.__nexusImageConversationIntercept;
    delete window.NEXUS_IMAGE_MEDIA;
    delete window.NEXUS_IMAGE_EXPERIENCE;
    delete window.NEXUS_DISCOVERY;
    delete window.NEXUS_DISCOVERY_SETTINGS;
});

test('conversational parser tolerates small typos and treats find/show as photo search', () => {
    expect(Experience.parseIntent('Fincf a picture about nature')).toEqual({ query: 'nature', mode: 'real' });
    expect(Experience.parseIntent('show me photos of the Colosseum')).toEqual({
        query: 'the Colosseum',
        mode: 'real',
    });
    expect(Experience.parseIntent('Generate a picture of a cat')).toEqual({ query: 'a cat', mode: 'ai' });
    expect(Experience.parseIntent('draw a conclusion from these numbers')).toBeNull();
});

test('personal Pollinations key makes provider ready without deployment key', () => {
    expect(Images.PollinationsProvider.status().available).toBe(false);
    Experience.setPollinationsKey('sk_personal_test');
    expect(Experience.pollinationsKey()).toBe('sk_personal_test');
    expect(Images.PollinationsProvider.status()).toMatchObject({
        available: true,
        configured: true,
        reason: 'ok',
    });
});

test('personal Pollinations key is sent only to same-origin image gateway header', async () => {
    Experience.setPollinationsKey('sk_personal_test');
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = jest.fn(() => 'blob:personal-image');
    const fetch = jest.fn(async (url, options) => {
        expect(url).toBe(Images.ROUTE);
        expect(options.headers['X-Nexus-Pollinations-Key']).toBe('sk_personal_test');
        expect(options.headers.Authorization).toBeUndefined();
        expect(JSON.parse(options.body)).toMatchObject({
            provider: 'pollinations',
            prompt: 'a cat',
            width: 1024,
            height: 1024,
            seed: 7,
        });
        return {
            ok: true,
            status: 200,
            blob: async () => new Blob(['image'], { type: 'image/png' }),
        };
    });

    const results = await Images.PollinationsProvider.search('a cat', {
        fetch,
        ratio: '1:1',
        seed: 7,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
        provider: 'pollinations',
        type: 'ai',
        url: 'blob:personal-image',
    });
    window.URL.createObjectURL = originalCreateObjectURL;
});

test('settings adds a personal Pollinations key field next to the existing image settings', () => {
    Images.installSettingsPanel(document);
    const input = Experience.installSettings(document);
    expect(input).not.toBeNull();
    expect(input.id).toBe('nexus-image-pollinations-key');
    input.value = 'sk_saved';
    input.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(Experience.POLLINATIONS_KEY_STORE)).toBe('sk_saved');
});
