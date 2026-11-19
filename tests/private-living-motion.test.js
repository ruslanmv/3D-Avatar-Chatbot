/**
 * LM1. Her body alive in a held position: breathing, rocking, arching, her head back at the finish,
 * and her own hands, from the evening's step. Properties, not numbers: a retune of an amplitude
 * must not fail these; a still body, a hand that opens before its step, a knee that slides when
 * her pelvis rolls, or an arch that goes the wrong way on a model facing the other way, must.
 */
const THREE = require('../vendor/three-0.147.0/build/three.min.js');
const Living = require('../src/experiences/private/PrivateLivingMotion.js');

/** Run a stepper for `seconds` at 60 fps and collect what `pick` reads off each frame. */
function run(ctx, seconds, pick) {
    const st = Living.create();
    const out = [];
    for (let i = 0; i < seconds * 60; i += 1) {
        const f = st.step(1 / 60, typeof ctx === 'function' ? ctx(i / 60) : ctx);
        out.push(pick(f, i / 60));
    }
    return out;
}
const span = (xs) => Math.max(...xs) - Math.min(...xs);

describe('LM1 the stepper: what her body does, from the evening', () => {
    test('she breathes in every position, deeper as the evening comes closer', () => {
        const breath = (level) => span(run({ pose: 'kneel', level }, 20, (f) => f.upperChest[0]).slice(600));
        expect(breath(1)).toBeGreaterThan(0.01);
        expect(breath(4)).toBeGreaterThan(breath(1) * 1.8);
        // standing between positions she still breathes (the layer only runs while held)
        expect(span(run({ pose: null, level: 2 }, 10, (f) => f.upperChest[0]))).toBeGreaterThan(0.01);
    });

    test('riding and from behind, her pelvis rocks from the third step, harder at the closest', () => {
        const rock = (pose, level) => span(run({ pose, level }, 30, (f) => f.pelvis).slice(900));
        expect(rock('straddle', 2)).toBeLessThan(0.01);
        expect(rock('straddle', 3)).toBeGreaterThan(0.03);
        expect(rock('straddle', 4)).toBeGreaterThan(rock('straddle', 3));
        expect(rock('all-fours', 4)).toBeGreaterThan(0.08);
        // a position without rocking only breathes
        expect(rock('lie-side', 4)).toBeLessThan(rock('all-fours', 4) / 2);
    });

    test('at the finish her head goes back and her lips part, then it ebbs', () => {
        const head = (since) => run({ pose: 'straddle', level: 4, sinceFinish: since }, 3, (f) => f)[179];
        const before = head(null);
        const peak = head(5);
        const later = head(25);
        expect(peak.head[0] - before.head[0]).toBeGreaterThan(0.2);
        expect(peak.face.oh).toBeGreaterThan(before.face.oh);
        expect(Math.abs(later.head[0] - before.head[0])).toBeLessThan(0.05);
        expect(Living.climax(null)).toBe(0);
        expect(Living.climax(5)).toBe(1);
    });

    test('at the closest step it keeps building over minutes, never past 1', () => {
        expect(Living.arousal(4, 0)).toBeLessThan(Living.arousal(4, 120));
        expect(Living.arousal(4, 1e6)).toBeLessThanOrEqual(1);
        for (let l = 1; l < 4; l += 1) expect(Living.arousal(l + 1, 0)).toBeGreaterThan(Living.arousal(l, 0));
    });

    test('care mode: she breathes, nothing more', () => {
        const frames = run({ pose: 'sit-open', level: 4, care: true, sinceFinish: 4 }, 30, (f) => f);
        expect(span(frames.map((f) => f.pelvis))).toBeLessThan(0.005);
        expect(frames.every((f) => !f.hands.left.place && !f.hands.right.place)).toBe(true);
        expect(frames.every((f) => f.face.oh === 0 && f.face.relaxed === 0)).toBe(true);
        expect(span(frames.slice(600).map((f) => f.upperChest[0]))).toBeGreaterThan(0.005);
    });
});

