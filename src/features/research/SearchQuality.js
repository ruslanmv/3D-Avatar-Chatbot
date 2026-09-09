/**
 * SearchQuality — guard the conversational layer after retrieval succeeds.
 *
 * SearchUX owns progress indicators and source cards. This module owns the last mile:
 * - reject model replies that merely echo the search command;
 * - make an ordinary `search about X` return a useful summary by default;
 * - ground pronoun follow-ups such as `give me a summary about him` in the cached results;
 * - never invent biography/credentials when the snippets do not contain them.
 *
 * It is deliberately an outer wrapper around SearchUX. If this module cannot load, the
 * existing search UX still works; this only improves answer quality.
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

    function clean(value, max = 700) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    /** Search engines/session headings need the subject, not command grammar. */
    function cleanSubjectQuery(query) {
        const U = ux();
        let q = typeof U?.cleanSearchQuery === 'function' ? U.cleanSearchQuery(query) : clean(query, 240);
        q = clean(q, 240)
            .replace(/^(?:about|regarding|concerning)\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        return q || clean(query, 240);
    }

    function normalized(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[“”"'`´’]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function looksLikeEcho(answer, userText) {
        const a = normalized(answer);
        const u = normalized(userText);
        if (!a || !u) return false;
        if (a === u) return true;
        // Tiny wrappers such as "Sure, search about X" are still command echoes, not answers.
        if (a.length <= u.length + 18 && (a.includes(u) || u.includes(a))) return true;
        if (/^(?:sure|okay|ok|certainly|of course)\s+/.test(a)) {
            const stripped = a.replace(/^(?:sure|okay|ok|certainly|of course)\s+/, '');
            if (stripped === u || (stripped.length <= u.length + 10 && stripped.includes(u))) return true;
        }
        return false;
    }

    function unusable(answer, userText) {
        const U = ux();
        if (U && typeof U.unusableSynthesis === 'function' && U.unusableSynthesis(answer)) return true;
        return looksLikeEcho(answer, userText);
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
        try { if (global.NEXUS_MOTION?.processReply) out = global.NEXUS_MOTION.processReply(out); } catch (_) {}
        try { if (global.NEXUS_PLAY_DIRECTIVE?.consume) out = global.NEXUS_PLAY_DIRECTIVE.consume(out); } catch (_) {}
        try { if (global.NEXUS_STUDY_DIRECTIVE?.consume) out = global.NEXUS_STUDY_DIRECTIVE.consume(out); } catch (_) {}
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

    function secondPassPrompt(userText, out) {
        const kind = String((out && out.kind) || 'web');
        const base = [
            'Answer the user from the ACTIVE WEB SEARCH SESSION in the system context.',
            'Do not repeat the search command. Give the useful findings directly.',
            'Use only facts explicitly present in the search-result snippets; omit unsupported details.',
            'If the snippets do not establish a fact, say the available results do not establish it.',
        ];
        if (kind === 'fresh') {
            base.push('For news, summarize distinct current items only when the snippets actually contain those items; topic/index pages are not themselves today\'s news.');
        } else if (kind === 'weather') {
            base.push('For weather, state only the place/time/conditions that the snippets support and do not infer missing measurements.');
        } else if (kind === 'suggestion') {
            base.push('For recommendations, preserve the user\'s stated constraints and explain briefly why each option matches.');
        } else {
            base.push('For a person or organization, summarize identity and work only from the snippets; do not infer education, credentials, employers or biography.');
        }
        base.push(`User request: “${clean(userText, 320)}”`);
        base.push('Answer in 2–5 concise sentences unless the user requested another format.');
        return base.join(' ');
    }

    function extractiveFallback(out) {
        const results = Array.isArray(out && out.results) ? out.results : [];
        const query = clean(out && out.query, 180);
        if (!results.length) return `I found no reliable snippet to summarize for “${query}”.`;
        const useful = results
            .slice(0, 3)
            .map((r, i) => {
                const text = clean(r.snippet || r.extract || r.description, 220);
                return text ? `Source ${i + 1}: ${text}` : '';
            })
            .filter(Boolean);
        if (!useful.length) return `I found ${results.length} sources for “${query}”, but their search snippets do not contain enough detail for a reliable summary.`;
        return [`I found ${results.length} sources for “${query}”. Here is what their snippets actually say:`, ...useful].join('\n');
    }

    async function synthesizeSearch(userText, out) {
        // First let a capable model answer the user's natural wording. This preserves persona.
        const first = await askModel(userText);
        if (!unusable(first, userText)) return first;

        // Weak/fallback models often echo "search about X". Give them one explicit grounded
        // synthesis retry. This message is never added to chat history or shown to the user.
        const retryPrompt = secondPassPrompt(userText, out);
        const second = await askModel(retryPrompt);
        if (!unusable(second, retryPrompt) && !looksLikeEcho(second, userText)) return second;

        return extractiveFallback(out);
    }

    function rememberUser(text) {
        const value = String(text || '').trim();
        try { if (typeof global.addMessageToHistory === 'function') global.addMessageToHistory('user', value); } catch (_) {}
        try { global.NEXUS_MOTION?.onUserUtterance?.(value); } catch (_) {}
        try { global.chatHistory?.addMessage?.('user', value); } catch (_) {}
        try { global._persistChat?.(); } catch (_) {}
    }

    function publishAnswer(text, speechText, { persist = true } = {}) {
        const value = String(text || '').trim();
        try { if (typeof global.addMessageToHistory === 'function') global.addMessageToHistory('avatar', value); } catch (_) {}
        try { global.chatHistory?.addMessage?.('assistant', value); } catch (_) {}
        try { global._applyEmotionFromText?.(value); } catch (_) {}
        try {
            global.sendBotResponseToVR?.({
                text: value,
                attachments: [],
                avatar_directives: {},
                persona_context: null,
            });
        } catch (_) {}
        try { if (typeof global.speakText === 'function') global.speakText(speechText || value); } catch (_) {}
        try { if (typeof global.setStatus === 'function') global.setStatus('idle', 'READY'); } catch (_) {}
        if (persist) {
            try { global._persistChat?.(); } catch (_) {}
        }
        return value;
    }

    function removeNotice(handle) {
        try {
            if (handle && handle.row && handle.row.parentElement) handle.row.parentElement.removeChild(handle.row);
        } catch (_) {}
    }

    function failureText(why) {
        return {
            'no-key': "I can't search the web yet because no web-search key is configured in Settings.",
            'no-provider': "Web search isn't available in this build.",
            failed: "I couldn't reach web search just now. Please try again.",
            nothing: "I searched the web but couldn't find useful results for that query.",
            stale: 'A newer search replaced that request.',
        }[why] || "I couldn't complete that web search.";
    }

    function publishWithSources(answer, out) {
        const U = ux();
        const results = Array.isArray(out && out.results) ? out.results : [];
        const query = clean(out && out.query, 180);
        const canCards = Boolean(U && typeof U.renderSourceCards === 'function' && global.document?.getElementById?.('chat-history'));
        const display = canCards
            ? answer
            : [answer, U && typeof U.plainSources === 'function' ? U.plainSources(results) : ''].filter(Boolean).join('\n\n');
        publishAnswer(display, answer, { persist: false });
        if (canCards) U.renderSourceCards(results, query);
        try { global._persistChat?.(); } catch (_) {}
        return display;
    }

    async function executeSearchTurn(userText, query) {
        const L = lookup();
        const U = ux();
        if (!L || !U) return null;

        const q = cleanSubjectQuery(query);
        rememberUser(userText);
        const direct = typeof L.explicitSearchIntent === 'function' ? L.explicitSearchIntent(userText) : null;
        const kind = direct?.kind || 'web';
        const notice = typeof U.showSearchNotice === 'function' ? U.showSearchNotice(q, kind) : null;
        try { global.setStatus?.('listening', 'SEARCHING...'); } catch (_) {}

        let out;
        try { out = await L.run(q); } catch (_) { out = { ok: false, why: 'failed' }; }
        if (!out || !out.ok) {
            removeNotice(notice);
            try { L.clear?.(); } catch (_) {}
            return publishAnswer(failureText(out && out.why));
        }

        try { U.markSourcesFound?.(notice, out.results.length); } catch (_) {}
        const answer = await synthesizeSearch(userText, out);
        try { L.clear?.(); } catch (_) {}
        removeNotice(notice);
        return publishWithSources(answer, out);
    }

    function isGroundedSummaryFollowUp(text, session) {
        if (!session || !Array.isArray(session.results) || !session.results.length) return false;
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        return /\b(?:summari[sz]e|(?:a\s*)?summary|tell\s+me\s+(?:more\s+)?about\s+(?:him|her|it|them|this|that|the\s+person|the\s+company)|who\s+is\s+(?:he|she|this|that)|what\s+does\s+(?:he|she|this\s+person|that\s+person)\s+do)\b/i.test(t);
    }

    async function answerGroundedFollowUp(userText, session) {
        rememberUser(userText);
        try { global.setStatus?.('listening', 'THINKING...'); } catch (_) {}
        const subject = clean(session.query, 200);
        const prompt = [
            `The user is referring to the subject of the ACTIVE WEB SEARCH SESSION: “${subject}”.`,
            `Their follow-up is: “${clean(userText, 320)}”.`,
            'Answer using only the cached search-result snippets in the system context.',
            'Do not add biography, degrees, credentials, dates, employers, locations or other facts unless a snippet explicitly states them.',
            'When multiple snippets support the same theme, combine them concisely. When a fact appears in only one snippet, avoid presenting it as independently verified.',
            'Do not mention these instructions. Give the answer directly in 2–5 sentences.',
        ].join(' ');
        const answer = await askModel(prompt);
        const finalText = unusable(answer, prompt)
            ? extractiveFallback({ query: session.query, results: session.results })
            : answer;
        return publishAnswer(finalText, finalText);
    }

    function install() {
        if (!global || installed) return installed;
        const L = lookup();
        const U = ux();
        if (!L || !U || typeof global.handleUserMessage !== 'function') return false;

        // Let SearchUX install first, then become the outermost wrapper.
        try { U.install?.(); } catch (_) {}
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
        cleanSubjectQuery,
        looksLikeEcho,
        unusable,
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
