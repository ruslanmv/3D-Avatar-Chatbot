/**
 * BridgeDiscovery — finding HomePilot without asking the user where it is (B35).
 *
 * The rule this file defends: **absence means no.** Every OllaBridge deployed today answers
 * `/health` without an `avatar` block, and every one of them must read as "cannot relay the
 * session" rather than as an error, a retry, or a crash. That is the whole version
 * negotiation, and it only works if the absent case is the well-tested one.
 *
 * The second rule: this module reports, it does not act. No socket, no storage write, no
 * retry loop. `boot.js` decides, and a typed URL still wins — which is asserted next door in
 * session-adapter.test.js, because that is where the decision lives.
 */

/* global describe, test, expect */

const Discovery = require('../../src/behavior/adapters/BridgeDiscovery.js');

/** A localStorage holding one `nexus_llm_settings` blob. */
const storeWith = (ollabridge) => ({
    getItem: (key) => (key === Discovery.LLM_SETTINGS_KEY ? JSON.stringify({ ollabridge }) : null),
});

/** A fetch that answers `/health` with `body`, and records what it was asked. */
function fakeFetch(body, { ok = true, calls = [] } = {}) {
    const fn = async (url, init) => {
        calls.push({ url, init });
        return { ok, json: async () => body };
    };
    fn.calls = calls;
    return fn;
}

const HEALTHY = {
    status: 'ok',
    homepilot_enabled: true,
    avatar: { session: '/v1/avatar/session', features: ['directives', 'curiosity'] },
};

// ── reading the bridge the chat client already uses ──────────────────────────

describe('it reads the bridge the user already linked', () => {
    test('base URL and pair token come out of the chat client settings', () => {
        const found = Discovery.bridgeSettings(
            storeWith({ base_url: 'https://app.ollabridge.com/', auth_mode: 'pair', pair_token: 'tok' })
        );
        expect(found).toEqual({ base: 'https://app.ollabridge.com', auth: 'tok' });
    });

    test('an api key is used when that is the mode', () => {
        const found = Discovery.bridgeSettings(
            storeWith({ base_url: 'http://localhost:11435', auth_mode: 'key', api_key: 'sk-x' })
        );
        expect(found.auth).toBe('sk-x');
    });

    test('a mode naming an empty field falls through to the one that is filled', () => {
        // `auth_mode` is an intent. An intent with nothing behind it is not a credential, and
        // sending '' is how the old direct path failed — the server rejects an empty token.
        const found = Discovery.bridgeSettings(
            storeWith({ base_url: 'http://localhost:11435', auth_mode: 'pair', pair_token: '', api_key: 'sk-y' })
        );
        expect(found.auth).toBe('sk-y');
    });

    test('no bridge configured is null, not a throw', () => {
        expect(Discovery.bridgeSettings(storeWith({ base_url: '' }))).toBeNull();
        expect(Discovery.bridgeSettings({ getItem: () => null })).toBeNull();
    });

    test('a corrupt settings blob is not a bridge', () => {
        expect(Discovery.bridgeSettings({ getItem: () => '{not json' })).toBeNull();
    });

    test('storage that throws is not a bridge either', () => {
        expect(
            Discovery.bridgeSettings({
                getItem() {
                    throw new Error('disabled');
                },
            })
        ).toBeNull();
    });

    test('`null` storage means there is none — it does not go looking for a global', () => {
        // The sentinel this codebase uses everywhere: `undefined` is "find it yourself",
        // `null` is "there isn't one". Conflating them is how a unit test passes against a
        // jsdom global that production does not have.
        expect(Discovery.bridgeSettings(null)).toBeNull();
    });
});

// ── the URL it builds ────────────────────────────────────────────────────────

describe('the session URL follows the bridge, not a guess', () => {
    test('https becomes wss and http becomes ws', () => {
        expect(Discovery.toWebSocket('https://a/b')).toBe('wss://a/b');
        expect(Discovery.toWebSocket('http://a/b')).toBe('ws://a/b');
    });

    test('a relative path is resolved against the origin the client just called', () => {
        // The bridge answers with a path because it does not always know how it is reached —
        // behind a reverse proxy or a tunnel its own hostname is not the client's. The client
        // knows, because it just called it.
        expect(Discovery.sessionUrlFrom('https://app.ollabridge.com', '/v1/avatar/session')).toBe(
            'wss://app.ollabridge.com/v1/avatar/session'
        );
        expect(Discovery.sessionUrlFrom('http://localhost:11435', 'v1/avatar/session')).toBe(
            'ws://localhost:11435/v1/avatar/session'
        );
    });

    test('an absolute answer is honoured as given', () => {
        expect(Discovery.sessionUrlFrom('https://x', 'wss://elsewhere/s')).toBe('wss://elsewhere/s');
        expect(Discovery.sessionUrlFrom('https://x', 'https://elsewhere/s')).toBe('wss://elsewhere/s');
    });

    test('an empty path is no URL at all', () => {
        expect(Discovery.sessionUrlFrom('https://x', '')).toBeNull();
        expect(Discovery.sessionUrlFrom('https://x', null)).toBeNull();
    });
});

