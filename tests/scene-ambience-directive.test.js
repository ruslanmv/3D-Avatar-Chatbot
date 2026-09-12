/**
 * The ambience directive (batch A10).
 *
 * This is the security boundary of the feature, so the tests are organised around the four ways
 * it could be crossed rather than around the happy path:
 *
 *   1. **A tag reaching the user.** It must be gone from the bubble *and* from the voice. Those
 *      are one `displayText` seam in practice, so one strip covers both — but a tag the grammar
 *      fails to *match* is a tag that gets displayed and read aloud, which is why matching is
 *      generous and accepting is strict.
 *   2. **An unexpected attribute succeeding.** `url=`, `src=`, `style=`: the directive must be
 *      refused outright, not partially honoured, while the whole tag is still stripped.
 *   3. **A user typing the tag.** A chat message is not a capability.
 *   4. **A withdrawn permission being ignored.** The switch is re-read at execution time, so a
 *      reply in flight when somebody turns ambience off cannot act on it.
 *
 * Plus the one-per-reply guarantee, which lives here because an instruction to the model is not
 * a guarantee.
 */

const Directive = require('../src/features/ambience/SceneAmbienceDirective.js');
const Switch = require('../src/features/ambience/SceneAmbienceSwitch.js');
// Loaded for its global, the way boot.js loads it before this module. isKnownIntent() asks the
// resolver rather than keeping a second copy of the vocabulary.
require('../src/features/ambience/SceneAmbienceResolver.js');

let controller;
let warn;

/** A controller that records rather than renders. */
function spyController() {
    return {
        calls: [],
        requestByIntent(request) {
            this.calls.push(request);
            return Promise.resolve('scene');
        },
    };
}

function consume(text, overrides) {
    return Directive.consume(text, { controller, switch: Switch, ...overrides });
}

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    Switch.enable();
    controller = spyController();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
});

describe('the tag never reaches the user', () => {
    test('the sentence survives and the tag does not', () => {
        const clean = consume('Let\'s go somewhere quiet by the water.\n<ambience intent="sea" mood="relax"/>');
        expect(clean).toBe("Let's go somewhere quiet by the water.");
        expect(clean).not.toMatch(/ambience|intent|<|>/);
    });

    test('a tag mid-sentence leaves no double spaces behind', () => {
        expect(consume('Somewhere calm. <ambience intent="sea"/> Ready when you are.')).toBe(
            'Somewhere calm. Ready when you are.'
        );
    });

    test.each([
        ['<ambience intent="sea" mood="relax"/>', 'self-closing, both attributes'],
        ['<ambience intent="sea"/>', 'self-closing, intent only'],
        ["<ambience intent='forest' />", 'single quotes and a space'],
        ['<ambience mood="relax" intent="sea">', 'attributes swapped, no slash'],
        ['<ambience intent="sea"></ambience>', 'a separate closing tag'],
        ['<AMBIENCE INTENT="SEA"/>', 'shouting'],
        ['<ambience   intent = "sea"   mood = "relax"  />', 'loose spacing'],
    ])('%s (%s) is stripped', (tag) => {
        expect(consume(`Off we go. ${tag}`)).toBe('Off we go.');
    });

    test('a truncated tag is stripped, and never executed', () => {
        // A reply cut off mid-stream. It must not end in visible markup, and there is nothing
        // complete enough in it to act on.
        const clean = consume('Let us head somewhere green. <ambience intent="forest"');
        expect(clean).toBe('Let us head somewhere green.');
        expect(controller.calls).toHaveLength(0);
    });

    test('the bracket-less form models really produce is stripped', () => {
        const clean = consume('Somewhere by the sea.\nambience intent="sea" mood="relax"');
        expect(clean).toBe('Somewhere by the sea.');
        expect(controller.calls).toHaveLength(0);
    });

    test('a reply that is nothing but a tag leaves empty text, not markup', () => {
        expect(consume('<ambience intent="sea"/>')).toBe('');
    });

    test('prose merely mentioning the word is left completely alone', () => {
        const prose = 'I love the ambience of a forest in the rain. Tell me about intent?';
        expect(consume(prose)).toBe(prose);
        expect(controller.calls).toHaveLength(0);
    });

    test.each([[null], [undefined], [''], [42], [{}]])('a non-string reply %p does not throw', (input) => {
        expect(() => Directive.consume(input, { controller, switch: Switch })).not.toThrow();
    });
});

