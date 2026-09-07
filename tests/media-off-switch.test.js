/**
 * Works on the PC, does nothing on the phone (batch M9).
 *
 * Same URL, same deployment, same API key — verified live: the production route answers
 * `{"configured":true}` and returns real results. It was neither the key nor the code.
 *
 * The Together switch lives in `localStorage`, so it is **per browser**. A tile had been
 * tapped on the desktop and never on the phone, and on the phone every media request returned
 * `{ ok: false, why: 'off' }` — and said nothing at all. The person typed a sentence and the
 * app did nothing, which is the worst available answer: nothing to act on, and no reason to
 * think anything is wrong rather than slow.
 */

const Intent = require('../src/features/together/MediaIntent.js');
const Switch = require('../src/features/together/TogetherSwitch.js');
const Session = require('../src/features/together/MediaSession.js');

const RESULT = { id: 'abc', kind: 'music', title: 'A track', creator: 'Someone', url: 'https://y/abc' };

let published;

beforeEach(() => {
    published = [];
    localStorage.clear();
    Switch.reset();
    Session.reset();
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_MEDIA_SESSION = Session;
    window.NEXUS_CONVERSATION_PUBLISHER = { publish: (r, o) => (published.push({ r, o }), {}) };
    window.NEXUS_MEDIA_RESULT_LIST = { publish: () => ({}) };
    window.NEXUS_DISCOVERY = {
        warm: async () => [],
        forCapability: () => ({ search: async () => [RESULT] }),
        why: () => 'ok',
    };
});

describe('a fresh browser, where nobody has tapped a tile', () => {
    test('the switch starts untouched, which is not the same as off', () => {
        expect(Switch.state()).toBeNull();
        expect(Switch.isOn()).toBe(false);
    });

    test('typing "play music" turns it on and plays, because that IS the request', async () => {
        // T1 said tapping a tile turns Together on, since tapping the tile is the request.
        // Typing it in words is the same request and deserves the same answer.
        const out = await Intent.fulfil({ query: 'relaxing music', kind: 'music', source: 'pattern' });
        expect(out.ok).toBe(true);
        expect(Switch.isOn()).toBe(true);
        expect(published).toHaveLength(1);
    });

    test('and asking to search turns it on too', async () => {
        const out = await Intent.list({ query: 'dance music', kind: 'music', source: 'pattern' });
        expect(out.ok).toBe(true);
        expect(Switch.isOn()).toBe(true);
    });

    test('picking from a list, or "the first one", counts as asking as well', async () => {
        for (const source of ['reference', 'list']) {
            Switch.reset();
            localStorage.clear();
            expect(Intent.allowedToRun(source)).toBe(true);
            expect(Switch.isOn()).toBe(true);
        }
    });
});

describe('but a deliberate off is a decision, and it stands', () => {
    test('a request does not switch it back on', async () => {
        // `null` is "never touched" and `'off'` is a choice. Only the first is consent.
        Switch.enable('tile');
        Switch.disable('settings');

        const out = await Intent.fulfil({ query: 'relaxing music', kind: 'music', source: 'pattern' });

        expect(out).toEqual({ ok: false, why: 'together-off' });
        expect(Switch.isOn()).toBe(false);
        expect(published).toHaveLength(0);
    });

    test('nor does a search request', async () => {
        Switch.enable('tile');
        Switch.disable('settings');
        expect((await Intent.list({ query: 'x', kind: 'music', source: 'pattern' })).why).toBe('together-off');
    });
});

describe('the model can never switch it on', () => {
    test('a leftover directive from an earlier turn does nothing', async () => {
        // The capability paragraph only exists while Together is on, so a model request can
        // only arrive with it off as a stale reply — and honouring that would let an old
        // message turn a feature on behind the user.
        const out = await Intent.fulfil({ query: 'relaxing music', kind: 'music', source: 'model' });
        expect(out).toEqual({ ok: false, why: 'together-off' });
        expect(Switch.isOn()).toBe(false);
    });

    test('and neither can a claim backstop', async () => {
        expect(Intent.allowedToRun('claim')).toBe(false);
        expect(Switch.isOn()).toBe(false);
    });
});

describe('nothing fails in silence any more', () => {
    window.__NEXUS_YT_ASK_NOAUTO__ = true;
    const Ask = require('../src/features/youtube/YouTubeAsk.js');

    test('every reason the app can return has a sentence', () => {
        // Silence is the worst answer: nothing to act on, and no reason to believe anything
        // is wrong rather than slow.
        // Keyed off the module's own table rather than a list retyped here, so a new reason
        // cannot be added without a sentence to go with it. An earlier version guessed the
        // codes ('off' instead of 'together-off') and passed while matching nothing.
        for (const why of Object.values(window.NEXUS_MEDIA_INTENT.WHY)) {
            expect(Ask.WHY_COPY[why]).toBeTruthy();
        }
    });

    test('an off switch says so, and says where to change it', () => {
        expect(Ask.WHY_COPY['together-off']).toMatch(/switched off/i);
        expect(Ask.WHY_COPY['together-off']).toMatch(/settings/i);
    });

    test('a failed request is spoken, not swallowed', async () => {
        document.body.innerHTML = '<div id="chat-history"></div>';
        delete window.chatHistory;
        await Ask.announce(Promise.resolve({ ok: false, why: 'nothing-found' }), document);
        expect(document.body.textContent).toMatch(/couldn't find anything/i);
    });

    test('and so is one that throws', async () => {
        document.body.innerHTML = '<div id="chat-history"></div>';
        await Ask.announce(Promise.reject(new Error('boom')), document);
        expect(document.body.textContent).toMatch(/couldn't reach the search/i);
    });

    test('a request that worked says nothing extra', async () => {
        document.body.innerHTML = '<div id="chat-history"></div>';
        await Ask.announce(Promise.resolve({ ok: true }), document);
        expect(document.body.textContent.trim()).toBe('');
    });
});
