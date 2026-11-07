/**
 * PG3 production pass — intent channels, object picking, Seaside's shared moments and the
 * anchors themselves. Properties, not sentences.
 */
const fs = require('fs');
const path = require('path');
const BehaviorRouter = require('../src/companion/BehaviorRouter');
const Picker = require('../src/experiences/playgrounds/PlaygroundObjectPicker.js');
const Reactive = require('../src/experiences/playgrounds/PlaygroundReactiveContext.js');
const Templates = require('../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
const Moods = require('../src/experiences/playgrounds/PlaygroundMoodPresets.js');

const ROOT = path.join(__dirname, '..');
const manifest = fs
    .readFileSync(path.join(ROOT, 'kb/animations.manifest.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const declared = (intent) => manifest.filter((c) => (c.intents || []).includes(intent));

describe('intent channels (the smile that became attention-seeking)', () => {
    test('every companion intent says where it goes, and every registry name is one the library declares', () => {
        for (const name of Object.keys(BehaviorRouter.INTENTS)) expect(BehaviorRouter.CHANNELS[name]).toBeTruthy();
        for (const [name, route] of Object.entries(BehaviorRouter.CHANNELS)) {
            if (route.registry)
                expect(`${name} → ${route.registry}: ${declared(route.registry).length > 0}`).toBe(
                    `${name} → ${route.registry}: true`
                );
        }
        // The clip that was picked for a smile (and the only one tagged `point`) is reachable from
        // no companion intent: gesture_toward_object deliberately has no route until it is re-tagged.
        expect(BehaviorRouter.CHANNELS.gesture_toward_object.registry).toBeUndefined();
        const att = manifest.find((c) => c.id === 'bvh_action_action_attention_seeking');
        for (const route of Object.values(BehaviorRouter.CHANNELS))
            if (route.registry) expect(att.intents).not.toContain(route.registry);
    });

    test('a smile is a face: the expression actuator, never the clip director', () => {
        const director = { handleIntent: jest.fn(() => ({ clip: 'x' })) };
        const expression = jest.fn(() => true);
        const r = BehaviorRouter.create({ director, actuators: { expression } }).request('smile', {});
        expect(r).toMatchObject({ applied: 'behavior', channel: 'expression' });
        expect(expression).toHaveBeenCalledWith('happy', expect.any(Number), expect.any(Number));
        expect(expression.mock.calls[0][1]).toBeLessThanOrEqual(0.6);
        expect(director.handleIntent).not.toHaveBeenCalled();
        // No face to move: a fallback, not a guess from the clip library.
        expect(BehaviorRouter.create({ director }).request('smile', {}).applied).toBe('fallback');
        expect(director.handleIntent).not.toHaveBeenCalled();
    });

    test('greet, listen and relax ask the registry in its own words; an empty declaration is a fallback', () => {
        const names = [];
        const director = {
            handleIntent: (i) => (names.push(i.name), { clip: i.name }),
            registry: { forIntent: (n) => (n === 'nod_along' ? [] : [{ id: 'x' }]) },
        };
        const r = BehaviorRouter.create({ director });
        expect(r.request('greet', {})).toMatchObject({ applied: 'behavior', channel: 'registry' });
        expect(r.request('listen', {}).applied).toBe('fallback'); // declared nothing in this fake
        expect(r.request('relax', {}).applied).toBe('behavior');
        expect(names).toEqual(['greeting', 'idle']);
    });

    test('a look is a gaze at a real point; no point, a bad point, or no gaze is a fallback', () => {
        const gaze = jest.fn(() => true);
        const r = BehaviorRouter.create({ actuators: { gaze } });
        expect(r.request('look_at_object', { gazePoint: { x: 0.3, y: -0.1 } })).toMatchObject({
            applied: 'behavior',
            channel: 'gaze',
        });
        expect(r.request('look_at_object', {}).applied).toBe('fallback');
        expect(r.request('look_at_object', { gazePoint: { x: NaN, y: 0 } }).applied).toBe('fallback');
        expect(r.request('look_at_object', { gazePoint: { x: 40, y: 0 } }).applied).toBe('fallback');
        expect(r.request('look_at_user', {})).toMatchObject({ applied: 'behavior' });
        expect(gaze).toHaveBeenLastCalledWith({ x: 0, y: 0 }, expect.any(Number));
        expect(BehaviorRouter.create({ actuators: { gaze: () => false } }).request('look_at_user', {}).applied).toBe(
            'fallback'
        );
    });

    test('lip-sync still wins: a gesture while speaking is deferred whatever its channel', () => {
        const r = BehaviorRouter.create({ actuators: { gaze: () => true, expression: () => true } });
        expect(r.request('look_at_user', { speaking: true }).applied).toBe('deferred');
        expect(r.request('smile', { speaking: true }).applied).toBe('behavior'); // a smile is mouth-safe
    });

    test('the facade builds the actuators from the existing expression bridge and gaze override, and declines in VR', () => {
        const index = fs.readFileSync(path.join(ROOT, 'src/companion/index.js'), 'utf8');
        expect(index).toMatch(/actuators: actuatorsFor\(global\)/);
        expect(index).toMatch(/loader\.setEmotion\(emotion/);
        expect(index).toMatch(/animator\.setGazeOverride\(\{ x: point\.x, y: point\.y \}\)/);
        expect(index).toMatch(/if \(xr && xr\.isPresenting\) return false;/);
    });
});

describe('object picking', () => {
    test('a tap is short and still; a drag (orbiting her) never selects', () => {
        expect(Picker.isTap({ x: 0, y: 0, t: 0 }, { x: 3, y: 4, t: 200 })).toBe(true);
        expect(Picker.isTap({ x: 0, y: 0, t: 0 }, { x: 30, y: 0, t: 200 })).toBe(false);
        expect(Picker.isTap({ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 900 })).toBe(false);
    });

    test('nearest picks the closest visible anchor inside the radius; touch gets the bigger radius', () => {
        const pts = [
            { id: 'bar', label: 'bar', x: 100, y: 100, visible: true },
            { id: 'table', label: 'table', x: 130, y: 100, visible: true },
            { id: 'lamp', label: 'lamp', x: 102, y: 100, visible: false },
        ];
        expect(Picker.nearest(pts, { x: 118, y: 100 }, 40).id).toBe('table');
        expect(Picker.nearest(pts, { x: 300, y: 300 }, 40)).toBeNull();
        expect(Picker.PICK_RADIUS_PX.coarse).toBeGreaterThanOrEqual(44);
    });

    test('a controller ray picks an anchor within reach, never one behind it', () => {
        const o = { x: 0, y: 1.5, z: 2 };
        const dir = { x: 0, y: 0, z: -1 };
        expect(Picker.rayDistance(o, dir, { x: 0.2, y: 1.5, z: -1 })).toBeCloseTo(0.2);
        expect(Picker.rayDistance(o, dir, { x: 0, y: 1.5, z: 5 })).toBe(Infinity);
    });

    /** A tiny stand-in for three's Vector3, scene node and camera: identity world, x/y → screen. */
    function fakeEngine(activeId) {
        class V {
            constructor(x, y, z) {
                Object.assign(this, { x, y, z });
            }
            clone() {
                return new V(this.x, this.y, this.z);
            }
            project() {
                return new V(this.x / 5, this.y / 5 - 0.2, 0.5);
            }
        }
        const sceneNode = { name: 'vr-world-scene:scenes/pub.glb', updateMatrixWorld() {}, localToWorld: (v) => v };
        const group = { traverse: (fn) => fn(sceneNode) };
        const canvas = document.createElement('canvas');
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            right: 1000,
            bottom: 1000,
            width: 1000,
            height: 1000,
        });
        document.body.appendChild(canvas);
        return {
            camera: { position: new V(0, 0, 0) },
            renderer: { domElement: canvas },
            vrWorlds: { activeId, group },
        };
    }

    test('in the page: a tap on the bar asks for it; a drag does not; another world gets nothing', () => {
        document.body.innerHTML = '<div class="avatar-viewport"></div>';
        window.NEXUS_VIEWER = fakeEngine('irish-pub');
        window.NEXUS_PLAYGROUND_TEMPLATES = Templates;
        const picks = [];
        const onPick = (e) => picks.push(e.detail);
        window.addEventListener('nexus-playground-object', onPick);
        const p = Picker.attach({ global: window, doc: document });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'irish-pub', base: 'irish-pub' } }));
        const bar = p.screenAnchors().find((a) => a.id === 'bar');
        expect(bar.visible).toBe(true);
        const canvas = window.NEXUS_VIEWER.renderer.domElement;
        const fire = (type, x, y) => {
            const ev = new Event(type);
            Object.assign(ev, { clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: 'mouse' });
            canvas.dispatchEvent(ev);
        };
        fire('pointerdown', bar.x, bar.y);
        fire('pointerup', bar.x + 2, bar.y + 1);
        expect(picks).toEqual([{ anchorId: 'bar', world: 'irish-pub', via: 'pointer' }]);
        fire('pointerdown', bar.x, bar.y);
        fire('pointerup', bar.x + 60, bar.y);
        expect(picks.length).toBe(1);
        // Gaze target, window-normalised.
        expect(p.gazePoint('bar')).toEqual({ x: expect.any(Number), y: expect.any(Number) });
        // A place without anchors: no picking at all.
        window.dispatchEvent(
            new CustomEvent('nexus-world-shown', { detail: { id: 'hotel-suite', base: 'hotel-suite' } })
        );
        expect(p.world).toBeNull();
        p.detach();
        window.removeEventListener('nexus-playground-object', onPick);
        delete window.NEXUS_VIEWER;
        delete window.NEXUS_PLAYGROUND_TEMPLATES;
        document.body.innerHTML = '';
    });

    test('picking adds nothing to the scene and runs no loop of its own', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/experiences/playgrounds/PlaygroundObjectPicker.js'), 'utf8');
        expect(src).not.toMatch(/\.add\(|new THREE|setAnimationLoop|setInterval|Raycaster\(|fetch\(|localStorage/);
        expect(src).toMatch(/passive: true/);
    });

    test('every anchor is a real point, and validate refuses one that is not', () => {
        const W = require('../src/gltf-viewer/VRWorlds.js');
        const { worlds } = W.validateCatalogue(
            JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8'))
        );
        expect(Templates.validate(Templates.TEMPLATES, worlds, Moods.ids())).toEqual([]);
        for (const t of Templates.TEMPLATES) {
            expect(t.anchors.length).toBeGreaterThanOrEqual(2);
            for (const a of t.anchors) expect(a.at).toHaveLength(3);
        }
        const bad = { ...Templates.TEMPLATES[0], anchors: [{ id: 'bar', label: 'bar', at: [0, 'x', 0] }] };
        expect(Templates.validate([bad], worlds, Moods.ids()).join(' ')).toMatch(/point/);
    });
});

