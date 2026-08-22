'use strict';

/**
 * The current turn is sent ONCE, whatever the caller hands us.
 *
 * Reported from a real session — one "sit down", and the reply was
 *
 *   "You want me to sit down twice in a row? Alright, alright, let's get
 *    seated not once, but TWICE!"
 *
 * followed by "I'll stand up... and then stand up AGAIN?!" for one "stand up".
 * The body followed the fast path once, so the words and the animation
 * disagreed.
 *
 * It was not a double submit — the click and Enter handlers in main.js are
 * mutually exclusive, and each clears the input. It was the request payload.
 * handleUserMessage() calls chatHistory.addMessage('user', text) BEFORE
 * dispatching, and both callLLM() and _handleStreamingResponse() then pass the
 * whole of getHistory() — the new turn included — into an API whose contract
 * is (userMessage, systemPrompt, PRIOR history). Appending userMessage on top
 * produced:
 *
 *   system … | user: hello | assistant: hi! | user: sit down | user: sit down
 *
 * _withCurrentTurn() joins the two without repeating, so a caller that passes
 * the turn already gets it once, and a caller that passes prior turns only is
 * unaffected.
 */

/* global describe, test, expect, beforeAll */

let mgr;

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

const roles = (msgs) => msgs.map((m) => `${m.role}: ${m.content}`);

describe('the reported payload', () => {
    const PRIOR = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi!' },
    ];

    test('a history that already ends with the turn does not repeat it', () => {
        const withTurn = PRIOR.concat([{ role: 'user', content: 'sit down' }]);
        expect(roles(mgr._withCurrentTurn(withTurn, 'sit down'))).toEqual([
            'user: hello',
            'assistant: hi!',
            'user: sit down',
        ]);
    });

    test('"sit down" reaches the model exactly once', () => {
        const withTurn = PRIOR.concat([{ role: 'user', content: 'sit down' }]);
        const out = mgr._withCurrentTurn(withTurn, 'sit down');
        expect(out.filter((m) => m.role === 'user' && m.content === 'sit down')).toHaveLength(1);
    });

    test('the contract-honouring caller still gets the turn appended', () => {
        expect(roles(mgr._withCurrentTurn(PRIOR, 'sit down'))).toEqual([
            'user: hello',
            'assistant: hi!',
            'user: sit down',
        ]);
    });
});

describe('only the LAST entry counts', () => {
    test('an identical message earlier in the conversation is not the current turn', () => {
        // Asking twice across a conversation is legitimate and must survive.
        const history = [
            { role: 'user', content: 'sit down' },
            { role: 'assistant', content: 'Sitting!' },
        ];
        const out = mgr._withCurrentTurn(history, 'sit down');
        expect(out).toHaveLength(3);
        expect(out[2]).toEqual({ role: 'user', content: 'sit down' });
    });

    test('a trailing ASSISTANT turn is never mistaken for the user turn', () => {
        const history = [{ role: 'assistant', content: 'sit down' }];
        const out = mgr._withCurrentTurn(history, 'sit down');
        expect(out).toHaveLength(2);
        expect(out[1].role).toBe('user');
    });

    test('a different trailing user message is left alone', () => {
        const history = [{ role: 'user', content: 'stand up' }];
        expect(roles(mgr._withCurrentTurn(history, 'sit down'))).toEqual(['user: stand up', 'user: sit down']);
    });
});

describe('it never mutates the caller', () => {
    test('the history array passed in is unchanged', () => {
        const history = [{ role: 'user', content: 'hello' }];
        const before = JSON.stringify(history);
        mgr._withCurrentTurn(history, 'sit down');
        expect(JSON.stringify(history)).toBe(before);
    });

    test('and the de-duplicating branch returns a copy too', () => {
        const history = [{ role: 'user', content: 'sit down' }];
        const out = mgr._withCurrentTurn(history, 'sit down');
        out.push({ role: 'user', content: 'injected' });
        expect(history).toHaveLength(1);
    });
});

describe('degenerate input', () => {
    test('an empty or missing history yields just the turn', () => {
        for (const h of [[], null, undefined]) {
            expect(roles(mgr._withCurrentTurn(h, 'hi'))).toEqual(['user: hi']);
        }
    });

    test('a non-array history does not throw', () => {
        expect(() => mgr._withCurrentTurn('nonsense', 'hi')).not.toThrow();
    });
});
