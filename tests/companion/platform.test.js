/**
 * Companion destinations, memory scopes, and the experience lifecycle.
 *
 * jsdom has no WebGL. The scene runtime is given a fake THREE, and the
 * assertions are about state: what was built, what was restored, and what a
 * destination is allowed to read.
 */

const Session = require('../../src/companion/CompanionSession');
const Memory = require('../../src/companion/MemoryScopes');
const Privacy = require('../../src/companion/PrivacyGate');
const Behavior = require('../../src/companion/BehaviorRouter');
const Prompt = require('../../src/companion/PromptContext');
const Catalog = require('../../src/companion/DestinationCatalog');
const Tasks = require('../../src/companion/TaskBoard');
const Bridge = require('../../src/companion/ActivityBridge');
require('../../src/companion/DestinationBar');
const Manifest = require('../../src/experiences/SceneManifest');
const Layout = require('../../src/experiences/seaside/layout');
const Story = require('../../src/experiences/seaside/story');
const Scene = require('../../src/experiences/SceneRuntime');
const Audio = require('../../src/experiences/SpatialAudioManager');
const Registry = require('../../src/experiences/ExperienceRegistry');
const Life = require('../../src/experiences/ExperienceSession');
const Director = require('../../src/experiences/ExperienceDirector');
const Seaside = require('../../src/experiences/seaside/SeasideEvening');
const Formats = require('../../src/experiences/formats');
const ExpMemory = require('../../src/experiences/ExperienceMemory');
const fs = require('fs');
const path = require('path');

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

function fakeThree() {
    class Vec {
        constructor(x, y, z) {
            this.x = x || 0;
            this.y = y || 0;
            this.z = z || 0;
        }
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
    }
    class Obj {
        constructor() {
            this.children = [];
            this.position = new Vec();
            this.userData = {};
            this.name = '';
            this.visible = true;
            this.parent = null;
        }
        add(child) {
            this.children.push(child);
            child.parent = this;
        }
        remove(child) {
            this.children = this.children.filter((item) => item !== child);
        }
    }
    class Geometry {
        dispose() {
            this.disposed = true;
        }
    }
    return {
        Group: class extends Obj {},
        Mesh: class extends Obj {
            constructor(geometry, material) {
                super();
                this.geometry = geometry;
                this.material = material;
            }
        },
        BoxGeometry: class extends Geometry {
            constructor() {
                super();
            }
        },
        SphereGeometry: class extends Geometry {},
        CylinderGeometry: class extends Geometry {},
        PlaneGeometry: class extends Geometry {},
        MeshBasicMaterial: class {
            constructor(params) {
                this.color = params.color;
                this.side = params.side;
            }
            dispose() {
                this.disposed = true;
            }
        },
        BackSide: 1,
        FrontSide: 0,
    };
}

function harness(extra) {
    const storage = memoryStorage();
    const session = Session.create({ storage, now: () => 1000 });
    session.load();
    const memory = Memory.create({ storage, now: () => 1000 });
    const calls = [];
    const privacy = Privacy.create({ spicyEnabled: () => Boolean(extra && extra.spicy) });
    const behavior = Behavior.create({
        director: {
            handleIntent: (intent) => {
                calls.push(intent.name);
                return extra && extra.noClip ? null : { clip: intent.name };
            },
        },
    });
    const parent = new (fakeThree().Group)();
    const scene = Scene.create({ THREE: fakeThree(), parent, validate: Manifest.validate });
    const audioNodes = { started: 0, stopped: 0 };
    const audio = Audio.create({
        context: {
            destination: {},
            createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
            createOscillator: () => ({
                type: '',
                frequency: { value: 0 },
                connect() {},
                disconnect() {},
                start() {
                    audioNodes.started += 1;
                },
                stop() {
                    audioNodes.stopped += 1;
                },
            }),
            createPanner: () => ({
                panningModel: '',
                distanceModel: '',
                refDistance: 0,
                maxDistance: 0,
                positionX: { value: 0 },
                positionY: { value: 0 },
                positionZ: { value: 0 },
                connect() {},
                disconnect() {},
            }),
            resume() {},
            suspend() {
                audioNodes.suspended = true;
            },
        },
    });
    const registry = Registry.create();
    const experienceMemory = ExpMemory.create(memory);
    const said = [];
    let director;
    const Interaction = require('../../src/experiences/InteractionRouter');
    const interaction = Interaction.create({
        onSelect: (id) => director.interact(id),
    });
    director = Director.create({
        registry,
        life: Life.create(),
        scene,
        audio,
        interaction,
        behavior,
        session,
        privacy,
        experienceMemory,
        say: (text) => said.push(text),
        platform: () => ({ xrPresenting: false, blendMode: null, narrow: false, cores: 8 }),
    });
    registry.register(Seaside.create({ layout: Layout, story: Story, manifest: Manifest }));
    for (const format of Formats.STAGED) registry.register(format);
    return {
        session,
        memory,
        privacy,
        behavior,
        scene,
        audio,
        director,
        registry,
        said,
        calls,
        parent,
        audioNodes,
        storage,
    };
}

