/**
 * Choosing something to put on (batches D3, D4).
 *
 * Four properties carry these batches, and each has a test that fails when it stops holding:
 *
 *   * **searching costs nothing.** Opening Together, opening Watch and typing a query must
 *     not touch `getDisplayMedia`. A picker that quietly acquired a screen grant would be the
 *     worst possible way to answer "what are we watching?";
 *   * **no player lives in the dialog.** Together is where you choose; an iframe here would
 *     make it a place to watch, and it disappears when the panel closes;
 *   * **selection publishes into the conversation**, as an ordinary assistant message whose
 *     text carries the canonical URL — the only shape `_persistChat` keeps, and therefore the
 *     only one that survives a reload;
 *   * **the existing options survive everything.** A provider that is missing, unconfigured
 *     or throwing must leave `Share a tab` and `Open a video file` exactly where they were.
 */

const MediaResult = require('../src/features/discovery/MediaResult.js');

let Registry;
let YouTube;
let Picker;
let Publisher;
let Contract;

/** A provider that answers whatever the test says, without a network. */
function fakeProvider(overrides = {}) {
    return Object.assign(
        {
            ID: 'fake',
            status: () => ({
                id: 'fake',
                configured: true,
                available: true,
                capabilities: ['video.search', 'music.search'],
                reason: 'ok',
            }),
            search: async () =>
                MediaResult.many([
                    {
                        id: 'aaa',
                        provider: 'fake',
                        url: 'https://www.youtube.com/watch?v=aaa',
                        title: 'Lofi hip hop radio',
                        creator: 'Lofi Girl',
                    },
                    {
                        id: 'bbb',
                        provider: 'fake',
                        url: 'https://www.youtube.com/watch?v=bbb',
                        title: 'Chillhop essentials',
                        creator: 'Chillhop Music',
                    },
                ]),
        },
        overrides
    );
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="chat-history"></div>';
    window.__NEXUS_YT_ASK_NOAUTO__ = true;
    window.__NEXUS_YT_SETTINGS_NOAUTO__ = true;
    localStorage.clear();
    delete window.NEXUS_YT_CONFIG;

    MediaResult.KINDS; // touched so the shared module is unambiguously loaded first
    window.NEXUS_MEDIA_RESULT = MediaResult;
    YouTube = require('../src/features/discovery/providers/youtube.js');
    window.NEXUS_DISCOVERY_YOUTUBE = YouTube;
    Registry = require('../src/features/discovery/ProviderRegistry.js');
    window.NEXUS_DISCOVERY = Registry;
    Picker = require('../src/features/together/ui/MediaSearchPicker.js');
    window.NEXUS_MEDIA_PICKER = Picker;
    Publisher = require('../src/features/together/ui/ConversationPublisher.js');
    window.NEXUS_CONVERSATION_PUBLISHER = Publisher;
    window.NEXUS_YT_ASK = require('../src/features/youtube/YouTubeAsk.js');
    Contract = require('../src/features/together/activities/contract.js');

    Registry.reset();
});

// ── the normalized shape ────────────────────────────────────────────────────

describe('MediaResult', () => {
    test('a result with no id or no url is not a result', () => {
        expect(MediaResult.make({ url: 'https://x' })).toBeNull();
        expect(MediaResult.make({ id: 'a' })).toBeNull();
        expect(MediaResult.many([{ id: 'a' }, { id: 'b', url: 'https://y' }])).toHaveLength(1);
    });

    test('an unknown kind becomes video rather than being carried through', () => {
        expect(MediaResult.make({ id: 'a', url: 'https://y', kind: 'nonsense' }).kind).toBe('video');
        expect(MediaResult.make({ id: 'a', url: 'https://y', kind: 'track' }).kind).toBe('track');
    });

    test('a duration is shown when it is known and never invented', () => {
        expect(MediaResult.clock(187)).toBe('3:07');
        expect(MediaResult.clock(null)).toBe('');
        expect(MediaResult.make({ id: 'a', url: 'https://y' }).duration).toBeNull();
    });
});

// ── the provider, and the registry that asks by capability ──────────────────

