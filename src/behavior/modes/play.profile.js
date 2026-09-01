/**
 * play.profile — the v1.0 reaction tiers, written down (spec v1.1 §6.7, batch B23).
 *
 * B7 shipped this as optional and it was never written, so the reaction tiers the plan keeps
 * referring to did not exist anywhere in the repository. B23 needs them, so this is where
 * they finally become data rather than a paragraph in a use case.
 *
 * ## Three tiers, and the middle one is the interesting one
 *
 * | tier | body | example | fires while she is watching closely? |
 * |---|---|---|---|
 * | `micro` | head and face | a nod on a hit | yes — that is the point of it |
 * | `medium` | upper body | a gasp-lean on a near-death | no, above `HIGH_ATTENTION` |
 * | `macro` | whole body | a dance on the win, consoling on the loss | only for a **macro event** |
 *
 * A micro reaction is company: it costs nothing, it never occludes anything, and a companion
 * who does not flicker while you play is a statue. A macro reaction is a performance, and a
 * performance in the middle of a boss fight is somebody standing up in front of the
 * television. So the tier is not just an intensity — it decides whether the reaction is
 * allowed at all given where the player's attention is.
 *
 * ## Why a macro *event* is not the same as a macro *tier*
 *
 * The distinction the acceptance criterion turns on. `ExcitementDetector` infers moments
 * from audio and pixels; it cannot tell a win from a total defeat, because both are loud and
 * bright. So its top tier is `surge` — "something big just happened" — and `surge` is macro
 * for pacing but is **not** a macro event, so it may not interrupt a player who is locked in.
 *
 * `win` and `loss` are macro events, and they only ever come from a real game hook calling
 * `mark()`. Nothing in the heuristic path can produce one. That is what makes "except macro
 * events" a meaningful exception rather than a hole: while all she has is a flash detector,
 * she never does a full-body anything while you are concentrating.
 *
 * Exposes: window.NEXUS_BD_PROFILE_PLAY
 */
const PlayProfile = (() => {
    'use strict';

    /** Attention at or above this means the game has them. §6.12's number, reused. */
    const HIGH_ATTENTION = 0.8;

    /**
     * The tiers. `intent` is a *name* from the §6.8 whitelist — the KB picks the clip, so
     * this file names no animation and a new dance is a manifest row, not an edit here.
     */
    const TIERS = {
        micro: {
            body: 'head',
            intensity: 0.3,
            /** Always allowed. A nod does not occlude a screen. */
            interruptsAttention: true,
        },
        medium: {
            body: 'upper',
            intensity: 0.6,
            interruptsAttention: false,
        },
        macro: {
            body: 'full',
            intensity: 0.9,
            /** Only for a macro *event* — see the header. */
            interruptsAttention: false,
        },
    };

    /**
     * What each moment is. The heuristic can produce the first three; only a real game hook
     * produces `win` and `loss`.
     */
    const REACTIONS = {
        hit: { tier: 'micro', intent: 'nod_along' },
        near_death: { tier: 'medium', intent: 'surprised' },
        surge: { tier: 'macro', intent: 'celebrate' },
        win: { tier: 'macro', intent: 'celebrate', macroEvent: true },
        loss: { tier: 'macro', intent: 'console', macroEvent: true },
    };

    /** The moments that may interrupt a player who is locked in. Exactly two. */
    const MACRO_EVENTS = Object.keys(REACTIONS).filter((kind) => REACTIONS[kind].macroEvent);

    /**
     * May this moment produce its reaction, given where their attention is?
     *
     * The single place the rule lives, so the co-host, the detector and a future real game
     * hook cannot each have their own opinion about it.
     *
     * @returns {{allowed: boolean, why: string}} — `why` names the rule either way, because
     * a log line that explains a stillness beats one that leaves it looking like a bug.
     */
    function mayReact(kind, attention = 0) {
        const reaction = REACTIONS[kind];
        if (!reaction) return { allowed: false, why: `unknown moment ${kind}` };
        const tier = TIERS[reaction.tier];
        if (attention < HIGH_ATTENTION) return { allowed: true, why: 'attention is elsewhere' };
        if (tier.interruptsAttention) return { allowed: true, why: `${reaction.tier} does not interrupt` };
        if (reaction.macroEvent) return { allowed: true, why: 'macro event' };
        return { allowed: false, why: `${reaction.tier} reaction while attention is ${attention}` };
    }

    return {
        id: 'play',
        label: 'Play together',
        adapters: ['gaze', 'media', 'session'],
        attention: { primary: 'activityTarget', glanceUserEveryMs: [12000, 30000] },
        /**
         * She may speak on a moment, and on the ordinary Together openings. `game:moment`
         * carries its own kind; the gate matches on the event name, and whether the *line*
         * is worth saying is the ranker's problem, not this list's.
         */
        commentaryOpenings: ['game:moment', 'media:paused', 'user:silent>15000'],
        /** More than Together mode, less than a conversation: a co-host talks. */
        initiative: { budgetPerSession: 6, minGapMs: 45000 },
        allowNsfw: 'inherit',
        idleProfile: 'relaxed-attentive',

        HIGH_ATTENTION,
        TIERS,
        REACTIONS,
        MACRO_EVENTS,
        mayReact,

        /**
         * While the game has them, a clip that walks her across the room is somebody
         * standing up in front of the television. The same rule Together mode uses, and for
         * the same reason — but read from the blackboard, so it relaxes when they look away.
         */
        allows(clip, blackboard) {
            const attention = (blackboard && blackboard.attention) || 0;
            if (attention < HIGH_ATTENTION) return true;
            const rootMotion = (clip && clip.stats && clip.stats.rootMotion) || 0;
            return rootMotion < 0.5;
        },
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROFILE_PLAY = PlayProfile;
if (typeof module !== 'undefined' && module.exports) module.exports = PlayProfile;
