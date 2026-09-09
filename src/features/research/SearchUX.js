/**
 * SearchUX — visible progress + readable source cards for conversational web search.
 *
 * LookUp owns retrieval/session semantics. This module owns the conversation surface:
 *   1. acknowledge a search immediately;
 *   2. show when live sources have arrived and synthesis is happening;
 *   3. answer with the user's original request, never an internal orchestration prompt;
 *   4. render source metadata as real clickable cards instead of Markdown-looking text.
 *
 * Exposes: window.NEXUS_SEARCH_UX
 */
(function (global) {
    'use strict';

    let installed = false;
    let attempts = 0;

    function lookup() {
        return global && global.NEXUS_LOOKUP ? global.NEXUS_LOOKUP : null;
    }

    function clean(value, max = 600) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    function domainOf(raw) {
        try {
            return new URL(String(raw || '')).hostname.replace(/^www\./, '');
        } catch (_) {
            return '';
        }
    }

    /**
     * Search engines should receive the subject, not UI instructions.
     *
     * "search on internet Ruslan Magana and summarize" therefore searches for
     * "Ruslan Magana" while the original sentence still reaches the synthesizer.
     */
    function cleanSearchQuery(query) {
        let q = clean(query, 240);
        if (!q) return '';
        for (let i = 0; i < 2; i += 1) {
            q = q
                .replace(/\s+(?:(?:on|in)\s+)?(?:the\s+)?(?:internet|web|online)\s*$/i, '')
                .replace(/\s+(?:and\s+)?(?:summari[sz]e(?:\s+(?:it|this|them|the\s+results?))?|give\s+me\s+(?:a\s+)?summary|show(?:\s+me)?(?:\s+the)?\s+results?|list(?:\s+the)?\s+results?|tell\s+me\s+what\s+you\s+find)\s*$/i, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return q;
    }

    function emitStatus(phase, detail) {
        try {
            if (!global || typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
            global.dispatchEvent(new global.CustomEvent('nexus-search:status', { detail: Object.assign({ phase }, detail || {}) }));
        } catch (_) {
            /* other surfaces can opt in; chat remains the source of truth */
        }
    }

    function statusCopy(query, kind) {
        if (kind === 'weather') return `🌦️ Checking live weather sources for “${query}”…`;
        if (kind === 'fresh') return `🔎 Searching current web sources for “${query}”…`;
        if (kind === 'suggestion') return `🔎 Searching current options for “${query}”…`;
        return `🔎 Searching the web for “${query}”…`;
    }

    /** A display-only bubble. It never enters LLM history or persisted chat. */
    function showSearchNotice(query, kind) {
        const doc = global && global.document;
        if (!doc) return null;
        const chat = doc.getElementById('chat-history');
        if (!chat) return null;

        const empty = chat.querySelector('.empty-state');
        if (empty) empty.remove();

        const row = doc.createElement('div');
        row.className = 'chat-row nexus-search-status-row';
        row.setAttribute('data-nexus-search-status', 'searching');
        row.setAttribute('role', 'status');
        row.setAttribute('aria-live', 'polite');

        const message = doc.createElement('div');
        message.className = 'chat-message avatar nexus-search-status';

        const sender = doc.createElement('div');
        sender.className = 'message-sender avatar';
        sender.textContent = 'NEXUS';

        const body = doc.createElement('div');
        body.className = 'message-text';
        body.textContent = statusCopy(query, kind);

        const detail = doc.createElement('div');
        detail.className = 'nexus-search-status-detail';
        detail.textContent = 'Checking live sources…';
        detail.style.cssText = 'margin-top:4px;opacity:.65;font-size:.82em;';

        message.appendChild(sender);
        message.appendChild(body);
        message.appendChild(detail);
        row.appendChild(message);
        chat.appendChild(row);
        chat.scrollTop = chat.scrollHeight;

        emitStatus('searching', { query, kind });
        return { row, body, detail, query, kind };
    }

    function markSourcesFound(handle, count) {
        if (!handle) return;
        if (handle.row) handle.row.setAttribute('data-nexus-search-status', 'summarizing');
        if (handle.body) handle.body.textContent = `✓ Found ${count} live source${count === 1 ? '' : 's'} for “${handle.query}”.`;
        if (handle.detail) handle.detail.textContent = 'Reading the results and preparing your answer…';
        emitStatus('summarizing', { query: handle.query, kind: handle.kind, count });
    }

    function removeSearchNotice(handle, phase = 'done') {
        if (handle && handle.row && handle.row.parentElement) handle.row.parentElement.removeChild(handle.row);
        emitStatus(phase, handle ? { query: handle.query, kind: handle.kind } : {});
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

    /** Replies that prove the model ignored/echoed the grounded-search context. */
    function unusableSynthesis(text) {
        const t = String(text || '').trim();
        if (!t) return true;
        if (/the application has (?:already )?completed a live web search|the completed search query was|the user asked:\s*["“]/i.test(t)) return true;
        if (/(?:cannot|can't|unable to|don't|do not)\s+(?:perform|do|access|browse|search|use).{0,55}(?:internet|web|real[- ]?time)/i.test(t)) return true;
        if (/knowledge\s+cut[- ]?off|don't have access to (?:the )?(?:latest|internet|web|real[- ]?time)/i.test(t)) return true;
        if (/^(?:i['’]?m\s+sorry[,\s]*)?(?:but\s+)?i\s+(?:can(?:not|'t)|am\s+unable\s+to)\s+(?:assist|help)(?:\s+you)?(?:\s+with)?\s+(?:that|this)\s+request\b/i.test(t)) return true;
        return false;
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

    function sourceMeta(result) {
        const site = clean(result.siteName || result.site_name || domainOf(result.url), 100);
        const published = clean(result.published || result.date || result.age, 80);
        return [site, published].filter(Boolean).join(' · ');
    }

    function canRenderCards() {
        const doc = global && global.document;
        return Boolean(doc && doc.getElementById('chat-history'));
    }

    /** Render sources as cards with actual anchors, not Markdown inside a textContent bubble. */
    function renderSourceCards(results, query, { max = 4 } = {}) {
        const doc = global && global.document;
        const chat = doc && doc.getElementById('chat-history');
        if (!doc || !chat) return null;
        const rows = (Array.isArray(results) ? results : []).slice(0, max);
        if (!rows.length) return null;

        const row = doc.createElement('div');
        row.className = 'chat-row nexus-search-results-row';

        const message = doc.createElement('div');
        message.className = 'chat-message avatar nexus-search-results';

        const sender = doc.createElement('div');
        sender.className = 'message-sender avatar';
        sender.textContent = 'SOURCES';

        const body = doc.createElement('div');
        body.className = 'message-text nexus-search-results-body';

        const heading = doc.createElement('div');
        heading.textContent = `${rows.length} source${rows.length === 1 ? '' : 's'} · ${clean(query, 160)}`;
        heading.style.cssText = 'margin-bottom:8px;font-weight:600;opacity:.8;';
        body.appendChild(heading);

        rows.forEach((result, index) => {
            const url = clean(result.url, 600);
            const card = url ? doc.createElement('a') : doc.createElement('div');
            if (url) {
                card.href = url;
                card.target = '_blank';
                card.rel = 'noopener noreferrer';
                card.setAttribute('aria-label', `Open source ${index + 1}: ${clean(result.title || 'Untitled', 160)}`);
            }
            card.className = 'nexus-search-result-card';
            card.style.cssText =
                'display:block;margin:8px 0;padding:10px 12px;border:1px solid rgba(140,220,255,.24);' +
                'border-radius:10px;background:rgba(8,20,30,.28);text-decoration:none;color:inherit;';

            const title = doc.createElement('div');
            title.style.cssText = 'font-weight:650;line-height:1.3;';
            title.textContent = `${index + 1}. ${clean(result.title || 'Untitled', 200)}`;
            card.appendChild(title);

            const meta = sourceMeta(result);
            if (meta) {
                const metaEl = doc.createElement('div');
                metaEl.className = 'nexus-search-result-meta';
                metaEl.textContent = meta;
                metaEl.style.cssText = 'margin-top:3px;font-size:.8em;opacity:.65;';
                card.appendChild(metaEl);
            }

            const snippet = clean(result.snippet || result.extract || result.description, 300);
            if (snippet) {
                const snippetEl = doc.createElement('div');
                snippetEl.className = 'nexus-search-result-snippet';
                snippetEl.textContent = snippet;
                snippetEl.style.cssText = 'margin-top:6px;line-height:1.35;opacity:.9;';
                card.appendChild(snippetEl);
            }

            if (url) {
                const open = doc.createElement('div');
                open.textContent = 'Open source ↗';
                open.style.cssText = 'margin-top:7px;font-size:.8em;opacity:.72;';
                card.appendChild(open);
            }
            body.appendChild(card);
        });

        message.appendChild(sender);
        message.appendChild(body);
        row.appendChild(message);
        chat.appendChild(row);
        chat.scrollTop = chat.scrollHeight;
        return row;
    }

    function plainSources(results, max = 4) {
        const rows = (Array.isArray(results) ? results : []).slice(0, max);
        if (!rows.length) return '';
        return ['Sources:', ...rows.map((r, i) => {
            const meta = sourceMeta(r);
            return `${i + 1}. ${clean(r.title || 'Untitled', 200)}${meta ? ` — ${meta}` : ''}${r.url ? `\n   ${r.url}` : ''}`;
        })].join('\n');
    }

    function fallbackAnswer(out) {
        const count = out && Array.isArray(out.results) ? out.results.length : 0;
        const query = clean(out && out.query, 180);
        return `I found ${count} live web source${count === 1 ? '' : 's'} for “${query}”. I couldn't produce a reliable summary from the language model, so I'm showing the source results directly below.`;
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

    function publishWithSources(answer, results, query, speechText) {
        const cards = canRenderCards();
        const display = cards ? answer : [answer, plainSources(results)].filter(Boolean).join('\n\n');
        publishAnswer(display, speechText || answer, { persist: false });
        if (cards) renderSourceCards(results, query);
        try { global._persistChat?.(); } catch (_) {}
        return display;
    }

    async function executeSearchTurn(userText, query) {
        const L = lookup();
        if (!L) return null;
        const q = cleanSearchQuery(query) || clean(query, 240);
        rememberUser(userText);

        const kind = typeof L.explicitSearchIntent === 'function'
            ? (L.explicitSearchIntent(userText)?.kind || 'web')
            : 'web';
        const notice = showSearchNotice(q, kind);
        try { if (typeof global.setStatus === 'function') global.setStatus('listening', 'SEARCHING...'); } catch (_) {}

        let out;
        try { out = await L.run(q); } catch (_) { out = { ok: false, why: 'failed' }; }
        if (!out || !out.ok) {
            removeSearchNotice(notice, 'failed');
            try { L.clear?.(); } catch (_) {}
            return publishAnswer(failureText(out && out.why));
        }

        markSourcesFound(notice, out.results.length);

        // Important: send the ORIGINAL user request to the model. The search snippets are
        // already in LookUp.systemPromptSuffix(). Sending an internal orchestration sentence as
        // the user message is what caused models to echo "The application has already...".
        let synthesized = '';
        if (typeof global.callLLM === 'function') {
            try {
                synthesized = processAssistantText(answerText(await global.callLLM(String(userText || ''))));
            } catch (_) {
                synthesized = '';
            }
        }

        const answer = unusableSynthesis(synthesized) ? fallbackAnswer(out) : synthesized;
        try { L.clear?.(); } catch (_) {}
        removeSearchNotice(notice, 'done');
        return publishWithSources(answer, out.results, out.query, unusableSynthesis(synthesized) ? `I found ${out.results.length} web results.` : synthesized);
    }

    async function showCachedResults(userText, intent) {
        rememberUser(userText);
        const session = intent && intent.session;
        const results = (session && session.results) || [];
        const query = (session && session.query) || 'your last search';
        const answer = `Here are the ${results.length} source${results.length === 1 ? '' : 's'} from my last search for “${query}”.`;
        return publishWithSources(answer, results, query, `I listed the ${results.length} sources from my last search.`);
    }

    async function answerSelectedTurn(userText, intent) {
        rememberUser(userText);
        const result = (intent && intent.result) || {};
        let synthesized = '';
        if (typeof global.callLLM === 'function') {
            try {
                synthesized = processAssistantText(answerText(await global.callLLM(String(userText || ''))));
            } catch (_) {
                synthesized = '';
            }
        }
        const fallback = [clean(result.title || `Result ${(intent?.index || 0) + 1}`, 200), clean(result.snippet || result.extract, 700)]
            .filter(Boolean)
            .join('\n');
        const answer = unusableSynthesis(synthesized) ? fallback : synthesized;
        return publishWithSources(answer, [result], intent?.session?.query || 'selected result', answer);
    }

    function install() {
        if (!global || installed) return installed;
        const L = lookup();
        if (!L || typeof global.handleUserMessage !== 'function') return false;

        // Make the existing lookup wrapper the inner fallback. Our wrapper then owns the
        // first-turn UX and cannot be pre-empted by LookUp's older executeSearchTurn closure.
        try { L.installFollowUpHook?.(); } catch (_) {}
        const original = global.handleUserMessage;
        if (original.__nexusSearchUXWrapped) {
            installed = true;
            return true;
        }

        async function wrapped(text) {
            if (typeof L.isBusy === 'function' && L.isBusy()) await L.waitUntilReleased?.();

            const direct = typeof L.explicitSearchIntent === 'function' ? L.explicitSearchIntent(text) : null;
            if (direct) return executeSearchTurn(text, cleanSearchQuery(direct.query));

            const intent = typeof L.followUpIntent === 'function' ? L.followUpIntent(text) : null;
            if (intent?.action === 'show') return showCachedResults(text, intent);
            if (intent?.action === 'refine') {
                const refined = typeof L.refineFollowUpQuery === 'function'
                    ? L.refineFollowUpQuery(text, intent.session)
                    : `${intent.session?.query || ''} ${text}`;
                return executeSearchTurn(text, cleanSearchQuery(refined));
            }
            if (intent?.action === 'select') return answerSelectedTurn(text, intent);

            return original.apply(this, arguments);
        }

        wrapped.__nexusSearchUXWrapped = true;
        wrapped.__nexusSearchUXOriginal = original;
        global.handleUserMessage = wrapped;
        installed = true;
        return true;
    }

    function autoInstall() {
        if (install()) return;
        attempts += 1;
        if (attempts < 40 && global && typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 25);
    }

    const api = {
        install,
        cleanSearchQuery,
        showSearchNotice,
        markSourcesFound,
        renderSourceCards,
        plainSources,
        unusableSynthesis,
        executeSearchTurn,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_SEARCH_UX = api;
        if (typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 0);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