describe('the YouTube provider', () => {
    test('with no key it is configured: false, with a reason a UI can act on', () => {
        window.NEXUS_YT_COMPANION = { apiKey: () => '' };
        expect(YouTube.status()).toMatchObject({ configured: false, available: false, reason: 'no-key' });
    });

    test('a page where the YouTube feature never loaded is a different answer', () => {
        delete window.NEXUS_YT_COMPANION;
        expect(YouTube.status().reason).toBe('not-loaded');
    });

    test('it wraps the search that already exists rather than reimplementing it', async () => {
        const search = jest.fn(async () => [{ id: 'aaa', name: 'Lofi', author: 'Lofi Girl' }]);
        window.NEXUS_YT_COMPANION = { apiKey: () => 'k', search };
        const out = await YouTube.search('lofi', { search });
        expect(search).toHaveBeenCalledWith('lofi', { max: 4 });
        expect(out[0]).toMatchObject({
            provider: 'youtube',
            kind: 'video',
            title: 'Lofi',
            creator: 'Lofi Girl',
            url: 'https://www.youtube.com/watch?v=aaa',
        });
    });

    test('a provider that throws found nothing, and does not take the panel with it', async () => {
        window.NEXUS_YT_COMPANION = {
            apiKey: () => 'k',
            search: async () => {
                throw new Error('quota');
            },
        };
        await expect(YouTube.search('lofi')).resolves.toEqual([]);
    });
});

describe('the registry', () => {
    test('asks by capability, not by provider name', () => {
        Registry.register(fakeProvider());
        expect(Registry.forCapability('video.search').ID).toBe('fake');
        expect(Registry.forCapability('web.search')).toBeNull();
    });

    test('never returns a provider that is not ready', () => {
        Registry.register(
            fakeProvider({
                status: () => ({ id: 'fake', configured: false, available: false, capabilities: [], reason: 'no-key' }),
            })
        );
        expect(Registry.forCapability('video.search')).toBeNull();
        // Two reasons, two sentences, two different buttons.
        expect(Registry.why('video.search')).toBe('no-key');
    });

    test('nothing registered is its own reason', () => {
        expect(Registry.why('video.search')).toBe('no-provider');
    });
});

// ── the picker ──────────────────────────────────────────────────────────────

describe('the picker', () => {
    function mount(extra = {}) {
        const onChoose = jest.fn();
        const node = Picker.build(Object.assign({ doc: document, mediaKind: 'video', onChoose }, extra));
        document.body.appendChild(node);
        return { node, onChoose };
    }

    test('searches nothing on mount, and nothing for an empty box', async () => {
        const provider = fakeProvider();
        provider.search = jest.fn(provider.search);
        Registry.register(provider);
        const { node } = mount();
        expect(provider.search).not.toHaveBeenCalled();
        await node.search('   ');
        expect(provider.search).not.toHaveBeenCalled();
    });

    test('draws rows, and never an iframe', async () => {
        Registry.register(fakeProvider());
        const { node } = mount();
        await node.search('lofi');
        expect(node.querySelectorAll('.nexus-bd-together-result')).toHaveLength(2);
        expect(node.textContent).toContain('Lofi hip hop radio');
        expect(node.textContent).toContain('Lofi Girl');
        // Together is where you choose. An iframe here would make it a place to watch.
        expect(document.querySelector('iframe')).toBeNull();
    });

    test('caps what it shows, however many come back', async () => {
        Registry.register(
            fakeProvider({
                search: async () =>
                    MediaResult.many(
                        Array.from({ length: 10 }, (_, i) => ({
                            id: `x${i}`,
                            url: `https://www.youtube.com/watch?v=x${i}`,
                            title: `Video ${i}`,
                        }))
                    ),
            })
        );
        const { node } = mount();
        await node.search('lofi');
        expect(node.querySelectorAll('.nexus-bd-together-result').length).toBe(Picker.MAX_RESULTS);
    });

    test('a slow query never overwrites the one after it', async () => {
        // The failure this prevents is silent and looks like the app ignoring you: you retype,
        // the first search lands late, and the results are for the query you abandoned.
        let releaseFirst;
        const first = new Promise((r) => {
            releaseFirst = r;
        });
        let call = 0;
        Registry.register(
            fakeProvider({
                search: async (q) => {
                    call += 1;
                    if (call === 1) {
                        await first;
                        return MediaResult.many([
                            { id: 'old', url: 'https://www.youtube.com/watch?v=old', title: 'STALE' },
                        ]);
                    }
                    return MediaResult.many([
                        { id: 'new', url: 'https://www.youtube.com/watch?v=new', title: 'FRESH' },
                    ]);
                },
            })
        );
        const { node } = mount();
        const slow = node.search('first');
        await node.search('second');
        releaseFirst();
        expect((await slow).why).toBe('stale');
        expect(node.textContent).toContain('FRESH');
        expect(node.textContent).not.toContain('STALE');
    });

    test.each([
        ['nothing found', async () => [], /Nothing found/],
        [
            'a failure',
            async () => {
                throw new Error('boom');
            },
            /unavailable right now/,
        ],
    ])('%s is a sentence, never a code', async (_label, search, matcher) => {
        Registry.register(fakeProvider({ search }));
        const { node } = mount();
        await node.search('lofi');
        expect(node.querySelector('.nexus-bd-together-searchstatus').textContent).toMatch(matcher);
        expect(node.textContent).not.toMatch(/\b(4\d\d|5\d\d|undefined|null|Error)\b/);
    });

    test('an unconfigured provider offers a button, not an instruction', async () => {
        Registry.register(
            fakeProvider({
                status: () => ({ id: 'fake', configured: false, available: false, capabilities: [], reason: 'no-key' }),
            })
        );
        const { node } = mount();
        await node.search('lofi');
        expect(node.querySelector('.nexus-bd-together-connect')).not.toBeNull();
        expect(node.textContent).not.toMatch(/localStorage|setItem/);
    });

    test('choosing a row hands back the normalized result', async () => {
        Registry.register(fakeProvider());
        const { node, onChoose } = mount();
        await node.search('lofi');
        node.querySelector('.nexus-bd-together-result').click();
        expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'aaa', provider: 'fake' }));
    });

    test('rows are buttons, so a keyboard reaches them', async () => {
        Registry.register(fakeProvider());
        const { node } = mount();
        await node.search('lofi');
        for (const row of node.querySelectorAll('.nexus-bd-together-result')) {
            expect(row.tagName).toBe('BUTTON');
            expect(row.getAttribute('aria-label')).toBeTruthy();
        }
    });
});

