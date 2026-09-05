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

    /** Everything registered, with its readiness. What a Settings page would list. */
    function all() {
        return providers.map((p) => Object.assign({ provider: p }, statusOf(p)));
    }

    /**
     * The first ready provider for a capability, or `null`.
     *
     * Ready, not merely registered: showing a dead provider as if it worked is the failure
     * this returns `null` to avoid. The caller then asks `why` for a sentence.
     */
    function forCapability(capability, opts = {}) {
        const ready = providers.filter((p) => {
            const s = statusOf(p);
            return s.available && s.capabilities.includes(capability);
        });
        if (!ready.length) {
            return null;
        }
        // A named choice wins — but only while it is ready. Honouring a preference for a
        // provider that has since lost its key would turn "I picked that one" into "search
        // is broken", which is the failure `available` exists to prevent.
        const wanted = opts.prefer || preferences(opts.storage)[groupOf(capability)] || 'auto';
        if (wanted && wanted !== 'auto') {
            const named = ready.find((p) => p.ID === wanted);
            if (named) {
                return named;
            }
        }
        return ready[0];
    }

    /**
     * Why nothing can serve a capability, as a reason code.
     *
     * `no-provider` and `no-key` are different sentences with different buttons, and the
     * picker needs to tell them apart.
     */
    function why(capability) {
        if (!providers.length) {
            return 'no-provider';
        }
        let reason = 'no-provider';
        for (const p of providers) {
            const s = statusOf(p);
            if (!s.capabilities.length || s.capabilities.includes(capability)) {
                reason = s.reason || reason;
                if (s.reason === 'no-key') {
                    return 'no-key';
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

    return { register, all, forCapability, why, reset, preferences, setPreference, groupOf, SETTINGS_KEY };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY = ProviderRegistry;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProviderRegistry;
}
