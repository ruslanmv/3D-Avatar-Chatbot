'use strict';

/**
 * OB3. What a paired avatar may use of the OllaBridge operator's shared AI.
 *
 * OllaBridge Cloud now gates its cloud routes (Free Best and the rest, paid for by the
 * operator) behind an inference grant. The operator grants a customer, and the customer's
 * admin may share it with each member, one level deep. Before this, a missing or used-up
 * grant first showed up as "OllaBridge Error: 403 - {json}" in the middle of a conversation.
 *
 * These tests pin three things:
 *   - the Settings line is derived from GET /account/inference, says nothing for an older
 *     gateway, and never claims more access than the grant gives;
 *   - a refusal from the grant check reads as the gateway's own sentence, while other 401s
 *     and 403s keep their old handling;
 *   - the lookup uses the token chat uses, goes direct like chat, and never throws.
 */

/* global describe, test, expect, beforeEach, afterEach */

require('../src/LLMManager');
const LLMManager = window.LLMManager;
const describeGrant = LLMManager.describeOllaBridgeGrant;

const grant = (over = {}) => ({
    active: true,
    unlimited: false,
    all_aliases: true,
    aliases: [],
    monthly_token_limit: 50000,
    tokens_remaining_this_period: 12000,
    expires_at: null,
    ...over,
});

const answer = (data) => ({ ok: true, status: 200, data });

describe('the Settings line', () => {
    test('an older gateway or a failed lookup shows nothing', () => {
        expect(describeGrant({ ok: false, status: 404 })).toEqual({ state: 'unsupported', text: '' });
        expect(describeGrant({ ok: false, error: 'Failed to fetch' }).text).toBe('');
        expect(describeGrant(null).text).toBe('');
    });

    test('unlimited', () => {
        const v = describeGrant(
            answer({ mode: 'observe', grants: [grant({ unlimited: true, monthly_token_limit: null })] })
        );
        expect(v.state).toBe('unlimited');
        expect(v.text).toBe('Shared AI: unlimited');
    });

    test('limited, with what is left, the routes and the end date', () => {
        const v = describeGrant(
            answer({
                mode: 'enforce',
                grants: [
                    grant({
                        all_aliases: false,
                        aliases: ['free-best', 'free-fast'],
                        expires_at: '2026-12-31T23:59:59+00:00',
                    }),
                ],
            })
        );
        expect(v.state).toBe('limited');
        expect(v.text).toBe(
            'Shared AI: 12,000 of 50,000 tokens left this month · free-best, free-fast · until 2026-12-31'
        );
    });

    test('used up', () => {
        const v = describeGrant(answer({ mode: 'enforce', grants: [grant({ tokens_remaining_this_period: 0 })] }));
        expect(v.state).toBe('exhausted');
        expect(v.text).toMatch(/used up/);
    });

    test('inactive grants do not count, and the line says whether that matters yet', () => {
        const revoked = [grant({ active: false, unlimited: true })];
        expect(describeGrant(answer({ mode: 'enforce', grants: revoked })).state).toBe('none');
        // In observe mode the gateway refuses nothing, so the line must not say "no access".
        const open = describeGrant(answer({ mode: 'observe', grants: revoked }));
        expect(open.state).toBe('open');
        expect(open.text).not.toMatch(/^No shared AI/);
    });

    test('an operator key is full access', () => {
        expect(describeGrant(answer({ mode: 'enforce', principal: { kind: 'system' }, grants: [] })).state).toBe(
            'system'
        );
    });
});

/** A minimal Response with clone(), as fetch returns. */
function response(status, body) {
    const make = () => ({
        ok: status >= 200 && status < 300,
        status,
        clone: make,
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
    return make();
}

describe('a refused chat', () => {
    let mgr;
    beforeEach(() => {
        localStorage.clear();
        mgr = new LLMManager();
    });

    test.each([
        [401, 'sign_in_required', 'Pair this app with your OllaBridge account'],
        [403, 'no_inference_grant', 'Ask your provider or organization admin'],
        [429, 'inference_quota_exceeded', 'monthly token allowance'],
    ])('%i %s reads as the gateway says it', async (status, code, sentence) => {
        const body = { detail: { error: { type: 'inference_grant', code, message: `… ${sentence} …` } } };
        const msg = await mgr._gatewayErrorFor(response(status, body));
        expect(msg).toMatch(/^OllaBridge: /);
        expect(msg).toContain(sentence);
    });

    test('other 401/403 answers keep their old handling', async () => {
        expect(await mgr._gatewayErrorFor(response(401, { detail: 'Invalid API key' }))).toBeNull();
        expect(await mgr._gatewayErrorFor(response(403, { error: 'forbidden' }))).toBeNull();
    });

    test('a 503 still gets its own sentence', async () => {
        const msg = await mgr._gatewayErrorFor(response(503, { detail: { notice: 'every provider is at capacity' } }));
        expect(msg).toBe('every provider is at capacity');
    });
});

describe('the lookup', () => {
    let mgr;
    let seen;
    beforeEach(() => {
        localStorage.clear();
        seen = [];
        mgr = new LLMManager();
        mgr.updateSettings({
            provider: 'ollabridge',
            proxy: { enable_proxy: true, proxy_url: 'https://example.test/api/proxy' },
            ollabridge: { base_url: 'https://app.ollabridge.com/', auth_mode: 'pairing', pair_token: 'tok-pair' },
        });
    });
    afterEach(() => {
        delete global.fetch;
    });

    test('asks the gateway directly with the pairing token', async () => {
        global.fetch = async (url, init) => {
            seen.push({ url: String(url), auth: init.headers.Authorization });
            return { ok: true, status: 200, json: async () => ({ mode: 'observe', grants: [] }) };
        };
        const r = await mgr.getOllaBridgeGrant();
        expect(r.ok).toBe(true);
        expect(seen).toEqual([{ url: 'https://app.ollabridge.com/account/inference', auth: 'Bearer tok-pair' }]);
    });

    test('never throws, and does not ask when unpaired', async () => {
        global.fetch = async () => {
            throw new Error('Failed to fetch');
        };
        expect((await mgr.getOllaBridgeGrant()).ok).toBe(false);

        mgr._settings.ollabridge.pair_token = '';
        global.fetch = async () => {
            throw new Error('should not be called');
        };
        expect(await mgr.getOllaBridgeGrant()).toEqual({ ok: false, error: 'not paired' });
    });

    test('a gateway without the endpoint is a 404, not an error', async () => {
        global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
        const r = await mgr.getOllaBridgeGrant();
        expect(r).toEqual({ ok: false, status: 404, error: 'HTTP 404' });
        expect(describeGrant(r).text).toBe('');
    });
});