describe('LM2 her hands: where they go, and when', () => {
    const places = (pose, level, seconds = 90) =>
        new Set(
            run({ pose, level }, seconds, (f) =>
                ['left', 'right'].map((s) => (f.hands[s].weight > 0.5 ? f.hands[s].place : null))
            )
                .flat()
                .filter(Boolean)
        );

    test('nothing below the third step', () => {
        expect(places('sit-open', 1).size).toBe(0);
        expect(places('sit-open', 2).size).toBe(0);
    });

    test('from the third step: her breast and her belly, one hand then both', () => {
        const at3 = places('sit-open', 3);
        expect([...at3].sort()).toEqual(['belly', 'chest']);
        for (const p of at3) expect(Living.PLACE_LEVEL[p]).toBeLessThanOrEqual(3);
    });

    test('only the places that measured right are ever offered', () => {
        for (const pose of Object.keys(Living.STYLE))
            for (const p of places(pose, 4, 60)) expect(Object.keys(Living.PLACE_LEVEL)).toContain(p);
    });

    test('hands that hold her up or hold them are never taken', () => {
        for (const pose of ['all-fours', 'straddle', 'lie-side', null]) expect(places(pose, 4).size).toBe(0);
    });

    test('a new position waits a moment before her hands move, and they ease in', () => {
        const w = run({ pose: 'sit-open', level: 4 }, 6, (f) => Math.max(f.hands.left.weight, f.hands.right.weight));
        expect(w.slice(0, 120).every((x) => x === 0)).toBe(true); // the first two seconds
        // eased, never a jump: no frame moves the weight by more than a tenth
        for (let i = 1; i < w.length; i += 1) expect(Math.abs(w[i] - w[i - 1])).toBeLessThan(0.1);
    });

    test('what the model is told is what the frame shows', () => {
        const f = run({ pose: 'sit-open', level: 4 }, 40, (x) => x).find(
            (x) => x.hands.left.weight > 0.9 && x.hands.left.place
        );
        const said = Living.describe(f);
        expect(said).toContain('your left hand');
        expect(said).toContain(Living.PLACE_WORDS[f.hands.left.place]);
        expect(
            Living.describe({ hands: { left: { place: null, weight: 0 }, right: { place: null, weight: 0 } } })
        ).toBeNull();
    });
});

/**
 * A little humanoid on the vendored three.js, the normalized rig's shape: identity rests, T-pose,
 * facing +Z (VRM 1.0). `turned` puts her inside a root turned half round, as a VRM 0.x is.
 */
function body(turned) {
    const root = new THREE.Group();
    if (turned) root.rotation.y = Math.PI;
    const b = {};
    const add = (name, parent, x, y, z) => {
        const n = new THREE.Bone();
        n.name = name;
        n.position.set(x, y, z);
        (parent ? b[parent] : root).add(n);
        b[name] = n;
    };
    add('hips', null, 0, 0.95, 0);
    add('spine', 'hips', 0, 0.1, 0);
    add('chest', 'spine', 0, 0.12, 0);
    add('upperChest', 'chest', 0, 0.12, 0);
    add('neck', 'upperChest', 0, 0.12, 0);
    add('head', 'neck', 0, 0.09, 0);
    for (const [side, x] of [
        ['left', 1],
        ['right', -1],
    ]) {
        add(side + 'UpperLeg', 'hips', 0.09 * x, -0.06, 0);
        add(side + 'LowerLeg', side + 'UpperLeg', 0, -0.42, 0);
        add(side + 'Shoulder', 'upperChest', 0.03 * x, 0.08, 0);
        add(side + 'UpperArm', side + 'Shoulder', 0.1 * x, 0, 0);
        add(side + 'LowerArm', side + 'UpperArm', 0.26 * x, 0, 0);
        add(side + 'Hand', side + 'LowerArm', 0.24 * x, 0, 0);
        add(side + 'MiddleProximal', side + 'Hand', 0.08 * x, 0, 0);
        add(side + 'IndexProximal', side + 'Hand', 0.075 * x, 0, 0.025);
        add(side + 'LittleProximal', side + 'Hand', 0.065 * x, 0, -0.025);
    }
    root.updateMatrixWorld(true);
    return { root, b };
}

/** A plain CCD for the arm, standing in for the pose system's (VRPoseSystem's solveCCDIK). */
function ccd(chain, target) {
    const end = chain[chain.length - 1];
    const e = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let it = 0; it < 30; it += 1) {
        for (let i = chain.length - 2; i >= 0; i -= 1) {
            end.getWorldPosition(e);
            chain[i].getWorldPosition(p);
            const a = e.clone().sub(p).normalize();
            const t = target.clone().sub(p).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(a, t);
            const pq = new THREE.Quaternion();
            chain[i].parent.getWorldQuaternion(pq);
            chain[i].quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
            chain[i].updateMatrixWorld(true);
        }
    }
}

