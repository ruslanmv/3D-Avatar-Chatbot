/**
 * LT8. One failed poll is not a failed job: a transient error while waiting (network
 * TypeError, 5xx, 429) is retried; a real answer still ends the wait.
 */
const WardrobeClient = require('../../src/wardrobe/WardrobeClient.js');
const Client = WardrobeClient.WardrobeClient || WardrobeClient;

function client(responses) {
    let i = 0;
    const fetchImpl = async () => {
        const r = responses[Math.min(i++, responses.length - 1)];
        if (r === 'network') throw new TypeError('Failed to fetch');
        return { ok: r.status === 200, status: r.status, json: async () => r.body || {} };
    };
    return {
        c: new Client({ baseUrl: 'https://forge.test', fetchImpl, pollIntervalMs: 1, timeoutMs: 10000 }),
        calls: () => i,
    };
}

describe('LT8: waitForJob survives a transient poll failure', () => {
    test('a network error and a 502 mid-job are retried, and the finished job is returned', async () => {
        const { c, calls } = client([
            { status: 200, body: { state: 'running' } },
            'network',
            { status: 502 },
            { status: 200, body: { state: 'completed', id: 'j' } },
        ]);
        const job = await c.waitForJob('j');
        expect(job.state).toBe('completed');
        expect(calls()).toBe(4);
    });

    test('a 404 is an answer, not a hiccup: it ends the wait', async () => {
        const { c } = client([{ status: 404, body: { detail: { message: 'no such job' } } }]);
        await expect(c.waitForJob('j')).rejects.toThrow(/no such job/);
    });

    test('a Forge that keeps failing still gives up', async () => {
        const { c } = client(['network']);
        await expect(c.waitForJob('j')).rejects.toThrow(/Failed to fetch/);
    });
});
