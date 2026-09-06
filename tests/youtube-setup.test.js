/**
 * Connecting YouTube search (batch D1).
 *
 * The bug this closes is not that search was broken — it needs a key and always did. It is
 * that the app told a person who asked for a song to run
 * `localStorage.setItem('nexus.yt.apiKey', 'YOUR_KEY')`. A line of JavaScript, printed in a
 * chat, as the answer to "play some music".
 *
 * Three claims carry the batch:
 *
 *   * **no consumer surface prints code.** Asserted by grepping the rendered no-key message
 *     for `setItem`, `localStorage` and the storage key itself — a test that survives someone
 *     rewording the sentence;
 *   * **the legacy key still works.** Somebody who set it a year ago is not broken, and never
 *     has to learn that Settings exists;
 *   * **"play a video in youtube of music" searches for music.** It searched for *video*,
 *     because the lazy pattern stopped at the first "in". Connecting a key without this fixed
 *     buys a working search for the wrong thing.
 */

const Settings = require('../src/features/youtube/YouTubeSettings.js');

let Ask;
let Companion;

/** A localStorage stand-in that starts empty and can be inspected. */
function fakeStorage(seed) {
    const map = new Map(Object.entries(seed || {}));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="chat-history"></div>';
    window.__NEXUS_YT_SETTINGS_NOAUTO__ = true;
    window.__NEXUS_YT_ASK_NOAUTO__ = true;
    delete window.NEXUS_YT_CONFIG;
    localStorage.clear();
    Ask = require('../src/features/youtube/YouTubeAsk.js');
    Companion = require('../src/features/youtube/YouTubeCompanion.js');
    window.NEXUS_YT = require('../src/features/youtube/YouTubeLink.js');
    window.NEXUS_YT_SETTINGS = Settings;
    window.NEXUS_YT_COMPANION = Companion;
});

// ── where the key comes from ────────────────────────────────────────────────

describe('key sources', () => {
    test('Settings wins over a host key and over the legacy one', () => {
        window.NEXUS_YT_CONFIG = { apiKey: 'from-host' };
        const storage = fakeStorage({
            'nexus.yt.apiKey': 'from-legacy',
            nexus_discovery_settings: JSON.stringify({ youtube: { apiKey: 'from-settings' } }),
        });
        expect(Settings.apiKey(storage)).toBe('from-settings');
    });

    test('a host page key is used when Settings holds none', () => {
        window.NEXUS_YT_CONFIG = { apiKey: 'from-host' };
        expect(Settings.apiKey(fakeStorage({ 'nexus.yt.apiKey': 'from-legacy' }))).toBe('from-host');
    });

    test('the legacy key still works, and is never written to', () => {
        // Somebody who ran the old setItem instruction a year ago must keep working.
        const storage = fakeStorage({ 'nexus.yt.apiKey': 'from-legacy' });
        expect(Settings.apiKey(storage)).toBe('from-legacy');
        Settings.write({ youtube: { apiKey: 'typed-in-settings' } }, storage);
        expect(storage.getItem('nexus.yt.apiKey')).toBe('from-legacy');
        expect(Settings.apiKey(storage)).toBe('typed-in-settings');
    });

    test('a field opened and left blank does not shadow a key that exists', () => {
        const storage = fakeStorage({
            'nexus.yt.apiKey': 'from-legacy',
            nexus_discovery_settings: JSON.stringify({ youtube: { apiKey: '   ' } }),
        });
        expect(Settings.apiKey(storage)).toBe('from-legacy');
    });

    test('a corrupt settings blob is not settings, and does not throw', () => {
        expect(Settings.apiKey(fakeStorage({ nexus_discovery_settings: '{not json' }))).toBe('');
    });

    test('the companion asks Settings first, so one order governs every caller', () => {
        window.NEXUS_YT_CONFIG = { apiKey: 'from-host' };
        localStorage.setItem('nexus_discovery_settings', JSON.stringify({ youtube: { apiKey: 'from-settings' } }));
        expect(Companion.apiKey()).toBe('from-settings');
    });
});

