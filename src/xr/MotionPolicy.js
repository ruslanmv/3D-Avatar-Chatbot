/**
 * MotionPolicy — the capability gate for the Living-NPC motion stack.
 *
 * Two controls, two tiers:
 *
 *   Living NPC (master)   off | on            — the whole stack
 *   Movement              off | vr | all      — root translation only
 *
 * TIER A (always included when the master is on) is everything that never
 * changes the avatar's root position: gestures, rotation, gaze, expressions,
 * in-place sit/stand, offer_hand and contact IK. Safe on desktop, mobile and
 * VR alike — turning in place cannot collide with anything or invade personal
 * space.
 *
 * TIER B is exactly three command types: approach, retreat, follow. These move
 * her through the world, which is the part that still depends on the
 * locomotion revision, so it gets its own control and defaults to off.
 *
 * `stop` and `stop_follow` are NEVER gated. A stop must be honoured whatever
 * the policy says — gating one would leave a user unable to halt a behaviour
 * they just started.
 *
 * Pure module: no DOM, no globals, no THREE. Every environmental fact (are we
 * in VR? what did the user choose?) is injected, so the whole thing is
 * unit-testable under Jest like IntentFastPath and MotionContract.
 *
 * B1 NOTE: nothing imports this yet — that is deliberate. The logic lands and
 * is proven in isolation before any live seam depends on it. B2 wires the
 * three enforcement points; B3 adds the Settings UI that feeds it real values.
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionPolicy
 */