// ── publishing into the conversation ────────────────────────────────────────

describe('the publisher', () => {
    const result = {
        id: 'aaa',
        provider: 'youtube',
        kind: 'video',
        title: 'Lofi hip hop radio',
        creator: 'Lofi Girl',
        url: 'https://www.youtube.com/watch?v=aaa',
        playback: { type: 'youtube', inline: true, immersive: true },
    };

    test('writes one ordinary assistant message carrying the canonical URL', () => {
        Publisher.publish(result, { doc: document, win: window });
        const rows = document.querySelectorAll('#chat-history .chat-row');
        expect(rows).toHaveLength(1);
        const text = rows[0].querySelector('.message-text').textContent;
        expect(text).toContain('Lofi hip hop radio');
        // The URL has to be in `.message-text`: that is the only thing `_persistChat` saves,
        // so it is the only thing that survives a reload and can be decorated again.
        expect(text).toContain('https://www.youtube.com/watch?v=aaa');
    });

    test("persists through the app's own function, not a private copy", () => {
        window._persistChat = jest.fn();
        window.chatHistory = { addMessage: jest.fn() };
        Publisher.publish(result, { doc: document, win: window });
        expect(window._persistChat).toHaveBeenCalled();
        expect(window.chatHistory.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('watch?v=aaa'));
    });

    test('creates no player — the card is drawn by the existing decorator', () => {
        Publisher.publish(result, { doc: document, win: window });
        expect(document.querySelector('iframe')).toBeNull();
    });

    test('a page with no chat is not a crash', () => {
        document.body.innerHTML = '';
        expect(() => Publisher.publish(result, { doc: document, win: window })).not.toThrow();
    });
});

// ── the contract, and what must not disappear ───────────────────────────────

describe('the setup screens', () => {
    function inputsFor(id) {
        // The specs are `ADAPTERS`, which is what the panel reads through `adapt()`.
        return Contract.ADAPTERS[id].inputs();
    }

    test('Watch offers search, and still offers both of the things it always did', () => {
        const ids = inputsFor('watch').map((i) => i.id);
        expect(ids).toEqual(['search', 'tab', 'file']);
    });

    test('Music offers search, and local audio is still there', () => {
        const ids = inputsFor('music').map((i) => i.id);
        expect(ids).toEqual(['search', 'file']);
    });

    test('searching asks for no permission — it is not starting the activity', () => {
        for (const id of ['watch', 'music']) {
            const search = inputsFor(id).find((i) => i.id === 'search');
            expect(search.kind).toBe('discovery');
            expect(search.permission).toBeNull();
        }
    });
});

