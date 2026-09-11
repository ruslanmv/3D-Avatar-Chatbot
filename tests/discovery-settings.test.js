/**
 * Settings ▸ Discovery & Media (batch D6).
 *
 * Two claims, and the second is the one the section exists for:
 *
 *   * **`Auto` is the answer for almost everybody**, and it is the default. Nobody has to
 *     learn the word "provider" to search for a video;
 *   * **a provider is never shown as working when it is not.** That is the failure that turns
 *     "I picked that one" into "search is broken", with nothing on screen connecting the two —
 *     so a named preference is honoured only while the provider it names is ready, and the
 *     list reads its state live rather than from what somebody typed.
 */

const Registry = require('../src/features/discovery/ProviderRegistry.js');
const Settings = require('../src/features/discovery/DiscoverySettings.js');

function provider(id, { available = true, reason = 'ok', capabilities = ['video.search', 'music.search'] } = {}) {
    return {
        ID: id,
        status: () => ({ id, configured: available, available, capabilities, reason }),
        search: async () => [],
    };
}

const MARKUP = '<button id="settings-btn"></button><div id="discovery-providers"></div>';

beforeEach(() => {
    document.body.innerHTML = MARKUP;
    localStorage.clear();
    Registry.reset();
    window.NEXUS_DISCOVERY = Registry;
});

describe('Auto, and naming one instead', () => {
    test('with no choice recorded, the first ready provider answers', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng'));
        expect(Registry.forCapability('video.search').ID).toBe('youtube');
        expect(Registry.preferences()).toEqual({});
    });

    test('a named provider wins for its whole group, not just one capability', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng', { capabilities: ['video.search', 'video.play'] }));
        Registry.setPreference('video', 'searxng');
        expect(Registry.forCapability('video.search').ID).toBe('searxng');
        expect(Registry.forCapability('video.play').ID).toBe('searxng');
    });

    test('a choice for video does not decide music', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng', { capabilities: ['video.search'] }));
        Registry.setPreference('video', 'searxng');
        expect(Registry.forCapability('music.search').ID).toBe('youtube');
    });

    test('a named provider that has lost its key falls back rather than failing', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng', { available: false, reason: 'no-key' }));
        Registry.setPreference('video', 'searxng');
        expect(Registry.forCapability('video.search').ID).toBe('youtube');
    });

    test('nothing ready is still nothing, whatever was chosen', () => {
        Registry.register(provider('youtube', { available: false, reason: 'no-key' }));
        Registry.setPreference('video', 'youtube');
        expect(Registry.forCapability('video.search')).toBeNull();
    });

    test('a corrupt settings blob is not a preference', () => {
        localStorage.setItem(Registry.SETTINGS_KEY, '{not json');
        Registry.register(provider('youtube'));
        expect(Registry.preferences()).toEqual({});
        expect(Registry.forCapability('video.search').ID).toBe('youtube');
    });

    test('setting a preference leaves the rest of the discovery settings alone', () => {
        localStorage.setItem(Registry.SETTINGS_KEY, JSON.stringify({ youtube: { apiKey: 'k' } }));
        Registry.setPreference('video', 'youtube');
        const stored = JSON.parse(localStorage.getItem(Registry.SETTINGS_KEY));
        expect(stored.youtube.apiKey).toBe('k');
        expect(stored.preferences.video).toBe('youtube');
    });
});

