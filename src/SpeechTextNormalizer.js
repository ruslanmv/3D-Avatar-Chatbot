'use strict';

/**
 * SpeechTextNormalizer — turn Markdown into something worth listening to.
 * =======================================================================
 *
 * Models write Markdown whether or not anyone asked them to. Fed straight to a
 * speech engine that becomes "asterisk asterisk important asterisk asterisk",
 * pound signs read as "hash", and a URL spelled out character by character.
 *
 * What modern assistant voices do, and what this follows:
 *
 *   - Emphasis is DROPPED, not spoken. Prosody carries it, or it is lost;
 *     either beats vocalising the punctuation.
 *   - Links are read by their TEXT. Nobody wants a URL read aloud.
 *   - Code blocks are NOT read. A short spoken placeholder tells the listener
 *     something was skipped without reciting syntax for a minute.
 *   - Tables are flattened to comma-separated cells; pipes and dashes are
 *     noise, and a spoken table is barely comprehensible either way.
 *   - Structure becomes PAUSES. A heading or a list item ends with a sentence
 *     break so the engine's own prosody does the paragraphing.
 *   - Emoji are dropped. Engines otherwise announce "grinning face".
 *
 * NON-DESTRUCTIVE by construction: a pure function returning a new string.
 * It never touches the transcript, the DOM, or what is stored. The chat keeps
 * rendering exactly what the model produced; only the audio path sees this.
 *
 * Additive module: does not modify any existing code.
 *
 * @module SpeechTextNormalizer
 */

