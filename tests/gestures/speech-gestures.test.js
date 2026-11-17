/**
 * SG1. Co-speech gestures: discrete strokes timed to the words, within a budget per device.
 *
 * Properties, not sentences: which gesture a kind of word gets, that strokes land on their word,
 * that phones and headsets get fewer and smaller ones, that stopping speech starts nothing new,
 * and that only her arms, hands, shoulders, head and chest are ever moved.
 */

/* global describe, test, expect, beforeEach */

const fs = require('fs');
const path = require('path');
const SG = require('../../src/features/gestures/SpeechGestures.js');

const ids = (items) => items.map((g) => g.id);

describe('planning', () => {
    test('nothing to say plans nothing', () => {
        expect(SG.plan('')).toEqual([]);
        expect(SG.plan('   ')).toEqual([]);
    });

    test('a greeting waves at the start and a question ends with open palms', () => {
        const items = SG.plan('Hi there! It has been such a long day. Shall we go for a walk later?');
        expect(items[0].id).toBe('wave');
        expect(items[0].at).toBe(0);
        expect(ids(items)).toContain('palmsUp');
    });

    test('words choose meaningful gestures', () => {
        expect(ids(SG.plan('I think this could work.'))).toContain('chinTouch');
        expect(ids(SG.plan('Honestly, I feel so happy today.'))).toContain('handOnChest');
        expect(ids(SG.plan('Maybe we could try it later.'))).toContain('shrug');
        expect(ids(SG.plan('Everything here is new to me.'))).toContain('openArms');
    });

    test('a greeting later in a reply does not wave', () => {
        const items = SG.plan('That was fun. Then she said hello to everyone at the door.');
        expect(ids(items)).not.toContain('wave');
    });

    test('a plain sentence still gets a beat, so she never stands still while talking', () => {
        expect(ids(SG.plan('The weather turned cold this afternoon.'))).toEqual(['beat']);
    });

    test('the stroke peaks on its word, at the lip-sync pace', () => {
        const text = 'Well, the thing about rain is that maybe it helps.';
        const [shrug] = SG.plan(text).filter((g) => g.id === 'shrug');
        const peak = shrug.at + SG.GESTURES.shrug.prep;
        expect(peak).toBeCloseTo(text.indexOf('maybe') / SG.CHARS_PER_SEC, 5);
        // Faster speech, earlier stroke.
        const [fast] = SG.plan(text, { rate: 2 }).filter((g) => g.id === 'shrug');
        expect(fast.at).toBeLessThan(shrug.at);
    });

    test('the same reply always plans the same way', () => {
        const text = 'You know, I think everything will be fine. Maybe not today, but soon!';
        expect(SG.plan(text)).toEqual(SG.plan(text));
    });

    test('strokes keep the minimum gap of their device', () => {
        const text = 'You and you and you. Maybe, maybe. I think so! Everything, all of it, you.'.repeat(3);
        for (const profile of ['desktop', 'mobile', 'vr']) {
            const items = SG.plan(text, { profile });
            for (let i = 1; i < items.length; i += 1) {
                const a = items[i - 1].at + SG.GESTURES[items[i - 1].id].prep;
                const b = items[i].at + SG.GESTURES[items[i].id].prep;
                expect(b - a).toBeGreaterThanOrEqual(SG.PROFILES[profile].minGap - 1e-9);
            }
        }
    });

    test('a headset and a phone get fewer and smaller gestures than a desktop', () => {
        const text =
            'I think you will love it. Honestly, everything about this place is lovely. Maybe we stay? ' +
            'You could show me the garden, and then we talk about your week.';
        const desktop = SG.plan(text, { profile: 'desktop' });
        const vr = SG.plan(text, { profile: 'vr' });
        const mobile = SG.plan(text, { profile: 'mobile' });
        expect(vr.length).toBeLessThanOrEqual(desktop.length);
        expect(mobile.length).toBeLessThanOrEqual(desktop.length);
        expect(Math.max(...vr.map((g) => g.gain))).toBeLessThan(Math.max(...desktop.map((g) => g.gain)));
    });

    test('Italian uses its own table, and English words do nothing there', () => {
        expect(ids(SG.plan('Ciao! Oggi è stata una giornata lunga. Penso che andrà bene.', { lang: 'it-IT' }))).toEqual(
            expect.arrayContaining(['wave', 'chinTouch'])
        );
        expect(ids(SG.plan('Maybe everything.', { lang: 'it' }))).toEqual(['beat']);
    });

    test('self-touches are made with her right hand', () => {
        const items = SG.plan('Hmm, I think so. Honestly, I feel it too.');
        for (const g of items.filter((x) => ['chinTouch', 'handOnChest', 'hairTuck'].includes(x.id))) {
            expect(g.side).toBe('right');
        }
    });
});

