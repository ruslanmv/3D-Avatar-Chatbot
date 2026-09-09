/**
 * Persistent conversational web-search state.
 *
 * Once a search has happened, phrases such as "show the results", "the second one",
 * "what about tomorrow?" and "find more like that" need a stable referent. This module keeps
 * the latest normalized search result set for a short conversational window.
 *
 * It stores snippets only. It never fetches arbitrary result pages, preserving the research
 * layer's existing prompt-injection boundary.
 *
 * Exposes: window.NEXUS_SEARCH_SESSION
 */
(function (global) {
    'use strict';

    const STATES = ['idle', 'searching', 'results', 'answering', 'failed'];
    const MAX_RESULTS = 8;
    const TTL_MS = 10 * 60 * 1000;

    let sequence = 0;
    let state = blank();

    function now() {
        return global && global.Date ? global.Date.now() : Date.now();
    }

    function blank() {
        return {
            id: null,
            requestId: 0,
            status: 'idle',
            query: '',
            kind: 'web',
            results: [],
            selectedIndex: null,
            parentQuery: null,
            reason: null,
            createdAt: 0,
            updatedAt: 0,
        };
    }

    function copyResult(result) {
        return result && typeof result === 'object' ? Object.assign({}, result) : null;
    }

    function expire() {
        if (state.id && state.updatedAt && now() - state.updatedAt > TTL_MS) state = blank();
    }

    function snapshot() {
        expire();
        return {
            id: state.id,
            requestId: state.requestId,
            status: state.status,
            query: state.query,
            kind: state.kind,
            results: state.results.map(copyResult).filter(Boolean),
            selectedIndex: state.selectedIndex,
            parentQuery: state.parentQuery,
            reason: state.reason,
            createdAt: state.createdAt,
            updatedAt: state.updatedAt,
        };
    }

    function classify(query) {
        const q = String(query || '').toLowerCase();
        if (/\b(weather|forecast|temperature|rain|snow|wind|humidity|sunrise|sunset)\b/.test(q)) {
            return 'weather';
        }
        if (/\b(news|today|latest|recent|current|now|this week|this month)\b/.test(q)) {
            return 'fresh';
        }
        if (/\b(best|recommend|recommendation|suggest|suggestion|ideas?|options?|where should|what should)\b/.test(q)) {
            return 'suggestion';
        }
        return 'web';
    }

    function begin(query, options = {}) {
        const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        if (!q) return snapshot();
        sequence += 1;
        const stamp = now();
        state = {
            id: `search-${sequence}`,
            requestId: sequence,
            status: 'searching',
            query: q,
            kind: options.kind || classify(q),
            results: [],
            selectedIndex: null,
            parentQuery: options.parentQuery ? String(options.parentQuery).slice(0, 240) : null,
            reason: null,
            createdAt: stamp,
            updatedAt: stamp,
        };
        return snapshot();
    }

    function setResults(requestId, results) {
        if (requestId !== state.requestId) return { stale: true, state: snapshot() };
        state.results = (Array.isArray(results) ? results : []).slice(0, MAX_RESULTS).map(copyResult).filter(Boolean);
        state.selectedIndex = null;
        state.status = state.results.length ? 'results' : 'failed';
        state.reason = state.results.length ? null : 'nothing-found';
        state.updatedAt = now();
        return { stale: false, state: snapshot() };
    }

    function fail(requestId, reason) {
        if (requestId !== state.requestId) return { stale: true, state: snapshot() };
        state.status = 'failed';
        state.reason = String(reason || 'failed');
        state.updatedAt = now();
        return { stale: false, state: snapshot() };
    }

    function markAnswering(requestId) {
        if (requestId === state.requestId && state.results.length) {
            state.status = 'answering';
            state.updatedAt = now();
        }
        return snapshot();
    }

    function markReady(requestId) {
        if (requestId === state.requestId && state.results.length) {
            state.status = 'results';
            state.updatedAt = now();
        }
        return snapshot();
    }

    function selectIndex(index) {
        expire();
        if (!Number.isInteger(index) || index < 0 || index >= state.results.length) return null;
        state.selectedIndex = index;
        state.updatedAt = now();
        return copyResult(state.results[index]);
    }

    function result(index) {
        expire();
        if (!Number.isInteger(index) || index < 0 || index >= state.results.length) return null;
        return copyResult(state.results[index]);
    }

    function active() {
        expire();
        return Boolean(state.id && state.results.length && state.status !== 'failed');
    }

    function isCurrent(requestId) {
        expire();
        return requestId === state.requestId;
    }

    function suggestions() {
        expire();
        if (!active()) return [];
        if (state.kind === 'weather') return ['tomorrow', 'this weekend', 'hourly forecast'];
        if (state.kind === 'suggestion') return ['show more options', 'compare the top results', 'narrow the suggestions'];
        if (state.kind === 'fresh') return ['latest updates', 'show the sources', 'search for more recent results'];
        return ['show the results', 'tell me about the first result', 'search for related results'];
    }

    function clear() {
        state = blank();
        return snapshot();
    }

    function appendScript(src, marker, onload) {
        try {
            if (!global || !global.document) return false;
            if (global.document.querySelector(`script[${marker}]`)) {
                if (typeof onload === 'function') onload();
                return true;
            }
            const script = global.document.createElement('script');
            script.src = src;
            script.async = false;
            script.setAttribute(marker, '1');
            if (typeof onload === 'function') script.onload = onload;
            global.document.head.appendChild(script);
            return true;
        } catch (_) {
            return false;
        }
    }

    function ensureSearchQuality() {
        if (!global || global.NEXUS_SEARCH_QUALITY) return;
        appendScript('src/features/research/SearchQuality.js', 'data-nexus-search-quality');
    }

    function ensureSearchUX() {
        try {
            if (!global || !global.document) return;
            if (global.NEXUS_SEARCH_UX) {
                ensureSearchQuality();
                return;
            }
            if (global.document.querySelector('script[data-nexus-search-ux]')) {
                // SearchUX may still be evaluating; SearchQuality retries installation itself.
                if (typeof global.setTimeout === 'function') global.setTimeout(ensureSearchQuality, 25);
                return;
            }
            appendScript('src/features/research/SearchUX.js', 'data-nexus-search-ux', ensureSearchQuality);
        } catch (_) {
            /* Search state still works even when the optional presentation layer cannot load. */
        }
    }

    const api = {
        STATES,
        MAX_RESULTS,
        TTL_MS,
        classify,
        begin,
        setResults,
        fail,
        markAnswering,
        markReady,
        selectIndex,
        result,
        active,
        isCurrent,
        suggestions,
        get: snapshot,
        clear,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_SEARCH_SESSION = api;
        if (typeof global.setTimeout === 'function') global.setTimeout(ensureSearchUX, 0);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
