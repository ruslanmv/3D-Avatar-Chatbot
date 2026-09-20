/**
 * The app sends the model Settings says it will send.
 *
 * A23 papered over a real bug the wrong way. A fresh install stores `'default'` as a placeholder,
 * and `'default'` is not a route OllaBridge serves — it answers HTTP 200 with an empty completion,
 * which reads downstream as the model having nothing to say. The fix then was to substitute a
 * model name written in this file.
 *
 * That is the wrong shape, and it is the thing being removed here. An application that quietly
 * sends a different model than its Settings screen names has a Settings screen that lies, and
 * nobody looking at a bad answer can tell which model produced it. The placeholder is resolved
 * from *this account's own model list* instead, and written back, so the screen and the wire
 * agree from then on.
 *
 * The gateway is not part of this problem: `ollama_proxy.py` only routes through its
 * multi-provider layer when `registry.is_alias(body.model)` is true, so a concrete name like
 * `huihui_ai/qwen3-abliterated:4b` reaches the paired device unchanged.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'LLMManager.js'), 'utf8');

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

/** A gateway that lists two models and records the chat body it is given. */
function gateway({ models = ['huihui_ai/qwen3-abliterated:4b', 'llama3.2:1b'], listFails = false } = {}) {
    const state = { sent: null, listCalls: 0 };
    const impl = async (url, init) => {
        if (String(url).includes('/v1/models')) {
            state.listCalls += 1;
            if (listFails) return { ok: false, status: 503, text: async () => 'down', json: async () => ({}) };
            const payload = { data: models.map((id) => ({ id })) };
            return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        state.sent = JSON.parse(init.body);
        const reply = { choices: [{ message: { content: 'ok' } }] };
        return { ok: true, status: 200, text: async () => JSON.stringify(reply), json: async () => reply };
    };
    return { state, impl };
}

function manager(scope, model, impl) {
    const llm = new scope.LLMManager();
    llm.updateSettings({
        provider: 'ollabridge',
        ollabridge: { base_url: 'https://app.ollabridge.com', auth_mode: 'pairing', pair_token: 'tok', model },
    });
    scope.fetch = impl;
    global.fetch = impl;
    return llm;
}

afterEach(() => {
    delete global.fetch;
});

describe('a model the user chose', () => {
    test('is the model on the wire, unaltered', async () => {
        const g = gateway();
        const llm = manager(load(), 'huihui_ai/qwen3-abliterated:4b', g.impl);
        await llm.sendMessage('hi', '', []);
        expect(g.state.sent.model).toBe('huihui_ai/qwen3-abliterated:4b');
    });

    test('and choosing a different one changes the wire, with nothing in between', async () => {
        const g = gateway();
        const llm = manager(load(), 'llama3.2:1b', g.impl);
        await llm.sendMessage('hi', '', []);
        expect(g.state.sent.model).toBe('llama3.2:1b');
    });

    test('a chosen model never costs a model-list request', async () => {
        // Resolution is for the placeholder only. A user who has picked something must not pay a
        // round trip per message to be told what they already chose.
        const g = gateway();
        const llm = manager(load(), 'llama3.2:1b', g.impl);
        await llm.sendMessage('one', '', []);
        await llm.sendMessage('two', '', []);
        expect(g.state.listCalls).toBe(0);
    });

    test('no model name is written into this file for the wire to pick up', () => {
        // The regression guard. A23's `OLLABRIDGE_FALLBACK_MODEL` is gone and must not come back:
        // any literal model name here is a model somebody did not choose.
        expect(SOURCE).not.toMatch(/OLLABRIDGE_FALLBACK_MODEL/);
        expect(SOURCE).not.toMatch(/qwen2\.5:1\.5b/);
    });
});

describe('the placeholder a fresh install starts with', () => {
    test('is resolved from this account, not from a name in the source', async () => {
        const g = gateway();
        const llm = manager(load(), 'default', g.impl);
        await llm.sendMessage('hi', '', []);
        expect(g.state.sent.model).toBe('huihui_ai/qwen3-abliterated:4b');
    });

    test('and is written back, so Settings stops saying DEFAULT', async () => {
        // The half that makes the screen honest: after the first message the stored value names
        // the model that is really answering.
        const g = gateway();
        const llm = manager(load(), 'default', g.impl);
        await llm.sendMessage('hi', '', []);
        expect(llm.getSettings().ollabridge.model).toBe('huihui_ai/qwen3-abliterated:4b');
    });

    test('resolved once, not per message', async () => {
        const g = gateway();
        const llm = manager(load(), 'default', g.impl);
        await llm.sendMessage('one', '', []);
        await llm.sendMessage('two', '', []);
        await llm.sendMessage('three', '', []);
        expect(g.state.listCalls).toBe(1);
    });

    test('an empty setting behaves the same as the placeholder', async () => {
        const g = gateway();
        const llm = manager(load(), '', g.impl);
        await llm.sendMessage('hi', '', []);
        expect(g.state.sent.model).toBe('huihui_ai/qwen3-abliterated:4b');
    });
});

describe('when nothing can be resolved', () => {
    test('it says so instead of substituting', async () => {
        // Sending the placeholder anyway produces an empty completion that reads as the model
        // having nothing to say. A named error is the one a person can act on.
        const g = gateway({ listFails: true });
        const llm = manager(load(), 'default', g.impl);
        await expect(llm.sendMessage('hi', '', [])).rejects.toThrow(/no model selected/i);
        expect(g.state.sent).toBeNull();
    });

    test('an empty list is the same case', async () => {
        const g = gateway({ models: [] });
        const llm = manager(load(), 'default', g.impl);
        await expect(llm.sendMessage('hi', '', [])).rejects.toThrow(/Settings/i);
    });

    test('and a later attempt may try again rather than being stuck', async () => {
        // A gateway that was briefly down must not poison the session.
        const scope = load();
        const failing = gateway({ listFails: true });
        const llm = manager(scope, 'default', failing.impl);
        await expect(llm.sendMessage('hi', '', [])).rejects.toThrow();

        const working = gateway();
        scope.fetch = working.impl;
        global.fetch = working.impl;
        await llm.sendMessage('hi again', '', []);
        expect(working.state.sent.model).toBe('huihui_ai/qwen3-abliterated:4b');
    });
});
