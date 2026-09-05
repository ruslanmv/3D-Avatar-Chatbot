/**
 * SentimentFallback — an intent for models that ignore the tag contract (spec v1.1 §6.8).
 *
 * Plenty of models will not emit `[[emote:…]]` however clearly they are asked: small local
 * models, anything behind a strict proxy, anything mid-fine-tune. Without a fallback those
 * users get a companion who never reacts, which reads as broken rather than as unsupported.
 *
 * **It carries no keyword table.** `EmotionEngine` already has one — emoji, weighted
 * keyword patterns, punctuation analysis, and HomePilot's own avatar directives, in a
 * documented priority order. A second table would drift from it within a month and the two
 * would disagree about the same sentence. This asks the existing engine and translates its
 * answer into an intent.
 *
 * It only ever speaks when the tag channel said nothing: a reply with tags is the model
 * being explicit, and explicit beats inferred.
 *
 * Exposes: window.NEXUS_BD_SENTIMENT_FALLBACK
 */
const SentimentFallback = (() => {
    'use strict';

    /** EmotionEngine's vocabulary → the §6.2 whitelist. Only these are worth reacting to. */
    const EMOTION_TO_INTENT = {
        happy: 'happy',
        joy: 'happy',
        excited: 'celebrate',
        sad: 'sad',
        angry: 'angry',
        surprised: 'surprised',
        thinking: 'thinking',
        confused: 'thinking',
        love: 'happy',
        shy: 'shy',
        flirty: 'flirt',
    };

    /** Below this the engine is guessing, and a guess is not worth moving her body for. */
    const MIN_INTENSITY = 0.35;

    function attach({ bus, config = {}, emotionEngine } = {}) {
        const whitelist = config.emoteWhitelist || [];
        const engine = emotionEngine || (typeof window !== 'undefined' ? window.NEXUS_EMOTION_ENGINE : null);

        let taggedThisReply = false;

        const stopIntent = bus.on('intent', (intent) => {
            if (intent && intent.source === 'llm') taggedThisReply = true;
        });

        /**
         * Called with the finished reply. Returns the intent it fired, or null — returning
         * it rather than only emitting makes the "explicit beats inferred" rule testable.
         */
        function onReply(text) {
            const wasTagged = taggedThisReply;
            taggedThisReply = false;

            if (wasTagged || !engine || typeof engine.analyze !== 'function') return null;
            if (typeof text !== 'string' || !text.trim()) return null;

            let result;
            try {
                result = engine.analyze(text);
            } catch (error) {
                console.warn('[BD] EmotionEngine.analyze threw — no fallback intent', error);
                return null;
            }
            if (!result) return null;

            const name = EMOTION_TO_INTENT[result.emotion || result.detected];
            const intensity = Number(result.intensity) || 0;
            if (!name || intensity < MIN_INTENSITY) return null;
            if (whitelist.length && !whitelist.includes(name)) return null;

            const intent = { name, intensity, source: 'sentiment' };
            bus.emit('intent', intent);
            return intent;
        }

        return {
            name: 'SentimentFallback',
            onReply,
            detach() {
                stopIntent();
            },
        };
    }

    return { attach, EMOTION_TO_INTENT, MIN_INTENSITY };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SENTIMENT_FALLBACK = SentimentFallback;
if (typeof module !== 'undefined' && module.exports) module.exports = SentimentFallback;
