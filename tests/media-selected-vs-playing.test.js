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
    });

    test('for a track as well as a video — both branches, or the mutation hides in one', () => {
        // A mutation that reworded only the music branch survived the whole suite, because
        // every test here used a video. Two sentences means two tests.
        const TRACK = { ...RESULT, id: 'fJ9rUzIMcZQ', kind: 'music', title: 'Bohemian Rhapsody' };
        Context.set(TRACK);
        Session.select(TRACK);
        const suffix = Context.systemPromptSuffix();
        expect(suffix).toMatch(/NOT playing/);
        expect(suffix).toMatch(/play it, using the tag/i);
        expect(suffix).not.toMatch(/tap the card/i);
        // And it is described as listening, not watching.
        expect(suffix).toMatch(/speakers/i);
    });

    test('and is told to play it rather than to send the user tapping', () => {
        // M4 fixed a contradiction: `TogetherCapability` tells her to choose something and
        // play it, while this line used to say "tell them to tap the card". Handed both, the
        // model followed the second — which is why "play it please" got "tap it to play" from
        // an app that had just been told it could play things.
        Context.set(RESULT);
        Session.select(RESULT);
        const suffix = Context.systemPromptSuffix();
        expect(suffix).toMatch(/play it, using the tag/i);
        expect(suffix).not.toMatch(/tap the card/i);
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
        // The one state where "tap" is honest, and so the only one that says it.
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

    test('one action per row: tapping it plays', async () => {
        // M3 gave a row two meanings — the row chose, a separate ▶ played. That is one
        // control too many: "choose this music but do not start it" is not a thing anybody
        // wants inside a panel called Watch, and it made every result carry two competing
        // actions with no way to tell which was the ordinary one.
        const activated = [];
        const root = mount({ onChoose: (r) => activated.push(r) });
        await root.search('relaxing');

        expect(root.querySelectorAll('.nexus-bd-together-result')).toHaveLength(2);
        expect(root.querySelectorAll('.nexus-bd-together-play')).toHaveLength(0);

        root.querySelector('.nexus-bd-together-result').click();
        expect(activated).toHaveLength(1);
        expect(activated[0].id).toBe('1ZYbU82GVz4');
    });

    test('the ▶ is a cue inside the row, not a rival control', async () => {
        const root = mount();
        await root.search('relaxing');
        const cue = root.querySelector('.nexus-bd-together-playcue');
        expect(cue).not.toBeNull();
        // Inside the row, so one tap anywhere on it does the one thing.
        expect(cue.closest('.nexus-bd-together-result')).not.toBeNull();
        // And silent to a screen reader: the row's own label already names what will play.
        expect(cue.getAttribute('aria-hidden')).toBe('true');
    });

    test('the row still names what it will play', async () => {
        const root = mount();
        await root.search('relaxing');
        const label = root.querySelector('.nexus-bd-together-result').getAttribute('aria-label');
        expect(label).toMatch(/Flying/);
        expect(label).toMatch(/Soothing Relaxation/);
    });

    test('one tap is one request, never two', async () => {
        // Two handlers firing would publish two cards for one finger.
        const activated = [];
        const root = mount({ onChoose: (r) => activated.push(r) });
        await root.search('relaxing');
        root.querySelector('.nexus-bd-together-playcue').click();
        expect(activated).toHaveLength(1);
    });
});

describe('not hearing the player is not proof it did not start', () => {
    // The transcript this exists for:
    //
    //     YOU    play a song about relaxation
    //     NEXUS  Playing “Relaxing music Relieves stress…”
    //     YOU    I like this song thank you
    //     NEXUS  ...it looks like the playback hasn't started yet. Please tap the card!
    //
    // It was playing. The IFrame API had not attached, so no PLAYING event arrived, and the
    // app treated silence as a refusal.
    test('silence is its own state, not blocked', () => {
        Session.requestPlay(RESULT);
        Session.markUnconfirmed();
        expect(Session.status()).toBe('unconfirmed');
    });

    test('and she is told not to claim it has not started', () => {
        Context.set(RESULT);
        Session.requestPlay(RESULT);
        Session.markUnconfirmed();
        const suffix = Context.systemPromptSuffix();
        expect(suffix).toMatch(/cannot tell whether it is playing/i);
        expect(suffix).toMatch(/most likely playing/i);
        // The word "tap" does appear — inside a prohibition. What must not appear is the
        // *instruction*, which is the sentence `blocked` carries.
        expect(suffix).toMatch(/do NOT tell them to tap/i);
        expect(suffix).not.toMatch(/tap the card to start it/i);
        expect(suffix).not.toMatch(/It is NOT playing/);
    });

    test('a real PLAYING afterwards still wins', () => {
        // Unconfirmed is provisional. Evidence, when it arrives, replaces a guess.
        Session.requestPlay(RESULT);
        Session.markUnconfirmed();
        Session.markPlaying();
        expect(Session.status()).toBe('playing');
    });

    test('and it never overwrites a state that was actually observed', () => {
        // The backstop fires on a timer. By then the player may have reported anything, and
        // a timer must not talk over evidence.
        for (const observed of ['markPlaying', 'markPaused', 'markEnded', 'markBlocked']) {
            Session.reset();
            Session.requestPlay(RESULT);
            Session[observed]();
            const before = Session.status();
            Session.markUnconfirmed();
            expect(Session.status()).toBe(before);
        }
    });

    test('blocked still says tap, because there it is true', () => {
        Context.set(RESULT);
        Session.requestPlay(RESULT);
        Session.markBlocked();
        expect(Context.systemPromptSuffix()).toMatch(/tap the card/i);
    });
});
