/**
 * SW1 — a sleeping SonicAgent is woken and waited for, not reported as "could not start".
 * Production 2026-11-07: the free Space slept, OllaBridge answered 503 to every voice call,
 * and the first 503 was final until someone restarted the Space by hand.
 */
const Config = require('../../src/stt/SonicAgentVoiceConfig.js');

function reply(status, body, headers) {
    const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => h[String(k).toLowerCase()] || null },
        json: async () => body,
        arrayBuffer: async () => new ArrayBuffer(0),
    };
}

function harness(answers, extra) {
    const calls = [];
    let t = 0;
    const slept = [];
    const events = [];
    const fetch = jest.fn(async (url, init) => {
        calls.push({ url, init });
        if (!String(url).startsWith('https://app.ollabridge.com')) return reply(200, {});
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
    });
    const g = Config.createGateway(
        Object.assign(
            {
                fetch,
                info: () => ({ baseUrl: 'https://app.ollabridge.com', token: 'tok' }),
                sleep: async (ms) => {
                    slept.push(ms);
                    t += ms;
                },
                now: () => t,
                emit: (name, detail) => events.push({ name, detail }),
                wakeUrl: 'https://example-space.hf.space/health/live',
            },
            extra || {}
        )
    );
    return { g, calls, slept, events };
}

const starting = () => reply(503, { detail: { error: 'backend_warming', message: 'the speech service is starting' } });

describe('SW1 wake a sleeping speech service', () => {
    test('503 while starting → one wake ping, waits, then succeeds', async () => {
        const h = harness([starting(), starting(), reply(200, { voice_count: 52 })]);
        await expect(h.g.voices()).resolves.toEqual({ voice_count: 52 });
        const pings = h.calls.filter((c) => c.url.startsWith('https://example-space'));
        expect(pings).toHaveLength(1); // at most one ping per two minutes
        expect(pings[0].init).toMatchObject({ mode: 'no-cors', credentials: 'omit' });
        expect(pings[0].init.headers).toBeUndefined(); // never the pairing token
        expect(h.slept.length).toBe(2);
        expect(h.events.map((e) => e.name)).toEqual(['sonic-voice-waking', 'sonic-voice-waking', 'sonic-voice-awake']);
    });

    test('a POST that got a 503 is retried — a 503 did nothing on the server', async () => {
        const h = harness([starting(), reply(200, { session_id: 'vs_1' })]);
        await expect(h.g.createStreamSession({ mode: 'duplex_speech' })).resolves.toMatchObject({ session_id: 'vs_1' });
    });

    test('gives up after the budget with the original error', async () => {
        const answers = Array.from({ length: 50 }, starting);
        const h = harness(answers);
        await expect(h.g.warmVoice('en_US-kristin-medium')).rejects.toMatchObject({ code: 'backend_warming' });
        const waited = h.slept.reduce((a, b) => a + b, 0);
        expect(waited).toBeLessThanOrEqual(Config.WAKE_BUDGET_MS);
        expect(waited).toBeGreaterThan(30000);
    });

    test('errors waiting cannot fix fail at once', async () => {
        for (const [status, body] of [
            [401, { detail: { error: 'unauthenticated' } }],
            [404, {}],
            [400, { detail: { error: 'invalid_request' } }],
        ]) {
            const h = harness([reply(status, body)]);
            await expect(h.g.voices()).rejects.toBeTruthy();
            expect(h.slept).toEqual([]);
            expect(h.calls.some((c) => c.url.startsWith('https://example-space'))).toBe(false);
        }
    });

    test('Retry-After is honoured within 2–15 s', () => {
        expect(Config.wakeDelay(1, 20)).toBe(15000);
        expect(Config.wakeDelay(1, 1)).toBe(2000);
        expect(Config.wakeDelay(1, 5)).toBe(5000);
        expect(Config.wakeDelay(1)).toBe(3000);
        expect(Config.wakeDelay(9)).toBe(15000);
    });

    test('the page can turn the wake ping off; only https is pinged', () => {
        window.NEXUS_SONIC_VOICE_CONFIG = { wakeUrl: '' };
        expect(Config.wakeUrl()).toBe('');
        delete window.NEXUS_SONIC_VOICE_CONFIG;
        expect(Config.wakeUrl()).toMatch(/^https:\/\/.+\.hf\.space\//);
    });

    test('isWaking covers 502/503/504 and "not up yet" codes only', () => {
        expect(Config.isWaking({ status: 503 })).toBe(true);
        expect(Config.isWaking({ status: 502 })).toBe(true);
        expect(Config.isWaking({ code: 'backend_unavailable' })).toBe(true); // network failure, no status
        expect(Config.isWaking({ status: 401, code: 'unauthenticated' })).toBe(false);
        expect(Config.isWaking({ status: 404, code: 'voice_routes_missing' })).toBe(false);
        expect(Config.isWaking(null)).toBe(false);
    });
});
