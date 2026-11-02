/**
 * PhraseSpeechScheduler — HV5. Streamed reply text in, speakable phrases out. Pure.
 *
 * "Complete reply → synthesize all → play" makes a person wait for the whole answer before
 * hearing the first word. Speaking while the reply streams cuts that to the first sentence —
 * but only if what is sent to the synthesizer is something worth saying once:
 *
 *  - **Whole phrases.** A sentence end (. ! ? … and their CJK forms, or a line break) is the
 *    preferred cut. Short sentences are joined until `minChars`, so "Hi! Sure." is one request,
 *    not two; a long sentence with no end in sight is cut at a clause (, ; :) after `maxWaitMs`
 *    or at `maxChars`, never inside a word.
 *  - **Never speculative.** Text is only cut behind a boundary that later tokens cannot move.
 *    Nothing is re-synthesized when more text arrives.
 *  - **Nothing she should not say.** The model's directives (`<play …>…</play>`,
 *    `<ambience …/>`, `<wardrobe …/>`) and fenced blocks (the ```motion plan) are removed, and
 *    a tag or fence still open is held back until it closes. At the end of the reply,
 *    `consistentWith(final)` checks that what was spoken is still in what the app finally kept
 *    (after every seam in main.js has run); when it is not — a lookup replaced the answer — the
 *    caller cancels and speaks the final text the usual way.
 *  - **Bounded.** Phrases are counted and capped; the caller never sends hundreds of fragments.
 */
