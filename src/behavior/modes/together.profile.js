/**
 * together.profile — joint attention and the etiquette of shared activity (spec v1.1 §6.7).
 *
 * The rule this profile exists to encode is that **her silence is the feature**. She is
 * watching the thing you are watching, not narrating it, so commentary is allowed only at
 * openings: you paused, the scene cut, you looked at her, or the room went quiet. Between
 * openings she has nothing to say, and that is correct behaviour rather than a gap.
 *
 * Exposes: window.NEXUS_BD_PROFILE_TOGETHER
 */
const TogetherProfile = (() => {
    'use strict';

    return {
        id: 'together',
        label: 'Together mode',
        adapters: ['gaze', 'media', 'session'],
        attention: { primary: 'activityTarget', glanceUserEveryMs: [8000, 20000] },
        commentaryOpenings: ['media:paused', 'media:cut', 'gaze:user-look-avatar>1500', 'user:silent>12000'],
        initiative: { budgetPerSession: 4, minGapMs: 90000 },
        allowNsfw: 'inherit',
        idleProfile: 'relaxed-attentive',

        /**
         * While she is watching with you, a full-body clip that walks her across the room
         * breaks the joint attention the whole mode is built on.
         */
        allows(clip) {
            const rootMotion = (clip.stats && clip.stats.rootMotion) || 0;
            return rootMotion < 0.5;
        },
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROFILE_TOGETHER = TogetherProfile;
if (typeof module !== 'undefined' && module.exports) module.exports = TogetherProfile;