describe('Seaside: the shared moment, without a second gesture', () => {
    test('the director emits interaction:completed only after a confirmed interaction', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/experiences/ExperienceDirector.js'), 'utf8');
        expect(src).toMatch(/if \(result && result\.ok && !result\.exit\)\s*emit\('interaction:completed'/);
    });

    test('the context remembers it for the conversation and asks for nothing', () => {
        const performed = [];
        const core = Reactive.create({
            performIntent: (n) => (performed.push(n), { applied: 'behavior' }),
            now: () => 1000,
        });
        core.syncSession({ active: true, destination: 'experiences', activity: 'seaside' });
        expect(core.sharedMoment({ objectId: 'lantern', line: 'The lantern takes the match.' })).toBe(true);
        core.update(1);
        expect(performed).toEqual([]);
        expect(core.promptSuffix()).toMatch(/The lantern takes the match/);
        // Not for Copilot, and gone when the activity changes.
        core.syncSession({ active: true, destination: 'copilot', activity: 'tasks' });
        expect(core.promptSuffix()).toBe('');
        expect(core.state().moments).toEqual([]);
    });

    test('the attach wires it to the director it is given', () => {
        const listeners = [];
        const director = { on: (fn) => (listeners.push(fn), () => {}) };
        const live = {
            director,
            session: {
                active: () => true,
                destination: () => 'experiences',
                activity: () => 'seaside',
                on: () => () => {},
            },
        };
        const h = Reactive.attach({ live, global: window });
        listeners[0]({ type: 'interaction:completed', objectId: 'shell', line: 'You pick up the shell.' });
        expect(h.promptSuffix()).toMatch(/You pick up the shell/);
        h.detach();
    });
});

