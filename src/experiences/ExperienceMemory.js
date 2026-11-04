/**
 * ExperienceMemory — story progress in the EXPERIENCES scope only (IC2).
 *
 * A beat id and two flags. The sentences stay in `story.js` and are rebuilt
 * on restore, so this store cannot become a second transcript.
 *
 * Exposes: window.NEXUS_EXPERIENCE_MEMORY
 */
const ExperienceMemory = (() => {
    'use strict';

    function create(memory) {
        return {
            save: function (id, progress) {
                if (!memory || typeof memory.saveProgress !== 'function') return { ok: false, why: 'no-store' };
                return memory.saveProgress(id, progress);
            },
            read: function (id) {
                if (!memory || typeof memory.read !== 'function') return null;
                const bag = memory.read('experiences');
                if (!bag || !bag.progress) return null;
                return bag.progress[id] || null;
            },
            complete: function (id) {
                if (!memory || typeof memory.completeExperience !== 'function') return false;
                return memory.completeExperience(id);
            },
        };
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_MEMORY = ExperienceMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceMemory;