describe('the Settings section', () => {
    test('offers Auto first, and it is what is selected', () => {
        Registry.register(provider('youtube'));
        Settings.render(document);
        const select = document.getElementById('discovery-video');
        expect(select.options[0].value).toBe('auto');
        expect(select.value).toBe('auto');
    });

    test('lists an unconfigured provider, and will not let you pick it', () => {
        Registry.register(provider('youtube', { available: false, reason: 'no-key' }));
        Settings.render(document);
        const option = [...document.getElementById('discovery-video').options].find((o) => o.value === 'youtube');
        expect(option).toBeTruthy();
        expect(option.disabled).toBe(true);
        // Provider choice and provider state are separate in the capability-first UI. The
        // dropdown names the implementation; the line below it explains why it cannot run.
        expect(option.textContent).toBe('YouTube');
        expect(document.querySelector('.nexus-discovery-status').textContent).toBe('API key required');
    });

    test('states each provider live, not from what was typed', () => {
        Registry.register(provider('youtube'));
        Settings.render(document);
        expect(document.querySelector('.nexus-discovery-status').textContent).toMatch(/^Ready\b/);
        expect(document.querySelector('.nexus-discovery-status').dataset.ready).toBe('yes');
    });

    test('changing the dropdown records the choice', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng'));
        Settings.render(document);
        const select = document.getElementById('discovery-video');
        select.value = 'searxng';
        select.dispatchEvent(new Event('change'));
        expect(Registry.preferences().video).toBe('searxng');
    });

    test('re-renders when Settings opens, so a key added last visit shows as Ready', () => {
        let ready = false;
        Registry.register({
            ID: 'youtube',
            status: () => ({
                id: 'youtube',
                configured: ready,
                available: ready,
                capabilities: ['video.search'],
                reason: ready ? 'ok' : 'no-key',
            }),
        });
        Settings.mount(document);
        expect(document.querySelector('.nexus-discovery-status').textContent).toBe('API key required');
        ready = true;
        document.getElementById('settings-btn').click();
        expect(document.querySelector('.nexus-discovery-status').textContent).toMatch(/^Ready\b/);
    });

    test('a group nothing can serve is not offered at all', () => {
        Registry.register(provider('youtube', { capabilities: ['video.search'] }));
        Settings.render(document);
        expect(document.getElementById('discovery-video')).not.toBeNull();
        expect(document.getElementById('discovery-music')).toBeNull();
    });

    test('no providers says so rather than drawing an empty control', () => {
        Settings.render(document);
        expect(document.querySelector('.nexus-discovery-empty')).not.toBeNull();
    });

    test('a page without the container is inert', () => {
        document.body.innerHTML = '';
        expect(() => Settings.render(document)).not.toThrow();
        expect(Settings.render(document)).toBeNull();
    });

    test('every class it draws is styled', () => {
        const fs = require('fs');
        const path = require('path');
        const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'main.css'), 'utf8');
        Registry.register(provider('youtube'));
        Settings.render(document);
        const classes = new Set();
        document
            .getElementById('discovery-providers')
            .querySelectorAll('*')
            .forEach((n) => {
                n.classList.forEach((c) => {
                    if (c.startsWith('nexus-discovery')) classes.add(c);
                });
            });
        expect(classes.size).toBeGreaterThan(0);
        for (const c of classes) {
            expect(`${c} :: ${css.includes(`.${c}`)}`).toBe(`${c} :: true`);
        }
    });
});

describe('opening Settings does not freeze the tab', () => {
    const status = (id, extra = {}) => provider(id, extra).status();

    function countingRegistry({ stopAfter = 6 } = {}) {
        const calls = { warm: 0 };
        return {
            calls,
            all: () => [status('youtube')],
            preferences: () => ({}),
            setPreference: () => {},
            warm() {
                calls.warm += 1;
                return calls.warm >= stopAfter ? new Promise(() => {}) : Promise.resolve([]);
            },
        };
    }

    const drain = async () => {
        for (let i = 0; i < 50; i += 1) {
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        document.body.innerHTML = MARKUP;
    });

    test('the probe runs once per open, not once per repaint', async () => {
        const reg = countingRegistry();
        window.NEXUS_DISCOVERY = reg;
        Settings.render(document);
        await drain();
        expect(reg.calls.warm).toBe(1);
    });

    test('the repaint after the probe cannot start another probe', async () => {
        const reg = countingRegistry();
        window.NEXUS_DISCOVERY = reg;
        Settings.render(document, { warm: false });
        await drain();
        expect(reg.calls.warm).toBe(0);
    });

    test('and the repaint still happens, so the list settles on the truth', async () => {
        let ready = false;
        const reg = {
            all: () => [status('youtube', { available: ready, reason: ready ? 'ok' : 'checking' })],
            preferences: () => ({}),
            setPreference: () => {},
            warm: () =>
                Promise.resolve([]).then(() => {
                    ready = true;
                }),
        };
        window.NEXUS_DISCOVERY = reg;
        Settings.render(document);
        expect(document.getElementById('discovery-providers').textContent).toContain(Settings.STATE.checking);
        await drain();
        expect(document.getElementById('discovery-providers').textContent).toContain(Settings.STATE.ok);
    });

    test('a second open warms again, so a key added meanwhile shows up', async () => {
        const reg = countingRegistry();
        window.NEXUS_DISCOVERY = reg;
        Settings.render(document);
        await drain();
        Settings.render(document);
        await drain();
        expect(reg.calls.warm).toBe(2);
    });

    test('a probe that rejects still repaints and still stops', async () => {
        const calls = { warm: 0 };
        window.NEXUS_DISCOVERY = {
            all: () => [status('youtube')],
            preferences: () => ({}),
            setPreference: () => {},
            warm() {
                calls.warm += 1;
                return calls.warm >= 6 ? new Promise(() => {}) : Promise.reject(new Error('offline'));
            },
        };
        Settings.render(document);
        await drain();
        expect(calls.warm).toBe(1);
        expect(document.getElementById('discovery-providers').textContent).toBeTruthy();
    });
});
