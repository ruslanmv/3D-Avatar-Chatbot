/**
 * W10. Private mode in Try-On: what it unlocks, and for whom.
 *
 * Two different questions are asked before a private outfit — lingerie, swimwear,
 * see-through fabric, stockings — is made, and each has one authority:
 *
 * - **Is the person an adult?** This app's answer is private mode: the device-local adult
 *   confirmation behind `NEXUS_SPICY.isEnabled()` (see docs/INTIMATE_MODE.md, which forbids a
 *   second client-side age check). Private mode off, and Try-On offers nothing private.
 * - **Does the avatar depict an adult?** Wardrobe Forge's answer, per avatar: its operator
 *   declares it (`assets/library/policy.json`), and `GET /v1/library` reports it as
 *   `depictsAdult`. Forge checks this on every job, whatever a browser says, and nothing
 *   here can — or tries to — claim it.
 *
 * Private mode answers the first question only. A person's age says who is looking, not
 * who is on screen, and anime avatars often read young; so private mode unlocks private
 * outfits for the avatars Forge's operator has declared adult, and for any other avatar
 * Try-On says why instead of offering buttons that would be refused.
 *
 * `evaluate()` is pure — it takes the answers and returns `off`, `locked` (with a reason)
 * or `open` (with the quick picks) — so every case is testable without a browser.
 *
 * Exposes: window.NEXUS_TRY_ON_PRIVATE
 */
(function (global) {
    'use strict';

    /** Quick picks shown when private outfits are open. Prompts Forge's planner understands. */
    var PICKS = Object.freeze([
        { label: 'Lace lingerie', prompt: 'black lace lingerie set' },
        { label: 'Bikini', prompt: 'red triangle bikini' },
        { label: 'Stockings', prompt: 'black pencil skirt + sheer black stockings with a suspender belt' },
        { label: 'Satin nightdress', prompt: 'champagne satin slip nightdress' },
        { label: 'Sheer blouse', prompt: 'sheer white blouse + black mini skirt' },
    ]);

    /**
     * Whether private mode is on and usable on this device. Never throws.
     *
     * `isEnabled()` is the gate's public answer — the same call main.js, the prompt builders
     * and Together's playground make. SpicyGate has a private `usable()` inside its closure,
     * but it is not on `NEXUS_SPICY`; reading it here would answer false forever, and a test
     * against the real gate (not a fake) is what keeps this line honest.
     */
    function privateOn(g) {
        var root = g || global;
        try {
            var gate = root && root.NEXUS_SPICY;
            return Boolean(gate && typeof gate.isEnabled === 'function' && gate.isEnabled());
        } catch (_) {
            return false;
        }
    }

    /**
     * What private mode unlocks for this avatar.
     *
     *   privateOn   private mode is on (the person confirmed they are an adult)
     *   identity    AvatarIdentity.resolve(...) of her original avatar
     *   published   the `avatars` of Forge's `GET /v1/library`, or null when unreachable
     *   canCreate   whether Forge can make looks at all (TryOnGenerator.availability().ok)
     *
     * Answers {mode: 'off'} | {mode: 'locked', why} | {mode: 'open', picks}.
     */
    function evaluate(options) {
        options = options || {};
        if (!options.privateOn) return { mode: 'off' };
        if (!options.canCreate) {
            return { mode: 'locked', why: 'Private outfits are made by Wardrobe Forge, which is not connected.' };
        }
        var identity = options.identity;
        var name = (identity && identity.name) || 'this avatar';
        if (!identity || identity.kind !== 'library') {
            return {
                mode: 'locked',
                why:
                    'Private outfits are available for built-in avatars that Wardrobe Forge’s operator ' +
                    'has declared adult. ' +
                    name +
                    ' is not one of them.',
            };
        }
        if (!Array.isArray(options.published)) {
            return {
                mode: 'locked',
                why: 'Wardrobe Forge can’t be reached, so private outfits aren’t available right now.',
            };
        }
        var entry = options.published.find(function (item) {
            return item && item.slug === identity.slug;
        });
        if (entry && entry.depictsAdult === true) return { mode: 'open', picks: PICKS.slice() };
        // The avatar picker names her by file ("AvatarSample_A.vrm"); Forge's library has the
        // name a person recognises, so the sentence uses that when Forge knows her.
        return {
            mode: 'locked',
            why:
                'Private outfits are off for ' +
                ((entry && entry.name) || name) +
                ': Wardrobe Forge’s operator has not declared this avatar adult.',
        };
    }

    var api = { PICKS: PICKS, privateOn: privateOn, evaluate: evaluate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_PRIVATE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
