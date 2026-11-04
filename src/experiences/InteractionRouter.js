/**
 * InteractionRouter — one function for a ray, a click, and a button (IC3).
 *
 * Desktop buttons, a mouse ray, and a VR controller ray all end in
 * `select(id)`. The router does not know which controller button that was.
 * VRControllers asks `trySelect` and, on a hit, does not also start
 * push-to-talk. A miss returns false so the trigger keeps its existing job.
 *
 * Exposes: window.NEXUS_EXPERIENCE_INTERACTION
 */
const InteractionRouter = (() => {
    'use strict';

    function create(options) {
        const onSelect = (options && options.onSelect) || function () {};
        let targets = [];

        function objectId(object) {
            let node = object;
            while (node) {
                if (node.userData && node.userData.experienceSelectable && node.userData.experienceId) {
                    return node.userData.experienceId;
                }
                node = node.parent;
            }
            return null;
        }

        return {
            setTargets: function (list) {
                targets = Array.isArray(list) ? list.slice() : [];
            },
            select: function (id) {
                if (!id) return { ok: false, why: 'empty' };
                const result = onSelect(id);
                return result && result.ok === false ? result : { ok: true, id: id, result: result };
            },
            /**
             * @returns {boolean} true when an experience object consumed the ray
             */
            trySelect: function (raycaster) {
                if (!raycaster || typeof raycaster.intersectObjects !== 'function' || !targets.length) return false;
                let hits = [];
                try {
                    hits = raycaster.intersectObjects(targets, true) || [];
                } catch (_) {
                    return false;
                }
                if (!hits.length) return false;
                const id = objectId(hits[0].object);
                if (!id) return false;
                onSelect(id);
                return true;
            },
        };
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_INTERACTION = InteractionRouter;
if (typeof module !== 'undefined' && module.exports) module.exports = InteractionRouter;
