/**
 * The card stops claiming playback it never started (batch M1/M3).
 *
 * `ConversationPublisher` said "Playing “…”" on every path, including the one that publishes a
 * thumbnail and stops. So the app told people they were watching something that had not
 * started — and then, asked to play it, correctly said it could not, because nothing had.
 */

const Publisher = require('../src/features/together/ui/ConversationPublisher.js');
const Context = require('../src/features/together/CurrentMediaContext.js');
const Session = require('../src/features/together/MediaSession.js');
const Picker = require('../src/features/together/ui/MediaSearchPicker.js');

const RESULT = {
    id: '1ZYbU82GVz4',
    provider: 'youtube',
    kind: 'video',
    title: 'Flying: Relaxing Sleep Music',
    creator: 'Soothing Relaxation',
    url: 'https://www.youtube.com/watch?v=1ZYbU82GVz4',
};

beforeEach(() => {
    Session.reset();
    window.NEXUS_MEDIA_SESSION = Session;
    Context.clear();
});

describe('what the card says', () => {
    test('choosing says found, not playing', () => {
        expect(Publisher.line(RESULT)).toMatch(/I found/);
        expect(Publisher.line(RESULT)).not.toMatch(/^Playing/);
    });

    test('and tells the user how to start it', () => {
        // The sentence has to carry the next step, or "I found it" is just a shrug.
        expect(Publisher.line(RESULT)).toMatch(/tap it to play/i);
    });

    test('▶ Play says playing, because it started it', () => {
        expect(Publisher.line(RESULT, { play: true })).toMatch(/^Playing/);
    });

    test('a sample is still announced as a sample either way', () => {
        const sample = { ...RESULT, sample: true };
        expect(Publisher.line(sample)).toMatch(/sample/i);
        expect(Publisher.line(sample, { play: true })).toMatch(/sample/i);
    });

    test('a result with no title still reads as a sentence', () => {
        expect(Publisher.line({ id: 'x' })).toMatch(/I found something/);
        expect(Publisher.line({ id: 'x' }, { play: true })).toMatch(/Here you go/);
    });
});

describe('what she is told about it', () => {
    test('selected: she says plainly that it is not playing', () => {
        Context.set(RESULT);
        Session.select(RESULT);
        const suffix = Context.systemPromptSuffix();
        expect(suffix).toMatch(/NOT playing/);
        expect(suffix).toMatch(/tap the card/i);
    });

    test('playing: she can say it is playing, because it is', () => {
        Context.set(RESULT);
        Session.requestPlay(RESULT);
        Session.markPlaying();
        expect(Context.systemPromptSuffix()).toMatch(/playing right now/);
    });

    test('paused and ended are their own facts', () => {
        Context.set(RESULT);
        Session.requestPlay(RESULT);
        Session.markPaused();
        expect(Context.systemPromptSuffix()).toMatch(/paused/i);
        Session.markEnded();
        expect(Context.systemPromptSuffix()).toMatch(/finished/i);
    });

    test('blocked tells her to say tap, not that something broke', () => {
        Context.set(RESULT);
        Session.requestPlay(RESULT);
        Session.markBlocked();
        const suffix = Context.systemPromptSuffix();
        expect(suffix).toMatch(/NOT playing/);
        expect(suffix).toMatch(/tap the card/i);
        expect(suffix).not.toMatch(/error|wrong|failed/i);
    });

    test('she is never told she watched it, in any state', () => {
        // The one thing that must survive every rewording here: metadata is not perception.
        for (const step of ['select', 'markPlaying', 'markPaused', 'markEnded', 'markBlocked']) {
            Context.set(RESULT);
            Session.requestPlay(RESULT);
            Session[step](RESULT);
            expect(Context.systemPromptSuffix()).toMatch(/did not watch or listen/i);
        }
    });

    test('a session about a different video does not describe this one', () => {
        // Two facts that must not be crossed: what the prompt is about, and what the player
        // is doing. A stale session would otherwise report the wrong one as playing.
        Context.set(RESULT);
        Session.requestPlay({ id: 'somethingelse', kind: 'video', title: 'Other' });
        Session.markPlaying();
        expect(Context.systemPromptSuffix()).not.toMatch(/playing right now/);
    });

    test('and with no session loaded the prompt is what it always was', () => {
        delete window.NEXUS_MEDIA_SESSION;
        Context.set(RESULT);
        expect(Context.systemPromptSuffix()).toMatch(/is watching something right now/);
    });

    test('nothing playing still means an empty suffix', () => {
        expect(Context.systemPromptSuffix()).toBe('');
    });
});

