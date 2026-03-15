/**
 * EmotionEngine — Phase 3 Avatar Aliveness
 *
 * Analyzes LLM response text and returns a detected emotion + intensity.
 * Layered strategy:
 *   1. HomePilot avatar directives (server-side emotion, highest priority)
 *   2. Emoji detection
 *   3. Weighted keyword patterns
 *   4. Punctuation / structure analysis
 *
 * Non-destructive: purely additive module, calls nothing, modifies nothing.
 * Exposed as window.NEXUS_EMOTION_ENGINE
 */
(function (global) {
    'use strict';

    // =========================================================================
    // EMOJI → EMOTION MAP
    // =========================================================================
    const EMOJI_MAP = {
        happy: /[\u{1F600}-\u{1F606}\u{1F60A}\u{1F60D}\u{1F60E}\u{1F970}\u{1F973}\u{1F929}\u{2764}\u{1F496}\u{1F4AA}\u{1F389}\u{1F38A}\u{1F44D}]/u,
        sad: /[\u{1F622}\u{1F625}\u{1F62D}\u{1F614}\u{1F61E}\u{1F62A}\u{1F494}\u{1F615}]/u,
        angry: /[\u{1F620}\u{1F621}\u{1F624}\u{1F92C}\u{1F4A2}]/u,
        surprised: /[\u{1F62E}\u{1F62F}\u{1F632}\u{1F631}\u{1F633}\u{1F914}\u{2049}\u{203C}]/u,
        excited: /[\u{1F525}\u{2B50}\u{1F680}\u{1F4AB}\u{26A1}\u{1F31F}\u{1F60D}]/u,
    };

    // =========================================================================
    // KEYWORD PATTERN GROUPS (weighted)
    // =========================================================================
    const KEYWORD_GROUPS = [
        {
            emotion: 'happy',
            weight: 1.0,
            patterns: [
                /\b(glad|happy|delighted|pleased|wonderful|fantastic|great|awesome|love|lovely|excellent|brilliant|perfect|beautiful)\b/i,
                /\b(glad to help|happy to|my pleasure|you're welcome|of course)\b/i,
                /\b(congratulations|well done|bravo|cheers)\b/i,
            ],
        },
        {
            emotion: 'excited',
            weight: 1.2,
            patterns: [
                /\b(amazing|incredible|extraordinary|phenomenal|spectacular|outstanding|magnificent)\b/i,
                /\b(absolutely|definitely|totally|extremely|super)\b/i,
                /\b(exciting|thrilling|can't wait|looking forward)\b/i,
            ],
        },
        {
            emotion: 'sad',
            weight: 1.0,
            patterns: [
                /\b(sorry|unfortunately|sadly|regret|apologize|miss|loss|difficult|tough)\b/i,
                /\b(I'm sorry to hear|my condolences|that's hard|I understand how)\b/i,
                /\b(disappointed|heartbreaking|painful|suffering)\b/i,
            ],
        },
        {
            emotion: 'thinking',
            weight: 0.8,
            patterns: [
                /\b(think|consider|perhaps|maybe|possibly|might|could be|let me)\b/i,
                /\b(hmm|hmmm|interesting|curious|wonder|ponder|reflect)\b/i,
                /\b(on one hand|on the other|it depends|that's a good question)\b/i,
            ],
        },
        {
            emotion: 'surprised',
            weight: 1.0,
            patterns: [
                /\b(wow|whoa|oh my|really|seriously|no way|unbelievable)\b/i,
                /\b(I didn't expect|surprising|astonishing|remarkable|unexpected)\b/i,
                /\b(mind-blowing|jaw-dropping|speechless)\b/i,
            ],
        },
        {
            emotion: 'angry',
            weight: 0.6, // low weight — rare for assistant responses
            patterns: [
                /\b(frustrating|unacceptable|outrageous|terrible|horrible|awful)\b/i,
                /\b(ridiculous|absurd|inexcusable|disgraceful)\b/i,
            ],
        },
    ];

    // =========================================================================
    // EMOTION → OUTPUT MAPPING
    // =========================================================================
    const EMOTION_OUTPUT = {
        happy: { emotion: 'happy', mode: 'happy', baseIntensity: 0.5 },
        excited: { emotion: 'happy', mode: 'happy', baseIntensity: 0.8 },
        sad: { emotion: 'sad', mode: 'idle', baseIntensity: 0.45 },
        thinking: { emotion: 'neutral', mode: 'thinking', baseIntensity: 0.5 },
        surprised: { emotion: 'surprised', mode: 'idle', baseIntensity: 0.6 },
        angry: { emotion: 'angry', mode: 'idle', baseIntensity: 0.4 },
        neutral: { emotion: 'neutral', mode: 'idle', baseIntensity: 0.0 },
    };

    // =========================================================================
    // ANALYSIS
    // =========================================================================

    /**
     * Analyze text and return emotion result.
     *
     * @param {string} text - The LLM response text
     * @param {object} [directives] - Optional avatar directives from HomePilot
     *   (e.g. { emotion: 'happy', intensity: 0.7 })
     * @returns {{ emotion: string, intensity: number, mode: string, detected: string }}
     */
    function analyze(text, directives) {
        // Layer 1: HomePilot directives (highest priority — server knows best)
        if (directives && directives.emotion) {
            const e = String(directives.emotion).toLowerCase();
            const mapping = EMOTION_OUTPUT[e] || EMOTION_OUTPUT.neutral;
            return {
                detected: e,
                emotion: mapping.emotion,
                intensity: typeof directives.intensity === 'number' ? directives.intensity : mapping.baseIntensity,
                mode: mapping.mode,
                source: 'directive',
            };
        }

        const t = (text || '').trim();
        if (!t) return _neutral('empty');

        // Layer 2: Emoji detection (very reliable signal)
        for (const [emo, regex] of Object.entries(EMOJI_MAP)) {
            if (regex.test(t)) {
                const mapping = EMOTION_OUTPUT[emo] || EMOTION_OUTPUT.neutral;
                return {
                    detected: emo,
                    emotion: mapping.emotion,
                    intensity: mapping.baseIntensity,
                    mode: mapping.mode,
                    source: 'emoji',
                };
            }
        }

        // Layer 3: Weighted keyword scoring
        const scores = {};
        for (const group of KEYWORD_GROUPS) {
            let hits = 0;
            for (const pattern of group.patterns) {
                const matches = t.match(pattern);
                if (matches) hits += matches.length;
            }
            if (hits > 0) {
                scores[group.emotion] = (scores[group.emotion] || 0) + hits * group.weight;
            }
        }

        // Pick highest scoring emotion
        let bestEmo = null;
        let bestScore = 0;
        for (const [emo, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                bestEmo = emo;
            }
        }

        if (bestEmo) {
            const mapping = EMOTION_OUTPUT[bestEmo] || EMOTION_OUTPUT.neutral;
            // Scale intensity by hit density (more matches = stronger emotion)
            const density = Math.min(bestScore / 4, 1.0); // 4 hits = max
            const intensity = mapping.baseIntensity * (0.6 + density * 0.4);
            return {
                detected: bestEmo,
                emotion: mapping.emotion,
                intensity: Math.min(intensity, 1.0),
                mode: mapping.mode,
                source: 'keyword',
            };
        }

        // Layer 4: Punctuation / structure heuristics
        const exclamations = (t.match(/!/g) || []).length;
        const questions = (t.match(/\?/g) || []).length;

        if (exclamations >= 2) {
            return {
                detected: 'excited',
                emotion: 'happy',
                intensity: Math.min(0.4 + exclamations * 0.1, 0.8),
                mode: 'happy',
                source: 'punctuation',
            };
        }
        if (questions >= 2) {
            return {
                detected: 'thinking',
                emotion: 'neutral',
                intensity: 0.4,
                mode: 'thinking',
                source: 'punctuation',
            };
        }

        // Very short response → low energy neutral
        if (t.length < 20) {
            return _neutral('short');
        }

        return _neutral('none');
    }

    function _neutral(source) {
        return {
            detected: 'neutral',
            emotion: 'neutral',
            intensity: 0.0,
            mode: 'idle',
            source: source,
        };
    }

    // =========================================================================
    // EXPOSE
    // =========================================================================
    global.NEXUS_EMOTION_ENGINE = {
        analyze: analyze,
    };

    console.log('[EmotionEngine] Initialized');
})(window);
