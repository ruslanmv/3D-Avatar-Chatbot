/**
 * CompanionSession — one companion, one conversation, three destinations (IC1).
 *
 * The chat transcript already has an owner: `window.chatHistory` and
 * `nexus_chat_messages`. This session does not take a copy of it. What it
 * remembers is the identity of the conversation and which destination the
 * person is in, so moving from Life to Copilot cannot mint a second chatbot
 * or wipe the thread they were just having.
 *
 * Persisted fields are an allow-list. A relationship note, a task, or a story
 * beat belongs to `MemoryScopes`, which can refuse a reader. Putting them on
 * this object would make every destination able to see them by reading one key.
 *
 * `schemaVersion` is 1. A stored blob from a later version is not guessed at:
 * unknown versions come back as a fresh session rather than a half-migrated
 * one. Legacy destination names (`together`, `journey`, `coach`, `game`) map
 * onto the three destinations so a key written during the migration still opens.
 *
 * Exposes: window.NEXUS_COMPANION_SESSION
 */
const CompanionSession = (() => {
    'use strict';

    const SCHEMA = 1;
    const KEY = 'nexus_companion_session_v1';
    const NAV_KEY = 'nexus_companion_nav';
    const DESTINATIONS = Object.freeze(['life', 'copilot', 'experiences']);
    const LEGACY_DESTINATION = Object.freeze({
        together: 'life',
        journey: 'experiences',
        coach: 'copilot',
        game: 'experiences',
        play: 'experiences',
        playground: 'experiences',
    });

    function blank(now) {
        const at = now();
        return {
            schemaVersion: SCHEMA,
            sessionId: uid('ses'),
            companionId: 'nexus',
            conversationId: uid('cnv'),
            activeDestination: 'life',
            activeExperienceId: null,
            // IC2. Which Together option opened the destination ("talk", "relax",
            // "copilot-hour"…) and whether that session is still on. Selecting a
            // destination changes what the model is told; ending it stops that.
            activeActivity: null,
            // 'together' when a Together option started it, 'conversation' when ContextIntent
            // noticed the topic move. Only the first kind is an activity with an End.
            activitySource: null,
            sessionActive: false,
            avatarState: { id: null },
            sceneState: { id: null, restored: true },
            voiceState: { muted: false, companion: 1, environment: 0.45 },
            privacyScopes: { grants: [] },
            grantedCapabilities: [],
            comfort: { minDistance: 0.8, reducedMotion: false, seated: true },
            customized: false,
            startedAt: at,
            updatedAt: at,
        };
    }

    function uid(prefix) {
        const rand = Math.random().toString(36).slice(2, 10);
        return prefix + '_' + Date.now().toString(36) + rand;
    }

    function clamp01(n, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(1, Math.max(0, v));
    }

    function destinationOf(value) {
        if (DESTINATIONS.indexOf(value) !== -1) return value;
        if (value && LEGACY_DESTINATION[value]) return LEGACY_DESTINATION[value];
        return 'life';
    }

    /** A Together option id: short, lowercase, dashes. Anything else is not stored. */
    function activityOf(value) {
        return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : null;
    }

    function sanitise(raw, now) {
        const base = blank(now);
        if (!raw || typeof raw !== 'object') return base;
        if (raw.schemaVersion !== SCHEMA) return base;
        base.sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : base.sessionId;
        base.companionId = typeof raw.companionId === 'string' && raw.companionId ? raw.companionId : 'nexus';
        base.conversationId =
            typeof raw.conversationId === 'string' && raw.conversationId ? raw.conversationId : base.conversationId;
        base.activeDestination = destinationOf(raw.activeDestination);
        base.activeExperienceId = typeof raw.activeExperienceId === 'string' ? raw.activeExperienceId : null;
        base.activeActivity = activityOf(raw.activeActivity);
        base.activitySource =
            raw.activitySource === 'conversation'
                ? 'conversation'
                : raw.activitySource === 'together'
                  ? 'together'
                  : null;
        base.sessionActive = raw.sessionActive === true;
        base.avatarState = {
            id: raw.avatarState && typeof raw.avatarState.id === 'string' ? raw.avatarState.id : null,
        };
        base.sceneState = {
            id: raw.sceneState && typeof raw.sceneState.id === 'string' ? raw.sceneState.id : null,
            restored: !(raw.sceneState && raw.sceneState.restored === false),
        };
        const voice = raw.voiceState || {};
        base.voiceState = {
            muted: voice.muted === true,
            companion: clamp01(voice.companion, 1),
            environment: clamp01(voice.environment, 0.45),
        };
        const grants = raw.privacyScopes && Array.isArray(raw.privacyScopes.grants) ? raw.privacyScopes.grants : [];
        base.privacyScopes = {
            grants: grants.filter(
                (g) => typeof g === 'string' && /^memory:(general|life|copilot|experiences|private)$/.test(g)
            ),
        };
        base.grantedCapabilities = Array.isArray(raw.grantedCapabilities)
            ? raw.grantedCapabilities.filter((c) => typeof c === 'string' && c.length < 40)
            : [];
        const comfort = raw.comfort || {};
        const minDistance = Number(comfort.minDistance);
        base.comfort = {
            minDistance: Number.isFinite(minDistance) ? Math.min(3, Math.max(0.4, minDistance)) : 0.8,
            reducedMotion: comfort.reducedMotion === true,
            seated: comfort.seated !== false,
        };
        base.customized = raw.customized === true;
        base.startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : base.startedAt;
        base.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : base.updatedAt;
        return base;
    }

    function create(options) {
        const options_ = options || {};
        const now = options_.now || (() => Date.now());
        const storage = options_.storage || null;
        const listeners = new Set();
        let state = blank(now);
        let loaded = false;

        function emit(type, extra) {
            const detail = Object.assign({ type: type, session: snapshot() }, extra || {});
            for (const listener of listeners) {
                try {
                    listener(detail);
                } catch (error) {
                    console.warn('[Companion] session listener threw', error);
                }
            }
        }

        function snapshot() {
            return JSON.parse(JSON.stringify(state));
        }

        function persist() {
            state.updatedAt = now();
            if (!storage) return false;
            try {
                storage.setItem(KEY, JSON.stringify(state));
                return true;
            } catch (_) {
                return false;
            }
        }

        function load() {
            loaded = true;
            if (!storage) return state;
            try {
                const raw = storage.getItem(KEY);
                if (!raw) return state;
                const parsed = JSON.parse(raw);
                const before = parsed && parsed.activeDestination;
                state = sanitise(parsed, now);
                if (before && before !== state.activeDestination && LEGACY_DESTINATION[before]) {
                    state.customized = true;
                    persist();
                }
            } catch (_) {
                state = blank(now);
            }
            return state;
        }

        function touch() {
            state.customized = true;
            persist();
        }

        const api = {
            SCHEMA: SCHEMA,
            KEY: KEY,
            DESTINATIONS: DESTINATIONS,
            load: load,
            snapshot: snapshot,
            conversationId: function () {
                if (!loaded) load();
                return state.conversationId;
            },
            destination: function () {
                if (!loaded) load();
                return state.activeDestination;
            },
            /**
             * Change destination. The conversation id is intentionally not touched.
             * Passing the current destination is a no-op so a re-render cannot look
             * like a navigation.
             */
            setDestination: function (id) {
                if (!loaded) load();
                const next = destinationOf(id);
                if (!DESTINATIONS.includes(id) && !LEGACY_DESTINATION[id]) {
                    return { ok: false, why: 'unknown-destination', destination: state.activeDestination };
                }
                if (next === state.activeDestination) {
                    return { ok: true, destination: next, changed: false, conversationId: state.conversationId };
                }
                const from = state.activeDestination;
                state.activeDestination = next;
                touch();
                emit('destination:changed', { from: from, to: next, conversationId: state.conversationId });
                return { ok: true, destination: next, changed: true, conversationId: state.conversationId };
            },
            /**
             * IC2. Set the context: the destination, the activity, and where it came
             * from (`{ source: 'together' }` by default, `'conversation'` when
             * ContextIntent noticed the topic move). Always emits `session:entered`;
             * ActivityMarks decides whether that is worth a line in the chat.
             */
            enter: function (id, activity, how) {
                if (!loaded) load();
                if (!DESTINATIONS.includes(id) && !LEGACY_DESTINATION[id]) {
                    return { ok: false, why: 'unknown-destination', destination: state.activeDestination };
                }
                const next = destinationOf(id);
                const from = state.sessionActive ? state.activeDestination : null;
                const changed = next !== state.activeDestination;
                state.activeDestination = next;
                state.activeActivity = activityOf(activity);
                state.activitySource = how && how.source === 'conversation' ? 'conversation' : 'together';
                state.sessionActive = true;
                touch();
                if (changed) {
                    emit('destination:changed', {
                        from: from || next,
                        to: next,
                        conversationId: state.conversationId,
                    });
                }
                emit('session:entered', {
                    from: from,
                    destination: next,
                    activity: state.activeActivity,
                    source: state.activitySource,
                    // IC3: she started it herself and has already said so (ActivityVoice).
                    silent: Boolean(how && how.silent),
                    conversationId: state.conversationId,
                });
                return { ok: true, destination: next, activity: state.activeActivity, changed: changed };
            },
            /** IC2. End the destination session. The conversation itself is untouched. */
            end: function (how) {
                if (!loaded) load();
                if (!state.sessionActive) return { ok: true, ended: false };
                const destination = state.activeDestination;
                state.sessionActive = false;
                state.activeActivity = null;
                state.activitySource = null;
                persist();
                emit('session:ended', {
                    destination: destination,
                    conversationId: state.conversationId,
                    silent: Boolean(how && how.silent),
                });
                return { ok: true, ended: true, destination: destination };
            },
            active: function () {
                if (!loaded) load();
                return state.sessionActive === true;
            },
            activity: function () {
                if (!loaded) load();
                return state.activeActivity;
            },
            source: function () {
                if (!loaded) load();
                return state.activitySource;
            },
            setExperience: function (id) {
                if (!loaded) load();
                state.activeExperienceId = id || null;
                if (id) state.sceneState = { id: id, restored: false };
                persist();
            },
            markSceneRestored: function () {
                state.sceneState = { id: state.sceneState.id, restored: true };
                state.activeExperienceId = null;
                persist();
            },
            setAvatarId: function (id) {
                if (!loaded) load();
                state.avatarState = { id: typeof id === 'string' ? id : null };
                persist();
            },
            voice: function () {
                if (!loaded) load();
                return Object.assign({}, state.voiceState);
            },
            setVoice: function (patch) {
                if (!loaded) load();
                const voice = state.voiceState;
                if (patch && patch.muted != null) voice.muted = patch.muted === true;
                if (patch && patch.companion != null) voice.companion = clamp01(patch.companion, voice.companion);
                if (patch && patch.environment != null) {
                    voice.environment = clamp01(patch.environment, voice.environment);
                }
                touch();
                return Object.assign({}, voice);
            },
            comfort: function () {
                if (!loaded) load();
                return Object.assign({}, state.comfort);
            },
            setComfort: function (patch) {
                if (!loaded) load();
                if (patch && patch.minDistance != null) {
                    const n = Number(patch.minDistance);
                    if (Number.isFinite(n)) state.comfort.minDistance = Math.min(3, Math.max(0.4, n));
                }
                if (patch && patch.reducedMotion != null) state.comfort.reducedMotion = patch.reducedMotion === true;
                if (patch && patch.seated != null) state.comfort.seated = patch.seated !== false;
                touch();
                return Object.assign({}, state.comfort);
            },
            grants: function () {
                if (!loaded) load();
                return state.privacyScopes.grants.slice();
            },
            grantScope: function (scope) {
                const token = 'memory:' + scope;
                if (state.privacyScopes.grants.indexOf(token) === -1) state.privacyScopes.grants.push(token);
                touch();
                return state.privacyScopes.grants.slice();
            },
            revokeScope: function (scope) {
                const token = 'memory:' + scope;
                state.privacyScopes.grants = state.privacyScopes.grants.filter((g) => g !== token);
                touch();
                return state.privacyScopes.grants.slice();
            },
            capabilities: function () {
                if (!loaded) load();
                return state.grantedCapabilities.slice();
            },
            grantCapability: function (name) {
                if (typeof name !== 'string' || !name) return state.grantedCapabilities.slice();
                if (state.grantedCapabilities.indexOf(name) === -1) state.grantedCapabilities.push(name);
                touch();
                return state.grantedCapabilities.slice();
            },
            revokeCapability: function (name) {
                state.grantedCapabilities = state.grantedCapabilities.filter((c) => c !== name);
                touch();
                emit('permission:revoked', { capability: name });
                return state.grantedCapabilities.slice();
            },
            customized: function () {
                if (!loaded) load();
                return state.customized === true;
            },
            on: function (listener) {
                if (typeof listener !== 'function') return function () {};
                listeners.add(listener);
                return function () {
                    listeners.delete(listener);
                };
            },
            reset: function () {
                state = blank(now);
                loaded = true;
                if (storage) {
                    try {
                        storage.removeItem(KEY);
                    } catch (_) {
                        /* already gone */
                    }
                }
            },
        };
        return api;
    }

    function navEnabled(storage) {
        try {
            if (!storage) return true;
            return storage.getItem(NAV_KEY) !== 'false';
        } catch (_) {
            return true;
        }
    }

    const api = {
        SCHEMA: SCHEMA,
        KEY: KEY,
        NAV_KEY: NAV_KEY,
        DESTINATIONS: DESTINATIONS,
        LEGACY_DESTINATION: LEGACY_DESTINATION,
        create: create,
        navEnabled: navEnabled,
        sanitise: function (raw, now) {
            return sanitise(raw, now || (() => Date.now()));
        },
    };
    return api;
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_SESSION = CompanionSession;
if (typeof module !== 'undefined' && module.exports) module.exports = CompanionSession;