describe('unknown attributes are refused, but still stripped', () => {
    test.each([
        ['url="https://elsewhere/x.webp"', 'a URL'],
        ['src="assets/../../secret.webp"', 'a path'],
        ['style="background:url(x)"', 'CSS'],
        ['onload="alert(1)"', 'a handler'],
        ['href="javascript:alert(1)"', 'an executable scheme'],
        ['scene="ambient:ocean:day"', 'a scene id it should not know'],
    ])('%s (%s) rejects the directive AND is stripped from view', (attribute) => {
        const clean = consume(`Let us go. <ambience intent="sea" ${attribute}/>`);
        expect(controller.calls).toHaveLength(0); // never executed
        expect(clean).toBe('Let us go.'); // never displayed
        expect(clean).not.toMatch(/http|javascript|alert|assets|url|src/i);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown attribute'));
    });

    test('the allowlist is exactly intent and mood', () => {
        expect(Directive.ALLOWED_ATTRIBUTES).toEqual(['intent', 'mood']);
    });

    test('a repeated attribute is refused rather than letting one silently win', () => {
        const clean = consume('Hm. <ambience intent="sea" intent="forest"/>');
        expect(controller.calls).toHaveLength(0);
        expect(clean).toBe('Hm.');
    });

    test('the tag carries no text body, so there is nothing to smuggle in one', () => {
        // Unlike <play>, which needs a free-text query. Any body is left as prose rather than
        // being read as a payload.
        const clean = consume('Here. <ambience intent="sea">https://elsewhere/x.webp</ambience>');
        expect(controller.calls[0]).toMatchObject({ intent: 'sea' });
        // The whole element goes, body included. Stripping only the opening tag would leave the
        // invented URL and a stray closing tag on screen and in the voice.
        expect(clean).toBe('Here.');
        expect(clean).not.toMatch(/<ambience|<\/ambience|elsewhere|http/i);
    });
});

describe('values must be words', () => {
    test.each([['sea'], ['forest'], ['open-sky'], ['meditation']])('%p is accepted', (intent) => {
        consume(`Go. <ambience intent="${intent}"/>`);
        expect(controller.calls[0].intent).toBe(intent);
    });

    test.each([
        ['Sea!!', 'punctuation'],
        ['../../etc', 'a path'],
        ['https://x.com', 'a URL'],
        ['sea forest', 'two words'],
        ['', 'empty'],
        ['123', 'digits first'],
        ['a'.repeat(40), 'far too long'],
    ])('%p (%s) is refused', (intent) => {
        const clean = consume(`Go. <ambience intent="${intent}"/>`);
        expect(controller.calls).toHaveLength(0);
        expect(clean).toBe('Go.');
    });

    test('an unusable mood is dropped, but the intent still runs', () => {
        // The intent is what was asked for. "Somewhere by the sea" is actionable without a mood,
        // so losing a malformed one is better than losing the request.
        consume('Go. <ambience intent="sea" mood="!!!"/>');
        expect(controller.calls[0]).toEqual({ intent: 'sea', mood: null, source: 'model' });
    });

    test('an unknown-but-wordlike intent is passed on for the resolver to decline', () => {
        // Duplicating the resolver's vocabulary here would be a second list to keep in step. It
        // returns null for "mars", which is the right place for that judgement.
        consume('Go. <ambience intent="mars"/>');
        expect(controller.calls[0].intent).toBe('mars');
        expect(Directive.isKnownIntent('mars')).toBe(false);
        expect(Directive.isKnownIntent('sea')).toBe(true);
    });

    test('lowercasing happens before anything else sees the value', () => {
        consume('Go. <ambience INTENT="SEA" MOOD="RELAX"/>');
        expect(controller.calls[0]).toMatchObject({ intent: 'sea', mood: 'relax' });
    });
});

