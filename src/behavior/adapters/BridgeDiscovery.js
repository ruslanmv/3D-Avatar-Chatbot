/**
 * BridgeDiscovery — find HomePilot without asking the user where it is (batch B35).
 *
 * Before this, reaching HomePilot meant typing a second URL into Settings: a `wss://` the
 * browser had to be able to open itself. That works on one machine and nowhere else. A page
 * served over HTTPS cannot open `ws://localhost:8000` — mixed content — and from a hosted
 * build "localhost" is not the user's machine at all. So the field was a setting that only
 * worked in the one configuration nobody ships.
 *
 * The user has already linked OllaBridge to get models. OllaBridge already knows whether a
 * HomePilot is behind it — `GET /health` has answered `homepilot_enabled` since long before
 * this batch — and it can already reach it, because that is what a bridge is. So the avatar
 * asks the bridge one question instead of asking the user one.
 *
 * **Absence means no.** A bridge that does not return the `avatar` block cannot proxy the
 * session, and every OllaBridge deployed today is such a bridge. That is the whole version
 * negotiation: no handshake, no minimum version, and an old bridge degrades to the chat path
 * — which already carries directives — rather than failing.
 *
 * This module only *reports*. It opens no socket, stores nothing, and its one network call
 * is a GET to an origin the user already configured. `boot.js` decides what to do with the
 * answer, and a manually typed URL still wins over anything found here.
 *
 * Exposes: window.NEXUS_BD_BRIDGE_DISCOVERY
 */
const BridgeDiscovery = (() => {
    'use strict';

    /** Where the chat client keeps its provider settings. Read, never written. */
    const LLM_SETTINGS_KEY = 'nexus_llm_settings';

    /** A discovery that answered nothing. Every field present, so callers need no guards. */
    const NOTHING = Object.freeze({
        available: false,
        reason: 'no-bridge',
        base: null,
        sessionUrl: null,
        auth: '',
        features: Object.freeze([]),
    });

    const HTTP_TIMEOUT_MS = 4000;

    /**
     * The bridge the chat client is pointed at, as `{base, auth}` — or null.
     *
     * Read from storage rather than from `window._nexusLLM`, deliberately: the director boots
     * from a script tag whose order relative to `main.js`'s construction is not something this
     * file should depend on. Storage is there either way.
     *
     * @param {Storage} [storage] injected for tests; `undefined` means find it yourself.
     */
    function bridgeSettings(storage) {
        const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
        if (!store) return null;
        let raw;
        try {
            raw = store.getItem(LLM_SETTINGS_KEY);
        } catch {
            return null; // storage disabled: no bridge, which is a valid answer
        }
        if (!raw) return null;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null; // a corrupt blob is not a bridge
        }
        const cfg = parsed && parsed.ollabridge;
        const base = String((cfg && cfg.base_url) || '')
            .trim()
            .replace(/\/+$/, '');
        if (!base) return null;

        // Whichever credential the user actually configured. `auth_mode` names the intent,
        // but a mode with an empty field is not a credential — fall through to the other
        // rather than sending an empty token the bridge will refuse.
        const key = String((cfg && cfg.api_key) || '').trim();
        const pair = String((cfg && cfg.pair_token) || '').trim();
        const preferPair = String((cfg && cfg.auth_mode) || '') === 'pair';
        const auth = (preferPair ? pair || key : key || pair) || '';
        return { base, auth };
    }

    /** `https://host/x` → `wss://host/x`. The scheme has to follow the page, not a guess. */
    function toWebSocket(url) {
        return String(url || '')
            .replace(/^http:/i, 'ws:')
            .replace(/^https:/i, 'wss:');
    }

    /**
     * Resolve a possibly-relative session path against the bridge's own origin.
     *
     * The bridge answers with a path (`/v1/avatar/session`) rather than a URL on purpose: it
     * does not always know how it is reached — behind a reverse proxy, a tunnel, or a
     * different hostname than the one it binds. The client knows, because it just called it.
     */
    function sessionUrlFrom(base, path) {
        const clean = String(path || '').trim();
        if (!clean) return null;
        if (/^wss?:/i.test(clean)) return clean;
        if (/^https?:/i.test(clean)) return toWebSocket(clean);
        return toWebSocket(base) + (clean.startsWith('/') ? clean : `/${clean}`);
    }

    /**
     * Ask the configured bridge what it can do.
     *
     * Never throws and never rejects: a bridge that is down, slow, or old is a `false`, not an
     * error to handle at every call site. The `reason` is what the Settings line shows, and it
     * is the difference between "you have no bridge", "your bridge has no HomePilot" and "your
     * bridge is too old" — three problems with three different fixes.
     *
     * @param {object} [deps]
     * @param {function} [deps.fetch] injected for tests
     * @param {Storage|null} [deps.storage] `null` means "there is no storage", not "find it"
     * @returns {Promise<{available:boolean, reason:string, base:?string, sessionUrl:?string,
     *   auth:string, features:string[]}>}
     */
    async function discover(deps = {}) {
        const settings = bridgeSettings(deps.storage);
        if (!settings) return NOTHING;

        const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);
        if (!doFetch) return { ...NOTHING, reason: 'no-fetch', base: settings.base };

        let health;
        try {
            const response = await withTimeout(
                doFetch(`${settings.base}/health`, { method: 'GET', headers: { Accept: 'application/json' } }),
                deps.timeoutMs || HTTP_TIMEOUT_MS
            );
            if (!response || !response.ok) {
                return { ...NOTHING, reason: 'bridge-unreachable', base: settings.base };
            }
            health = await response.json();
        } catch {
            return { ...NOTHING, reason: 'bridge-unreachable', base: settings.base };
        }

        if (!health || health.homepilot_enabled !== true) {
            return { ...NOTHING, reason: 'no-homepilot', base: settings.base };
        }

        // The capability block. A bridge that reports a HomePilot but cannot proxy the session
        // is a real and useful state: the chat path still carries directives, so she still
        // moves — she just cannot speak first. Saying so beats reporting a flat failure.
        const avatar = health.avatar;
        const path = avatar && typeof avatar === 'object' ? avatar.session : null;
        const sessionUrl = sessionUrlFrom(settings.base, path);
        if (!sessionUrl) {
            return { ...NOTHING, reason: 'bridge-too-old', base: settings.base };
        }

        return {
            available: true,
            reason: 'ok',
            base: settings.base,
            sessionUrl,
            // The bridge's own credential. It authenticates the browser to the bridge; the
            // bridge holds HomePilot's key and never hands it down. One secret, one origin.
            auth: settings.auth,
            features: Array.isArray(avatar.features) ? avatar.features.map(String) : [],
        };
    }

    /**
     * Reject after `ms` rather than inheriting fetch's default, which on a hung connection is
     * measured in minutes. A boot path may not wait that long to conclude "no".
     */
    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    return { discover, bridgeSettings, sessionUrlFrom, toWebSocket, NOTHING, LLM_SETTINGS_KEY };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_BRIDGE_DISCOVERY = BridgeDiscovery;
if (typeof module !== 'undefined' && module.exports) module.exports = BridgeDiscovery;
