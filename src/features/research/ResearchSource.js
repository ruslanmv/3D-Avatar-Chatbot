/**
 * One shape for anything she read before teaching (batch S1).
 *
 * Wikipedia returns one thing, a web search returns another, and a third source will return a
 * third. The study loop should not know or care — it needs a title, some text, and a link it
 * can cite. So they all become this, at the edge, once.
 *
 * ## Every field here is written by a stranger
 *
 * That is the whole reason this file caps and cleans rather than passing text through. This
 * material goes into a system prompt next to real instructions, which is the textbook shape of
 * a prompt-injection sink — and a web result is a far dirtier one than a Wikipedia extract,
 * because anybody can publish a page containing the words "ignore your instructions".
 *
 * The defence is in three parts and this is the first: bound the size, strip the fence markers
 * so text cannot forge a section boundary, and collapse whitespace so it cannot forge a line.
 * `StudyPrompt` supplies the other two — it labels the block as data and puts the instruction
 * above it rather than below.
 *
 * Exposes: window.NEXUS_RESEARCH_SOURCE
 */
(function (global) {
    'use strict';

    /** Per-field ceilings. An article body is unbounded; a prompt is not. */
    const CAPS = { title: 200, extract: 2400, snippet: 600, description: 200, url: 600, source: 24 };

    /** The markers `StudyPrompt` fences with. Stripped here so no text can forge one. */
    const FENCE = /<<<[^>]*>>>/g;

    function clean(value, max) {
        return String(value === null || value === undefined ? '' : value)
            .replace(FENCE, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    /**
     * Normalise one result.
     *
     * `null` for anything with neither a title nor text, because a citation with nothing in it
     * is worse than one fewer source — it looks like grounding and is not.
     */
    function one(raw, { source = 'web' } = {}) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const out = {
            id: clean(raw.id || raw.title, 120),
            source: clean(raw.source || source, CAPS.source),
            title: clean(raw.title, CAPS.title),
            description: clean(raw.description, CAPS.description),
            extract: clean(raw.extract, CAPS.extract),
            snippet: clean(raw.snippet, CAPS.snippet),
            url: clean(raw.url, CAPS.url),
        };
        if (!out.title && !out.extract && !out.snippet) {
            return null;
        }
        return out;
    }

    function many(list, options) {
        return (Array.isArray(list) ? list : []).map((item) => one(item, options)).filter(Boolean);
    }

    /** The text a source actually contributes to the prompt. */
    function textOf(source) {
        if (!source) {
            return '';
        }
        return source.extract || source.snippet || '';
    }

    const api = { CAPS, clean, one, many, textOf };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_RESEARCH_SOURCE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
