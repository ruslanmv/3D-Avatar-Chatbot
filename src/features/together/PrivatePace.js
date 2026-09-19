/**
 * Where the evening is, and one step in either direction (P12).
 *
 * ## What this replaced, and why
 *
 * P11 made the prominent footer control a de-escalation control, and that had the main interaction
 * backwards. Private's emotional action is progression: the person drives it forward, explicitly,
 * a step at a time.
 *
 * ```text
 *                Closer →            More →
 *        Warm ─────────────▶ Romantic ─────────────▶ Sensual
 *             ◀───────────── ◀─────────────
 *                ← Ease up          ← Ease up
 * ```
 *
 * The forward control is primary; easing is secondary and stays available; neither ends the
 * session. The preset is the **ceiling**, not the starting level, so choosing Sensual grants
 * permission to reach Sensual rather than beginning there.
 *
 * `softer()` is gone with P11's model. It dropped Sensual straight to Warm in one tap, which is the
 * right behaviour for a safe *word* — `ConsentFlow.exit('soft')` still does exactly that — and the
 * wrong behaviour for a control somebody is steering with. One step per press, in both directions,
 * is what gives a person precise control instead of a cliff.
 *
 * ## Two dimensions still, and which one is which
 *
 * `PACE` — Warm · Romantic · Sensual — is consent, and `ConsentFlow` owns it. Nothing here moves
 * it; `stepUp` and `stepDown` compute what the next state *would* be and the caller takes it to the
 * gate. `ENERGY` — quiet · present · playful — is texture. It grants nothing, so it may move
 * freely, and it rides along: asking to come closer is not asking to stay quiet, and easing off at
 * the gentlest pace still has somewhere to go.
 *
 * ## Deliberately dull
 *
 * Given a state there is exactly one next state in each direction. No randomness, no personality,
 * and `changed: false` is a first-class answer meaning "do not narrate anything" — which is what
 * stops a control that cannot act from producing a line saying so, six times.
 *
 * Exposes: window.NEXUS_PRIVATE_PACE
 */
