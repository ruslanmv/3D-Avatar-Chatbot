/**
 * Wikipedia, which needs no key (batch S1).
 *
 * The reason this is the primary source rather than a fallback: `api/rest_v1` and `w/api.php`
 * both serve `access-control-allow-origin: *` and require no credential, so a study session
 * works on a fresh deployment with nothing configured. That matters more than breadth. A
 * feature that cannot be tried until somebody sets up an API key mostly does not get tried,
 * and this codebase already learned that lesson once with YouTube search.
 *
 * It is also the *cleanest* source available. Everything read here still ends up in a prompt,
 * and an encyclopedia with edit review is a far smaller injection surface than an arbitrary
 * web page — which is why the web provider beside this one contributes snippets only.
 *
 * ## Two calls, and why not one
 *
 * `search` answers "which article do you mean" — "quantum entanglement" is unambiguous,
 * "mercury" is three different topics. `summary` then fetches the actual text. Skipping the
 * search and guessing the title works until somebody asks about a word with more than one
 * meaning, and then it teaches them confidently about the wrong thing.
 *
 * Exposes: window.NEXUS_RESEARCH_WIKIPEDIA
 */
(function (global) {
    'use strict';

    const ID = 'wikipedia';
    const REST = 'https://en.wikipedia.org/api/rest_v1';
    const API = 'https://en.wikipedia.org/w/api.php';

    /**
     * Who is asking. Wikimedia's API policy requires this, and enforces it with 429s.
     *
     * Found by running the thing: three topics in a row and the second and third came back
     * `429 You are making too many requests to the API`, which the code was reporting as
     * "could not reach Wikipedia". A browser cannot set `User-Agent`, so Wikimedia accepts
     * `Api-User-Agent` instead — that is the documented path for exactly this case, and it is
     * the difference between being a polite client and an anonymous one they throttle.
     */
    const UA = 'NexusAvatar/1.0 (https://github.com/ruslanmv/3D-Avatar-Chatbot) study-session';

    const HEADERS = { 'Api-User-Agent': UA, Accept: 'application/json' };

    /** Rate limiting is its own answer, not a failure to reach anything. */
    const RATE_LIMITED = 429;

    /** `origin=*` is what makes the action API answer a browser without a proxy. */
    function searchUrl(query, max) {
        const p = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: String(query || ''),
            srlimit: String(Math.max(1, Math.min(Number(max) || 3, 10))),
            format: 'json',
            origin: '*',
        });
        return `${API}?${p.toString()}`;
    }

    function summaryUrl(title) {
        return `${REST}/page/summary/${encodeURIComponent(String(title || '').replace(/ /g, '_'))}`;
    }

    function shape() {
        return global && global.NEXUS_RESEARCH_SOURCE ? global.NEXUS_RESEARCH_SOURCE : null;
    }

    function status() {
        // No key, so the only question is whether the code is present. Reported in the same
        // shape as the discovery providers so one registry can hold both kinds.
        return {
            id: ID,
            configured: true,
            available: Boolean(shape()),
            capabilities: ['topic.search', 'topic.read'],
            reason: shape() ? 'ok' : 'not-loaded',
        };
    }

    /** Candidate articles for an ambiguous phrase. `[]` when nothing matched, `null` on error. */
    async function search(query, { max = 3, fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        const q = String(query || '').trim();
        if (!f || !q) {
            return null;
        }
        try {
            const r = await f(searchUrl(q, max), { headers: HEADERS });
            if (!r || !r.ok) {
                // 429 means "ask again shortly", not "this does not exist". The caller
                // escalates either way, but only one of them is worth saying out loud.
                return r && r.status === RATE_LIMITED ? { rateLimited: true } : null;
            }
            const body = await r.json();
            const hits = (body && body.query && body.query.search) || [];
            return hits.map((h) => ({
                title: h.title,
                // The API returns the snippet with `<span class="searchmatch">` in it.
                snippet: String(h.snippet || '').replace(/<[^>]*>/g, ''),
            }));
        } catch (_) {
            return null;
        }
    }

    /** The article itself, as a `ResearchSource`. `null` when there is no such page. */
    async function read(title, { fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        const S = shape();
        if (!f || !S || !String(title || '').trim()) {
            return null;
        }
        try {
            const r = await f(summaryUrl(title), { headers: HEADERS });
            if (!r || !r.ok) {
                return null;
            }
            const body = await r.json();
            // A disambiguation page is not an article. Teaching from one produces a lecture
            // about the existence of several unrelated topics.
            if (!body || body.type === 'disambiguation' || !body.extract) {
                return null;
            }
            return S.one(
                {
                    id: body.title,
                    title: body.title,
                    description: body.description,
                    extract: body.extract,
                    url: (body.content_urls && body.content_urls.desktop && body.content_urls.desktop.page) || '',
                },
                { source: ID }
            );
        } catch (_) {
            return null;
        }
    }

    /**
     * Search, then read the best match. The one call the study loop makes.
     *
     * Returns `[]` rather than `null` for "nothing found", so a caller can tell an empty
     * subject from a source that could not be reached.
     */
    async function research(query, options = {}) {
        // Read first, search only if that misses.
        //
        // Found by running it. Wikimedia throttles the two endpoints very differently: with
        // this sandbox's IP rate-limited, `page/summary` still answered 200 while every call
        // to the search API came back 429. Search is the expensive one, and most study topics
        // are already the title of an article — "quantum entanglement" resolves directly, and
        // the summary endpoint follows redirects and normalises case for free.
        //
        // So the common case is now one cheap call instead of two, and the throttled one is
        // reached only for the topics that actually need disambiguating. "Mercury" comes back
        // as a disambiguation page, `read` rejects it, and the search below earns its keep.
        const direct = await read(query, options);
        if (direct) {
            return [direct];
        }

        const hits = await search(query, options);
        if (hits === null) {
            return null;
        }
        if (hits && hits.rateLimited) {
            return { rateLimited: true };
        }
        if (!hits.length) {
            return [];
        }
        const article = await read(hits[0].title, options);
        return article ? [article] : [];
    }

    const api = { ID, UA, HEADERS, RATE_LIMITED, status, search, read, research, searchUrl, summaryUrl };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_RESEARCH_WIKIPEDIA = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
