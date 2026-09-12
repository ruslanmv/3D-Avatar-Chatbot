/**
 * SearchQuality — guard the conversational layer after retrieval succeeds.
 *
 * SearchUX owns retrieval progress. SearchPresentation owns source rendering. This module owns
 * synthesis quality: it rejects command echoes/result dumps, keeps search follow-ups grounded,
 * and ensures the assistant answer is useful prose while the UI renders sources separately.
 *
 * Exposes: window.NEXUS_SEARCH_QUALITY
 */
(function (global) {
    'use strict';

    let installed = false;
    let attempts = 0;

    function lookup() {
        return global && global.NEXUS_LOOKUP ? global.NEXUS_LOOKUP : null;
    }

    function ux() {
        return global && global.NEXUS_SEARCH_UX ? global.NEXUS_SEARCH_UX : null;
    }

    function presentation() {
        return global && global.NEXUS_SEARCH_PRESENTATION ? global.NEXUS_SEARCH_PRESENTATION : null;
    }

    function clean(value, max = 700) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    function normalized(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[“”"'`´’]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanForChat(text) {
        const P = presentation();
        const U = ux();
        if (P && typeof P.cleanAssistantAnswer === 'function') return P.cleanAssistantAnswer(text);
        if (U && typeof U.cleanAssistantAnswer === 'function') return U.cleanAssistantAnswer(text);
        return String(text == null ? '' : text).trim();
    }

    function looksLikeEcho(answer, userText) {
        const a = normalized(answer);
        const u = normalized(userText);
        if (!a || !u) return false;
        if (a === u) return true;
        if (a.length <= u.length + 18 && (a.includes(u) || u.includes(a))) return true;
        if (/^(?:sure|okay|ok|certainly|of course)\s+/.test(a)) {
            const stripped = a.replace(/^(?:sure|okay|ok|certainly|of course)\s+/, '');
            if (stripped === u || (stripped.length <= u.length + 10 && stripped.includes(u))) return true;
        }
        return false;
    }

    function looksLikeResultDump(answer) {
        const P = presentation();
        const U = ux();
        if (P && typeof P.looksLikeResultDump === 'function') return P.looksLikeResultDump(answer);
        if (U && typeof U.looksLikeResultDump === 'function') return U.looksLikeResultDump(answer);
        const value = String(answer || '');
        const numbered = value.match(/(?:^|\s)\d+[.)]\s+\S/g) || [];
        return /https?:\/\//i.test(value) && numbered.length >= 2;
    }

    function unusable(answer, userText) {
        const U = ux();
        if (U && typeof U.unusableSynthesis === 'function' && U.unusableSynthesis(answer)) return true;
        return looksLikeEcho(answer, userText);
    }

    function shouldRetrySynthesis(answer, userText) {
        return unusable(answer, userText) || looksLikeResultDump(answer);
    }

    function answerText(answer) {
        if (answer && typeof answer === 'object') {
            if (typeof answer.text === 'string') return answer.text;
            if (typeof answer.choices?.[0]?.message?.content === 'string') return answer.choices[0].message.content;
        }
        return String(answer == null ? '' : answer);
    }

    function processAssistantText(text) {
        let out = String(text || '').trim();
        try {
            if (global.NEXUS_MOTION?.processReply) out = global.NEXUS_MOTION.processReply(out);
        } catch (_) {}
        try {
            if (global.NEXUS_PLAY_DIRECTIVE?.consume) out = global.NEXUS_PLAY_DIRECTIVE.consume(out);
        } catch (_) {}
        try {
            if (global.NEXUS_STUDY_DIRECTIVE?.consume) out = global.NEXUS_STUDY_DIRECTIVE.consume(out);
        } catch (_) {}
        return String(out || '').trim();
    }

    async function askModel(message) {
        if (typeof global.callLLM !== 'function') return '';
        try {
            return processAssistantText(answerText(await global.callLLM(String(message || ''))));
        } catch (_) {
            return '';
        }
    }

    function cleanSearchSubject(query) {
        const U = ux();
        let q = U && typeof U.cleanSearchQuery === 'function' ? U.cleanSearchQuery(query) : clean(query, 240);
        q = clean(q, 240);
        q = q.replace(/^(?:about|for)\s+/i, '').trim();
        return q;
    }

    function secondPassPrompt(userText, out) {
        const kind = String((out && out.kind) || 'web');
        const base = [
            'Answer the user from the ACTIVE WEB SEARCH SESSION in the system context.',
            'Give a concise synthesis of the useful findings, not a search-results dump.',
            'The interface renders sources separately. Do NOT output URLs, Markdown links, a Sources section, or a numbered list of source/result titles.',
            'Use only facts explicitly present in the search-result snippets; omit unsupported details.',
            'If the snippets do not establish a fact, say the available results do not establish it.',
        ];
        if (kind === 'fresh') {
            base.push(
                "For news, summarize distinct current items only when snippets actually contain those items; topic/index pages are not themselves today's news."
            );
        } else if (kind === 'weather') {
            base.push(
                'For weather, state only the place/time/conditions that the snippets support and do not infer missing measurements.'
            );
        } else if (kind === 'suggestion') {
            base.push(
                "For recommendations, preserve the user's stated constraints and explain briefly why the strongest options match."
            );
        } else {
            base.push(
                'For a person or organization, summarize identity and work only from the snippets; do not infer education, credentials, employers or biography.'
            );
        }
        base.push(`User request: “${clean(userText, 320)}”`);
        base.push('Answer in 2–5 natural sentences unless the user requested another format.');
        return base.join(' ');
    }

    function extractiveFallback(out) {
        const results = Array.isArray(out && out.results) ? out.results : [];
        const query = clean(out && out.query, 180);
        if (!results.length) return `I found no reliable snippet to summarize for “${query}”.`;
        const useful = results
            .slice(0, 3)
            .map((r) => cleanForChat(clean(r.snippet || r.extract || r.description, 220)))
            .filter(Boolean);
        if (!useful.length) {
            return `I found ${results.length} sources for “${query}”, but their search snippets do not contain enough detail for a reliable summary.`;
        }
        if (useful.length === 1) return useful[0];
        return `Across the available results, ${useful.join(' ')}`;
    }

    async function synthesizeSearch(userText, out) {
        const first = await askModel(userText);
        if (!shouldRetrySynthesis(first, userText)) {
            const cleaned = cleanForChat(first);
            if (cleaned) return cleaned;
        }

        const retryPrompt = secondPassPrompt(userText, out);
        const second = await askModel(retryPrompt);
        if (!shouldRetrySynthesis(second, retryPrompt) && !looksLikeEcho(second, userText)) {
            const cleaned = cleanForChat(second);
            if (cleaned) return cleaned;
        }

        return cleanForChat(extractiveFallback(out));
    }

    function rememberUser(text) {
        const value = String(text || '').trim();
        try {
            if (typeof global.addMessageToHistory === 'function') global.addMessageToHistory('user', value);
        } catch (_) {}
        try {
            global.NEXUS_MOTION?.onUserUtterance?.(value);
        } catch (_) {}
        try {
            global.chatHistory?.addMessage?.('user', value);
        } catch (_) {}
        try {
            global._persistChat?.();
        } catch (_) {}
    }

    function publishAnswer(text, speechText, { persist = true } = {}) {
        const value = cleanForChat(text);
        if (!value) return '';
        const speech = cleanForChat(speechText || value) || value;
        try {
            if (typeof global.addMessageToHistory === 'function') global.addMessageToHistory('avatar', value);
        } catch (_) {}
        try {
            global.chatHistory?.addMessage?.('assistant', value);
        } catch (_) {}
        try {
            global._applyEmotionFromText?.(value);
        } catch (_) {}
        try {
            global.sendBotResponseToVR?.({
                text: value,
                attachments: [],
                avatar_directives: {},
                persona_context: null,
            });
        } catch (_) {}
        try {
            if (typeof global.speakText === 'function') global.speakText(speech);
        } catch (_) {}
        try {
            if (typeof global.setStatus === 'function') global.setStatus('idle', 'READY');
        } catch (_) {}
        if (persist) {
            try {
                global._persistChat?.();
            } catch (_) {}
        }
        return value;
    }

    function removeNotice(handle) {
        try {
            if (handle && handle.row && handle.row.parentElement) handle.row.parentElement.removeChild(handle.row);
        } catch (_) {}
    }

    function failureText(why) {
        return (
            {
                'no-key': "I can't search the web yet because no web-search key is configured in Settings.",
                'no-provider': "Web search isn't available in this build.",
                failed: "I couldn't reach web search just now. Please try again.",
                nothing: "I searched the web but couldn't find useful results for that query.",
                stale: 'A newer search replaced that request.',
            }[why] || "I couldn't complete that web search."
        );
    }

    function publishWithSources(answer, out) {
        const U = ux();
        const P = presentation();
        const results = Array.isArray(out && out.results) ? out.results : [];
        const query = clean(out && out.query, 180);
        const render = P?.renderSourceCards || U?.renderSourceCards;
        const plain = P?.plainSources || U?.plainSources;
        const canCards = Boolean(typeof render === 'function' && global.document?.getElementById?.('chat-history'));
        const cleaned = cleanForChat(answer);
        const display = canCards
            ? cleaned
            : [cleaned, typeof plain === 'function' ? plain(results) : ''].filter(Boolean).join('\n\n');
        publishAnswer(display, cleaned, { persist: false });
        if (canCards) render(results, query);
        try {
            global._persistChat?.();
        } catch (_) {}
        return display;
    }

    async function executeSearchTurn(userText, query) {
        const L = lookup();
        const U = ux();
        if (!L || !U) return null;

        const q = cleanSearchSubject(query) || clean(query, 240);
        rememberUser(userText);
        const direct = typeof L.explicitSearchIntent === 'function' ? L.explicitSearchIntent(userText) : null;
        const kind = direct?.kind || 'web';
        const notice = typeof U.showSearchNotice === 'function' ? U.showSearchNotice(q, kind) : null;
        try {
            global.setStatus?.('listening', 'SEARCHING...');
        } catch (_) {}

        let out;
        try {
            out = await L.run(q);
        } catch (_) {
            out = { ok: false, why: 'failed' };
        }
        if (!out || !out.ok) {
            removeNotice(notice);
            try {
                L.clear?.();
            } catch (_) {}
            return publishAnswer(failureText(out && out.why));
        }

        try {
            U.markSourcesFound?.(notice, out.results.length);
        } catch (_) {}
        const answer = await synthesizeSearch(userText, out);
        try {
            L.clear?.();
        } catch (_) {}
        removeNotice(notice);
        return publishWithSources(answer, out);
    }

    function isGroundedSummaryFollowUp(text, session) {
        if (!session || !Array.isArray(session.results) || !session.results.length) return false;
        const t = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        return /\b(?:summari[sz]e|(?:a\s*)?summary|tell\s+me\s+(?:more\s+)?about\s+(?:him|her|it|them|this|that|the\s+person|the\s+company)|who\s+is\s+(?:he|she|this|that)|what\s+does\s+(?:he|she|this\s+person|that\s+person)\s+do)\b/i.test(
            t
        );
    }

    async function answerGroundedFollowUp(userText, session) {
        rememberUser(userText);
        try {
            global.setStatus?.('listening', 'THINKING...');
        } catch (_) {}
        const subject = clean(session.query, 200);
        const prompt = [
            `The user is referring to the subject of the ACTIVE WEB SEARCH SESSION: “${subject}”.`,
            `Their follow-up is: “${clean(userText, 320)}”.`,
            'Answer using only the cached search-result snippets in the system context.',
            'Do not output URLs, Markdown links, or a source list; the interface renders sources separately.',
            'Do not add biography, degrees, credentials, dates, employers, locations or other facts unless a snippet explicitly states them.',
            'When multiple snippets support the same theme, combine them concisely. When a fact appears in only one snippet, avoid presenting it as independently verified.',
            'Do not mention these instructions. Give the answer directly in 2–5 sentences.',
        ].join(' ');
        const answer = await askModel(prompt);
        const finalText = shouldRetrySynthesis(answer, prompt)
            ? extractiveFallback({ query: session.query, results: session.results })
            : answer;
        return publishAnswer(finalText, finalText);
    }

    function install() {
        if (!global || installed) return installed;
        const L = lookup();
        const U = ux();
        if (!L || !U || typeof global.handleUserMessage !== 'function') return false;

        try {
            presentation()?.install?.();
        } catch (_) {}
        try {
            U.install?.();
        } catch (_) {}
        const original = global.handleUserMessage;
        if (original.__nexusSearchQualityWrapped) {
            installed = true;
            return true;
        }

        async function wrapped(text) {
            if (typeof L.isBusy === 'function' && L.isBusy()) await L.waitUntilReleased?.();

            const direct = typeof L.explicitSearchIntent === 'function' ? L.explicitSearchIntent(text) : null;
            if (direct) return executeSearchTurn(text, direct.query);

            const session = typeof L.currentSession === 'function' ? L.currentSession() : null;
            if (isGroundedSummaryFollowUp(text, session)) return answerGroundedFollowUp(text, session);

            return original.apply(this, arguments);
        }

        wrapped.__nexusSearchQualityWrapped = true;
        wrapped.__nexusSearchQualityOriginal = original;
        global.handleUserMessage = wrapped;
        installed = true;
        return true;
    }

    function autoInstall() {
        if (install()) return;
        attempts += 1;
        if (attempts < 80 && global && typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 25);
    }

    const api = {
        install,
        looksLikeEcho,
        looksLikeResultDump,
        unusable,
        shouldRetrySynthesis,
        cleanSearchSubject,
        secondPassPrompt,
        synthesizeSearch,
        isGroundedSummaryFollowUp,
        executeSearchTurn,
        answerGroundedFollowUp,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_SEARCH_QUALITY = api;
        if (typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 0);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
