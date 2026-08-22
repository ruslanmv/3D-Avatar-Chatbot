'use strict';

/**
 * Pairing state is remembered, and is visible.
 *
 * The device token always persisted — pairWithOllaBridge writes it to
 * `nexus_llm_settings` and every later save preserves it (the settings patch
 * omits pair_token, and _deepMerge keeps what the patch does not mention).
 * Verified by reloading the page: the token was still there.
 *
 * What was missing was any sign of it. Reopening Settings showed an empty
 * "Enter pairing code..." box, which reads as "not paired" — so people paired
 * again every session, burning a fresh single-use code each time.
 *
 * These pin the two halves: the token really does survive a settings save,
 * and the view derived from it flips correctly between paired and unpaired.
 */

/* global describe, test, expect, beforeEach */

// LLMManager.js is an IIFE that assigns to the global, not a module export.
require('../src/LLMManager');
const LLMManager = window.LLMManager;

/** Mirrors _updateOllaBridgePairUI's decision, which is pure. */
function pairView(stored) {
    let token = '';
    let deviceId = '';
    try {
        token = (stored.ollabridge && stored.ollabridge.pair_token) || '';
        deviceId = (stored.ollabridge && stored.ollabridge.device_id) || '';
    } catch (_) {
        /* unreadable storage */
    }
    const paired = !!String(token).trim();
    return {
        pairedBoxVisible: paired,
        codeBoxVisible: !paired,
        deviceLabel: !paired ? '' : deviceId ? 'Device ' + deviceId : 'Token stored on this browser',
    };
}

beforeEach(() => localStorage.clear());

describe('the token survives what the UI does to it', () => {
    test('a settings save does not clobber pair_token or device_id', () => {
        const mgr = new LLMManager();
        mgr.updateSettings({ provider: 'ollabridge' });
        mgr._settings.ollabridge.pair_token = 'tok-abcdefghijklmnop';
        mgr._settings.ollabridge.device_id = 'dev_3HenOnNoaJWl';
        mgr._saveSettings();

        // Exactly the patch saveSettings() builds — note it never mentions
        // pair_token, so the merge must preserve it.
        mgr.updateSettings({
            ollabridge: {
                api_key: '',
                base_url: 'https://app.ollabridge.com',
                model: 'llama3:8b',
                auth_mode: 'pairing',
                use_remote_prompt: true,
            },
        });

        const stored = JSON.parse(localStorage.getItem('nexus_llm_settings'));
        expect(stored.ollabridge.pair_token).toBe('tok-abcdefghijklmnop');
        expect(stored.ollabridge.device_id).toBe('dev_3HenOnNoaJWl');
        expect(stored.ollabridge.model).toBe('llama3:8b');
    });

    test('a fresh manager reads the token back, so a reload stays paired', () => {
        const first = new LLMManager();
        first.updateSettings({ provider: 'ollabridge' });
        first._settings.ollabridge.pair_token = 'tok-abcdefghijklmnop';
        first._saveSettings();

        const afterReload = new LLMManager().getSettings();
        expect(afterReload.ollabridge.pair_token).toBe('tok-abcdefghijklmnop');
    });

    test('unpairing clears both fields and persists the clear', () => {
        const mgr = new LLMManager();
        mgr.updateSettings({ provider: 'ollabridge' });
        mgr._settings.ollabridge.pair_token = 'tok-abcdefghijklmnop';
        mgr._settings.ollabridge.device_id = 'dev_3HenOnNoaJWl';
        mgr._saveSettings();

        mgr.updateSettings({ ollabridge: { pair_token: '', device_id: '' } });

        const stored = JSON.parse(localStorage.getItem('nexus_llm_settings'));
        expect(stored.ollabridge.pair_token).toBe('');
        expect(stored.ollabridge.device_id).toBe('');
        // The gateway URL is a separate preference and must not be lost.
        expect(stored.ollabridge.base_url).toBe('https://app.ollabridge.com');
    });
});