describe('at most one scene change per reply', () => {
    test('three tags execute once and all three disappear', () => {
        const clean = consume(
            'Somewhere calm. <ambience intent="sea"/> Or maybe <ambience intent="forest"/> or ' +
                '<ambience intent="rain"/>'
        );
        expect(controller.calls).toHaveLength(1);
        expect(controller.calls[0].intent).toBe('sea');
        expect(clean).not.toMatch(/ambience/);
    });

    test('extract reports how many extras it removed', () => {
        const result = Directive.extract('a <ambience intent="sea"/> b <ambience intent="forest"/>');
        expect(result.directive.intent).toBe('sea');
        expect(result.extra).toBe(1);
    });

    test('the first tag wins, not the last', () => {
        // Either rule would be defensible; what matters is that it is deterministic, and that
        // the user does not see two scenes flash past on the way to the third.
        consume('<ambience intent="forest"/><ambience intent="sea"/>');
        expect(controller.calls[0].intent).toBe('forest');
    });
});

describe('the permission is re-read at execution time', () => {
    test('with ambience off, a well-formed directive is refused', () => {
        Switch.disable();
        const clean = consume('Let us go. <ambience intent="sea"/>');
        expect(controller.calls).toHaveLength(0);
        expect(clean).toBe('Let us go.'); // her sentence still stands
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ambience is off'));
    });

    test('a reply in flight when the user turns it off does not act', () => {
        // The race the feature is specified against: permission granted, request sent, permission
        // withdrawn, reply arrives. A permission captured when the prompt was built is one the
        // user can no longer take back.
        const reply = 'Let us go somewhere green. <ambience intent="forest"/>';
        Switch.disable(); // between the request and the reply
        consume(reply);
        expect(controller.calls).toHaveLength(0);
    });

    test('turning it back on makes the next reply work', () => {
        Switch.disable();
        consume('a <ambience intent="sea"/>');
        Switch.enable();
        consume('b <ambience intent="sea"/>');
        expect(controller.calls).toHaveLength(1);
    });

    test('with no switch findable anywhere, nothing executes', () => {
        // `switch: null` alone would fall through to the global, which is the house options
        // pattern (`options.intent || global.NEXUS_MEDIA_INTENT`). The property that matters is
        // the absence of any switch at all: no permission found means no permission granted.
        const saved = global.NEXUS_SCENE_AMBIENCE_SWITCH;
        delete global.NEXUS_SCENE_AMBIENCE_SWITCH;
        try {
            const clean = Directive.consume('a <ambience intent="sea"/>', { controller });
            expect(controller.calls).toHaveLength(0);
            expect(clean).toBe('a');
        } finally {
            global.NEXUS_SCENE_AMBIENCE_SWITCH = saved;
        }
    });

    test('a switch without isEnabled is treated as no permission', () => {
        const clean = Directive.consume('a <ambience intent="sea"/>', { controller, switch: {} });
        expect(controller.calls).toHaveLength(0);
        expect(clean).toBe('a');
    });
});

describe('user-typed tags are text, not capability', () => {
    test('extract on its own never executes anything', () => {
        // This is the whole mechanism: `consume` is called on assistant replies and nowhere else,
        // and `extract` — which is what any other caller would reach for — only ever parses.
        const result = Directive.extract('<ambience intent="sea"/>');
        expect(result.directive).toEqual({ intent: 'sea', mood: null });
        expect(controller.calls).toHaveLength(0);
    });

    test('a user message containing the tag is not run by anything here', () => {
        const typed = 'why not just <ambience intent="forest"/>';
        expect(Directive.has(typed)).toBe(true); // it parses
        expect(controller.calls).toHaveLength(0); // and nothing happened
    });
});

