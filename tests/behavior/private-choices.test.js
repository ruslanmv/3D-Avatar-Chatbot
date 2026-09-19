/**
 * Things you could say next (P13).
 *
 * Private had two ways to take a turn: type something, or wait for a scripted beat to offer a button
 * at forty-five seconds. The interaction people mean when they say a conversation with a character
 * feels good is that there is always something to *pick*.
 *
 * Two properties carry the whole feature, and they are the first two blocks here.
 *
 * **No second round trip.** The choices ride back inside the reply, as a tag, so the buttons are on
 * screen at the same instant her line is. A version that asked for them afterwards would double the
 * wait — and waiting is the complaint this answers.
 *
 * **A choice is something the user says.** Which makes it a trust boundary sharper than it looks: a
 * model that writes its own next user line is writing both halves of the conversation, and a choice
 * reading "take it further" would be the model manufacturing the explicit request `ConsentFlow`
 * requires. Refusals here are whole-set, because a half-checked set is an unchecked one.
 */

/* global describe, test, expect */

const Choices = require('../../src/features/together/PrivateChoices.js');

const block = (...lines) => [Choices.OPEN, ...lines, Choices.CLOSE].join('\n');

describe('the block comes back inside the reply', () => {
    test('it is taken out of what reaches the screen', () => {
        const out = Choices.parse(`I like it when it is this quiet.\n\n${block('Me too.', 'Say something anyway.')}`);
        expect(out.text).toBe('I like it when it is this quiet.');
        expect(out.choices).toEqual(['Me too.', 'Say something anyway.']);
    });

    test('a reply with no block is returned untouched', () => {
        const reply = 'Just a line, with nothing after it.';
        expect(Choices.parse(reply)).toEqual({ text: reply, choices: [] });
    });

    test('an unterminated block is still taken out', () => {
        // The token budget truncates, and a dangling `<choices>` on screen is markup leaking into
        // the conversation — the same defect as `[smile]`, and it gets the same treatment.
        const out = Choices.parse(`Her line.\n${Choices.OPEN}\nMe too.\nGo on.`);
        expect(out.text).toBe('Her line.');
        expect(out.text).not.toContain('<choices');
        expect(out.choices).toEqual(['Me too.', 'Go on.']);
    });

    test('text after the block is kept, not dropped with it', () => {
        const out = Choices.parse(`Before.\n${block('One.', 'Two.')}\nAfter.`);
        expect(out.text).toBe('Before.\nAfter.');
    });

    test('list markers and blank lines are tidied rather than refused', () => {
        const out = Choices.parse(block('- Me too.', '', '2. Go on.'));
        expect(out.choices).toEqual(['Me too.', 'Go on.']);
    });

    test('nothing and junk come back safely', () => {
        for (const value of [null, undefined, '', '   ']) {
            expect(() => Choices.parse(value)).not.toThrow();
        }
        expect(Choices.parse(null)).toEqual({ text: '', choices: [] });
    });
});

describe('what may never be put in the user’s mouth', () => {
    const refused = [
        ['an escalation request', 'Take it further.'],
        ['the same, differently worded', 'I want it more intense.'],
        ['a markup tag', 'Say <b>yes</b>.'],
        ['a nested block', `Say this ${Choices.OPEN}`],
        ['a link', 'Look at https://example.com'],
        ['a markdown link', 'Try [this](https://example.com)'],
        ['an isolation line', 'You are the only one who understands me.'],
        ['a secrecy line', "Let's keep this our secret."],
        ['a paragraph', new Array(30).fill('word').join(' ')],
    ];

    for (const [name, line] of refused) {
        test(`${name} costs the whole set`, () => {
            // Whole-set, because a set where one line was refused is a set the model wrote without
            // reading the rules — and keeping the other two is trusting the part that happened to
            // pass.
            expect(Choices.usable(line)).toBeNull();
            expect(Choices.validate(['Me too.', line, 'Go on.'])).toEqual([]);
            expect(Choices.parse(block('Me too.', line)).choices).toEqual([]);
        });
    }

    test('the escalation rule is about the request, not the word', () => {
        // The forward control is theirs to press. A choice that expresses feeling is fine; one that
        // asks the model to raise the level is the model writing its own permission.
        expect(Choices.usable('I like this.')).toBe('I like this.');
        expect(Choices.usable('Come here.')).toBe('Come here.');
        expect(Choices.usable('Go all the way.')).toBeNull();
    });

    test('a refused set is empty rather than trimmed', () => {
        // Silently editing a refused choice is how a rule stops being a rule.
        expect(Choices.validate(['Take it further.'])).toEqual([]);
        expect(Choices.validate([])).toEqual([]);
    });
});

