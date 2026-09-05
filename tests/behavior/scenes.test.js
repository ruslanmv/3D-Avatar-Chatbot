/**
 * Journeys (B14).
 *
 * Two acceptance sentences, and they are the two hardest things about scenes:
 *
 *   * overlays survive ten enter/exit cycles unchanged — the failure mode is silent, and
 *     compounding, and looks fine for the first nine. So the test runs the cycles and then
 *     asserts *object identity*, not equality: restoring an equal copy is exactly how this
 *     bug hides from a deep-equality check.
 *   * meditation proves curiosity silent except its script lines — a negative claim, so it
 *     is checked as one: every opening the other scenes would honour is fired during
 *     meditation, and the gate must refuse every time, while the script's own lines still
 *     arrive on schedule.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
const CompanionProfile = require('../../src/behavior/modes/companion.profile.js');
const Watch = require('../../src/features/together/activities/watch.js');
const Journey = require('../../src/features/together/activities/scene-journey.js');

const ROOT = path.join(__dirname, '..', '..');
const SCENE_DIR = path.join(ROOT, 'src', 'features', 'together', 'scenes');
const SCENES = ['forest', 'ocean', 'meditation'];
const manifest = (id) => JSON.parse(fs.readFileSync(path.join(SCENE_DIR, `${id}.json`), 'utf8'));

const { CommentaryGate } = Watch;

/** A viewer with the fields a scene touches, and a way to see what it did to them. */
function fakeViewer({ ar = false } = {}) {
    return {
        scene: { background: 'the app background', environment: 'the app envmap' },
        renderer: { toneMappingExposure: 1.0 },
        camera: { position: { x: 0, y: 1.6, z: 0 } },
        arSupport: { isARActive: ar, reticle: null },
    };
}

const fakeThree = () => ({
    EquirectangularReflectionMapping: 'equirect',
    Color: class {
        constructor(hex) {
            this.hex = hex;
        }
    },
});

