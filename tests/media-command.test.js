/**
 * Show me choices, start it now, or that one (batch M4).
 *
 * Three transcripts, all real, all the same underlying mistake — one intent where there are
 * three.
 */

const Command = require('../src/features/together/MediaCommand.js');
const Session = require('../src/features/together/MediaSession.js');

const RESULTS = [
    { id: 'aaa', kind: 'music', title: 'Ervis Behari - Më Çmënde', creator: 'Ervis Behari Official' },
    { id: 'bbb', kind: 'music', title: 'ဤသို့ပြုရ', creator: 'Theink Pan Htun' },
    { id: 'ccc', kind: 'music', title: 'Antigoni - OUD', creator: 'Antigoni' },
    { id: 'ddd', kind: 'music', title: 'ADÉLA - Nicole Kidman', creator: 'ADÉLA' },
    { id: 'eee', kind: 'music', title: 'lofi hip hop radio', creator: 'Lofi Girl' },
];

beforeEach(() => {
    Session.reset();
    window.NEXUS_MEDIA_SESSION = Session;
});

describe('"play the fist song of the list"', () => {
    // The transcript:
    //   YOU    play the fist song of the list
    //   NEXUS  Here's what I found for “fist song of the list”.
    //          → five videos about first songs
    // The app was holding the list. It searched YouTube for the words instead.
    test('points at the first held result, not at a search', () => {
        Session.setResults(RESULTS);
        const picked = Command.resolve('play the fist song of the list');
        expect(picked).not.toBeNull();
        expect(picked.index).toBe(0);
        expect(picked.result.title).toMatch(/Ervis Behari/);
    });

    test('"fist" is accepted on purpose — it is what people type and what dictation makes', () => {
        Session.setResults(RESULTS);
        for (const said of ['play the first one', 'play the fist one', 'the firts one', 'play the 1st one']) {
            expect(Command.resolve(said)?.index).toBe(0);
        }
    });

    test.each([
        ['play the second one', 1],
        ['the third one please', 2],
        ['play number 4 from the list', 3],
        ['play the last one', 4],
        ['can you play the fifth one', 4],
    ])('%s → %i', (said, index) => {
        Session.setResults(RESULTS);
        expect(Command.resolve(said)?.index).toBe(index);
    });
});

describe('a pointer needs something to point at', () => {
    test('nothing held means no reference, so it falls through to a search', () => {
        // The honest answer. Inventing a selection out of an empty list would be worse than
        // searching.
        expect(Command.resolve('play the first one')).toBeNull();
    });

    test('past the end of the list is not the nearest thing', () => {
        Session.setResults(RESULTS.slice(0, 2));
        expect(Command.resolve('play the fifth one')).toBeNull();
    });

    test('"the first song by Queen" is not a pointer', () => {
        // "First" is doing a different job there: it describes what to search for, not which
        // of the things on screen to play.
        Session.setResults(RESULTS);
        expect(Command.resolve('play the first song by Queen')).toBeNull();
        expect(Command.resolve('play the first album Pink Floyd made')).toBeNull();
    });

    test('and an ordinary sentence is never a pointer', () => {
        Session.setResults(RESULTS);
        for (const said of ['play some jazz', 'what is the weather', 'I loved that first trip we took', '']) {
            expect(Command.resolve(said)).toBeNull();
        }
    });
});

describe('"play music please" is not "find music"', () => {
    // The transcript:
    //   YOU    play music please
    //   NEXUS  Here's what I found for “music”. Press play on one, or Watch in VR.
    //          → five unrelated videos, nothing playing
    test.each([
        ['play music please'],
        ['put on some relaxing music'],
        ['start a video about the ocean'],
        ['execute relaxation music'],
        ['reproduce a video about love'],
        ['can you play something calm'],
    ])('%s is an execute', (said) => {
        expect(Command.action(said)).toBe('execute');
    });

    test.each([
        ['find some meditation music'],
        ['search for lofi'],
        ['show me some relaxing videos'],
        ['look for jazz'],
        ['suggest me a music'],
        ['list some options'],
    ])('%s is a discover', (said) => {
        expect(Command.action(said)).toBe('discover');
    });

    test('and anything else belongs to the model', () => {
        // `null` is not a failure. No verb list will ever cover every phrasing, which is the
        // whole reason the `<play>` tag exists — this is only for the unmistakable cases,
        // where a round trip would add latency and nothing else.
        for (const said of ['I want to relax', 'what music do you like', 'tell me about jazz', '']) {
            expect(Command.action(said)).toBeNull();
        }
    });

    test('the two verb sets do not overlap, which is what makes the order safe', () => {
        // Checking DISCOVER first is defensive: both patterns are anchored and their verbs
        // are disjoint, so today the order cannot matter. It matters the moment somebody adds
        // "look" or "find" to EXECUTE — which would silently turn every search into a play.
        // Asserting the invariant is honest; asserting the order would test nothing.
        const discoverVerbs = [
            'find',
            'search',
            'search for',
            'look for',
            'show me',
            'list',
            'browse',
            'suggest',
            'recommend',
        ];
        const executeVerbs = ['play', 'put on', 'start', 'queue up', 'execute', 'reproduce', 'listen to'];
        for (const verb of discoverVerbs) {
            expect(Command.EXECUTE.test(`${verb} something`)).toBe(false);
        }
        for (const verb of executeVerbs) {
            expect(Command.DISCOVER.test(`${verb} something`)).toBe(false);
        }
    });

    test('a request that both finds and plays is a discover, deliberately', () => {
        // "find me something and play it" leads with find. Showing choices and then being
        // told "the first one" costs one turn; playing the wrong thing costs trust.
        expect(Command.action('find me something relaxing and play it')).toBe('discover');
    });
});

describe('the held list survives being drawn', () => {
    test('a search records what it showed', () => {
        Session.setResults(RESULTS);
        expect(Session.results()).toHaveLength(5);
        expect(Session.status()).toBe('results');
    });

    test('and a new search replaces it rather than appending', () => {
        Session.setResults(RESULTS);
        Session.setResults([RESULTS[0]]);
        expect(Session.results()).toHaveLength(1);
        expect(Command.resolve('play the second one')).toBeNull();
    });
});

describe('it never throws on the shapes real input takes', () => {
    test.each([[null], [undefined], [42], [{}], [[]]])('%s', (bad) => {
        expect(() => Command.resolve(bad)).not.toThrow();
        expect(() => Command.action(bad)).not.toThrow();
        expect(Command.resolve(bad)).toBeNull();
    });

    test('a session that throws is not a crash', () => {
        window.NEXUS_MEDIA_SESSION = {
            results: () => {
                throw new Error('broken');
            },
        };
        expect(Command.resolve('play the first one')).toBeNull();
    });

    test('no session at all is not a crash', () => {
        delete window.NEXUS_MEDIA_SESSION;
        expect(Command.resolve('play the first one')).toBeNull();
    });
});
