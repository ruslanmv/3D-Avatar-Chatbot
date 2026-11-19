/**
 * PrivateRoutines — UN36. Shows she knows: a series of positions she moves through for them, slowly,
 * holding each, saying what she shows, and asking for more at the end.
 *
 * Why. One position at a time made every erotic moment a sequence of separate requests — "sit",
 * "open your legs", "lie back", "knees up" — each answered and then frozen. A routine is the whole
 * movement as one wish ("open up for me"): she goes from step to step on her own, with long, soft
 * blends between them, while the conversation is told which step she is in, so her words follow
 * her body the whole way. It is still only her positions (`PrivatePoseController.POSES`), each
 * opened at its own step of the pace (`PrivateActionPolicy.POSE_LEVEL`): a routine reaches no
 * further than its steps could one by one, and is offered only when every step is open.
 *
 * Data only: the bridge runs it (`PrivateActionBridge`, `avatar.routine`). `hold` is how long a
 * step is held, in milliseconds, at speed 1; `body` is what her body is doing in it, in the second
 * person, for the model — what is visible, never a sensation put in her mouth. A `turn` step turns
 * her round in the position she holds (the bridge's turner), so she can show them her back.
 *
 * Exposes: window.NEXUS_PRIVATE_ROUTINES
 */
(function (global) {
    'use strict';

    /** The blend into each step, in seconds (the controller's default is 0.6): slow, deliberate. */
    const BLEND_S = 1.6;
    /** Speed: holds and blends multiply by 1 / speed. "Slower" and "faster" step through these. */
    const SPEEDS = Object.freeze([0.5, 0.7, 1, 1.4, 1.8]);

    const ROUTINES = Object.freeze({
        // A tease that opens early in the evening: nothing in it needs more than Romantic.
        tease: Object.freeze({
            label: 'Tease',
            name: 'a slow tease',
            steps: Object.freeze([
                { pose: 'turn', hold: 7000, body: 'turning away from them slowly, showing them your back' },
                {
                    pose: 'bend-forward',
                    hold: 9000,
                    body: 'bending forward from the hips, your back to them, letting them look',
                },
                { pose: 'turn', hold: 5000, body: 'turning back round to face them, still bent forward' },
                { pose: 'kneel', hold: 7000, body: 'sinking down to kneel in front of them' },
                {
                    pose: 'kneel-wide',
                    hold: 10000,
                    body: 'letting your knees slide wide apart, sitting back on your heels, back arched, hands on your thighs',
                },
            ]),
        }),
        ride: Object.freeze({
            label: 'Ride',
            name: 'climbing onto them',
            steps: Object.freeze([
                {
                    pose: 'kneel-up',
                    hold: 6000,
                    body: 'kneeling up in front of them, hands on your thighs, eyes on theirs',
                },
                {
                    pose: 'straddle',
                    hold: 16000,
                    body: 'climbing astride their lap, knees wide on either side of them, back arched, hands on their shoulders',
                },
            ]),
        }),
        'open-for-you': Object.freeze({
            label: 'Open for you',
            name: 'opening yourself for them',
            steps: Object.freeze([
                {
                    pose: 'kneel-wide',
                    hold: 8000,
                    body: 'kneeling in front of them, knees sliding apart, sitting back on your heels',
                },
                {
                    pose: 'sit-open',
                    hold: 12000,
                    body: 'sitting back on the edge of the seat and slowly opening your legs for them, hands on the insides of your knees',
                },
                {
                    pose: 'knees-up',
                    hold: 15000,
                    body: 'lying back, knees raised and wide apart, showing yourself to them completely, looking down along your body at them',
                },
            ]),
        }),
        'from-behind': Object.freeze({
            label: 'From behind',
            name: 'offering yourself from behind',
            steps: Object.freeze([
                { pose: 'kneel-wide', hold: 7000, body: 'kneeling with your knees wide apart, back arched' },
                { pose: 'all-fours', hold: 9000, body: 'going down onto your hands and knees in front of them' },
                {
                    pose: 'turn',
                    hold: 16000,
                    body: 'turning round on all fours so your back and your ass are to them, back dipped, looking back at them over your shoulder',
                },
            ]),
        }),
        everything: Object.freeze({
            label: 'Show everything',
            name: 'showing them everything',
            steps: Object.freeze([
                {
                    pose: 'sit-open',
                    hold: 9000,
                    body: 'sitting on the edge of the seat with your legs open wide for them',
                },
                {
                    pose: 'knees-up',
                    hold: 11000,
                    body: 'lying back with your knees up and apart, nothing hidden from them',
                },
                { pose: 'all-fours', hold: 8000, body: 'rolling over onto your hands and knees' },
                {
                    pose: 'turn',
                    hold: 14000,
                    body: 'turning round on all fours, your ass to them, back dipped, looking back over your shoulder',
                },
            ]),
        }),
    });

    /** In the order they are offered, gentlest first. */
    const ORDER = Object.freeze(['tease', 'ride', 'open-for-you', 'from-behind', 'everything']);

    /** The step of the pace a routine needs: the highest any of its positions opens at. */
    function level(id, poseLevel) {
        const routine = ROUTINES[id];
        if (!routine) return Infinity;
        let need = 1;
        for (const step of routine.steps) {
            const at = typeof poseLevel === 'function' ? Number(poseLevel(step.pose)) || 1 : 1;
            if (at > need) need = at;
        }
        return need;
    }

    /** The routines open at `at`, gentlest first. */
    function openAt(at, poseLevel) {
        return ORDER.filter((id) => level(id, poseLevel) <= (Number(at) || 1));
    }

    /** "Show me" without a name: the boldest one this step of the evening allows. */
    function boldest(at, poseLevel) {
        const open = openAt(at, poseLevel);
        return open.length ? open[open.length - 1] : null;
    }

    /** The next speed slower (-1) or faster (+1) than `speed`. */
    function stepSpeed(speed, direction) {
        const i = SPEEDS.indexOf(speed);
        const at = i < 0 ? SPEEDS.indexOf(1) : i;
        return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + (direction > 0 ? 1 : -1)))];
    }

    const api = { ROUTINES, ORDER, BLEND_S, SPEEDS, level, openAt, boldest, stepSpeed };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ROUTINES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
