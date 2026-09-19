'use strict';

/**
 * An empty completion is a failed turn, not a line she said (P19).
 *
 * All five providers used to write it off the same way:
 *
 *     return data.choices?.[0]?.message?.content || 'No response';
 *
 * `'No response'` then travelled down the pipe a reply travels down. It was drawn as a chat
 * bubble, written into the history the next request reads, and **spoken out loud**. Inside a
 * Private session it arrived under a `HER` label, which is how it was reported: a transcript
 * reading
 *
 *     HER   I would like this to feel unhurried and a little charged…
 *     YOU   This is good.
 *     HER   No response
 *
 * The cause underneath it was the token cap — 96 for that turn plus 48 for the `<choices>` block,
 * against a reasoning model that spends its thinking from the same allowance and had not reached
 * a visible token yet. Two separate faults, and the first one hid the second: without
 * `finish_reason` nothing distinguished "cut off at the cap" from "the model had nothing to say",
 * so there was no way to tell a configuration problem from a provider problem.
 *
 * These pin the half that belongs to `LLMManager`. `PrivateTurnDirector` owns the cap, and
 * `private-turn-director.test.js` pins the floor that stops it happening again.
 */

/* global describe, test, expect, beforeAll, afterEach, jest */

let mgr;
let warned;

beforeAll(() => {
    global.window = global.window || {};
    window.localStorage = window.localStorage || {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
    };
    jest.isolateModules(() => {
        require('../src/LLMManager.js');
    });
    const LLMManager = window.LLMManager || global.LLMManager;
    mgr = new LLMManager();
});

afterEach(() => {
    if (warned) warned.mockRestore();
    warned = null;
    delete global.fetch;
});

/**
 * Answer one request with this JSON, the way a provider would.
 *
 * `_hasProxy()` is false with no settings, so the providers take the direct `fetch` branch.
 */
function answerWith(payload) {
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve(payload),
            text: () => Promise.resolve(JSON.stringify(payload)),
        })
    );
}

/** The five chat paths, each with the shape its own provider returns. */
const PROVIDERS = [
    {
        name: 'OpenAI',
        call: () => mgr._chatOpenAI('hi', 'rules'),
        empty: { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
        blank: { choices: [{ message: { content: '  \n\n ' }, finish_reason: 'stop' }] },
        good: { choices: [{ message: { content: 'a real answer' }, finish_reason: 'stop' }] },
        cut: { choices: [{ message: { content: 'half a sen' }, finish_reason: 'length' }] },
        settings: {
            openai: { api_key: 'sk-test0000000000000000', model: 'm', base_url: 'https://example.invalid/v1' },
        },
    },
    {
        name: 'Claude',
        call: () => mgr._chatClaude('hi', 'rules'),
        empty: { content: [{ text: '' }], stop_reason: 'max_tokens' },
        blank: { content: [{ text: '   ' }], stop_reason: 'end_turn' },
        good: { content: [{ text: 'a real answer' }], stop_reason: 'end_turn' },
        cut: { content: [{ text: 'half a sen' }], stop_reason: 'max_tokens' },
        settings: { claude: { api_key: 'sk-ant-test0000000000000', model: 'm', base_url: 'https://example.invalid' } },
    },
    {
        name: 'OllaBridge',
        call: () => mgr._chatOllaBridge('hi', 'rules'),
        empty: { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
        blank: { choices: [{ message: { content: '\n' }, finish_reason: 'stop' }] },
        good: { choices: [{ message: { content: 'a real answer' }, finish_reason: 'stop' }] },
        cut: { choices: [{ message: { content: 'half a sen' }, finish_reason: 'length' }] },
        settings: { ollabridge: { api_key: 'obk-test', model: 'free-best', base_url: 'https://example.invalid' } },
    },
];

function configure(provider) {
    Object.assign(mgr._settings, provider.settings);
}

describe('the string "No response" is gone from every provider', () => {
    test('it is not in the source any more', () => {
        // Blunt on purpose. The defect was one fallback repeated five times, and a sixth provider
        // added later would reach for the same idiom.
        // eslint-disable-next-line global-require
        const fs = require('fs');
        // eslint-disable-next-line global-require
        const path = require('path');
        const source = fs.readFileSync(path.join(__dirname, '../src/LLMManager.js'), 'utf8');
        const returns = source
            .split('\n')
            // Code only. The header of `EmptyCompletionError` quotes the old line to say what it
            // replaced, and a test that forbade the explanation would be the wrong lesson.
            .filter((line) => !/^\s*(?:\*|\/\/)/.test(line))
            .filter((line) => /return\b.*'No response'/.test(line));
        expect(returns).toEqual([]);
    });
});

describe.each(PROVIDERS)('$name', (provider) => {
    test('an empty completion throws instead of becoming dialogue', async () => {
        configure(provider);
        answerWith(provider.empty);
        await expect(provider.call()).rejects.toMatchObject({ name: 'EmptyCompletionError' });
    });

    test('and whitespace counts as empty, because a blank bubble reads as a crash', async () => {
        configure(provider);
        answerWith(provider.blank);
        await expect(provider.call()).rejects.toMatchObject({ name: 'EmptyCompletionError' });
    });

    test('the error says it was the token cap, which is the actionable case', async () => {
        configure(provider);
        answerWith(provider.empty);
        let caught = null;
        try {
            await provider.call();
        } catch (error) {
            caught = error;
        }
        expect(caught).not.toBeNull();
        expect(caught.cutOff).toBe(true);
        expect(caught.message).toMatch(/token limit/i);
        // The number is in the message, because "raise the cap" is useless advice without it.
        expect(caught.budget).toBeGreaterThan(0);
        expect(caught.message).toContain(String(caught.budget));
    });

    test('a real answer comes back untouched', async () => {
        configure(provider);
        answerWith(provider.good);
        await expect(provider.call()).resolves.toBe('a real answer');
    });

    test('an answer cut off mid-sentence is kept, and warned about', async () => {
        // Keeping it is right — half a sentence beats none — but silence about it is not. The same
        // misconfiguration one token later is invisible otherwise.
        configure(provider);
        warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
        answerWith(provider.cut);
        await expect(provider.call()).resolves.toBe('half a sen');
        expect(warned).toHaveBeenCalled();
        expect(String(warned.mock.calls[0][0])).toMatch(/token limit/i);
    });
});
