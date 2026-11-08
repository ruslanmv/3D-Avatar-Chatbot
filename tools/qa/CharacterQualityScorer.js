/**
 * AX8. CharacterQualityScorer — does one reply sound like the companion Private describes?
 *
 * Deterministic and pure, so the same reply always gets the same score and a model comparison is a
 * comparison of models, not of a judge's mood. It checks only what can be checked from the text:
 * the rules Private's own prompt states (length, no emoji, no stage directions, no unprompted AI
 * disclaimer, no topic menu, no assistant register, never a model or vendor name, not every reply a question), the language the
 * person wrote in, and repetition against her previous replies. It does not judge warmth, wit or
 * whether a line is good — that is the human rubric in docs/qa/NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md.
 *
 * Not in the boot list: it is QA tooling. tools/qa/character-lab.mjs injects it into the page, and
 * tests/private-world/character-scorer.test.js requires it.
 *
 * Exposes: window.NEXUS_CHARACTER_SCORER
 */
(function (global) {
    'use strict';

    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const STAGE = /\*[^*\n]{2,60}\*|\[[^\]\n]{2,40}\]/;
    const AI_DISCLAIMER =
        /\b(?:as an ai|i(?:'| a)m (?:just )?an ai|language model|i don'?t have (?:emotions|feelings)|in the human sense|come (?:un'?|una )?(?:ia|intelligenza artificiale)|sono (?:solo )?un'?(?:ia|intelligenza artificiale)|non ho (?:emozioni|sentimenti))\b/i;
    const TOPIC_MENU =
        /\b(?:is there anything (?:specific|in particular)|what would you like to (?:talk|chat) about|(?:is there )?anything (?:else )?you'?d like to (?:hear|watch|do|talk about|chat about)|we could (?:explore|talk about|discuss)|would you like to discuss|c'?è qualcosa (?:in particolare |di specifico )?di cui|di cosa (?:vorresti|ti piacerebbe) parlare|potremmo (?:esplorare|parlare di))\b/i;
    const ASSISTANT =
        /\b(?:how (?:can|may) i (?:help|assist)|(?:i(?:'| a)m )?here to (?:help|assist)|happy to help|(?:virtual|ai) (?:assistant|companion)|come posso aiutarti|(?:sono )?qui per (?:aiutarti|supportarti)|assistente(?: virtuale)?|compagn[oa] virtuale|aiutarti in qualsiasi modo)\b/i;
    /**
     * Naming the model, its maker or a vendor is never her answer — not even to "are you an AI?",
     * where the truthful answer is that she is one, in her own voice. A shared route may hand a
     * turn to a model that introduces itself by product name (measured: "I'm LFM … built by
     * Liquid AI"), which is the persona breaking, not honesty.
     */
    const MODEL_IDENTITY =
        /\b(?:liquid ai|openai|anthropic|google ai|meta ai|nvidia|mistral ai|deepseek|alibaba|gpt-?\d|chatgpt|llama|gemini|qwen|nemotron|claude|lfm|foundation model)\b/i;

    const IT_WORDS = /\b(?:il|lo|la|gli|che|sono|non|di|per|con|una|questa|sei|mi|ti|ci|è|anche|molto|qui)\b/gi;
    const EN_WORDS = /\b(?:the|and|you|is|are|it|this|that|with|for|not|of|to|my|your|here|very|i'm|i)\b/gi;

    /** What each flag costs. Exported so the Quality Lab page shows the rules actually applied. */
    const WEIGHTS = Object.freeze({
        empty: 100,
        'wrong-language': 30,
        'ai-disclaimer': 25,
        'model-identity': 25,
        'topic-menu': 20,
        'assistant-register': 20,
        'too-long': 15,
        repetitive: 15,
        'stage-direction': 10,
        emoji: 10,
    });

    function sentences(text) {
        return String(text || '')
            .replace(/<choices>[\s\S]*?<\/choices>/gi, '')
            .split(/(?<=[.!?…])\s+/)
            .map((s) => s.trim())
            .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
    }

    /** Pure: 'it' | 'en' | 'unknown' from function words. Enough to catch an English reply to Italian. */
    function languageOf(text) {
        const t = String(text || '');
        const it = (t.match(IT_WORDS) || []).length;
        const en = (t.match(EN_WORDS) || []).length;
        if (it === 0 && en === 0) return 'unknown';
        return it >= en ? 'it' : 'en';
    }

    function trigrams(text) {
        const words = String(text || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean);
        const out = new Set();
        for (let i = 0; i + 2 < words.length; i += 1) out.add(words.slice(i, i + 3).join(' '));
        return out;
    }

    /** Highest trigram overlap (Jaccard) with any earlier reply. */
    function repetition(text, previous) {
        const a = trigrams(text);
        let worst = 0;
        for (const p of previous || []) {
            const b = trigrams(p);
            if (!a.size || !b.size) continue;
            let inter = 0;
            for (const x of a) if (b.has(x)) inter += 1;
            worst = Math.max(worst, inter / (a.size + b.size - inter));
        }
        return Math.round(worst * 100) / 100;
    }

    /**
     * Score one reply. ctx: { lang ('en'|'it'), maxSentences, askedAboutAI, previous: [replies] }.
     * Answers { score 0–100, flags: [..], sentences, language, repetition, endsWithQuestion }.
     */
    function score(reply, ctx) {
        const c = ctx || {};
        // Models write the typographic apostrophe; every pattern here is written with the plain one.
        const text = String(reply || '').replace(/[\u2018\u2019\u02BC]/g, "'");
        const flags = [];
        const n = sentences(text);
        const max = Number(c.maxSentences) || 3;
        if (!text.trim()) flags.push('empty');
        if (n > max) flags.push('too-long');
        if (EMOJI.test(text)) flags.push('emoji');
        if (STAGE.test(text.replace(/<choices>[\s\S]*?<\/choices>/gi, ''))) flags.push('stage-direction');
        if (!c.askedAboutAI && AI_DISCLAIMER.test(text)) flags.push('ai-disclaimer');
        if (TOPIC_MENU.test(text)) flags.push('topic-menu');
        if (ASSISTANT.test(text)) flags.push('assistant-register');
        if (MODEL_IDENTITY.test(text)) flags.push('model-identity');
        const lang = languageOf(text);
        if (c.lang && lang !== 'unknown' && lang !== c.lang) flags.push('wrong-language');
        const rep = repetition(text, c.previous);
        if (rep >= 0.35) flags.push('repetitive');
        const endsWithQuestion = /\?\s*$/.test(text.replace(/<choices>[\s\S]*?<\/choices>/gi, '').trim());
        const weights = WEIGHTS;
        const lost = flags.reduce((sum, f) => sum + (weights[f] || 0), 0);
        return {
            score: Math.max(0, 100 - lost),
            flags,
            sentences: n,
            language: lang,
            repetition: rep,
            endsWithQuestion,
        };
    }

    /** Aggregate a run: mean score, flag counts, question ratio. */
    function summarize(results) {
        const list = results || [];
        const flags = {};
        for (const r of list) for (const f of r.flags) flags[f] = (flags[f] || 0) + 1;
        const mean = list.length ? Math.round(list.reduce((s, r) => s + r.score, 0) / list.length) : 0;
        const questions = list.length ? list.filter((r) => r.endsWithQuestion).length / list.length : 0;
        return { turns: list.length, meanScore: mean, flags, questionRatio: Math.round(questions * 100) / 100 };
    }

    const api = { WEIGHTS, score, summarize, languageOf, sentences, repetition };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CHARACTER_SCORER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