function rigOf(b) {
    return {
        bone: (k) => b[k] || null,
        node: (k) => b[k] || null,
        solveArm: (side, target) => ccd([b[side + 'UpperArm'], b[side + 'LowerArm'], b[side + 'Hand']], target),
    };
}
const world = (n) => n.getWorldPosition(new THREE.Vector3());

describe('LM1 applied to her rig: directions from her own bones', () => {
    const still = (over) =>
        Object.assign(
            {
                pelvis: 0,
                spine: [0, 0, 0],
                chest: [0, 0, 0],
                upperChest: [0, 0, 0],
                neck: [0, 0, 0],
                head: [0, 0, 0],
                hands: { left: { place: null, weight: 0 }, right: { place: null, weight: 0 } },
                stroke: [0, 0],
            },
            over
        );

    for (const turned of [false, true]) {
        const label = turned ? 'facing −Z (VRM 0.x)' : 'facing +Z (VRM 1.0)';

        test(`${label}: arching takes her head backwards`, () => {
            const { root, b } = body(turned);
            const frame = Living.bodyFrame(rigOf(b), THREE);
            const before = world(b.head);
            Living.apply(rigOf(b), still({ spine: [0.2, 0, 0], head: [0.3, 0, 0] }), THREE);
            root.updateMatrixWorld(true);
            const moved = world(b.head).sub(before);
            expect(moved.dot(frame.forward)).toBeLessThan(-0.02); // behind her, not in front
        });

        test(`${label}: her pelvis rolls and her knees stay where the pose put them`, () => {
            const { root, b } = body(turned);
            const knee = world(b.leftLowerLeg);
            const head = world(b.head);
            Living.apply(rigOf(b), still({ pelvis: 0.15 }), THREE);
            root.updateMatrixWorld(true);
            expect(world(b.leftLowerLeg).distanceTo(knee)).toBeLessThan(0.002);
            expect(world(b.head).distanceTo(head)).toBeGreaterThan(0.03); // the trunk did move
        });

        test(`${label}: a hand goes to her belly, palm onto her skin`, () => {
            const { b } = body(turned);
            const rig = rigOf(b);
            const done = Living.apply(
                rig,
                still({ hands: { left: { place: 'belly', weight: 1 }, right: { place: null, weight: 0 } } }),
                THREE
            );
            expect(done.hands.left.missMm).toBeLessThan(30);
            const frame = Living.bodyFrame(rig, THREE);
            const spot = Living.placeOf('belly', 'left', frame, THREE);
            // palm normal from its finger bones points into her (against the skin's outward way)
            const hand = world(b.leftHand);
            const fingers = world(b.leftMiddleProximal).sub(hand);
            const across = world(b.leftIndexProximal).sub(world(b.leftLittleProximal));
            const palm = fingers.cross(across).normalize();
            expect(palm.dot(spot.out)).toBeLessThan(-0.7);
            // and the right hand, with nothing to do, did not move
            expect(done.hands.right).toBeUndefined();
        });
    }

    test('a hand at weight 0 leaves the arm exactly as the pose had it', () => {
        const { b } = body(false);
        const before = b.leftUpperArm.quaternion.clone();
        Living.apply(
            rigOf(b),
            still({ hands: { left: { place: 'chest', weight: 0 }, right: { place: null, weight: 0 } } }),
            THREE
        );
        expect(b.leftUpperArm.quaternion.equals(before)).toBe(true);
    });

    test('every bone it moves is one the pose system saves and restores', () => {
        const { b } = body(false);
        const seen = new Map(Object.entries(b).map(([k, n]) => [k, n.quaternion.clone()]));
        const st = Living.create();
        let f;
        for (let i = 0; i < 1200; i += 1) f = st.step(1 / 60, { pose: 'sit-open', level: 4, sinceFinish: 3 });
        f.hands.left = { place: 'chest', weight: 1 };
        f.hands.right = { place: 'between', weight: 1 };
        Living.apply(rigOf(b), f, THREE);
        const changed = Object.keys(b).filter((k) => !b[k].quaternion.equals(seen.get(k)));
        expect(changed.length).toBeGreaterThan(5);
        for (const k of changed) expect(Living.BONES).toContain(k);
    });
});