// ── the Settings row ────────────────────────────────────────────────────────

describe('the Settings field', () => {
    beforeEach(() => {
        document.body.innerHTML =
            '<div id="chat-history"></div><button id="settings-btn"></button>' +
            '<input id="yt-api-key" /><button id="save-settings"></button>';
    });

    test('SAVE stores what was typed', () => {
        Settings.mount(document);
        document.getElementById('yt-api-key').value = ' typed-key ';
        document.getElementById('save-settings').click();
        expect(Settings.apiKey()).toBe('typed-key');
    });

    test('opening Settings never copies a legacy key into the box', () => {
        // Filling it would migrate, on the next SAVE, a key the user never touched — and
        // would show a secret they did not ask to see.
        localStorage.setItem('nexus.yt.apiKey', 'from-legacy');
        Settings.mount(document);
        document.getElementById('settings-btn').click();
        expect(document.getElementById('yt-api-key').value).toBe('');
        expect(Settings.apiKey()).toBe('from-legacy');
    });

    test('a page with no Settings modal is inert rather than broken', () => {
        document.body.innerHTML = '<div id="chat-history"></div>';
        expect(() => Settings.mount(document)).not.toThrow();
        expect(Settings.openSettings(document)).toBe(false);
    });
});

// ── what the user is shown ──────────────────────────────────────────────────

describe('the no-key message', () => {
    test('prints no code, and offers a button instead', async () => {
        document.body.innerHTML =
            '<div id="chat-history"></div><button id="settings-btn"></button><input id="yt-api-key" />';
        const out = await Ask.fulfil('lofi', { doc: document });
        expect(out.why).toBe('no key');

        const said = document.body.textContent;
        // Reworded copy still passes; copy that teaches JavaScript does not.
        expect(said).not.toMatch(/setItem/i);
        expect(said).not.toMatch(/localStorage/i);
        expect(said).not.toContain('nexus.yt.apiKey');
        expect(said).not.toMatch(/YOUR_KEY/);

        expect(document.querySelector('.nexus-yt-setup')).not.toBeNull();
        expect(document.querySelector('.nexus-yt-setup').tagName).toBe('BUTTON');
    });

    test('the request is still honoured — the search link is there', async () => {
        await Ask.fulfil('lofi', { doc: document });
        const link = document.querySelector('a.nexus-yt-open');
        expect(link.href).toContain('search_query=lofi');
    });

    test('"Set up YouTube" opens Settings', async () => {
        document.body.innerHTML =
            '<div id="chat-history"></div><button id="settings-btn"></button><input id="yt-api-key" />';
        const opened = jest.fn();
        document.getElementById('settings-btn').addEventListener('click', opened);
        await Ask.fulfil('lofi', { doc: document });
        document.querySelector('.nexus-yt-setup').click();
        expect(opened).toHaveBeenCalled();
    });
});

// ── the query the user actually asked for ───────────────────────────────────

describe('parseIntent', () => {
    test('"play a video in youtube of music" searches for music, not video', () => {
        expect(Ask.parseIntent('play a video in youtube of music').query).toBe('music');
    });

    test.each([
        ['play a song on youtube about space', 'space'],
        ['put on a video on youtube with jazz', 'jazz'],
    ])('"%s" → %s', (text, query) => {
        expect(Ask.parseIntent(text).query).toBe(query);
    });

    test('"for" is not a connector, or "for me" becomes the search', () => {
        expect(Ask.parseIntent('put on jazz on youtube for me').query).toBe('jazz');
    });

    test.each([
        ['play lofi on youtube', 'lofi'],
        ['play lofi on youtube please', 'lofi'],
        ['search youtube for chillhop', 'chillhop'],
        ['/yt daft punk', 'daft punk'],
    ])('"%s" is unchanged → %s', (text, query) => {
        expect(Ask.parseIntent(text).query).toBe(query);
    });

    test.each(['play chess with me', "let's play a game", 'can you help me with my code'])(
        'leaves "%s" for the model',
        (text) => {
            expect(Ask.parseIntent(text)).toBeNull();
        }
    );
});
