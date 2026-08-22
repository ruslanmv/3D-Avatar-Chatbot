'use strict';

/**
 * Markdown → speech normalisation.
 *
 * Models emit Markdown whether or not it was asked for. Read aloud verbatim
 * that becomes "asterisk asterisk important asterisk asterisk", hashes spoken
 * as "hash", and URLs spelled out. These pin the behaviour modern assistant
 * voices have converged on: emphasis dropped, links read by their text, code
 * named rather than recited, structure turned into pauses.
 */

/* global describe, test, expect */

const N = require('../src/SpeechTextNormalizer');
const say = (t, o) => N.forSpeech(t, o);

describe('emphasis is dropped, never spoken', () => {
    test('bold, italic, bold-italic and strikethrough', () => {
        expect(say('This is **very** important')).toBe('This is very important');
        expect(say('This is *very* important')).toBe('This is very important');
        expect(say('This is ***very*** important')).toBe('This is very important');
        expect(say('This is ~~not~~ true')).toBe('This is not true');
        expect(say('This is __bold__ text')).toBe('This is bold text');
    });

    test('snake_case survives — the underscore trap', () => {
        // A naive underscore-italic rule turns pair_token into pairtoken, and
        // an identifier read aloud with its underscores missing is wrong.
        expect(say('Set pair_token and device_id')).toBe('Set pair_token and device_id');
        expect(say('the npc_bvh_anims key')).toBe('the npc_bvh_anims key');
    });

    test('a __dunder__ is spoken as the bare word', () => {
        // Genuinely ambiguous: __init__ is both a Python dunder and valid
        // Markdown bold. For SPEECH the distinction does not matter — "init"
        // is what a listener wants either way, and beats "underscore
        // underscore init".
        expect(say('call __init__ first')).toBe('call init first');
    });

    test('underscore italics still work at word boundaries', () => {
        expect(say('that is _really_ good')).toBe('that is really good');
    });

    test('an unmatched marker is dropped, not read out', () => {
        expect(say('a * stray asterisk')).toBe('a stray asterisk');
        expect(say('unclosed **bold here')).toBe('unclosed bold here');
    });
});

describe('code is named, not recited', () => {
    test('a fenced block becomes a short placeholder', () => {
        const out = say('Here:\n```\nconst x = 1;\nfor (;;) {}\n```\nDone');
        expect(out).not.toContain('const');
        expect(out).toContain('code block');
        expect(out).toContain('Done');
    });

    test('the language is named when the fence declares one', () => {
        expect(say('```python\nprint(1)\n```')).toContain('python code block');
    });

    test('an unterminated fence does not leak backticks', () => {
        // Happens whenever a stream is cut off mid-block.
        const out = say('Look:\n```js\nconst a = 1;');
        expect(out).not.toContain('`');
        expect(out).toContain('code block');
    });

    test('inline code keeps its word, loses the backticks', () => {
        expect(say('Call `stop()` to halt')).toBe('Call stop() to halt');
    });

    test('speakCodeBlocks reads the code when explicitly asked', () => {
        expect(say('```\nhello\n```', { speakCodeBlocks: true })).toContain('hello');
    });
});

describe('links are read by their text', () => {
    test('inline links keep the label and drop the URL', () => {
        expect(say('See [the docs](https://example.com/a/b) now')).toBe('See the docs now');
    });

    test('a bare URL is not spelled out', () => {
        const out = say('Go to https://example.com/very/long/path now');
        expect(out).not.toContain('example.com');
        expect(out).toContain('link');
    });

    test('images become their alt text', () => {
        expect(say('![a red car](x.png)')).toBe('a red car');
        expect(say('![](x.png)')).toBe('image');
    });

    test('reference links and their definitions', () => {
        expect(say('See [the docs][1]\n\n[1]: https://example.com')).toBe('See the docs');
    });
});

