/**
 * SearchPresentation — source citations that behave like modern assistant UIs.
 *
 * Search result URLs are navigation metadata, not chat prose. This module keeps them out of
 * visible assistant text and renders sources as compact, keyboard-accessible citation cards.
 * The cards are deliberately NOT `.chat-message` nodes: main.js persists `.chat-message`
 * textContent, which used to flatten an entire clickable source card back into chat history.
 * Structured source panels are persisted separately and reconstructed after reload.
 *
 * Exposes: window.NEXUS_SEARCH_PRESENTATION
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'nexus_search_source_panels_v1';
    const CHAT_DISPLAY_KEY = 'nexus_chat_display';
    const MAX_PANELS = 24;
    const MAX_SOURCES = 8;
    const PANEL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    let installed = false;
    let installAttempts = 0;
    let panelSeq = 0;
    let restoreScheduled = false;
    let observedChat = null;
    let hadConversation = false;

    function clean(value, max = 600) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    function safeHttpUrl(raw) {
        try {
            const value = String(raw || '').trim();
            if (!value) return '';
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            parsed.hash = '';
            [...parsed.searchParams.keys()].forEach((key) => {
                const k = key.toLowerCase();
                if (k.startsWith('utm_') || ['gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'srsltid'].includes(k)) {
                    parsed.searchParams.delete(key);
                }
            });
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    function domainOf(raw) {
        try {
            return new URL(String(raw || '')).hostname.replace(/^www\./i, '');
        } catch (_) {
            return '';
        }
    }

    function sourceMeta(result) {
        const site = clean(result.siteName || result.site_name || domainOf(result.url), 100);
        const published = clean(result.published || result.date || result.age, 80);
        return [site, published].filter(Boolean).join(' · ');
    }

    function normalizeResult(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const url = safeHttpUrl(raw.url || raw.link);
        const title = clean(raw.title || domainOf(url) || 'Untitled source', 220);
        const snippet = clean(raw.snippet || raw.extract || raw.description, 420);
        const siteName = clean(raw.siteName || raw.site_name || domainOf(url), 100);
        const published = clean(raw.published || raw.date || raw.age, 80);
        if (!title && !snippet) return null;
        return { title, snippet, url, siteName, published };
    }

    function normalizeResults(results, max = MAX_SOURCES) {
        return (Array.isArray(results) ? results : [])
            .map(normalizeResult)
            .filter(Boolean)
            .slice(0, Math.max(1, Math.min(MAX_SOURCES, Number(max) || MAX_SOURCES)));
    }

    /** Whether answer text contains a URL/Markdown-link surface that should stay out of chat. */
    function hasVisibleLinkSyntax(text) {
        return /https?:\/\/|\bwww\.|\[[^\]]{1,180}\]\s*\\?\(/i.test(String(text || ''));
    }

    /** Search answers should synthesize findings; the source panel owns the result list. */
    function looksLikeResultDump(text) {
        const value = String(text || '');
        const numbered = value.match(/(?:^|\s)\d{1,2}[.)]\s+(?:\*{0,2})?\S/g) || [];
        const resultIntro = /\b(?:top|search|web|internet)\s+results?\b|\bhere (?:are|is)\b.{0,40}\bresults?\b/i.test(
            value
        );
        return (hasVisibleLinkSyntax(value) && (numbered.length >= 2 || resultIntro)) || numbered.length >= 5;
    }

    /**
     * Remove transport/navigation syntax from assistant prose.
     *
     * This is a last-mile guard, not a Markdown renderer. SearchQuality asks the model for plain
     * synthesis first. If a weak provider still emits links, we preserve the human-readable
     * label and remove the URL rather than putting provider-specific Markdown into the chat.
     */
    function cleanAssistantAnswer(text) {
        let value = String(text == null ? '' : text).trim();
        if (!value) return '';

        // Models sometimes escape Markdown parentheses when the UI itself is plain text.
        value = value.replace(/\\\(/g, '(').replace(/\\\)/g, ')');

        // Nested form seen in real transcripts: [label]([https://x](https://x)).
        value = value.replace(
            /\[([^\]\n]{1,240})\]\(\s*\[https?:\/\/[^\]\s]+\]\(\s*https?:\/\/[^)\s]+\s*\)\s*\)/gi,
            '$1'
        );
        // Standard Markdown links and autolinks: retain label, drop destination.
        value = value.replace(/\[([^\]\n]{1,240})\]\(\s*https?:\/\/[^)\s]+\s*\)/gi, '$1');
        value = value.replace(/<https?:\/\/[^>\s]+>/gi, '');
        // Raw URLs must not become visible text or auto-linkified history.
        value = value.replace(/https?:\/\/[^\s)\]}>,]+/gi, '');
        value = value.replace(/\bwww\.[^\s)\]}>,]+/gi, '');

        // The chat surface is plain text. Remove only lightweight emphasis markers that would
        // otherwise show literally; do not attempt to interpret arbitrary Markdown/HTML.
        value = value.replace(/\\([*_`~])/g, '$1');
        value = value.replace(/\*\*([^*\n]+)\*\*/g, '$1');
        value = value.replace(/__([^_\n]+)__/g, '$1');
        value = value.replace(/`([^`\n]+)`/g, '$1');

        // Clean punctuation left behind by stripped URLs while preserving paragraphs/lists.
        value = value
            .split(/\n+/)
            .map((line) =>
                line
                    .replace(/\[\s*\]\s*\(\s*\)/g, '')
                    .replace(/\(\s*\)/g, '')
                    .replace(/[ \t]{2,}/g, ' ')
                    .trim()
            )
            .filter((line) => line && !/^[\-–—|:;,.)\s]+$/.test(line))
            .join('\n')
            .replace(/\s+([,.;:!?])/g, '$1')
            .replace(/(?:^|\n)(?:more|source|link|url)\s*:\s*$/gi, '')
            .trim();

        return value;
    }

    function plainSources(results, max = 4) {
        const rows = normalizeResults(results, max);
        if (!rows.length) return '';
        return [
            'Sources:',
            ...rows.map((r, index) => {
                const meta = sourceMeta(r);
                return `${index + 1}. ${r.title}${meta ? ` — ${meta}` : ''}`;
            }),
        ].join('\n');
    }

    function ensureStylesheet() {
        try {
            const doc = global && global.document;
            if (!doc || doc.querySelector('link[data-nexus-search-presentation-style]')) return;
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'src/features/research/SearchPresentation.css';
            link.setAttribute('data-nexus-search-presentation-style', '1');
            doc.head.appendChild(link);
        } catch (_) {
            /* Styling is progressive; the semantic structure still works without it. */
        }
    }

    function readPanels() {
        try {
            const raw = global.localStorage?.getItem(STORAGE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            const now = Date.now();
            return (Array.isArray(list) ? list : []).filter(
                (item) => item && item.createdAt && now - item.createdAt <= PANEL_TTL_MS
            );
        } catch (_) {
            return [];
        }
    }

    function writePanels(list) {
        try {
            global.localStorage?.setItem(
                STORAGE_KEY,
                JSON.stringify((Array.isArray(list) ? list : []).slice(-MAX_PANELS))
            );
        } catch (_) {
            /* Storage is optional; current-session rendering still works. */
        }
    }

    function clearPersistedPanels() {
        try {
            global.localStorage?.removeItem(STORAGE_KEY);
        } catch (_) {}
    }

    function looksLikeLegacyFlattenedSourceText(text) {
        return /^\s*\d+\s+sources?\s*[·•-]/i.test(String(text || ''));
    }

    /** Remove source cards that old builds flattened into ordinary assistant history. */
    function migrateLegacyFlattenedSources() {
        let removed = 0;
        try {
            const raw = global.localStorage?.getItem(CHAT_DISPLAY_KEY);
            if (raw) {
                const items = JSON.parse(raw);
                if (Array.isArray(items)) {
                    const filtered = items.filter((item) => {
                        const legacy = item && item.sender !== 'user' && looksLikeLegacyFlattenedSourceText(item.text);
                        if (legacy) removed += 1;
                        return !legacy;
                    });
                    if (filtered.length !== items.length) {
                        global.localStorage?.setItem(CHAT_DISPLAY_KEY, JSON.stringify(filtered));
                    }
                }
            }
        } catch (_) {
            /* A corrupt/disabled store should not block current rendering. */
        }

        try {
            const doc = global && global.document;
            const chat = doc && doc.getElementById('chat-history');
            if (chat) {
                [...chat.querySelectorAll('.chat-row')].forEach((row) => {
                    if (row.classList.contains('nexus-search-results-row')) return;
                    const msg = row.querySelector('.chat-message.avatar');
                    const text = msg?.querySelector('.message-text')?.textContent || '';
                    if (looksLikeLegacyFlattenedSourceText(text)) row.remove();
                });
            }
        } catch (_) {}
        return removed;
    }

    function persistedDisplayExists() {
        try {
            const raw = global.localStorage?.getItem(CHAT_DISPLAY_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length > 0;
        } catch (_) {
            return false;
        }
    }

    function persistedRowCount(chat) {
        if (!chat) return 0;
        return [...chat.querySelectorAll('.chat-row')].filter((row) => row.querySelector('.chat-message')).length;
    }

    function savePanel(query, results, afterDisplayIndex, id) {
        const panel = {
            id,
            query: clean(query, 180),
            results: normalizeResults(results),
            afterDisplayIndex: Math.max(0, Number(afterDisplayIndex) || 0),
            createdAt: Date.now(),
        };
        const existing = readPanels().filter((item) => item.id !== id);
        existing.push(panel);
        writePanels(existing);
        return panel;
    }

    function openSource(url) {
        const safe = safeHttpUrl(url);
        if (!safe) return false;
        try {
            const opened = global.open?.(safe, '_blank', 'noopener,noreferrer');
            if (opened) {
                try {
                    opened.opener = null;
                } catch (_) {}
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function buildSourceRow(results, query, options = {}) {
        const doc = global && global.document;
        if (!doc) return null;
        const max = options.max == null ? 4 : options.max;
        const rows = normalizeResults(results, max);
        if (!rows.length) return null;
        const id = options.id || `sources-${Date.now()}-${++panelSeq}`;

        const row = doc.createElement('div');
        row.className = 'chat-row nexus-search-results-row';
        row.setAttribute('data-nexus-source-panel', id);

        // Intentionally NOT `.chat-message`: main.js serializes those to plain text history.
        const panel = doc.createElement('section');
        panel.className = 'nexus-search-results';
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-label', `Sources for ${clean(query, 120) || 'web search'}`);

        const header = doc.createElement('div');
        header.className = 'nexus-search-results-header';

        const label = doc.createElement('span');
        label.className = 'nexus-search-results-label';
        label.textContent = 'Sources';

        const count = doc.createElement('span');
        count.className = 'nexus-search-results-count';
        count.textContent = `${rows.length} source${rows.length === 1 ? '' : 's'}`;

        header.appendChild(label);
        header.appendChild(count);
        panel.appendChild(header);

        const subject = clean(query, 160);
        if (subject) {
            const subjectEl = doc.createElement('div');
            subjectEl.className = 'nexus-search-results-subject';
            subjectEl.textContent = subject;
            panel.appendChild(subjectEl);
        }

        const list = doc.createElement('div');
        list.className = 'nexus-search-results-list';

        rows.forEach((result, index) => {
            const card = doc.createElement(result.url ? 'button' : 'div');
            card.className = 'nexus-search-result-card';
            card.setAttribute('data-source-index', String(index + 1));
            if (result.url) {
                card.type = 'button';
                card.setAttribute('aria-label', `Open source ${index + 1}: ${result.title}`);
                card.addEventListener('click', () => openSource(result.url));
            }

            const top = doc.createElement('div');
            top.className = 'nexus-search-result-topline';

            const badge = doc.createElement('span');
            badge.className = 'nexus-search-result-index';
            badge.textContent = String(index + 1);

            const title = doc.createElement('span');
            title.className = 'nexus-search-result-title';
            title.textContent = result.title;

            top.appendChild(badge);
            top.appendChild(title);
            if (result.url) {
                const arrow = doc.createElement('span');
                arrow.className = 'nexus-search-result-open';
                arrow.textContent = '↗';
                arrow.setAttribute('aria-hidden', 'true');
                top.appendChild(arrow);
            }
            card.appendChild(top);

            const meta = sourceMeta(result);
            if (meta) {
                const metaEl = doc.createElement('div');
                metaEl.className = 'nexus-search-result-meta';
                metaEl.textContent = meta;
                card.appendChild(metaEl);
            }

            if (result.snippet) {
                const snippet = doc.createElement('div');
                snippet.className = 'nexus-search-result-snippet';
                snippet.textContent = cleanAssistantAnswer(result.snippet);
                card.appendChild(snippet);
            }

            list.appendChild(card);
        });

        panel.appendChild(list);
        row.appendChild(panel);
        return row;
    }

    function renderSourceCards(results, query, options = {}) {
        const doc = global && global.document;
        const chat = doc && doc.getElementById('chat-history');
        if (!doc || !chat) return null;
        const row = buildSourceRow(results, query, options);
        if (!row) return null;

        if (options.afterNode && options.afterNode.parentElement) options.afterNode.after(row);
        else chat.appendChild(row);
        chat.scrollTop = chat.scrollHeight;

        if (options.persist !== false) {
            const displayCount = persistedRowCount(chat);
            const id = row.getAttribute('data-nexus-source-panel');
            savePanel(query, results, Math.max(0, displayCount - 1), id);
        }
        return row;
    }

    function restoreSourcePanels() {
        restoreScheduled = false;
        const doc = global && global.document;
        const chat = doc && doc.getElementById('chat-history');
        if (!doc || !chat) return 0;

        if (!persistedDisplayExists()) {
            clearPersistedPanels();
            return 0;
        }

        const displayRows = [...chat.querySelectorAll('.chat-row')].filter((row) => row.querySelector('.chat-message'));
        if (!displayRows.length) return 0;

        let restored = 0;
        readPanels().forEach((panel) => {
            if (!panel || !panel.id || chat.querySelector(`[data-nexus-source-panel="${panel.id}"]`)) return;
            const target = displayRows[panel.afterDisplayIndex];
            if (!target) return;
            const row = buildSourceRow(panel.results, panel.query, { id: panel.id, max: MAX_SOURCES });
            if (!row) return;
            target.after(row);
            restored += 1;
        });
        return restored;
    }

    function scheduleRestore() {
        if (restoreScheduled || !global || typeof global.setTimeout !== 'function') return;
        restoreScheduled = true;
        global.setTimeout(restoreSourcePanels, 75);
    }

    function observeConversationClear() {
        const doc = global && global.document;
        const chat = doc && doc.getElementById('chat-history');
        if (!chat || observedChat === chat || typeof global.MutationObserver !== 'function') return;
        observedChat = chat;
        hadConversation = hadConversation || persistedDisplayExists() || Boolean(chat.querySelector('.chat-message'));
        const observer = new global.MutationObserver(() => {
            const hasMessages = Boolean(chat.querySelector('.chat-message'));
            if (hasMessages) {
                hadConversation = true;
                return;
            }
            if (hadConversation && chat.querySelector('.empty-state')) {
                clearPersistedPanels();
                hadConversation = false;
            }
        });
        observer.observe(chat, { childList: true, subtree: true });
    }

    function install() {
        if (!global) return false;
        const ux = global.NEXUS_SEARCH_UX;
        if (!ux) return false;

        ensureStylesheet();
        migrateLegacyFlattenedSources();
        // Patch the existing UX API so both SearchUX and SearchQuality use one presentation path.
        ux.renderSourceCards = renderSourceCards;
        ux.plainSources = plainSources;
        ux.cleanAssistantAnswer = cleanAssistantAnswer;
        ux.hasVisibleLinkSyntax = hasVisibleLinkSyntax;
        ux.looksLikeResultDump = looksLikeResultDump;
        ux.openSource = openSource;

        observeConversationClear();
        scheduleRestore();
        installed = true;
        return true;
    }

    function autoInstall() {
        if (install()) return;
        installAttempts += 1;
        if (installAttempts < 80 && global && typeof global.setTimeout === 'function')
            global.setTimeout(autoInstall, 25);
    }

    const api = {
        STORAGE_KEY,
        CHAT_DISPLAY_KEY,
        install,
        safeHttpUrl,
        normalizeResult,
        normalizeResults,
        cleanAssistantAnswer,
        hasVisibleLinkSyntax,
        looksLikeResultDump,
        plainSources,
        buildSourceRow,
        renderSourceCards,
        restoreSourcePanels,
        clearPersistedPanels,
        migrateLegacyFlattenedSources,
        looksLikeLegacyFlattenedSourceText,
        openSource,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_SEARCH_PRESENTATION = api;
        if (typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 0);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