describe('poses', () => {
    const ALLOWED = /^(right|left)(Shoulder|UpperArm|LowerArm|Hand)$|^(head|chest)$/;

    test('only her arms, hands, shoulders, head and chest are moved, within safe angles', () => {
        for (const [id, g] of Object.entries(SG.GESTURES)) {
            for (const [bone, v] of Object.entries(g.pose)) {
                expect(`${id}:${bone}`).toMatch(new RegExp(`^${id}:`));
                expect(bone).toMatch(ALLOWED);
                for (const a of v) expect(Math.abs(a)).toBeLessThanOrEqual(1.6);
            }
            if (g.osc) expect(g.osc.bone).toMatch(ALLOWED);
        }
    });

    test('the left side mirrors the right', () => {
        expect(SG.mirror({ rightUpperArm: [0.1, 0.2, -0.3], head: [0.05, 0, 0] })).toEqual({
            leftUpperArm: [0.1, -0.2, 0.3],
            head: [0.05, 0, 0],
        });
    });

    test('a stroke rises, holds and returns to rest', () => {
        const g = SG.GESTURES.palmToYou;
        expect(SG.envelope(g, 0)).toBe(0);
        expect(SG.envelope(g, g.prep / 2)).toBeGreaterThan(0);
        expect(SG.envelope(g, g.prep + g.hold / 2)).toBe(1);
        expect(SG.envelope(g, SG.duration('palmToYou'))).toBe(0);
    });
});

describe('the running clock', () => {
    beforeEach(() => SG.stop());

    test('sample returns offsets during a stroke, the same object each frame, and null when done', () => {
        const count = SG.start('Hi! You look happy.', 1);
        expect(count).toBeGreaterThan(0);
        const t0 = performance.now() / 1000;
        const g = SG.GESTURES.wave;
        const a = SG.sample(t0 + g.prep + 0.05);
        expect(a).not.toBeNull();
        expect(Math.abs(a.rightUpperArm[2])).toBeGreaterThan(0.3);
        const b = SG.sample(t0 + g.prep + 0.1);
        expect(b).toBe(a);
        expect(SG.sample(t0 + 60)).toBeNull();
        expect(SG.active()).toBe(false);
    });

    test('when speech stops, nothing planned after that point starts', () => {
        SG.start('Hello. ' + 'This is a long reply that keeps going, and going. '.repeat(6) + 'Maybe you agree?', 1);
        SG.stop();
        let moved = false;
        const t0 = performance.now() / 1000;
        for (let t = 2; t < 30; t += 0.05) if (SG.sample(t0 + t)) moved = true;
        expect(moved).toBe(false);
    });

    test('the budget follows the device', () => {
        expect(SG.detectProfile({ NEXUS_VIEWER: { renderer: { xr: { isPresenting: true } } } })).toBe('vr');
        expect(SG.detectProfile({ matchMedia: () => ({ matches: true }) })).toBe('mobile');
        expect(SG.detectProfile({ matchMedia: () => ({ matches: false }) })).toBe('desktop');
    });
});

