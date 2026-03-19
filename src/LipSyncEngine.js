/**
 * LipSyncEngine — Phase 3 Avatar Aliveness
 *
 * Speech-driven mouth animation using synthetic phoneme analysis.
 * Parses text into vowel/consonant segments and steps through them
 * at a rate derived from the TTS speech rate, producing viseme
 * intensities that are smoothly interpolated each frame.
 *
 * Designed as a higher-quality replacement for VRMLoader.startLipSync()
 * (the simple sine-wave oscillator). BehaviorEngine decides which to use.
 *
 * Non-destructive: only calls vrmLoader.setExpression() — never modifies
 * existing files.
 *
 * Exposed as window.NEXUS_LIP_SYNC
 */
(function (global) {
    'use strict';

    // =========================================================================
    // PHONEME → VISEME MAPPING
    // =========================================================================
    //
    // We group characters into "phoneme-like" buckets and map each to a
    // primary VRM viseme expression plus intensity range.
    //
    // VRM standard visemes used: aa, ee, oh
    // (ih, ou available on some models — we stick to the 3 that exist on all)

    const VISEME_MAP = {
        // Open-mouth vowels → aa
        a: { viseme: 'aa', min: 0.35, max: 0.75 },
        // Front vowels → ee
        e: { viseme: 'ee', min: 0.25, max: 0.55 },
        i: { viseme: 'ee', min: 0.2, max: 0.5 },
        // Round vowels → oh
        o: { viseme: 'oh', min: 0.3, max: 0.65 },
        u: { viseme: 'oh', min: 0.25, max: 0.55 },
        // Bilabial consonants → mouth closed
        m: { viseme: null, min: 0, max: 0 },
        b: { viseme: null, min: 0, max: 0 },
        p: { viseme: null, min: 0, max: 0 },
        // Other consonants → slight opening
        default: { viseme: 'aa', min: 0.05, max: 0.15 },
        // Space / pause → mouth closing
        space: { viseme: null, min: 0, max: 0 },
    };

    // All viseme expression names we control (for cleanup)
    const ALL_VISEMES = ['aa', 'ee', 'oh'];

    // =========================================================================
    // PHONEME SEQUENCE BUILDER
    // =========================================================================

    /**
     * Convert text into a sequence of viseme targets.
     * Each entry: { viseme: string|null, intensity: number, duration: number }
     *
     * @param {string} text
     * @param {number} rate - Speech rate multiplier (1.0 = normal)
     * @returns {Array<{viseme: string|null, intensity: number, duration: number}>}
     */
    function buildPhonemeSequence(text, rate) {
        const chars = (text || '').toLowerCase().replace(/[^a-z\s]/g, '');
        if (!chars) return [];

        // Base duration per character in seconds (at rate 1.0)
        // Average English speech: ~15 chars/sec including spaces
        const baseDur = 1.0 / (15 * (rate || 1.0));

        const seq = [];
        let i = 0;
        while (i < chars.length) {
            const ch = chars[i];

            if (ch === ' ') {
                // Merge consecutive spaces
                seq.push({ viseme: null, intensity: 0, duration: baseDur * 1.5 });
                while (i < chars.length && chars[i] === ' ') i++;
                continue;
            }

            const mapping = VISEME_MAP[ch] || VISEME_MAP.default;

            // Vary intensity slightly for natural feel
            const jitter = 0.85 + Math.random() * 0.3; // 0.85–1.15
            const intensity = mapping.viseme ? mapping.min + (mapping.max - mapping.min) * jitter : 0;

            // Vowels hold longer than consonants
            const isVowel = 'aeiou'.includes(ch);
            const dur = baseDur * (isVowel ? 1.8 : 0.8);

            seq.push({
                viseme: mapping.viseme,
                intensity: Math.min(intensity, 1.0),
                duration: dur,
            });

            i++;
        }

        return seq;
    }

    // =========================================================================
    // LIP SYNC ENGINE
    // =========================================================================

    const state = {
        active: false,
        sequence: [], // phoneme sequence
        seqIndex: 0, // current position in sequence
        elapsed: 0, // time elapsed in current segment
        // Current viseme intensities (smoothed)
        current: { aa: 0, ee: 0, oh: 0 },
        // Target viseme intensities
        target: { aa: 0, ee: 0, oh: 0 },
        // Smoothing factor (lower = smoother, 0.08–0.20 range)
        smoothing: 0.14,
        // Face tracking pause — when true, update() is a no-op
        paused: false,
    };

    /**
     * Start lip-sync for a given text at a given speech rate.
     * Call this when TTS utterance begins.
     *
     * @param {string} text - The text being spoken
     * @param {number} [rate=1.0] - Speech synthesis rate
     */
    function start(text, rate) {
        state.sequence = buildPhonemeSequence(text, rate || 1.0);
        state.seqIndex = 0;
        state.elapsed = 0;
        state.active = true;
        state.target = { aa: 0, ee: 0, oh: 0 };
        state.current = { aa: 0, ee: 0, oh: 0 };
        console.log(`[LipSync] Started — ${state.sequence.length} segments`);
    }

    /**
     * Stop lip-sync and close mouth (smooth fade-out).
     */
    function stop() {
        state.active = false;
        state.sequence = [];
        state.seqIndex = 0;
        state.target = { aa: 0, ee: 0, oh: 0 };
        // Don't zero current immediately — let update() smooth it out
    }

    /**
     * Per-frame update. Call from the animation loop.
     * Advances through the phoneme sequence and smoothly interpolates
     * viseme values, then applies them to the VRM.
     *
     * @param {number} dt - Delta time in seconds
     * @param {object} vrmLoader - VRMLoader instance (needs .setExpression)
     */
    function update(dt, vrmLoader) {
        if (!vrmLoader) return;
        if (state.paused) return; // face tracking owns mouth expressions

        if (state.active && state.sequence.length > 0) {
            _advanceSequence(dt);
        }

        // Smooth interpolation toward target (runs even when stopping, for fade-out)
        let anyActive = false;
        for (const v of ALL_VISEMES) {
            const diff = state.target[v] - state.current[v];
            if (Math.abs(diff) > 0.005) {
                state.current[v] += diff * state.smoothing;
                anyActive = true;
            } else {
                state.current[v] = state.target[v];
            }
        }

        // Apply to VRM
        const hasExprMgr = vrmLoader.currentVRM && vrmLoader.currentVRM.expressionManager;
        if (hasExprMgr) {
            for (const v of ALL_VISEMES) {
                try {
                    vrmLoader.setExpression(v, state.current[v]);
                } catch (_) {
                    /* expression may not exist on this model */
                }
            }
        }

        // If we've stopped and smoothing is done, mark fully inactive
        if (!state.active && !anyActive) {
            state.current = { aa: 0, ee: 0, oh: 0 };
        }
    }

    /**
     * Advance through the phoneme sequence based on elapsed time.
     * @param {number} dt
     */
    function _advanceSequence(dt) {
        state.elapsed += dt;

        const seg = state.sequence[state.seqIndex];
        if (!seg) {
            // Sequence finished
            state.active = false;
            state.target = { aa: 0, ee: 0, oh: 0 };
            return;
        }

        // Move to next segment if current one is done
        if (state.elapsed >= seg.duration) {
            state.elapsed -= seg.duration;
            state.seqIndex++;

            if (state.seqIndex >= state.sequence.length) {
                state.active = false;
                state.target = { aa: 0, ee: 0, oh: 0 };
                return;
            }
        }

        // Set target viseme from current segment
        const current = state.sequence[state.seqIndex];
        state.target = { aa: 0, ee: 0, oh: 0 };
        if (current && current.viseme && current.intensity > 0) {
            state.target[current.viseme] = current.intensity;
        }
    }

    // =========================================================================
    // EXPOSE
    // =========================================================================
    global.NEXUS_LIP_SYNC = {
        start: start,
        stop: stop,
        update: update,
        get isActive() {
            return state.active;
        },
        /** Pause/resume viseme output (face tracking override). */
        setPaused: function (paused) {
            state.paused = !!paused;
        },
        // Utility: expose for testing
        buildPhonemeSequence: buildPhonemeSequence,
    };

    console.log('[LipSyncEngine] Initialized');
})(window);
