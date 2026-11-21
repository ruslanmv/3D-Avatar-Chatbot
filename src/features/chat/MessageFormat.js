/**
 * MF1. Her replies drawn as formatted text: links you can tap, bold, lists, paragraphs.
 *
 * Why (owner, 2026-11-21). Replies arrive in Markdown, and every bubble was set with
 * `textContent`, so a search answer read like this on the page:
 *
 *     Ecco alcune opzioni …: 1. **Alien Stage Ivan Collectibles**: … [Fonte](https://www.amazon.com/
 *     alien-stage-ivan/s?k=alien+stage+ivan) 2. **Ivan Plush su Etsy**: … [Fonte](https://www.etsy…
 *
 * Stars around names, brackets, and 120-character URLs a person cannot tap, all in one run-on
 * line. Now the same reply is a short lead, a numbered list with the names in bold, and each
 * source a link labelled "Fonte" with its site (amazon.com) beside it.
 *
 * Safe by construction. Nothing here is ever given to `innerHTML`: the reply is model text and
 * may contain anything, so it is split into tokens and built with `createElement` and
 * `textContent`. Only `http:`/`https:` links become anchors (a `javascript:` link stays text),
 * and every anchor opens in a new tab with `rel="noopener noreferrer nofollow"`.
 *
 * Speech is not this file's job: `SpeechTextNormalizer.forSpeech` already reads the same reply
 * as "1. Alien Stage: su Amazon. Fonte 2. …", without URLs or stars.
 *
 * Pure parts (`blocks`, `inline`) take strings and return plain objects, so they are tested
 * without a DOM; `render(el, text)` is the only part that touches elements.
 */
