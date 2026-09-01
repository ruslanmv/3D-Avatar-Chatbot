/**
 * adult.profile — the tier's rules, as data (spec v1.1 §16.3, batch B29).
 *
 * Nothing in this tier changes the animation system. It is gating, pacing and consent around
 * behaviours the app already ships, and this file is where the pacing lives.
 *
 * ## `proactiveNsfw: false` is an invariant, not a setting
 *
 * It has no `true` branch anywhere. §16.4's source rule in the ranker — `clip.nsfw &&
 * intent.source !== 'user'` — is what actually enforces it, and this field exists so a
 * reviewer reading the profile sees the same claim the ranker makes. A profile that could
 * flip it would be a profile that could make her initiate, and nothing in this codebase
 * should be able to do that.
 *
 * ## `requires` is checked before activation, not after
 *
 * `ModeManager` refuses to enter a mode whose `requires` are not satisfied. That is a second
 * check on top of the ranker's, and it is deliberate belt-and-braces: the ranker stops the
 * *content*, and this stops the *mode*, so a bug in one is not a bug in both. §16.7's second
 * invariant is about the ranker; this is about never being in the room in the first place.
 *
 * ## Escalation is earned and reversible
 *
 * Four levels, each with a floor of two minutes and a check-in before it. `ConsentFlow` owns
 * the state machine; this owns the numbers and the ceiling. The ceiling maps a level to the
 * intents that may be selected at it — intents from the KB, never clip ids, so the mapping
 * survives new art.
 *
 * Exposes: window.NEXUS_BD_PROFILE_ADULT
 */
const AdultProfile = (() => {
    'use strict';

    /**
     * §16.3's ceiling. Cumulative: level 3 admits everything level 1 and 2 do, because a
     * ceiling that *replaced* the previous level's list would make advancing take things
     * away, which is not what "escalation" means to anybody.
     */
    const CEILING = {
        1: ['flirt'],
        2: ['flirt', 'tease', 'beckon'],
        3: ['flirt', 'tease', 'beckon', 'sensualSway', 'slowBurn'],
        4: ['flirt', 'tease', 'beckon', 'sensualSway', 'slowBurn', 'intimate'],
    };

    const LEVELS = 4;

    /** §16.3. Earned, never rushed: two minutes at a level before the next is offered. */
    const PER_LEVEL_MIN_MS = 120000;

    /** Inactivity cools it back down. A level is a state of an evening, not a setting. */
    const DECAY_TO_LEVEL = 1;
    const DECAY_AFTER_MS = 300000;

    /** Back to a warm companion, with no commentary about it. Configurable per §16.3. */
    const SOFT_EXIT_WORD = 'cozy';

    /** Out of the mode entirely, neutral idle, no comment. */
    const HARD_EXIT_WORDS = ['stop', 'exit'];

    return {
        id: 'adult',
        label: 'Date night / wind-down',

        /** ModeManager refuses activation unless both are true on the blackboard. */
        requires: ['adultVerified', 'nsfwAllowed'],

        adapters: ['gaze', 'media', 'session'],
        attention: { primary: 'user', glanceUserEveryMs: [3000, 8000] },
        commentaryOpenings: ['user:silent>15000', 'gaze:user-look-avatar>1200'],

        /** §16.5: curiosity here is relationship talk, and there is not much of it. */
        initiative: { budgetPerSession: 3, minGapMs: 120000 },

        allowNsfw: true,

        /** An invariant with no `true` branch anywhere. See the header. */
        proactiveNsfw: false,

        idleProfile: 'warm-attentive',
        scenes: ['sunset', 'candlelit'],

        /** §16.5. The clip engine is off here, and so is anything that reports. */
        privacy: { clipEngine: false, telemetry: false },

        escalation: {
            levels: LEVELS,
            start: 1,
            advance: 'user-affirmative-or-checkin-yes',
            checkInEveryLevel: true,
            perLevelMinMs: PER_LEVEL_MIN_MS,
            decayToLevel: DECAY_TO_LEVEL,
            decayAfterMs: DECAY_AFTER_MS,
            softExitWord: SOFT_EXIT_WORD,
            hardExit: HARD_EXIT_WORDS,
        },

        intensityCeilingByLevel: CEILING,

        /**
         * §16.4's second ranker line, as the profile's own method.
         *
         * Maps a clip's intents and tags against the ceiling for the current level. Unknown
         * levels are refused rather than clamped: a level this table does not describe is a
         * bug, and clamping it to 4 would resolve that bug in the most permissive direction
         * available.
         */
        tierAllowed(clip, level) {
            const allowed = CEILING[level];
            if (!allowed) return false;
            const names = [...((clip && clip.intents) || []), ...((clip && clip.tags) || [])];
            return names.some((name) => allowed.includes(name));
        },

        /**
         * A mode narrows; it never opens. Root motion is unrestricted here — she is in the
         * room with you — but the tier's own ceiling above is the thing that matters.
         */
        allows() {
            return true;
        },

        CEILING,
        LEVELS,
        PER_LEVEL_MIN_MS,
        DECAY_TO_LEVEL,
        DECAY_AFTER_MS,
        SOFT_EXIT_WORD,
        HARD_EXIT_WORDS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROFILE_ADULT = AdultProfile;
if (typeof module !== 'undefined' && module.exports) module.exports = AdultProfile;