describe('wiring', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

    test('loaded by boot.js, and started and stopped by lip sync, which every speech path calls', () => {
        expect(read('src/behavior/boot.js')).toContain("'src/features/gestures/SpeechGestures.js'");
        const lip = read('src/LipSyncEngine.js');
        expect(lip).toMatch(/function start\(text, rate\)[\s\S]{0,900}NEXUS_SPEECH_GESTURES\?\.start\?\.\(text/);
        expect(lip).toMatch(/function stop\(\)[\s\S]{0,200}NEXUS_SPEECH_GESTURES\?\.stop/);
        // VR chat starts lip sync itself, so it reaches the gestures through the same call.
        expect(read('src/gltf-viewer/VRChatIntegration.js')).toContain('window.NEXUS_LIP_SYNC.start(text, rate)');
    });

    test('ProceduralAnimator runs the layer after its own frame, only where it may (SG3)', () => {
        const animator = read('src/ProceduralAnimator.js');
        expect(animator).toMatch(
            /function update\(timeSec, dtSec\) \{\s*updateCore\(timeSec, dtSec\);[\s\S]{0,900}applySpeechGestures\(/
        );
        const call = animator.slice(
            animator.indexOf('function update(timeSec, dtSec)'),
            animator.indexOf('function updateCore(')
        );
        for (const condition of ["mode === 'talk'", '!poseMode', '!editMode', '!clipOwnsBones']) {
            expect(call).toContain(condition);
        }
        expect(call).toContain('hasBakedAnimations && !allowWithMixer');
        expect(call).toContain('getCurrentPlaybackState?.()?.isPlaying === true');
    });

    test('her bone lookup is untouched: VRoid arms are reached by the layer, not added to the animator (SG3)', () => {
        const animator = read('src/ProceduralAnimator.js');
        const findBones = animator.slice(
            animator.indexOf('function findBones('),
            animator.indexOf('function captureRestPose(')
        );
        expect(findBones).not.toMatch(/armChain|getRawBoneNode\(key\)/);
        expect(animator).toMatch(/function sgResolve\(name\)[\s\S]{0,400}getRawBoneNode\(name\)/);
    });
});

describe('the additive layer (SG3)', () => {
    const THREE = require('../../vendor/three-0.147.0/build/three.min.js');
    const bone = (x = 0.1, y = 0.2, z = -0.3) => ({
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)),
    });
    const close = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w].every((d) => Math.abs(d) < 1e-9);

    test('the same offset applied for many frames does not build up', () => {
        const arm = bone();
        const layer = SG.createLayer(THREE);
        layer.apply({ rightUpperArm: [-0.3, 0, -0.2] }, () => arm);
        const once = arm.quaternion.clone();
        for (let i = 0; i < 500; i += 1) layer.apply({ rightUpperArm: [-0.3, 0, -0.2] }, () => arm);
        expect(close(arm.quaternion, once)).toBe(true);
    });

    test('when the gesture ends her arm is exactly where it was', () => {
        const arm = bone();
        const before = arm.quaternion.clone();
        const layer = SG.createLayer(THREE);
        for (let i = 1; i <= 30; i += 1) layer.apply({ rightUpperArm: [-0.01 * i, 0, 0.02 * i] }, () => arm);
        layer.apply(null, () => arm);
        expect(close(arm.quaternion, before)).toBe(true);
        expect(layer.size()).toBe(0);
    });

    test('a bone that stops moving this frame is handed back, the others keep theirs', () => {
        const upper = bone();
        const lower = bone(0, 0.5, 0);
        const lowerBefore = lower.quaternion.clone();
        const nodes = { rightUpperArm: upper, rightLowerArm: lower };
        const layer = SG.createLayer(THREE);
        layer.apply({ rightUpperArm: [-0.2, 0, 0], rightLowerArm: [0, 0.6, 0] }, (n) => nodes[n]);
        layer.apply({ rightUpperArm: [-0.2, 0, 0] }, (n) => nodes[n]);
        expect(close(lower.quaternion, lowerBefore)).toBe(true);
        expect(layer.size()).toBe(1);
    });

    test('a bone something else rewrote is not undone a second time (a reset, a clip)', () => {
        const arm = bone();
        const layer = SG.createLayer(THREE);
        layer.apply({ rightUpperArm: [-0.3, 0, 0] }, () => arm);
        const rewritten = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
        arm.quaternion.copy(rewritten); // e.g. ProceduralAnimator reset it, or a clip wrote it
        layer.apply({ rightUpperArm: [-0.3, 0, 0] }, () => arm);
        const expected = rewritten.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0)));
        expect(close(arm.quaternion, expected)).toBe(true);
        layer.release();
        expect(close(arm.quaternion, rewritten)).toBe(true);
    });

    test('release hands every bone back, and a missing bone is skipped', () => {
        const arm = bone();
        const before = arm.quaternion.clone();
        const layer = SG.createLayer(THREE);
        layer.apply({ rightUpperArm: [0.2, 0.1, 0], leftHand: [0.1, 0, 0] }, (n) =>
            n === 'rightUpperArm' ? arm : null
        );
        layer.release();
        expect(close(arm.quaternion, before)).toBe(true);
        expect(layer.size()).toBe(0);
    });
});
