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

// ── the preference ──────────────────────────────────────────────────────────

describe('Auto, and naming one instead', () => {
    test('with no choice recorded, the first ready provider answers', () => {
        Registry.register(provider('youtube'));
        Registry.register(provider('searxng'));
        expect(Registry.forCapability('video.search').ID).toBe('youtube');
        expect(Registry.preferences()).toEqual({});
    });

    test('a named provider wins for its whole group, not just one capability', () => {
        // "Which video provider" is one question a person answers once — `video.search` and
        // `video.play` are the same choice.
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
        // Honouring a dead preference would read as "search is broken" and nothing on screen
        // would say the choice was the cause.
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
        // The API key lives in the same object. A write here must not eat it.
        localStorage.setItem(Registry.SETTINGS_KEY, JSON.stringify({ youtube: { apiKey: 'k' } }));
        Registry.setPreference('video', 'youtube');
        const stored = JSON.parse(localStorage.getItem(Registry.SETTINGS_KEY));
        expect(stored.youtube.apiKey).toBe('k');
        expect(stored.preferences.video).toBe('youtube');
    });
});

// ── what Settings shows ─────────────────────────────────────────────────────

describe('the Settings section', () => {
    test('offers Auto first, and it is what is selected', () => {
        Registry.register(provider('youtube'));
        Settings.render(document);
        const select = document.getElementById('discovery-video');
        expect(select.options[0].value).toBe('auto');
        expect(select.value).toBe('auto');
    });

    test('lists an unconfigured provider, and will not let you pick it', () => {
        // Hiding it would make "why can I not choose YouTube?" unanswerable.
        Registry.register(provider('youtube', { available: false, reason: 'no-key' }));
        Settings.render(document);
        const option = [...document.getElementById('discovery-video').options].find((o) => o.value === 'youtube');
        expect(option).toBeTruthy();
        expect(option.disabled).toBe(true);
        expect(option.textContent).toContain('API key required');
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
        // The same standing rule the launcher keeps: a class with no CSS renders as a
        // browser default in a dark panel, which is how B36 shipped four white boxes.
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

/**
 * Opening Settings must not freeze the tab.
 *
 * D13 wanted one repaint after the readiness probe lands, so the provider list settles on the
 * truth instead of sitting at "Checking…". The repaint is itself a `render` call, so the second
 * one must not start another probe — and the guard that was supposed to ensure this cleared its
 * flag *before* calling `render`, so the guard was already open by the time the guarded code
 * ran. Every repaint warmed again.
 *
 * That froze the tab outright rather than merely wasting work. Once each provider's `ready()`
 * has cached its answer, `warm()` resolves with no I/O, so the loop is pure microtasks — and the
 * microtask queue is drained to empty before the browser paints, dispatches a click, or fires a
 * timer. Measured in Chromium at 412×915: responsive for 46 ms after the Settings tap, then a
 * freeze the CPU profiler could not even be stopped from. `Debugger.pause` named the line.
 *
 * These tests are written so the old code *fails* rather than hanging the suite: `warm()` stops
 * resolving after a handful of calls, so a runaway loop shows up as a count, not as a test run
 * that never ends.
 */
describe('opening Settings does not freeze the tab', () => {
    /** `all()` yields the *status* shape the registry returns, not the provider itself. */
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
                // A promise that never settles caps a runaway loop, so the failure is a wrong
                // count instead of a test that never returns.
                return calls.warm >= stopAfter ? new Promise(() => {}) : Promise.resolve([]);
            },
        };
    }

    /** Let every queued microtask run — which is exactly what the buggy loop never allowed. */
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
        // The stop condition is a parameter, so it is visible in the call rather than depending
        // on when a shared field happens to be reset.
        const reg = countingRegistry();
        window.NEXUS_DISCOVERY = reg;
        Settings.render(document, { warm: false });
        await drain();
        expect(reg.calls.warm).toBe(0);
    });

    test('and the repaint still happens, so the list settles on the truth', async () => {
        // The whole point of warming: a provider that reports "checking" first and "ok" once
        // the probe lands must end up reading Ready.
        let ready = false;
        const reg = {
            all: () => [status('youtube', { available: ready, reason: ready ? 'ok' : 'checking' })],
            preferences: () => ({}),
            setPreference: () => {},
            // Flipped when the probe *resolves*, not when it is called: `render` warms before
            // it reads the provider list, so a synchronous flip here would be true by the time
            // the first paint happens and the test would prove nothing about the repaint.
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
        // Terminating must not mean "never probe again": somebody who pastes a key and reopens
        // Settings has to see it take effect.
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
