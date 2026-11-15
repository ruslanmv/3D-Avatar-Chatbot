/**
 * UN3. The evening's narrative state, kept apart from everything that changes the world.
 *
 * `StoryWeaver` deals an outline; this keeps track of where the evening really is and turns
 * that into a few lines for her prompt. It executes nothing. The bridge (`PrivateActionBridge`)
 * reports what *happened* — a world the renderer confirmed, a proposal the person was asked,
 * a trip that started, landed or failed — and this records it. The distinction it exists for:
 *
 *   where she is          the world the renderer last confirmed (`shown`)
 *   where she proposes    the destination of an open proposal (`proposed`)
 *   where they agreed     a trip in progress (`travelling`)
 *   where she arrived     only after the renderer confirms that world (`arrived`)
 *
 * An arrival line she wrote does not move anything here; only `arrived(id)` with the id the
 * renderer announced does, and only for the trip that is in progress. A failed or stale trip
 * leaves the evening where it was.
 *
 * The phases (`opening` → `travel-proposed` → `travelling` → `arrived` → `epilogue`) are a
 * direction, never a schedule. Nothing advances on a timer or because a phase "should" come
 * next; staying in the opening all night is a complete evening. The lines tell her so.
 *
 * Exposes: window.NEXUS_STORY_DIRECTOR
 */
(function (global) {
    'use strict';

    const PHASES = Object.freeze(['opening', 'travel-proposed', 'travelling', 'arrived', 'epilogue', 'ended']);

    function titleOf(places, id) {
        const p = (places || []).find((x) => x && (x.id === id || x.world === id));
        return p ? String(p.title || p.id) : null;
    }

    function create(outline, options) {
        const o = options || {};
        const Weaver = o.weaver || (global && global.NEXUS_STORY_WEAVER) || null;
        const places = Array.isArray(o.places) ? o.places : [];
        const state = {
            outline: outline || null,
            phase: 'opening',
            shown: o.current || null,
            proposed: null,
            travelling: null,
            arrivedAt: null,
            failed: null,
            done: [],
        };

        const api = {
            PHASES,
            get phase() {
                return state.phase;
            },
            get outline() {
                return state.outline;
            },
            snapshot() {
                return {
                    storyId: state.outline ? state.outline.id : null,
                    phase: state.phase,
                    shown: state.shown,
                    proposed: state.proposed,
                    travelling: state.travelling,
                    arrivedAt: state.arrivedAt,
                    failed: state.failed,
                    done: state.done.slice(),
                };
            },
            /** The renderer says this world is up (or `null`: none). */
            shown(id) {
                state.shown = id || null;
                return api.snapshot();
            },
            /** One proposal at a time; it does not move anything. */
            propose(id) {
                if (state.phase === 'ended' || state.travelling || !id) return false;
                state.proposed = id;
                state.failed = null;
                state.phase = 'travel-proposed';
                return true;
            },
            /** They said no, or it expired: back to where the evening was. */
            decline() {
                if (!state.proposed) return false;
                state.proposed = null;
                state.phase = state.arrivedAt ? 'arrived' : 'opening';
                return true;
            },
            /** They said yes and the trip began. */
            travelling(id) {
                if (state.phase === 'ended' || !id) return false;
                state.proposed = null;
                state.travelling = id;
                state.failed = null;
                state.phase = 'travelling';
                return true;
            },
            /** The renderer confirmed this world. Only the trip in progress arrives. */
            arrived(id) {
                if (!state.travelling || id !== state.travelling) return false;
                state.shown = id;
                state.arrivedAt = id;
                state.travelling = null;
                state.phase = 'arrived';
                if (!state.done.includes('travel')) state.done.push('travel');
                return true;
            },
            /** The trip did not happen: the room she is in is still the room. */
            failed(why) {
                if (!state.travelling) return false;
                state.travelling = null;
                state.failed = String(why || 'failed');
                state.phase = state.arrivedAt ? 'arrived' : 'opening';
                return true;
            },
            /** The person chose to close the evening gently (never forced). */
            epilogue() {
                if (state.phase === 'ended') return false;
                state.phase = 'epilogue';
                return true;
            },
            end() {
                state.phase = 'ended';
                state.proposed = null;
                state.travelling = null;
                return true;
            },
            /**
             * Her prompt lines for the evening. English guidance; she answers in the person's language.
             * @param {object} [facts] `{ canTravel }` — whether a trip could run here right now
             */
            lines(facts) {
                const f = facts || {};
                const out = state.outline;
                if (!out || state.phase === 'ended') return [];
                const hook = Weaver && Weaver.HOOKS ? Weaver.HOOKS[out.narrativeHook] : null;
                const mood = Weaver && Weaver.MOODS ? Weaver.MOODS[out.characterMood] : null;
                const arc = Weaver && Weaver.ARCS ? Weaver.ARCS[out.storyArc] : null;
                const here = titleOf(places, state.shown) || out.openingTitle;
                const dest = out.destination ? titleOf(places, out.destination) || out.destinationTitle : null;
                const lines = [
                    '',
                    'TONIGHT — your own outline for this evening. Live it; never announce it, never number it, never call it a story or a stage.',
                ];
                if (here)
                    lines.push(
                        `- Where you really are: ${here}. Describe only this place; the app shows it around you.`
                    );
                const self = [
                    mood && `you are ${mood}`,
                    hook && `what brought you here: ${hook}`,
                    arc && `the feeling of the night: ${arc}`,
                ]
                    .filter(Boolean)
                    .join('; ');
                if (self) lines.push(`- Tonight ${self}.`);
                if (state.phase === 'travelling') {
                    lines.push(
                        `- You are on your way to ${titleOf(places, state.travelling) || 'the other place'} together: say so lightly. Do not describe arriving until RIGHT NOW says you have arrived.`
                    );
                } else if (state.phase === 'travel-proposed') {
                    lines.push(
                        `- You have invited them to ${titleOf(places, state.proposed) || 'another place'}; the app is asking them. Wait for their answer — you are still here.`
                    );
                } else if (state.phase === 'arrived') {
                    lines.push(`- You came here together tonight: ${here}. There is no hurry; take it in.`);
                } else if (dest && f.canTravel && !state.done.includes('travel')) {
                    lines.push(
                        `- If, and only if, the moment comes and they seem to want somewhere quieter, you may invite them to ${dest}. An invitation is a question: say it in your words, then <go place="${out.destination}"/> on its own line. The app asks them; you go only if they say yes, and you never say you have arrived until RIGHT NOW says so.`
                    );
                }
                if (state.failed)
                    lines.push(
                        '- The trip you set out on did not happen; you are still where you were. Say so once, lightly, if it comes up.'
                    );
                lines.push(
                    '- Staying is always right. Never push the evening on, never raise its pace, and never change place, music or clothes because the night "should" move on — only when they want it.'
                );
                return lines;
            },
        };
        return api;
    }

    const api = { PHASES, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STORY_DIRECTOR = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