(function (global) {
    'use strict';

    const LINK = /^https?:\/\//i;

    /** amazon.com from https://www.amazon.com/alien-stage-ivan/s?k=… (the URL itself if unreadable). */
    function siteOf(url) {
        try {
            return new URL(url).hostname.replace(/^www\./i, '');
        } catch (_) {
            return String(url);
        }
    }

    /*
     * Inline pieces, left to right: a Markdown link, a bare URL, **bold**, `code`, *italic*.
     * A bare URL stops before trailing punctuation that ends the sentence, not the link.
     */
    const INLINE =
        /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»”])|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g;

    /** Pure: the tokens of one line — `{ t: 'text'|'link'|'bold'|'code'|'em', … }`. */
    function inline(text) {
        const out = [];
        const s = String(text || '');
        let at = 0;
        INLINE.lastIndex = 0;
        let m;
        while ((m = INLINE.exec(s))) {
            if (m.index > at) out.push({ t: 'text', text: s.slice(at, m.index) });
            if (m[1] !== undefined) out.push({ t: 'link', text: m[1], href: m[2], site: siteOf(m[2]) });
            else if (m[3] !== undefined) out.push({ t: 'link', text: siteOf(m[3]), href: m[3], site: null });
            else if (m[4] !== undefined || m[5] !== undefined) out.push({ t: 'bold', text: m[4] || m[5] });
            else if (m[6] !== undefined) out.push({ t: 'code', text: m[6] });
            else if (m[7] !== undefined) out.push({ t: 'em', text: m[7] });
            at = INLINE.lastIndex;
        }
        if (at < s.length) out.push({ t: 'text', text: s.slice(at) });
        return out;
    }

    /*
     * A list the model wrote on one line ("…: 1. **A**: … 2. **B**: … 3. …"), as the reply above
     * arrived: split only when the numbers run 1, 2, 3… in order, each after a space or colon,
     * so "versione 2. " or "3.5" inside a sentence is never taken for an item.
     */
    function inlineNumbered(par) {
        const marks = [];
        const re = /(^|[\s:])(\d{1,2})\.\s+(?=\S)/g;
        let m;
        while ((m = re.exec(par))) marks.push({ n: Number(m[2]), at: m.index + m[1].length, end: re.lastIndex });
        const run = [];
        for (const mark of marks) if (mark.n === run.length + 1) run.push(mark);
        if (run.length < 2) return null;
        const lead = par.slice(0, run[0].at).trim();
        const items = run.map((mark, i) => par.slice(mark.end, i + 1 < run.length ? run[i + 1].at : par.length).trim());
        // A closing sentence after the last item ("Spero che queste opzioni ti siano utili!")
        // stays out of the list when it follows a source link or a full stop.
        let tail = '';
        const last = items[items.length - 1];
        const after = last.match(/^(.*?(?:\)|[.!?]))\s+([A-ZÀ-Ý¿¡].{3,})$/s);
        if (after && /\)\s*$|\]\(/.test(after[1])) {
            items[items.length - 1] = after[1].trim();
            tail = after[2].trim();
        }
        return { lead, items, tail };
    }

    /** Pure: the reply as blocks — `{ type: 'p', text }`, `{ type: 'ol'|'ul', items: [text] }`. */
    function blocks(text) {
        const out = [];
        const paragraphs = String(text || '')
            .replace(/\r\n?/g, '\n')
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);
        for (const par of paragraphs) {
            const lines = par.split('\n');
            let list = null;
            let prose = [];
            const flush = () => {
                if (prose.length) out.push({ type: 'p', text: prose.join('\n') });
                prose = [];
            };
            for (const line of lines) {
                const ol = line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
                const ul = line.match(/^\s*[-*•]\s+(.*)$/);
                const kind = ol ? 'ol' : ul ? 'ul' : null;
                if (kind) {
                    flush();
                    if (!list || list.type !== kind) {
                        list = { type: kind, items: [] };
                        out.push(list);
                    }
                    list.items.push((ol || ul)[1]);
                } else if (list && /^\s{2,}\S/.test(line)) {
                    list.items[list.items.length - 1] += ' ' + line.trim(); // a wrapped item
                } else {
                    list = null;
                    prose.push(line);
                }
            }
            flush();
        }
        // One-line lists inside a prose paragraph.
        const expanded = [];
        for (const b of out) {
            const found = b.type === 'p' && !b.text.includes('\n') ? inlineNumbered(b.text) : null;
            if (!found) {
                expanded.push(b);
                continue;
            }
            if (found.lead) expanded.push({ type: 'p', text: found.lead });
            expanded.push({ type: 'ol', items: found.items });
            if (found.tail) expanded.push({ type: 'p', text: found.tail });
        }
        return expanded;
    }

    function inlineInto(doc, parent, text) {
        for (const tok of inline(text)) {
            if (tok.t === 'text') {
                const parts = tok.text.split('\n');
                parts.forEach((part, i) => {
                    if (i) parent.appendChild(doc.createElement('br'));
                    if (part) parent.appendChild(doc.createTextNode(part));
                });
            } else if (tok.t === 'link' && LINK.test(tok.href)) {
                const a = doc.createElement('a');
                a.className = 'nexus-msg-link';
                a.href = tok.href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer nofollow';
                a.title = tok.href;
                a.textContent = tok.text;
                parent.appendChild(a);
                if (tok.site && tok.site.toLowerCase() !== tok.text.toLowerCase()) {
                    const site = doc.createElement('span');
                    site.className = 'nexus-msg-site';
                    site.textContent = tok.site;
                    parent.appendChild(site);
                }
            } else if (tok.t === 'bold' || tok.t === 'em' || tok.t === 'code') {
                const el = doc.createElement(tok.t === 'bold' ? 'strong' : tok.t === 'em' ? 'em' : 'code');
                el.textContent = tok.text;
                parent.appendChild(el);
            } else {
                parent.appendChild(doc.createTextNode(tok.text || ''));
            }
        }
    }

    /** Draw `text` into `el`, replacing what was there. Plain text, if anything goes wrong. */
    function render(el, text) {
        if (!el) return;
        const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const value = String(text || '');
        try {
            el.textContent = '';
            el.classList && el.classList.add('nexus-msg-formatted');
            for (const b of blocks(value)) {
                if (b.type === 'p') {
                    const p = doc.createElement('p');
                    inlineInto(doc, p, b.text);
                    el.appendChild(p);
                } else {
                    const list = doc.createElement(b.type);
                    for (const item of b.items) {
                        const li = doc.createElement('li');
                        inlineInto(doc, li, item);
                        list.appendChild(li);
                    }
                    el.appendChild(list);
                }
            }
        } catch (error) {
            console.warn('[MessageFormat] shown as plain text', error);
            el.textContent = value;
        }
    }

    const api = { render, blocks, inline, siteOf };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_MESSAGE_FORMAT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