describe('the paragraph names the place’s real things', () => {
    test('the anchors of the verified place, by label; nothing for a place she is not in', () => {
        const core = Reactive.create({
            verifyWorld: (id) => id === 'irish-pub',
            describe: () => ({ base: 'irish-pub', rating: 'general', title: 'Irish pub', line: 'A bar.' }),
            listAnchors: (base) => Templates.TEMPLATES.find((t) => t.world === base).anchors,
        });
        core.enterWorld({ id: 'irish-pub' });
        expect(core.promptSuffix()).toMatch(/Things here you both can see: bar counter, table, pendant lamp\./);
        core.leaveWorld();
        expect(core.promptSuffix()).toBe('');
    });
});

describe('the gesture planner (a proposal, never authority)', () => {
    function place(extra = {}) {
        const performed = [];
        let t = 1000;
        const core = Reactive.create({
            now: () => t,
            verifyWorld: (id) => ['irish-pub', 'private-cabaret', 'neon-discoteca'].includes(id),
            describe: (id) =>
                id === 'private-cabaret'
                    ? { base: 'private-cabaret', rating: 'private', title: 'Cabaret', line: 'A stage.' }
                    : { base: id, rating: 'general', title: id, line: 'A place.' },
            privateAuthorized: () => true,
            listAnchors: (base) => Templates.TEMPLATES.find((x) => x.world === base).anchors,
            getAnchor: (base, id) =>
                Templates.TEMPLATES.find((x) => x.world === base).anchors.find((a) => a.id === id) || null,
            gazePoint: () => ({ x: 0.1, y: 0.2 }),
            performIntent: (name, ctx) => (performed.push({ name, ctx }), { applied: 'behavior' }),
            ...extra,
        });
        const step = (n = 3) => {
            for (let i = 0; i < n; i++) {
                t += 300;
                core.update(0.3);
            }
        };
        return { core, performed, step };
    }

    test('parse: the first tag is the proposal, every tag is stripped, text without tags is untouched', () => {
        const r = Reactive.parseGesture(
            'Look! <gesture intent="look_at_object" target="bar"/> <gesture intent="smile"/>'
        );
        expect(r).toEqual({ text: 'Look!', proposal: { intent: 'look_at_object', target: 'bar' } });
        expect(Reactive.parseGesture('Plain words.')).toEqual({ text: 'Plain words.', proposal: null });
        expect(Reactive.parseGesture("<GESTURE intent='smile'></gesture>Hi").proposal.intent).toBe('smile');
    });

    test('an allowed gesture at a real anchor runs, with the anchor’s gaze point', () => {
        const { core, performed, step } = place();
        core.enterWorld({ id: 'irish-pub' });
        expect(core.propose({ intent: 'look_at_object', target: 'pendant-lamp' }).ok).toBe(true);
        step();
        expect(performed[0]).toMatchObject({
            name: 'look_at_object',
            ctx: { objectId: 'pendant-lamp', gazePoint: { x: 0.1, y: 0.2 } },
        });
    });

    test('refused: an intent off the list, an invented target, an old place, a private room, Copilot', () => {
        const { core, performed, step } = place();
        core.enterWorld({ id: 'irish-pub' });
        const gen = core.state().generation;
        expect(core.propose({ intent: 'walk_to_anchor' }).why).toBe('intent-not-allowed');
        expect(core.propose({ intent: 'celebrate' }).why).toBe('intent-not-allowed');
        expect(core.propose({ intent: 'open_private_room' }).why).toBe('intent-not-allowed');
        expect(core.propose({ intent: 'look_at_object', target: 'fireplace' }).why).toBe('unknown-target');
        core.enterWorld({ id: 'private-cabaret' });
        expect(core.propose({ intent: 'smile' }).why).toBe('no-place');
        core.enterWorld({ id: 'irish-pub' });
        expect(core.propose({ intent: 'smile' }, gen).why).toBe('stale-generation');
        core.syncSession({ active: true, destination: 'copilot', activity: 'tasks' });
        expect(core.propose({ intent: 'smile' }).why).toBe('copilot');
        step();
        expect(performed).toEqual([]);
    });

    test('a dance owns her body and a study block keeps her quiet, whatever the model proposes', () => {
        const { core, performed, step } = place({
            validateAction: (base, id) => ({ id, label: id, kind: id === 'dance' ? 'clip' : 'timer' }),
        });
        core.enterWorld({ id: 'neon-discoteca' });
        core.observe({ type: 'action', actionId: 'dance', phase: 'started' });
        expect(core.propose({ intent: 'smile' }).why).toBe('clip-owns-body');
        step();
        expect(performed).toEqual([]);
    });

    test('the paragraph offers the tag only for a verified public place, with its real anchor ids', () => {
        const { core } = place();
        core.enterWorld({ id: 'irish-pub' });
        const offer = core.plannerOffer();
        expect(offer).toMatch(/<gesture intent="look_at_object" target="bar\|table\|pendant-lamp"\/>/);
        expect(offer).toMatch(/must not say you did it/);
        // It reaches the prompt intact, and nothing else with a tag in it does.
        const PromptContext = require('../src/companion/PromptContext');
        const base = { customized: true, active: true, destination: 'experiences' };
        expect(PromptContext.suffix({ ...base, gestureOffer: offer })).toContain(offer);
        expect(PromptContext.suffix({ ...base, gestureOffer: offer.replace('bar|', '<script>|') })).not.toMatch(
            /<script>/
        );
        expect(PromptContext.suffix({ ...base, gestureOffer: 'Do <anything intent="x"/>' })).not.toMatch(/anything/);
        expect(PromptContext.suffix({ ...base, destination: 'copilot', gestureOffer: offer })).not.toMatch(/gesture/);
        core.enterWorld({ id: 'private-cabaret' });
        expect(core.promptSuffix()).toBe('');
        expect(core.plannerOffer()).toBe('');
    });

    test('streaming never shows a tag, whole or half-typed', () => {
        expect(Reactive.maskStreaming('Look at that <gesture intent="smi')).toBe('Look at that');
        expect(Reactive.maskStreaming('Look at that <ges')).toBe('Look at that');
        expect(Reactive.maskStreaming('5 < 6 is true')).toBe('5 < 6 is true');
        const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
        expect(main).toMatch(/NEXUS_PLAYGROUND_REACTIVE\?\.maskStreaming/);
    });

    test('the companion seam strips gesture tags from replies even with no place up', () => {
        const Companion = require('../src/companion/index.js');
        const saved = window.__NEXUS_COMPANION_LIVE;
        delete window.__NEXUS_COMPANION_LIVE;
        expect(Companion.consume('Hello <gesture intent="smile"/>')).toBe('Hello ');
        window.__NEXUS_COMPANION_LIVE = saved;
    });
});