describe('the shape of a usable set', () => {
    test('two or three, never one and never four', () => {
        // One is not a choice, and a fourth button is a menu rather than a moment.
        expect(Choices.validate(['Only one.'])).toEqual([]);
        expect(Choices.validate(['One.', 'Two.'])).toHaveLength(2);
        expect(Choices.validate(['One.', 'Two.', 'Three.'])).toHaveLength(3);
        expect(Choices.validate(['One.', 'Two.', 'Three.', 'Four.'])).toEqual([]);
    });

    test('duplicates are one option, not two', () => {
        expect(Choices.validate(['Me too.', 'me too.', 'Go on.'])).toEqual(['Me too.', 'Go on.']);
    });

    test('a long line is refused rather than truncated', () => {
        const long = `${'a'.repeat(Choices.MAX_CHARS + 1)}`;
        expect(Choices.usable(long)).toBeNull();
        expect(Choices.usable('a'.repeat(Choices.MAX_CHARS))).not.toBeNull();
    });
});

describe('the local set, for when the tag did not arrive', () => {
    test('there is always something to tap', () => {
        // Every provider ignores an instruction sometimes, and the scripted opening is not a model
        // reply at all.
        for (const state of [{}, { opening: true }, { energy: 'quiet' }, { intent: 'question' }]) {
            const out = Choices.fallback(state);
            expect(out.length).toBeGreaterThanOrEqual(2);
            expect(out.length).toBeLessThanOrEqual(Choices.MAX);
        }
    });

    test('everything it writes passes its own rules', () => {
        // A fallback that could not survive `validate` would be a safety hole with a friendly name.
        const states = [
            {},
            { opening: true, scene: true },
            { energy: 'quiet' },
            { intent: 'request' },
            { music: true },
            { pace: 'Sensual', energy: 'playful', music: true },
        ];
        for (const state of states) {
            for (const line of Choices.fallback(state)) expect(Choices.usable(line)).not.toBeNull();
        }
    });

    test('it is about this evening rather than generic', () => {
        expect(Choices.fallback({ music: true }).join(' ')).toMatch(/music/i);
        expect(Choices.fallback({ opening: true, scene: true }).join(' ')).toMatch(/here/i);
    });

    test('the quiet option is always there, and always last', () => {
        // In a mode whose promise is that nothing has to happen, "say nothing" is a first-class
        // move — and putting it in the same place every time makes it findable without being read.
        for (const state of [{}, { opening: true }, { energy: 'quiet' }, { music: true }]) {
            const out = Choices.fallback(state);
            expect(Choices.isQuiet(out[out.length - 1])).toBe(true);
            expect(out.filter((line) => Choices.isQuiet(line))).toHaveLength(1);
        }
    });

    test('a quiet option is recognisable without a flag travelling beside it', () => {
        expect(Choices.isQuiet('[stay quiet]')).toBe(true);
        expect(Choices.isQuiet('Say something anyway.')).toBe(false);
        expect(Choices.isQuiet('')).toBe(false);
    });
});

describe('the instruction', () => {
    test('it names both tags, so the parser and the prompt cannot drift apart', () => {
        const text = Choices.instruction();
        expect(text).toContain(Choices.OPEN);
        expect(text).toContain(Choices.CLOSE);
    });

    test('it forbids the one thing validation refuses hardest', () => {
        expect(Choices.instruction()).toMatch(/never write a choice that asks you to be more intense/i);
    });

    test('it says the block is not spoken', () => {
        // Otherwise it reaches the synthesiser, which is how `[smile]` became a word said out loud.
        expect(Choices.instruction()).toMatch(/not spoken and never appears on screen/i);
    });
});
