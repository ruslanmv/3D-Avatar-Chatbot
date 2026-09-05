/**
 * AntiRepeatMemory — never a visible loop (spec v1.1 §6.5, UC-2).
 *
 * A ring buffer of the last N picks. The ranker asks it for a novelty score, and a clip
 * played recently scores lower than one that has not been seen — not zero, because banning
 * a clip outright is how a pool of three becomes a rotation of three in a fixed order,
 * which reads as a loop just as clearly as repetition does.
 *
 * Novelty decays with position: the clip played most recently is the most penalised, and
 * the one about to fall out of the window is barely penalised at all.
 *
 * Exposes: window.NEXUS_BD_ANTI_REPEAT
 */
const AntiRepeatMemory = (() => {
    'use strict';

    class AntiRepeat {
        constructor(windowSize = 5) {
            this.windowSize = Math.max(1, windowSize);
            this._recent = [];
            this._lastPlayed = new Map();
        }

        /** Record a pick. Called by the scheduler once the clip actually starts. */
        remember(id, now = Date.now()) {
            if (!id) return;
            this._recent.unshift(id);
            if (this._recent.length > this.windowSize) this._recent.length = this.windowSize;
            this._lastPlayed.set(id, now);
        }

        /**
         * 1 for a clip not in the window, falling toward 0 for the most recent pick.
         * @returns {number} 0..1
         */
        novelty(id) {
            const index = this._recent.indexOf(id);
            if (index === -1) return 1;
            // index 0 (just played) → 0.1; the oldest in the window → close to 1.
            return 0.1 + 0.9 * (index / this.windowSize);
        }

        /** When this clip last played, or 0. The ranker's cooldown gate reads this. */
        lastPlayed(id) {
            return this._lastPlayed.get(id) || 0;
        }

        get recent() {
            return this._recent.slice();
        }

        clear() {
            this._recent = [];
            this._lastPlayed.clear();
        }
    }

    return AntiRepeat;
})();

if (typeof window !== 'undefined') window.NEXUS_BD_ANTI_REPEAT = AntiRepeatMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = AntiRepeatMemory;
