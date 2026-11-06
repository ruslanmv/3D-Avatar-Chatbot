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
        const Marks = global.NEXUS_COMPANION_MARKS;
        const running =
            session.active() &&
            session.source() === 'together' &&
            Marks &&
            Marks.EXPLICIT.indexOf(session.activity()) !== -1;
        if (running) return;
        const found = Intent.classify(typeof latest.content === 'string' ? latest.content : '');
        if (!found) return;
        if (session.active() && session.destination() === found.destination && session.activity() === found.activity)
            return;
        session.enter(found.destination, found.activity, { source: 'conversation' });
    }

    function suffix() {
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
                });
            } catch (error) {
                console.warn('[Companion] activity marks failed to attach — continuing', error);
            }
        }

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
            bridge: bridge,
            bar: bar,
            marks: marks,
            registry: registry,
            behavior: behavior,
        };
        global.__NEXUS_COMPANION_LIVE = live;
        const runtime = {
            update: function (dt) {
                director.update(dt);
            },
            trySelect: function (raycaster) {
                return director.trySelect(raycaster);
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
    };

    if (global) global.NEXUS_COMPANION = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
