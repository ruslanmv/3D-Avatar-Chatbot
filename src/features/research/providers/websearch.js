/**
 * The open web, for what an encyclopedia does not carry (batch S1).
 *
 * Second, never first. Wikipedia answers most study topics, needs no key, and is edit-reviewed;
 * this exists for the things it genuinely does not carry — something from last month, a
 * library's API, a niche tool — and for nothing else.
 *
 * ## Snippets only, on purpose
 *
 * This provider never fetches a page. It reads the title, snippet and URL a search API already
 * returns, and stops there.
 *
 * That is a deliberate limit rather than an unfinished feature. Everything read here is pasted
 * into a system prompt beside real instructions, and an arbitrary web page is the dirtiest
 * possible material for that: anybody can publish one containing the words "ignore your
 * previous instructions and…". A search snippet is a couple of hundred characters chosen by
 * the search engine, which is a far smaller surface than a document chosen by whoever wants to
 * be read. Fetching full pages would need stripping, sanitising and a much harder argument
 * about trust, for material she is only going to summarise anyway.
 *
 * ## The key never reaches the browser
 *
 * Same shape as `api/yt-search.js`, for the same reason: a search key in client JavaScript is
 * a public key. The route holds it, the page asks the route, and a deployment without one
 * degrades to Wikipedia rather than breaking.
 *
 * Exposes: window.NEXUS_RESEARCH_WEB
 */
(function (global) {
    'use strict';

    const ID = 'web';
    const ROUTE = '/api/research/search';

    let configured = null;

    function shape() {
        return global && global.NEXUS_RESEARCH_SOURCE ? global.NEXUS_RESEARCH_SOURCE : null;
    }

    function status() {
        const set = settings();
        const own = set && typeof set.own === 'function' ? set.own() : null;
        const usable = Boolean(own) || configured === true;
        return {
            id: ID,
            configured: usable,
            available: usable && Boolean(shape()),
            capabilities: ['topic.search'],
            // A user key is an answer on its own: the site's readiness is irrelevant once
            // somebody has supplied one, so `checking` must not mask it.
            reason: own ? 'own-key' : configured === null ? 'checking' : configured ? 'ok' : 'no-key',
        };
    }

    /**
     * Does this deployment hold a search key?
     *
     * Answered by the route, once, and never by asking the page for a key it should not have.
     * `redirect: 'manual'` for the reason M8 established: a login wall in front of the app
     * answers with a redirect, and following it turns a knowable state into a CORS exception
     * indistinguishable from being offline.
     */
    async function ready({ fetchImpl, force = false } = {}) {
        const set = settings();
        if (set && typeof set.own === 'function' && set.own()) {
            // No need to ask the site whether it has a key when the user has supplied one.
            return status();
        }
        if (configured !== null && !force) {
            return status();
        }
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f) {
            configured = false;
            return status();
        }
        try {
            const r = await f(ROUTE, { redirect: 'manual' });
            if (!r || !r.ok || r.type === 'opaqueredirect') {
                configured = false;
                return status();
            }
            const body = await r.json();
            configured = Boolean(body && body.configured);
        } catch (_) {
            configured = false;
        }
        return status();
    }

    function settings() {
        return (global && global.NEXUS_WEB_SEARCH_SETTINGS) || null;
    }

    /**
     * Search on the user's own key, through their own deployment's proxy.
     *
     * Neither Brave nor Serper sends CORS headers, so this cannot be a direct call however
     * good the key is. The proxy is the same one an OpenAI or Anthropic key already goes
     * through — same deployment, already trusted with those — and both origins are on its
     * allowlist, which is matched by origin rather than by string prefix.
     */
    async function ownSearch(own, query, max, f) {
        const spec = own.spec;
        const proxied = {
            url: spec.url(query, max),
            method: spec.method,
            headers: spec.headers(own.key),
            body: spec.body ? spec.body(query, max) : undefined,
        };
        try {
            const r = await f('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(proxied),
            });
            if (!r || !r.ok) {
                return null;
            }
            const body = await r.json();
            return spec.results(body);
        } catch (_) {
            return null;
        }
    }

    /** Search the web. `null` when it could not run, `[]` when it found nothing. */
    async function research(query, { max = 4, fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        const S = shape();
        const q = String(query || '').trim();
        if (!f || !S || !q) {
            return null;
        }
        // The user's own key wins. Somebody who typed one meant to use it — their quota,
        // their restrictions — and silently preferring the site's would make the field
        // decorative.
        const set = settings();
        const own = set && typeof set.own === 'function' ? set.own() : null;
        if (own) {
            const raw = await ownSearch(own, q, max, f);
            if (raw) {
                return S.many(
                    raw.map((r) => ({ title: r.title, snippet: r.description || r.snippet, url: r.url || r.link })),
                    { source: ID }
                );
            }
            // A key that does not work is worth falling back from, not failing on: the site
            // may still have one, and the person asked a question either way.
        }

        try {
            const r = await f(`${ROUTE}?q=${encodeURIComponent(q)}&max=${encodeURIComponent(max)}`);
            if (!r || !r.ok) {
                return null;
            }
            const body = await r.json();
            return S.many((body && body.results) || [], { source: ID });
        } catch (_) {
            return null;
        }
    }

    /** For tests, and for a page that wants the readiness probe run again. */
    function reset() {
        configured = null;
    }

    const api = { ID, ROUTE, status, ready, research, ownSearch, reset };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_RESEARCH_WEB = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
