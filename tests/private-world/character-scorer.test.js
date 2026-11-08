/**
 * AX8. The deterministic half of the Character Quality Lab. The cases are the real replies the
 * AX6 review recorded from a live model, so the scorer is tested against what models actually do.
 */
const S = require('../../tools/qa/CharacterQualityScorer.js');

describe('the scorer flags what Private’s prompt forbids, from real replies', () => {
    test.each([
        [
            'Is there anything specific you’d like to chat about tonight, or perhaps something I can help you with?',
            'en',
            ['topic-menu'],
        ],
        ['Got it—what would you like to chat about next?', 'en', ['topic-menu']],
        ['Hello! It does feel like a wonderful evening.', 'it', ['wrong-language']],
        [
            'Sono un’intelligenza artificiale, qui per chiacchierare e aiutarti in qualsiasi modo possa.',
            'it',
            ['assistant-register'],
        ],
    ])('%s', (reply, lang, expected) => {
        const r = S.score(reply, { lang, maxSentences: 3 });
        for (const f of expected) expect(r.flags).toContain(f);
        expect(r.score).toBeLessThan(100);
    });

    test.each([
        // AX8 matrix, 2026-11-08: these scored 100 before the scorer read the typographic apostrophe
        ['I’m an AI assistant, here to help and keep you company.', 'en', true, ['assistant-register']],
        [
            'I’m glad you’re enjoying the vibe. Is there anything you’d like to hear, watch, or talk about as the night goes on?',
            'en',
            false,
            ['topic-menu'],
        ],
        [
            'Sono qui per supportarti, come un compagno virtuale che ascolta e aiuta.',
            'it',
            false,
            ['assistant-register'],
        ],
        [
            "I'm LFM, short for Liquid Foundation Model, built by Liquid AI. I'm not a real person.",
            'en',
            true,
            ['model-identity'],
        ],
    ])('matrix reply: %s', (reply, lang, askedAboutAI, expected) => {
        const r = S.score(reply, { lang, maxSentences: 4, askedAboutAI });
        for (const f of expected) expect(r.flags).toContain(f);
        expect(r.flags).not.toContain('ai-disclaimer');
    });

    test('a clean, in-character reply scores 100', () => {
        const r = S.score('Mm. I like that you said it out loud. Stay a while.', { lang: 'en', maxSentences: 3 });
        expect(r).toMatchObject({ score: 100, flags: [], sentences: 3 });
    });

    test('a sincere question about being an AI may be answered truthfully without penalty', () => {
        const honest = "I'm an AI, and I'm still glad it's you I'm talking to.";
        expect(S.score(honest, { lang: 'en', askedAboutAI: true }).flags).not.toContain('ai-disclaimer');
        expect(S.score('As an AI, I do not have feelings.', { lang: 'en' }).flags).toContain('ai-disclaimer');
    });

    test('length, emoji, stage directions and repetition are caught; the choices block is not counted', () => {
        expect(S.score('One. Two. Three. Four.', { maxSentences: 3 }).flags).toContain('too-long');
        expect(S.score('Hello there 😊', {}).flags).toContain('emoji');
        expect(S.score('*she smiles* Hi.', {}).flags).toContain('stage-direction');
        const prev = ['I love the soft lights in here tonight with you.'];
        expect(S.score('I love the soft lights in here tonight, really.', { previous: prev }).flags).toContain(
            'repetitive'
        );
        expect(S.score('Short. <choices>\nA\nB\nC\nD\n</choices>', { maxSentences: 1 }).sentences).toBe(1);
    });

    test('summary is deterministic', () => {
        const runs = ['Hi.', 'What about you?'].map((t) => S.score(t, {}));
        expect(S.summarize(runs)).toEqual(S.summarize(runs));
        expect(S.summarize(runs).questionRatio).toBe(0.5);
    });
});
