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
 * Exposes: window.NEXUS_RESEARCH_WEB
 */
(function (global) {
    'use strict';

    const ID = 'web';
    const ROUTE = '/api/research/search';

    let configured = null;
    let configuredProvider = '';

    function shape() {
        return global && global.NEXUS_RESEARCH_SOURCE ? global.NEXUS_RESEARCH_SOURCE : null;
    }

    function settings() {
        return (global && global.NEXUS_WEB_SEARCH_SETTINGS) || null;
    }

    function isDisabled() {
        const set = settings();
        return Boolean(set && typeof set.disabled === 'function' && set.disabled());
    }

    function status() {
        const set = settings();
        if (isDisabled()) {
            return {
                id: ID,
                configured: false,
                available: false,
                capabilities: ['topic.search'],
                reason: 'disabled',
                provider: '',
            };
        }
        const own = set && typeof set.own === 'function' ? set.own() : null;
        const usable = Boolean(own) || configured === true;
        return {
            id: ID,
            configured: usable,
            available: usable && Boolean(shape()),
            capabilities: ['topic.search'],
            reason: own ? 'own-key' : configured === null ? 'checking' : configured ? 'deployment' : 'no-key',
            provider: own ? own.id : configuredProvider,
        };
    }

    const DEADLINE_MS = 8000;

    function within(f, url, init, ms = DEADLINE_MS) {
        let timer = null;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const request = f(url, controller ? { ...init, signal: controller.signal } : init);
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => {
                try {
                    if (controller) controller.abort();
                } catch (_) {}
                resolve(null);
            }, ms);
        });
        return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
    }

    async function ready({ fetchImpl, force = false } = {}) {
        if (isDisabled()) return status();
        const set = settings();
        if (set && typeof set.own === 'function' && set.own()) return status();
        if (configured !== null && !force) return status();
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f) {
            configured = false;
            configuredProvider = '';
            return status();
        }
        try {
            const r = await within(f, ROUTE, { redirect: 'manual', cache: 'no-store' });
            if (!r || !r.ok || r.type === 'opaqueredirect') {
                configured = false;
                configuredProvider = '';
                return status();
            }
            const body = await r.json();
            configured = Boolean(body && body.configured);
            configuredProvider = configured ? String((body && body.provider) || '') : '';
        } catch (_) {
            configured = false;
            configuredProvider = '';
        }
        return status();
    }

    async function ownSearch(own, query, max, f) {
        const spec = own.spec;
        const proxied = {
            url: spec.url(query, max),
            method: spec.method,
            headers: spec.headers(own.key),
            body: spec.body ? spec.body(query, max) : undefined,
        };
        try {
            const r = await within(f, '/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(proxied),
            });
            if (!r || !r.ok) return null;
            const body = await r.json();
            return spec.results(body);
        } catch (_) {
            return null;
        }
    }

    function metadataOf(result, index) {
        const profile = result && result.profile && typeof result.profile === 'object' ? result.profile : null;
        return {
            title: result && result.title,
            snippet: result && (result.description || result.snippet),
            url: result && (result.url || result.link),
            siteName: result && (result.siteName || result.source || (profile && profile.long_name)),
            published: result && (result.published || result.date || result.age || result.page_age),
            rank: result && (result.rank || result.position || index + 1),
        };
    }

    /** Search the web. `null` when it could not run, `[]` when it found nothing. */
    async function research(query, { max = 4, fetchImpl } = {}) {
        if (isDisabled()) return null;
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        const S = shape();
        const q = String(query || '').trim();
        if (!f || !S || !q) return null;

        const set = settings();
        const own = set && typeof set.own === 'function' ? set.own() : null;
        if (own) {
            const raw = await ownSearch(own, q, max, f);
            if (raw) return S.many(raw.map(metadataOf), { source: ID });
            // Preserve the shipped resilience rule: a temporary/bad personal web-search key
            // may fall back to the deployment route so a current-information question can
            // still be answered. Image-provider own-key modes remain strict because those
            // selectors explicitly choose quota/provider behavior for the requested media.
        }

        try {
            const r = await within(f, `${ROUTE}?q=${encodeURIComponent(q)}&max=${encodeURIComponent(max)}`);
            if (!r || !r.ok) return null;
            const body = await r.json();
            return S.many((body && body.results) || [], { source: ID });
        } catch (_) {
            return null;
        }
    }

    function reset() {
        configured = null;
        configuredProvider = '';
    }

    const api = { ID, ROUTE, status, ready, research, ownSearch, reset };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_RESEARCH_WEB = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
