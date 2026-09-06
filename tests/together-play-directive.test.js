/**
 * Finding it and playing it, from one function and one tag (batches T3, T5).
 *
 * The transcript that started this ended "I don't have the ability to directly play music."
 * T2 told her she has. These two are what make that true: `MediaIntent.fulfil` is the single
 * path from a request to something playing, and `PlayDirective` is how she asks for it without
 * the asking ever reaching the screen or the speaker.
 */

const Intent = require('../src/features/together/MediaIntent.js');
const Directive = require('../src/features/together/PlayDirective.js');
const Switch = require('../src/features/together/TogetherSwitch.js');

const RESULT = {
    id: 'aaaaaaaaaaa',
    title: 'Rain sounds',
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    kind: 'music',
};

function wire({ results = [RESULT], throws = false, provider = true, published = {} } = {}) {
    const seen = { searched: null, published: null, opts: null };
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_DISCOVERY = {
        warm: async () => [],
        forCapability: () =>
            provider
                ? {
                      search: async (q, o) => {
                          seen.searched = { q, o };
                          if (throws) throw new Error('upstream');
                          return results;
                      },
                  }
                : null,
    };
    window.NEXUS_CONVERSATION_PUBLISHER = {
        publish: (r, o) => {
            seen.published = r;
            seen.opts = o;
            return published;
        },
    };
    return seen;
}

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    Switch.enable('tile');
    delete window.NEXUS_DISCOVERY_SAMPLES;
});

describe('one function finds and plays', () => {
    test('a request ends with something in the chat', async () => {
        const seen = wire();
        const out = await Intent.fulfil({ query: 'rain sounds', kind: 'music', source: 'model' });
        expect(out.ok).toBe(true);
        expect(seen.searched.q).toBe('rain sounds');
        expect(seen.published).toBe(RESULT);
    });

    test('it takes the first result, not a list to choose from', async () => {
        // Somebody who said "play something relaxing" asked for one thing to start. Handing
        // them four and a decision is the detour this batch exists to remove.
        wire({ results: [RESULT, { ...RESULT, id: 'bbbbbbbbbbb' }] });
        const out = await Intent.fulfil({ query: 'x', kind: 'music' });
        expect(out.result.id).toBe(RESULT.id);
    });

    test('music and video ask for different things', async () => {
        const seen = wire();
        await Intent.fulfil({ query: 'x', kind: 'music' });
        expect(seen.searched.o.kind).toBe('music');
        await Intent.fulfil({ query: 'x', kind: 'video' });
        expect(seen.searched.o.kind).toBe('video');
    });

    test('an unknown kind is a video, not a crash', async () => {
        wire();
        expect((await Intent.fulfil({ query: 'x', kind: 'interpretive-dance' })).kind).toBe('video');
    });

    test('nothing plays while Together is off', async () => {
        // A directive left over in a reply, or a pattern firing after the switch went off.
        const seen = wire();
        Switch.disable('settings');
        const out = await Intent.fulfil({ query: 'rain', kind: 'music' });
        expect(out).toEqual({ ok: false, why: Intent.WHY.OFF });
        expect(seen.published).toBeNull();
    });

    test('an empty query is refused rather than searched for', async () => {
        // A search for nothing returns the most popular video on the internet and plays it at
        // somebody who was mid-sentence.
        const seen = wire();
        expect((await Intent.fulfil({ query: '   ', kind: 'music' })).why).toBe(Intent.WHY.EMPTY);
        expect(seen.searched).toBeNull();
    });

    test('nothing found and could not search are different answers', async () => {
        wire({ results: [] });
        expect((await Intent.fulfil({ query: 'x' })).why).toBe(Intent.WHY.NOTHING);
        wire({ throws: true });
        expect((await Intent.fulfil({ query: 'x' })).why).toBe(Intent.WHY.FAILED);
    });

    test('with no provider at all it falls back to the keyless samples', async () => {
        // "She can play something" has to stay true on a deployment with no API key.
        const seen = wire({ provider: false });
        window.NEXUS_DISCOVERY_SAMPLES = require('../src/features/discovery/samples.js');
        const out = await Intent.fulfil({ query: 'anything', kind: 'music' });
        expect(out.ok).toBe(true);
        expect(seen.published.id).toBe('fJ9rUzIMcZQ');
    });

    test('and without even those it says so instead of throwing', async () => {
        wire({ provider: false });
        expect((await Intent.fulfil({ query: 'x' })).why).toBe(Intent.WHY.FAILED);
    });

    test('a publisher that is missing is reported, not swallowed', async () => {
        wire();
        delete window.NEXUS_CONVERSATION_PUBLISHER;
        const out = await Intent.fulfil({ query: 'x' });
        expect(out.why).toBe(Intent.WHY.NO_CHAT);
        expect(out.result).toBe(RESULT);
    });

    test('who asked is recorded, so an unexpected autoplay can be traced', async () => {
        const seen = wire();
        await Intent.fulfil({ query: 'x', source: 'model' });
        expect(seen.opts.source).toBe('model');
    });
});