describe('structure becomes pauses', () => {
    test('headings lose their hashes and end a sentence', () => {
        expect(say('## Setup\nThen do this')).toBe('Setup. Then do this');
    });

    test('bullets lose the glyph and gain a pause', () => {
        expect(say('- one\n- two\n- three')).toBe('one. two. three.');
    });

    test('ordered lists keep their numbers — they help a listener', () => {
        const out = say('1. first\n2. second');
        expect(out).toContain('1.');
        expect(out).toContain('2.');
    });

    test('blockquotes, rules and checkboxes leave no markers', () => {
        expect(say('> quoted text')).toBe('quoted text');
        expect(say('above\n\n---\n\nbelow')).toBe('above below');
        expect(say('- [ ] todo item')).toBe('todo item.');
    });
});

describe('tables are flattened, not spelled', () => {
    test('pipes and the separator row never reach the voice', () => {
        const out = say('| Name | Age |\n| --- | --- |\n| Ada | 36 |');
        expect(out).not.toContain('|');
        expect(out).not.toContain('---');
        expect(out).toContain('Name, Age');
        expect(out).toContain('Ada, 36');
    });
});

describe('emoji and HTML', () => {
    test('emoji are dropped so the engine does not name them', () => {
        expect(say('Great job 🎉 well done 😀')).toBe('Great job well done');
    });

    test('emoji can be kept when asked', () => {
        expect(say('hi 🎉', { stripEmoji: false })).toContain('🎉');
    });

    test('HTML tags and comments are stripped', () => {
        expect(say('<p>Hello <b>there</b></p><!-- note -->')).toBe('Hello there.');
    });
});

describe('localised placeholders', () => {
    test('Spanish and Italian', () => {
        expect(say('```\nx\n```', { lang: 'es' })).toContain('bloque de código');
        expect(say('```\nx\n```', { lang: 'it' })).toContain('blocco di codice');
        expect(say('https://example.com', { lang: 'es' })).toContain('enlace');
    });

    test('an unknown language falls back to English', () => {
        expect(say('```\nx\n```', { lang: 'de' })).toContain('code block');
    });
});

describe('robustness', () => {
    test('null, undefined and empty input yield an empty string', () => {
        for (const v of [null, undefined, '', '   ', '\n\n']) expect(say(v)).toBe('');
    });

    test('non-string input does not throw', () => {
        expect(() => say(42)).not.toThrow();
        expect(() => say({})).not.toThrow();
    });

    test('plain prose is returned untouched', () => {
        const plain = 'Hello there! How are you today? I am well.';
        expect(say(plain)).toBe(plain);
    });

    test('escaped markdown is unescaped, not stripped', () => {
        expect(say('a literal \\* star')).toBe('a literal * star');
    });

    test('whitespace and doubled punctuation are tidied', () => {
        expect(say('Hello   there\n\n\nworld')).toBe('Hello there world');
        expect(say('Wow!!  Really??')).toBe('Wow! Really?');
    });

    test('maxLength truncates at a sentence boundary', () => {
        const out = say('One sentence here. Two sentence here. Three sentence here.', { maxLength: 40 });
        expect(out.length).toBeLessThanOrEqual(40);
        expect(out.endsWith('.')).toBe(true);
    });
});

describe('hasSpeakableContent', () => {
    test('true for real prose', () => {
        expect(N.hasSpeakableContent('Hello there')).toBe(true);
    });

    test('false for nothing but emoji or punctuation', () => {
        expect(N.hasSpeakableContent('🎉🎉🎉')).toBe(false);
        expect(N.hasSpeakableContent('***')).toBe(false);
        expect(N.hasSpeakableContent('')).toBe(false);
    });

    test('a bare code block still counts — the placeholder is spoken', () => {
        expect(N.hasSpeakableContent('```\nx = 1\n```')).toBe(true);
    });
});