/** A journey with every scene registered and nothing real behind it. */
function rig({ ar = false, three = fakeThree(), loadTexture, gate, blackboard, profile = TogetherProfile } = {}) {
    let clock = 0;
    const bus = new EventBus({});
    const board = blackboard || new Blackboard({});
    board.mode = profile;
    board.attention = 0.85;

    const commentary =
        gate === undefined ? new CommentaryGate({ bus, blackboard: board, profile, now: () => clock }) : gate;
    const events = [];
    for (const name of ['scene:enter', 'scene:exit', 'scene:anchor', 'intent']) {
        // `event` rather than `name`: an anchor payload has a `name` of its own, and
        // spreading it over the event name is how the first draft of this rig lied.
        bus.on(name, (payload) => events.push({ at: clock, event: name, ...payload }));
    }

    const journey = Journey.attach({
        bus,
        blackboard: board,
        viewer: fakeViewer({ ar }),
        three,
        gate: commentary,
        loadTexture,
        makeAudio: (url) => ({
            url,
            played: false,
            play() {
                this.played = true;
            },
            pause() {
                this.paused = true;
            },
        }),
        now: () => clock,
    });
    for (const id of SCENES) journey.register(manifest(id));

    return {
        journey,
        bus,
        blackboard: board,
        gate: commentary,
        events,
        at: () => clock,
        set: (ms) => (clock = ms),
        advance: (ms) => (clock += ms),
    };
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── the manifests ────────────────────────────────────────────────────────────

describe('the three manifests', () => {
    test('all three parse and validate', () => {
        for (const id of SCENES) {
            expect(`${id}: ${Journey.validate(manifest(id)).join()}`).toBe(`${id}: `);
        }
    });

    test('each carries what §6.11 says a scene carries', () => {
        for (const id of SCENES) {
            const m = manifest(id);
            expect(m.id).toBe(id);
            expect(typeof m.title).toBe('string');
            expect(m.anchors.length).toBeGreaterThan(0);
            expect(m.profileOverlay).toBeTruthy();
            expect(m.avatarPlacement).toMatchObject({ faceUser: true });
            expect(m.lighting).toHaveProperty('exposure');
        }
    });

    test('each carries a fallback colour, because the art is not in the repo', () => {
        for (const id of SCENES) {
            expect(`${id}: ${/^#[0-9a-f]{6}$/.test(manifest(id).fallbackColor)}`).toBe(`${id}: true`);
        }
    });

    test('meditation is the one with a script and no budget', () => {
        const m = manifest('meditation');
        expect(m.profileOverlay.initiative.budgetPerSession).toBe(0);
        expect(m.profileOverlay.idleProfile).toBe('breath-sync');
        expect(m.profileOverlay.commentaryOpenings).toEqual([]);
        expect(m.guidedScript.length).toBeGreaterThan(3);
        // Sorted in the file, and each line has something to say or do.
        for (const line of m.guidedScript) expect(Number.isFinite(line.t)).toBe(true);
    });

    test('forest and ocean use anchor openings, which §6.11 spells that way', () => {
        for (const id of ['forest', 'ocean']) {
            const openings = manifest(id).profileOverlay.commentaryOpenings;
            expect(openings.some((o) => o.startsWith('anchor:'))).toBe(true);
            // And every anchor named as an opening actually exists in the scene.
            const names = manifest(id).anchors.map((a) => a.name);
            for (const opening of openings.filter((o) => o.startsWith('anchor:'))) {
                expect(`${id}: ${names.includes(opening.slice(7))}`).toBe(`${id}: true`);
            }
        }
    });

    test('a broken manifest is refused with reasons, not thrown', () => {
        expect(Journey.validate(null)).toEqual(['not an object']);
        expect(Journey.validate({ id: '', title: 1, anchors: 'no' }).length).toBeGreaterThan(2);
        expect(Journey.validate({ ...manifest('ocean'), anchors: [{ name: 'x', dir: [1, 2] }] })).toContain(
            'anchor x needs a 3-component dir'
        );

        const r = rig();
        expect(r.journey.register({ id: 'broken' })).toBe(false);
        expect(r.journey.stats.registered).toEqual(SCENES);
    });
});

// ── the ten-cycle proof ──────────────────────────────────────────────────────

describe('overlays revert exactly', () => {
    test('ten enter/exit cycles leave the profile identical — by reference', () => {
        const r = rig();
        const before = r.blackboard.mode;
        const beforeJson = JSON.stringify(before);
        const sceneBefore = { ...r.journey.viewer.scene };
        const exposureBefore = r.journey.viewer.renderer.toneMappingExposure;

        for (let i = 0; i < 10; i++) {
            for (const id of SCENES) {
                r.journey.enter(id);
                r.journey.exit(`cycle ${i}`);
            }
        }

        // Identity, not equality. An equal copy passes toEqual and is still the bug.
        expect(r.blackboard.mode).toBe(before);
        expect(JSON.stringify(r.blackboard.mode)).toBe(beforeJson);
        expect(r.journey.viewer.scene.background).toBe(sceneBefore.background);
        expect(r.journey.viewer.scene.environment).toBe(sceneBefore.environment);
        expect(r.journey.viewer.renderer.toneMappingExposure).toBe(exposureBefore);
        expect(r.blackboard.scene).toBe(null);
        expect(r.journey.stats).toMatchObject({ active: null, enters: 30, exits: 30 });
    });

    test('the base profile is never mutated, so overlays cannot compound', () => {
        // The reason ten cycles are safe: an overlay derives a new object rather than
        // writing into the one everybody else holds.
        const pristine = JSON.stringify(TogetherProfile);
        const r = rig();
        for (let i = 0; i < 10; i++) {
            r.journey.enter('meditation');
            r.journey.exit();
        }
        expect(JSON.stringify(TogetherProfile)).toBe(pristine);
    });

    test('the overlay really does change things while it is on', () => {
        // A revert test passes trivially if enter never did anything. This is the guard.
        const r = rig();
        const before = r.blackboard.mode;
        r.journey.enter('ocean');

        expect(r.blackboard.mode).not.toBe(before);
        expect(r.blackboard.mode.idleProfile).toBe('curious-outdoor');
        expect(r.blackboard.mode.initiative.budgetPerSession).toBe(6);
        expect(r.blackboard.mode.commentaryOpenings).toContain('anchor:waves');
        expect(r.blackboard.scene).toBe('ocean');
        expect(r.journey.viewer.renderer.toneMappingExposure).toBe(1.1);
    });

    test('initiative merges field by field; everything else replaces', () => {
        // A scene that only changes the budget must not silently drop minGapMs, but a
        // scene's openings are a complete statement — meditation's empty list means
        // "nothing", not "the defaults".
        const base = { ...TogetherProfile, initiative: { budgetPerSession: 4, minGapMs: 90000 } };
        const merged = Journey.derive(base, { initiative: { budgetPerSession: 0 } });
        expect(merged.initiative).toEqual({ budgetPerSession: 0, minGapMs: 90000 });

        const replaced = Journey.derive(base, { commentaryOpenings: [] });
        expect(replaced.commentaryOpenings).toEqual([]);
        expect(base.commentaryOpenings).toBe(TogetherProfile.commentaryOpenings);
    });

    test('the derived profile keeps the methods the ranker calls', () => {
        // §6.5 reads `bb.mode.allows`. A spread that lost it would open a gate silently.
        const derived = Journey.derive(TogetherProfile, manifest('ocean').profileOverlay);
        expect(typeof derived.allows).toBe('function');
        expect(derived.allows({ stats: { rootMotion: 0.1 } })).toBe(true);
        expect(derived.allows({ stats: { rootMotion: 0.9 } })).toBe(false);
    });

    test('an overlay may not invent fields the profile does not own', () => {
        const derived = Journey.derive(TogetherProfile, { idleProfile: 'x', mischief: true });
        expect(derived.mischief).toBeUndefined();
        expect(derived.idleProfile).toBe('x');
    });

    test('a manifest may not change what may play', () => {
        // B14's rule, and the reason it still holds after B27 added `allows` to the
        // overlay fields: only a *function* overlays it, and a manifest is JSON. A scene
        // that shipped `"allows": true` would be changing the ranker's mind from a data
        // file, which is exactly what this forbids.
        const fromJson = Journey.derive(TogetherProfile, JSON.parse('{"allows": true}'));
        expect(fromJson.allows).toBe(TogetherProfile.allows);
    });

    test('but a code overlay may narrow it', () => {
        // B23's play profile and B27's coach both do, and both were being silently merged
        // away before `allows` joined OVERLAY_FIELDS.
        const narrow = () => false;
        expect(Journey.derive(TogetherProfile, { allows: narrow }).allows).toBe(narrow);
    });

    test('entering a second scene exits the first rather than stacking', () => {
        const r = rig();
        const before = r.blackboard.mode;
        r.journey.enter('forest');
        r.journey.enter('ocean');
        expect(r.blackboard.mode.idleProfile).toBe('curious-outdoor');
        r.journey.exit();
        expect(r.blackboard.mode).toBe(before);
    });

    test('exiting when nothing is active is a no-op, not a restore of nothing', () => {
        const r = rig();
        const before = r.blackboard.mode;
        expect(r.journey.exit()).toBe(false);
        expect(r.blackboard.mode).toBe(before);
    });

    test('the gate goes back to the profile it had', () => {
        const r = rig();
        expect(r.gate.profile).toBe(TogetherProfile);
        r.journey.enter('meditation');
        expect(r.gate.profile).not.toBe(TogetherProfile);
        r.journey.exit();
        expect(r.gate.profile).toBe(TogetherProfile);
    });

    test('it works over a companion base too, not only together', () => {
        const r = rig({ profile: CompanionProfile });
        const before = r.blackboard.mode;
        for (let i = 0; i < 10; i++) {
            r.journey.enter('forest');
            r.journey.exit();
        }
        expect(r.blackboard.mode).toBe(before);
        expect(r.blackboard.mode.id).toBe('companion');
    });

    test('scene:enter and scene:exit are announced once each, per cycle', () => {
        const r = rig();
        r.journey.enter('ocean');
        r.journey.exit();
        expect(r.events.filter((e) => e.event === 'scene:enter')).toHaveLength(1);
        expect(r.events.filter((e) => e.event === 'scene:exit')).toHaveLength(1);
    });
});

// ── the sky ──────────────────────────────────────────────────────────────────

describe('the skybox', () => {
    test('art loads as an equirect background and environment', async () => {
        const texture = {
            disposed: false,
            dispose() {
                this.disposed = true;
            },
        };
        const r = rig({ loadTexture: async () => texture });
        await r.journey.enter('forest');

        expect(texture.mapping).toBe('equirect');
        expect(r.journey.viewer.scene.background).toBe(texture);
        expect(r.journey.viewer.scene.environment).toBe(texture);
        expect(r.journey.stats.skyboxLoaded).toBe(true);
    });

    test("and is disposed on exit, while the app's own environment is not", async () => {
        const texture = {
            disposed: false,
            dispose() {
                this.disposed = true;
            },
        };
        const r = rig({ loadTexture: async () => texture });
        await r.journey.enter('forest');
        r.journey.exit();

        expect(texture.disposed).toBe(true);
        expect(r.journey.viewer.scene.environment).toBe('the app envmap');
    });

    test('missing art is a first-class case: the scene enters in its own colour', async () => {
        const r = rig({
            loadTexture: async () => {
                throw new Error('404');
            },
        });
        const entered = await r.journey.enter('ocean');

        expect(entered).toBeTruthy();
        expect(r.journey.stats.active).toBe('ocean');
        expect(r.journey.stats.skyboxLoaded).toBe(false);
        expect(r.journey.viewer.scene.background.hex).toBe(manifest('ocean').fallbackColor);
    });

    test('no loader at all is the shipped state, and still enters', async () => {
        const r = rig();
        await r.journey.enter('forest');
        expect(r.journey.stats.active).toBe('forest');
        expect(r.journey.viewer.scene.background.hex).toBe(manifest('forest').fallbackColor);
    });

    test('a sky that arrives after the user left is dropped, not painted', async () => {
        // An 8K texture takes seconds. Landing it over the room the user came back to is
        // the bug; the enter epoch is what stops it, the same trick B11 uses for grants.
        let resolve;
        const texture = {
            disposed: false,
            dispose() {
                this.disposed = true;
            },
        };
        const r = rig({ loadTexture: () => new Promise((r2) => (resolve = r2)) });

        const entering = r.journey.enter('forest');
        r.journey.exit('changed my mind');
        resolve(texture);
        await entering;

        expect(texture.disposed).toBe(true);
        expect(r.journey.viewer.scene.background).toBe('the app background');
        expect(r.journey.stats.skyboxLoaded).toBe(false);
    });

    test('a sky that arrives after the user moved on lands in neither scene', async () => {
        const resolvers = [];
        const texture = { dispose() {} };
        const r = rig({ loadTexture: () => new Promise((r2) => resolvers.push(r2)) });

        const entering = r.journey.enter('forest');
        const arrived = r.journey.enter('ocean');
        resolvers[0](texture); // the forest sky, late
        resolvers[1](null); // the ocean has no art either
        await Promise.all([entering, arrived]);

        expect(r.journey.stats.active).toBe('ocean');
        expect(r.journey.viewer.scene.background).not.toBe(texture);
    });

    test('AR skips the sky and keeps the profile and the anchors', async () => {
        // Painting a skybox over passthrough replaces the room the user is standing in,
        // which is the opposite of what AR is for.
        const texture = { dispose() {} };
        const r = rig({ ar: true, loadTexture: async () => texture });
        await r.journey.enter('ocean');

        expect(r.journey.viewer.scene.background).toBe('the app background');
        expect(r.journey.stats.skyboxLoaded).toBe(false);
        expect(r.blackboard.mode.idleProfile).toBe('curious-outdoor');
        expect(r.journey.anchors).toEqual(['waves', 'horizon']);
    });

    test('ten AR cycles revert exactly too', async () => {
        const r = rig({ ar: true });
        const before = r.blackboard.mode;
        for (let i = 0; i < 10; i++) {
            await r.journey.enter('meditation');
            r.journey.exit();
        }
        expect(r.blackboard.mode).toBe(before);
        expect(r.journey.viewer.scene.background).toBe('the app background');
    });

    test('the ambient loop starts on enter and stops on exit', async () => {
        const r = rig();
        await r.journey.enter('forest');
        const audio = r.journey.audio;
        expect(audio.played).toBe(true);
        expect(audio.url).toContain('forest_loop');

        r.journey.exit();
        expect(audio.paused).toBe(true);
        expect(r.journey.audio).toBe(null);
    });
});

// ── anchors ──────────────────────────────────────────────────────────────────

describe('gaze anchors', () => {
    test('an anchor announces itself with the direction the manifest chose', () => {
        const r = rig();
        r.journey.enter('ocean');
        const found = r.journey.anchor('waves');

        expect(found.dir).toEqual([0.2, -0.05, -1]);
        const event = r.events.find((e) => e.event === 'scene:anchor');
        expect(event).toMatchObject({ name: 'waves', scene: 'ocean' });
    });

    test('an anchor no scene declares announces nothing', () => {
        const r = rig();
        r.journey.enter('ocean');
        expect(r.journey.anchor('volcano')).toBe(null);
        expect(r.events.filter((e) => e.event === 'scene:anchor')).toHaveLength(0);
    });

    test('an anchor opens the gate, which is what §6.11 spells anchor:waves', () => {
        const r = rig();
        r.journey.enter('ocean');
        expect(r.gate.may().allowed).toBe(false);

        r.journey.anchor('waves');
        const verdict = r.gate.may();
        expect(verdict.allowed).toBe(true);
        expect(verdict.why).toContain('anchor:waves');
    });

    test('an anchor the scene has but does not list as an opening does not open it', () => {
        const r = rig();
        r.journey.enter('ocean');
        // `horizon` is an anchor; only `waves` is an opening.
        r.journey.anchor('horizon');
        expect(r.gate.may().allowed).toBe(false);
    });

    test('the bus vocabulary stays closed — anchors travel as one typed event', () => {
        // A family of `anchor:<name>` events would mean the bus could no longer tell a
        // typo from a scene, which is the whole point of a checked vocabulary.
        expect(EventBus.EVENTS).toContain('scene:anchor');
        expect(EventBus.EVENTS.filter((e) => e.startsWith('anchor:'))).toEqual([]);
    });
});

// ── meditation ───────────────────────────────────────────────────────────────

describe('meditation is silent except its script', () => {
    /**
     * The acceptance sentence, as a negative. Every opening the other scenes honour is
     * fired during meditation and the gate must refuse each time — including openings that
     * would work anywhere else, which is what makes this a mute rather than an absence of
     * triggers.
     */
    test('nothing unprompted gets through, at any opening, ever', () => {
        const r = rig();
        r.journey.enter('meditation');

        const everyOpening = [
            ...TogetherProfile.commentaryOpenings.map((o) => o.split('>')[0]),
            'media:playing',
            'scene:anchor',
        ];

        for (let round = 0; round < 10; round++) {
            for (const event of everyOpening) {
                r.bus.emit(event, { name: 'breath' });
                r.advance(100);
                const verdict = r.gate.may();
                expect(`${event}: ${verdict.allowed}`).toBe(`${event}: false`);
            }
        }
        expect(r.gate.stats.allowed).toBe(0);
    });

    test('and the refusal names the budget, not just "no opening"', () => {
        const r = rig();
        r.journey.enter('meditation');
        expect(r.gate.may().why).toBe('this scene has no initiative budget');
    });

    test('a zero budget silences her even when attention is elsewhere', () => {
        // The one case that lets her speak mid-scene in every other context.
        const r = rig();
        r.journey.enter('meditation');
        r.blackboard.attention = 0.1;
        expect(r.gate.may().allowed).toBe(false);
    });

    test("the script still speaks, on the manifest's schedule", () => {
        const r = rig();
        r.set(50000);
        r.journey.enter('meditation');

        const lines = manifest('meditation').guidedScript;
        // t=0 is due immediately.
        expect(r.journey.update()).toHaveLength(1);
        expect(r.journey.spoken[0].say).toBe(lines[0].say);

        r.advance(lines[1].t - 1);
        expect(r.journey.update()).toBe(null);

        r.advance(2);
        expect(r.journey.update()).toHaveLength(1);
        expect(r.journey.spoken[1].t).toBe(lines[1].t);
    });

    test('every line is delivered, once, in order', () => {
        const r = rig();
        r.journey.enter('meditation');
        const lines = manifest('meditation').guidedScript;

        for (let ms = 0; ms <= lines[lines.length - 1].t; ms += 1000) {
            r.set(ms);
            r.journey.update();
        }
        expect(r.journey.spoken.map((s) => s.t)).toEqual(lines.map((l) => l.t));
    });

    test('a script line is speech the scene owns, not a request Tier 1 may decline', () => {
        // Routing it through the ranker would let a cooldown or a gate swallow a line the
        // manifest promised at a fixed time.
        const r = rig();
        r.journey.enter('meditation');
        r.journey.update();

        const intents = r.events.filter((e) => e.event === 'intent');
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({ name: 'breathe', source: 'scene' });
        // And `source: 'scene'` is not `'user'`, so §6.5's NSFW gate still holds.
        expect(intents[0].source).not.toBe('user');
    });

    test('leaving mid-script stops it, and re-entering starts from the top', () => {
        const r = rig();
        r.journey.enter('meditation');
        r.journey.update();
        expect(r.journey.spoken).toHaveLength(1);

        r.journey.exit();
        r.advance(600000);
        expect(r.journey.update()).toBe(null);

        r.journey.enter('meditation');
        expect(r.journey.update()).toHaveLength(1);
        expect(r.journey.spoken).toHaveLength(1);
    });

    test('the other two scenes have no script and speak nothing on their own', () => {
        for (const id of ['forest', 'ocean']) {
            const r = rig();
            r.journey.enter(id);
            for (let ms = 0; ms < 600000; ms += 10000) {
                r.set(ms);
                r.journey.update();
            }
            expect(`${id}: ${r.journey.spoken.length}`).toBe(`${id}: 0`);
        }
    });

    test('forest and ocean do keep a budget, so this is a meditation rule not a scene rule', () => {
        for (const id of ['forest', 'ocean']) {
            const r = rig();
            r.journey.enter(id);
            r.bus.emit('user:silent', {});
            expect(`${id}: ${r.gate.may().allowed}`).toBe(`${id}: true`);
        }
    });
});

// ── loading ──────────────────────────────────────────────────────────────────

describe('loading the shipped manifests', () => {
    test('all three register through the loader', async () => {
        const journey = Journey.attach({ bus: new EventBus({}), blackboard: new Blackboard({}), viewer: null });
        await Journey.loadManifests(journey, { fetcher: async (url) => manifest(path.basename(url, '.json')) });
        expect(journey.stats.registered).toEqual(SCENES);
    });

    test('one manifest failing to load does not cost the other two', async () => {
        const journey = Journey.attach({ bus: new EventBus({}), blackboard: new Blackboard({}), viewer: null });
        await Journey.loadManifests(journey, {
            fetcher: async (url) => {
                const id = path.basename(url, '.json');
                if (id === 'ocean') throw new Error('404');
                return manifest(id);
            },
        });
        expect(journey.stats.registered).toEqual(['forest', 'meditation']);
    });
});
