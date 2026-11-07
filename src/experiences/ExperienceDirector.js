/**
 * ExperienceDirector — start, pause, resume, stop, and always restore (IC2).
 *
 * One active experience. Starting a second one stops the first. A throw inside
 * prepare or start becomes `failed` and the scene snapshot is written back, so
 * a bad manifest cannot leave the terrace in the chat scene.
 *
 * The render loop calls `update`. This file never installs a frame loop of its own.
 *
 * Events are `nexus:companion` CustomEvents plus local listeners. They are not
 * pushed onto the Behavior Director bus: that bus has a closed vocabulary, and
 * an unknown name is dropped. `tts:end` is the exception we listen for, because
 * it already exists and it is how the wave bed knows she has stopped speaking.
 *
 * Exposes: window.NEXUS_EXPERIENCE_DIRECTOR
 */
const ExperienceDirector = (() => {
    'use strict';

    function create(options) {
        const options_ = options || {};
        const registry = options_.registry;
        const life = options_.life;
        const scene = options_.scene;
        const audio = options_.audio;
        const interaction = options_.interaction;
        const behavior = options_.behavior;
        const session = options_.session;
        const privacy = options_.privacy;
        const experienceMemory = options_.experienceMemory;
        const bus = options_.bus || null;
        const listeners = new Set();
        let current = null;
        let elapsed = 0;
        let frames = 0;
        let lastDt = 0;
        let loadStarted = 0;
        let lastLoadMs = 0;
        const errors = [];

        function emit(type, extra) {
            const detail = Object.assign({ type: type }, extra || {});
            for (const listener of listeners) {
                try {
                    listener(detail);
                } catch (error) {
                    console.warn('[Experience] listener threw', error);
                }
            }
            const target = options_.target;
            if (target && typeof target.dispatchEvent === 'function' && typeof options_.CustomEvent === 'function') {
                try {
                    target.dispatchEvent(new options_.CustomEvent('nexus:companion', { detail: detail }));
                } catch (_) {
                    /* a document that cannot dispatch is not a failed experience */
                }
            }
        }

        function platform() {
            const probe = options_.platform ? options_.platform() : {};
            if (probe.xrPresenting) {
                if (probe.blendMode === 'additive' || probe.blendMode === 'alpha-blend') return 'mr';
                return 'vr';
            }
            if (probe.narrow) return 'mobile';
            return 'desktop';
        }

        function context() {
            return {
                destination: session ? session.destination() : 'experiences',
                platform: platform(),
                quality: (function () {
                    const probe = options_.platform ? options_.platform() : {};
                    if (session && session.comfort && session.comfort().reducedMotion) return 'low';
                    if (probe.xrPresenting) return 'low';
                    if (probe.cores && probe.cores <= 4) return 'low';
                    return 'desktop';
                })(),
                passthrough: platform() === 'mr',
                scene: scene,
                audio: audio,
                interaction: interaction,
                behavior: behavior,
                experienceMemory: experienceMemory,
                voice: session ? session.voice() : { muted: false, companion: 1, environment: 0.45 },
                say: say,
                capabilities: session ? session.capabilities() : [],
            };
        }

        function say(text) {
            if (audio) audio.setSpeaking(true);
            if (behavior) behavior.request('speak', { speaking: false });
            let spoken = false;
            if (typeof options_.say === 'function') {
                try {
                    options_.say(text);
                    spoken = true;
                } catch (error) {
                    errors.push(String(error && error.message));
                    spoken = false;
                }
            }
            if (!spoken && audio) audio.setSpeaking(false);
            emit('experience:line', { text: text, spoken: spoken });
            return { text: text, spoken: spoken };
        }

        async function cleanup(def, why) {
            if (scene && typeof scene.cancel === 'function') scene.cancel();
            if (def && typeof def.stop === 'function') {
                try {
                    await def.stop(context(), why);
                } catch (error) {
                    errors.push(String(error && error.message));
                }
            }
            if (def && typeof def.dispose === 'function') {
                try {
                    def.dispose();
                } catch (error) {
                    errors.push(String(error && error.message));
                }
            }
            if (scene) scene.restore();
            if (audio) audio.stopAmbience();
            if (session && session.markSceneRestored) session.markSceneRestored();
            current = null;
        }

        async function start(id) {
            if (life.status === 'active' || life.status === 'paused' || life.status === 'preparing') {
                await stop('replaced');
            }
            const def = registry.get(id);
            if (!def) return { ok: false, why: 'unknown' };
            if (def.implemented === false) return { ok: false, why: 'not-built' };
            const ctx = context();
            if (Array.isArray(def.supportedPlatforms) && def.supportedPlatforms.indexOf(ctx.platform) === -1) {
                return { ok: false, why: 'platform:' + ctx.platform };
            }
            if (typeof def.availability === 'function') {
                const available = def.availability(ctx);
                if (available && available.ok === false) return { ok: false, why: available.why || 'unavailable' };
            }
            const granted = session ? session.capabilities() : [];
            for (const cap of def.requiredCapabilities || []) {
                const allowed = privacy ? privacy.capabilityAllowed(cap, ctx.destination, granted) : { ok: true };
                if (!allowed.ok) return { ok: false, why: allowed.why };
            }
            const begun = life.begin(id);
            if (!begun.ok) return begun;
            const gen = begun.generation;
            current = def;
            if (session && session.setExperience) session.setExperience(id);
            emit('experience:preparing', { id: id });
            loadStarted = Date.now();
            try {
                await def.prepare(ctx);
                if (!life.matches(gen)) return { ok: false, why: 'cancelled' };
                const started = await def.start(ctx);
                if (!life.matches(gen)) return { ok: false, why: 'cancelled' };
                if (!started || started.ok === false) {
                    life.fail((started && started.why) || 'start-failed');
                    await cleanup(def, 'failed');
                    emit('experience:failed', { id: id, why: (started && started.why) || 'start-failed' });
                    return { ok: false, why: (started && started.why) || 'start-failed' };
                }
                const marked = life.markActive(gen);
                if (!marked.ok) return { ok: false, why: marked.why };
                lastLoadMs = Date.now() - loadStarted;
                emit('experience:started', { id: id });
                emit('scene:changed', { id: id });
                return { ok: true, id: id, line: started.line || (def.status() && def.status().line) };
            } catch (error) {
                // stop() during prepare already moved the lifecycle off `preparing`.
                // That is a cancel, and it must not be reported as a failure.
                if (life.status !== 'preparing') return { ok: false, why: 'cancelled' };
                life.fail(String(error && error.message));
                errors.push(String(error && error.message));
                await cleanup(def, 'failed');
                emit('experience:failed', { id: id, why: String(error && error.message) });
                return { ok: false, why: String(error && error.message) };
            }
        }

        async function stop(why) {
            const def = current;
            const result = life.stop(why || 'stop');
            await cleanup(def, why || 'stop');
            emit('experience:stopped', { why: why || 'stop' });
            return result;
        }

        function pause() {
            const result = life.pause();
            if (!result.ok) return result;
            if (current && current.pause) current.pause(context());
            emit('experience:paused', { id: life.experienceId });
            return result;
        }

        function resume() {
            const result = life.resume();
            if (!result.ok) return result;
            if (current && current.resume) current.resume(context());
            emit('experience:resumed', { id: life.experienceId });
            return result;
        }

        async function complete() {
            const def = current;
            const id = def && def.id;
            const result = life.complete();
            if (!result.ok) return result;
            if (experienceMemory && id) experienceMemory.complete(id);
            await cleanup(def, 'completed');
            emit('experience:completed', { id: id });
            return result;
        }

        function choose(choiceId) {
            if (!current || typeof current.choose !== 'function') return { ok: false, why: 'no-experience' };
            if (life.status !== 'active') return { ok: false, why: 'not-active' };
            return current.choose(choiceId, context());
        }

        function interact(objectId) {
            if (!current || typeof current.interact !== 'function') return { ok: false, why: 'no-experience' };
            if (life.status !== 'active') return { ok: false, why: 'not-active' };
            const result = current.interact(objectId, context());
            // PG3. Say what happened, once the experience has done it, so the conversation can
            // know about a shared moment without anybody adding a second gesture for it: the
            // experience already asked for its own (`result.behavior`). Only a confirmed result.
            if (result && result.ok && !result.exit)
                emit('interaction:completed', {
                    id: life.experienceId || null,
                    objectId: String(objectId),
                    line: typeof (result.state && result.state.line) === 'string' ? result.state.line : null,
                    state: result.state
                        ? {
                              lanternLit: result.state.lanternLit === true,
                              shellTouched: result.state.shellTouched === true,
                          }
                        : null,
                });
            if (result && result.exit)
                return stop('exit').then(function () {
                    return { ok: true, exit: true };
                });
            return result;
        }

        function onPermissionRevoked(capability) {
            emit('permission:revoked', { capability: capability });
            if (!current) return { ok: true, stopped: false };
            const needs = current.requiredCapabilities || [];
            if (needs.indexOf(capability) === -1) return { ok: true, stopped: false };
            stop('permission:' + capability);
            return { ok: true, stopped: true };
        }

        if (bus && typeof bus.on === 'function') {
            bus.on('tts:end', function () {
                if (audio) audio.setSpeaking(false);
                if (behavior && life.status === 'active') behavior.request('listen', { speaking: false });
            });
        }

        const api = {
            start: start,
            stop: stop,
            pause: pause,
            resume: resume,
            complete: complete,
            choose: choose,
            interact: interact,
            onPermissionRevoked: onPermissionRevoked,
            status: function () {
                return {
                    status: life.status,
                    experienceId: life.experienceId,
                    reason: life.reason,
                    detail: current && current.status ? current.status() : null,
                };
            },
            update: function (dt) {
                frames += 1;
                lastDt = dt || 0;
                elapsed += dt || 0;
                const detail = current && current.status ? current.status() : null;
                if (scene && scene.update) {
                    scene.update(dt, {
                        lanternLit: detail && detail.lanternLit,
                        reducedMotion: session && session.comfort ? session.comfort().reducedMotion : false,
                        elapsed: elapsed,
                    });
                }
            },
            trySelect: function (raycaster) {
                if (!interaction || life.status !== 'active') return false;
                return interaction.trySelect(raycaster);
            },
            on: function (listener) {
                listeners.add(listener);
                return function () {
                    listeners.delete(listener);
                };
            },
            bindViewer: function (host) {
                if (scene && scene.bind) scene.bind(host);
                options_.platform = function () {
                    return {
                        xrPresenting: host && host.xrPresenting ? host.xrPresenting() : false,
                        blendMode: host && host.blendMode ? host.blendMode() : null,
                        narrow: host && host.narrow ? host.narrow() : false,
                        cores: host && host.cores,
                    };
                };
                return true;
            },
            onVrSessionStart: function () {
                if (audio) audio.onVrSessionStart();
            },
            onVrSessionEnd: function () {
                if (audio) audio.onVrSessionEnd();
            },
            diagnostics: function () {
                let triangles = 0;
                const detail = current && current.status ? current.status() : null;
                if (detail && scene && scene.activeId) triangles = scene.selectables ? scene.selectables().length : 0;
                return {
                    frames: frames,
                    lastDtMs: Math.round((lastDt || 0) * 1000),
                    loadMs: lastLoadMs,
                    errors: errors.slice(),
                    activeObjects: scene && scene.selectables ? scene.selectables().length : 0,
                    triangles: triangles,
                    status: life.status,
                };
            },
            context: context,
        };

        if (interaction && interaction.setTargets) {
            const previous = options_.onSelect;
            // The router was constructed with its own onSelect. Rebind by wrapping
            // is the caller's job; interact() is what buttons use, trySelect uses
            // the router callback passed at construction.
            void previous;
        }
        return api;
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_DIRECTOR = ExperienceDirector;
if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceDirector;