// ── the panel, end to end ───────────────────────────────────────────────────

describe('Watch setup, in the real panel', () => {
    const TogetherPanel = require('../src/features/together/ui/TogetherPanel.js');

    /** Enough of an activity for the panel to adapt and paint. */
    function watchActivity() {
        return {
            id: 'watch',
            label: 'Watch',
            playFile: async () => ({ ok: true }),
            shareTab: async () => ({ ok: true }),
            stop() {},
        };
    }

    function openWatch(extraWin = {}) {
        document.body.innerHTML = '<div id="chat-history"></div><div id="app"></div>';
        const consent = { state: { state: 'idle' }, onChange: () => () => {}, request: jest.fn() };
        const win = Object.assign(
            {
                NEXUS_MEDIA_PICKER: Picker,
                NEXUS_CONVERSATION_PUBLISHER: Publisher,
                NEXUS_YT_ASK: window.NEXUS_YT_ASK,
            },
            extraWin
        );
        const panel = TogetherPanel.attach({ consent, capture: {}, config: {}, doc: document, win });
        panel.__consent = consent;
        // The launcher mounts the panel in the running app; here there is no launcher, so the
        // test does what it does — into `body`, which is where it goes.
        panel.mount(document.body);
        panel.register(watchActivity());
        panel.open();
        panel.choose('watch');
        return panel;
    }

    test('shows the search box and keeps both of the options it always had', () => {
        Registry.register(fakeProvider());
        openWatch();
        expect(document.querySelector('.nexus-bd-together-searchinput')).not.toBeNull();
        const labels = [...document.querySelectorAll('.nexus-bd-together-option')].map((b) =>
            b.textContent.replace(/\s+/g, ' ').trim()
        );
        expect(labels.some((l) => l.startsWith('Share a tab'))).toBe(true);
        expect(labels.some((l) => l.startsWith('Open a video file'))).toBe(true);
        // A search is not one of the buttons, or pressing it would start the activity.
        expect(labels.some((l) => l.startsWith('Search videos'))).toBe(false);
    });

    test('opening Watch asks for nothing', () => {
        Registry.register(fakeProvider());
        const captureCall = jest.fn();
        navigator.mediaDevices = { getDisplayMedia: captureCall, getUserMedia: captureCall };
        openWatch();
        expect(captureCall).not.toHaveBeenCalled();
    });

    test('discovery not loaded leaves the panel exactly as it was', () => {
        // The additive promise: delete the folder and Watch is the screen it has always been.
        openWatch({ NEXUS_MEDIA_PICKER: null, NEXUS_CONVERSATION_PUBLISHER: null });
        expect(document.querySelector('.nexus-bd-together-searchinput')).toBeNull();
        expect(document.querySelectorAll('.nexus-bd-together-option').length).toBe(2);
    });

    test('choosing a result closes Together and puts the media in the conversation', async () => {
        Registry.register(fakeProvider());
        const panel = openWatch();
        const picker = document.querySelector('.nexus-bd-together-search');
        await picker.search('lofi');
        picker.querySelector('.nexus-bd-together-result').click();

        // Together goes first, so the card lands in a chat the user can already see rather
        // than behind a dialog they then have to dismiss. The panel closes by hiding rather
        // than by being removed — asserted the way the app actually does it, not the way a
        // test author might assume.
        expect(document.getElementById(TogetherPanel.PANEL_ID).hidden).toBe(true);
        const text = document.querySelector('#chat-history .message-text').textContent;
        expect(text).toContain('Lofi hip hop radio');
        expect(text).toContain('watch?v=aaa');
        void panel;
    });

    test('choosing a result does not start Watch, and asks for no screen', async () => {
        // Asserted at the consent gate rather than at `getDisplayMedia`, because the panel
        // never touches that API directly — `ConsentMachine` owns it, and a test watching the
        // browser API would pass even while the panel was asking the machine for a grant.
        // That is not hypothetical: it is what an earlier version of this test did, and a
        // mutation that started the activity on selection walked straight past it.
        Registry.register(fakeProvider());
        const panel = openWatch();
        const picker = document.querySelector('.nexus-bd-together-search');
        await picker.search('lofi');
        picker.querySelector('.nexus-bd-together-result').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(panel.__consent.request).not.toHaveBeenCalled();
        expect(panel.active).toBeFalsy();
        expect(panel.view).not.toBe('running');
    });
});
