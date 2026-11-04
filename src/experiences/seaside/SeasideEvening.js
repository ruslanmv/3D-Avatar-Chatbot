/**
 * Seaside Evening — the flagship experience (IC3).
 *
 * Prepare builds the terrace (or records a logical fallback when there is no
 * renderer yet). Start speaks the welcome and does not move the camera.
 * Choices and the two objects go through the story module. Stop restores the
 * scene group and the audio bed. Every path can stop, including a failed load.
 *
 * Exposes: window.NEXUS_SEASIDE_EVENING
 */
const SeasideEvening = (() => {
    'use strict';

    function create(deps) {
        const deps_ = deps || {};
        const layout = deps_.layout;
        const story = deps_.story;
        const manifestApi = deps_.manifest;
        let state = null;
        let running = false;

        function definition() {
            return {
                id: 'seaside-evening',
                title: 'Seaside Evening',
                destination: 'experiences',
                implemented: true,
                supportedPlatforms: ['desktop', 'mobile', 'vr', 'mr'],
                requiredCapabilities: [],
                optionalCapabilities: ['voice', 'xr', 'spatial-audio'],
                privacyScope: 'experiences',
                availability: function () {
                    return { ok: true, why: '' };
                },
                prepare: async function (ctx) {
                    const preset = ctx && ctx.quality === 'desktop' ? 'desktop' : 'low';
                    const built = layout.manifest(preset, {
                        passthrough: ctx && ctx.passthrough === true,
                        assetPaths: ctx && ctx.assetPaths,
                    });
                    const problems = manifestApi.validate(built);
                    if (problems.length) {
                        const error = new Error(problems.join('; '));
                        error.problems = problems;
                        throw error;
                    }
                    const loaded = await ctx.scene.load(built, ctx);
                    if (!loaded || loaded.ok === false) {
                        const error = new Error((loaded && loaded.why) || 'load-failed');
                        error.result = loaded;
                        throw error;
                    }
                    if (ctx.audio && typeof ctx.audio.startAmbience === 'function') ctx.audio.startAmbience();
                    if (ctx.audio && ctx.voice) ctx.audio.setLevels(ctx.voice);
                    if (ctx.interaction && ctx.scene.selectables) ctx.interaction.setTargets(ctx.scene.selectables());
                    return loaded;
                },
                start: async function (ctx) {
                    const saved = ctx.experienceMemory && ctx.experienceMemory.read('seaside-evening');
                    state = saved ? story.restore(saved) : story.initial();
                    running = true;
                    if (ctx.behavior) ctx.behavior.request('greet', { speaking: false });
                    if (ctx.say) ctx.say(state.line);
                    if (ctx.experienceMemory) ctx.experienceMemory.save('seaside-evening', story.persist(state));
                    return { ok: true, line: state.line };
                },
                pause: function (ctx) {
                    running = false;
                    if (ctx.scene) ctx.scene.setVisible(false);
                    if (ctx.audio) ctx.audio.setSpeaking(false);
                    return { ok: true };
                },
                resume: function (ctx) {
                    running = true;
                    if (ctx.scene) ctx.scene.setVisible(true);
                    if (ctx.behavior) ctx.behavior.request('listen', { speaking: false });
                    return { ok: true, line: state && state.line };
                },
                stop: function (ctx) {
                    running = false;
                    state = null;
                    if (ctx && ctx.audio) ctx.audio.stopAmbience();
                    return true;
                },
                status: function () {
                    return {
                        id: 'seaside-evening',
                        running: running,
                        beat: state && state.beat,
                        line: state && state.line,
                        choices: state ? story.choices(state) : [],
                        shellTouched: state ? state.shellTouched : false,
                        lanternLit: state ? state.lanternLit : false,
                        outcome: state ? state.outcome : '',
                    };
                },
                dispose: function () {
                    running = false;
                },
                choose: function (choiceId, ctx) {
                    if (!state) return { ok: false, why: 'not-started' };
                    const result = story.choose(state, choiceId);
                    if (!result.ok) return result;
                    state = result.state;
                    if (ctx && ctx.behavior) {
                        ctx.behavior.request(state.beat === 'close' ? 'relax' : 'speak', { speaking: false });
                    }
                    if (ctx && ctx.say) ctx.say(state.line);
                    if (ctx && ctx.experienceMemory) ctx.experienceMemory.save('seaside-evening', story.persist(state));
                    return { ok: true, state: state, line: state.line, choices: story.choices(state) };
                },
                interact: function (objectId, ctx) {
                    if (!state) return { ok: false, why: 'not-started' };
                    const result = story.interact(state, objectId);
                    if (!result.ok) return result;
                    if (result.exit) return { ok: true, exit: true };
                    state = result.state;
                    if (ctx && ctx.behavior) {
                        ctx.behavior.request(result.behavior || 'look_at_object', {
                            speaking: false,
                            objectId: result.objectId,
                        });
                    }
                    if (ctx && ctx.say) ctx.say(state.line);
                    if (ctx && ctx.experienceMemory) ctx.experienceMemory.save('seaside-evening', story.persist(state));
                    return { ok: true, state: state, line: state.line, choices: story.choices(state) };
                },
            };
        }

        return definition();
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_SEASIDE_EVENING = SeasideEvening;
if (typeof module !== 'undefined' && module.exports) module.exports = SeasideEvening;
