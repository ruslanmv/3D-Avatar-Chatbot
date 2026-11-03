/**
 * ExperienceSession — the lifecycle, and nothing else (IC2).
 *
 * Status moves in one direction except for pause/resume:
 *
 *   idle → preparing → active → paused → active
 *   preparing|active|paused → stopped | failed | completed
 *
 * `preparing` exists so a cancel during load cannot be overwritten by the
 * load finishing. The generation on the call must still match.
 *
 * Exposes: window.NEXUS_EXPERIENCE_SESSION
 */
const ExperienceSession = (() => {
    'use strict';

    const STATUSES = Object.freeze(['idle', 'preparing', 'active', 'paused', 'completed', 'stopped', 'failed']);

    function create() {
        let status = 'idle';
        let experienceId = null;
        let generation = 0;
        let reason = '';

        function set(next, id, why) {
            status = next;
            if (id !== undefined) experienceId = id;
            if (why !== undefined) reason = why;
        }

        return {
            STATUSES: STATUSES,
            get status() {
                return status;
            },
            get experienceId() {
                return experienceId;
            },
            get generation() {
                return generation;
            },
            get reason() {
                return reason;
            },
            begin: function (id) {
                if (status === 'preparing' || status === 'active' || status === 'paused') {
                    return { ok: false, why: 'busy', status: status };
                }
                generation += 1;
                set('preparing', id, '');
                return { ok: true, generation: generation, status: status };
            },
            markActive: function (gen) {
                if (gen !== generation || status !== 'preparing') return { ok: false, why: 'stale', status: status };
                set('active', experienceId, '');
                return { ok: true, status: status };
            },
            pause: function () {
                if (status !== 'active') return { ok: false, why: 'not-active', status: status };
                set('paused', experienceId, 'pause');
                return { ok: true, status: status };
            },
            resume: function () {
                if (status !== 'paused') return { ok: false, why: 'not-paused', status: status };
                set('active', experienceId, '');
                return { ok: true, status: status };
            },
            complete: function () {
                if (status !== 'active' && status !== 'paused')
                    return { ok: false, why: 'not-running', status: status };
                generation += 1;
                set('completed', experienceId, 'completed');
                return { ok: true, status: status };
            },
            fail: function (why) {
                generation += 1;
                set('failed', experienceId, why || 'failed');
                return { ok: true, status: status };
            },
            stop: function (why) {
                if (status === 'idle') return { ok: true, why: 'idle', status: status, generation: generation };
                generation += 1;
                set('stopped', null, why || 'stop');
                return { ok: true, status: status, generation: generation };
            },
            matches: function (gen) {
                return gen === generation && status === 'preparing';
            },
        };
    }

    return { create: create, STATUSES: STATUSES };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_SESSION = ExperienceSession;
if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceSession;
