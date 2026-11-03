/**
 * ExperienceRegistry — what can be started, and what must not pretend (IC2).
 *
 * A definition is refused when it cannot be stopped. `implemented: false` is
 * a legal registration: it is how a format keeps its contract in the library
 * without appearing as a working activity. `start` on the director refuses
 * those before `prepare` is ever called.
 *
 * Exposes: window.NEXUS_EXPERIENCE_REGISTRY
 */
const ExperienceRegistry = (() => {
    'use strict';

    const REQUIRED = ['id', 'title', 'destination', 'prepare', 'start', 'pause', 'resume', 'stop', 'status', 'dispose'];

    function problemsFor(definition) {
        const problems = [];
        if (!definition || typeof definition !== 'object') return ['not an object'];
        for (const key of REQUIRED) {
            if (definition[key] == null) problems.push('missing ' + key);
        }
        if (definition.id && !/^[a-z0-9-]{1,64}$/.test(definition.id)) problems.push('id must be a slug');
        if (definition.destination && ['life', 'copilot', 'experiences'].indexOf(definition.destination) === -1) {
            problems.push('destination is not life, copilot, or experiences');
        }
        for (const fn of ['prepare', 'start', 'pause', 'resume', 'stop', 'status', 'dispose']) {
            if (definition[fn] != null && typeof definition[fn] !== 'function')
                problems.push(fn + ' must be a function');
        }
        if (definition.implemented !== false && typeof definition.stop !== 'function') {
            problems.push('a startable experience must be stoppable');
        }
        return problems;
    }

    function create() {
        const items = new Map();

        return {
            register: function (definition) {
                const problems = problemsFor(definition);
                if (problems.length) return { ok: false, why: problems.join('; '), problems: problems };
                if (items.has(definition.id)) return { ok: false, why: 'duplicate' };
                items.set(definition.id, definition);
                return { ok: true };
            },
            get: function (id) {
                return items.get(id) || null;
            },
            list: function (filter) {
                const all = [...items.values()];
                if (!filter) return all;
                return all.filter((item) => {
                    if (filter.destination && item.destination !== filter.destination) return false;
                    if (filter.implemented === true && item.implemented === false) return false;
                    if (
                        filter.platform &&
                        Array.isArray(item.supportedPlatforms) &&
                        item.supportedPlatforms.indexOf(filter.platform) === -1
                    ) {
                        return false;
                    }
                    return true;
                });
            },
            problemsFor: problemsFor,
        };
    }

    return { create: create, problemsFor: problemsFor, REQUIRED: REQUIRED };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_REGISTRY = ExperienceRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceRegistry;
