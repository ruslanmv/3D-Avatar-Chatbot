/**
 * ConversationPresentation — last-mile compatibility for visible chat output.
 *
 * This module owns presentation-only fixes that must not depend on a specific LLM:
 * - search control tags such as <lookup>...</lookup> never reach the transcript;
 * - retrieval placeholders such as "Let me check..." are treated as empty so SearchQuality retries;
 * - web source panels are placed before the grounded answer and keep that order after reload;
 * - legacy inline avatar tags such as [[wave:1]] render as emoji instead of raw control syntax.
 *
 * Exposes: window.NEXUS_CONVERSATION_PRESENTATION
 */
(function (global) {
    'use strict';

    const EMOJI = Object.freeze({
        wave: '👋',
        hello: '👋',
        happy: '😊',
        smile: '😊',
        laugh: '😄',
        excited: '🤩',
        love: '❤️',
        sad: '😔',
        angry: '😠',
        surprised: '😮',
        thinking: '🤔',
        celebrate: '🎉',
        dance: '💃',
        flirt: '😉',
        tease: '😏',
        shy: '😊',
        agree: '👍',
        disagree: '👎',
        nod: '👍',
        wink: '😉',
        idle: '',
    });

    const CANONICAL_EMOTE = /\[\[\s*emote\s*:\s*[a-z_]+(?:\s+[01](?:\.\d+)?)?\s*\]\]/gi;
    const LEGACY_EMOTE = /\[\[\s*([a-z_]+)\s*(?:(?::|\s+)\s*([01](?:\.\d+)?))?\s*\]\]/gi;
    const PARTIAL_EMOTE_TAIL = /\[\[\s*(?:emote\s*:\s*)?[a-z_]*(?:(?::|\s+)\s*[01]?(?:\.\d*)?)?\s*\]?\s*$/i;

    let searchPatched = false;
    let motionPatched = false;
    let installAttempts = 0;

    function tidy(text) {
        return String(text == null ? '' : text)
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+([,.;:!?])/g, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Render legacy shorthand tags as Unicode emoji. Canonical [[emote:...]] tags remain an
     * invisible body-control channel: when Behavior Director is enabled it acts on them; when
     * it is disabled this guard still prevents the raw tag from leaking into chat/TTS.
     */
    function renderLegacyEmotes(text, options = {}) {
        let value = String(text == null ? '' : text);
        if (!value) return '';

        value = value.replace(CANONICAL_EMOTE, '');
        value = value.replace(LEGACY_EMOTE, (_whole, rawName) => {
            const name = String(rawName || '').toLowerCase();
            return Object.prototype.hasOwnProperty.call(EMOJI, name) ? EMOJI[name] : '';
        });

        if (options.streaming) value = value.replace(PARTIAL_EMOTE_TAIL, '');
        return tidy(value);
    }

    function stripLookupControl(text) {
        let value = String(text == null ? '' : text);
        const lookup = global && global.NEXUS_LOOKUP;
        try {
            if (lookup && typeof lookup.extract === 'function') {
                const extracted = lookup.extract(value);
                if (extracted && typeof extracted.clean === 'string') value = extracted.clean;
            }
        } catch (_) {}

        // Last-resort forms for providers/exporters that escaped the angle brackets.
        value = value
            .replace(/\\?<lookup\b[^>]*>[\s\S]*?<\/lookup\s*>/gi, ' ')
            .replace(/&lt;lookup\b[^&]*&gt;[\s\S]*?&lt;\/lookup\s*&gt;/gi, ' ');
        return tidy(value);
    }

    function isRetrievalPlaceholder(text) {
        const value = tidy(text);
        if (!value) return true;
        const words = value.split(/\s+/).filter(Boolean);
        if (words.length > 34) return false;
        return /^(?:(?:sure|okay|ok|certainly|of course)[,!]?\s+)?(?:(?:let me|i(?:'ll| will))\s+(?:check|search|look\s*up|find|verify)|i(?:'m| am)\s+(?:checking|searching|looking\s*up|finding|verifying))\b/i.test(
            value
        );
    }

    function cleanSearchAnswer(text, baseCleaner) {
        let value = stripLookupControl(text);
        value = renderLegacyEmotes(value);
        if (typeof baseCleaner === 'function') value = baseCleaner(value);
        value = String(value == null ? '' : value)
            .split(/\n+/)
            .filter((line) => line.trim().toLowerCase() !== 'svg')
            .join('\n')
            .trim();
        if (isRetrievalPlaceholder(value)) return '';
        return value;
    }

    function repairPanelAnchor(row, displayRows) {
        try {
            const presentation = global.NEXUS_SEARCH_PRESENTATION;
            const key = presentation?.STORAGE_KEY || 'nexus_search_source_panels_v1';
            const id = row?.getAttribute?.('data-nexus-source-panel');
            if (!id || !global.localStorage) return;
            const raw = global.localStorage.getItem(key);
            const panels = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(panels)) return;
            const target = panels.find((panel) => panel && panel.id === id);
            if (!target) return;
            // Source panel belongs after the latest USER row and before the assistant answer.
            target.afterDisplayIndex = Math.max(0, displayRows.length - 2);
            global.localStorage.setItem(key, JSON.stringify(panels));
        } catch (_) {}
    }

    function patchSearchPresentation() {
        const presentation = global && global.NEXUS_SEARCH_PRESENTATION;
        if (!presentation || searchPatched) return Boolean(presentation && searchPatched);

        const originalClean =
            typeof presentation.cleanAssistantAnswer === 'function'
                ? presentation.cleanAssistantAnswer.bind(presentation)
                : (value) => String(value == null ? '' : value).trim();
        const originalRender =
            typeof presentation.renderSourceCards === 'function'
                ? presentation.renderSourceCards.bind(presentation)
                : null;

        function cleaned(text) {
            return cleanSearchAnswer(text, originalClean);
        }

        function sourcesFirst(results, query, options = {}) {
            if (!originalRender) return null;
            const row = originalRender(results, query, options);
            const doc = global.document;
            const chat = doc && doc.getElementById('chat-history');
            if (!row || !chat) return row;

            const displayRows = [...chat.querySelectorAll('.chat-row')].filter((candidate) =>
                candidate.querySelector('.chat-message')
            );
            const latest = displayRows[displayRows.length - 1];
            const latestMessage = latest?.querySelector('.chat-message');

            // SearchQuality publishes the answer first, then calls the source renderer. Move only
            // that exact shape. A cached "show results" command has a user row as latest and stays put.
            if (
                latest &&
                latestMessage?.classList.contains('avatar') &&
                row.parentElement === chat &&
                row.previousElementSibling === latest
            ) {
                chat.insertBefore(row, latest);
                repairPanelAnchor(row, displayRows);
            }
            chat.scrollTop = chat.scrollHeight;
            return row;
        }

        presentation.cleanAssistantAnswer = cleaned;
        if (originalRender) presentation.renderSourceCards = sourcesFirst;

        // SearchQuality dynamically prefers NEXUS_SEARCH_PRESENTATION, while older SearchUX code
        // reads these methods from its own API. Keep both surfaces consistent.
        const ux = global.NEXUS_SEARCH_UX;
        if (ux) {
            ux.cleanAssistantAnswer = cleaned;
            if (originalRender) ux.renderSourceCards = sourcesFirst;
        }

        searchPatched = true;
        return true;
    }

    function wrapMotionMethod(motion, method, streaming) {
        const current = motion && motion[method];
        if (typeof current !== 'function' || current.__nexusConversationPresentationWrapped) return false;
        function wrapped(text) {
            let out;
            try {
                out = current.call(motion, text);
            } catch (_) {
                out = text;
            }
            return renderLegacyEmotes(out, { streaming });
        }
        wrapped.__nexusConversationPresentationWrapped = true;
        wrapped.__nexusConversationPresentationOriginal = current;
        motion[method] = wrapped;
        return true;
    }

    function patchMotionPresentation() {
        const motion = global && global.NEXUS_MOTION;
        if (!motion) return false;
        wrapMotionMethod(motion, 'processReply', false);
        wrapMotionMethod(motion, 'maskStreaming', true);
        motionPatched = true;
        return true;
    }

    function install() {
        const search = patchSearchPresentation();
        const motion = patchMotionPresentation();
        return Boolean(search || motion);
    }

    function autoInstall() {
        install();
        if (searchPatched && motionPatched) return;
        installAttempts += 1;
        if (installAttempts < 120 && global && typeof global.setTimeout === 'function') {
            global.setTimeout(autoInstall, 25);
        }
    }

    const api = {
        EMOJI,
        install,
        renderLegacyEmotes,
        stripLookupControl,
        isRetrievalPlaceholder,
        cleanSearchAnswer,
        patchSearchPresentation,
        patchMotionPresentation,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_CONVERSATION_PRESENTATION = api;
        if (typeof global.setTimeout === 'function') global.setTimeout(autoInstall, 0);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