(function (global) {
    'use strict';

    /** How talkative she is. Ordered, quietest first. */
    const ENERGY = Object.freeze(['quiet', 'present', 'playful']);

    /** The default. Not `playful`: a session opens attentive, and earns its spark. */
    const DEFAULT_ENERGY = 'present';

    /** What a pace level is called on screen. Indexed from 1, because levels are. */
    const PACE_LABELS = Object.freeze(['', 'Warm', 'Romantic', 'Sensual']);

    /**
     * What the forward control says at each level.
     *
     * `Closer` for the first step and `More` for the second, because the same word twice reads as a
     * control that did not work the first time.
     */
    const FORWARD_LABELS = Object.freeze(['', 'Closer', 'More', '']);

    function ceilingOf(maxLevel) {
        return Math.max(1, Math.min(3, Math.round(Number(maxLevel) || 3)));
    }

    function clampLevel(value, maxLevel) {
        const ceiling = ceilingOf(maxLevel);
        const level = Math.round(Number(value) || 1);
        return Math.max(1, Math.min(ceiling, level));
    }

    function normaliseEnergy(value) {
        const name = String(value == null ? '' : value).toLowerCase();
        return ENERGY.includes(name) ? name : DEFAULT_ENERGY;
    }

    function read(state) {
        const maxLevel = ceilingOf(state && state.maxLevel);
        return {
            level: clampLevel(state && state.level, maxLevel),
            energy: normaliseEnergy(state && state.energy),
            maxLevel,
        };
    }

    /**
     * One step closer, or nothing.
     *
     * Computes the state; it does not grant it. The pace is consent and `ConsentFlow` decides
     * whether an explicit request may be honoured — this only says what the request *is*, so the
     * runtime never has to do arithmetic on a consent level.
     *
     * The energy rides up with it. A person pressing `Closer →` after asking for quiet has made a
     * clear request in the other direction, and that is the only thing allowed to leave the quiet
     * state: not a timer, not a warm turn, not the model's reading of the mood.
     */
    function stepUp(state) {
        const { level, energy, maxLevel } = read(state);
        if (level >= maxLevel) {
            // At the ceiling the forward control is gone, so this should never be reached from the
            // UI. It is still the honest answer, and it is what makes the function safe to call.
            return { level, energy, changed: false, did: [], raisedPace: false, atCeiling: true, atFloor: false };
        }
        const nextLevel = level + 1;
        const nextEnergy = ENERGY[Math.min(ENERGY.length - 1, ENERGY.indexOf(energy) + 1)];
        const did = ['pace'];
        if (nextEnergy !== energy) did.push('energy');
        return {
            level: nextLevel,
            energy: nextEnergy,
            changed: true,
            did,
            raisedPace: true,
            atCeiling: nextLevel >= maxLevel,
            atFloor: false,
        };
    }

    /**
     * One step gentler, or nothing.
     *
     * The pace first, one level at a time. At the gentlest pace there is still the energy, which is
     * why easing off at Warm is not a dead control — and once both are at the bottom, `changed` is
     * false and the caller says nothing at all.
     */
    function stepDown(state) {
        const { level, energy, maxLevel } = read(state);
        if (level > 1) {
            return {
                level: level - 1,
                energy,
                changed: true,
                did: ['pace'],
                loweredPace: true,
                atCeiling: false,
                atFloor: level - 1 <= 1 && energy === 'quiet',
            };
        }
        if (energy !== 'quiet') {
            const nextEnergy = ENERGY[Math.max(0, ENERGY.indexOf(energy) - 1)];
            return {
                level,
                energy: nextEnergy,
                changed: true,
                did: ['energy'],
                loweredPace: false,
                atCeiling: maxLevel <= 1,
                atFloor: nextEnergy === 'quiet',
            };
        }
        return { level, energy, changed: false, did: [], loweredPace: false, atCeiling: maxLevel <= 1, atFloor: true };
    }

    function atCeiling(state) {
        const { level, maxLevel } = read(state);
        return level >= maxLevel;
    }

    function atFloor(state) {
        const { level, energy } = read(state);
        return level <= 1 && energy === 'quiet';
    }

    /**
     * What the card should be saying about this state.
     *
     * Not the button text, which lives in the view — two files owning one string is how they end up
     * disagreeing. This answers what the view cannot work out for itself: what this level is called,
     * how far along the ladder it is, and which of the two controls have anything to do.
     *
     * `steps` is the progress indicator, and it is the fix for the most confusing thing in the
     * reported screenshot: the header said `Sensual` while the footer said `Warm`. Both were true —
     * ceiling and current — and nobody could be expected to know that. A ladder shows the ceiling
     * *and* the position in one glance, and needs no explaining.
     */
    function describe(state) {
        const { level, energy, maxLevel } = read(state);
        const steps = [];
        for (let i = 1; i <= maxLevel; i += 1) {
            steps.push({ level: i, label: PACE_LABELS[i], reached: i <= level, current: i === level });
        }
        return {
            pace: PACE_LABELS[level] || 'Warm',
            energy,
            level,
            maxLevel,
            steps,
            /** A preset with one level has no ladder to show; `Warm` alone is not progress. */
            hasLadder: maxLevel > 1,
            atCeiling: level >= maxLevel,
            atFloor: level <= 1 && energy === 'quiet',
            /** What the forward control is called here, or '' when there is no forward left. */
            forward: level >= maxLevel ? '' : FORWARD_LABELS[level] || 'Closer',
            /** Easing is offered while there is a pace step to give back. See the footer. */
            canEase: level > 1,
        };
    }

    const api = {
        ENERGY,
        DEFAULT_ENERGY,
        PACE_LABELS,
        FORWARD_LABELS,
        stepUp,
        stepDown,
        atCeiling,
        atFloor,
        describe,
        normaliseEnergy,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PACE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
