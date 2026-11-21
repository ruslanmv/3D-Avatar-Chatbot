/**
 * MC1. The models offered are the provider's own, newest first, never a typed list; a saved
 * model the provider no longer offers gives way to the newest one.
 */
let LLMManager;
beforeAll(() => {
    require('../src/LLMManager.js');
    LLMManager = window.LLMManager;
});

describe('MC1. chat models from the provider, newest first', () => {
    const openai = {
        data: [
            { id: 'gpt-3.5-turbo', created: 1 },
            { id: 'gpt-4o', created: 100 },
            { id: 'gpt-5', created: 300 },
            { id: 'gpt-5-2025-08-07', created: 300 },
            { id: 'gpt-4o-audio-preview', created: 200 },
            { id: 'gpt-4o-realtime-preview', created: 210 },
            { id: 'gpt-4o-mini-tts', created: 220 },
            { id: 'o3', created: 250 },
            { id: 'text-embedding-3-large', created: 400 },
            { id: 'gpt-image-1', created: 350 },
            { id: 'dall-e-3', created: 360 },
            { id: 'whisper-1', created: 5 },
            { id: 'gpt-live-1.1', created: 900 },
            { id: 'gpt-5.5-pro', created: 800 },
            { id: 'gpt-5.5-pro-2026-04-23', created: 800 },
            { id: 'gpt-5.3-codex', created: 700 },
        ],
    };

    test('OpenAI: chat models only, the retired 3.5 family out, newest first, snapshots last', () => {
        const { models } = LLMManager.chatModels('openai', openai);
        expect(models).toEqual(['gpt-5', 'o3', 'gpt-4o', 'gpt-5-2025-08-07']);
    });

    test('Claude: its own list by creation date, with display names', () => {
        const { models, names } = LLMManager.chatModels('claude', {
            data: [
                {
                    id: 'claude-3-5-sonnet-20241022',
                    created_at: '2024-10-22T00:00:00Z',
                    display_name: 'Claude Sonnet 3.5',
                },
                { id: 'claude-opus-4-1', created_at: '2025-08-05T00:00:00Z', display_name: 'Claude Opus 4.1' },
                { id: 'claude-sonnet-4-5', created_at: '2025-09-29T00:00:00Z', display_name: 'Claude Sonnet 4.5' },
            ],
        });
        expect(models.slice(0, 2)).toEqual(['claude-sonnet-4-5', 'claude-opus-4-1']);
        expect(models.at(-1)).toBe('claude-3-5-sonnet-20241022');
        expect(names['claude-sonnet-4-5']).toBe('Claude Sonnet 4.5');
    });

    test('a saved model is kept while offered, replaced by the newest when it is gone', () => {
        expect(LLMManager.pickModel('gpt-4o', ['gpt-5', 'gpt-4o'])).toBe('gpt-4o');
        expect(LLMManager.pickModel('gpt-3.5-turbo', ['gpt-5', 'gpt-4o'])).toBe('gpt-5');
        expect(LLMManager.pickModel('', ['gpt-5'])).toBe('gpt-5');
        expect(LLMManager.pickModel('gpt-4o', [])).toBe('gpt-4o');
    });

    test('no model list is typed into the manager any more', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../src/LLMManager.js'), 'utf8');
        const fetchers = src.slice(src.indexOf('async _fetchOpenAIModels'), src.indexOf('async _fetchWatsonxModels'));
        expect(fetchers).not.toMatch(/'gpt-3\.5-turbo'|'o1-preview'|'claude-3-5-sonnet-latest'/);
    });

    test('a message to a retired model switches to the newest once, saves it, and is sent again', async () => {
        localStorage.clear();
        const m = new LLMManager();
        m.updateSettings({ provider: 'openai', openai: { api_key: 'sk-test', model: 'gpt-3.5-turbo' } });
        m.fetchAvailableModels = async () => ({ models: ['gpt-5', 'gpt-4o'], error: null });
        let calls = 0;
        const seen = [];
        m._chatOpenAI = async () => {
            calls += 1;
            seen.push(m.getSettings().openai.model);
            if (m.getSettings().openai.model === 'gpt-3.5-turbo')
                throw new Error(
                    'OpenAI Error: 404 - {"error":{"code":"model_not_found","message":"The model `gpt-3.5-turbo` has been deprecated"}}'
                );
            return 'ciao';
        };
        await expect(m.sendMessage('hi', '', [])).resolves.toBe('ciao');
        expect(seen).toEqual(['gpt-3.5-turbo', 'gpt-5']);
        expect(m.getSettings().openai.model).toBe('gpt-5');
        // Any other failure is not retried.
        m._chatOpenAI = async () => {
            throw new Error('OpenAI Error: 401 - invalid api key');
        };
        await expect(m.sendMessage('hi', '', [])).rejects.toThrow(/401/);
        expect(calls).toBe(2);
    });

    test('a name the filter could not judge is skipped on its own refusal; the next newest answers', async () => {
        localStorage.clear();
        const m = new LLMManager();
        m.updateSettings({ provider: 'openai', openai: { api_key: 'sk-test', model: 'gpt-3.5-turbo' } });
        m.fetchAvailableModels = async () => ({ models: ['gpt-odd-1', 'gpt-6.2-sol', 'gpt-5.5'], error: null });
        const seen = [];
        m._chatOpenAI = async () => {
            const model = m.getSettings().openai.model;
            seen.push(model);
            if (model === 'gpt-3.5-turbo') throw new Error('404 model_not_found');
            if (model === 'gpt-odd-1') throw new Error('404 This is not a chat model');
            return 'hello';
        };
        await expect(m.sendMessage('hello world', '', [])).resolves.toBe('hello');
        expect(seen).toEqual(['gpt-3.5-turbo', 'gpt-odd-1', 'gpt-6.2-sol']);
        expect(m.getSettings().openai.model).toBe('gpt-6.2-sol');
    });

    test('OpenAI is sent max_completion_tokens; another OpenAI-compatible server keeps max_tokens', async () => {
        const sent = [];
        const real = global.fetch;
        global.fetch = async (url, init) => {
            sent.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) };
        };
        try {
            for (const base_url of ['', 'http://127.0.0.1:1234']) {
                const m = new LLMManager();
                m._hasProxy = () => false;
                m.updateSettings({
                    provider: 'openai',
                    openai: { api_key: 'sk-test', model: 'gpt-6.2-sol', base_url },
                });
                await m.sendMessage('hello world', '', []);
            }
        } finally {
            global.fetch = real;
        }
        expect(sent[0].body.max_completion_tokens).toBeGreaterThan(0);
        expect(sent[0].body.max_tokens).toBeUndefined();
        expect(sent[1].body.max_tokens).toBeGreaterThan(0);
        expect(sent[1].body.max_completion_tokens).toBeUndefined();
    });
});
