/**
 * UtilityRanker — the single enforcement point (spec v1.1 §6.5).
 *
 * Every gate in the system lives in `score()`. Not "mostly lives" — the spec makes this one
 * function the place where NSFW, mode permission and cooldown are decided, because a gate
 * that exists in two places is a gate that will disagree with itself. Adding a gate anywhere
 * else is the bug.
 *
 * The final pick is a **softmax-weighted random choice among the top-k**, not the argmax.
 * Always taking the best score means the same input always produces the same clip, which is
 * exactly the visible loop §6.5 is trying to avoid.
 *
 * ## Forward compatibility, deliberately taken now
 *
 * Two things the adult tier (B28) needs are already threaded through, because retrofitting
 * them would mean rewriting the one function that enforces every gate:
 *
 *   - `intent.source` reaches `score()`, so B28's "she never initiates" rule is two added
 *     lines rather than a refactor;
 *   - `blackboard.escalationLevel` is read through `mode.tierAllowed`, which defaults to
 *     permitting everything the other gates already allowed.
 *
 * Exposes: window.NEXUS_BD_RANKER
 */
const UtilityRanker = (() => {
    'use strict';

    const DEFAULT_WEIGHTS = { semantic: 0.5, energy: 0.2, valence: 0.1, quality: 0.1, novelty: 0.1 };

    /** Softmax sharpness. Higher is closer to argmax; lower is closer to a coin toss. */
    const TEMPERATURE = 12;

    const BLOCKED = -Infinity;

    class Ranker {
        constructor({ weights, antiRepeat, random = Math.random } = {}) {
            this.weights = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
            this.antiRepeat = antiRepeat;
            this.random = random;
        }

        /**
         * @param {object} clip      a KB record
         * @param {object} intent    `{name, intensity, source, similarity}`
         * @param {object} bb        the blackboard
         * @returns {number} the utility, or -Infinity when a gate blocks it
         */
        score(clip, intent, bb, now = Date.now()) {
            // ── gates ────────────────────────────────────────────────────────
            // The one place. §6.5, plus the two lines B28 adds for the adult tier.
            // §16.1's triple gate. `adultVerified` is set by exactly one thing — an
            // `adult_ack` frame from the server (B28) — and it was missing from this line
            // until B28 landed, which meant the user setting alone opened the tier.
            if (clip.nsfw && !(bb.adultVerified && bb.nsfwAllowed && modeAllowsNsfw(bb.mode))) return BLOCKED;
            if (clip.nsfw && intent && intent.source && intent.source !== 'user') return BLOCKED;
            if (clip.nsfw && !tierAllows(bb.mode, clip, bb.escalationLevel)) return BLOCKED;
            if (!modeAllows(bb.mode, clip, bb)) return BLOCKED;

            const since = now - (this.antiRepeat ? this.antiRepeat.lastPlayed(clip.id) : 0);
            if (this.antiRepeat && this.antiRepeat.lastPlayed(clip.id) && since < (clip.cooldownMs || 0)) {
                return BLOCKED;
            }

            // ── utility ──────────────────────────────────────────────────────
            const w = this.weights;
            const similarity = Number(intent && intent.similarity) || 0;
            const novelty = this.antiRepeat ? this.antiRepeat.novelty(clip.id) : 1;

            return (
                w.semantic * similarity +
                w.energy * (1 - Math.abs(clip.energy - bb.energy)) +
                w.valence * (1 - Math.abs(clip.valence - bb.valence) / 2) +
                w.quality * (clip.quality === 'production' ? 1 : 0.4) +
                w.novelty * novelty
            );
        }

        /**
         * Rank candidates and pick one. Softmax-weighted among the survivors, so the best
         * clip usually wins and the second-best sometimes does.
         *
         * @returns {{clip: object, score: number, breakdown: object[]}|null}
         */
        best(candidates, intent, bb, now = Date.now()) {
            const scored = [];
            for (const candidate of candidates || []) {
                const clip = candidate.clip || candidate;
                const withSimilarity =
                    candidate.similarity !== undefined ? { ...intent, similarity: candidate.similarity } : intent;
                const value = this.score(clip, withSimilarity, bb, now);
                if (value !== BLOCKED) scored.push({ clip, score: value });
            }
            if (!scored.length) return null;

            scored.sort((a, b) => b.score - a.score || a.clip.id.localeCompare(b.clip.id));
            const chosen = softmaxPick(scored, this.random);
            return { clip: chosen.clip, score: chosen.score, breakdown: scored };
        }
    }

    /** Weighted random over exp(score * T). */
    function softmaxPick(scored, random) {
        const top = scored[0].score;
        const weights = scored.map((entry) => Math.exp((entry.score - top) * TEMPERATURE));
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = random() * total;
        for (let i = 0; i < scored.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return scored[i];
        }
        return scored[0];
    }

    /**
     * The blackboard is passed as a second argument so a mode can narrow on *state* rather
     * than on the clip alone — B23's play profile refuses a walking clip while the game has
     * the player's attention, and could not read that attention without it. Profiles that
     * ignore the argument are unaffected; a mode that throws is treated as permissive,
     * because a broken profile must not silence her entirely.
     */
    function modeAllows(mode, clip, bb) {
        if (!mode || typeof mode.allows !== 'function') return true;
        try {
            return Boolean(mode.allows(clip, bb));
        } catch {
            return true;
        }
    }

    function modeAllowsNsfw(mode) {
        if (!mode) return false;
        if (mode.allowNsfw === 'inherit') return true; // the user setting already decided
        return Boolean(mode.allowNsfw);
    }

    /** B28 fills this in; until then a mode with no tier rule permits what the gates allowed. */
    function tierAllows(mode, clip, level) {
        if (!mode || typeof mode.tierAllowed !== 'function') return true;
        try {
            return Boolean(mode.tierAllowed(clip, level));
        } catch {
            return false; // a tier rule that throws must close, not open
        }
    }

    return { Ranker, DEFAULT_WEIGHTS, TEMPERATURE, BLOCKED };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_RANKER = UtilityRanker;
if (typeof module !== 'undefined' && module.exports) module.exports = UtilityRanker;
