/**
 * WF1. The Hugging Face Forge by default; the person's own endpoint, or none, from Settings;
 * the page's own configuration above both; and a change that applies without a reload and
 * without losing the snapshot that puts her back.
 */
const Config = require('../../src/wardrobe/WardrobeConfig.js');
const Settings = require('../../src/wardrobe/WardrobeForgeSettings.js');
const Identity = require('../../src/wardrobe/AvatarIdentity.js');

const HF = 'https://ruslanmv-3d-wardrobe-forge.hf.space';

beforeEach(() => {
    window.localStorage.clear();
    delete window.NEXUS_WARDROBE_CONFIG;
    delete window.NEXUS_WARDROBE;
});

describe('WardrobeConfig — where the Forge is', () => {
    test('with nothing configured, the Hugging Face Space is the Forge', () => {
        expect(Config.DEFAULT_FORGE_URL).toBe(HF);
        expect(Config.resolveWardrobeConfig()).toMatchObject({
            apiUrl: HF,
            remoteGeneration: true,
            forgeSource: 'default',
        });
    });

    test('the person can choose their own endpoint, or none', () => {
        expect(Config.saveForgeChoice({ mode: 'custom', url: 'localhost:8000/studio/' }).ok).toBe(true);
        expect(Config.resolveWardrobeConfig()).toMatchObject({
            apiUrl: 'https://localhost:8000',
            forgeSource: 'custom',
        });
        Config.saveForgeChoice({ mode: 'off' });
        expect(Config.resolveWardrobeConfig()).toMatchObject({
            apiUrl: '',
            remoteGeneration: false,
            forgeSource: 'off',
        });
        Config.saveForgeChoice({ mode: 'default' });
        expect(Config.resolveWardrobeConfig().apiUrl).toBe(HF);
    });

    test('a URL stored before WF1, with no mode beside it, is still that person’s choice', () => {
        window.localStorage.setItem('wardrobe_forge_url', 'https://mine.example/');
        expect(Config.resolveWardrobeConfig()).toMatchObject({ apiUrl: 'https://mine.example', forgeSource: 'custom' });
    });

    test('the page’s own configuration wins over the stored choice and the default', () => {
        Config.saveForgeChoice({ mode: 'custom', url: 'https://mine.example' });
        window.NEXUS_WARDROBE_CONFIG = { forge: { baseUrl: 'https://site.example/' } };
        expect(Config.resolveWardrobeConfig()).toMatchObject({ apiUrl: 'https://site.example', forgeSource: 'site' });
        window.NEXUS_WARDROBE_CONFIG = { forge: { enabled: false } };
        expect(Config.resolveWardrobeConfig()).toMatchObject({ apiUrl: '', forgeSource: 'site' });
    });

    test('only web addresses are accepted, with no credentials in them', () => {
        expect(Config.normalizeForgeUrl('https://x.hf.space/v1/capabilities')).toBe('https://x.hf.space');
        expect(Config.normalizeForgeUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000');
        expect(Config.normalizeForgeUrl('javascript:alert(1)')).toBeNull();
        expect(Config.normalizeForgeUrl('ftp://x.example')).toBeNull();
        expect(Config.normalizeForgeUrl('https://user:pw@x.example')).toBeNull();
        expect(Config.saveForgeChoice({ mode: 'custom', url: '' }).ok).toBe(false);
        expect(Config.resolveWardrobeConfig().apiUrl).toBe(HF); // a refused choice changes nothing
    });
});

/** Just enough of the wardrobe's globals for a real WardrobeService. */
function loadService() {
    if (!window.fetch) window.fetch = jest.fn(() => Promise.reject(new Error('no network in tests')));
    jest.isolateModules(() => {
        require('../../src/wardrobe/WardrobeClient.js');
        require('../../src/wardrobe/WardrobeController.js');
        require('../../src/wardrobe/StaticWardrobeSource.js');
        require('../../src/wardrobe/RemoteWardrobeSource.js');
        require('../../src/wardrobe/WardrobeRegistry.js');
    });
    return require('../../src/wardrobe/WardrobeService.js');
}

describe('switching Forge while the page is open', () => {
    test('setForge re-points the client and the Forge source and keeps the controller (and its snapshot)', () => {
        const Service = loadService();
        const viewer = { avatarManager: { getCurrent: () => ({ url: 'vendor/avatars/AvatarSample_A.vrm' }) } };
        const service = new Service({ config: Config.resolveWardrobeConfig(), viewer });
        const controller = service.controller;
        controller.original = { url: 'vendor/avatars/AvatarSample_A.vrm' };
        expect(service.remoteEnabled).toBe(true);
        expect(controller.forge.baseUrl).toBe(HF);

        expect(service.setForge('')).toBe(false);
        expect(service.remoteEnabled).toBe(false);
        expect(service.registry.sources().map((s) => s.id)).not.toContain('forge');

        service.setForge('https://mine.example/');
        expect(service.controller).toBe(controller);
        expect(controller.original).toEqual({ url: 'vendor/avatars/AvatarSample_A.vrm' });
        expect(controller.forge.baseUrl).toBe('https://mine.example');
        expect(service.registry.sources().filter((s) => s.id === 'forge')).toHaveLength(1);
    });

    test('apply stores the choice, re-points the running service and updates the shared config in place', () => {
        const config = { apiUrl: HF };
        const service = { setForge: jest.fn() };
        const wardrobe = { config, service };
        const result = Settings.apply({ mode: 'custom', url: 'https://mine.example' }, { wardrobe });
        expect(result.ok).toBe(true);
        expect(service.setForge).toHaveBeenCalledWith('https://mine.example');
        expect(wardrobe.config).toBe(config);
        expect(config).toMatchObject({ apiUrl: 'https://mine.example', forgeSource: 'custom' });
    });
});

describe('the connection check', () => {
    const answer = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

    test('a Forge that answers, with the same avatars this site pins', async () => {
        const fetch = jest.fn((url) =>
            url.endsWith('/v1/capabilities')
                ? answer({ templates: 85, auth: { keyRequired: false } })
                : answer({ avatars: Identity.LIBRARY.map((a) => ({ slug: a.slug, sha256: a.sha256 })) })
        );
        const result = await Settings.check(HF, { fetch, identity: Identity });
        expect(result).toMatchObject({ ok: true, templates: 85, matches: Identity.LIBRARY.length });
        expect(fetch).toHaveBeenCalledWith(HF + '/v1/capabilities', expect.any(Object));
    });

    test('says when its avatars differ, when it needs a key, and when it cannot be reached', async () => {
        const differing = await Settings.check(HF, {
            identity: Identity,
            fetch: (url) => (url.endsWith('/v1/capabilities') ? answer({ templates: 3 }) : answer({ avatars: [] })),
        });
        expect(differing.ok).toBe(true);
        expect(differing.matches).toBe(0);
        const keyed = await Settings.check(HF, { fetch: () => answer({ auth: { keyRequired: true } }) });
        expect(keyed.ok).toBe(false);
        const offline = await Settings.check(HF, { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
        expect(offline.ok).toBe(false);
        expect((await Settings.check('', {})).ok).toBe(false);
    });
});

describe('the Settings section', () => {
    function page() {
        document.body.innerHTML =
            '<button id="settings-btn"></button><div id="settings-modal"><div class="modal-content">' +
            '<div class="config-section"><h3 class="config-title">DISCOVERY</h3></div>' +
            '<div class="config-section"><h3 class="config-title">DEVELOPER</h3></div></div></div>';
    }
    const fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ templates: 85 }) });

    test('sits before DEVELOPER, shows the default, and switching applies at once', async () => {
        page();
        const service = { setForge: jest.fn() };
        window.NEXUS_WARDROBE = { config: {}, service };
        const ui = Settings.attach({ doc: document, config: Config, fetch });
        const titles = [...document.querySelectorAll('.config-title')].map((h) => h.textContent);
        expect(titles).toEqual(['DISCOVERY', 'WARDROBE FORGE', 'DEVELOPER']);
        const mode = document.getElementById('wardrobe-forge-mode');
        expect(mode.value).toBe('default');
        await ui.refresh();
        expect(document.getElementById('wardrobe-forge-status').textContent).toMatch(/Connected/);

        mode.value = 'custom';
        mode.dispatchEvent(new Event('change'));
        expect(service.setForge).not.toHaveBeenCalled(); // no address yet: nothing applied
        const input = document.getElementById('wardrobe-forge-url');
        input.value = 'my-forge.hf.space';
        input.dispatchEvent(new Event('change'));
        expect(service.setForge).toHaveBeenLastCalledWith('https://my-forge.hf.space');

        mode.value = 'off';
        mode.dispatchEvent(new Event('change'));
        expect(service.setForge).toHaveBeenLastCalledWith('');
    });

    test('a Forge set by the page is shown, not offered for change', () => {
        page();
        window.NEXUS_WARDROBE_CONFIG = { apiUrl: 'https://site.example' };
        Settings.attach({ doc: document, config: Config, fetch });
        expect(document.getElementById('wardrobe-forge-mode').disabled).toBe(true);
        expect(document.getElementById('wardrobe-forge-url').value).toBe('https://site.example');
        expect(document.getElementById('wardrobe-forge-hint').textContent).toMatch(/Set by this site/);
    });

    test('without the Settings modal, nothing is drawn and nothing throws', () => {
        document.body.innerHTML = '';
        expect(Settings.attach({ doc: document, config: Config })).toBeNull();
    });
});
