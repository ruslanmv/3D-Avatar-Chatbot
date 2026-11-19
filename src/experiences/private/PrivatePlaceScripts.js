/**
 * PP1. What a private room is for, so that she knows on arrival and can take the first step.
 *
 * A room used to be a backdrop: Private named it in one line (`WHERE YOU ARE: …`) and she greeted
 * the person with the evening's generic opening, so on a stage built for a striptease she still
 * asked what they would like to do. Here each room made for one of her shows carries:
 *
 *   - `brief`: two sentences for her prompt (what the room is, what she does in it, that the show
 *     starts only on their yes), added while the room is on screen;
 *   - `opening`: her first line on arrival, in the card's language (PrivateLocale
 *     `place.<id>.opening`), said instead of the generic one;
 *   - `shows`: the shows she offers here, best first. She invites them to the first one the pace
 *     has opened — on arrival if it is already open, otherwise the moment they step the pace up to
 *     it — once per show per evening. A smaller ceiling falls back to the next one (a Sensual
 *     evening on the stage never reaches the striptease's step 4, so she offers to tease).
 *
 * What this never does: start a show, move the pace, or undress her. The invitation is an offer
 * (the bridge's `offerShow`), and only the person's yes, their tap on the chip, or their own words
 * start it — re-checked by the policy and against the pace exactly as when asked for in words.
 * Intensity stays ConsentFlow's, moved by the person (docs/claude/adult-experience-and-quality-lab.md).
 */
(function (global) {
    'use strict';

    const PLACES = Object.freeze({
        'strip-stage': Object.freeze({
            id: 'strip-stage',
            shows: Object.freeze(['striptease', 'tease']),
            brief: 'This room is your little stage: a round platform under warm lights, a tall brass lamp behind you, speakers either side, and them right in front of you. It is where you dance for them and, when they say yes, take everything off one piece at a time; you lead the evening here, with confidence, and still follow their pace.',
        }),
        'dance-lounge': Object.freeze({
            id: 'dance-lounge',
            shows: Object.freeze(['table-dance', 'tease']),
            brief: 'This room is a dim velvet lounge: a long sofa, a low glass table beside you, the two of you alone. It is where you give them a table dance, close enough to touch, and finish on their lap when they say yes; you lead the evening here, with confidence, and still follow their pace.',
        }),
    });

    /** The script for a world id; a light stand-in answers for the place it stands in for. */
    function forWorld(id, lightFor) {
        const key = PLACES[id] ? id : PLACES[lightFor] ? lightFor : null;
        return key ? PLACES[key] : null;
    }

    /**
     * The show to invite them to now: the first of the room's shows that is open at `level`,
     * switched on (MP1), and not already offered this evening. `routines` is PrivateRoutines;
     * `poseLevel` is the policy's step for a position. Null when there is nothing (new) to offer.
     */
    function showToOffer(script, { level, routines, poseLevel, offered } = {}) {
        if (!script || !routines || !routines.ROUTINES) return null;
        const done = offered instanceof Set ? offered : new Set(offered || []);
        for (const id of script.shows) {
            if (!routines.ROUTINES[id]) continue;
            if (typeof routines.available === 'function' && !routines.available(id)) continue;
            const needs = typeof routines.level === 'function' ? routines.level(id, poseLevel) : 1;
            if (!(Number(level) >= needs)) continue;
            // The best open one; once it is offered, a lesser one is never offered after it.
            return done.has(id) ? null : id;
        }
        return null;
    }

    /** The lines for her prompt while this room is on screen. Empty for any other room. */
    function promptLines(script) {
        if (!script) return [];
        return [`THIS ROOM: ${script.brief}`];
    }

    const api = { PLACES, forWorld, showToOffer, promptLines };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PLACE_SCRIPTS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
