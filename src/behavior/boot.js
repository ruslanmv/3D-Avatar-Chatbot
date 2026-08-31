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
        'src/behavior/registry/AnimationRegistry.js',
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
        'src/behavior/adapters/SessionAdapter.js',
        'src/behavior/adapters/VoiceAdapter.js',
        'src/behavior/adapters/MediaAdapter.js',
        // Together Mode's gate (B11). Loaded with the engine rather than with the first
        // activity: the consent machine has to exist before anything that wants a frame.
        'src/features/together/capture/ConsentMachine.js',
        'src/features/together/capture/CapturePipeline.js',
        'src/features/together/ui/ConsentIndicator.js',
        'src/features/together/ui/TogetherPanel.js',
        'src/features/together/activities/watch.js',
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
        return { ...config, session: sessionSettings(config.session) };
    }

    /**
     * The shipped config's `session` block is the default, and the settings panel is the
     * override (batch B9). Both flags off unless the user filled in a URL and ticked the
     * box: `session.enabled` in the JSON stays false, so an unconfigured install opens no
     * socket even with the engine on.
     */
    function sessionSettings(shipped = {}) {
        let url = '';
        let enabled = false;
        try {
            url = (global.localStorage.getItem('nexus_bd_session_url') || '').trim();
            enabled = global.localStorage.getItem('nexus_bd_session_enabled') === 'true';
        } catch {
            /* storage disabled: the session stays off, which is the default */
        }
        if (!url) return { ...shipped, enabled: false };
        return { ...shipped, url, enabled };
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
                adapters: [],
                session: null,
                voice: null,
                media: null,
                watch: null,
                consent: null,
                consentIndicator: null,
                togetherPanel: null,

                /**
                 * Tier 1, on every intent: narrow by declared intent, rank, pick. The gates
                 * are the ranker's alone (§6.5) — nothing here filters candidates first.
                 */
                handleIntent(intent) {
                    if (!intent || !intent.name) return null;
                    const candidates = selector.topK(intent, registry, config.topK || 3);
                    const picked = ranker.best(candidates, intent, blackboard);
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
                        indicator: director.consentIndicator && director.consentIndicator.stats,
                    };
                },
            };

            // Sense (B4). Each adapter wires itself and hands back a detach; the order is
            // only significant for the tag adapter, which must wrap NEXUS_MOTION before the
            // first reply streams.
            // The session adapter (B9) is last: it is the only one that can be handed an
            // intent by something other than this device, and it should not be able to do
            // that before the local senses are wired. Its own `attach` is a no-op while
            // `session.enabled` is false, which is how it ships.
            const wiring = [
                ['tag', global.NEXUS_BD_TAG_ADAPTER],
                ['sentiment', global.NEXUS_BD_SENTIMENT_FALLBACK],
                ['speech', global.NEXUS_BD_SPEECH_ADAPTER],
                ['idle', global.NEXUS_BD_IDLE_ADAPTER],
                ['gaze', global.NEXUS_BD_GAZE_ADAPTER],
                ['session', global.NEXUS_BD_SESSION_ADAPTER, () => ({ say: global.NEXUS_BD_SAY })],
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
