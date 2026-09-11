/**
 * Which provider answers a capability (batch D2, for D3).
 *
 * Small on purpose. One provider exists; the registry's whole job today is to let Together
 * ask *"who can search for video?"* instead of naming YouTube, so the day a second one
 * arrives the picker does not change.
 *
 * There is no priority configuration, no per-user ordering and no fallback chain — those
 * belong to D6, when there is something to order. Building them now would be a framework for
 * providers that do not exist, which is exactly what turns this into an unfinished subsystem.
 *
 * Exposes: window.NEXUS_DISCOVERY
 */
const ProviderRegistry = (() => {
    'use strict';

    /** Registration order is the fallback order; D6 lets the user name one instead. */
    const providers = [];

    /** The one object every discovery setting lives in. `YouTubeSettings` shares it. */
    const SETTINGS_KEY = 'nexus_discovery_settings';

    function store(storage) {
        if (storage !== undefined) {
            return storage;
        }
        try {
            return typeof localStorage !== 'undefined' ? localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Which provider the user picked, per capability group. `auto` everywhere by default.
     *
     * Keyed by the part before the dot — `video.search` and `video.play` are one choice, not
     * two, because "which video provider" is one question a person answers once.
     */
    function preferences(storage) {
        const s = store(storage);
        if (!s) {
            return {};
        }
        try {
            const parsed = JSON.parse(s.getItem(SETTINGS_KEY) || 'null');
            const prefs = parsed && parsed.preferences;
            return prefs && typeof prefs === 'object' ? prefs : {};
        } catch (_) {
            return {};
        }
    }

    /** Record a choice. `auto` (or anything unknown) means "you decide". */
    function setPreference(group, providerId, storage) {
        const s = store(storage);
        let parsed = {};
        if (s) {
            try {
                parsed = JSON.parse(s.getItem(SETTINGS_KEY) || 'null') || {};
            } catch (_) {
                parsed = {};
            }
        }
        const next = Object.assign({}, parsed.preferences, { [group]: String(providerId || 'auto') });
        parsed.preferences = next;
        if (s) {
            try {
                s.setItem(SETTINGS_KEY, JSON.stringify(parsed));
            } catch (_) {
                // Storage disabled. The choice applies to this session through `parsed`.
            }
        }
        return next;
    }

    function groupOf(capability) {
        return String(capability || '').split('.')[0];
    }

    function register(provider) {
        if (!provider || !provider.ID) {
            return providers.length;
        }
        const at = providers.findIndex((p) => p.ID === provider.ID);
        if (at >= 0) {
            providers[at] = provider;
        } else {
            providers.push(provider);
        }
        return providers.length;
    }

    /**
     * One provider's readiness, and never an exception (D8).
     *
     * `all()` and `forCapability` walk every registered provider, so a single one whose
     * `status()` throws would take down search for the others — a third-party provider
     * breaking the two that work. A provider that cannot say how it is, is not available.
     */
    function statusOf(provider) {
        try {
            const s = provider.status();
            return {
                id: provider.ID,
                configured: Boolean(s && s.configured),
                available: Boolean(s && s.available),
                capabilities: Array.isArray(s && s.capabilities) ? s.capabilities : [],
                reason: (s && s.reason) || 'unknown',
            };
        } catch (_) {
            return { id: provider.ID, configured: false, available: false, capabilities: [], reason: 'broken' };
        }
    }

    /**
     * Optional provider-owned credential metadata.
     *
     * A named provider in the consumer Settings UI means "use my key" when that provider
     * supports a personal credential. `Auto` is the site/automatic path. Keeping this tiny
     * hook on the provider prevents the registry from learning where YouTube, Pexels, or any
     * future provider stores its key.
     */
    function credentialStatusOf(provider, storage) {
        if (!provider || typeof provider.credentialStatus !== 'function') {
            return null;
        }
        try {
            const state = provider.credentialStatus(storage) || {};
            return {
                supportsOwnKey: Boolean(state.supportsOwnKey),
                hasOwnKey: Boolean(state.hasOwnKey),
            };
        } catch (_) {
            return { supportsOwnKey: true, hasOwnKey: false };
        }
    }

    /** Everything registered, with its readiness. What a Settings page would list. */
    function all() {
        return providers.map((p) => Object.assign({ provider: p }, statusOf(p)));
    }

    /**
     * Let every provider finish finding out what it can do (D13).
     *
     * `status()` has to be synchronous — the registry and the Settings list both call it in
     * render paths — but "does this deployment hold a key?" is a network question. So a
     * provider may expose `ready()`, and callers on an async path await this once before
     * asking. Providers without one are already sure of themselves and cost nothing.
     *
     * Never rejects: a provider that cannot decide is simply not ready, which `statusOf`
     * already reports.
     */
    function warm(deps = {}) {
        return Promise.all(
            providers.map((p) => {
                if (typeof p.ready !== 'function') {
                    return Promise.resolve(null);
                }
                try {
                    return Promise.resolve(p.ready(deps)).catch(() => null);
                } catch (_) {
                    return Promise.resolve(null);
                }
            })
        ).then(() => all());
    }

    /**
     * The first ready provider for a capability, or `null`.
     *
     * `Auto` means "pick the first ready provider". A named provider keeps the old fallback
     * behaviour unless that provider advertises personal-key support: in that case the named
     * choice means "use my key", so silently falling back to the site's key would contradict
     * the UI. `disabled` is an explicit off switch and must never fall through to Auto.
     */
    function forCapability(capability, opts = {}) {
        const wanted = opts.prefer || preferences(opts.storage)[groupOf(capability)] || 'auto';
        if (wanted === 'disabled') {
            return null;
        }

        const ready = providers.filter((p) => {
            const s = statusOf(p);
            return s.available && s.capabilities.includes(capability);
        });

        if (wanted && wanted !== 'auto') {
            const provider = providers.find((p) => p.ID === wanted);
            if (provider) {
                const credential = credentialStatusOf(provider, opts.storage);
                if (credential && credential.supportsOwnKey && !credential.hasOwnKey) {
                    return null;
                }
                const named = ready.find((p) => p.ID === wanted);
                if (named) {
                    return named;
                }
                // A named personal-key provider is strict: if its own credential is invalid or
                // the provider is otherwise not ready, do not spend the site's credential.
                if (credential && credential.supportsOwnKey) {
                    return null;
                }
            }
        }

        return ready[0] || null;
    }

    /**
     * Why nothing can serve a capability, as a reason code.
     *
     * `no-provider` and `no-key` are different sentences with different buttons, and the
     * picker needs to tell them apart.
     */
    function why(capability) {
        if (preferences()[groupOf(capability)] === 'disabled') {
            return 'disabled';
        }
        if (!providers.length) {
            return 'no-provider';
        }
        let reason = 'no-provider';
        for (const p of providers) {
            const s = statusOf(p);
            if (!s.capabilities.length || s.capabilities.includes(capability)) {
                reason = s.reason || reason;
                // A transport reason outranks `no-key`, because it is the more actionable of
                // the two and the one a key cannot fix: telling somebody to add a key when
                // the route is behind a login wall sends them to the only place the problem
                // is not.
                if (s.reason === 'protected' || s.reason === 'no-route' || s.reason === 'unreachable') {
                    return s.reason;
                }
                if (s.reason === 'no-key') {
                    reason = 'no-key';
                }
            }
        }
        return reason;
    }

    function reset() {
        providers.length = 0;
    }

    // The one provider there is. Registered here rather than by the host page so that
    // deleting `src/features/discovery/` removes the feature in one move.
    if (typeof window !== 'undefined' && window.NEXUS_DISCOVERY_YOUTUBE) {
        register(window.NEXUS_DISCOVERY_YOUTUBE);
    }

    return {
        register,
        all,
        warm,
        forCapability,
        why,
        reset,
        preferences,
        setPreference,
        groupOf,
        credentialStatusOf,
        SETTINGS_KEY,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY = ProviderRegistry;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProviderRegistry;
}