describe('a realistic assistant reply', () => {
    test('everything a model actually emits, in one pass', () => {
        const reply = [
            '## Setting it up 🚀',
            '',
            'First, install **the package**:',
            '',
            '```bash',
            'npm install --save foo',
            '```',
            '',
            'Then check the [documentation](https://example.com/docs) for:',
            '',
            '- the `init()` call',
            '- the _optional_ config',
            '',
            '| Option | Default |',
            '| ------ | ------- |',
            '| retry  | 3       |',
            '',
            "That's it!",
        ].join('\n');

        const out = say(reply);
        // Nothing that should be vocalised as punctuation survives.
        expect(out).not.toMatch(/[*`#|]/);
        expect(out).not.toContain('https://');
        expect(out).not.toContain('npm install');
        expect(out).not.toContain('🚀');
        // Everything a listener needs does.
        expect(out).toContain('Setting it up');
        expect(out).toContain('the package');
        expect(out).toContain('bash code block');
        expect(out).toContain('documentation');
        expect(out).toContain('init()');
        expect(out).toContain('optional');
        expect(out).toContain('retry, 3');
        expect(out).toContain("That's it!");
    });
});

describe('nested lists are not code blocks', () => {
    /**
     * Reported: the avatar said "code block" in the middle of listing its own
     * abilities. A nested list is indented, and the indented-code-block rule
     * ate it whole — the content was not mangled, it was gone.
     *
     * Models emit nested lists constantly and indented code almost never (they
     * use fences), so the asymmetry decides it: swallowing a list loses
     * content, while reading a stray indented snippet aloud merely sounds odd.
     */
    const NESTED = [
        'You want to know more about my animation capabilities? Here are some examples:',
        '',
        '* Gestures:',
        '    + Wave',
        '    + Greeting',
        '    + Bow',
        '* Expressions:',
        '    + Neutral',
        '    + Happy',
        '',
        'Now, would you like me to demonstrate any of these animations?',
    ].join('\n');

    test('the reported reply no longer says "code block"', () => {
        expect(say(NESTED)).not.toContain('code block');
    });

    test('every nested item survives', () => {
        const out = say(NESTED);
        for (const item of ['Wave', 'Greeting', 'Bow', 'Neutral', 'Happy']) {
            expect(out).toContain(item);
        }
    });

    test('a nested list reads as a series under its parent', () => {
        // Four one-word sentences would be painfully choppy; a comma series is
        // what a person would say.
        expect(say(NESTED)).toContain('Gestures: Wave, Greeting, Bow.');
        expect(say(NESTED)).toContain('Expressions: Neutral, Happy.');
    });

    test('the surrounding prose is untouched', () => {
        const out = say(NESTED);
        expect(out).toContain('You want to know more about my animation capabilities?');
        expect(out).toContain('Now, would you like me to demonstrate any of these animations?');
    });

    test('genuinely indented code is still recognised', () => {
        const code = ['Run this:', '', '    npm install foo', '    npm run build', '', 'Then reload.'].join('\n');
        const out = say(code);
        expect(out).toContain('code block');
        expect(out).not.toContain('npm install');
        expect(out).toContain('Then reload.');
    });

    test('ordered nested items fold too', () => {
        const out = say('Steps:\n\n* Setup:\n    1. install\n    2. configure');
        expect(out).not.toContain('code block');
        expect(out).toContain('install');
        expect(out).toContain('configure');
    });
});

describe('inline list runs', () => {
    test('a colon-introduced run of markers becomes a series', () => {
        // Some models flatten a list onto one line: "Gestures: + Wave + Bow".
        // Spoken verbatim that is "plus Wave plus Bow".
        const out = say('Gestures: + Wave + Greeting + Bow');
        expect(out).not.toContain('+');
        expect(out).toContain('Wave, Greeting, Bow');
    });

    test('arithmetic and C++ are left alone', () => {
        expect(say('The answer is 2 + 2 and the language is C++.')).toBe(
            'The answer is 2 + 2 and the language is C++.'
        );
    });

    test('a single plus is not a list', () => {
        expect(say('Ratio: 3 + 4')).toBe('Ratio: 3 + 4');
    });
});