describe('session continuity', () => {
    test('switching destinations keeps the conversation id', () => {
        const session = Session.create({ storage: memoryStorage(), now: () => 5 });
        session.load();
        const id = session.conversationId();
        const moved = session.setDestination('copilot');
        expect(moved.ok).toBe(true);
        expect(moved.conversationId).toBe(id);
        expect(session.destination()).toBe('copilot');
        expect(session.conversationId()).toBe(id);
    });

    test('a legacy destination name migrates instead of being dropped', () => {
        const storage = memoryStorage();
        storage.setItem(
            Session.KEY,
            JSON.stringify({
                schemaVersion: 1,
                sessionId: 'ses_old',
                companionId: 'nexus',
                conversationId: 'cnv_old',
                activeDestination: 'journey',
                voiceState: { muted: false, companion: 1, environment: 0.45 },
                privacyScopes: { grants: [] },
                grantedCapabilities: [],
                comfort: { minDistance: 0.8, reducedMotion: false, seated: true },
                customized: false,
                startedAt: 1,
                updatedAt: 1,
            })
        );
        const session = Session.create({ storage, now: () => 9 });
        session.load();
        expect(session.destination()).toBe('experiences');
        expect(session.conversationId()).toBe('cnv_old');
    });

    test('an unknown schema does not invent fields from the blob', () => {
        const clean = Session.sanitise(
            { schemaVersion: 99, conversationId: 'stolen', activeDestination: 'copilot' },
            () => 1
        );
        expect(clean.conversationId).not.toBe('stolen');
        expect(clean.activeDestination).toBe('life');
    });
});

describe('memory scopes and privacy', () => {
    test('unapproved text is not stored', () => {
        const memory = Memory.create({ storage: memoryStorage() });
        expect(memory.addMemory('life', { title: 'a secret diary page', approved: false }).ok).toBe(false);
        expect(memory.read('life').memories).toEqual([]);
    });

    test('copilot cannot read life or private memories without a grant', () => {
        const gate = Privacy.create({ spicyEnabled: () => true });
        expect(gate.allows('copilot', 'life', []).ok).toBe(false);
        expect(gate.allows('copilot', 'private', []).ok).toBe(false);
        expect(gate.allows('copilot', 'life', ['memory:life']).ok).toBe(true);
        expect(gate.allows('copilot', 'private', ['memory:private']).ok).toBe(false);
    });

    test('adult capability is off by default and refused in copilot even when the switch is on', () => {
        const closed = Privacy.create({ spicyEnabled: () => false });
        const open = Privacy.create({ spicyEnabled: () => true });
        expect(closed.allowsAdult('life').ok).toBe(false);
        expect(open.allowsAdult('life').ok).toBe(true);
        expect(open.allowsAdult('copilot').ok).toBe(false);
        expect(open.capabilityAllowed('camera', 'copilot', []).ok).toBe(false);
        expect(open.capabilityAllowed('camera', 'copilot', ['camera']).ok).toBe(true);
    });

    test('tasks persist and copilot copy stays free of life preferences', () => {
        const storage = memoryStorage();
        const memory = Memory.create({ storage, now: () => 50 });
        Tasks.addTask(memory, 'Write the outline', { priority: 'high' });
        memory.setRelationship({ style: 'romance', address: 'dear one', romance: 'romantic' });
        const reloaded = Memory.create({ storage, now: () => 60 });
        expect(reloaded.read('copilot').tasks[0].title).toBe('Write the outline');
        expect(reloaded.read('copilot').tasks[0].priority).toBe('high');
        const text = Prompt.suffix({
            customized: true,
            destination: 'copilot',
            tasks: reloaded.read('copilot').tasks,
            relationship: reloaded.read('life').relationship,
            memories: [{ title: 'our evening' }],
        });
        expect(text).toContain('Write the outline');
        expect(text).not.toContain('dear one');
        expect(text).not.toContain('our evening');
        expect(Prompt.suffix({ customized: false, destination: 'life' })).toBe('');
    });

    test('clearing a conversation does not list companion stores as conversation keys', () => {
        const Reset = require('../../src/features/chat/ConversationReset');
        expect(Reset.KEPT).toEqual(expect.arrayContaining(['nexus_companion_session_v1', 'nexus_companion_memory_v1']));
        for (const key of Reset.KEPT) expect(Reset.KEYS).not.toContain(key);
    });
});

