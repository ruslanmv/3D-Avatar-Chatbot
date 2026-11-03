/**
 * MemoryScopes — five stores, and a door on each one (IC1).
 *
 * GENERAL      preferences that are not personal (audio, comfort, avatar id)
 * LIFE         user-approved moments and relationship preferences
 * COPILOT      tasks, projects, and work state
 * EXPERIENCES  story progress and completed activities
 * PRIVATE      romantic or intimate settings, empty unless explicitly written
 *
 * Nothing here stores a chat transcript. A memory is a short title the person
 * approved, a closed enum, or a task they typed. `addMemory` refuses a record
 * that does not carry `approved: true`, so a passing line of dialogue cannot
 * become permanent by falling into the wrong function.
 *
 * Cross-scope reads are not this file's decision. Callers ask `PrivacyGate`
 * first. This module will still drop unknown fields, so a gate bug cannot
 * smuggle a free-text transcript through a field that was never in the schema.
 *
 * Clearing a conversation must not clear these keys. They are listed on
 * `NEXUS_CONVERSATION_RESET.KEPT`.
 *
 * Exposes: window.NEXUS_COMPANION_MEMORY
 */
const MemoryScopes = (() => {
    'use strict';

    const SCHEMA = 1;
    const KEY = 'nexus_companion_memory_v1';
    const SCOPES = Object.freeze(['general', 'life', 'copilot', 'experiences', 'private']);
    const RELATIONSHIP = Object.freeze({
        style: ['friendship', 'companionship', 'romance'],
        affection: ['quiet', 'warm', 'affectionate'],
        romance: ['off', 'light', 'romantic'],
        tone: ['calm', 'warm', 'playful', 'direct'],
    });

    function empty() {
        return {
            schemaVersion: SCHEMA,
            general: { entries: [] },
            life: {
                memories: [],
                relationship: { style: 'friendship', affection: 'warm', romance: 'off', address: '', tone: 'warm' },
            },
            copilot: { tasks: [], projects: [] },
            experiences: { progress: {}, completed: [] },
            private: { entries: [] },
        };
    }

    function clip(text, max) {
        const clean = String(text || '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return clean.slice(0, max);
    }

    function sanitiseRelationship(raw) {
        const out = empty().life.relationship;
        const src = raw || {};
        if (RELATIONSHIP.style.indexOf(src.style) !== -1) out.style = src.style;
        if (RELATIONSHIP.affection.indexOf(src.affection) !== -1) out.affection = src.affection;
        if (RELATIONSHIP.romance.indexOf(src.romance) !== -1) out.romance = src.romance;
        if (RELATIONSHIP.tone.indexOf(src.tone) !== -1) out.tone = src.tone;
        out.address = clip(src.address, 40);
        return out;
    }

    function sanitise(raw) {
        const base = empty();
        if (!raw || raw.schemaVersion !== SCHEMA) return base;
        base.life.relationship = sanitiseRelationship(raw.life && raw.life.relationship);
        base.life.memories = sanitiseList(raw.life && raw.life.memories);
        base.general.entries = sanitiseList(raw.general && raw.general.entries);
        base.private.entries = sanitiseList(raw.private && raw.private.entries);
        base.copilot.tasks = sanitiseTasks(raw.copilot && raw.copilot.tasks);
        base.copilot.projects = sanitiseProjects(raw.copilot && raw.copilot.projects);
        const progress = raw.experiences && raw.experiences.progress;
        if (progress && typeof progress === 'object') {
            for (const id of Object.keys(progress)) {
                if (!/^[a-z0-9-]{1,64}$/.test(id)) continue;
                const value = progress[id];
                if (!value || typeof value !== 'object') continue;
                base.experiences.progress[id] = {
                    beat: clip(value.beat, 40),
                    outcome: clip(value.outcome, 40),
                    shellTouched: value.shellTouched === true,
                    lanternLit: value.lanternLit === true,
                    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
                };
            }
        }
        base.experiences.completed = Array.isArray(raw.experiences && raw.experiences.completed)
            ? raw.experiences.completed
                  .filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id))
                  .slice(0, 40)
            : [];
        return base;
    }

    function sanitiseList(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const item of list) {
            if (!item || item.approved !== true) continue;
            const title = clip(item.title, 80);
            if (!title) continue;
            out.push({
                id: typeof item.id === 'string' ? item.id.slice(0, 40) : 'mem_' + out.length,
                title: title,
                at: Number.isFinite(item.at) ? item.at : 0,
                approved: true,
            });
            if (out.length >= 50) break;
        }
        return out;
    }

    function sanitiseTasks(list) {
        if (!Array.isArray(list)) return [];
        return list
            .slice(0, 100)
            .map((task, index) => ({
                id: task && typeof task.id === 'string' ? task.id.slice(0, 40) : 'task_' + index,
                title: clip(task && task.title, 120),
                priority: ['low', 'normal', 'high'].indexOf(task && task.priority) !== -1 ? task.priority : 'normal',
                done: task && task.done === true,
                projectId: task && typeof task.projectId === 'string' ? task.projectId.slice(0, 40) : null,
                steps: Array.isArray(task && task.steps)
                    ? task.steps.slice(0, 30).map((step) => ({
                          title: clip(step && step.title, 120),
                          done: step && step.done === true,
                      }))
                    : [],
            }))
            .filter((task) => task.title);
    }

    function sanitiseProjects(list) {
        if (!Array.isArray(list)) return [];
        return list
            .slice(0, 40)
            .map((project, index) => ({
                id: project && typeof project.id === 'string' ? project.id.slice(0, 40) : 'prj_' + index,
                title: clip(project && project.title, 80),
                summary: clip(project && project.summary, 160),
            }))
            .filter((project) => project.title);
    }

    function create(options) {
        const options_ = options || {};
        const storage = options_.storage || null;
        const now = options_.now || (() => Date.now());
        let data = empty();

        function persist() {
            if (!storage) return false;
            try {
                storage.setItem(KEY, JSON.stringify(data));
                return true;
            } catch (_) {
                return false;
            }
        }

        function load() {
            if (!storage) return data;
            try {
                const raw = storage.getItem(KEY);
                data = raw ? sanitise(JSON.parse(raw)) : empty();
            } catch (_) {
                data = empty();
            }
            return data;
        }

        function scopeBag(scope) {
            if (SCOPES.indexOf(scope) === -1) return null;
            return data[scope];
        }

        const api = {
            SCHEMA: SCHEMA,
            KEY: KEY,
            SCOPES: SCOPES,
            RELATIONSHIP: RELATIONSHIP,
            load: load,
            /**
             * The bag for one scope. Callers that have not passed the privacy
             * gate should not call this — the gate is the policy, this is the drawer.
             */
            read: function (scope) {
                const bag = scopeBag(scope);
                return bag ? JSON.parse(JSON.stringify(bag)) : null;
            },
            addMemory: function (scope, item) {
                if (scope !== 'life' && scope !== 'general' && scope !== 'private') {
                    return { ok: false, why: 'scope-has-no-memories' };
                }
                if (!item || item.approved !== true) return { ok: false, why: 'not-approved' };
                const title = clip(item.title, 80);
                if (!title) return { ok: false, why: 'empty' };
                const bag = scopeBag(scope);
                const list = scope === 'life' ? bag.memories : bag.entries;
                const record = {
                    id: 'mem_' + now().toString(36) + '_' + list.length,
                    title: title,
                    at: now(),
                    approved: true,
                };
                list.push(record);
                persist();
                return { ok: true, memory: record };
            },
            deleteMemory: function (scope, id) {
                const bag = scopeBag(scope);
                if (!bag) return false;
                const key = scope === 'life' ? 'memories' : 'entries';
                if (!bag[key]) return false;
                const before = bag[key].length;
                bag[key] = bag[key].filter((item) => item.id !== id);
                if (bag[key].length === before) return false;
                persist();
                return true;
            },
            setRelationship: function (patch) {
                data.life.relationship = sanitiseRelationship(Object.assign({}, data.life.relationship, patch || {}));
                persist();
                return Object.assign({}, data.life.relationship);
            },
            saveTasks: function (tasks, projects) {
                data.copilot.tasks = sanitiseTasks(tasks);
                if (projects) data.copilot.projects = sanitiseProjects(projects);
                persist();
                return { tasks: data.copilot.tasks.slice(), projects: data.copilot.projects.slice() };
            },
            saveProgress: function (experienceId, progress) {
                if (!/^[a-z0-9-]{1,64}$/.test(experienceId)) return { ok: false, why: 'bad-id' };
                const sanitised = sanitise({
                    schemaVersion: SCHEMA,
                    experiences: { progress: { [experienceId]: progress }, completed: data.experiences.completed },
                });
                data.experiences.progress[experienceId] = sanitised.experiences.progress[experienceId] || {
                    beat: '',
                    outcome: '',
                    shellTouched: false,
                    lanternLit: false,
                    updatedAt: now(),
                };
                data.experiences.progress[experienceId].updatedAt = now();
                persist();
                return { ok: true, progress: Object.assign({}, data.experiences.progress[experienceId]) };
            },
            completeExperience: function (experienceId) {
                if (!/^[a-z0-9-]{1,64}$/.test(experienceId)) return false;
                if (data.experiences.completed.indexOf(experienceId) === -1) {
                    data.experiences.completed.push(experienceId);
                }
                persist();
                return true;
            },
            /** JSON the caller is allowed to see. The caller names the scopes. */
            exportScopes: function (scopes) {
                const out = { schemaVersion: SCHEMA, exportedAt: now(), scopes: {} };
                for (const scope of scopes || []) {
                    if (SCOPES.indexOf(scope) === -1) continue;
                    out.scopes[scope] = JSON.parse(JSON.stringify(data[scope]));
                }
                return out;
            },
            forgetScope: function (scope) {
                if (SCOPES.indexOf(scope) === -1) return false;
                const fresh = empty();
                data[scope] = fresh[scope];
                persist();
                return true;
            },
            reset: function () {
                data = empty();
                if (storage) {
                    try {
                        storage.removeItem(KEY);
                    } catch (_) {
                        /* already gone */
                    }
                }
            },
        };
        load();
        return api;
    }

    return { SCHEMA: SCHEMA, KEY: KEY, SCOPES: SCOPES, RELATIONSHIP: RELATIONSHIP, create: create, sanitise: sanitise };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_MEMORY = MemoryScopes;
if (typeof module !== 'undefined' && module.exports) module.exports = MemoryScopes;
