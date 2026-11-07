/**
 * ChatErrorText — one plain sentence for why a reply did not arrive (PG3).
 *
 * Every chat failure used to land as the same bubble: "Sorry, I encountered an error." A
 * revoked pairing token, a gateway that dropped the connection without CORS headers (the
 * browser cannot even read the status then), a 502 page from the edge, a model that took too
 * long — all read identically, and none told the person what to do. LLMManager already knows
 * which one it was; the bubble threw that away.
 *
 * This maps an error to one of a few fixed sentences, each with the next step. It never shows
 * the error's own text: that text can carry a gateway's HTML page, a header or a token, and the
 * chat is not the place for any of them. Unknown failures get no sentence, and the bubble
 * stays as it was. The auth test is ConnectionCheck's own (`looksLikeAuth`), not a second one.
 *
 * Exposes: window.NEXUS_CHAT_ERROR_TEXT
 */
(function (global) {
    'use strict';

    const SENTENCES = Object.freeze({
        auth: 'OllaBridge did not accept this device — pair it again in Settings, then retry.',
        network:
            'I could not reach the AI service — check the connection (or turn on the proxy in Settings), then retry.',
        timeout: 'The model took too long to answer — retry in a moment.',
        gateway: 'The AI gateway is briefly unavailable — retry in a moment.',
        model: 'The chosen model is not available — pick another one in Settings.',
    });

    function textOf(error) {
        if (!error) return '';
        if (typeof error === 'string') return error;
        return String(error.message || error.error || error.name || '');
    }

    /** Which kind of failure this is, or ''. Pure. */
    function kind(error) {
        const status = error && (error.status || error.statusCode);
        const text = textOf(error);
        const check = global && global.NEXUS_CONNECTION_CHECK;
        const auth =
            status === 401 ||
            status === 403 ||
            (check && typeof check.looksLikeAuth === 'function' ? check.looksLikeAuth(error) : false) ||
            /\b(401|403|authentication_required|unauthori[sz]ed|forbidden|no api key or pairing token)\b/i.test(text);
        if (auth) return 'auth';
        if (/no model selected|model_not_found|persona_unpublished|no longer available/i.test(text)) return 'model';
        if (
            status === 504 ||
            /\b504\b|timed out|timeout|AbortError|\babort/i.test(text) ||
            (error && error.name === 'AbortError')
        )
            return 'timeout';
        if (status === 502 || status === 503 || /\b50[23]\b|unreachable/i.test(text)) return 'gateway';
        if (/failed to fetch|networkerror|load failed|network request failed|cannot reach|ERR_|cors/i.test(text))
            return 'network';
        return '';
    }

    /** The sentence to show, or '' for a failure this does not recognise. Pure. */
    function describe(error) {
        return SENTENCES[kind(error)] || '';
    }

    const api = { describe, kind, SENTENCES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CHAT_ERROR_TEXT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