describe('the tag never reaches the screen or the voice', () => {
    test('the sentence survives and the tag does not', () => {
        const out = Directive.extract('Here is something calm. <play kind="music">ambient rain</play>');
        expect(out.clean).toBe('Here is something calm.');
        expect(out.directive).toEqual({ kind: 'music', query: 'ambient rain' });
    });

    test('quoting and spacing vary between models; intent does not', () => {
        for (const raw of [
            "<play kind='music'>x</play>",
            '<play kind=music>x</play>',
            '<play   kind = "music" >x</play >',
        ]) {
            expect(Directive.extract(`ok ${raw}`).directive.query).toBe('x');
        }
    });

    test('a tag with no kind is a video', () => {
        expect(Directive.extract('<play>a documentary</play>').directive).toEqual({
            kind: 'video',
            query: 'a documentary',
        });
    });

    test('at most one plays, however many she wrote', () => {
        // T2 asks for one. An instruction is not a guarantee, so the guarantee lives here —
        // three would start three things and the last would win after two flashes.
        const out = Directive.extract('a <play>one</play> b <play>two</play> c <play>three</play>');
        expect(out.directive.query).toBe('one');
        expect(out.extra).toBe(2);
        expect(out.clean).not.toMatch(/<play|two|three/);
    });

    test('a truncated reply does not end in visible markup', () => {
        // A cut-off stream leaves an unclosed tag. Strip it from view; never run it, because
        // the query is whatever the reply happened to stop at.
        const out = Directive.extract('Putting something on <play kind="music">ambient rai');
        expect(out.clean).toBe('Putting something on');
        expect(out.directive).toBeNull();
    });

    test('an empty tag is not a search for nothing', () => {
        expect(Directive.extract('here <play kind="music"></play>').directive).toBeNull();
    });

    test('a reply with no tag comes back untouched', () => {
        const plain = 'Just talking about music, not playing any.';
        expect(Directive.extract(plain).clean).toBe(plain);
        expect(Directive.has(plain)).toBe(false);
    });

    test('consume runs it and returns only what should be said', () => {
        const calls = [];
        const clean = Directive.consume('Here you go. <play kind="music">lofi</play>', {
            intent: { fulfil: (r) => calls.push(r) },
        });
        expect(clean).toBe('Here you go.');
        expect(calls).toEqual([{ query: 'lofi', kind: 'music', source: 'model' }]);
    });

    test('a play that fails leaves the sentence standing', () => {
        // She said something true; the media simply did not arrive. Losing her line as well
        // would turn one disappointment into two.
        const clean = Directive.consume('One moment. <play>x</play>', {
            intent: { fulfil: () => Promise.reject(new Error('offline')) },
        });
        expect(clean).toBe('One moment.');
    });

    test('and a play that throws synchronously does too', () => {
        const clean = Directive.consume('One moment. <play>x</play>', {
            intent: {
                fulfil: () => {
                    throw new Error('boom');
                },
            },
        });
        expect(clean).toBe('One moment.');
    });
});

describe('the wiring', () => {
    const fs = require('fs');
    const path = require('path');
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

    test('both reply paths strip it, beside the motion seam', () => {
        // Display and speech are separate code paths here, so "strip it" has to mean both or
        // it means neither. Sitting on `displayText` covers the bubble, the transcript, the VR
        // forward and `speakText` at once.
        expect(
            (main.match(/NEXUS_PLAY_DIRECTIVE\s*\n?\s*\?\s*window\.NEXUS_PLAY_DIRECTIVE\.consume/g) || []).length
        ).toBe(2);
        const motion = (main.match(/NEXUS_MOTION\.processReply/g) || []).length;
        expect((main.match(/NEXUS_PLAY_DIRECTIVE/g) || []).length).toBeGreaterThanOrEqual(motion);
    });

    test('nothing calls fulfil from a user message', () => {
        // A chat message is not a capability. Letting typed input reach `fulfil` through the
        // directive path would make it one.
        expect(main).not.toMatch(/NEXUS_PLAY_DIRECTIVE[\s\S]{0,120}userMessage/);
    });
});
