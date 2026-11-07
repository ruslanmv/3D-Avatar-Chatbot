/**
 * Staged experience formats (IC3).
 *
 * Seaside Evening is the one that runs. The others are registered so the
 * library has a contract — id, destination, privacy scope, platforms — and
 * `implemented: false`. The director will not prepare them, and the
 * destination sheet does not draw a start button for them.
 *
 * Exposes: window.NEXUS_EXPERIENCE_FORMATS
 */
const ExperienceFormats = (() => {
    'use strict';

    function refuse() {
        return { ok: false, why: 'not-built' };
    }

    function staged(id, title, summary) {
        return {
            id: id,
            title: title,
            summary: summary,
            destination: 'experiences',
            implemented: false,
            supportedPlatforms: ['desktop', 'mobile', 'vr'],
            requiredCapabilities: [],
            optionalCapabilities: [],
            privacyScope: 'experiences',
            prepare: refuse,
            start: refuse,
            pause: refuse,
            resume: refuse,
            stop: function () {
                return true;
            },
            status: function () {
                return { id: id, implemented: false };
            },
            dispose: function () {},
        };
    }

    const STAGED = [
        staged('cozy-evening', 'Cozy Evening', 'A quiet room, shared music, and nothing that needs a plot.'),
        staged('mystery-adventure', 'Mystery Adventure', 'Clues, dialogue, and more than one ending. Not built yet.'),
        staged('creative-studio', 'Creative Studio', 'A shared making table. Not built yet.'),
        staged(
            'character-studio',
            'Character Studio',
            'Outfits and poses stay in the wardrobe and Pose Studio, which already work. This scene is not a second copy of them.'
        ),
    ];

    return { STAGED: STAGED, staged: staged };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_FORMATS = ExperienceFormats;
if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceFormats;
