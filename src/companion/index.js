/**
 * Companion facade — the one attach boot calls (IC1).
 *
 * Builds the session, the memory scopes, the experience director and the
 * destination bar, and publishes `NEXUS_EXPERIENCE_RUNTIME` for the render
 * loop. The loop already exists. This file only gives it a function to call.
 *
 * `systemPromptSuffix` stays empty until the person uses a destination, so a
 * page that never opens the bar sends the prompt it sent before.
 *
 * Exposes: window.NEXUS_COMPANION and window.NEXUS_EXPERIENCE_RUNTIME
 */
(function (global) {
    'use strict';

    /**
     * IC2. The person never has to say "switch to Copilot". At prompt time, before the
     * context is read, the latest user message is checked once (locally, no model call)
     * for a clear move — "I'm tired" to Life, "help me finish my report" to Copilot, "let's
     * go somewhere peaceful" to Experiences. No clear move: the context stays as it was. A
     * Together activity that is running (a focus block, Seaside) is not replaced by a remark.
     */
    let lastSeen = null;
    function noticeTopic(session) {
        const Intent = global.NEXUS_COMPANION_INTENT;
        const history = global.chatHistory;
        if (!Intent || !history || typeof history.getHistory !== 'function') return;
        let list = [];
        try {
            list = history.getHistory() || [];
        } catch (_) {
            return;
        }
        let latest = null;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i] && list[i].role === 'user') {
                latest = list[i];
                break;
            }
        }
        if (!latest || latest === lastSeen) return;
        lastSeen = latest;
        // LW3–LW5. The person's own turn moves you within a place ("andiamo in cucina"), answers a
        // pending trip ("sì") or asks for another place. Their words only — never her reply.
        const live = global.__NEXUS_COMPANION_LIVE;
        if (live && live.presence && typeof live.presence.observeUser === 'function') {
            try {
                live.presence.observeUser(typeof latest.content === 'string' ? latest.content : '');
            } catch (error) {
                console.warn('[Companion] world presence could not read the turn — continuing', error);
            }
        }
        // PW. The private room's own presence: it acts only while its gate holds (and the public
        // one above refuses every private world), so exactly one of the two answers a turn.
        if (live && live.privateWorld && typeof live.privateWorld.observeUser === 'function') {
            try {
                live.privateWorld.observeUser(typeof latest.content === 'string' ? latest.content : '');
            } catch (error) {
                console.warn('[Companion] private world could not read the turn — continuing', error);
            }
        }
        // LW1: spatial presence is independent of a conversational topic. In particular,
        // a place entered from conversation must not vanish when the topic changes.
        if (session.active() && /^place-[a-z0-9-]+$/.test(String(session.activity() || ''))) return;
        const Marks = global.NEXUS_COMPANION_MARKS;
        const running =
            session.active() &&
            session.source() === 'together' &&
            Marks &&
            (Marks.isExplicit
                ? Marks.isExplicit(session.activity())
                : Marks.EXPLICIT.indexOf(session.activity()) !== -1);
        if (running) return;
        const found = Intent.classify(typeof latest.content === 'string' ? latest.content : '');
        if (!found) return;
        if (session.active() && session.destination() === found.destination && session.activity() === found.activity)
            return;
        session.enter(found.destination, found.activity, { source: 'conversation' });
    }

    function contextSuffix() {
        const sessionApi = global.NEXUS_COMPANION_SESSION;
        const memoryApi = global.NEXUS_COMPANION_MEMORY;
        const prompt = global.NEXUS_COMPANION_PROMPT;
        const gateApi = global.NEXUS_COMPANION_PRIVACY;
        if (!sessionApi || !memoryApi || !prompt || !global.__NEXUS_COMPANION_LIVE) return '';
        const live = global.__NEXUS_COMPANION_LIVE;
        noticeTopic(live.session);
        if (!live.session.customized()) return '';
        const destination = live.session.destination();
        const gate = gateApi.create({
            spicyEnabled: function () {
                try {
                    return Boolean(global.NEXUS_SPICY && global.NEXUS_SPICY.isEnabled());
                } catch (_) {
                    return false;
                }
            },
        });
        // IC2. A destination ended in the chat ("End") sends the prompt it sent before.
        if (typeof live.session.active === 'function' && !live.session.active()) return '';
        const input = {
            customized: true,
            active: true,
            destination: destination,
            activity: typeof live.session.activity === 'function' ? live.session.activity() : null,
        };
        // LW3. Where you are, verified, and the one way she may ask to move. WorldPresence leaves
        // romantic spots and other places out for Copilot, and everything out in a private room.
        try {
            if (live.presence) {
                const here = live.presence.promptSuffix(destination);
                if (here) input.presence = here;
                const offer = live.presence.goOffer(destination);
                if (offer) input.goOffer = offer;
            }
            // PW. A private room's paragraph is not added here: it belongs to Private's own prompt
            // (TogetherCapability's private suffix → NEXUS_PRIVATE_WORLD.promptChunk), so it can
            // never reach a Life, Experiences or Copilot prompt.
        } catch (_) {
            /* the prompt goes without it */
        }
        if (destination === 'copilot') {
            const allowed = gate.allows('copilot', 'copilot', live.session.grants());
            input.tasks = allowed.ok ? (live.memory.read('copilot') || {}).tasks || [] : [];
            if (gate.allows('copilot', 'life', live.session.grants()).ok) {
                /* An explicit grant still does not put relationship enums into Copilot.
                   Tasks are the work. Life text stays out of this paragraph on purpose. */
            }
        } else {
            const life = live.memory.read('life') || { memories: [], relationship: null };
            input.relationship = life.relationship;
            input.memories = life.memories || [];
            // PG3. What is true about the place she is in, verified by its owners. Never for
            // Copilot (this branch) and never anything from a private room.
            try {
                const situation = live.reactive && live.reactive.promptSuffix ? live.reactive.promptSuffix() : '';
                if (situation) input.situation = situation;
                const offer = live.reactive && live.reactive.plannerOffer ? live.reactive.plannerOffer() : '';
                if (offer) input.gestureOffer = offer;
            } catch (_) {
                /* the prompt goes without it */
            }
            const detail = live.director && live.director.status();
            if (detail && detail.detail && detail.detail.line) {
                const id = detail.detail.id || 'seaside-evening';
                input.experienceLine =
                    id +
                    (detail.status === 'paused' ? ' (paused)' : '') +
                    (detail.detail.beat ? ', scene: ' + detail.detail.beat : '');
            }
        }
        return prompt.suffix(input);
    }

    function togetherOn() {
        try {
            const sw = global.NEXUS_TOGETHER_SWITCH;
            return Boolean(sw && typeof sw.isOn === 'function' && sw.isOn());
        } catch (_) {
            return false;
        }
    }

    function panelOf() {
        const live = global.__NEXUS_COMPANION_LIVE;
        return (live && live.panel && live.panel()) || (global.NEXUS_BD && global.NEXUS_BD.togetherPanel) || null;
    }

    /**
     * What all three prompt sites append: what is going on now (empty until there is
     * something), then — IC3 — how she can start an activity herself, only while Together is on.
     */
    function suffix() {
        const Directive = global.NEXUS_COMPANION_DIRECTIVE;
        const tags =
            Directive && global.__NEXUS_COMPANION_LIVE
                ? Directive.systemPromptSuffix(
                      togetherOn() && !!panelOf(),
                      global.__NEXUS_COMPANION_LIVE.session.active() &&
                          /^place-[a-z0-9-]+$/.test(String(global.__NEXUS_COMPANION_LIVE.session.activity() || ''))
                  )
                : '';
        return contextSuffix() + tags;
    }

    /** IC3. Her reply, with an `<activity>` tag taken out and run. Replies only — main.js's displayText seam. */
    function consume(text) {
        const Directive = global.NEXUS_COMPANION_DIRECTIVE;
        const live = global.__NEXUS_COMPANION_LIVE;
        // PG3. The gesture planner's tag comes out here too — the one seam that covers the
        // bubble, the transcript, the VR forward and TTS — and is only a proposal after that.
        const afterGesture =
            live && live.reactive && typeof live.reactive.consumeReply === 'function'
                ? live.reactive.consumeReply(text)
                : String(text == null ? '' : text).replace(/<\s*gesture\b[^>]*\/?>(?:\s*<\s*\/\s*gesture\s*>)?/gi, '');
        // LW3–LW5. <go spot/> and <go place/> come out here too; each is a proposal the presence
        // layer checks against the person's own turn and the verified spots, never permission.
        // PW. The private room first: it strips <act/> always, and acts only while its gate holds.
        const afterPrivate =
            live && live.privateWorld && typeof live.privateWorld.consumeReply === 'function'
                ? live.privateWorld.consumeReply(afterGesture)
                : String(afterGesture).replace(/<\s*act\b[^>]*\/?>(?:\s*<\s*\/\s*act\s*>)?/gi, '');
        const afterGo =
            live && live.presence && typeof live.presence.consumeReply === 'function'
                ? live.presence.consumeReply(afterPrivate)
                : String(afterPrivate).replace(/<\s*go\b[^>]*\/?>(?:\s*<\s*\/\s*go\s*>)?/gi, '');
        if (!Directive || !live) return afterGo;
        return Directive.consume(afterGo, {
            session: live.session,
            director: live.director,
            panel: panelOf,
            enabled: togetherOn,
            // LW4. Inside a place, relax / focus / story change her manner here, not the world.
            inPlace: function (name) {
                return live.presence && typeof live.presence.setMood === 'function'
                    ? live.presence.setMood(name)
                    : { ok: false, why: 'place-active' };
            },
        });
    }

    /**
     * PG3. The two actuators BehaviorRouter's face and gaze channels use. Small on purpose:
     * each writes one thing the app already exposes, keeps a token so a later writer wins,
     * and never touches the mouth shapes lip-sync drives.
     */
    function actuatorsFor(g) {
        let faceToken = 0;
        let gazeToken = 0;
        return {
            expression(emotion, intensity, ms) {
                const loader = g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager && g.NEXUS_VIEWER.avatarManager.vrmLoader;
                if (!loader || typeof loader.setEmotion !== 'function') return false;
                const mine = ++faceToken;
                loader.setEmotion(emotion, Math.max(0, Math.min(0.6, Number(intensity) || 0.3)));
                g.setTimeout(
                    () => {
                        if (mine !== faceToken) return;
                        try {
                            loader.setEmotion('neutral', 0);
                        } catch (_) {
                            /* the face settles on its own */
                        }
                    },
                    Number(ms) || 2000
                );
                return true;
            },
            gaze(point, ms) {
                const animator = g.NEXUS_PROCEDURAL_ANIMATOR;
                const xr = g.NEXUS_VIEWER && g.NEXUS_VIEWER.renderer && g.NEXUS_VIEWER.renderer.xr;
                if (!animator || typeof animator.setGazeOverride !== 'function') return false;
                if (xr && xr.isPresenting) return false; // the VR gaze controller owns her head
                const mine = ++gazeToken;
                animator.setGazeOverride({ x: point.x, y: point.y });
                g.setTimeout(
                    () => {
                        if (mine !== gazeToken) return;
                        try {
                            animator.setGazeOverride(null);
                        } catch (_) {
                            /* the animator resumes tracking on its own */
                        }
                    },
                    Number(ms) || 2500
                );
                return true;
            },
        };
    }

    function attach(options) {
        const options_ = options || {};
        const Session = global.NEXUS_COMPANION_SESSION;
        const Memory = global.NEXUS_COMPANION_MEMORY;
        const Privacy = global.NEXUS_COMPANION_PRIVACY;
        const Behavior = global.NEXUS_COMPANION_BEHAVIOR;
        const Catalog = global.NEXUS_COMPANION_CATALOG;
        const Bridge = global.NEXUS_COMPANION_BRIDGE;
        const Tasks = global.NEXUS_COMPANION_TASKS;
        const Bar = global.NEXUS_COMPANION_BAR;
        const Registry = global.NEXUS_EXPERIENCE_REGISTRY;
        const Life = global.NEXUS_EXPERIENCE_SESSION;
        const Scene = global.NEXUS_EXPERIENCE_SCENE;
        const Audio = global.NEXUS_EXPERIENCE_AUDIO;
        const Interaction = global.NEXUS_EXPERIENCE_INTERACTION;
        const Director = global.NEXUS_EXPERIENCE_DIRECTOR;
        const Formats = global.NEXUS_EXPERIENCE_FORMATS;
        const Seaside = global.NEXUS_SEASIDE_EVENING;
        const Layout = global.NEXUS_SEASIDE_LAYOUT;
        const Story = global.NEXUS_SEASIDE_STORY;
        const Manifest = global.NEXUS_EXPERIENCE_MANIFEST;
        const ExpMemory = global.NEXUS_EXPERIENCE_MEMORY;
        if (!Session || !Director || !Seaside) return null;

        const storage = options_.storage || (global.localStorage ? global.localStorage : null);
        const session = Session.create({ storage: storage });
        session.load();
        // IC3. An activity with a beginning and an end does not survive a reload — the focus
        // timer, the place and the story are gone with the old page. Bringing its context back
        // showed "Scene Tale · End" with nothing running. Conversation context stays.
        try {
            const MarksApi = global.NEXUS_COMPANION_MARKS;
            if (
                session.active() &&
                session.source() === 'together' &&
                MarksApi &&
                (MarksApi.isExplicit
                    ? MarksApi.isExplicit(session.activity())
                    : MarksApi.EXPLICIT.indexOf(session.activity()) !== -1)
            ) {
                session.end({ silent: true });
            }
        } catch (_) {
            /* a stale label is the worst case */
        }
        const memory = Memory.create({ storage: storage });
        const privacy = Privacy.create({
            spicyEnabled: function () {
                try {
                    return Boolean(global.NEXUS_SPICY && global.NEXUS_SPICY.isEnabled());
                } catch (_) {
                    return false;
                }
            },
        });
        const behavior = Behavior.create({
            director: options_.behaviorDirector || global.NEXUS_BD || null,
            // PG3. A smile is a face and a look is a gaze: the VRM expression bridge and the
            // procedural animator's gaze override, both of which already exist. Each is held for
            // a moment and handed back only if nothing else took it since; in the headset the
            // VR gaze controller owns her head, so the gaze declines and the request falls back.
            actuators: actuatorsFor(global),
        });
        const registry = Registry.create();
        const scene = Scene.create({ validate: Manifest.validate });
        const audio = Audio.create({
            createContext: function () {
                const Ctx = global.AudioContext || global.webkitAudioContext;
                return Ctx ? new Ctx() : null;
            },
        });
        let director = null;
        const interaction = Interaction.create({
            onSelect: function (id) {
                if (director) return director.interact(id);
                return { ok: false, why: 'no-director' };
            },
        });
        const experienceMemory = ExpMemory.create(memory);
        director = Director.create({
            registry: registry,
            life: Life.create(),
            scene: scene,
            audio: audio,
            interaction: interaction,
            behavior: behavior,
            session: session,
            privacy: privacy,
            experienceMemory: experienceMemory,
            bus: options_.bus || (global.NEXUS_BD && global.NEXUS_BD.bus) || null,
            say: global.NEXUS_BD_SAY || null,
            target: global,
            CustomEvent: global.CustomEvent,
            platform: function () {
                const narrow = global.matchMedia ? global.matchMedia('(max-width: 640px)').matches : false;
                let cores = 8;
                try {
                    cores = global.navigator && global.navigator.hardwareConcurrency;
                } catch (_) {
                    cores = 8;
                }
                return { xrPresenting: false, blendMode: null, narrow: narrow, cores: cores };
            },
        });
        registry.register(Seaside.create({ layout: Layout, story: Story, manifest: Manifest }));
        for (const format of Formats.STAGED) registry.register(format);

        const bridge = Bridge.create({
            panel: options_.panel || null,
            director: function () {
                return { togetherPanel: options_.panel || null };
            },
            experiences: director,
            doc: options_.doc || global.document,
            lookup: function () {
                return global.NEXUS_LOOKUP || null;
            },
            study: function () {
                return global.NEXUS_STUDY_LOOP || null;
            },
        });

        const bar = Bar.attach({
            doc: options_.doc || global.document,
            session: session,
            catalog: Catalog,
            bridge: bridge,
            director: director,
            memory: memory,
            privacy: privacy,
            tasks: Tasks,
            registry: registry,
            audio: audio,
            storage: storage,
            navEnabled: Session.navEnabled,
            focus: function () {
                const bd = global.NEXUS_BD;
                return bd && bd.focus ? bd.focus : null;
            },
            history: function () {
                const history = global.chatHistory;
                return history && history.getHistory ? history.getHistory() : [];
            },
        });

        // IC2. One quiet line in the chat when the context changes, and an End pill above
        // the composer while a real activity runs. Missing module, missing chat: the
        // destinations still work.
        const panelGetter = function () {
            return options_.panel || (global.NEXUS_BD && global.NEXUS_BD.togetherPanel) || null;
        };
        let marks = null;
        const Marks = global.NEXUS_COMPANION_MARKS;
        const Intent = global.NEXUS_COMPANION_INTENT;
        if (Marks && typeof Marks.attach === 'function') {
            try {
                marks = Marks.attach({
                    doc: options_.doc || global.document,
                    session: session,
                    director: director,
                    label: Intent && Intent.label ? Intent.label : null,
                    panel: panelGetter,
                });
            } catch (error) {
                console.warn('[Companion] activity marks failed to attach — continuing', error);
            }
        }

        // IC3. She says one line when an activity starts or ends, and her posture follows.
        let voice = null;
        const Voice = global.NEXUS_COMPANION_VOICE;
        if (Voice && typeof Voice.attach === 'function') {
            try {
                voice = Voice.attach({
                    session: session,
                    behavior: behavior,
                    label: Intent && Intent.label ? Intent.label : null,
                    panel: panelGetter,
                    global: global,
                });
            } catch (error) {
                console.warn('[Companion] activity voice failed to attach — continuing', error);
            }
        }

        // IC3. The activity and its context end together, whichever side ends it: the panel's
        // own Stop, a focus block running out, Seaside finishing or its Exit. The End pill
        // already ends both (ActivityMarks).
        const MarksApi = global.NEXUS_COMPANION_MARKS;
        const ownsPanelActivity = () =>
            session.active() &&
            session.source() === 'together' &&
            MarksApi &&
            (MarksApi.isExplicit
                ? MarksApi.isExplicit(session.activity())
                : MarksApi.EXPLICIT.indexOf(session.activity()) !== -1) &&
            session.activity() !== 'seaside';
        const STORIES = ['scene-tale', 'life-evening', 'copilot-hour'];
        const storyNotStarted = function (panel) {
            if (STORIES.indexOf(session.activity()) === -1) return false;
            const pg = panel.activities && panel.activities.get && panel.activities.get('playground');
            return !pg || !(pg.active || pg.player || pg.sessionState === 'preparing' || pg.sessionState === 'ready');
        };
        let wasActive = null;
        let offPanel = function () {};
        const watchPanel = function () {
            const panel = panelGetter();
            if (!panel || typeof panel.onChange !== 'function') return false;
            wasActive = panel.activeActivity || null;
            offPanel = panel.onChange(function (snap) {
                const now = snap ? snap.active : null;
                if (wasActive && !now && ownsPanelActivity()) session.end();
                else if (snap && snap.view === 'failure' && !now && ownsPanelActivity()) {
                    // It did not start (a blocked camera, say): no "· End" for nothing, and
                    // she does not greet an activity that is not happening.
                    session.end({ silent: true });
                } else if (snap && !snap.open && !now && ownsPanelActivity() && storyNotStarted(panel)) {
                    // The story setup was closed without starting a story.
                    session.end({ silent: true });
                }
                wasActive = now || null;
            });
            return true;
        };
        if (!watchPanel()) setTimeout(watchPanel, 0);
        // Only a real ending counts: the director reports intermediate states while it loads,
        // and ending on those dropped Seaside's context the moment it began.
        let wasRunning = false;
        const offDirector =
            typeof director.on === 'function'
                ? director.on(function () {
                      const status = director.status();
                      const running = Boolean(status && (status.status === 'active' || status.status === 'paused'));
                      if (wasRunning && !running && session.active() && session.activity() === 'seaside') session.end();
                      wasRunning = running;
                  })
                : function () {};

        session.on(function (detail) {
            if (detail.type === 'permission:revoked') director.onPermissionRevoked(detail.capability);
            if (detail.type !== 'destination:changed') return;
            const status = director.status();
            if (status.status !== 'active' && status.status !== 'paused') return;
            if (detail.to !== 'experiences' && status.status === 'active') director.pause();
            if (detail.to === 'experiences' && status.status === 'paused') director.resume();
        });

        function onVrStart() {
            director.onVrSessionStart();
        }
        function onVrEnd() {
            director.onVrSessionEnd();
        }
        if (global.addEventListener) {
            global.addEventListener('vr-session-start', onVrStart);
            global.addEventListener('vr-session-end', onVrEnd);
        }

        const live = {
            session: session,
            memory: memory,
            privacy: privacy,
            director: director,
            // VW2. The experience's placeholder scenery, so a real world can hide it.
            scene: scene,
            bridge: bridge,
            bar: bar,
            marks: marks,
            panel: panelGetter,
            registry: registry,
            behavior: behavior,
        };
        global.__NEXUS_COMPANION_LIVE = live;
        // PG3. The playground's reactive context: observes the verified world and the chips,
        // reacts through this same BehaviorRouter, and lends the prompt one grounded paragraph.
        // Ticked from the runtime below, inside the render loop that already exists.
        let reactive = null;
        let picker = null;
        const Picker = global.NEXUS_PLAYGROUND_PICKER;
        if (Picker && typeof Picker.attach === 'function') {
            try {
                picker = Picker.attach({ global: global });
                live.picker = picker;
            } catch (error) {
                console.warn('[Companion] playground object picker failed to attach — continuing', error);
            }
        }
        const Reactive = global.NEXUS_PLAYGROUND_REACTIVE;
        if (Reactive && typeof Reactive.attach === 'function') {
            try {
                reactive = Reactive.attach({ live: live, behavior: behavior, global: global, picker: picker });
                live.reactive = reactive;
            } catch (error) {
                console.warn('[Companion] reactive playground context failed to attach — continuing', error);
            }
        }
        // LW3–LW5. Living Worlds: where the two of you are, verified by the renderer; moving
        // within a place, and travel that waits for the person's yes. Event-driven, no loop.
        let presence = null;
        const Presence = global.NEXUS_WORLD_PRESENCE;
        if (Presence && typeof Presence.attach === 'function') {
            try {
                presence = Presence.attach({ live: live, global: global });
                live.presence = presence;
            } catch (error) {
                console.warn('[Companion] world presence failed to attach — continuing', error);
            }
        }
        // PW. The premium Private World: a private-only presence behind a fail-closed gate
        // (deployment, server attestation, Private running, the world, an adult-declared avatar).
        let privateWorld = null;
        const PrivateWorld = global.NEXUS_PRIVATE_WORLD;
        if (PrivateWorld && typeof PrivateWorld.attach === 'function') {
            try {
                privateWorld = PrivateWorld.attach({ live: live, global: global });
                if (privateWorld) live.privateWorld = privateWorld;
            } catch (error) {
                console.warn('[Companion] private world failed to attach — continuing', error);
            }
        }
        const runtime = {
            update: function (dt) {
                director.update(dt);
                if (reactive) reactive.update(dt);
            },
            trySelect: function (raycaster) {
                // The experience's own objects first (Seaside's lantern); then a venue's anchors
                // on the same controller ray — a request the reactive context still validates.
                if (director.trySelect(raycaster)) return true;
                return Boolean(picker && raycaster && raycaster.ray && picker.trySelectRay(raycaster.ray));
            },
            bindViewer: function (host) {
                return director.bindViewer(host);
            },
            status: function () {
                return director.status();
            },
        };
        global.NEXUS_EXPERIENCE_RUNTIME = runtime;

        return {
            name: 'CompanionDestinations',
            live: live,
            detach: function () {
                try {
                    director.stop('detach');
                } catch (_) {
                    /* detach must finish even if the experience is already gone */
                }
                if (bar && bar.detach) bar.detach();
                if (marks && marks.detach) marks.detach();
                if (voice && voice.detach) voice.detach();
                if (reactive && reactive.detach) reactive.detach();
                if (presence && presence.detach) presence.detach();
                if (privateWorld && privateWorld.detach) privateWorld.detach();
                if (picker && picker.detach) picker.detach();
                offPanel();
                offDirector();
                if (global.removeEventListener) {
                    global.removeEventListener('vr-session-start', onVrStart);
                    global.removeEventListener('vr-session-end', onVrEnd);
                }
                if (global.NEXUS_EXPERIENCE_RUNTIME === runtime) global.NEXUS_EXPERIENCE_RUNTIME = undefined;
                if (global.__NEXUS_COMPANION_LIVE === live) global.__NEXUS_COMPANION_LIVE = undefined;
            },
        };
    }

    const api = {
        attach: attach,
        systemPromptSuffix: suffix,
        consume: consume,
    };

    if (global) global.NEXUS_COMPANION = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
