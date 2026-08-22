'use strict';

/**
 * Upstream allowlist policy — shared by api/proxy.js (Vercel) and
 * nexus-proxy/server.js (local dev).
 *
 * Two classes of bug are covered here, both of which shipped:
 *
 *  1. DRIFT. The two proxies each carried their own copy of the table, and
 *     only the Vercel one learned about *.ollabridge.com. The app worked in
 *     production and returned 403 locally against https://app.ollabridge.com.
 *
 *  2. BYPASS. Matching was done by prefix on the whole URL string, with an
 *     unanchored regex for the wildcard hosts. Since the proxy forwards the
 *     caller's headers, `https://ollabridge.com.evil.net` was an accepted
 *     target that would receive a user's pairing token.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * api/_allowlist.js is plain ESM — it has to be, because both consumers are
 * ESM and a .cjs version forced an interop that is unsafe inside a bundled
 * serverless function. Jest here has no ESM transform, so the module is
 * evaluated in a vm context with its `export {}` statement swapped for an
 * assignment. The module body under test is unchanged.
 */
const { isAllowedUrl, matchesAllowEntry, getAllowlist } = (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_allowlist.js'), 'utf8');
    const sandbox = { process, URL, exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(src.replace(/^export\s*\{([^}]*)\};?\s*$/m, 'exports = { $1 };'), sandbox);
    return sandbox.exports;
})();

describe('proxy allowlist — permitted upstreams', () => {
    const allowed = [
        'https://app.ollabridge.com/v1/chat/completions',
        'https://app.ollabridge.com/pair',
        'https://app.ollabridge.com/pair/info',
        'https://ollabridge.com/v1/models',
        'https://cloud.ollabridge.com/v1/models',
        'https://ruslanmv-ollabridge.hf.space/v1/models',
        'https://api.openai.com/v1/chat/completions',
        'https://api.anthropic.com/v1/messages',
        'https://us-south.ml.cloud.ibm.com/ml/v1/text/generation',
    ];

    test.each(allowed)('allows %s', (url) => {
        expect(isAllowedUrl(url)).toBe(true);
    });

    test('the default OllaBridge gateway is reachable', () => {
        // LLMManager ships https://app.ollabridge.com as the default base_url,
        // so the proxy must accept it or pairing fails out of the box.
        expect(isAllowedUrl('https://app.ollabridge.com/v1/chat/completions')).toBe(true);
    });
});

describe('proxy allowlist — rejected upstreams', () => {
    const blocked = [
        // Suffix attacks: each of these was ALLOWED before the fix.
        'https://ollabridge.com.evil.net/steal',
        'https://api.openai.com.evil.net/steal',
        'https://ruslanmv-ollabridge.hf.space.evil.net/steal',
        'https://api.anthropic.com.attacker.io/x',
        // Not a subdomain — a different registrable domain.
        'https://notollabridge.com/x',
        'https://evil-ollabridge.com.br/x',
        // Unrelated hosts.
        'https://evil.example.com/x',
        'https://169.254.169.254/latest/meta-data/',
        // Wrong scheme: plaintext would expose the bearer token in transit.
        'http://app.ollabridge.com/v1/models',
        'ftp://app.ollabridge.com/x',
        // Malformed / empty.
        '',
        'not a url',
        'https://',
    ];

    test.each(blocked)('blocks %s', (url) => {
        expect(isAllowedUrl(url)).toBe(false);
    });

    test('rejects non-string input without throwing', () => {
        expect(isAllowedUrl(null)).toBe(false);
        expect(isAllowedUrl(undefined)).toBe(false);
        expect(isAllowedUrl({})).toBe(false);
    });
});

describe('matchesAllowEntry', () => {
    test('compares by origin, not string prefix', () => {
        const evil = new URL('https://api.openai.com.evil.net/v1/chat');
        expect(evil.href.startsWith('https://api.openai.com')).toBe(true); // the old test
        expect(matchesAllowEntry(evil, 'https://api.openai.com')).toBe(false); // the new one
    });

    test('a path on the entry constrains the candidate path', () => {
        const entry = 'https://example.com/v1';
        expect(matchesAllowEntry(new URL('https://example.com/v1'), entry)).toBe(true);
        expect(matchesAllowEntry(new URL('https://example.com/v1/chat'), entry)).toBe(true);
        // /v1beta must not satisfy a /v1 entry.
        expect(matchesAllowEntry(new URL('https://example.com/v1beta'), entry)).toBe(false);
        expect(matchesAllowEntry(new URL('https://example.com/other'), entry)).toBe(false);
    });

    test('port is part of the origin', () => {
        expect(matchesAllowEntry(new URL('https://example.com:8443/x'), 'https://example.com')).toBe(false);
    });

    test('ignores an unparseable entry instead of throwing', () => {
        expect(matchesAllowEntry(new URL('https://example.com/x'), 'not a url')).toBe(false);
    });
});

describe('PROXY_ALLOWLIST env extension', () => {
    const original = process.env.PROXY_ALLOWLIST;
    afterEach(() => {
        if (original === undefined) delete process.env.PROXY_ALLOWLIST;
        else process.env.PROXY_ALLOWLIST = original;
    });

    test('adds extra bases without disturbing the built-ins', () => {
        process.env.PROXY_ALLOWLIST = 'https://extra.example.com, https://second.example.com';
        const list = getAllowlist();
        expect(list).toContain('https://extra.example.com');
        expect(list).toContain('https://second.example.com');
        expect(list).toContain('https://api.openai.com');
        expect(isAllowedUrl('https://extra.example.com/v1/chat')).toBe(true);
    });

    test('an env entry does not open its lookalikes', () => {
        process.env.PROXY_ALLOWLIST = 'https://extra.example.com';
        expect(isAllowedUrl('https://extra.example.com.evil.net/x')).toBe(false);
    });
});
