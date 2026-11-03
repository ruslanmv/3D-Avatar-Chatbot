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
            const host = ctx.director || director;
            if (host && typeof host.handleIntent === 'function') {
                try {
                    const picked = host.handleIntent({
                        name: name,
                        source: 'experience',
                        objectId: ctx.objectId || null,
                    });
                    if (picked) applied = 'behavior';
                } catch (error) {
                    applied = 'fallback';
                }
            }
            const result = {
                ok: true,
                why: applied === 'behavior' ? 'played' : 'no-clip',
                name: name,
                applied: applied,
                at: now(),
            };
            log.push(result);
            return result;
        }

        return {
            INTENTS: INTENTS,
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

    return { INTENTS: INTENTS, create: create, safePlacement: safePlacement, distance: distance };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_BEHAVIOR = BehaviorRouter;
if (typeof module !== 'undefined' && module.exports) module.exports = BehaviorRouter;