const MotionPolicy = (() => {
    'use strict';

    /** The only command types that translate the avatar's root position. */
    const MOVEMENT_TYPES = ['approach', 'retreat', 'follow'];

    /** Types that must survive every filter, at every setting. */
    const ALWAYS_ALLOWED = ['stop', 'stop_follow'];

    /** localStorage keys owned by this module (B3 writes them). */
    const KEY_ENABLED = 'npc_enabled';
    const KEY_MOVEMENT = 'npc_movement';

    const MOVEMENT_MODES = ['off', 'vr', 'all'];

    /**
     * Defaults used when no stored preference exists.
     *
     * B3 flipped `enabled` from true to false: the whole stack is now opt-in
     * from Settings → EXPERIMENTAL. This is a deliberate behaviour change —
     * before it, the motion stack ran for everyone — and it is the single
     * revert point for the opt-in model.
     *
     * `movement` stays 'off' even once the master is on, because root
     * translation is the part still waiting on the locomotion revision. VR
     * users can move it to 'vr'.
     */
    const DEFAULTS = {
        enabled: false,
        movement: 'off',
    };

    /**
     * Overrides for tests and for callers that manage their own storage.
     * @private
     */
    let _override = null;

    /**
     * Read a key from localStorage, tolerating environments without it
     * (Node, private mode, storage disabled by policy).
     * @private
     */
    function _read(key) {
        try {
            if (typeof localStorage === 'undefined') return null;
            return localStorage.getItem(key);
        } catch (_e) {
            return null;
        }
    }

    /**
     * Inject settings directly instead of reading storage. Pass null to go
     * back to storage-backed reads.
     *
     * @param {{enabled?: boolean, movement?: string}|null} settings
     */
    function _setOverride(settings) {
        _override = settings || null;
    }

    /** Is the whole motion stack switched on? */
    function isEnabled() {
        if (_override && typeof _override.enabled === 'boolean') return _override.enabled;
        const raw = _read(KEY_ENABLED);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        return DEFAULTS.enabled;
    }

    /**
     * Current movement tier.
     * @returns {'off'|'vr'|'all'}
     */
    function movementMode() {
        if (_override && _override.movement) {
            return MOVEMENT_MODES.indexOf(_override.movement) !== -1 ? _override.movement : DEFAULTS.movement;
        }
        const raw = _read(KEY_MOVEMENT);
        return MOVEMENT_MODES.indexOf(raw) !== -1 ? raw : DEFAULTS.movement;
    }

    /** Is this one of the three root-translating types? */
    function isMovement(type) {
        return MOVEMENT_TYPES.indexOf(String(type || '').toLowerCase()) !== -1;
    }

    /**
     * May this command type run right now?
     *
     * @param {string} type - MotionDSL command type
     * @param {{inVR?: boolean}} [ctx] - environment; inVR is injected by the
     *   caller (MotionIntegration reads renderer.xr.isPresenting) so this
     *   module never touches a global.
     * @returns {boolean}
     */
    function allows(type, ctx) {
        const t = String(type || '').toLowerCase();

        // A stop is always honoured — even with the master off, so that a plan
        // already in flight when the user disables the feature can be halted.
        if (ALWAYS_ALLOWED.indexOf(t) !== -1) return true;

        if (!isEnabled()) return false;
        if (!isMovement(t)) return true; // Tier A

        const mode = movementMode();
        if (mode === 'all') return true;
        if (mode === 'vr') return !!(ctx && ctx.inVR);
        return false; // 'off'
    }

    /**
     * Filter a MotionPlan down to what policy currently permits.
     *
     * Never returns an empty plan: when every command was movement, a
     * substitute (look at the user + a fitting expression) takes its place, so
     * she acknowledges the request instead of freezing. The stripped types are
     * reported so the caller can record `last_action` for the next world
     * snapshot and the model can answer honestly.
     *
     * @param {{commands: Object[]}} plan
     * @param {{inVR?: boolean}} [ctx]
     * @returns {{plan: Object|null, stripped: string[], substituted: boolean}}
     */
    function filterPlan(plan, ctx) {
        if (!plan || !Array.isArray(plan.commands)) {
            return { plan: null, stripped: [], substituted: false };
        }

        // Master off: the stack does nothing at all, except honour a stop.
        if (!isEnabled()) {
            const stops = plan.commands.filter((c) => c && ALWAYS_ALLOWED.indexOf(String(c.type).toLowerCase()) !== -1);
            return {
                plan: stops.length ? Object.assign({}, plan, { commands: stops }) : null,
                stripped: plan.commands.filter((c) => c && !stops.includes(c)).map((c) => String(c.type)),
                substituted: false,
            };
        }

        const kept = [];
        const stripped = [];
        for (let i = 0; i < plan.commands.length; i++) {
            const cmd = plan.commands[i];
            if (!cmd || !cmd.type) continue;
            if (allows(cmd.type, ctx)) kept.push(cmd);
            else stripped.push(String(cmd.type));
        }

        let substituted = false;
        if (!kept.length && stripped.length) {
            // Everything was gated. Acknowledge rather than go still: she looks
            // at you and her face does the apologising, while the verbal reply
            // (driven by last_action in the next snapshot) explains why.
            kept.push({ type: 'look_at', target: 'user_head' });
            kept.push({ type: 'expression', name: 'sad', weight: 0.4 });
            substituted = true;
        }

        return {
            plan: Object.assign({}, plan, { commands: kept }),
            stripped: stripped,
            substituted: substituted,
        };
    }

    /**
     * The command types the model should be TOLD about, given the current
     * policy. Feeding this into MotionContract means a disabled command never
     * enters the model's vocabulary — it cannot misuse a tool it was never
     * handed, which is a far stronger guarantee than asking it not to.
     *
     * @param {string[]} allTypes - the parser's full whitelist
     * @param {{inVR?: boolean}} [ctx]
     * @returns {string[]}
     */
    function allowedTypes(allTypes, ctx) {
        const list = Array.isArray(allTypes) ? allTypes : [];
        if (!isEnabled()) return [];
        return list.filter((t) => allows(t, ctx));
    }

    return {
        isEnabled,
        movementMode,
        allows,
        isMovement,
        filterPlan,
        allowedTypes,
        _setOverride,
        MOVEMENT_TYPES,
        ALWAYS_ALLOWED,
        MOVEMENT_MODES,
        KEY_ENABLED,
        KEY_MOVEMENT,
        DEFAULTS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_POLICY = MotionPolicy;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionPolicy;
