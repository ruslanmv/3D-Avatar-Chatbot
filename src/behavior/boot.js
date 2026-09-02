/**
 * boot — the one call that brings the Behavior Director up (spec v1.1 §7).
 *
 * `src/main.js` loads this file **only** when the engine is switched on, so nothing under
 * `src/behavior/` is fetched, parsed or evaluated while the flag is off. That is what makes
 * §7's "byte-for-byte today's app" claim literally true rather than approximately true, and
 * it is why the bootstrap seam is one guarded block in main.js and no script tag in
 * index.html — see docs/PATHMAP.md §4.
 *
 * This file therefore has to pull in its own dependencies. It does, in order, and it does
 * it once: a second call returns the running instance.
 *
 * Exposes: window.NEXUS_BD_BOOT (the function) and, once booted, window.NEXUS_BD.
 */
(function (global) {
    'use strict';

    /** Load order matters: validate before the registry that uses it. */
    const MODULES = [
        'src/behavior/EventBus.js',
        'src/behavior/ContextBlackboard.js',
        'src/behavior/registry/validate.js',
        // Read by AnimationRegistry at load and by PoseStudioPanel's "Publish to KB", and
        // loaded by nothing until B31 — so in a browser the global was undefined and B7's
        // publish action silently did nothing. The registry's `require()` fallback works
        // under Jest and not in the page, which is why every test passed.
        'src/behavior/registry/PosePublisher.js',
        'src/behavior/registry/AnimationRegistry.js',
        // The mode system (B7), loaded in B31. Before every consumer: `watch.js` reads the
        // together profile, `cohost.js` the play profile, `ConsentFlow` the adult one.
        'src/behavior/modes/ModeManager.js',
        'src/behavior/modes/companion.profile.js',
        'src/behavior/modes/showcase.profile.js',
        'src/behavior/modes/together.profile.js',
        // B23's reaction tiers and B28's tier ceiling. Registered like any other profile;
        // `requires` is what keeps the adult one unenterable.
        'src/behavior/modes/play.profile.js',
        'src/behavior/modes/adult.profile.js',
        'src/behavior/selector/AntiRepeatMemory.js',
        'src/behavior/selector/UtilityRanker.js',
        'src/behavior/selector/SemanticSelector.js',
        'src/behavior/mixer/PoseBuffer.js',
        'src/behavior/mixer/BoneMasks.js',
        'src/behavior/mixer/LayerMixer.js',
        'src/behavior/mixer/ProceduralLayer.js',
        'src/behavior/mixer/ClipLayer.js',
        'src/behavior/mixer/PoseLayer.js',
        'src/behavior/scheduler/TransitionRules.js',
        'src/behavior/scheduler/Scheduler.js',
        'src/behavior/adapters/LLMTagAdapter.js',
        'src/behavior/adapters/SentimentFallback.js',
        'src/behavior/adapters/SpeechAdapter.js',
        'src/behavior/adapters/IdleAdapter.js',
        'src/behavior/adapters/GazeAdapter.js',
        'src/behavior/adapters/BridgeDiscovery.js',
        'src/behavior/adapters/SessionAdapter.js',
        'src/behavior/adapters/VoiceAdapter.js',
        'src/behavior/adapters/MediaAdapter.js',
        // Together Mode's gate (B11). Loaded with the engine rather than with the first
        // activity: the consent machine has to exist before anything that wants a frame.
        'src/features/together/capture/ConsentMachine.js',
        'src/features/together/capture/CapturePipeline.js',
        'src/features/together/ui/ConsentIndicator.js',
        'src/features/together/ui/TogetherPanel.js',
        // B30. The way in. Loaded here rather than from index.html, so the feature adds no
        // script tag and the flag-off DOM is unchanged.
        'src/features/together/ui/TogetherLauncher.js',
        'src/features/together/activities/watch.js',
        'src/features/together/activities/music.js',
        'src/features/together/activities/scene-journey.js',
        'src/features/together/activities/screen-insight.js',
        // B26 holds the B15 activity above rather than describing its round trip again.
        'src/features/together/activities/copilot.js',
        // B27. The counter loads before the coach that owns one.
        'src/features/together/heuristics/RepCounter.js',
        'src/features/together/activities/coach.js',
        'src/features/together/panels/PanelRenderer.js',
        // B21 loads after the renderer it attends to: an assistant with no panel to point
        // at is a speaker puck with a face.
        'src/features/together/activities/assistant.js',
        // B22 loads after scene-journey, whose `derive` it reuses rather than writing a
        // second answer to what an overlay does to `initiative`.
        'src/features/together/activities/focus.js',
        'src/behavior/ConsentFlow.js',
        'src/features/together/heuristics/ExcitementDetector.js',
        'src/features/together/activities/cohost.js',
        // B24/B25. The recorder first: the button is the thing that keeps what it buffered.
        'src/features/clips/ClipRecorder.js',
        'src/features/clips/ShareCard.js',
        'src/features/clips/ui/ClipButton.js',
        'src/behavior/debug/PickLog.js',
        'src/behavior/debug/DebugHUD.js',
    ];

    const CONFIG_URL = 'config/behavior.config.json';
    const MANIFEST_URL = 'kb/animations.manifest.jsonl';

    let booting = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const el = document.createElement('script');
            el.src = src;
            el.async = false; // preserve order; these are classic scripts, not modules
            el.onload = () => resolve();
            el.onerror = () => reject(new Error(`failed to load ${src}`));
            document.head.appendChild(el);
        });
    }

    async function loadConfig() {
        let config;
        try {
            const response = await fetch(CONFIG_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            config = await response.json();
        } catch (error) {
            console.warn('[BD] no behavior config — using built-in defaults', error);
            config = { behaviorEngine: { enabled: true, debug: false }, nsfwAllowed: false };
        }
        return { ...config, session: await sessionSettings(config.session) };
    }

    /**
     * The shipped config's `session` block is the default, and the settings panel is the
     * override (batch B9). Both flags off unless the user filled in a URL and ticked the
     * box: `session.enabled` in the JSON stays false, so an unconfigured install opens no
     * socket even with the engine on.
     */
    async function sessionSettings(shipped = {}) {
        let url = '';
        let enabled = false;
        let auto = true;
        try {
            url = (global.localStorage.getItem('nexus_bd_session_url') || '').trim();
            enabled = global.localStorage.getItem('nexus_bd_session_enabled') === 'true';
            // The manual path is opt-in and survives: B35 hid the fields, it did not remove
            // the ability to point at a HomePilot directly. An install that filled the box in
            // keeps working, and a developer can still aim at a box on their bench.
            auto = global.localStorage.getItem('nexus_bd_session_auto') !== 'false';
        } catch {
            /* storage disabled: the session stays off, which is the default */
        }

        // A typed URL wins. It is the more specific instruction, and a discovery that
        // silently overrode it would make the override useless exactly when it is needed.
        if (url) return { ...shipped, url, enabled, source: 'manual' };
        if (!auto) return { ...shipped, enabled: false, source: 'off' };

        // Otherwise ask the bridge. `discover` never rejects — a bridge that is down is a
        // `false`, so this cannot be the thing that stops the engine from booting.
        const discovery = global.NEXUS_BD_BRIDGE_DISCOVERY;
        if (!discovery) return { ...shipped, enabled: false, source: 'off' };
        const found = await discovery.discover();
        if (!found.available) return { ...shipped, enabled: false, source: found.reason };
        return {
            ...shipped,
            url: found.sessionUrl,
            auth: found.auth,
            enabled: true,
            source: 'bridge',
            features: found.features,
        };
    }

    /**
     * Bring the engine up. Idempotent: concurrent or repeated calls share one boot.
     *
     * @param {object} [options]
     * @param {string} [options.manifestUrl]
     * @returns {Promise<object>} the director handle main.js keeps on `window.NEXUS_BD`
     */
    function bootBehavior(options = {}) {
        if (booting) return booting;

        booting = (async () => {
            const started = (global.performance || Date).now();

            for (const src of MODULES) await loadScript(src);
            const config = await loadConfig();

            const EventBus = global.NEXUS_BD_EVENT_BUS;
            const Blackboard = global.NEXUS_BD_BLACKBOARD;
            const Registry = global.NEXUS_BD_REGISTRY;
            if (!EventBus || !Blackboard || !Registry) throw new Error('[BD] modules failed to publish');

            const debug = Boolean(config.behaviorEngine && config.behaviorEngine.debug) || hasDebugParam();
            const bus = new EventBus({ debug });
            const blackboard = new Blackboard({
                nsfwAllowed: Boolean(config.nsfwAllowed) && isSpicyUnlocked(),
            });
            const registry = new Registry();
            await registry.load(options.manifestUrl || MANIFEST_URL);

            // Tier 1 (B5). The vocabulary is small; the vectors are rebuilt from the
            // manifest already in memory rather than downloading 2.3 MB of mostly zeros.
            const selector = new global.NEXUS_BD_SELECTOR.Selector();
            await selector.loadVocabulary();
            selector.index(registry.records);

            const antiRepeat = new global.NEXUS_BD_ANTI_REPEAT(config.antiRepeatWindow || 5);
            const ranker = new global.NEXUS_BD_RANKER.Ranker({ weights: config.weights, antiRepeat });

            // Tier 0 (B6). Two clip slots so a handover is a crossfade rather than a cut,
            // and a head layer above them so lipsync and look-at survive a full-body clip.
            const humanoid = options.humanoid || currentHumanoid();
            const mixer = new global.NEXUS_BD_LAYER_MIXER.Mixer({
                applyBone: makeBoneWriter(humanoid),
            });
            mixer.addLayer({ name: 'procedural', mask: 'fullBody', order: 0, weight: 1 });
            mixer.addLayer({ name: 'clipA', mask: 'fullBody', order: 1, weight: 0 });
            mixer.addLayer({ name: 'clipB', mask: 'fullBody', order: 2, weight: 0 });
            mixer.addLayer({ name: 'head', mask: 'head', order: 3, weight: 1 });

            const scheduler = new global.NEXUS_BD_SCHEDULER.ClipScheduler({
                mixer,
                bus,
                antiRepeat,
                // The single-owner rule: the engine asks the resolver, it never writes clips.
                resolver: global.NEXUS_ANIMATION_RESOLVER || null,
            });

            const director = {
                version: 1,
                config,
                bus,
                blackboard,
                registry,
                selector,
                ranker,
                antiRepeat,
                mixer,
                scheduler,
                lastPick: null,
                pickLog: null,
                hud: null,
                adapters: [],
                session: null,
                voice: null,
                media: null,
                watch: null,
                music: null,
                journey: null,
                insight: null,
                panels: null,
                assistant: null,
                focus: null,
                cohost: null,
                clips: null,
                clipButton: null,
                copilot: null,
                coach: null,
                adult: null,
                modes: null,
                consent: null,
                consentIndicator: null,
                togetherPanel: null,
                togetherLauncher: null,

                /**
                 * Tier 1, on every intent: narrow by declared intent, rank, pick. The gates
                 * are the ranker's alone (§6.5) — nothing here filters candidates first.
                 */
                handleIntent(intent) {
                    if (!intent || !intent.name) return null;
                    const candidates = selector.topK(intent, registry, config.topK || 3);
                    const picked = ranker.best(candidates, intent, blackboard);
                    // Recorded before the early return, because "she did nothing" is the
                    // hardest behaviour to debug and the one most worth a reason (B19).
                    if (this.pickLog) this.pickLog.record(intent, picked, blackboard.snapshot());
                    if (!picked) return null;

                    blackboard.resetTimer('sinceIntent');
                    this.lastPick = { ...picked, intent, at: Date.now() };
                    this.scheduler.request(picked.clip, intent);
                    return picked;
                },

                /**
                 * Ask for the microphone (B10). A user action, never a boot step: consent
                 * is the whole point, and an engine that grabs the mic on load is one
                 * nobody should switch on. Resolves to 'listening' or 'unavailable' —
                 * declining is an answer, not a failure, and nothing else changes either way.
                 */
                async enableVoice() {
                    if (!this.voice) return 'unavailable';
                    return this.voice.enable();
                },

                /** Tier 0. Called from the render loop; must stay cheap and never throw. */
                update(dt) {
                    blackboard.tick(dt);
                    scheduler.tick(dt);
                    // The running activity writes the head layer, so it runs *before* the
                    // blend. After it, joint attention would be one frame stale — which is
                    // exactly the lag that makes an avatar's gaze feel wrong.
                    if (this.watch && this.watch.video) this.watch.update();
                    if (this.music && this.music.running) this.music.update();
                    if (this.journey && this.journey.active) this.journey.update();
                    mixer.update();
                    // Two adapters are polled rather than event-driven; see their headers.
                    for (const adapter of this.adapters) {
                        if (adapter.tick) adapter.tick();
                    }
                },

                /** Undo everything: adapters unsubscribe, listeners go, the global clears. */
                teardown() {
                    for (const adapter of this.adapters.splice(0)) {
                        try {
                            adapter.detach?.();
                        } catch (error) {
                            console.warn('[BD] adapter failed to detach', error);
                        }
                    }
                    bus.clear();
                    if (global.NEXUS_BD === director) global.NEXUS_BD = undefined;
                    booting = null;
                },

                stats() {
                    return {
                        registry: registry.countsByKind(),
                        tier1: { ready: selector.ready, vocabulary: selector.column.size },
                        scheduler: scheduler.state,
                        layers: mixer.activeLayers(),
                        lastPick: director.lastPick && {
                            id: director.lastPick.clip.id,
                            score: director.lastPick.score,
                        },
                        blackboard: blackboard.snapshot(),
                        bus: bus.stats(),
                        adapters: this.adapters.map((a) => a.name),
                        session: director.session && director.session.stats,
                        voice: director.voice && director.voice.stats,
                        consent: director.consent && director.consent.snapshot(),
                        journey: director.journey && director.journey.stats,
                        indicator: director.consentIndicator && director.consentIndicator.stats,
                        pickLog: director.pickLog && director.pickLog.stats,
                        panels: director.panels && director.panels.stats,
                        togetherLauncher: director.togetherLauncher && director.togetherLauncher.stats,
                        assistant: director.assistant && director.assistant.stats,
                        focus: director.focus && director.focus.stats,
                        cohost: director.cohost && director.cohost.stats,
                        clips: director.clips && director.clips.stats,
                        clipButton: director.clipButton && director.clipButton.stats,
                        copilot: director.copilot && director.copilot.stats,
                        coach: director.coach && director.coach.stats,
                        adult: director.adult && director.adult.stats,
                        mode: director.modes && director.modes.activeId,
                    };
                },
            };

            // Panels (B20). Built before the session adapter, which is handed it — a
            // `display` arriving at a client with no renderer is ignored cleanly, and this
            // is the client that has one.
            if (global.NEXUS_BD_PANEL_RENDERER) {
                director.panels = global.NEXUS_BD_PANEL_RENDERER.attach({ bus });
                director.adapters.push(director.panels);

                // B21. Attention only: it draws nothing, says nothing, and cannot act. The
                // brief's panel and sentence both arrive as protocol frames the session
                // adapter already handles.
                if (global.NEXUS_BD_ASSISTANT) {
                    director.assistant = global.NEXUS_BD_ASSISTANT.attach({ bus, blackboard, panels: director.panels });
                    director.adapters.push(director.assistant);
                }
            }

            // Sense (B4). Each adapter wires itself and hands back a detach; the order is
            // only significant for the tag adapter, which must wrap NEXUS_MOTION before the
            // first reply streams.
            // The session adapter (B9) is last: it is the only one that can be handed an
            // intent by something other than this device, and it should not be able to do
            // that before the local senses are wired. Its own `attach` is a no-op while
            // `session.enabled` is false, which is how it ships.
            // Modes (B7, wired in B31). Registered and companion activated *before* any
            // adapter ticks, so `blackboard.mode` is a real profile from the first frame
            // rather than `undefined` — which is what it had been at runtime since B7,
            // leaving the ranker with nothing to narrow against and `watch.js` holding a
            // null profile. `adult` is registered like any other; `requires` is what keeps
            // it unenterable, and ModeManager is the second check §16.3 asks for.
            if (global.NEXUS_BD_MODE_MANAGER) {
                director.modes = new global.NEXUS_BD_MODE_MANAGER.Manager({ blackboard, bus, registry });
                for (const profile of [
                    global.NEXUS_BD_PROFILE_COMPANION,
                    global.NEXUS_BD_PROFILE_TOGETHER,
                    global.NEXUS_BD_PROFILE_SHOWCASE,
                    global.NEXUS_BD_PROFILE_PLAY,
                    global.NEXUS_BD_PROFILE_ADULT,
                ]) {
                    if (profile) director.modes.register(profile);
                }
                // Companion is what she already was; naming it is what makes returning to
                // it exact rather than approximate (§4A).
                director.modes.activate('companion');
            }

            const wiring = [
                ['tag', global.NEXUS_BD_TAG_ADAPTER],
                ['sentiment', global.NEXUS_BD_SENTIMENT_FALLBACK],
                ['speech', global.NEXUS_BD_SPEECH_ADAPTER],
                ['idle', global.NEXUS_BD_IDLE_ADAPTER],
                ['gaze', global.NEXUS_BD_GAZE_ADAPTER],
                [
                    'session',
                    global.NEXUS_BD_SESSION_ADAPTER,
                    () => ({ say: global.NEXUS_BD_SAY, panels: director.panels }),
                ],
                // The voice adapter needs the session that was just built, so its extra
                // deps are a thunk rather than a literal. It asks for no microphone here;
                // that waits for `director.enableVoice()`.
                ['voice', global.NEXUS_BD_VOICE_ADAPTER, () => ({ session: director.session })],
                ['media', global.NEXUS_BD_MEDIA_ADAPTER],
            ];
            for (const [label, module, extra] of wiring) {
                if (!module || typeof module.attach !== 'function') continue;
                try {
                    const adapter = module.attach({ bus, blackboard, config, ...(extra ? extra() : {}) });
                    director.adapters.push(adapter);
                    if (label === 'session') director.session = adapter;
                    if (label === 'voice') director.voice = adapter;
                    if (label === 'media') director.media = adapter;
                } catch (error) {
                    console.warn(`[BD] ${label} adapter failed to attach — continuing without it`, error);
                }
            }

            // Consent (B11). The indicator subscribes here and not in a consumer, because
            // an indicator a consumer can forget to mount is an indicator that lies.
            if (global.NEXUS_BD_CONSENT) {
                director.consent = new global.NEXUS_BD_CONSENT.Machine({ config });
                director.consentIndicator = global.NEXUS_BD_CONSENT_INDICATOR.attach({
                    consent: director.consent,
                });
                director.togetherPanel = global.NEXUS_BD_TOGETHER_PANEL.attach({
                    consent: director.consent,
                    config,
                });
                director.adapters.push(director.consentIndicator, director.togetherPanel);

                // B30. One pill in the avatar toolbar and one drawer entry — injected, not
                // marked up, so `index.html` is untouched. It starts nothing: opening the
                // chooser is not consent to anything on it.
                if (global.NEXUS_BD_TOGETHER_LAUNCHER) {
                    director.togetherLauncher = global.NEXUS_BD_TOGETHER_LAUNCHER.attach({
                        panel: director.togetherPanel,
                        panels: director.panels,
                    });
                    director.adapters.push(director.togetherLauncher);
                }

                // Watch Together (B12). Registered into the panel rather than started:
                // an activity that mounts a cinema screen the moment the engine boots is
                // not an activity, it is a takeover.
                if (global.NEXUS_BD_WATCH) {
                    director.watch = global.NEXUS_BD_WATCH.attach({
                        bus,
                        blackboard,
                        mixer,
                        consent: director.consent,
                        config,
                        profile: global.NEXUS_BD_PROFILE_TOGETHER,
                        media: director.media,
                    });
                    director.togetherPanel.register(director.watch);
                    director.adapters.push(director.watch);
                }

                // Listen Together (B13). Also registered rather than started; its analyser
                // arrives with a track, not with the engine.
                if (global.NEXUS_BD_MUSIC) {
                    director.music = global.NEXUS_BD_MUSIC.attach({ bus, blackboard, scheduler, config });
                    director.togetherPanel.register(director.music);
                    director.adapters.push(director.music);
                }

                // Journeys (B14). Shares the watch activity's commentary gate rather than
                // building a second one — a scene overlay changes which openings are in
                // force, and two gates would disagree about that within a frame.
                if (global.NEXUS_BD_JOURNEY) {
                    director.journey = global.NEXUS_BD_JOURNEY.attach({
                        bus,
                        blackboard,
                        gate: director.watch && director.watch.gate,
                    });
                    global.NEXUS_BD_JOURNEY.loadManifests(director.journey).catch(() => {});
                    director.togetherPanel.register(director.journey);
                    director.adapters.push(director.journey);
                }

                // Screen Insight (B15). On demand by default: registered, never started,
                // and its continuous mode is off until somebody deliberately turns it on.
                if (global.NEXUS_BD_SCREEN_INSIGHT) {
                    const url = config.session && config.session.url;
                    director.insight = global.NEXUS_BD_SCREEN_INSIGHT.attach({
                        bus,
                        blackboard,
                        consent: director.consent,
                        config,
                        session: director.session,
                        endpoint: url
                            ? global.NEXUS_BD_SCREEN_INSIGHT.httpEndpoint(
                                  url.replace(/^ws/, 'http').replace(/\/avatar\/session$/, '/avatar/vision/insight')
                              )
                            : null,
                    });
                    director.togetherPanel.register(director.insight);
                    director.adapters.push(director.insight);

                    // Hands-busy copilot (B26). It holds the insight activity rather than
                    // building a second pipeline, so B11's consent machine stays the only
                    // door to a camera and its indicator lights up without the copilot
                    // knowing the indicator exists.
                    if (global.NEXUS_BD_COPILOT) {
                        director.copilot = global.NEXUS_BD_COPILOT.attach({
                            bus,
                            blackboard,
                            config,
                            insight: director.insight,
                            say: (text, options) => global.NEXUS_BD_SAY && global.NEXUS_BD_SAY(text, options),
                        });
                        director.togetherPanel.register(director.copilot);
                        director.adapters.push(director.copilot);
                    }

                    // Coach (B27). The heaviest activity here: Pose joins the MediaPipe
                    // loader FaceTracker and HandTracker already fill, and its overlay
                    // declines idle-class clips through §6.5's one gate while it runs.
                    if (global.NEXUS_BD_COACH) {
                        director.coach = global.NEXUS_BD_COACH.attach({
                            bus,
                            blackboard,
                            registry,
                            insight: director.insight,
                            gate: director.watch && director.watch.gate,
                            say: (text, options) => global.NEXUS_BD_SAY && global.NEXUS_BD_SAY(text, options),
                        });
                        director.togetherPanel.register(director.coach);
                        director.adapters.push(director.coach);
                    }
                }

                // B22. Body doubling: the quiet profile and the pomodoro clock. It takes
                // the same gate B14 does, and refuses to start a block without an overlay
                // function — a focus session it cannot keep quiet is worse than none.
                if (global.NEXUS_BD_FOCUS) {
                    director.focus = global.NEXUS_BD_FOCUS.attach({
                        bus,
                        blackboard,
                        config,
                        gate: director.watch && director.watch.gate,
                        session: director.session,
                    });
                    director.togetherPanel.register(director.focus);
                    director.adapters.push(director.focus);
                }

                // Gaming co-host (B23). Registered, never started: she watches a game
                // because somebody asked her to. The detector reads the media adapter's
                // scalars, so it inherits B11's consent gating rather than adding a second
                // pixel reader to audit.
                if (global.NEXUS_BD_COHOST) {
                    director.cohost = global.NEXUS_BD_COHOST.attach({
                        bus,
                        blackboard,
                        gate: director.watch && director.watch.gate,
                        media: director.media,
                        profile: global.NEXUS_BD_PROFILE_PLAY,
                    });
                    director.togetherPanel.register(director.cohost);
                    director.adapters.push(director.cohost);
                }

                // Clips (B24, B25). Attached, not started: the ring buffer begins when an
                // activity does, so an idle session holds no video. The button tears the
                // recorder down — not merely hides itself — when the adult tier is active.
                if (global.NEXUS_BD_CLIP_RECORDER && config.clips && config.clips.enabled) {
                    director.clips = global.NEXUS_BD_CLIP_RECORDER.attach({ bus });
                    director.adapters.push(director.clips);

                    if (global.NEXUS_BD_CLIP_BUTTON) {
                        director.clipButton = global.NEXUS_BD_CLIP_BUTTON.attach({
                            bus,
                            blackboard,
                            config,
                            recorder: director.clips,
                            cards: global.NEXUS_BD_SHARE_CARD && global.NEXUS_BD_SHARE_CARD.attach({}),
                        });
                        director.adapters.push(director.clipButton);
                    }
                }
            }

            // The adult tier (B28, B29). `adult.available` is a third independent flag and
            // ships false; with it off the flow is not constructed at all, so the tier is
            // unactivatable rather than merely unadvertised. Even with it on, `enter()`
            // refuses until the server's attestation has landed on the blackboard, and the
            // ranker re-checks all three gates on every single selection.
            if (config.adult && config.adult.available && global.NEXUS_BD_CONSENT_FLOW) {
                director.adult = global.NEXUS_BD_CONSENT_FLOW.attach({
                    bus,
                    blackboard,
                    // Without this the hard exit's `modes.activate('companion')` sat behind
                    // a null guard and did nothing — B29's own acceptance criterion, unmet
                    // at runtime until the manager existed.
                    modes: director.modes,
                    profile: global.NEXUS_BD_PROFILE_ADULT,
                    recorder: director.clips,
                    say: (text, options) => global.NEXUS_BD_SAY && global.NEXUS_BD_SAY(text, options),
                });
                director.adapters.push(director.adult);
            }

            // QA instrumentation (B19). The log costs one boolean per pick while off; the
            // HUD is not attached at all unless ?behaviorDebug=1 or behaviorEngine.debug.
            if (global.NEXUS_BD_PICK_LOG) {
                director.pickLog = global.NEXUS_BD_PICK_LOG.attach({ enabled: debug });
            }
            if (debug && global.NEXUS_BD_HUD && global.NEXUS_BD_HUD.requested(config)) {
                director.hud = global.NEXUS_BD_HUD.attach({ director });
                director.hud.mount();
                director.adapters.push(director.hud);
            }

            bus.on('intent', (intent) => director.handleIntent(intent));

            global.NEXUS_BD = director;

            const ms = Math.round((global.performance || Date).now() - started);
            const names = director.adapters.map((a) => a.name).join(', ') || 'none';
            console.log(`[BD] Behavior Director up in ${ms}ms — ${registry.summary()}`);
            console.log(`[BD] adapters: ${names}`);
            if (debug) console.log('[BD] counts by kind', registry.countsByKind());

            return director;
        })();

        booting.catch((error) => {
            console.warn('[BD] boot failed — the app continues without the engine', error);
            booting = null;
        });

        return booting;
    }

    /** The VRM humanoid, if an avatar is loaded. Absent is survivable: the mixer no-ops. */
    function currentHumanoid() {
        try {
            return global.NEXUS_VRM?.humanoid || global.currentVRM?.humanoid || null;
        } catch {
            return null;
        }
    }

    /**
     * The one write per bone per frame (§6.6). Everything above this produces buffers; this
     * is the only place a rotation reaches the rig.
     */
    function makeBoneWriter(humanoid) {
        if (!humanoid) return null;
        return (bone, q) => {
            try {
                const node = humanoid.getNormalizedBoneNode(bone);
                if (node) node.quaternion.set(q[0], q[1], q[2], q[3]);
            } catch {
                /* a bone this avatar does not have */
            }
        };
    }

    function hasDebugParam() {
        try {
            return new URLSearchParams(global.location.search).get('behaviorDebug') === '1';
        } catch {
            return false;
        }
    }

    /**
     * The NSFW gate has one authority and it is not this one. SpicyGate already owns the
     * age check and the user's choice; the blackboard only mirrors it (§6.5).
     */
    function isSpicyUnlocked() {
        try {
            return Boolean(global.NEXUS_SPICY && global.NEXUS_SPICY.isEnabled());
        } catch {
            return false;
        }
    }

    global.NEXUS_BD_BOOT = bootBehavior;
    /* Test seam: the settings overlay decides whether a socket is ever opened, and that is
       worth asserting without standing up the whole engine. */
    global.NEXUS_BD_BOOT.sessionSettings = sessionSettings;
})(typeof window !== 'undefined' ? window : globalThis);
