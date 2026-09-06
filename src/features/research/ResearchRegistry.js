/**
 * Wikipedia first, the web only when it is genuinely not there (batch S1).
 *
 * Not "ask both and merge". Escalation, in order, for three reasons that all point the same
 * way:
 *
 *   **Quality.** An encyclopedia article is written to explain a topic. A search snippet is
 *   written to make you click. For teaching, the first is better material, and blending them
 *   would let the second dilute the first on every topic rather than only the ones that need it.
 *
 *   **Safety.** Everything read ends up in a prompt. Wikipedia is edit-reviewed; the open web
 *   is anyone with a domain. Reaching for the dirtier source only when the clean one has
 *   nothing keeps that exposure to the topics that actually require it.
 *
 *   **Cost.** Wikipedia is free and keyless. A search API is neither.
 *
 * ## What "not there" means
 *
 * Three things, and they are different:
 *
 *   - Wikipedia searched and found nothing → escalate. Genuinely absent.
 *   - Wikipedia found an article too thin to teach from → escalate. A two-sentence stub is a
 *     citation, not a lesson, and treating it as sufficient is how a session becomes twenty
 *     minutes of her improvising around one line.
 *   - Wikipedia could not be reached → escalate. Falling back beats failing, and the reason
 *     is recorded so the session can say which source it ended up using.
 *
 * Anything else — a real article of reasonable length — stops here. The web is not consulted
 * at all, which on most topics means no key is needed and nothing leaves for a third party.
 *
 * Exposes: window.NEXUS_RESEARCH
 */
(function (global) {
    'use strict';

    /**
     * Shorter than this and an article cannot carry a study session.
     *
     * Wikipedia stubs run one or two sentences. The number is a judgement, not a measurement,
     * and it is here as a named constant so it can be argued with rather than hunted for.
     */
    const THIN_EXTRACT = 320;

    /** Why the web was reached for, if it was. Reported so the session can say so. */
    const ESCALATION = {
        NONE: 'wikipedia-sufficient',
        NOT_FOUND: 'not-in-wikipedia',
        RATE_LIMITED: 'wikipedia-rate-limited',
        THIN: 'wikipedia-too-thin',
        UNREACHABLE: 'wikipedia-unreachable',
    };

    function wikipedia() {
        return (global && global.NEXUS_RESEARCH_WIKIPEDIA) || null;
    }

    function web() {
        return (global && global.NEXUS_RESEARCH_WEB) || null;
    }

    /** Is this enough to teach from? */
    function sufficient(sources) {
        if (!Array.isArray(sources) || !sources.length) {
            return false;
        }
        const S = global && global.NEXUS_RESEARCH_SOURCE;
        const text = S ? S.textOf(sources[0]) : sources[0].extract || '';
        return String(text || '').length >= THIN_EXTRACT;
    }

    /**
     * Read up on a topic.
     *
     * Returns `{ ok, sources, used, escalation, reason }`. `used` names where the material
     * actually came from, because a session that cites Wikipedia when it read a blog post is
     * lying about its own grounding.
     */
    /** The word for why nothing came back, when nothing did. */
    function reasonFor(escalation) {
        if (escalation === ESCALATION.UNREACHABLE) {
            return 'unreachable';
        }
        if (escalation === ESCALATION.RATE_LIMITED) {
            return 'rate-limited';
        }
        return 'nothing-found';
    }

    async function read(topic, options = {}) {
        const query = String(topic || '').trim();
        if (!query) {
            return { ok: false, sources: [], used: null, escalation: null, reason: 'empty-topic' };
        }

        const wiki = wikipedia();
        let fromWiki = null;
        if (wiki && typeof wiki.research === 'function') {
            fromWiki = await wiki.research(query, options);
        }

        let escalation = ESCALATION.NONE;
        if (fromWiki && fromWiki.rateLimited) {
            // Distinct from unreachable: the answer exists and we were asked to wait. It still
            // escalates — falling back beats making somebody wait — but a session that says
            // "Wikipedia asked me to slow down" is telling the truth, and one that says
            // "couldn't reach Wikipedia" is not.
            escalation = ESCALATION.RATE_LIMITED;
            fromWiki = [];
        } else if (fromWiki === null) {
            escalation = ESCALATION.UNREACHABLE;
        } else if (!fromWiki.length) {
            escalation = ESCALATION.NOT_FOUND;
        } else if (!sufficient(fromWiki)) {
            escalation = ESCALATION.THIN;
        }

        if (escalation === ESCALATION.NONE) {
            return { ok: true, sources: fromWiki, used: 'wikipedia', escalation, reason: 'ok' };
        }

        const w = web();
        let fromWeb = null;
        if (w && typeof w.research === 'function') {
            // Only ask whether a key exists at the moment one is actually wanted. A topic that
            // Wikipedia covers never triggers the probe at all.
            if (typeof w.ready === 'function') {
                await w.ready(options);
            }
            const s = typeof w.status === 'function' ? w.status() : null;
            if (!s || s.available) {
                fromWeb = await w.research(query, options);
            }
        }

        if (fromWeb && fromWeb.length) {
            // A thin article plus web results is better than either: the encyclopedia gives the
            // definition, the web gives the specifics.
            const sources = escalation === ESCALATION.THIN && fromWiki.length ? fromWiki.concat(fromWeb) : fromWeb;
            return {
                ok: true,
                sources,
                used: escalation === ESCALATION.THIN ? 'wikipedia+web' : 'web',
                escalation,
                reason: 'ok',
            };
        }

        if (fromWiki && fromWiki.length) {
            // The web could not help either. A thin article is still something, and saying so
            // is better than refusing a topic she can partly cover.
            return { ok: true, sources: fromWiki, used: 'wikipedia', escalation, reason: 'web-unavailable' };
        }

        return {
            ok: false,
            sources: [],
            used: null,
            escalation,
            reason: reasonFor(escalation),
        };
    }

    const api = { THIN_EXTRACT, ESCALATION, read, sufficient };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_RESEARCH = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
