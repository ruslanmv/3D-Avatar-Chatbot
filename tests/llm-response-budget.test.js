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
 *   2. a shorter budget is honoured, and a *longer* one is not. A capability that could raise a
 *      ceiling would be a way for one feature to spend another's token budget, so `_tokenBudget`
 *      clamps rather than assigns.
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

    test('a longer one is clamped, not obeyed', () => {
        // Otherwise a feature could raise another path's ceiling, and the ceiling is the one
        // number the provider settings are allowed to own.
        window.NEXUS_TOGETHER_CAPABILITY = { responseBudget: () => 4096 };
        expect(mgr._tokenBudget(800)).toBe(800);
        expect(mgr._tokenBudget(500)).toBe(500);
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
