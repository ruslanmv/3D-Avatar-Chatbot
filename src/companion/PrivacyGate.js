/**
 * PrivacyGate — which destination may read which memory (IC1).
 *
 * The rule is small on purpose:
 *
 *   - A destination may read its own scope, and GENERAL.
 *   - LIFE may read EXPERIENCES (shared moments are part of the relationship)
 *     and, only while the adult gate is open, PRIVATE.
 *   - COPILOT may read COPILOT and GENERAL. It may not read LIFE, EXPERIENCES,
 *     or PRIVATE, even if the person was just in one of those.
 *   - An explicit grant (`memory:life` on the session) is the only cross-read
 *     that is not in the table. Grants are user actions, stored on the session,
 *     and revocable.
 *   - Adult capabilities stay off unless the existing spicy/age switch is on,
 *     and they are refused entirely while the destination is Copilot. Switching
 *     to Copilot is itself a revocation of the adult capability for that
 *     context — the switch on disk is not cleared, the activity is.
 *
 * This module does not know how spicy mode is stored. It asks the function it
 * was given, which production wires to `NEXUS_SPICY.isEnabled`. Absent means
 * closed.
 *
 * Exposes: window.NEXUS_COMPANION_PRIVACY
 */
const PrivacyGate = (() => {
    'use strict';

    const OWN = Object.freeze({
        life: ['general', 'life', 'experiences'],
        copilot: ['general', 'copilot'],
        experiences: ['general', 'experiences'],
    });

    function create(options) {
        const spicy = (options && options.spicyEnabled) || (() => false);

        function allows(destination, scope, grants) {
            if (destination !== 'life' && destination !== 'copilot' && destination !== 'experiences') {
                return { ok: false, why: 'unknown-destination' };
            }
            if (['general', 'life', 'copilot', 'experiences', 'private'].indexOf(scope) === -1) {
                return { ok: false, why: 'unknown-scope' };
            }
            if (scope === 'private') {
                if (destination === 'copilot') return { ok: false, why: 'copilot-isolated' };
                if (destination !== 'life') return { ok: false, why: 'private-is-life' };
                if (!spicy()) return { ok: false, why: 'adult-off' };
                return { ok: true, why: 'private-open' };
            }
            const own = OWN[destination];
            if (own.indexOf(scope) !== -1) return { ok: true, why: 'own-scope' };
            const token = 'memory:' + scope;
            if (Array.isArray(grants) && grants.indexOf(token) !== -1) return { ok: true, why: 'grant' };
            return { ok: false, why: 'cross-scope' };
        }

        /**
         * Whether an adult-only capability may run in this destination.
         * Copilot refuses even when the age switch is on. That is the boundary
         * between a professional session and an intimate one: the switch is not
         * a global mood.
         */
        function allowsAdult(destination) {
            if (destination === 'copilot') return { ok: false, why: 'copilot-isolated' };
            if (!spicy()) return { ok: false, why: 'adult-off' };
            if (destination !== 'life' && destination !== 'experiences') {
                return { ok: false, why: 'unknown-destination' };
            }
            return { ok: true, why: 'adult-open' };
        }

        function capabilityAllowed(name, destination, granted) {
            if (!name) return { ok: true, why: 'none' };
            if (name === 'adult') return allowsAdult(destination);
            // Voice and XR are properties of the device session, not consent toggles.
            if (name === 'voice' || name === 'xr' || name === 'spatial-audio') return { ok: true, why: 'runtime' };
            if (name === 'camera' || name === 'screen' || name === 'microphone') {
                return Array.isArray(granted) && granted.indexOf(name) !== -1
                    ? { ok: true, why: 'granted' }
                    : { ok: false, why: 'not-granted' };
            }
            return { ok: true, why: 'runtime' };
        }

        return {
            allows: allows,
            allowsAdult: allowsAdult,
            capabilityAllowed: capabilityAllowed,
        };
    }

    return { create: create, OWN: OWN };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_PRIVACY = PrivacyGate;
if (typeof module !== 'undefined' && module.exports) module.exports = PrivacyGate;
