/**
 * Shared upstream allowlist for both request proxies.
 * =====================================================================
 * Two proxies implement the same policy:
 *   - api/proxy.js        → Vercel serverless function (production)
 *   - nexus-proxy/server.js → local dev server (make dev / make start)
 *
 * They used to carry separate copies of this table, and the copies drifted:
 * the Vercel one grew a wildcard for *.ollabridge.com while the local one
 * did not, so pointing the app at https://app.ollabridge.com worked in
 * production and returned 403 locally. This module is the single source of
 * truth so that can't happen again.
 *
 * Plain ESM. package.json declares "type": "module", so both consumers are
 * ESM already — an earlier version of this file was .cjs, which forced an
 * ESM-to-CJS named-import interop for no reason. That resolves fine in plain
 * Node but is the kind of thing that fails inside a bundled serverless
 * function, and a module that fails to import takes the whole endpoint down.
 */

// Upstream API bases that are allowed by exact origin (and path prefix, if
// the entry carries one).
const ALLOW = [
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://iam.cloud.ibm.com',
    'https://us-south.ml.cloud.ibm.com',
    'https://eu-de.ml.cloud.ibm.com',
    'https://ruslanmv-ollabridge.hf.space',
    'https://ollabridge.com',
    'https://cloud.ollabridge.com',
];

/**
 * Trusted hostname patterns, matched against the parsed hostname ONLY and
 * anchored at both ends.
 *
 * Anchoring is the whole point. The previous pattern
 * `/^https:\/\/([a-z-]+\.)*ollabridge\.com/` was applied to the full URL
 * string with no tail anchor, so it also accepted
 * `https://ollabridge.com.evil.net/…`. Since the proxy forwards the caller's
 * headers, that turned this endpoint into an open relay that would hand a
 * user's `Authorization: Bearer <pairing token>` to an attacker's host.
 */
const TRUSTED_HOST_PATTERNS = [
    /^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+\.hf\.space$/, // HuggingFace Spaces
    /^([a-zA-Z0-9_-]+\.)*ollabridge\.com$/, // ollabridge.com and subdomains
];

/**
 * Built-in bases plus any extras from the PROXY_ALLOWLIST env var
 * (comma-separated list of base URLs).
 *
 * @returns {string[]}
 */
function getAllowlist() {
    const extra = (process.env.PROXY_ALLOWLIST || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return [...ALLOW, ...extra];
}

/**
 * Compare a candidate URL against one allowlist entry by ORIGIN, not by
 * string prefix — `'https://api.openai.com.evil.net/x'.startsWith('https://api.openai.com')`
 * is true, which is exactly the bypass this avoids.
 *
 * If the entry carries a path, it also constrains the candidate's path, so
 * a deliberately narrow entry keeps its meaning.
 *
 * @param {URL} candidate - Parsed candidate URL
 * @param {string} entry - Allowlist base URL
 * @returns {boolean}
 */
function matchesAllowEntry(candidate, entry) {
    let base;
    try {
        base = new URL(entry);
    } catch (_) {
        return false;
    }
    if (candidate.origin !== base.origin) return false;

    const basePath = base.pathname.replace(/\/$/, '');
    if (!basePath) return true;
    return candidate.pathname === basePath || candidate.pathname.startsWith(basePath + '/');
}

/**
 * Is this URL an allowed proxy target?
 *
 * Requires https. Callers that additionally permit LAN hosts (the local dev
 * server does, so users can reach OllaBridge or Ollama on their own network)
 * layer that on top of this result rather than inside it — production must
 * never gain that behaviour by accident.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedUrl(url) {
    let candidate;
    try {
        candidate = new URL(String(url || ''));
    } catch (_) {
        return false;
    }
    if (candidate.protocol !== 'https:') return false;

    if (TRUSTED_HOST_PATTERNS.some((re) => re.test(candidate.hostname))) return true;
    if (getAllowlist().some((entry) => matchesAllowEntry(candidate, entry))) return true;
    return false;
}

export { ALLOW, TRUSTED_HOST_PATTERNS, getAllowlist, matchesAllowEntry, isAllowedUrl };