describe('the view derived from the stored token', () => {
    test('never paired → the code box, no device label', () => {
        expect(pairView({})).toEqual({ pairedBoxVisible: false, codeBoxVisible: true, deviceLabel: '' });
    });

    test('paired → the paired box, naming the device', () => {
        const v = pairView({ ollabridge: { pair_token: 'tok-x', device_id: 'dev_3HenOnNoaJWl' } });
        expect(v.pairedBoxVisible).toBe(true);
        expect(v.codeBoxVisible).toBe(false);
        expect(v.deviceLabel).toBe('Device dev_3HenOnNoaJWl');
    });

    test('paired without a device id still reads as paired', () => {
        const v = pairView({ ollabridge: { pair_token: 'tok-x' } });
        expect(v.pairedBoxVisible).toBe(true);
        expect(v.deviceLabel).toBe('Token stored on this browser');
    });

    test('a blank or whitespace token is not paired', () => {
        expect(pairView({ ollabridge: { pair_token: '' } }).pairedBoxVisible).toBe(false);
        expect(pairView({ ollabridge: { pair_token: '   ' } }).pairedBoxVisible).toBe(false);
    });

    test('the device label never contains the token itself', () => {
        const v = pairView({ ollabridge: { pair_token: 'super-secret-token', device_id: 'dev_1' } });
        expect(v.deviceLabel).not.toContain('super-secret-token');
    });
});

describe('Test Connection knows what each provider actually needs', () => {
    /**
     * Mirrors __nexusMissingCredential in main.js.
     *
     * The old check was `!config.apiKey` for every provider. Two of the five
     * do not use an api_key at all: OllaBridge in Device Pairing mode
     * authenticates with a stored pairing token and deliberately leaves
     * api_key empty, and Ollama is local and unauthenticated. So a paired,
     * working OllaBridge setup was told "Enter an API key/token first."
     */
    const missing = (provider, apiKey, stored) => {
        if (provider === 'ollama') return null;
        if (provider === 'ollabridge') {
            const s = stored || {};
            const hasPairToken = !!String(s.pair_token || '').trim();
            const hasKey = !!String(apiKey || s.api_key || '').trim();
            if (hasPairToken || hasKey) return null;
            return s.auth_mode === 'apikey'
                ? 'Enter an OllaBridge API key first.'
                : 'Pair this device first — enter a pairing code above and click Pair.';
        }
        if (!apiKey) return 'Enter an API key/token first.';
        return null;
    };

    test('a paired OllaBridge device is ready with no api_key — the reported bug', () => {
        expect(missing('ollabridge', '', { auth_mode: 'pairing', pair_token: 'tok-x', api_key: '' })).toBeNull();
    });

    test('an unpaired device is told to pair, not to enter a key', () => {
        const msg = missing('ollabridge', '', { auth_mode: 'pairing', pair_token: '', api_key: '' });
        expect(msg).toMatch(/Pair this device first/);
        expect(msg).not.toMatch(/API key/i);
    });

    test('api-key mode asks for a key', () => {
        expect(missing('ollabridge', '', { auth_mode: 'apikey', pair_token: '', api_key: '' })).toBe(
            'Enter an OllaBridge API key first.'
        );
    });

    test('an api_key satisfies OllaBridge even without a pairing token', () => {
        expect(missing('ollabridge', '', { auth_mode: 'apikey', api_key: 'sk-x' })).toBeNull();
    });

    test('a whitespace-only token does not count as paired', () => {
        expect(missing('ollabridge', '', { auth_mode: 'pairing', pair_token: '   ' })).toMatch(/Pair this device/);
    });

    test('Ollama needs no credential at all', () => {
        expect(missing('ollama', '', {})).toBeNull();
    });

    test('the other providers still require a key', () => {
        expect(missing('openai', '', {})).toBe('Enter an API key/token first.');
        expect(missing('claude', '', {})).toBe('Enter an API key/token first.');
        expect(missing('openai', 'sk-test', {})).toBeNull();
    });
});