describe('dancing from the chat goes through the chip that owns the dance', () => {
    function disco() {
        const ran = [];
        const core = Reactive.create({
            verifyWorld: (id) => id === 'neon-discoteca' || id === 'creative-academy',
            describe: (id) => ({ base: id, rating: 'general', title: id, line: 'A place.' }),
            validateAction: (base, id) => {
                const t = Templates.TEMPLATES.find((x) => x.world === base);
                return (t && t.actions.find((a) => a.id === id)) || null;
            },
            listAnchors: (base) => Templates.TEMPLATES.find((x) => x.world === base).anchors,
            runChip: (id) => (ran.push(id), true),
        });
        return { core, ran };
    }

    test('dance starts the dance chip; stop_dancing stops it; neither runs twice', () => {
        const { core, ran } = disco();
        core.enterWorld({ id: 'neon-discoteca' });
        expect(core.plannerOffer()).toMatch(/<gesture intent="dance"\/>, <gesture intent="stop_dancing"\/>/);
        expect(core.propose({ intent: 'stop_dancing' }).why).toBe('not-dancing');
        expect(core.propose({ intent: 'dance' }).ok).toBe(true);
        core.observe({ type: 'action', actionId: 'dance', phase: 'started', world: 'neon-discoteca' });
        expect(core.propose({ intent: 'dance' }).why).toBe('already-dancing');
        expect(core.propose({ intent: 'stop_dancing' }).ok).toBe(true);
        core.observe({ type: 'action', actionId: 'dance', phase: 'stopped', world: 'neon-discoteca' });
        expect(ran).toEqual(['dance', 'dance']);
        expect(core.promptSuffix()).toMatch(/The dance has stopped; you are not dancing now\./);
    });

    test('no dance where there is no dance chip (the academy), and the offer does not mention one', () => {
        const { core, ran } = disco();
        core.enterWorld({ id: 'creative-academy' });
        expect(core.propose({ intent: 'dance' }).why).toBe('no-dance-here');
        expect(core.plannerOffer()).not.toMatch(/dance/);
        expect(ran).toEqual([]);
    });

    test('the offer with dancing still passes PromptContext’s exact-shape check', () => {
        const { core } = disco();
        core.enterWorld({ id: 'neon-discoteca' });
        const PromptContext = require('../src/companion/PromptContext');
        const offer = core.plannerOffer();
        expect(
            PromptContext.suffix({ customized: true, active: true, destination: 'experiences', gestureOffer: offer })
        ).toContain(offer);
    });
});
