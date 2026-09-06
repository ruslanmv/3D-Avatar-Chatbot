/**
 * Doing what she just said she would (batch T8).
 *
 * Measured against the real gateway on 2026-09-06, `free-best` emitted a usable `<play>` tag
 * in 18 of 20 replies. This suite is about the other two, and specifically about the shape of
 * the one that matters:
 *
 *     YOU    I want watch a very romantic video
 *     NEXUS  Playing a romantic video for you. 💕
 *            → nothing plays
 *
 * That is worse than the apology T2 removed. "I can't do that" was true. This is the app
 * stating it did something it did not do, and the person waiting for a video that is never
 * coming.
 */

const Claim = require('../src/features/together/PlayClaim.js');
const Directive = require('../src/features/together/PlayDirective.js');
const FollowUp = require('../src/features/together/PlayFollowUp.js');
const Switch = require('../src/features/together/TogetherSwitch.js');

let played;
const INTENT = {
    fulfil: (req) => {
        played.push(req);
        return Promise.resolve({ ok: true });
    },
};

beforeEach(() => {
    played = [];
    localStorage.clear();
    Switch.reset();
    FollowUp.clear();
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_PLAY_FOLLOWUP = FollowUp;
    window.NEXUS_MEDIA_INTENT = INTENT;
    window.NEXUS_PLAY_CLAIM = Claim;
    Switch.enable('tile');
});

/**
 * The user asks for something; `PlayFollowUp` is what holds what they asked for.
 *
 * Asserts the topic actually landed. Without that, a fixture naming a genre rather than a
 * media noun ("play me some jazz") holds nothing, and every test below it passes because
 * there was never anything to play — not because the guard it names did its job.
 */
function asked(text) {
    FollowUp.note(text);
    expect(FollowUp.peek()).not.toBeNull();
}

describe('the transcript this batch exists for', () => {
    test('she says she is playing a romantic video, so a romantic video plays', async () => {
        asked('I want watch a very romantic video');

        const shown = Directive.consume('Playing a romantic video for you. 💕');

        expect(shown).toBe('Playing a romantic video for you. 💕');
        await Promise.resolve();
        expect(played).toHaveLength(1);
        expect(played[0].kind).toBe('video');
        expect(played[0].query).toMatch(/romantic/i);
        expect(played[0].source).toBe('claim');
    });

    test('and the query is what the user typed, not what she said', async () => {
        // She wrote "romantic video for you". Searching her prose would put "for you" in the
        // query. The request is the user's, and it is the only thing worth searching.
        asked('I want watch a very romantic video');
        Directive.consume('Putting on a romantic video, enjoy!');
        await Promise.resolve();
        expect(played[0].query).not.toMatch(/for you|enjoy/i);
    });
});

describe('what counts as a claim', () => {
    test.each([
        ['Playing a romantic video for you. 💕'],
        ["Here's a relaxing music track."],
        ['Putting on some ambient music now.'],
        ['Sure! Starting a video about the ocean.'],
        ["Okay, here's a song to help you relax."],
        ["Let's listen to something calm."],
    ])('claims: %s', (reply) => {
        expect(Claim.claims(reply)).toBe(true);
    });

    test.each([
        // A promise about later is not an action now.
        ['I can play music if you like.'],
        ["I'll put something on later if you want."],
        // A question is asking, however confident the rest reads.
        ["Here's a thought — what kind of music do you like?"],
        ['Would you like me to play a song?'],
        // Talking about media is not playing media.
        ['My favourite song is Bohemian Rhapsody.'],
        ['That video you mentioned sounds interesting.'],
        // The claim shape, with nothing playable in it.
        ["Here's what I found about the weather in Rome."],
        ['Playing devil’s advocate for a moment.'],
        // Explicit refusal must never be read as action.
        ["I'm not playing anything until you tell me the genre."],
        [''],
        [null],
    ])('does not claim: %s', (reply) => {
        expect(Claim.claims(reply)).toBe(false);
    });
});

