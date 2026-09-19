/**
 * Two dimensions, so `Slow down` always has somewhere to go (P11).
 *
 * The reported bug is one screenshot: six taps on `↓ Slow down`, six identical HER turns saying
 * "We are already as gentle as this gets." Each tap called `ConsentFlow.exit('soft')`, which emits
 * `adult:exit` unconditionally — `from: 1, to: 1` when there is nothing to lower — and Private's
 * listener turned every event into another spoken line. A safety control that generates dialogue
 * is a safety control that can be made to repeat itself.
 *
 * The listener is the bug and it is fixed where it lives. This file is the reason the control has
 * something to *do* in the first place, which is the deeper half: Private thought in one dimension,
 *
 *     Warm → Romantic → Sensual
 *
 * so at Warm there was genuinely nothing left to lower and the only honest answer was a sentence
 * saying so. Add energy and there is:
 *
 *     PACE     Warm · Romantic · Sensual     (consent, owned by ConsentFlow)
 *     ENERGY   Quiet · Present · Playful     (texture, owned here)
 *
 *     Sensual + Present  ──slow down──▶  Warm + Quiet
 *     Warm    + Present  ──slow down──▶  Warm + Quiet
 *     Warm    + Quiet    ──slow down──▶  nothing, and it says nothing
 *
 * ## Pace and energy are not the same kind of thing
 *
 * Pace is consent and `ConsentFlow` owns it: earned, checked in, never raised by inference. Energy
 * is how talkative she is, and it grants nothing — which is why it can be lowered freely and why
 * this file may decide it. Nothing here raises either one; `softer` is the only transition, and a
 * way back up would have to be an explicit user choice routed through the gate.
 *
 * ## Deliberately dull
 *
 * A de-escalation control must be predictable. No randomness, no surprise, no personality: given a
 * state there is exactly one next state, and `changed: false` is a first-class answer meaning "do
 * not narrate anything". The personality belongs in how the experience behaves *afterwards*.
 *
 * Exposes: window.NEXUS_PRIVATE_PACE
 */
(function (global) {
    'use strict';

    /** How talkative she is. Ordered, quietest first — `softer` walks down this list. */
    const ENERGY = Object.freeze(['quiet', 'present', 'playful']);

    /** The default. Not `playful`: a session opens attentive, and earns its spark. */
    const DEFAULT_ENERGY = 'present';

    /** What a pace level is called on screen. Indexed from 1, because levels are. */
    const PACE_LABELS = Object.freeze(['', 'Warm', 'Romantic', 'Sensual']);

    function clampLevel(value, maxLevel) {
        const ceiling = Math.max(1, Math.min(3, Number(maxLevel) || 3));
        const level = Math.round(Number(value) || 1);
        return Math.max(1, Math.min(ceiling, level));
    }

    function normaliseEnergy(value) {
        const name = String(value == null ? '' : value).toLowerCase();
        return ENERGY.includes(name) ? name : DEFAULT_ENERGY;
    }

    /**
     * One step gentler, or nothing.
     *
     * Returns the whole next state plus `changed` and a `did` list of what moved, so the caller
     * does not re-derive it: the runtime needs to know whether to touch the consent flow, whether
     * to acknowledge at all, and whether the button should stop being a button.
     *
     * Lowering the pace takes the energy down with it. That is the point of the pairing — somebody
     * who asks to slow down from Sensual is not asking to stay as chatty as they were, and making
     * them press twice to be heard once is exactly the interaction this replaces.
     */
    function softer(state) {
        const maxLevel = state && state.maxLevel;
        const level = clampLevel(state && state.level, maxLevel);
        const energy = normaliseEnergy(state && state.energy);
        const did = [];

        let nextLevel = level;
        let nextEnergy = energy;
        if (level > 1) {
            nextLevel = 1;
            did.push('pace');
        }
        if (energy !== 'quiet') {
            nextEnergy = 'quiet';
            did.push('energy');
        }

        return {
            level: nextLevel,
            energy: nextEnergy,
            // True when the pace itself moved, so the caller knows to ask `ConsentFlow` rather
            // than assuming — the flow owns consent and this file only ever proposes.
            loweredPace: nextLevel < level,
            changed: did.length > 0,
            did,
            /** Nothing left to give. The control should stop inviting a tap. See `atFloor`. */
            atFloor: nextLevel <= 1 && nextEnergy === 'quiet',
        };
    }

    /** Is this state already as gentle as the experience goes? */
    function atFloor(state) {
        const level = clampLevel(state && state.level, state && state.maxLevel);
        return level <= 1 && normaliseEnergy(state && state.energy) === 'quiet';
    }

    /**
     * What the card should be saying about this state.
     *
     * Deliberately not the button's label. The words `✓ Gentle` and `↓ Slow down` live in the view,
     * because they are presentation and because two files owning one string is how they end up
     * disagreeing. This answers the two questions the view cannot: what the pace is called, and
     * whether there is anything left to lower.
     */
    function describe(state) {
        const level = clampLevel(state && state.level, state && state.maxLevel);
        const energy = normaliseEnergy(state && state.energy);
        return {
            pace: PACE_LABELS[level] || 'Warm',
            energy,
            /**
             * At the floor. The view turns this into `✓ Gentle` and a disabled control — the label
             * says *accepted*, not unavailable, because the request was heard.
             */
            gentle: level <= 1 && energy === 'quiet',
        };
    }

    const api = { ENERGY, DEFAULT_ENERGY, PACE_LABELS, softer, atFloor, describe, normaliseEnergy };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PACE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
