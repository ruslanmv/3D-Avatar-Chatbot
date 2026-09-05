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

    /** Registration order is preference order, until D6 gives the user a say. */
    const providers = [];

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

    /** Everything registered, with its readiness. What a Settings page would list. */
    function all() {
        return providers.map((p) => Object.assign({ provider: p }, p.status()));
    }

    /**
     * The first ready provider for a capability, or `null`.
     *
     * Ready, not merely registered: showing a dead provider as if it worked is the failure
     * this returns `null` to avoid. The caller then asks `why` for a sentence.
     */
    function forCapability(capability) {
        for (const p of providers) {
            const s = p.status();
            if (s.available && s.capabilities.includes(capability)) {
                return p;
            }
        }
        return null;
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
            const s = p.status();
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

    return { register, all, forCapability, why, reset };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY = ProviderRegistry;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProviderRegistry;
}
