/**
 * BehaviorRouter — asks the existing behavior system, and does not become one (IC1).
 *
 * The Experience Director wants a posture ("greet", "listen", "look at the
 * shell"). `BehaviorEngine`, `ModeManager` and the scheduler already decide
 * which clip can play. This router forwards a request and records what happened.
 * It does not own an `AnimationMixer`, it does not write bones, and it does not
 * stop a clip that is currently driving the mouth.
 *
 * While the companion is speaking, only `speak`, `listen` and `smile` are
 * forwarded. Anything else is accepted and deferred, so a gesture request
 * cannot cut lip-sync mid-word. If the director has no matching clip, the
 * request still succeeds with `applied: 'fallback'` — the line of dialogue is
 * the behavior, and a missing animation is not an error the user should see.
 *
 * Locomotion toward an anchor is refused when it would bring the avatar closer
 * to the camera than the comfort distance. The camera itself is never written.
 *
 * Exposes: window.NEXUS_COMPANION_BEHAVIOR
 */
const BehaviorRouter = (() => {
    'use strict';

    const INTENTS = Object.freeze({
        greet: { mouthSafe: false },
        listen: { mouthSafe: true },
        speak: { mouthSafe: true },
        smile: { mouthSafe: true },
        look_at_user: { mouthSafe: false },
        look_at_object: { mouthSafe: false },
        gesture_toward_object: { mouthSafe: false },
        celebrate: { mouthSafe: false },
        relax: { mouthSafe: false },
        sit: { mouthSafe: false },
        stand: { mouthSafe: false },
        walk_to_anchor: { mouthSafe: false, locomotion: true },
    });

    /**
     * PG3. Where each companion intent is carried out. The Behavior Director's registry speaks
     * its own vocabulary (`greeting`, `wave`, `nod_along`, `point`, `idle`, …) and declared none
     * of this router's names except `celebrate`, `sit` and `stand`. An undeclared name reached
     * `selector.topK`, which then ranked all 166 clips lexically — and a `smile` came out as
     * `action_attention_seeking`, an arm-waving bid for attention (seen in the V5 walkthrough).
     *
     * So every intent says where it goes:
     *  - `face`: the VRM expression system, never a body clip — a smile is a face, and a
     *    full-body clip for it is both wrong and heavier (`actuators.expression`);
     *  - `gaze`: the procedural animator's gaze override, `'user'` (eye contact) or the
     *    `gazePoint` the caller resolved from a verified anchor (`actuators.gaze`);
     *  - `registry`: one of the registry's own declared intents, so the selector narrows to
     *    clips that were tagged for it;
     *  - none of the above: no channel — the request answers `fallback`, deterministically.
     * Nothing here falls through to "any clip at all".
     */
    const CHANNELS = Object.freeze({
        greet: Object.freeze({ registry: 'greeting' }),
        listen: Object.freeze({ registry: 'nod_along' }),
        speak: Object.freeze({ registry: 'talk' }),
        smile: Object.freeze({ face: 'happy', intensity: 0.35, ms: 2200 }),
        look_at_user: Object.freeze({ gaze: 'user', ms: 2500 }),
        look_at_object: Object.freeze({ gaze: 'target', ms: 2500 }),
        // No route on purpose: the library's only clip declaring `point` is
        // `action_attention_seeking` (arm waving overhead), tagged `point` by the description
        // drafter's attention→point mapping. A pointing gesture that waves both arms at the
        // person is worse than none. Re-tag it and rebuild the embeddings, then route this.
        gesture_toward_object: Object.freeze({}),
        celebrate: Object.freeze({ registry: 'celebrate' }),
        relax: Object.freeze({ registry: 'idle' }),
        sit: Object.freeze({ registry: 'sit' }),
        stand: Object.freeze({ registry: 'stand' }),
        walk_to_anchor: Object.freeze({}),
    });

    function distance(a, b) {
        if (!a || !b) return Infinity;
        const dx = (a.x || 0) - (b.x || 0);
        const dy = (a.y || 0) - (b.y || 0);
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * A placement that keeps the avatar outside the comfort sphere around the
     * camera. Returns the original point when it is already far enough, or a
     * point pushed straight away from the camera. Never returns a camera write.
     */
    function safePlacement(camera, desired, minDistance) {
        const min = Number(minDistance) > 0 ? Number(minDistance) : 0.8;
        if (!camera || !desired) return { ok: true, position: desired || null, moved: false };
        const dist = distance(camera, desired);
        if (dist >= min) return { ok: true, position: Object.assign({}, desired), moved: false };
        if (dist < 1e-6) {
            return {
                ok: true,
                position: { x: camera.x || 0, y: desired.y || 0, z: (camera.z || 0) + min },
                moved: true,
            };
        }
        const scale = min / dist;
        return {
            ok: true,
            moved: true,
            position: {
                x: (camera.x || 0) + ((desired.x || 0) - (camera.x || 0)) * scale,
                y: (camera.y || 0) + ((desired.y || 0) - (camera.y || 0)) * scale,
                z: (camera.z || 0) + ((desired.z || 0) - (camera.z || 0)) * scale,
            },
        };
    }

    function create(options) {
        const options_ = options || {};
        const director = options_.director || null;
        const now = options_.now || (() => Date.now());
        const log = [];

        function request(name, context) {
            const ctx = context || {};
            const spec = INTENTS[name];
            if (!spec) {
                const refused = { ok: false, why: 'unknown-intent', name: name, applied: 'none', at: now() };
                log.push(refused);
                return refused;
            }
            if (ctx.speaking && !spec.mouthSafe) {
                const deferred = { ok: true, why: 'lip-sync', name: name, applied: 'deferred', at: now() };
                log.push(deferred);
                return deferred;
            }
            if (spec.locomotion) {
                if (ctx.allowLocomotion !== true) {
                    const held = { ok: true, why: 'locomotion-off', name: name, applied: 'fallback', at: now() };
                    log.push(held);
                    return held;
                }
                const placement = safePlacement(ctx.camera, ctx.anchor, ctx.minDistance);
                if (placement.moved) {
                    const blocked = {
                        ok: true,
                        why: 'comfort-distance',
                        name: name,
                        applied: 'fallback',
                        at: now(),
                        position: placement.position,
                    };
                    log.push(blocked);
                    return blocked;
                }
            }
            let applied = 'fallback';
            let channel = 'none';
            const route = CHANNELS[name] || {};
            const host = ctx.director || director;
            const actuators = options_.actuators || {};
            if (route.face && typeof actuators.expression === 'function') {
                channel = 'expression';
                try {
                    if (actuators.expression(route.face, route.intensity, route.ms) === true) applied = 'behavior';
                } catch (_) {
                    applied = 'fallback';
                }
            } else if (route.gaze && typeof actuators.gaze === 'function') {
                channel = 'gaze';
                const point = route.gaze === 'user' ? { x: 0, y: 0 } : ctx.gazePoint;
                const valid =
                    point &&
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y) &&
                    Math.abs(point.x) <= 1.5 &&
                    Math.abs(point.y) <= 1.5;
                try {
                    if (valid && actuators.gaze(point, route.ms) === true) applied = 'behavior';
                } catch (_) {
                    applied = 'fallback';
                }
            } else if (route.registry && host && typeof host.handleIntent === 'function') {
                channel = 'registry';
                // A host that can say which clips declare the intent is asked first: an empty
                // answer is a fallback, never a lexical guess over the whole library.
                const registry = host.registry;
                const declared =
                    registry && typeof registry.forIntent === 'function' ? registry.forIntent(route.registry) : null;
                if (!declared || declared.length) {
                    try {
                        const picked = host.handleIntent({
                            name: route.registry,
                            source: 'experience',
                            companionIntent: name,
                            objectId: ctx.objectId || null,
                        });
                        if (picked) applied = 'behavior';
                    } catch (error) {
                        applied = 'fallback';
                    }
                }
            }
            const result = {
                ok: true,
                why: applied === 'behavior' ? 'played' : 'no-clip',
                name: name,
                applied: applied,
                channel: channel,
                at: now(),
            };
            log.push(result);
            return result;
        }

        return {
            INTENTS: INTENTS,
            CHANNELS: CHANNELS,
            request: request,
            safePlacement: safePlacement,
            recent: function () {
                return log.slice();
            },
            reset: function () {
                log.length = 0;
            },
        };
    }

    return { INTENTS: INTENTS, CHANNELS: CHANNELS, create: create, safePlacement: safePlacement, distance: distance };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_BEHAVIOR = BehaviorRouter;
if (typeof module !== 'undefined' && module.exports) module.exports = BehaviorRouter;