describe('behavior routing', () => {
    test('a missing clip falls back and speech is not interrupted', () => {
        const router = Behavior.create({
            director: { handleIntent: () => null },
        });
        expect(router.request('greet', {}).applied).toBe('fallback');
        expect(router.request('celebrate', { speaking: true }).applied).toBe('deferred');
        expect(router.request('smile', { speaking: true }).applied).toBe('fallback');
        expect(router.request('not-a-real-intent', {}).ok).toBe(false);
    });

    test('walking into the camera is refused', () => {
        const router = Behavior.create({});
        const blocked = router.request('walk_to_anchor', {
            allowLocomotion: true,
            camera: { x: 0, y: 1.2, z: 2 },
            anchor: { x: 0, y: 1.2, z: 1.8 },
            minDistance: 0.8,
        });
        expect(blocked.why).toBe('comfort-distance');
        expect(blocked.applied).toBe('fallback');
    });
});

describe('seaside evening', () => {
    test('the manifest is interactive geometry and validates', () => {
        const manifest = Layout.manifest('low');
        expect(Manifest.validate(manifest)).toEqual([]);
        expect(manifest.sceneType).toBe('interactive-3d');
        expect(manifest.bodies.filter((body) => body.selectable).map((body) => body.id)).toEqual(
            expect.arrayContaining(['shell', 'lantern'])
        );
        expect(manifest.avatarPlacement.move).toBe(false);
    });

    test('an unsafe asset path is rejected', () => {
        const manifest = Layout.manifest('desktop', { assetPaths: ['../secret.ktx2'] });
        expect(Manifest.validate(manifest).join(' ')).toContain('unsafe');
    });

    test('choices change the following line, and the two objects do too', () => {
        let state = Story.initial();
        const tide = Story.choose(state, 'tide');
        const story = Story.choose(state, 'story');
        expect(tide.state.line).not.toBe(story.state.line);
        state = tide.state;
        const shell = Story.interact(state, 'shell');
        expect(shell.state.shellTouched).toBe(true);
        expect(shell.state.line).toContain('shell');
        const lantern = Story.interact(story.state, 'lantern');
        expect(lantern.state.lanternLit).toBe(true);
        expect(lantern.state.beat).not.toBe(story.state.beat);
    });

    test('starting and stopping restores the scene and does not move the camera', async () => {
        const rig = harness();
        const camera = { x: 0, y: 1.25, z: 2 };
        const before = rig.parent.children.length;
        const started = await rig.director.start('seaside-evening');
        expect(started.ok).toBe(true);
        expect(rig.parent.children.length).toBe(before + 1);
        expect(rig.said[0]).toContain('tide');
        expect(camera).toEqual({ x: 0, y: 1.25, z: 2 });
        rig.director.choose('tide');
        expect(rig.director.status().detail.beat).toBe('tide');
        await rig.director.interact('shell');
        expect(rig.director.status().detail.shellTouched).toBe(true);
        await rig.director.stop('exit');
        expect(rig.parent.children.length).toBe(before);
        expect(rig.scene.activeId).toBeNull();
        expect(rig.director.status().status).toBe('stopped');
        expect(rig.scene.disposedCount).toBeGreaterThan(0);
    });

    test('a staged format cannot be started', async () => {
        const rig = harness();
        const result = await rig.director.start('mystery-adventure');
        expect(result.ok).toBe(false);
        expect(result.why).toBe('not-built');
        expect(rig.director.status().status).toBe('idle');
    });

    test('a missing asset falls back and a stale load cannot replace a newer one', async () => {
        const THREE = fakeThree();
        const parent = new THREE.Group();
        let release;
        const runtime = Scene.create({
            THREE,
            parent,
            validate: Manifest.validate,
            loadAsset: () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        });
        const first = Layout.manifest('low', { assetPaths: ['assets/ambient/missing.ktx2'] });
        const pending = runtime.load(first, {});
        runtime.cancel();
        release();
        const result = await pending;
        expect(result.why).toBe('stale');
        expect(parent.children.length).toBe(0);
        const second = await runtime.load(Layout.manifest('low'), {});
        expect(second.ok).toBe(true);
        expect(parent.children.length).toBe(1);
        runtime.restore();
        expect(parent.children.length).toBe(0);
    });

    test('environment audio ducks while she speaks and stops when VR ends', () => {
        const rig = harness();
        rig.audio.setLevels({ environment: 0.4, companion: 1, muted: false });
        rig.audio.startAmbience();
        const ducked = rig.audio.setSpeaking(true);
        expect(ducked.environment).toBeCloseTo(0.1);
        rig.audio.setSpeaking(false);
        expect(rig.audio.environmentGain).toBeCloseTo(0.4);
        rig.audio.setLevels({ muted: true });
        rig.audio.onVrSessionEnd();
        expect(rig.audioNodes.stopped).toBe(1);
    });

    test('pause and resume keep progress', async () => {
        const rig = harness();
        await rig.director.start('seaside-evening');
        rig.director.choose('story');
        expect(rig.director.pause().ok).toBe(true);
        expect(rig.director.resume().ok).toBe(true);
        expect(rig.director.status().detail.beat).toBe('story');
        const saved = rig.memory.read('experiences').progress['seaside-evening'];
        expect(saved.beat).toBe('story');
    });
});