describe('when it refuses to fire', () => {
    test('the user never asked for media', async () => {
        // The claim is permission to act on a request that exists, not a reason to invent one.
        // Without a held topic there is nothing honest to search for.
        Directive.consume("Here's a great song for this moment!");
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });

    test('Together is switched off', async () => {
        asked('play me some jazz music');
        // Guard the guard: this reply must be a claim, or the test would pass whatever the
        // switch does. An earlier version said "Here's some jazz" — a genre, not a media
        // noun — and so proved nothing.
        expect(Claim.claims("Here's a jazz track for you.")).toBe(true);

        Switch.disable('settings');
        Directive.consume("Here's a jazz track for you.");
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });

    test('a working directive already ran — never both', async () => {
        // T5 owns the tagged reply. If this competed, a claim *and* a tag would start two
        // things and the second would win after a flash of the first.
        asked('play me some jazz music');
        Directive.consume('Here\'s a jazz track. <play kind="music">smooth jazz</play>');
        await Promise.resolve();
        expect(played).toHaveLength(1);
        expect(played[0].source).toBe('model');
        expect(played[0].query).toBe('smooth jazz');
    });

    test('the reply made no claim at all', async () => {
        asked('play me some jazz music');
        Directive.consume('Jazz came out of New Orleans in the early twentieth century.');
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });

    test('nothing can fulfil it', () => {
        asked('play me some jazz music');
        delete window.NEXUS_MEDIA_INTENT;
        expect(() => Directive.consume("Here's a jazz track for you.")).not.toThrow();
    });

    test('and a backstop that throws does not take the reply down with it', () => {
        asked('play me some jazz music');
        window.NEXUS_MEDIA_INTENT = {
            fulfil: () => {
                throw new Error('search exploded');
            },
        };
        expect(Directive.consume("Here's a jazz track for you.")).toBe("Here's a jazz track for you.");
    });
});

describe('the bracket-less tag a real reply produced', () => {
    // The whole message was: play kind="video" tag="video"
    // Not executable — there is no query in it — but it must never be displayed, and before
    // this batch it was: the answer to "I want to watch a romantic video" was broken markup.
    test('is never shown', () => {
        expect(Directive.extract('play kind="video" tag="video"').clean).toBe('');
    });

    test('nor is it shown when prose surrounds it', () => {
        const { clean, directive } = Directive.extract('Here you go!\nplay kind="video" tag="video"');
        expect(clean).toBe('Here you go!');
        expect(directive).toBeNull();
    });

    test('and the claim in that prose is still honoured', async () => {
        asked('I want watch a very romantic video');
        const shown = Directive.consume('Here\'s a romantic video.\nplay kind="video" tag="video"');
        expect(shown).toBe("Here's a romantic video.");
        await Promise.resolve();
        expect(played).toHaveLength(1);
    });

    test('a real tag is still preferred over the mangled one', async () => {
        asked('play me some jazz music');
        Directive.consume('<play kind="music">smooth jazz</play>');
        await Promise.resolve();
        expect(played[0].query).toBe('smooth jazz');
    });
});

describe('it changes nothing for a reply that says nothing about media', () => {
    test('the ordinary conversation is byte-identical', async () => {
        asked('play me some jazz music');
        const reply = 'The capital of France is Paris. It has about two million people.';
        expect(Directive.consume(reply)).toBe(reply);
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });
});

describe('she does not know any URLs, so she must not write any', () => {
    // Observed against the real gateway:
    //   NEXUS  Here's another great one for you! 🎶 Playing "Ed Sheeran - Perfect" —
    //          https://www.youtube.com/watch?v=2Vv-BfVoq4g
    // Nothing played, and the link was written by the model. It has never searched YouTube;
    // it produced eleven plausible characters because that is what a video ID looks like.
    const Links = require('../src/features/together/InventedLinks.js');

    beforeEach(() => {
        window.NEXUS_INVENTED_LINKS = Links;
    });

    test('the transcript, cleaned', () => {
        // The title goes with the link, and that is the stronger, correct behaviour: she never
        // searched, so "Ed Sheeran - Perfect" is as invented as the eleven characters after
        // `v=`. An earlier version of this test kept the title, which would have left a
        // fabricated claim standing with only its evidence removed.
        const reply =
            'Here\'s another great one for you! 🎶 Playing "Ed Sheeran - Perfect" — https://www.youtube.com/watch?v=2Vv-BfVoq4g';
        const shown = Directive.consume(reply);
        expect(shown).not.toMatch(/youtube\.com|youtu\.be|2Vv-BfVoq4g/);
        expect(shown).not.toMatch(/Ed Sheeran/);
        expect(shown).toBe("Here's another great one for you! 🎶");
    });

    test('and the card she copied from the app is taken with it', () => {
        // Observed live. There is no Beatles track in the samples — the whole sentence is
        // invented, dressed in the app's own voice, which makes it the most convincing
        // fabrication the model can produce.
        const reply =
            "Playing some cool jazz for you! 🎶 Search isn't set up here yet, so here's a sample instead — “The Beatles — Here Comes the Sun”";
        const shown = Directive.consume(reply);
        expect(shown).not.toMatch(/Beatles|Here Comes the Sun/);
    });

    test('a real card is a separate message, so this never touches one', () => {
        // The guard only ever runs on assistant replies. What `ConversationPublisher` posts is
        // its own message and never passes through here.
        const Links = require('../src/features/together/InventedLinks.js');
        expect(Links.strip('Talking about the Beatles is always fun.').removed).toBe(0);
        expect(Links.strip('I love that song, it always cheers me up.').removed).toBe(0);
    });

    test.each([
        ['https://www.youtube.com/watch?v=2Vv-BfVoq4g'],
        ['http://youtube.com/watch?v=abcdefghijk'],
        ['https://youtu.be/fJ9rUzIMcZQ'],
        ['https://m.youtube.com/watch?v=XarKqjNoE7A'],
        ['www.youtube.com/watch?v=dQw4w9WgXcQ'],
        ['https://open.spotify.com/track/1234'],
        ['https://soundcloud.com/artist/track'],
    ])('strips %s', (url) => {
        expect(Links.strip(`Listen to this ${url} now`).text).not.toMatch(/youtube|youtu\.be|spotify|soundcloud/i);
        expect(Links.strip(`Listen to this ${url} now`).removed).toBe(1);
    });

    test('and leaves the rest of the web alone', () => {
        // This is about media platforms she is expected to search and cannot — not the web.
        const reply = 'The docs are at https://example.com/guide and the spec at https://w3.org/TR/css';
        expect(Directive.consume(reply)).toBe(reply);
        expect(Links.strip(reply).removed).toBe(0);
    });

    test('an ordinary reply is untouched', () => {
        const reply = 'Jazz came out of New Orleans in the early twentieth century.';
        expect(Links.strip(reply)).toEqual({ text: reply, removed: 0 });
    });

    test('the real card is still what carries a link', async () => {
        // Stripping the model's guess must not touch the app's own published result, which
        // comes from a real search and is a separate message.
        asked('play me some jazz music');
        Directive.consume('Here\'s a jazz track. <play kind="music">smooth jazz</play>');
        await Promise.resolve();
        expect(played).toHaveLength(1);
        expect(played[0].query).toBe('smooth jazz');
    });

    test('a reply that was nothing but an invented link does not crash', () => {
        expect(Directive.consume('https://www.youtube.com/watch?v=2Vv-BfVoq4g')).toBe('');
    });
});