const SpeechTextNormalizer = (() => {
    'use strict';

    /**
     * Spoken stand-ins, in the three languages the app ships phrases for.
     * Kept short on purpose: the placeholder is an aside, not the content.
     */
    const PLACEHOLDERS = {
        en: { code: 'code block', codeLang: (l) => l + ' code block', link: 'link', image: 'image' },
        es: { code: 'bloque de código', codeLang: (l) => 'bloque de código ' + l, link: 'enlace', image: 'imagen' },
        it: {
            code: 'blocco di codice',
            codeLang: (l) => 'blocco di codice ' + l,
            link: 'collegamento',
            image: 'immagine',
        },
    };

    /**
     * Emoji and pictographs. Deliberately broad — a speech engine reading
     * "party popper" mid-sentence is worse than dropping the character.
     * Variation selectors and ZWJ are included so compound emoji leave nothing.
     */
    const EMOJI = new RegExp(
        '[\\u{1F000}-\\u{1FAFF}\\u{1F1E6}-\\u{1F1FF}\\u{2600}-\\u{27BF}' +
            '\\u{2B00}-\\u{2BFF}\\u{FE00}-\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}\\u{200D}\\u{20E3}]',
        'gu'
    );

    function _strings(lang) {
        const key = String(lang || 'en')
            .slice(0, 2)
            .toLowerCase();
        return PLACEHOLDERS[key] || PLACEHOLDERS.en;
    }

    /**
     * Flatten a Markdown table to spoken cells.
     *
     * The separator row (|---|:--:|) carries no content and is dropped. Every
     * other row becomes "cell, cell, cell." — imperfect, but a table read as
     * pipes and hyphens is unusable, and dropping it silently loses content.
     *
     * @private
     */
    function _flattenTable(block) {
        const rows = block
            .split('\n')
            .map((r) => r.trim())
            .filter(Boolean)
            .filter((r) => !/^\|?[\s:|-]+\|[\s:|-]*$/.test(r));

        return rows
            .map((r) =>
                r
                    .replace(/^\||\|$/g, '')
                    .split('|')
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .join(', ')
            )
            .filter(Boolean)
            .map((r) => (/[.!?]$/.test(r) ? r : r + '.'))
            .join(' ');
    }

    /**
     * Fold a nested list into its parent as a spoken series.
     *
     * "Gestures:" followed by indented "Wave", "Greeting", "Bow" reads far
     * better as "Gestures: Wave, Greeting, Bow." than as four separate
     * one-word sentences, which is what per-item pauses would produce.
     *
     * @private
     */
    function _collapseNestedLists(text) {
        const lines = text.split('\n');
        const out = [];

        for (const line of lines) {
            const m = line.match(/^([ \t]+)(?:[-*+•]|\d+[.)])\s+(.+)$/);
            if (m && m[1].replace(/\t/g, '    ').length >= 2) {
                let i = out.length - 1;
                while (i >= 0 && !out[i].trim()) i--;
                if (i >= 0) {
                    const item = m[2].trim().replace(/[.,;]+$/, '');
                    const prev = out[i].replace(/\s+$/, '');
                    // A parent ending in ":" already introduces the series;
                    // anything else needs a comma to separate.
                    out[i] = /[:,]$/.test(prev) ? prev + ' ' + item : prev + ', ' + item;
                    out.length = i + 1; // absorb the blank lines we skipped
                    continue;
                }
            }
            out.push(line);
        }
        return out.join('\n');
    }

    /**
     * Rewrite Markdown as plain text a speech engine can read aloud.
     *
     * @param {string} text - Raw model output
     * @param {object} [opts]
     * @param {string} [opts.lang='en'] - Language for spoken placeholders
     * @param {boolean} [opts.speakCodeBlocks=false] - Read code instead of naming it
     * @param {boolean} [opts.stripEmoji=true]
     * @param {number} [opts.maxLength=0] - Truncate at a sentence boundary; 0 = no limit
     * @returns {string} Text to speak. Never null; empty input yields ''.
     */
    function forSpeech(text, opts) {
        if (text == null) return '';
        let s = String(text);
        if (!s.trim()) return '';

        const o = opts || {};
        const P = _strings(o.lang);
        const speakCode = o.speakCodeBlocks === true;
        const stripEmoji = o.stripEmoji !== false;

        // Normalise line endings first so every later pattern can trust \n.
        s = s.replace(/\r\n?/g, '\n');

        // --- Fenced code blocks -------------------------------------------
        // Before anything else: their contents must not be interpreted as
        // Markdown. An unterminated fence (a truncated stream) is matched to
        // end-of-string rather than left to leak backticks into the audio.
        s = s.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, body) => {
            if (speakCode) return ' ' + body.trim() + ' ';
            const tag = String(lang || '')
                .trim()
                .split(/\s+/)[0];
            return ' ' + (tag ? P.codeLang(tag) : P.code) + '. ';
        });
        // Indented code blocks. Deliberately narrow: a NESTED LIST is also
        // indented, and models emit those constantly while almost never
        // emitting indented code (they use fences). Swallowing a nested list
        // as "code block" loses the content outright — reading a stray
        // indented snippet aloud merely sounds odd. So this requires a blank
        // line before the block, at least two lines, and that no line begins
        // with a list marker.
        if (!speakCode) {
            s = s.replace(/(\n[ \t]*\n)((?: {4}|\t)[^\n]*(?:\n(?: {4}|\t)[^\n]*)+)/g, (m, gap, block) => {
                const isList = block.split('\n').some((l) => /^\s*(?:[-*+•]|\d+[.)])\s/.test(l));
                return isList ? m : gap + P.code + '. ';
            });
        }

        // --- HTML ---------------------------------------------------------
        s = s.replace(/<!--[\s\S]*?-->/g, ' ');
        s = s.replace(/<br\s*\/?>/gi, '\n');
        s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '.\n');
        s = s.replace(/<[^>]+>/g, ' ');

        // --- Tables -------------------------------------------------------
        // Matched as whole blocks: two or more consecutive pipe-bearing lines.
        s = s.replace(/(?:^|\n)((?:[^\n]*\|[^\n]*\n?){2,})/g, (m, block) => '\n' + _flattenTable(block) + '\n');

        // --- Links and images ---------------------------------------------
        s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (alt.trim() ? alt : P.image));
        s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // inline link → its text
        s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'); // reference link → its text
        s = s.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ''); // reference definitions
        s = s.replace(/<((?:https?|mailto):[^>]+)>/gi, ' ' + P.link + ' '); // autolink
        s = s.replace(/(^|\s)(?:https?:\/\/|www\.)\S+/gi, '$1' + P.link); // bare URL

        // --- Inline code ---------------------------------------------------
        // The word inside usually matters ("call `stop`"), so keep it and drop
        // the backticks.
        s = s.replace(/``([^`]+)``/g, '$1');
        s = s.replace(/`([^`\n]+)`/g, '$1');

        // --- Emphasis -------------------------------------------------------
        s = s.replace(/(\*\*\*|___)(\S[\s\S]*?\S|\S)\1/g, '$2'); // bold+italic
        s = s.replace(/(\*\*|__)(\S[\s\S]*?\S|\S)\1/g, '$2'); // bold
        s = s.replace(/\*(\S[^*\n]*?\S|\S)\*/g, '$1'); // italic
        // Underscore italics only at word boundaries, so snake_case survives:
        // "pair_token" must not become "pairtoken".
        s = s.replace(/(^|[\s(“"'])_(\S[^_\n]*?\S|\S)_(?=$|[\s).,!?:;”"'])/g, '$1$2');
        s = s.replace(/~~([\s\S]+?)~~/g, '$1'); // strikethrough
        s = s.replace(/==([\s\S]+?)==/g, '$1'); // highlight

        // --- Block structure → pauses ---------------------------------------
        s = _collapseNestedLists(s);

        // Some models write a list inline: "Gestures: + Wave + Greeting + Bow".
        // Spoken verbatim that is "plus Wave plus Greeting". Only a RUN of two
        // or more markers introduced by a colon is treated as a list, so
        // arithmetic ("2 + 2") and names ("C++") are untouched.
        s = s.replace(/:\s*((?:[+*•]\s+[^\n+*•]+){2,})/g, (m, run) => {
            const items = run
                .split(/\s*[+*•]\s+/)
                .map((x) => x.trim().replace(/[.,;]+$/, ''))
                .filter(Boolean);
            return items.length >= 2 ? ': ' + items.join(', ') : m;
        });
        s = s.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (m, t) => (/[.!?:]$/.test(t) ? t : t + '.'));
        s = s.replace(/^\s{0,3}>\s?/gm, ''); // blockquote markers
        s = s.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ''); // horizontal rules

        // Ordered list numbers are kept — "1." genuinely helps a listener
        // follow steps — but bullet glyphs are dropped and each item is closed
        // so the engine pauses between them.
        s = s.replace(/^\s*\d+[.)]\s+(.+)$/gm, (m, t) => (/[.!?;:]$/.test(t) ? m : m + '.'));
        s = s.replace(/^\s*[-*+•]\s+(.+)$/gm, (m, t) => (/[.!?;:]$/.test(t) ? t : t + '.'));
        s = s.replace(/^\s*\[[ xX]\]\s+/gm, ''); // task-list checkboxes

        // --- Leftovers -------------------------------------------------------
        s = s.replace(/\[\^[^\]]+\]/g, ''); // footnote refs
        if (stripEmoji) s = s.replace(EMOJI, ' ');

        // An escaped character is content the author wanted literally, so it
        // has to survive the leftover sweep below. Park it out of reach first,
        // then restore — unescaping in place would just feed the sweep.
        const ESC = '\u0000';
        s = s.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, (m, ch) => ESC + ch.charCodeAt(0) + ESC);

        // Any emphasis characters that survived (unmatched pairs) would be read
        // aloud, so drop them. Underscores are left alone — see snake_case.
        s = s.replace(/[*`~]/g, '');

        s = s.replace(new RegExp(ESC + '(\\d+)' + ESC, 'g'), (m, code) => String.fromCharCode(+code));

        // --- Whitespace and punctuation --------------------------------------
        s = s.replace(/[ \t]+/g, ' ');
        s = s.replace(/ ?\n ?/g, '\n');
        s = s.replace(/\n{2,}/g, '\n');
        s = s.replace(/\s+([,.!?;:])/g, '$1');
        // A colon already introduces a series; a comma straight after it is an
        // artifact of folding a list whose own parent ended in a colon.
        s = s.replace(/:\s*,+/g, ':');
        s = s.replace(/([.!?])\s*\1+/g, '$1'); // "!!" → "!", ".." → "."
        s = s.replace(/\.\s*\./g, '.');
        s = s.replace(/\n/g, ' ');
        s = s.replace(/\s{2,}/g, ' ').trim();

        if (o.maxLength > 0 && s.length > o.maxLength) {
            const cut = s.slice(0, o.maxLength);
            const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
            s = (stop > o.maxLength * 0.5 ? cut.slice(0, stop + 1) : cut).trim();
        }
        return s;
    }

    /**
     * Is there anything left worth speaking?
     *
     * A reply that was only a code block or only emoji normalises to a bare
     * placeholder or to nothing; callers can use this to stay silent rather
     * than announce "code block" into the void.
     *
     * @param {string} text
     * @param {object} [opts]
     * @returns {boolean}
     */
    function hasSpeakableContent(text, opts) {
        return forSpeech(text, opts).replace(/[^\p{L}\p{N}]/gu, '').length > 0;
    }

    return { forSpeech, hasSpeakableContent, _flattenTable, PLACEHOLDERS };
})();

if (typeof window !== 'undefined') window.NEXUS_SPEECH_TEXT = SpeechTextNormalizer;
if (typeof module !== 'undefined' && module.exports) module.exports = SpeechTextNormalizer;