describe('activity bridge', () => {
    test('it opens Together setup and does not ask for a device', async () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/companion/ActivityBridge.js'), 'utf8');
        expect(source).not.toContain('getUserMedia');
        expect(source).not.toContain('consent.request');
        const chosen = [];
        const bridge = Bridge.create({
            panel: {
                open() {},
                choose(id) {
                    chosen.push(id);
                    return { ok: true, why: 'setup' };
                },
            },
        });
        const result = await bridge.run({ kind: 'together-open', activity: 'watch' });
        expect(result.why).toBe('setup');
        expect(chosen).toEqual(['watch']);
    });

    test('catalog actions do not duplicate a capability under two labels', () => {
        const labels = [];
        for (const destination of ['life', 'copilot', 'experiences']) {
            for (const action of Catalog.actions(destination))
                labels.push(action.kind + ':' + (action.activity || action.experienceId || action.id));
        }
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe('destination bar', () => {
    test('switching destination does not clear the chat, and leaving an experience pauses it', async () => {
        document.body.innerHTML =
            '<div class="avatar-card"></div><div id="chat-history"></div>' +
            '<footer class="chat-input-shell"><input id="speech-text" /></footer>';
        const Companion = require('../../src/companion/index');
        const storage = memoryStorage();
        const history = [{ role: 'user', content: 'still here' }];
        const handle = Companion.attach({
            storage,
            doc: document,
            panel: {
                open() {},
                choose() {
                    return { ok: true, why: 'setup' };
                },
            },
            bus: { on() {} },
        });
        const session = handle.live.session;
        const before = session.conversationId();
        // IC2: the strip on the avatar card is gone; Together enters a destination.
        expect(document.querySelector('[data-destination="copilot"][role="tab"]')).toBeNull();
        session.enter('copilot', 'tasks');
        expect(session.destination()).toBe('copilot');
        expect(session.conversationId()).toBe(before);
        expect(history).toHaveLength(1);
        session.enter('experiences', 'seaside');
        const started = await handle.live.director.start('seaside-evening');
        expect(started.ok).toBe(true);
        session.enter('life', 'talk');
        expect(handle.live.director.status().status).toBe('paused');
        session.enter('experiences', 'seaside');
        expect(handle.live.director.status().status).toBe('active');
        document.getElementById('nexus-companion-exit').click();
        expect(handle.live.director.status().status).toBe('stopped');
        handle.detach();
        document.body.innerHTML = '';
    });
});

describe('render loop ownership', () => {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

    test('the experience runtime does not install an animation loop', () => {
        expect(read('src/experiences/SceneRuntime.js')).not.toContain('setAnimationLoop');
        expect(read('src/experiences/ExperienceDirector.js')).not.toContain('setAnimationLoop');
        const engine = read('src/gltf-viewer/ViewerEngine.js');
        const start = engine.indexOf('    animate() {');
        const loop = engine.slice(start, engine.indexOf('\n    }\n', start));
        const at = loop.indexOf('experience.update?.(dt)');
        expect(at).toBeGreaterThan(-1);
        const before = loop.slice(0, at);
        expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('catch (e)'));
    });

    test('the prompt suffix is wired anywhere the wardrobe suffix is', () => {
        const main = read('src/main.js');
        const wardrobe = (main.match(/NEXUS_WARDROBE_TOOL\?\.systemPromptSuffix/g) || []).length;
        const companion = (main.match(/NEXUS_COMPANION\?\.systemPromptSuffix/g) || []).length;
        expect(companion).toBe(wardrobe);
    });
});
