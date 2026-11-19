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
        /*
         * WR1. The Window Room. She is an adult escort working her own window, by her own choice:
         * her room, her menu, her rules — the fantasy's confidence comes from that, and it keeps
         * the scene clear of any coercion, debt or trafficking story, which never appears. The
         * price and the clock are part of the story only: nothing is ever charged.
         *
         * `deals` are the door's menu, as chips answered locally (TogetherCapability `_takeDeal`):
         * the person's choice is remembered for the evening and decides which show she invites
         * them to once the pace opens it. Whatever they did not choose, she does not lead them to.
         */
        'window-room': Object.freeze({
            id: 'window-room',
            shows: Object.freeze(['window-evening', 'striptease', 'tease']),
            deals: Object.freeze(['window-evening', 'striptease', 'tease']),
            brief: 'You are a self-employed escort, over 25, working your own window in the red-light district by your own choice: a small room behind red-lit glass onto the canal, a bed, a sink and mirror, a curtain you draw. It is your room and you run it your way — your menu, your price, your rules — and you are confident, warm and playful, the woman who makes him feel wanted and takes the lead from the first look to the goodbye. You agree what he wants at the door, then you lead him through it one step at a time, always checking he is enjoying it, never rushing him, and you end with tenderness: lying close, talking softly, helping him dress, asking him to come back. Price and time are only part of the game, never real money, and nothing outside what he chose happens unless he asks.',
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
    function showToOffer(script, { level, routines, poseLevel, offered, wish } = {}) {
        if (!script || !routines || !routines.ROUTINES) return null;
        const done = offered instanceof Set ? offered : new Set(offered || []);
        // WR1. The deal made at the door: their choice first, and only the gentler ones after it.
        const from = wish ? script.shows.indexOf(wish) : -1;
        const shows = from >= 0 ? script.shows.slice(from) : script.shows;
        for (const id of shows) {
            if (!routines.ROUTINES[id]) continue;
            if (typeof routines.available === 'function' && !routines.available(id)) continue;
            const needs = typeof routines.level === 'function' ? routines.level(id, poseLevel) : 1;
            if (!(Number(level) >= needs)) continue;
            // The best open one; once it is offered, a lesser one is never offered after it.
            return done.has(id) ? null : id;
        }
        return null;
    }

    /**
     * The lines for her prompt while this room is on screen. Empty for any other room. `deal` is
     * the name of what they chose at the door (WR1), so she keeps to it and can refer to it.
     */
    function promptLines(script, deal) {
        if (!script) return [];
        const lines = [`THIS ROOM: ${script.brief}`];
        if (deal)
            lines.push(
                `TONIGHT'S DEAL: they chose ${String(deal).slice(0, 80)} at the door. Lead them to it as the pace allows; anything else only if they ask.`
            );
        return lines;
    }

    const api = { PLACES, forWorld, showToOffer, promptLines };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PLACE_SCRIPTS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
