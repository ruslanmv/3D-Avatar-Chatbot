/**
 * AX16. What a model wrote for itself never reaches the person.
 *
 * Reported from a real Italian session, three lines in the chat:
 *
 *     Benvenuto nella suite, ti va di esplorare? ```motion {"commands":[{"type":"look_at",…}]} ```
 *     THOUGHT: The user wants to go to the lake. I need to acknowledge their agreement … Certo,
 *     andiamo al lago.
 *
 * Two different leaks with one cause: there were several places that post a model's words, and
 * only the main chat seam in `main.js` cleaned them. `ActivityVoice` (her one line when an activity
 * starts or ends) stripped `<tags>` but not the ```motion block every prompt asks for, and nothing
 * anywhere removed a plain-text "THOUGHT:" paragraph — `LLMManager` only knew the `<think>` and
 * Harmony wrappers, while a gateway that switches backends per turn (OllaBridge's free routes) also
 * hands over models that narrate their reasoning in the reply itself.
 *
 * So the cleaning lives here, once, and every posting path calls it:
 *
 *   - `stripThought(text, { lang })` — a leading "THOUGHT:" / "Thinking:" / "Reasoning:" paragraph,
 *     cut at its paragraph break; when the model ran it into the answer in one paragraph, the
 *     leading sentences that talk *about* the reply ("The user wants…", "I need to…") are dropped,
 *     and in a non-English session so are leading English sentences. Text with no marker is
 *     returned untouched: this never rewrites an ordinary reply.
 *   - `fromReasoning(text, { lang })` — the answer out of a reasoning-channel text, for a caller
 *     that only has that. `LLMManager` itself no longer uses the reasoning channel at all: a
 *     completion with no final content fails closed (5850d32), which is the safer choice.
 *   - `forDisplay(text, { lang, global, run })` — everything a line posted outside the main seam
 *     needs: the thought, the ```motion plan (executed when `run` is true, through
 *     `NEXUS_MOTION.processReply`, the same call the main chat makes), every directive the known
 *     scrubbers know, any remaining markup, and whitespace.
 *
 * The main chat seam keeps its own order (directives are *consumed* there, not scrubbed — they are
 * instructions to execute); it only adds `stripThought` before them.
 *
 * Exposes: window.NEXUS_REPLY_CLEAN
 */
(function (global) {
    'use strict';

    /** A line that announces itself as reasoning. Bold markdown around the label is common. */
    const MARKER =
        /^\s*(?:\*\*|__)?(?:thoughts?|thinking|reasoning|analysis|internal monologue|inner monologue|plan)(?:\*\*|__)?\s*:\s*/i;

    /** Sentences that talk about the reply instead of being it. English: that is how they arrive. */
    const META =
        /\b(?:the user(?:'s)?|the person (?:wants|asked|said|is)|i (?:just |only |now )?(?:need to|have to|want to|must|should|will)|i'll|let me (?:respond|reply|answer|think)|my (?:reply|response|answer)|the system(?: is)?|(?:respond|reply)(?:ing)? (?:with|in)|the instructions?|as instructed|in character)\b/i;

    const EN_WORDS = /\b(?:the|and|you|is|are|it|this|that|with|for|not|of|to|my|your|i|we|will|need|wants?)\b/gi;

    function sentences(text) {
        return String(text || '')
            .split(/(?<=[.!?…])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function looksEnglish(sentence) {
        const words = String(sentence).split(/\s+/).filter(Boolean).length;
        const en = (String(sentence).match(EN_WORDS) || []).length;
        return words >= 3 && en / words >= 0.25;
    }

    function isEnglishSession(lang) {
        return !lang || /^en\b|^en-/i.test(String(lang));
    }

    function appLang(g) {
        try {
            const app = g && g.AppLanguage;
            return (app && app.code) || null;
        } catch (_) {
            return null;
        }
    }

    /** Leading sentences that are the thought, dropped; the rest returned. */
    function dropThoughtSentences(text, lang) {
        const parts = sentences(text);
        const foreign = !isEnglishSession(lang);
        let i = 0;
        while (i < parts.length && (META.test(parts[i]) || (foreign && looksEnglish(parts[i])))) i += 1;
        return parts.slice(i).join(' ').trim();
    }

    /** Pure. A leading reasoning paragraph removed; text without a marker comes back unchanged. */
    function stripThought(text, options) {
        const o = options || {};
        const value = String(text == null ? '' : text);
        const m = value.match(MARKER);
        if (!m) return value;
        const rest = value.slice(m[0].length);
        const lang = o.lang || appLang(o.global || global);
        const breakAt = rest.search(/\n\s*\n/);
        if (breakAt !== -1) {
            const after = rest.slice(breakAt).trim();
            // The answer can itself start with a sentence or two of the thought.
            return dropThoughtSentences(after, lang) || after;
        }
        return dropThoughtSentences(rest, lang);
    }

    /** Pure. A reply rebuilt from the reasoning channel: its last paragraph, without the thought. */
    function fromReasoning(text, options) {
        const o = options || {};
        const value = String(text == null ? '' : text).trim();
        if (!value) return '';
        const paragraphs = value
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);
        const last = paragraphs[paragraphs.length - 1] || '';
        const lang = o.lang || appLang(o.global || global);
        const cleaned = dropThoughtSentences(stripThought(last, { lang }), lang);
        return cleaned || last;
    }

    /** ```motion plans (and bare JSON plan fences) out; executed when `run`, like the main chat. */
    function withoutMotion(text, g, run) {
        const motion = g && g.NEXUS_MOTION;
        if (run && motion && typeof motion.processReply === 'function') {
            try {
                return motion.processReply(text);
            } catch (_) {
                /* fall through to removing it */
            }
        }
        const parser = g && g.NEXUS_MOTION_PARSER;
        if (parser && typeof parser.extract === 'function') {
            try {
                return parser.extract(text).cleanText;
            } catch (_) {
                /* fall through */
            }
        }
        return String(text)
            .replace(/```motion[\s\S]*?(?:```|$)/gi, ' ')
            .replace(/```(?:json)?\s*\{[\s\S]*?"commands"[\s\S]*?```/gi, ' ');
    }

    /**
     * Directive tags removed by the modules that own a `scrub` (remove, never execute). The other
     * tags (`<play>`, `<activity>`, `<go>`, `<gesture>`, `<act>`) have no scrub of their own; the
     * generic markup pass in `forDisplay` removes them, also without executing anything.
     */
    function scrubDirectives(text, g) {
        let out = text;
        const owners = [g && g.NEXUS_SCENE_AMBIENCE_DIRECTIVE, g && g.NEXUS_WARDROBE_TOOL];
        for (const owner of owners) {
            if (!owner || typeof owner.scrub !== 'function') continue;
            try {
                out = owner.scrub(out);
            } catch (_) {
                /* a scrubber that throws leaves the text as it was */
            }
        }
        return out;
    }

    /**
     * Everything a line posted outside the main chat seam needs before anyone sees or hears it.
     * Never throws; never returns more than it was given.
     */
    function forDisplay(text, options) {
        const o = options || {};
        const g = o.global || global;
        const lang = o.lang || appLang(g);
        let out = String(text == null ? '' : text);
        out = stripThought(out, { lang });
        out = withoutMotion(out, g, o.run === true);
        out = scrubDirectives(out, g);
        return out
            .replace(/```[\s\S]*?```/g, ' ') // any other fenced block is never a spoken line
            .replace(/<[^>]{0,200}>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const api = { MARKER, META, stripThought, fromReasoning, forDisplay, looksEnglish };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_REPLY_CLEAN = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