describe('the ▶ button in Together', () => {
    // Driven through the registry, which is how the panel drives it — an injected `search`
    // would have tested a path the app never takes.
    const MediaResult = require('../src/features/discovery/MediaResult.js');
    let Registry;

    const provider = {
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
                    id: '1ZYbU82GVz4',
                    provider: 'fake',
                    url: 'https://www.youtube.com/watch?v=1ZYbU82GVz4',
                    title: 'Flying: Relaxing Sleep Music',
                    creator: 'Soothing Relaxation',
                },
                {
                    id: 'second',
                    provider: 'fake',
                    url: 'https://www.youtube.com/watch?v=second',
                    title: 'Second',
                    creator: 'Someone',
                },
            ]),
    };

    beforeEach(() => {
        jest.resetModules();
        Registry = require('../src/features/discovery/ProviderRegistry.js');
        Registry.reset();
        Registry.register(provider);
        window.NEXUS_DISCOVERY = Registry;
    });

    function mount(extra = {}) {
        const node = Picker.build(Object.assign({ doc: document, mediaKind: 'video', onChoose: () => {} }, extra));
        document.body.appendChild(node);
        return node;
    }

    test('is drawn beside each row', async () => {
        const root = mount({ onPlay: () => {} });
        await root.search('relaxing');
        expect(root.querySelectorAll('.nexus-bd-together-play')).toHaveLength(2);
    });

    test('and is not drawn at all when nothing can act on it', async () => {
        // A control that cannot do anything is worse than no control.
        const root = mount();
        await root.search('relaxing');
        expect(root.querySelectorAll('.nexus-bd-together-play')).toHaveLength(0);
        expect(root.querySelectorAll('.nexus-bd-together-result')).toHaveLength(2);
    });

    test('play and choose are different requests', async () => {
        // Both firing would publish two cards for one tap.
        const chosen = [];
        const played = [];
        const root = mount({ onChoose: (r) => chosen.push(r), onPlay: (r) => played.push(r) });
        await root.search('relaxing');

        root.querySelector('.nexus-bd-together-play').click();

        expect(played).toHaveLength(1);
        expect(chosen).toHaveLength(0);
        expect(played[0].id).toBe('1ZYbU82GVz4');
    });

    test('the row still chooses, exactly as it did', async () => {
        const chosen = [];
        const root = mount({ onChoose: (r) => chosen.push(r), onPlay: () => {} });
        await root.search('relaxing');
        root.querySelector('.nexus-bd-together-result').click();
        expect(chosen).toHaveLength(1);
    });

    test('the button names what it will play, for a screen reader', async () => {
        const root = mount({ onPlay: () => {} });
        await root.search('relaxing');
        const label = root.querySelector('.nexus-bd-together-play').getAttribute('aria-label');
        expect(label).toMatch(/Flying/);
        expect(label).toMatch(/Soothing Relaxation/);
    });

    test('a button inside a button would be invalid, so it is a sibling', async () => {
        // Browsers resolve nested buttons by dropping one of them, silently.
        const root = mount({ onPlay: () => {} });
        await root.search('relaxing');
        const play = root.querySelector('.nexus-bd-together-play');
        expect(play.closest('.nexus-bd-together-result')).toBeNull();
        expect(play.parentElement.querySelector('.nexus-bd-together-result')).not.toBeNull();
    });
});
