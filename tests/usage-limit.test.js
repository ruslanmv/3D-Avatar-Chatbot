/**
 * PX13. When the free providers behind OllaBridge are out of quota, the app stops spending more of
 * it: no retry, no second attempt, one honest sentence in the app's language — and a session's
 * setup asks for its script once, not twice.
 */
/* global describe, test, expect, jest */
const fs = require('fs');
const path = require('path');
const ErrorText = require('../src/features/chat/ChatErrorText.js');
const Locale = require('../src/features/together/PrivateLocale.js');

describe('a usage limit is recognised however the gateway reports it', () => {
    test.each([
        [{ status: 429 }],
        [{ status: 402 }],
        [new Error('OllaBridge error 503: all providers failed — rate limit exceeded: free-models-per-day')],
        [new Error('HF Inference Providers returned 402 Payment Required - your free-tier credits are exhausted')],
        [new Error('Rate limit exceeded: 50 requests per day')],
    ])('%o', (error) => {
        expect(ErrorText.kind(error)).toBe('limit');
        expect(ErrorText.describe(error)).toMatch(/limit/);
    });

    test('other failures keep their own kind', () => {
        expect(ErrorText.kind({ status: 504 })).toBe('timeout');
        expect(ErrorText.kind({ status: 401 })).toBe('auth');
        expect(ErrorText.kind(new Error('Failed to fetch'))).toBe('network');
    });
});

describe('the gateway is not asked again into a limit', () => {
    test('a 503 that says the quota is spent is returned at once, not retried', async () => {
        require('../src/LLMManager.js');
        const m = new window.LLMManager();
        const calls = [];
        m._postOllaBridge = jest.fn(async () => {
            calls.push(1);
            const body = 'all providers failed: rate limit exceeded (free-models-per-day)';
            return { ok: false, status: 503, text: async () => body, clone: () => ({ text: async () => body }) };
        });
        const res = await m._postOllaBridgeWithRetry('https://x', {}, {});
        expect(res.status).toBe(503);
        expect(calls).toHaveLength(1);
    });

    test('a 503 that is only a gateway between states is still retried', async () => {
        const m = new window.LLMManager();
        let n = 0;
        m._postOllaBridge = jest.fn(async () => {
            n += 1;
            return n < 2
                ? {
                      ok: false,
                      status: 503,
                      text: async () => 'Service Unavailable',
                      clone: () => ({ text: async () => 'Service Unavailable' }),
                  }
                : { ok: true, status: 200, text: async () => '{}' };
        });
        const res = await m._postOllaBridgeWithRetry('https://x', {}, {});
        expect(res.ok).toBe(true);
        expect(n).toBe(2);
    });
});

describe('the reply path stops at a limit', () => {
    const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

    test('a streamed reply that hit a limit is not asked for again without streaming', () => {
        const at = main.indexOf("kind?.(error) === 'limit'");
        const fallback = main.indexOf('await _handleNonStreamingResponse(text);', at);
        expect(at).toBeGreaterThan(-1);
        expect(fallback).toBeGreaterThan(at);
        expect(main.slice(at, fallback)).toMatch(/return;/);
    });

    test('inside Private the failure line is in every app language, with its own line for a limit', () => {
        for (const code of Object.keys(Locale.PACKS)) {
            const pack = Locale.PACKS[code];
            expect(pack['error.lost']).toBeTruthy();
            expect(pack['error.limit']).toBeTruthy();
            expect(pack['error.limit']).not.toBe(pack['error.lost']);
        }
        expect(Locale.t('error.lost', null, 'it-IT')).toMatch(/filo/);
    });
});

describe('a session asks for its script once', () => {
    test('"Current Scene" and "this place" are the same unchosen place: one plan request', async () => {
        const PlaygroundActivity = require('../src/features/together/activities/playground.js');
        const plan = jest.fn(async () => ({ opening: 'x' }));
        window.NEXUS_PRIVATE_BEATS = { plan };
        const a = new PlaygroundActivity.IntimateActivity.Intimate({
            bus: null,
            adult: null,
            capability: () => ({ ok: true }),
        });
        const preset = { id: 'sensual' };
        await a._planFor({ preset, place: 'Current Scene', win: window });
        await a._planFor({ preset, place: 'this place', win: window });
        expect(plan).toHaveBeenCalledTimes(1);
        // A place actually chosen is a different question, and is asked.
        a.sceneChoice = 'candlelit';
        await a._planFor({ preset, place: 'Candlelit room', win: window });
        expect(plan).toHaveBeenCalledTimes(2);
        delete window.NEXUS_PRIVATE_BEATS;
    });
});