describe('failure never costs the reply', () => {
    test('a controller that throws leaves the sentence standing', () => {
        const clean = Directive.consume('Let us go. <ambience intent="sea"/>', {
            switch: Switch,
            controller: {
                requestByIntent() {
                    throw new Error('renderer gone');
                },
            },
        });
        expect(clean).toBe('Let us go.');
    });

    test('a controller rejecting asynchronously is swallowed', async () => {
        const clean = Directive.consume('Let us go. <ambience intent="sea"/>', {
            switch: Switch,
            controller: { requestByIntent: () => Promise.reject(new Error('404')) },
        });
        expect(clean).toBe('Let us go.');
        await new Promise((r) => setTimeout(r, 0));
    });

    test('with no controller, the reply is clean and a warning is logged', () => {
        const clean = Directive.consume('Let us go. <ambience intent="sea"/>', {
            switch: Switch,
            controller: null,
        });
        expect(clean).toBe('Let us go.');
        expect(warn).toHaveBeenCalled();
    });

    test('the change is not awaited, so the sentence is not held up by a download', () => {
        // consume() returns synchronously even though requestByIntent is a promise: her line
        // should appear the moment she says it, not after a texture has arrived.
        let settle;
        const slow = { requestByIntent: () => new Promise((r) => (settle = r)) };
        const clean = Directive.consume('Let us go. <ambience intent="sea"/>', {
            switch: Switch,
            controller: slow,
        });
        expect(clean).toBe('Let us go.');
        expect(typeof settle).toBe('function'); // still pending, and that is fine
    });
});

describe('extract is a pure split', () => {
    test('it returns clean text, the directive, the extras and any refusal', () => {
        expect(Directive.extract('hello <ambience intent="sea" mood="relax"/>')).toEqual({
            clean: 'hello',
            directive: { intent: 'sea', mood: 'relax' },
            extra: 0,
            rejected: null,
        });
    });

    test('a refusal is reported with a reason, for the log', () => {
        const result = Directive.extract('hello <ambience intent="sea" url="http://x/y"/>');
        expect(result.directive).toBeNull();
        expect(result.rejected).toContain('unknown attribute');
    });

    test('has() is cheap and agrees with extract()', () => {
        expect(Directive.has('x <ambience intent="sea"/>')).toBe(true);
        expect(Directive.has('no tag here')).toBe(false);
    });

    test('scrub() removes tags without running anything', () => {
        expect(Directive.scrub('a <ambience intent="sea"/> b')).toBe('a b');
        expect(controller.calls).toHaveLength(0);
    });
});

describe('a tag written with a body', () => {
    test('a stray closing tag on its own is stripped', () => {
        expect(consume('Somewhere calm.</ambience>')).toBe('Somewhere calm.');
    });

    test('a bodied tag still executes its attributes', () => {
        consume('Go. <ambience intent="forest" mood="relax">whatever</ambience>');
        expect(controller.calls[0]).toMatchObject({ intent: 'forest', mood: 'relax' });
    });

    test('a bodied tag with an unknown attribute is refused and fully stripped', () => {
        const clean = consume('Go. <ambience intent="sea" url="http://x/y">junk</ambience>');
        expect(controller.calls).toHaveLength(0);
        expect(clean).toBe('Go.');
        expect(clean).not.toMatch(/junk|http/);
    });

    test('has() recognises it', () => {
        expect(Directive.has('<ambience intent="sea">x</ambience>')).toBe(true);
    });

    test('an enormous body does not hang the parser', () => {
        const clean = consume(`Go. <ambience intent="sea">${'x'.repeat(5000)}</ambience>`);
        expect(clean).not.toMatch(/<ambience/);
    });
});
