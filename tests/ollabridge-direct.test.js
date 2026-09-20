/**
 * OllaBridge stops going through the serverless proxy, and why that is the whole fix.
 *
 * Production symptom: every chat relayed to the user's own PC came back
 * `POST /api/proxy 504 (Gateway Timeout)`, three times per message, while the connection check
 * reported `reach ok`, `auth ok`, `model available ok` and then `FAIL completion … (166060ms)`.
 *
 * Nothing was broken. Three time limits are nested and the innermost was the smallest:
 *
 *     browser → /api/proxy      55s abort inside a 60s function   (api/proxy.js)
 *     gateway → paired device   180s                              (ollama_proxy.py)
 *     device  → local model     45s measured on the reported setup
 *
 * So the proxy gave up first, every time, and the device finished the work and found nobody
 * listening — the gateway logs `Received response for unknown/completed request`. 166 seconds is
 * three 55-second aborts, not three failures.
 *
 * The proxy exists because OpenAI, Claude and Watsonx send no CORS headers. OllaBridge does: a
 * preflight from this app's origin is answered with `access-control-allow-origin`,
 * `access-control-allow-methods: POST` and `access-control-allow-headers: authorization,
 * content-type`. It never needed the proxy, and the proxy was the only thing imposing a deadline
 * a local model cannot meet.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'LLMManager.js'), 'utf8');

/** Load the classic script into a throwaway global, as the browser would. */
function load() {
    const store = new Map();
    const scope = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        },
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        clearTimeout,
        AbortController,
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'AbortController', SOURCE)(
        scope,
        scope.localStorage,
        scope.console,
        setTimeout,
        clearTimeout,
        AbortController
    );
    return scope;
}

/** A manager with the proxy switched on, which is how production is configured. */
function manager({ fetchImpl, proxy = true } = {}) {
    const scope = load();
    const llm = new scope.LLMManager();
    llm.updateSettings({
        provider: 'ollabridge',
        proxy: { enable_proxy: proxy, proxy_url: 'https://example.test/api/proxy' },
        ollabridge: {
            base_url: 'https://app.ollabridge.com',
            auth_mode: 'pairing',
            pair_token: 'tok',
            model: 'llama3:8b',
        },
    });
    scope.fetch = fetchImpl;
    global.fetch = fetchImpl;
    return llm;
}

const ok = (content) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    json: async () => ({ choices: [{ message: { content } }] }),
});

afterEach(() => {
    delete global.fetch;
});

describe('the request that used to die in the proxy', () => {
    test('goes straight to the gateway, even with the proxy enabled', async () => {
        const seen = [];
        const llm = manager({
            fetchImpl: async (url) => {
                seen.push(String(url));
                return ok('hello');
            },
        });

        await llm.sendMessage('hi', 'be brief', []);

        // One call, to the gateway itself. The proxy URL never appears.
        expect(seen).toEqual(['https://app.ollabridge.com/v1/chat/completions']);
        expect(seen.join(' ')).not.toContain('example.test');
    });

    test('and the other providers still use the proxy, because they still need it', async () => {
        // The proxy is not obsolete — OpenAI sends no CORS headers and a browser cannot call it
        // from a page. This fix is about OllaBridge only.
        const seen = [];
        const llm = manager({
            fetchImpl: async (url) => {
                seen.push(String(url));
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
                };
            },
        });
        llm.updateSettings({ provider: 'openai', openai: { api_key: 'sk-test', model: 'gpt-4o-mini' } });

        await llm.sendMessage('hi', 'be brief', []);
        expect(seen[0]).toContain('example.test/api/proxy');
    });
});

describe('when the browser will not allow it', () => {
    test('the first blocked request falls back to the proxy', async () => {
        // A gateway with no CORS, or an http:// gateway from an https:// page. The browser
        // refuses before there is a response, so it surfaces as a thrown TypeError.
        const seen = [];
        const llm = manager({
            fetchImpl: async (url) => {
                seen.push(String(url));
                if (!String(url).includes('example.test')) throw new TypeError('Failed to fetch');
                return ok('via proxy');
            },
        });

        const reply = await llm.sendMessage('hi', 'be brief', []);
        expect(reply).toBe('via proxy');
        expect(seen[0]).toContain('app.ollabridge.com');
        expect(seen[1]).toContain('example.test/api/proxy');
    });

    test('and it is learned once, not re-tested on every message', async () => {
        // The cost of a deployment that needs the proxy should be one failed fetch per session,
        // not one per turn.
        let direct = 0;
        const llm = manager({
            fetchImpl: async (url) => {
                if (!String(url).includes('example.test')) {
                    direct += 1;
                    throw new TypeError('Failed to fetch');
                }
                return ok('via proxy');
            },
        });

        await llm.sendMessage('one', '', []);
        await llm.sendMessage('two', '', []);
        await llm.sendMessage('three', '', []);
        expect(direct).toBe(1);
    });

    test('with no proxy configured a blocked request is reported, not swallowed', async () => {
        const llm = manager({
            proxy: false,
            fetchImpl: async () => {
                throw new TypeError('Failed to fetch');
            },
        });
        await expect(llm.sendMessage('hi', '', [])).rejects.toThrow(/Failed to fetch/);
    });
});

describe('giving up on purpose is not the same as being blocked', () => {
    test('an aborted request is never re-sent through the proxy', async () => {
        // Scene Tale aborts a superseded plan request. Re-sending it through the proxy would
        // hand the provider back the work we just cancelled to free its generation slot.
        const seen = [];
        const controller = new AbortController();
        const llm = manager({
            fetchImpl: async (url, init) => {
                seen.push(String(url));
                controller.abort();
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                throw error;
            },
        });

        await expect(llm.sendMessage('hi', '', [], { signal: controller.signal })).rejects.toThrow();
        // The gateway, once. Never the proxy.
        expect(seen.length).toBe(1);
        expect(seen[0]).toContain('app.ollabridge.com');
    });
});

describe('the deadline that replaces the proxy′s', () => {
    test('a direct request carries a signal, so a silent gateway cannot hang the tab', async () => {
        // Removing the serverless hop removes the only thing upstream that gave up. Without a
        // deadline of our own, a gateway that accepts the connection and says nothing holds the
        // request open for as long as the tab is.
        let signal = null;
        const llm = manager({
            fetchImpl: async (url, init) => {
                signal = init && init.signal;
                return ok('hi');
            },
        });
        await llm.sendMessage('hi', '', []);
        expect(signal).toBeTruthy();
        expect(typeof signal.aborted).toBe('boolean');
    });

    test('and it sits above the gateway′s own relay budget, so its diagnosis wins', () => {
        // The gateway waits 180s for the paired device and then answers with a reason. Ours must
        // not fire first, or the user gets a bare abort instead of "the device did not respond".
        const declared = /OLLABRIDGE_DIRECT_TIMEOUT_MS = (\d+)/.exec(SOURCE);
        expect(declared).not.toBeNull();
        expect(Number(declared[1])).toBeGreaterThan(180000);
    });
});