// ── what /health is allowed to mean ──────────────────────────────────────────

describe('absence means no', () => {
    const ollabridge = { base_url: 'https://app.ollabridge.com', auth_mode: 'pair', pair_token: 'tok' };

    test('a bridge with HomePilot and the block is available', async () => {
        const found = await Discovery.discover({ storage: storeWith(ollabridge), fetch: fakeFetch(HEALTHY) });
        expect(found).toEqual({
            available: true,
            reason: 'ok',
            base: 'https://app.ollabridge.com',
            sessionUrl: 'wss://app.ollabridge.com/v1/avatar/session',
            auth: 'tok',
            features: ['directives', 'curiosity'],
        });
    });

    test('it asks /health and nothing else', async () => {
        const calls = [];
        await Discovery.discover({ storage: storeWith(ollabridge), fetch: fakeFetch(HEALTHY, { calls }) });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://app.ollabridge.com/health');
        expect(calls[0].init.method).toBe('GET');
    });

    test("today's OllaBridge — HomePilot on, no avatar block — is `bridge-too-old`", async () => {
        // The case that must not be an error: this is every deployed bridge. The chat path
        // still carries directives, so she still moves; she just cannot speak first.
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: fakeFetch({ status: 'ok', homepilot_enabled: true }),
        });
        expect(found.available).toBe(false);
        expect(found.reason).toBe('bridge-too-old');
        expect(found.base).toBe('https://app.ollabridge.com');
    });

    test('a bridge without HomePilot says so distinctly', async () => {
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: fakeFetch({ status: 'ok', homepilot_enabled: false }),
        });
        expect(found.reason).toBe('no-homepilot');
    });

    test('an avatar block with no session path is still too old', async () => {
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: fakeFetch({ homepilot_enabled: true, avatar: { features: ['directives'] } }),
        });
        expect(found.reason).toBe('bridge-too-old');
    });

    test('no bridge configured never makes a request', async () => {
        const calls = [];
        const found = await Discovery.discover({
            storage: { getItem: () => null },
            fetch: fakeFetch(HEALTHY, { calls }),
        });
        expect(calls).toEqual([]);
        expect(found.reason).toBe('no-bridge');
    });
});

// ── failure is an answer, not an exception ───────────────────────────────────

describe('it never throws on a boot path', () => {
    const ollabridge = { base_url: 'https://app.ollabridge.com', api_key: 'k' };

    test('a bridge that is down is `bridge-unreachable`', async () => {
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: async () => {
                throw new Error('ECONNREFUSED');
            },
        });
        expect(found.available).toBe(false);
        expect(found.reason).toBe('bridge-unreachable');
    });

    test('a non-200 is the same answer', async () => {
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: fakeFetch({}, { ok: false }),
        });
        expect(found.reason).toBe('bridge-unreachable');
    });

    test('a body that is not JSON is the same answer', async () => {
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: async () => ({
                ok: true,
                json: async () => {
                    throw new Error('not json');
                },
            }),
        });
        expect(found.reason).toBe('bridge-unreachable');
    });

    test('a bridge that never answers gives up rather than hanging the boot', async () => {
        // fetch's own default on a hung connection is measured in minutes. A boot path may
        // not wait that long to conclude "no".
        const found = await Discovery.discover({
            storage: storeWith(ollabridge),
            fetch: () => new Promise(() => {}),
            timeoutMs: 20,
        });
        expect(found.reason).toBe('bridge-unreachable');
    });

    test('a page with no fetch at all says so instead of crashing', async () => {
        const found = await Discovery.discover({ storage: storeWith(ollabridge), fetch: null });
        expect(found.reason).toBe('no-fetch');
    });
});

// ── it reports; it does not act ──────────────────────────────────────────────

describe('the module is inert by construction', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src/behavior/adapters/BridgeDiscovery.js'),
        'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // `toWebSocket` is a string rewrite, so the forbidden thing is the constructor, not the
    // word. A check on the word would have to be relaxed the first time a helper is named
    // after what it builds a URL for — and a relaxed check is one nobody trusts.
    test.each([['new WebSocket'], ['setItem('], ['setInterval('], ['EventSource']])(
        'it never names %s',
        (forbidden) => {
            expect(`${forbidden}: ${code.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    );

    test('and the only timer it holds is the one that gives up', () => {
        expect(code.match(/setTimeout/g) || []).toHaveLength(1);
    });
});