(function (global) {
    'use strict';

    const SENTENCE_END = /[.!?…。！？]+["'”’)\]]*(?=\s|$)|\n+/g;
    const CLAUSE_END = /[,;:，；：—–]+(?=\s)/g;

    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    /**
     * Remove complete directives and fences from `text`, and say where the speakable prefix ends
     * (a tag or fence that has not closed yet holds everything from its start).
     * → { clean, held } where `held` is the raw tail kept for later.
     */
    function strip(text) {
        let out = '';
        let i = 0;
        const s = String(text || '');
        while (i < s.length) {
            if (s.startsWith('```', i)) {
                const close = s.indexOf('```', i + 3);
                if (close === -1) return { clean: out, held: s.slice(i) };
                i = close + 3;
                continue;
            }
            if (s[i] === '<' && /[a-zA-Z/]/.test(s[i + 1] || '')) {
                const gt = s.indexOf('>', i);
                if (gt === -1) return { clean: out, held: s.slice(i) };
                const tag = s.slice(i, gt + 1);
                const m = /^<([a-zA-Z][\w-]*)\b[^>]*?(\/)?>$/.exec(tag);
                if (m && !m[2]) {
                    // An opening tag: its content is the directive's payload, not speech.
                    const closeTag = `</${m[1]}>`;
                    const end = s.toLowerCase().indexOf(closeTag.toLowerCase(), gt + 1);
                    if (end === -1) return { clean: out, held: s.slice(i) };
                    i = end + closeTag.length;
                    continue;
                }
                i = gt + 1; // self-closing or a stray closing tag
                continue;
            }
            out += s[i];
            i++;
        }
        return { clean: out, held: '' };
    }

    function lastMatchEnd(re, text, from) {
        re.lastIndex = from || 0;
        let end = -1;
        let m;
        while ((m = re.exec(text))) {
            end = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++;
        }
        return end;
    }

    function create(opts) {
        const o = opts || {};
        const minChars = o.minChars == null ? 24 : o.minChars;
        // The first phrase is the one the person is waiting for: let a short opening sentence
        // ("Sure thing.") go on its own instead of holding it for the next one to end.
        const firstMinChars = Math.min(minChars, o.firstMinChars == null ? 8 : o.firstMinChars);
        const maxChars = o.maxChars == null ? 220 : o.maxChars;
        const maxWaitMs = o.maxWaitMs == null ? 700 : o.maxWaitMs;
        const maxPhrases = o.maxPhrases == null ? 64 : o.maxPhrases;
        const now = o.now || (() => Date.now());
        const later = o.setTimeout || setTimeout;
        const cancelLater = o.clearTimeout || clearTimeout;
        const onPhrase = o.onPhrase || (() => {});
        const clean = o.clean || ((t) => t);

        let raw = ''; // everything received
        let consumed = 0; // chars of the CLEAN text already emitted
        let since = null; // when the oldest unspoken text arrived
        let timer = null;
        let done = false;
        let cancelled = false;
        const spoken = [];

        function speakable() {
            return strip(raw).clean;
        }

        function emit(text) {
            if (cancelled || spoken.length >= maxPhrases) return;
            const said = clean(text).replace(/\s+/g, ' ').trim();
            if (!said || !/[\p{L}\p{N}]/u.test(said)) return;
            spoken.push(said);
            onPhrase(said, spoken.length - 1);
        }

        function cutAt(text, end) {
            emit(text.slice(0, end));
            consumed += end;
            since = text.length > end && /\S/.test(text.slice(end)) ? now() : null;
        }

        function pump(final) {
            if (cancelled) return;
            const all = speakable();
            let rest = all.slice(consumed);
            while (rest.trim()) {
                const min = spoken.length ? minChars : firstMinChars;
                // The furthest sentence end that still leaves room: join short sentences.
                SENTENCE_END.lastIndex = 0;
                let cut = -1;
                let m;
                while ((m = SENTENCE_END.exec(rest))) {
                    const end = m.index + m[0].length;
                    if (end > maxChars && cut !== -1) break;
                    cut = end;
                    if (end >= min) break;
                }
                if (cut !== -1 && (cut >= min || final)) {
                    cutAt(rest, cut);
                    rest = all.slice(consumed);
                    continue;
                }
                if (rest.length >= maxChars) {
                    const clause = lastMatchEnd(CLAUSE_END, rest.slice(0, maxChars));
                    const space = rest.lastIndexOf(' ', maxChars);
                    const at = clause > min ? clause : space > min ? space : maxChars;
                    cutAt(rest, at);
                    rest = all.slice(consumed);
                    continue;
                }
                break;
            }
            if (final) {
                if (rest.trim()) cutAt(rest, rest.length);
                return;
            }
            if (rest.trim()) {
                if (since == null) since = now();
                arm();
            } else {
                since = null;
            }
        }

        function arm() {
            if (timer || cancelled || done) return;
            const wait = Math.max(0, maxWaitMs - (now() - (since || now())));
            timer = later(() => {
                timer = null;
                if (cancelled || done) return;
                const all = speakable();
                const rest = all.slice(consumed);
                // Waited long enough for a sentence end: settle for a clause, if one is there.
                const clause = lastMatchEnd(CLAUSE_END, rest);
                if (clause >= (spoken.length ? minChars : firstMinChars)) cutAt(rest, clause);
                pump(false);
            }, wait);
        }

        return {
            /** More reply text, as it streams. */
            push(delta) {
                if (done || cancelled) return;
                raw += String(delta || '');
                pump(false);
            },
            /** The reply is complete: speak what is left. */
            end() {
                if (done || cancelled) return;
                done = true;
                if (timer) cancelLater(timer);
                timer = null;
                pump(true);
            },
            cancel() {
                cancelled = true;
                if (timer) cancelLater(timer);
                timer = null;
            },
            spoken: () => spoken.slice(),
            /**
             * Is everything spoken so far, in order, still inside `finalText`? Compared on letters
             * and digits only, so the seams' whitespace and markdown changes do not count.
             */
            consistentWith(finalText) {
                return coveredUpTo(spoken, finalText) !== -1;
            },
            /**
             * The reply is complete, and `finalText` is what the app kept after every seam. When
             * what was spoken is still in it, speak the REST OF `finalText` (not this scheduler's
             * own leftovers, which may still hold a directive the seams removed) and answer true.
             * Otherwise speak nothing more and answer false: the caller cancels and speaks
             * `finalText` the usual way.
             */
            finish(finalText) {
                if (cancelled) return false;
                done = true;
                if (timer) cancelLater(timer);
                timer = null;
                const at = coveredUpTo(spoken, finalText);
                if (at === -1) return false;
                const tail = String(finalText || '').slice(at);
                for (const phrase of split(tail, { minChars, firstMinChars: minChars, maxChars })) emit(phrase);
                return true;
            },
        };
    }

    /**
     * Where, in `finalText`'s own characters, the spoken phrases end — or -1 when they are not
     * all there in order. Matching is on letters and digits only.
     */
    function coveredUpTo(spoken, finalText) {
        const text = String(finalText || '');
        // normalized char → index of the raw char it came from
        const map = [];
        let norm = '';
        for (let i = 0; i < text.length; i++) {
            const n = normalize(text[i]);
            for (let k = 0; k < n.length; k++) map.push(i);
            norm += n;
        }
        let at = 0;
        for (const phrase of spoken) {
            const n = normalize(phrase);
            if (!n) continue;
            const found = norm.indexOf(n, at);
            if (found === -1) return -1;
            at = found + n.length;
        }
        if (at === 0) return 0;
        return at >= map.length ? text.length : map[at];
    }

    /** Split a whole text into phrases at once (a non-streamed reply). */
    function split(text, opts) {
        const out = [];
        const s = create(
            Object.assign({}, opts, { onPhrase: (p) => out.push(p), setTimeout: () => 0, clearTimeout: () => {} })
        );
        s.push(text);
        s.end();
        return out;
    }

    const api = { create, split, strip, normalize };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PHRASE_SCHEDULER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
