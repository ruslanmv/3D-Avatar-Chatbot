'use strict';

/**
 * What the request body actually carries (P9).
 *
 * `TogetherCapability` can compute a budget and an overlay all day; what matters is whether the
 * request honours them. Two facts are pinned here and only these two:
 *
 *   1. with nothing to say about a request, every path sends exactly the ceiling it always sent —
 *      this is the whole safety of consulting a capability rather than threading an argument, and
 *      a regression here changes the length of every reply in the application;
 *   2. a shorter budget is honoured, and a longer one only up to a fixed bound (1024, AX18c).
 *      A capability that could raise a ceiling without limit would be a way for one feature to
 *      spend another's token budget, so `_tokenBudget` clamps rather than assigns; the bound
 *      exists because a reasoning model spends ~450 tokens before its first visible word, and a
 *      500 ceiling cut Private's replies mid-sentence.
 */

/* global describe, test, expect, beforeAll, afterEach, jest */

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

afterEach(() => {
    delete window.NEXUS_TOGETHER_CAPABILITY;
});

describe('nothing to say about this request', () => {
    test('no capability at all leaves every ceiling where it was', () => {
        expect(mgr._tokenBudget(800)).toBe(800);
        expect(mgr._tokenBudget(500)).toBe(500);
        expect(mgr._tokenBudget(1024)).toBe(1024);
        expect(mgr._experienceOverlay()).toBe('');
    });

    test('a capability with no opinion leaves them too', () => {
        window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => null, experienceOverlay: () => '' };
        expect(mgr._tokenBudget(800)).toBe(800);
        expect(mgr._experienceOverlay()).toBe('');
    });

    test('a capability that throws costs the tuning, never the reply', () => {
        window.NEXUS_TOGETHER_CAPABILITY = {
            responseBudget: () => {
                throw new Error('capability exploded');
            },
            experienceOverlay: () => {
                throw new Error('capability exploded');
            },
        };
        expect(mgr._tokenBudget(800)).toBe(800);
        expect(mgr._experienceOverlay()).toBe('');
    });

    test('junk is not a budget', () => {
        for (const value of [0, -1, NaN, Infinity, '96', null, undefined, {}]) {
            window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => value };
            expect(mgr._tokenBudget(800)).toBe(800);
        }
    });
});

describe('a budget that has something to say', () => {
    test('a shorter one is honoured', () => {
        window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => 48 };
        expect(mgr._tokenBudget(800)).toBe(48);
        expect(mgr._tokenBudget(500)).toBe(48);
    });

    test('a longer one is clamped to the bound, never obeyed beyond it', () => {
        // A feature may not spend without limit: 4096 asked is 1024 given, at most.
        window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => 4096 };
        expect(mgr._tokenBudget(800)).toBe(1024);
        expect(mgr._tokenBudget(500)).toBe(1024);
        expect(mgr._tokenBudget(2048)).toBe(2048); // a provider ceiling above the bound is kept, never raised
        // AX18c. Within the bound, Private's raised ceiling holds over a 500 default.
        window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => 768 };
        expect(mgr._tokenBudget(500)).toBe(768);
    });
});

describe('the overlay', () => {
    test('a string is passed through, anything else is not', () => {
        window.NEXUS_TOGETHER_CAPABILITY = { experienceOverlay: () => 'ACTIVE PRIVATE EXPERIENCE\nrules' };
        expect(mgr._experienceOverlay()).toMatch(/ACTIVE PRIVATE EXPERIENCE/);

        window.NEXUS_TOGETHER_CAPABILITY = { experienceOverlay: () => ({ rules: 'nope' }) };
        expect(mgr._experienceOverlay()).toBe('');
    });
});
