/**
 * Finding is not playing (batch M6).
 *
 *     YOU    search music about dance
 *     NEXUS  Playing “70s & 80s Party Classics!…”
 *
 * They asked to look. The app chose for them and started it — which is not a smaller version
 * of what was asked for, it is the opposite, and it cannot be walked back by saying "no, the
 * other one", because something is already making noise.
 */

window.__NEXUS_YT_ASK_NOAUTO__ = true;
const Ask = require('../src/features/youtube/YouTubeAsk.js');
const Command = require('../src/features/together/MediaCommand.js');
const Directive = require('../src/features/together/PlayDirective.js');
const Capability = require('../src/features/together/TogetherCapability.js');
const Switch = require('../src/features/together/TogetherSwitch.js');
const Provider = require('../src/features/discovery/providers/youtube.js');

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_DISCOVERY = {
        forCapability: () => ({ search: async () => [] }),
        why: () => 'ok',
        warm: async () => [],
    };
    Switch.enable('tile');
});

describe('the phrasings that used to miss the pattern entirely', () => {
    // Each of these matched nothing, so it fell through to the model — which had only ever
    // been told "choose something and play it", and did.
    test.each([
        ['search music about dance', 'music about dance'],
        ['show me dance videos', 'dance videos'],
        ['list me the top 3 dance songs', 'dance songs'],
        ['can you list top 3 dance songs', 'dance songs'],
        ['search for dance music', 'dance music'],
        ['suggest some relaxing music', 'relaxing music'],
    ])('%s → searches for %s', (said, query) => {
        expect(Ask.parseIntent(said)?.query).toBe(query);
    });

    test('and every one of them is a discover, not an execute', () => {
        for (const said of [
            'search music about dance',
            'show me dance videos',
            'list me the top 3 dance songs',
            'find some jazz',
        ]) {
            expect(Command.action(said)).toBe('discover');
        }
    });

    test('while the play verbs still execute', () => {
        for (const said of ['play music about dance', 'put on some jazz', 'reproduce a video about love']) {
            expect(Command.action(said)).toBe('execute');
        }
    });
});

describe('"the top 3" says how many, not what', () => {
    test('the count is read out of the sentence', () => {
        expect(Ask.parseIntent('list me the top 3 dance songs')?.count).toBe(3);
        expect(Ask.parseIntent('show me the top 5 relaxing videos')?.count).toBe(5);
    });

    test('and taken out of the query', () => {
        // Leaving it in searches YouTube for the words "top 3", which is how a request for
        // three songs comes back as compilations called "Top 3".
        expect(Ask.parseIntent('list me the top 3 dance songs')?.query).not.toMatch(/top|3/);
    });

    test('an ordinary request has no count', () => {
        expect(Ask.parseIntent('find some dance music')?.count).toBe(0);
    });

    test('and an absurd count is capped rather than obeyed', () => {
        expect(Ask.parseIntent('list the top 99 songs')?.count).toBeLessThanOrEqual(8);
    });
});

describe('the connector that leaked when the verbs were widened', () => {
    test('"search for X" searches for X, not for "for X"', () => {
        // `search` began matching before `search for`, so the connector became part of the
        // query and YouTube was asked for "for dance music".
        expect(Ask.parseIntent('search for dance music')?.query).toBe('dance music');
        expect(Ask.parseIntent('look for jazz music')?.query).toBe('jazz music');
    });
});

describe('the model gets a way to ask for a list', () => {
    test('the prompt tells her finding is not playing', () => {
        const suffix = Capability.systemPromptSuffix();
        expect(suffix).toMatch(/<find kind="music">/);
        expect(suffix).toMatch(/do not play anything/i);
    });

    test('and not to name titles she has not searched for', () => {
        expect(Capability.systemPromptSuffix()).toMatch(/do not name any titles yourself/i);
    });

    test('a <find> is parsed, stripped, and starts nothing', () => {
        const listed = [];
        const shown = Directive.consume('Let me look for those.\n<find kind="music">dance music</find>', {
            intent: {
                list: (r) => {
                    listed.push(r);
                    return Promise.resolve({ ok: true });
                },
                fulfil: () => {
                    throw new Error('find must never play');
                },
            },
        });
        expect(shown).toBe('Let me look for those.');
        expect(listed).toEqual([{ query: 'dance music', kind: 'music', source: 'model' }]);
    });

    test('a <play> still plays', () => {
        const played = [];
        Directive.consume('Here you go.\n<play kind="music">jazz</play>', {
            intent: { fulfil: (r) => (played.push(r), Promise.resolve({ ok: true })), list: () => {} },
        });
        expect(played).toHaveLength(1);
    });

    test('a reply carrying both shows rather than plays', () => {
        // The less destructive of the two: a list can be followed by "play the first one",
        // and something playing cannot be un-played.
        const calls = [];
        Directive.consume('<find kind="music">jazz</find><play kind="music">jazz</play>', {
            intent: {
                list: () => (calls.push('list'), Promise.resolve()),
                fulfil: () => (calls.push('play'), Promise.resolve()),
            },
        });
        expect(calls).toEqual(['list']);
    });
});

describe('titles arrive readable', () => {
    test('the API escapes them, and the app renders text', () => {
        // `Drake - One Dance ft. Wizkid &amp; Kyla` was reaching the screen with the entity
        // intact, because titles are set as textContent — correctly, since a title is
        // untrusted uploader text and must never be parsed as markup.
        expect(Provider.unescapeText('Drake - One Dance ft. Wizkid &amp; Kyla')).toBe(
            'Drake - One Dance ft. Wizkid & Kyla'
        );
        expect(Provider.unescapeText('Rock &quot;n&quot; Roll &#39;99')).toBe('Rock "n" Roll \'99');
    });

    test('and a normalized result carries the readable title, not just the helper', () => {
        // The helper alone passing proved nothing: a mutation that stopped `normalize` calling
        // it survived the whole suite, because every assertion here went straight to the
        // helper. The result the app actually renders is what has to be checked.
        const out = Provider.normalize(
            {
                id: 'abcdefghijk',
                name: 'Drake - One Dance ft. Wizkid &amp; Kyla',
                author: 'Drake &amp; friends',
                description: 'A &quot;dance&quot; track',
            },
            'music'
        );
        expect(out.title).toBe('Drake - One Dance ft. Wizkid & Kyla');
        expect(out.creator).toBe('Drake & friends');
        expect(out.description).toBe('A "dance" track');
    });

    test('and nothing else is decoded', () => {
        // Only the five the API escapes. Decoding more would mean interpreting uploader text,
        // which is the thing being avoided.
        expect(Provider.unescapeText('100&percnt; &copy; &#x41;')).toBe('100&percnt; &copy; &#x41;');
    });

    test('it never throws on what a missing field looks like', () => {
        for (const bad of [null, undefined, 42, {}]) {
            expect(() => Provider.unescapeText(bad)).not.toThrow();
        }
        expect(Provider.unescapeText(null)).toBe('');
    });
});
