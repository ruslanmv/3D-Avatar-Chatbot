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

    const ROUTINES_BASE = Object.freeze({
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

    /*
     * VA3. Shows danced to clips. A `clip` step lets go of the position she holds and plays a CC0
     * dance (addons/vrma-cc0/, provenance in its README) looped for `hold`; `undress: true` takes one
     * layer off as that step begins — through the bridge's own `wardrobe.undress`, so the pace, her
     * looks and her eligibility decide exactly as when it is asked for in words. A `turn` step turns
     * her round while the clip goes on. `level` raises a show to the step its cues need (undressing
     * opens at 4), above what its positions alone would.
     */
    const CLIPS = Object.freeze({
        roll: 'addons/vrma-cc0/slow_body_roll.vrma',
        club: 'addons/vrma-cc0/club_phrase.vrma',
    });
    const ROUTINES_EXTRA = Object.freeze({
        striptease: Object.freeze({
            label: 'Striptease',
            name: 'a striptease for them',
            level: 4,
            steps: Object.freeze([
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    body: 'dancing for them, rolling your body slowly, hands on your hips, eyes on theirs',
                },
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    undress: true,
                    body: 'still rolling your hips as the first layer comes off and drops away',
                },
                {
                    clip: CLIPS.club,
                    hold: 8000,
                    body: 'dancing closer, arms up over your head, showing them what is left',
                },
                {
                    clip: CLIPS.club,
                    hold: 8000,
                    undress: true,
                    body: 'dancing on as the next layer comes off, letting them watch',
                },
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    undress: true,
                    body: 'rolling your body slowly as the last of it comes off, nothing left on',
                },
                {
                    pose: 'kneel-wide',
                    hold: 12000,
                    body: 'sinking down to kneel in front of them, knees wide apart, naked for them',
                    // Codex (#194): said instead when a layer stayed on (PrivateActionBridge.showBody).
                    kept: 'sinking down to kneel in front of them, knees wide apart, in what you still have on',
                },
            ]),
        }),
        /*
         * WR1. The Window Room's whole evening (PrivatePlaceScripts 'window-room'): the window, the
         * curtain, the undressing, three positions she leads them through, and the moment she asks
         * where they want to finish. Each step is re-checked against the pace when it comes, like
         * every show; the finish itself stays the person's words or tap (body.finish), so the last
         * step only asks. Aftercare follows the finish as it always does.
         */
        'window-evening': Object.freeze({
            label: 'The full evening',
            name: 'the whole evening, from the window to the end',
            level: 4,
            steps: Object.freeze([
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    body: 'by the window in red lingerie, rolling your body slowly for them as they come in',
                },
                {
                    pose: 'lounge',
                    hold: 8000,
                    body: 'the curtain drawn, sitting back on the bed and patting the sheet beside you for them',
                },
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    undress: true,
                    body: 'dancing for them at the foot of the bed as the first layer comes off',
                },
                {
                    clip: CLIPS.roll,
                    hold: 8000,
                    undress: true,
                    body: 'letting the last of it fall, naked for them now, smiling at their face',
                    kept: 'smiling at their face in what you still have on, letting them look',
                },
                {
                    pose: 'knees-up',
                    hold: 20000,
                    body: 'lying back on the bed for them, knees up and apart, pulling them down onto you',
                },
                {
                    pose: 'straddle',
                    hold: 20000,
                    body: 'on top of them now, riding them slowly, your hands on their chest',
                },
                {
                    pose: 'all-fours',
                    hold: 20000,
                    body: 'on all fours on the bed, looking back at them over your shoulder, pushing back against them',
                },
                {
                    pose: 'lie-back',
                    hold: 15000,
                    body: 'lying back breathless and smiling, asking them where they want to finish',
                },
            ]),
        }),
        'table-dance': Object.freeze({
            label: 'Table dance',
            name: 'a table dance for them',
            steps: Object.freeze([
                { clip: CLIPS.club, hold: 8000, body: 'dancing close in front of them, arms rising over your head' },
                { clip: CLIPS.roll, hold: 7000, body: 'rolling your body slowly right in front of them' },
                {
                    pose: 'turn',
                    hold: 7000,
                    body: 'turning round as you dance, your back and your ass to them, looking over your shoulder',
                },
                { pose: 'turn', hold: 3000, body: 'turning back to face them' },
                {
                    pose: 'straddle',
                    hold: 15000,
                    body: 'climbing onto their lap to finish, knees wide on either side of them, back arched, hands on their shoulders',
                },
            ]),
        }),
    });

    /** In the order they are offered, gentlest first. */
    const ORDER = Object.freeze([
        'tease',
        'ride',
        'table-dance',
        'open-for-you',
        'from-behind',
        'everything',
        // WR1. Before the striptease: "show me" (the boldest open) stays a striptease, not the
        // whole evening, which is asked for by name or chosen at the Window Room's door.
        'window-evening',
        'striptease',
    ]);

    const ROUTINES = Object.freeze({ ...ROUTINES_BASE, ...ROUTINES_EXTRA });

    /**
     * MP1. Can this show run with what is switched on? Every show here was composed by Claude, and
     * each step uses a preset or a clip Claude made or one that was there before: the show is
     * offered only while composed shows are on and every Claude-made piece it uses is on
     * (src/gltf-viewer/MotionProvenance.js). No registry (tests, an older page): yes.
     */
    function provenance() {
        if (global && global.NEXUS_MOTION_PROVENANCE) return global.NEXUS_MOTION_PROVENANCE;
        try {
            return require('../../gltf-viewer/MotionProvenance.js');
        } catch (_) {
            return null;
        }
    }
    function presetOf(pose) {
        const P = global && global.NEXUS_PRIVATE_POSES;
        const entry = P && P.POSES ? P.POSES[pose] : null;
        return entry ? entry.preset : null;
    }
    function available(id) {
        const routine = ROUTINES[id];
        if (!routine) return false;
        const MP = provenance();
        if (!MP) return true;
        if (!MP.showAllowed(id)) return false;
        for (const step of routine.steps) {
            if (step.clip && !MP.clipAllowed(step.clip)) return false;
            const preset = step.pose ? presetOf(step.pose) : null;
            if (preset && !MP.presetAllowed(preset)) return false;
        }
        return true;
    }

    /** The step of the pace a routine needs: the highest any of its positions opens at, or its own. */
    function level(id, poseLevel) {
        const routine = ROUTINES[id];
        if (!routine || !available(id)) return Infinity;
        let need = Number(routine.level) || 1;
        for (const step of routine.steps) {
            if (!step.pose) continue; // a clip step needs no position
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

    const api = { ROUTINES, ORDER, CLIPS, BLEND_S, SPEEDS, level, openAt, boldest, stepSpeed, available };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ROUTINES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