describe('LM1 attach: the page runtime', () => {
    test('only on a pose system with layers, and detaching takes the layer and her face off', () => {
        expect(Living.attach({ win: {} })).toBeNull();
        let layer = null;
        const vps = { setLayer: (l) => (layer = l), getLayer: () => layer };
        const set = [];
        const win = {
            NEXUS_VIEWER: {
                avatarManager: { _currentVRM: { expressionManager: { setValue: (n, v) => set.push([n, v]) } } },
            },
        };
        const live = Living.attach({ win, system: vps, read: () => ({ pose: 'sit-open', level: 4 }) });
        expect(layer).toBeTruthy();
        const { b } = body(false);
        layer.apply(1 / 60, rigOf(b), THREE);
        expect(set.some(([n, v]) => n === 'relaxed' && v > 0)).toBe(true);
        live.detach();
        expect(layer).toBeNull();
        expect(set.slice(-2).every(([, v]) => v === 0)).toBe(true);
    });

    test('a read that throws is an empty evening, never a broken frame', () => {
        let layer = null;
        const live = Living.attach({
            win: {},
            system: { setLayer: (l) => (layer = l), getLayer: () => layer },
            read: () => {
                throw new Error('gone');
            },
        });
        const { b } = body(false);
        expect(() => layer.apply(1 / 60, rigOf(b), THREE)).not.toThrow();
        live.detach();
    });
});

describe('LM3 the switch in Settings: optional, never removed', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
    });

    test('on by default; off and on again are kept on this device', () => {
        expect(Living.isOn()).toBe(true);
        expect(Living.setOn(false)).toBe(false);
        expect(localStorage.getItem(Living.STORAGE_KEY)).toBe('0');
        expect(Living.isOn()).toBe(false);
        expect(Living.setOn(true)).toBe(true);
        expect(Living.isOn()).toBe(true);
    });

    test('off: the layer draws nothing, her face goes back, the model hears nothing; on again: it is all there', () => {
        let layer = null;
        const set = [];
        const win = {
            NEXUS_VIEWER: {
                avatarManager: { _currentVRM: { expressionManager: { setValue: (n, v) => set.push([n, v]) } } },
            },
        };
        const live = Living.attach({
            win,
            system: { setLayer: (l) => (layer = l), getLayer: () => layer },
            read: () => ({ pose: 'sit-open', level: 4 }),
        });
        const { b } = body(false);
        const rig = rigOf(b);
        for (let i = 0; i < 60 * 40; i += 1) layer.apply(1 / 60, rig, THREE);
        expect(live.frame()).toBeTruthy();
        Living.setOn(false);
        const before = Object.fromEntries(Object.entries(b).map(([k, n]) => [k, n.quaternion.clone()]));
        expect(layer.apply(1 / 60, rig, THREE)).toBeNull();
        for (const [k, q] of Object.entries(before)) expect(b[k].quaternion.equals(q)).toBe(true);
        expect(set.filter(([n]) => n === 'relaxed').pop()[1]).toBe(0);
        expect(live.describe()).toBeNull();
        expect(layer).toBeTruthy(); // still installed: nothing destroyed
        Living.setOn(true);
        expect(layer.apply(1 / 60, rig, THREE)).toBeTruthy();
        live.detach();
    });

    test('the row sits in the Spicy Mode section, once, and drives the switch both ways', () => {
        document.body.innerHTML =
            '<div class="config-section"><h3>SPICY MODE</h3><div class="input-group"><input type="checkbox" id="spicy-mode-toggle"></div></div>';
        const box = Living.mountSetting(document);
        expect(box).toBeTruthy();
        expect(box.closest('.config-section').querySelector('#spicy-mode-toggle')).toBeTruthy();
        expect(box.checked).toBe(true);
        expect(Living.mountSetting(document)).toBe(box);
        expect(document.querySelectorAll('#private-living-toggle')).toHaveLength(1);
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        expect(Living.isOn()).toBe(false);
        Living.setOn(true);
        expect(box.checked).toBe(true);
    });

    test('a page without the Spicy section gets no row, and keeps the default', () => {
        document.body.innerHTML = '<div></div>';
        expect(Living.mountSetting(document)).toBeNull();
        expect(Living.isOn()).toBe(true);
    });
});
