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
});
