/**
 * showcase.profile — cycle the whole library (spec v1.1 UC-10).
 *
 * A demo mode, and quietly the most useful QA tool in the engine: it is the only thing that
 * plays every record in the KB, so a retarget that breaks on one avatar surfaces here rather
 * than in front of a user. Novelty is everything and repetition is the enemy, so the
 * cycle is explicit rather than left to the ranker's softmax.
 *
 * Exposes: window.NEXUS_BD_PROFILE_SHOWCASE
 */
const ShowcaseProfile = (() => {
    'use strict';

    return {
        id: 'showcase',
        label: 'Showcase',
        adapters: ['speech'],
        attention: { primary: 'user', glanceUserEveryMs: [0, 0] },
        commentaryOpenings: [],
        initiative: { budgetPerSession: 0, minGapMs: 0 },
        /** A demo runs in front of whoever walks past. It never unlocks the adult tier. */
        allowNsfw: false,
        idleProfile: 'neutral',

        /** Experimental clips are the ones worth looking at here — that is the point. */
        allows() {
            return true;
        },

        /**
         * The cycle. Returns clips in a stable order so a QA pass is repeatable and two
         * runs can be compared; the ranker is bypassed deliberately.
         */
        cycle(registry) {
            return registry.records
                .filter((record) => !record.nsfw)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id));
        },
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROFILE_SHOWCASE = ShowcaseProfile;
if (typeof module !== 'undefined' && module.exports) module.exports = ShowcaseProfile;
