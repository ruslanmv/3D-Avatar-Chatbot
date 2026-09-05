/**
 * TransitionRules — how long a crossfade takes, and when one is allowed (spec v1.1 §4A).
 *
 * The fade matrix is a UX table, not a technical one. A reaction has to land *now*, so it
 * fades in fast; a return to idle should feel like settling rather than snapping, so it
 * fades slowly. Getting these wrong is what makes an avatar look either twitchy or sedated.
 *
 * `minPlayMs` is the other half: a clip that can be interrupted on its first frame produces
 * a stutter of half-started animations whenever two intents arrive together.
 *
 * Exposes: window.NEXUS_BD_TRANSITIONS
 */
const TransitionRules = (() => {
    'use strict';

    /** Layer categories, by the priority band a clip's record falls into. */
    const CATEGORY = { idle: 'idle', posture: 'posture', emote: 'emote', reaction: 'reaction' };

    /** from → to → fade seconds. Missing pairs fall back to DEFAULT_FADE. */
    const FADE = {
        idle: { idle: 0.6, posture: 0.5, emote: 0.25, reaction: 0.12 },
        posture: { idle: 0.6, posture: 0.5, emote: 0.3, reaction: 0.15 },
        emote: { idle: 0.5, posture: 0.4, emote: 0.3, reaction: 0.15 },
        reaction: { idle: 0.45, posture: 0.4, emote: 0.3, reaction: 0.2 },
    };

    const DEFAULT_FADE = 0.3;

    /** Below this a clip has not read as a gesture yet, so interrupting it is a stutter. */
    const MIN_PLAY_MS = { idle: 0, posture: 400, emote: 350, reaction: 250 };

    /** A clip's KB priority maps onto a transition category. */
    function categoryOf(clip) {
        const priority = clip && Number.isFinite(clip.priority) ? clip.priority : 3;
        if (priority <= 1) return CATEGORY.idle;
        if (priority === 2) return CATEGORY.posture;
        if (priority >= 4) return CATEGORY.reaction;
        return CATEGORY.emote;
    }

    /** Crossfade duration in seconds for a transition between two clips. */
    function fadeSeconds(fromClip, toClip) {
        const from = fromClip ? categoryOf(fromClip) : CATEGORY.idle;
        const to = categoryOf(toClip);
        const row = FADE[from];
        return (row && row[to]) || DEFAULT_FADE;
    }

    function minPlayMs(clip) {
        return MIN_PLAY_MS[categoryOf(clip)] ?? 0;
    }

    /**
     * May `incoming` take over from `current`, which has been playing for `playedMs`?
     * @returns {{allowed: boolean, why: string}}
     */
    function canInterrupt(current, incoming, playedMs) {
        if (!current) return { allowed: true, why: 'nothing playing' };
        if (current.interruptible === false && incoming.priority <= current.priority) {
            return { allowed: false, why: 'current clip is not interruptible' };
        }
        if (incoming.priority < current.priority) {
            return { allowed: false, why: 'lower priority' };
        }
        if (incoming.priority === current.priority && playedMs < minPlayMs(current)) {
            return { allowed: false, why: 'minimum play time not reached' };
        }
        return { allowed: true, why: 'ok' };
    }

    return { FADE, DEFAULT_FADE, MIN_PLAY_MS, CATEGORY, categoryOf, fadeSeconds, minPlayMs, canInterrupt };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TRANSITIONS = TransitionRules;
if (typeof module !== 'undefined' && module.exports) module.exports = TransitionRules;
