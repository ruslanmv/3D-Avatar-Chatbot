/**
 * companion.profile — the default, formalised (spec v1.1 §6.7).
 *
 * This is what she already was before modes existed, written down so it can be returned to
 * exactly. That matters more than it sounds: every other mode is a departure from this one,
 * and "switching back restores companion exactly" is only checkable if companion is data
 * rather than the absence of data.
 *
 * Exposes: window.NEXUS_BD_PROFILE_COMPANION
 */
const CompanionProfile = (() => {
    'use strict';

    return {
        id: 'companion',
        label: 'Companion',
        adapters: ['tag', 'sentiment', 'speech', 'idle', 'gaze'],
        attention: { primary: 'user', glanceUserEveryMs: [0, 0] },
        commentaryOpenings: ['user:silent>20000'],
        initiative: { budgetPerSession: 2, minGapMs: 120000 },
        /** The user setting decides; the mode does not widen it. */
        allowNsfw: 'inherit',
        idleProfile: 'relaxed-attentive',
        /** Everything the gates already allow. A mode narrows; it never opens. */
        allows() {
            return true;
        },
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROFILE_COMPANION = CompanionProfile;
if (typeof module !== 'undefined' && module.exports) module.exports = CompanionProfile;
