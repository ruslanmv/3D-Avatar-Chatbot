'use strict';

/**
 * K2. Settings ▸ Test Connection tries the provider the form shows, not the one last saved.
 *
 * Reported 2026-11-21: OllaBridge saved, OpenAI picked, a key pasted, Fetch Models, Test
 * Connection → "Failed at completion: OllaBridge is unreachable (HTTP 503)". The test went
 * through the app's LLM manager, which still held the saved provider. main.js now runs the check
 * inside `withSettings(formPatch, …)`; this pins the manager's half: the request goes where the
 * patch says, nothing is written to storage, and the saved settings are back afterwards, even
 * when the test fails. (The page itself: tools/qa/provider-keys-check.mjs.)
 */

/* global describe, test, expect, beforeEach */

let LLMManager;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
        'nexus_llm_settings',
        JSON.stringify({ provider: 'ollabridge', ollabridge: { auth_mode: 'pairing', pair_token: 'paired' } })
    );
    jest.isolateModules(() => {
        require('../src/LLMManager.js');
    });
    LLMManager = window.LLMManager || global.LLMManager;
});

describe('K2. testing a provider nobody has saved yet', () => {
    test('the request goes to the provider the form shows, and nothing is saved', async () => {
        const mgr = new LLMManager();
        expect(mgr.getSettings().provider).toBe('ollabridge');
        const seen = [];
        mgr._chatOpenAI = async () => {
            seen.push(['openai', mgr.getSettings().openai.api_key]);
            return 'OK';
        };
        mgr._chatOllaBridge = async () => {
            seen.push(['ollabridge']);
            throw new Error('OllaBridge is unreachable (HTTP 503)');
        };
        const stored = localStorage.getItem('nexus_llm_settings');
        const reply = await mgr.withSettings(
            { provider: 'openai', openai: { api_key: 'sk-placeholder', model: 'gpt-4o-mini' } },
            () => mgr.sendMessage('Respond with the single word: OK', '', [])
        );
        expect(reply).toBe('OK');
        expect(seen).toEqual([['openai', 'sk-placeholder']]);
        expect(localStorage.getItem('nexus_llm_settings')).toBe(stored);
        expect(mgr.getSettings().provider).toBe('ollabridge');
        expect(mgr.getSettings().ollabridge.pair_token).toBe('paired');
    });

    test('a failing test still gives the saved settings back', async () => {
        const mgr = new LLMManager();
        mgr._chatClaude = async () => {
            throw new Error('Claude Error: 401');
        };
        await expect(
            mgr.withSettings({ provider: 'claude', claude: { api_key: 'sk-ant-x' } }, () =>
                mgr.sendMessage('hi', '', [])
            )
        ).rejects.toThrow('401');
        expect(mgr.getSettings().provider).toBe('ollabridge');
        expect(mgr.getSettings().claude.api_key || '').not.toBe('sk-ant-x');
    });
});
