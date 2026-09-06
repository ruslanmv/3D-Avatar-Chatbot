/**
 * Finding out where a provider stops working (batch M11).
 *
 * What Test Connection used to say at its most helpful:
 *
 *     ✅ Connected. Reply: [object Object]
 *
 * and at its least:
 *
 *     ❌ Sorry, I encountered an error.
 *
 * Neither is a diagnosis. The first is a success that cannot show what came back; the second
 * is every possible failure — offline, wrong URL, expired token, model not installed, model
 * loaded and silent — wearing one sentence.
 */

const Check = require('../src/features/diagnostics/ConnectionCheck.js');

/** A working provider, as the arguments the check takes. */
const OK = {
    provider: 'ollabridge',
    baseUrl: 'https://app.ollabridge.com',
    model: 'free-best',
    credential: { kind: 'pairing token', required: true, present: true },
    listModels: async () => [{ id: 'free-best' }, { id: 'free-fast' }],
    complete: async () => ({ text: 'OK' }),
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

describe('the reply that could not be read', () => {
    test('a structured answer is no longer "[object Object]"', async () => {
        const out = await Check.run({ ...OK, complete: async () => ({ text: 'OK' }) });
        expect(out.ok).toBe(true);
        expect(out.summary).toContain('OK');
        expect(out.summary).not.toContain('[object Object]');
    });

    test.each([
        ['a plain string', 'OK', 'OK'],
        ['{ text }', { text: 'hello there' }, 'hello there'],
        ['{ content }', { content: 'hi' }, 'hi'],
        ['{ message: { content } }', { message: { content: 'hey' } }, 'hey'],
        ['an OpenAI choice', { choices: [{ message: { content: 'yo' } }] }, 'yo'],
    ])('reads %s', (_name, reply, expected) => {
        expect(Check.textOf(reply)).toBe(expected);
    });

    test('and anything it cannot read is empty, never the word "object"', () => {
        for (const bad of [null, undefined, {}, { choices: [] }, [], 42]) {
            expect(Check.textOf(bad)).not.toMatch(/\[object/);
        }
        expect(Check.textOf(null)).toBe('');
    });
});

describe('it names the stage that failed', () => {
    test('nothing selected', async () => {
        const out = await Check.run({ provider: 'none', model: '' });
        expect(out.failedAt).toBe('config');
        expect(out.summary).toMatch(/provider/);
        expect(out.summary).toMatch(/model/);
    });

    test('a missing credential says which kind', async () => {
        // "Pair this device again" and "enter an API key" are different instructions, and a
        // check that says only "credential missing" leaves the person to work out which.
        const out = await Check.run({
            ...OK,
            credential: { kind: 'pairing token', required: true, present: false },
        });
        expect(out.failedAt).toBe('config');
        expect(out.summary).toMatch(/pairing token/);
    });

    test('the host not answering is reach, not auth', async () => {
        const out = await Check.run({ ...OK, listModels: async () => Promise.reject(new Error('Failed to fetch')) });
        expect(out.failedAt).toBe('reach');
        expect(out.summary).toMatch(/Failed to fetch/);
    });

    test('a rejected credential is auth, and the host is credited with answering', async () => {
        const out = await Check.run({ ...OK, listModels: async () => Promise.reject(httpError(401, 'Unauthorized')) });
        expect(out.failedAt).toBe('auth');
        expect(out.steps.find((s) => s.name === 'reach').ok).toBe(true);
        expect(out.summary).toMatch(/401/);
    });

    test.each([[401], [403]])('HTTP %i is auth even without a helpful message', async (status) => {
        const out = await Check.run({ ...OK, listModels: async () => Promise.reject(httpError(status, '')) });
        expect(out.failedAt).toBe('auth');
    });

    test('a model that is not in the catalog is its own answer', async () => {
        const out = await Check.run({ ...OK, model: 'gpt-9' });
        expect(out.failedAt).toBe('model');
        expect(out.summary).toMatch(/gpt-9/);
    });

    test('a completion that throws is completion', async () => {
        const out = await Check.run({ ...OK, complete: async () => Promise.reject(httpError(502, 'Bad gateway')) });
        expect(out.failedAt).toBe('completion');
        expect(out.summary).toMatch(/502/);
    });

    test('and a model that answers with nothing is its own failure, not a success', async () => {
        // Seen for real: a reasoning model spent its whole budget thinking and returned empty
        // content. Calling that "connected" is how somebody spends an afternoon on the wrong
        // problem.
        const out = await Check.run({ ...OK, complete: async () => ({ text: '   ' }) });
        expect(out.failedAt).toBe('content');
        expect(out.ok).toBe(false);
        expect(out.summary).toMatch(/nothing at all/);
    });
});

describe('it stops at the first failure', () => {
    test('one expired token does not produce three things to fix', async () => {
        const out = await Check.run({ ...OK, listModels: async () => Promise.reject(httpError(401, 'Unauthorized')) });
        expect(out.steps.map((s) => s.name)).toEqual(['config', 'reach', 'auth']);
        expect(out.steps.filter((s) => !s.ok)).toHaveLength(1);
    });

    test('and a completion is never attempted after the host refused', async () => {
        let called = false;
        await Check.run({
            ...OK,
            listModels: async () => Promise.reject(new Error('offline')),
            complete: async () => ((called = true), { text: 'OK' }),
        });
        expect(called).toBe(false);
    });
});

describe('a provider with no catalog to ask for', () => {
    test('is checked as far as it can be, and says so by omission', async () => {
        // Skipping reach/auth/model is honest about having checked less; inventing a result
        // for them would not be.
        const out = await Check.run({ ...OK, listModels: null });
        expect(out.ok).toBe(true);
        expect(out.steps.map((s) => s.name)).toEqual(['config', 'completion', 'content']);
    });

    test('an empty catalog is not treated as a missing model', async () => {
        // A provider that returns no list has not said the model is absent.
        const out = await Check.run({ ...OK, listModels: async () => [] });
        expect(out.ok).toBe(true);
        expect(out.steps.find((s) => s.name === 'model').message).toMatch(/trying anyway/);
    });

    test('and no way to send a prompt is a failure, not a pass', async () => {
        const out = await Check.run({ ...OK, complete: null });
        expect(out.failedAt).toBe('completion');
    });
});

describe('the report is meant to be pasted into a bug thread', () => {
    test('it names every stage with its result and timing', async () => {
        const out = await Check.run(OK);
        expect(out.report).toMatch(/provider\s+ollabridge/);
        expect(out.report).toMatch(/base url\s+https:\/\/app\.ollabridge\.com/);
        expect(out.report).toMatch(/model\s+free-best/);
        for (const stage of ['config', 'reach', 'auth', 'model', 'completion', 'content']) {
            expect(out.report).toContain(stage);
        }
    });

    test('a failure is marked so it can be found by eye', async () => {
        const out = await Check.run({ ...OK, listModels: async () => Promise.reject(new Error('offline')) });
        expect(out.report).toMatch(/FAIL reach/);
    });

    test('it records that a credential exists and never what it is', async () => {
        const out = await Check.run({
            ...OK,
            credential: { kind: 'pairing token', required: true, present: true, value: 'SECRET-TOKEN-VALUE' },
        });
        expect(out.report).toMatch(/pairing token: present/);
        expect(out.report).not.toMatch(/SECRET-TOKEN-VALUE/);
    });

    test('and a provider that returns an essay is truncated rather than pasted whole', () => {
        expect(Check.detail('x'.repeat(5000)).length).toBeLessThanOrEqual(Check.DETAIL_MAX);
    });
});

describe('it never throws, whatever a provider does', () => {
    test.each([
        ['a thrown string', async () => Promise.reject('just a string')],
        ['a thrown null', async () => Promise.reject(null)],
        ['a thrown object', async () => Promise.reject({ weird: true })],
    ])('%s', async (_name, complete) => {
        const out = await Check.run({ ...OK, complete });
        expect(out.ok).toBe(false);
        expect(typeof out.summary).toBe('string');
    });

    test('and a listModels that returns nonsense is not a crash', async () => {
        const out = await Check.run({ ...OK, listModels: async () => 'not an array' });
        expect(typeof out.ok).toBe('boolean');
    });
});

describe('the status is stated once', () => {
    test('a message that already carries it is not prefixed again', () => {
        // "HTTP 401: HTTP 401" reads like a bug in the diagnostic rather than a diagnosis.
        expect(Check.reasonOf(Object.assign(new Error('HTTP 401'), { status: 401 }))).toBe('HTTP 401');
        expect(Check.reasonOf(Object.assign(new Error('401 Unauthorized'), { status: 401 }))).toBe('401 Unauthorized');
    });

    test('and a message without it still gets it', () => {
        expect(Check.reasonOf(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(
            'HTTP 401: Unauthorized'
        );
    });

    test('a status with no message at all still says something', () => {
        expect(Check.reasonOf(Object.assign(new Error(''), { status: 502 }))).toBe('HTTP 502');
    });

    test('and a number inside an unrelated word is not mistaken for the status', () => {
        expect(Check.reasonOf(Object.assign(new Error('model gpt4011 not found'), { status: 401 }))).toMatch(
            /^HTTP 401: /
        );
    });
});
