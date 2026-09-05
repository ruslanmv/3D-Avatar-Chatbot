/**
 * Why it did not start, and what to do about it (batch B36).
 *
 * `startActivity()` already returned `{ok:false, why:'...'}` with a specific reason —
 * "camera consent was declined", "no play profile — refusing to start", "that exercise is
 * not supported" — and the panel dropped every one of them on the floor and went back to the
 * chooser. A user saw a tile they tapped, a permission dialog they answered, and then the
 * menu again, with no statement of what happened.
 *
 * The activities spend real effort producing specific reasons. This turns each into a
 * sentence somebody can act on, plus the actions that can act on it. It is a pure function
 * from a reason string to copy, so the panel holds no opinions about failure and the copy is
 * assertable without a DOM.
 *
 * The one rule: **never convert a specific reason into "Something went wrong."** A generic
 * message is what the code already avoided producing; adding one at the last step would
 * throw away the whole chain.
 *
 * Exposes: window.NEXUS_BD_TOGETHER_FAILURES
 */
const TogetherFailures = (() => {
    'use strict';

    /** Actions a failure screen can offer. The panel maps these to buttons it owns. */
    const RETRY = { id: 'retry', label: 'Try again' };
    const BACK = { id: 'back', label: 'Back' };
    const SETTINGS = { id: 'settings', label: 'Open settings' };

    /**
     * Patterns, most specific first.
     *
     * Matching on the reason rather than on an error code because the reasons are prose
     * written by eight different batches, and a code would mean editing all eight.
     */
    const RULES = [
        {
            match: /declined|NotAllowedError|denied|blocked/i,
            title: (name) => `${name} needs permission`,
            body: 'Access was blocked. Allow it in your browser’s site settings, then try again.',
            actions: [RETRY, BACK],
        },
        {
            match: /no media devices|NotFoundError|no camera|no microphone|no stream/i,
            title: (name) => `${name} could not find a device`,
            body: 'No camera or microphone was available. Check that one is connected and not in use by another app.',
            actions: [RETRY, BACK],
        },
        {
            match: /pose|landmark|mediapipe|tracking/i,
            title: (name) => `${name} needs pose tracking`,
            body: 'Movement tracking is not available on this device, so reps cannot be counted.',
            actions: [BACK],
        },
        {
            match: /not supported|unsupported|refusing to start|no profile|no overlay/i,
            // The activity's own sentence, because it is more specific than anything here.
            title: (name) => `${name} cannot start`,
            body: (why) => sentence(why),
            actions: [BACK],
        },
        {
            match: /conversation/i,
            title: () => 'Open a conversation first',
            body: 'A meeting is recorded into a conversation, so start or open one and try again.',
            actions: [BACK],
        },
        {
            match: /homepilot|not connected|session|websocket|bridge/i,
            title: () => 'HomePilot isn’t connected',
            // The activity's own sentence, which names *what* it needed HomePilot for and
            // what would link it — a generic line here would throw both away. The reassuring
            // half is fixed, because it is true of every one of these: almost all of
            // Together runs with no HomePilot at all.
            body: (why) =>
                `${sentence(why)} Everything else — Focus, Journey, Music, Watch and Coach — works without it.`,
            actions: [SETTINGS, BACK],
        },
        {
            match: /audio source|web audio|no audio/i,
            title: (name) => `${name} has nothing to listen to`,
            body: (why) => sentence(why),
            actions: [BACK],
        },
        {
            match: /moment detection/i,
            title: (name) => `${name} isn’t ready yet`,
            body: (why) => sentence(why),
            actions: [BACK],
        },
    ];

    /** Trim, capitalise, and end with a full stop — the reasons are fragments. */
    function sentence(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return '';
        const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
        return /[.!?]$/.test(capital) ? capital : `${capital}.`;
    }

    /**
     * Turn a `{ok:false, why}` into a screen.
     *
     * The fallback still carries the activity's own words rather than replacing them, which
     * is the difference between a user who can act and a user who can only shrug.
     */
    function describe(result, { name = 'This activity' } = {}) {
        const why = String((result && result.why) || '').trim();
        for (const rule of RULES) {
            if (!rule.match.test(why)) continue;
            return {
                id: ruleId(rule),
                title: typeof rule.title === 'function' ? rule.title(name) : rule.title,
                body: typeof rule.body === 'function' ? rule.body(why) : rule.body,
                actions: rule.actions,
                why,
            };
        }
        return {
            id: 'unmatched',
            title: `${name} could not start`,
            // Never "Something went wrong". The reason is what the activity said, and an
            // empty one is itself worth saying out loud rather than papering over.
            body: sentence(why) || 'No reason was given, which is itself a bug worth reporting.',
            actions: [RETRY, BACK],
            why,
        };
    }

    function ruleId(rule) {
        return RULES.indexOf(rule) >= 0 ? `rule-${RULES.indexOf(rule)}` : 'unmatched';
    }

    /** A declined permission is a *choice*, not a failure, and reads differently. */
    function declined(name) {
        return {
            id: 'declined',
            title: `${name} needs permission`,
            body: 'You can change your mind at any time — nothing was started and nothing is being captured.',
            actions: [RETRY, BACK],
            why: 'declined',
        };
    }

    return { describe, declined, sentence, RULES, RETRY, BACK, SETTINGS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TOGETHER_FAILURES = TogetherFailures;
if (typeof module !== 'undefined' && module.exports) module.exports = TogetherFailures;
