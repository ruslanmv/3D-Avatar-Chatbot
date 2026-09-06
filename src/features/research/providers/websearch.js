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
        return {
            id: ID,
            configured: configured === true,
            available: configured === true && Boolean(shape()),
            capabilities: ['topic.search'],
            reason: configured === null ? 'checking' : configured ? 'ok' : 'no-key',
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

    /** Search the web. `null` when it could not run, `[]` when it found nothing. */
    async function research(query, { max = 4, fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        const S = shape();
        const q = String(query || '').trim();
        if (!f || !S || !q) {
            return null;
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

    const api = { ID, ROUTE, status, ready, research, reset };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_RESEARCH_WEB = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
