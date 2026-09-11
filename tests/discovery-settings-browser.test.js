/** @jest-environment jsdom */

describe('Discovery & Media standalone browser wiring', () => {
    beforeEach(() => {
        jest.resetModules();
        localStorage.clear();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
        window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__ = true;
        window.NEXUS_BD_ENABLED = false;
        delete window.NEXUS_BD;
    });

    afterEach(() => {
        delete window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__;
        delete window.NEXUS_BD_ENABLED;
        for (const key of [
            'NEXUS_RESEARCH_SOURCE',
            'NEXUS_WEB_SEARCH_SETTINGS',
            'NEXUS_RESEARCH_WEB',
            'NEXUS_MEDIA_RESULT',
            'NEXUS_DISCOVERY_YOUTUBE',
            'NEXUS_DISCOVERY',
            'NEXUS_IMAGE_MEDIA',
            'NEXUS_IMAGE_EXPERIENCE',
            'NEXUS_YT_SETTINGS',
            'NEXUS_DISCOVERY_SETTINGS',
        ]) {
            delete window[key];
        }
    });

    function installReadyGlobals() {
        window.NEXUS_RESEARCH_SOURCE = {};
        window.NEXUS_MEDIA_RESULT = {};
        window.NEXUS_DISCOVERY_YOUTUBE = {};
        window.NEXUS_YT_SETTINGS = {
            read: () => ({ youtube: { apiKey: '' } }),
            write: jest.fn(),
        };
        window.NEXUS_WEB_SEARCH_SETTINGS = {
            PROVIDERS: {
                brave: { label: 'Brave Search' },
                serper: { label: 'Serper' },
            },
            provider: () => '',
            apiKey: () => '',
            save: jest.fn(),
        };
        window.NEXUS_RESEARCH_WEB = {
            status: () => ({
                id: 'web',
                configured: true,
                available: true,
                capabilities: ['topic.search'],
                reason: 'deployment',
                provider: 'brave',
            }),
            ready: () => Promise.resolve(),
        };

        const personalCredential = () => ({ supportsOwnKey: true, hasOwnKey: false });
        const bridgeCredential = () => ({ supportsOwnKey: true, hasOwnKey: true });
        const rows = [
            {
                id: 'pexels',
                configured: true,
                available: true,
                capabilities: ['image.search'],
                reason: 'deployment',
                provider: { credentialStatus: personalCredential },
            },
            {
                id: 'youtube',
                configured: true,
                available: true,
                capabilities: ['video.search', 'music.search'],
                reason: 'deployment',
                provider: { credentialStatus: personalCredential },
            },
            {
                id: 'pollinations',
                configured: true,
                available: true,
                capabilities: ['image.generate'],
                reason: 'deployment',
                provider: { credentialStatus: personalCredential },
            },
            {
                id: 'homepilot-remote',
                configured: false,
                available: false,
                capabilities: ['image.generate'],
                reason: 'no-bridge',
                provider: { credentialStatus: bridgeCredential },
            },
        ];
        window.NEXUS_DISCOVERY = {
            register: jest.fn(),
            all: () => rows,
            preferences: () => ({}),
            setPreference: jest.fn(),
            warm: () => Promise.resolve(rows),
        };

        window.NEXUS_IMAGE_MEDIA = {
            pexelsKey: () => '',
            setPexelsKey: jest.fn(),
            pollinationsKey: () => '',
            setPollinationsKey: jest.fn(),
            installDiscoveryGroup: jest.fn(),
            registerProviders: jest.fn(),
        };
    }

    test('declares the normal-page discovery stack without any Behavior Director dependency', () => {
        installReadyGlobals();
        const Settings = require('../src/features/discovery/DiscoverySettings.js');
        window.NEXUS_DISCOVERY_SETTINGS = Settings;
        require('../src/features/images/ImageProviderSettings.js');

        expect(window.NEXUS_IMAGE_MEDIA.DISCOVERY_CORE.map((item) => item.src)).toEqual([
            'src/features/research/ResearchSource.js',
            'src/features/research/WebSearchSettings.js',
            'src/features/research/providers/websearch.js',
            'src/features/discovery/MediaResult.js',
            'src/features/discovery/providers/youtube.js',
            'src/features/discovery/ProviderRegistry.js',
        ]);
        expect(window.NEXUS_BD).toBeUndefined();
    });

    test('shows only the five capability-first cards, in product order, while legacy fields stay hidden', async () => {
        document.body.innerHTML = `
            <button id="settings-btn" type="button">Settings</button>
            <button id="save-settings" type="button">Save</button>
            <section class="config-section">
                <h3 class="config-title">DISCOVERY &amp; MEDIA</h3>
                <div class="input-group"><input id="yt-api-key" /></div>
                <div class="input-group">
                    <select id="web-search-provider"></select>
                    <input id="web-search-key" />
                </div>
                <div class="input-group"><div id="discovery-providers"></div></div>
            </section>
        `;
        installReadyGlobals();

        const Settings = require('../src/features/discovery/DiscoverySettings.js');
        window.NEXUS_DISCOVERY_SETTINGS = Settings;
        require('../src/features/images/ImageProviderSettings.js');

        await window.NEXUS_IMAGE_MEDIA.bootstrapDiscoverySettings(document);
        await Promise.resolve();
        await Promise.resolve();

        expect(window.NEXUS_BD).toBeUndefined();
        expect(document.getElementById('yt-api-key').closest('.input-group').style.display).toBe('none');
        expect(document.getElementById('web-search-provider').closest('.input-group').style.display).toBe('none');

        const host = document.getElementById('discovery-providers');
        const selects = [...host.querySelectorAll('select.nexus-discovery-select')];
        expect(selects.map((select) => select.id)).toEqual([
            'discovery-web',
            'discovery-image',
            'discovery-video',
            'discovery-music',
            'discovery-imageGenerator',
        ]);
        for (const select of selects) {
            expect(select.options[0].textContent).toBe('Auto — recommended');
            expect(select.value).toBe('auto');
        }

        expect(document.getElementById('discovery-web').closest('.nexus-discovery-row').textContent).toContain(
            'Ready · Brave Search · provided by this site'
        );
        expect(document.getElementById('discovery-image').closest('.nexus-discovery-row').textContent).toContain(
            'Ready · Pexels · provided by this site'
        );
        expect(document.getElementById('discovery-video').closest('.nexus-discovery-row').textContent).toContain(
            'Ready · YouTube · provided by this site'
        );
        expect(document.getElementById('discovery-music').closest('.nexus-discovery-row').textContent).toContain(
            'Ready · YouTube · provided by this site'
        );
        expect(
            document.getElementById('discovery-imageGenerator').closest('.nexus-discovery-row').textContent
        ).toContain('Ready · Pollinations · provided by this site');

        expect([...host.querySelectorAll('.nexus-capability-section')].map((node) => node.textContent)).toEqual([
            'SEARCH & DISCOVERY',
            'CREATION',
        ]);
    });
});
