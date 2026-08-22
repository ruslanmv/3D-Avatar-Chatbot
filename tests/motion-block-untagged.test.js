'use strict';

/**
 * Untagged motion blocks.
 *
 * Reported from a real chat: the avatar's reply ended with
 *
 *     ``` {"commands":[{"type":"look_at","target":"user_head"}],
 *          "interruptible":true,"priority":"normal"} ```
 *
 * a BARE fence, all on one line, with no `motion` tag and no newline after the
 * backticks. BLOCK_RE requires the literal word `motion`, so the block matched
 * nothing: the plan never ran, and the raw JSON was rendered into the chat and
 * handed to TTS to read out.
 *
 * Smaller models drop the tag routinely. The parser now accepts any fence whose
 * body validates as a plan — which an ordinary ```python or ```js block never
 * will, so real code blocks have to survive untouched.
 */

/* global describe, test, expect */

const P = require('../src/xr/MotionBlockParser');

/** The reply exactly as it appeared in the chat. */
const REPORTED =
    "You're really emphasizing the importance of sitting down! I remain seated, " +
    'ready to continue our conversation. ``` {"commands":[{"type":"look_at",' +
    '"target":"user_head"}],"interruptible":true,"priority":"normal"} ```';

describe('the reported reply', () => {
    test('the plan is extracted rather than lost', () => {
        const { plan } = P.extract(REPORTED);
        expect(plan).not.toBeNull();
        expect(plan.commands).toEqual([{ type: 'look_at', target: 'user_head' }]);
    });

    test('no JSON reaches the chat or the voice', () => {
        const { cleanText } = P.extract(REPORTED);
        expect(cleanText).not.toContain('```');
        expect(cleanText).not.toContain('commands');
        expect(cleanText).not.toContain('{');
        expect(cleanText).toBe(
            "You're really emphasizing the importance of sitting down! I remain seated, " +
                'ready to continue our conversation.'
        );
    });

    test('and it is masked while it streams in', () => {
        expect(P.maskStreaming(REPORTED)).not.toContain('```');
        expect(P.maskStreaming(REPORTED)).not.toContain('commands');
    });
});

describe('fence shapes a model actually emits', () => {
    const PLAN = '{"commands":[{"type":"wave"}]}';

    test('tagged, the documented form, still works', () => {
        const r = P.extract('Hi\n```motion\n' + PLAN + '\n```');
        expect(r.plan.commands).toEqual([{ type: 'wave' }]);
        expect(r.cleanText).toBe('Hi');
    });

    test('untagged and multi-line', () => {
        const r = P.extract('Hi\n```\n' + PLAN + '\n```');
        expect(r.plan.commands).toEqual([{ type: 'wave' }]);
        expect(r.cleanText).toBe('Hi');
    });

    test('untagged and inline on one line', () => {
        const r = P.extract('Hi ``` ' + PLAN + ' ```');
        expect(r.plan.commands).toEqual([{ type: 'wave' }]);
        expect(r.cleanText).toBe('Hi');
    });

    test('mis-tagged as json', () => {
        const r = P.extract('Hi\n```json\n' + PLAN + '\n```');
        expect(r.plan.commands).toEqual([{ type: 'wave' }]);
        expect(r.cleanText).toBe('Hi');
    });

    test('the last valid block wins when a model repeats itself', () => {
        const r = P.extract('```\n{"commands":[{"type":"wave"}]}\n```\ntext\n```\n{"commands":[{"type":"nod"}]}\n```');
        expect(r.plan.commands).toEqual([{ type: 'nod' }]);
    });
});

describe('real code blocks are not collateral damage', () => {
    test('a python block survives whole', () => {
        const src = 'Run this:\n```python\nprint({"commands": 1})\n```\nDone';
        const r = P.extract(src);
        expect(r.plan).toBeNull();
        expect(r.cleanText).toBe(src);
    });

    test('a javascript block survives whole', () => {
        const src = 'Here:\n```js\nconst x = { a: 1 };\n```';
        expect(P.extract(src).cleanText).toBe(src);
    });

    test('a JSON block that is not a plan survives whole', () => {
        // This is the one a naive "strip any fence containing {" would eat,
        // taking the rest of the reply with it.
        const src = 'Config:\n```json\n{"a":1,"b":2}\n```\nThat is all.';
        const r = P.extract(src);
        expect(r.plan).toBeNull();
        expect(r.cleanText).toBe(src);
    });

    test('a commands array of unknown types is not a plan, and is left alone', () => {
        const src = 'See:\n```json\n{"commands":[{"type":"launch_missiles"}]}\n```\nEnd.';
        const r = P.extract(src);
        expect(r.plan).toBeNull();
        expect(r.cleanText).toBe(src);
    });

    test('prose with no fence at all is returned untouched', () => {
        expect(P.extract('Just talking.').cleanText).toBe('Just talking.');
    });
});

describe('cut-off streams', () => {
    test('an unterminated tagged block is hidden', () => {
        expect(P.extract('Sure.\n```motion\n{"commands":[{"ty').cleanText).toBe('Sure.');
    });

    test('an unterminated untagged block is hidden too', () => {
        expect(P.extract('Sure.\n```\n{"commands":[{"ty').cleanText).toBe('Sure.');
    });

    test('a malformed tagged block is hidden rather than shown broken', () => {
        expect(P.extract('Hi\n```motion\n{not json\n```').cleanText).toBe('Hi');
    });
});