describe('a promise about now, and a promise about later', () => {
    test('"I\'ll put on some calming music" is the action', async () => {
        // The reply that made `I'll` admissible: in a chat where the app can play, this is
        // her doing it, not a plan to do it.
        asked('I want to relax play music');
        Directive.consume("I'll put on some calming music for you.");
        await Promise.resolve();
        expect(played).toHaveLength(1);
    });

    test('but "later" is genuinely later', async () => {
        asked('I want to relax play music');
        Directive.consume("I'll put some music on later if you'd like.");
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });

    test.each([
        ["I'll play a video for you when you're ready."],
        ['I can put a song on in a moment.'],
        ["Let's watch something tomorrow."],
    ])('nor does %s', async (reply) => {
        asked('I want to relax play music');
        Directive.consume(reply);
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });
});

describe('verbs found by running the real model, not by thinking harder', () => {
    // Each of these came from an actual reply against the gateway. The list is an enumeration
    // and enumerations are never complete — which is exactly why the tag exists and this is
    // only a net under it.
    test.each([
        ['Pulling up a sweet, romantic video for you.'],
        ['Throwing on some ambient music now.'],
        ['Firing up a video about the ocean.'],
        ['Getting a relaxing track for you.'],
        ['Loading up a calming playlist.'],
    ])('%s is a claim', (reply) => {
        expect(Claim.claims(reply)).toBe(true);
    });

    test('and a question in that shape still is not', () => {
        // "How about some soothing acoustic guitar?" is proposing, not acting. The prompt now
        // tells her not to propose; if she does anyway, nothing starts behind her back.
        expect(Claim.claims('How about some soothing acoustic guitar to help you unwind? 🎶')).toBe(false);
    });
});

describe('when she says nothing at all', () => {
    // Observed live: `free-best` is a reasoning model and sometimes spends its whole token
    // budget thinking, returning empty content. The app rendered an empty bubble and nothing
    // played — from the user's side, their request simply vanished.
    test('an empty reply after a media request still plays what they asked for', async () => {
        asked('suggest me a music');
        Directive.consume('');
        await Promise.resolve();
        expect(played).toHaveLength(1);
        expect(played[0].source).toBe('claim');
    });

    test('whitespace counts as nothing', async () => {
        asked('suggest me a music');
        Directive.consume('   \n\t ');
        await Promise.resolve();
        expect(played).toHaveLength(1);
    });

    test('but silence is still not a claim', () => {
        // Kept honest: nothing was claimed, so `claims` says so. Silence gets its own door
        // into the backstop rather than being smuggled through the claim test.
        expect(Claim.claims('')).toBe(false);
        expect(Claim.silent('')).toBe(true);
    });

    test('and an empty reply with no request behind it plays nothing', async () => {
        FollowUp.clear();
        Directive.consume('');
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });

    test('nor when Together is off', async () => {
        asked('suggest me a music');
        Switch.disable('settings');
        Directive.consume('');
        await Promise.resolve();
        expect(played).toHaveLength(0);
    });
});
