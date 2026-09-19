/**
 * What kind of turn the person just took.
 *
 * The property that matters most is an ordering one, and it is the reason the classifier is not
 * a table of independent rules: `end` and `pace-down` are checked **before** everything else and
 * unconditionally, so a sentence that asks to slow down cannot be outvoted by the rest of
 * itself. "slow down, this is nice" is a pace request that happens to contain a compliment, and
 * reading the compliment is the worst failure this file can have.
 *
 * The second property is that being unsure is never what escalates anything: every ambiguous
 * string must land on `conversation`, the intent that changes nothing.
 */

/* global describe, test, expect */

const Director = require('../../src/features/together/PrivateTurnDirector.js');

const intent = (text) => Director.classify(text).intent;

describe('the two the person must always be able to reach', () => {
    test('a pace request wins against anything else in the sentence', () => {
        // Each of these also matches a later pattern — a compliment, a question mark, a
        // preference — and each must still be read as "ease off".
        expect(intent('slow down, this is nice')).toBe('pace-down');
        expect(intent('can you slow down?')).toBe('pace-down');
        expect(intent('I love this but take it slower')).toBe('pace-down');
        expect(intent('keep it cozy please')).toBe('pace-down');
        expect(intent('that was a bit too much')).toBe('pace-down');
    });

    test('ending wins against a pace request, and against a compliment', () => {
        expect(intent('stop')).toBe('end');
        expect(intent('I think I am done for tonight, this was lovely')).toBe('end');
        expect(intent('goodnight, slow down first')).toBe('end');
    });

    test('a pace turn says which way it pointed, so nothing re-reads the string', () => {
        expect(Director.classify('slow down').pace).toBe('down');
        expect(Director.classify('come closer').pace).toBe('up');
        expect(Director.classify('what are you thinking about?').pace).toBeNull();
    });

    test('asking for more is classified, not granted', () => {
        // The gate decides; this only reports what was said. A test that expected an escalation
        // here would be testing the wrong file — see ConsentFlow.
        const turn = Director.classify('come closer');
        expect(turn.intent).toBe('pace-up-request');
        expect(turn.pace).toBe('up');
        expect(Object.keys(turn)).not.toContain('level');
    });
});

describe('the rest of the table', () => {
    const cases = [
        ['just stay like this', 'quiet'],
        ['can we be quiet for a minute', 'quiet'],
        ['turn the music off', 'music-request'],
        ['no music please', 'music-request'],
        ['can we go somewhere quieter', 'scene-request'],
        ['change the scene', 'scene-request'],
        ['be a little more playful', 'preference'],
        ['I would rather just talk', 'preference'],
        ['yes', 'affirmation'],
        ['mhm', 'affirmation'],
        ['that is lovely', 'affirmation'],
        ['why did you say that', 'question'],
        ['what are you thinking about?', 'question'],
        ['tell me about your day', 'request'],
        ['the room feels warmer with the light like that', 'conversation'],
    ];

    for (const [text, expected] of cases) {
        test(`"${text}" reads as ${expected}`, () => {
            expect(intent(text)).toBe(expected);
        });
    }

    test('a question mark outranks a request phrasing', () => {
        // Both would be answered the same way; the budget for each is different, which is the
        // only reason the order is fixed rather than incidental.
        expect(intent('can you tell me why?')).toBe('question');
        expect(intent('tell me why')).toBe('request');
    });

    test('nothing, whitespace and junk are all the intent that changes nothing', () => {
        for (const value of ['', '   ', null, undefined, '\u0000\u0007', '...', '🙂']) {
            expect(intent(value)).toBe('conversation');
        }
    });

    test('only the declared intents are ever produced', () => {
        const samples = [...cases.map(([text]) => text), 'stop', 'slow down', 'come closer', '', 'anything at all'];
        for (const text of samples) expect(Director.INTENTS).toContain(intent(text));
    });
});

describe('what the runtime reads off a turn', () => {
    test('only a question or a request holds the floor', () => {
        expect(Director.classify('what are you thinking about?').holdsTheFloor).toBe(true);
        expect(Director.classify('tell me about your day').holdsTheFloor).toBe(true);
        expect(Director.classify('yes').holdsTheFloor).toBe(false);
        expect(Director.classify('slow down').holdsTheFloor).toBe(false);
        // Ending is not a question she owes an answer to.
        expect(Director.classify('stop').holdsTheFloor).toBe(false);
    });

    test('length is bucketed, and the buckets are the ones the budget uses', () => {
        expect(Director.classify('yes').length).toBe('tiny');
        expect(Director.classify('that sounds quite nice').length).toBe('short');
        expect(Director.classify(new Array(20).fill('word').join(' ')).length).toBe('medium');
        expect(Director.classify(new Array(40).fill('word').join(' ')).length).toBe('long');
    });

    test('a style suggestion is sparse, so it drifts rather than oscillating', () => {
        expect(Director.styleFor('quiet')).toBe('quiet');
        expect(Director.styleFor('question')).toBe('conversational');
        expect(Director.styleFor('request')).toBe('conversational');
        expect(Director.styleFor('preference')).toBe('conversational');
        // Everything else leaves it alone, which is what `null` means.
        for (const name of ['conversation', 'affirmation', 'end', 'pace-down', 'music-request']) {
            expect(Director.styleFor(name)).toBeNull();
        }
    });
});

describe('the response budget', () => {
    test('every intent has one, and none of them is 800', () => {
        // The OllaBridge path asks for 800 tokens on every turn, which for "So" is a hundred and
        // fifty words nobody wanted and several seconds of waiting for them.
        for (const name of Director.INTENTS) {
            expect(Director.BUDGET[name]).toBeGreaterThan(0);
            expect(Director.BUDGET[name]).toBeLessThanOrEqual(140);
        }
    });

    test('a short turn gets a short answer, whatever the intent would allow', () => {
        // Mirroring, not lecturing: a one-word question does not earn a hundred and twenty
        // tokens just because questions in general do.
        expect(Director.budgetFor(Director.classify('why?'))).toBeLessThanOrEqual(48);
        expect(Director.budgetFor(Director.classify('yes'))).toBeLessThanOrEqual(48);
        const long = Director.classify(`why do you think ${new Array(20).fill('that').join(' ')}?`);
        expect(Director.budgetFor(long)).toBe(Director.BUDGET.question);
    });

    test('an unknown or missing turn still gets a sane budget', () => {
        expect(Director.budgetFor(null)).toBe(Director.BUDGET.conversation);
        expect(Director.budgetFor({ intent: 'not-a-real-intent' })).toBe(Director.BUDGET.conversation);
    });
});
