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
        'src/behavior/adapters/LLMTagAdapter.js',
        'src/behavior/adapters/SentimentFallback.js',
        'src/behavior/adapters/SpeechAdapter.js',
        'src/behavior/adapters/IdleAdapter.js',
        'src/behavior/adapters/GazeAdapter.js',
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
        try {
            const response = await fetch(CONFIG_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn('[BD] no behavior config — using built-in defaults', error);
            return { behaviorEngine: { enabled: true, debug: false }, nsfwAllowed: false };
        }
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

            const director = {
                version: 1,
                config,
                bus,
                blackboard,
                registry,
                adapters: [],

                /** Tier 0. Called from the render loop; must stay cheap and never throw. */
                update(dt) {
                    blackboard.tick(dt);
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
                        blackboard: blackboard.snapshot(),
                        bus: bus.stats(),
                        adapters: this.adapters.map((a) => a.name),
                    };
                },
            };

            // Sense (B4). Each adapter wires itself and hands back a detach; the order is
            // only significant for the tag adapter, which must wrap NEXUS_MOTION before the
            // first reply streams.
            const wiring = [
                ['tag', global.NEXUS_BD_TAG_ADAPTER],
                ['sentiment', global.NEXUS_BD_SENTIMENT_FALLBACK],
                ['speech', global.NEXUS_BD_SPEECH_ADAPTER],
                ['idle', global.NEXUS_BD_IDLE_ADAPTER],
                ['gaze', global.NEXUS_BD_GAZE_ADAPTER],
            ];
            for (const [label, module] of wiring) {
                if (!module || typeof module.attach !== 'function') continue;
                try {
                    director.adapters.push(module.attach({ bus, blackboard, config }));
                } catch (error) {
                    console.warn(`[BD] ${label} adapter failed to attach — continuing without it`, error);
                }
            }

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
})(typeof window !== 'undefined' ? window : globalThis);
