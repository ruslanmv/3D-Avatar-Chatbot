/**
 * UN23 + UN24. Pose changes travel through her body (PoseTransition), and the seated / kneeling
 * open-knees presets exist where they must — and only as adult presets.
 *
 * Properties, not exact numbers: a later retune of the stretch or the delays should not fail
 * these, a blend that jolts, ends late or ignores distance should.
 */
const fs = require('fs');
const path = require('path');
const PT = require('../src/gltf-viewer/PoseTransition.js');

const DEG = Math.PI / 180;

function quatAboutX(deg) {
    const h = (deg * DEG) / 2;
    return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
}

describe('UN23 PoseTransition', () => {
    test('exposes a global for VRPoseSystem', () => {
        expect(globalThis.NEXUS_POSE_TRANSITION).toBe(PT);
    });

    test('weight runs 0 → 1, monotonic, and lands with zero slope at both ends', () => {
        let prev = -1;
        for (let i = 0; i <= 100; i++) {
            const w = PT.weight(i / 100, 0);
            expect(w).toBeGreaterThanOrEqual(prev);
            prev = w;
        }
        expect(PT.weight(0, 0)).toBe(0);
        expect(PT.weight(1, 0)).toBe(1);
        const eps = 1e-3;
        expect(PT.weight(eps, 0) / eps).toBeLessThan(0.01);
        expect((1 - PT.weight(1 - eps, 0)) / eps).toBeLessThan(0.01);
    });

    test('the trunk leads and hands and feet follow, and every bone arrives at t = 1', () => {
        const hips = PT.delayFor('hips');
        const thigh = PT.delayFor('leftUpperLeg');
        const knee = PT.delayFor('leftLowerLeg');
        const hand = PT.delayFor('rightHand');
        expect(hips).toBe(0);
        expect(thigh).toBeGreaterThan(hips);
        expect(knee).toBeGreaterThan(thigh);
        expect(hand).toBeGreaterThan(knee);
        expect(PT.weight(0.1, hand)).toBe(0);
        expect(PT.weight(0.5, hips)).toBeGreaterThan(PT.weight(0.5, hand));
        for (const key of ['hips', 'neck', 'head', 'leftLowerArm', 'rightFoot', 'leftIndexProximal']) {
            expect(PT.weight(1, PT.delayFor(key))).toBe(1);
        }
    });

    test('a small change keeps the caller duration; a large one takes longer, within the cap', () => {
        expect(PT.durationFor(0.5, 20 * DEG, 0)).toBe(0.5);
        const big = PT.durationFor(0.5, 120 * DEG, 0);
        const bigger = PT.durationFor(0.5, 170 * DEG, 0.45);
        expect(big).toBeGreaterThan(0.5);
        expect(bigger).toBeGreaterThan(big);
        expect(bigger).toBeLessThanOrEqual(PT.MAX_SECONDS);
        expect(PT.durationFor(0.5, 180 * DEG, 10)).toBeLessThanOrEqual(PT.MAX_SECONDS);
    });

    test('instant stays instant and bad input gives the caller duration back', () => {
        expect(PT.durationFor(0, 180 * DEG, 1)).toBe(0);
        expect(PT.durationFor(-1, 180 * DEG, 1)).toBe(0);
        expect(PT.durationFor(0.6, NaN, undefined)).toBe(0.6);
        expect(PT.weight(NaN, 0)).toBe(1);
    });

    test('maxAngle reads the largest single-bone rotation between two maps', () => {
        const from = new Map([
            ['hips', quatAboutX(0)],
            ['leftUpperLeg', quatAboutX(0)],
        ]);
        const to = new Map([
            ['hips', quatAboutX(30)],
            ['leftUpperLeg', quatAboutX(90)],
        ]);
        expect(PT.maxAngle(from, to) / DEG).toBeCloseTo(90, 5);
        expect(PT.maxAngle(null, to)).toBe(0);
    });
});

describe('UN25 transition speed', () => {
    beforeEach(() => {
        localStorage.clear();
        PT.reset();
    });
    afterAll(() => {
        localStorage.clear();
        PT.reset();
    });

    test('Normal by default; Slow is longer and Fast shorter for the same change', () => {
        expect(PT.getSpeed()).toBe('normal');
        const normal = PT.durationFor(0.5, 150 * DEG, 0.3);
        PT.setSpeed('slow');
        const slow = PT.durationFor(0.5, 150 * DEG, 0.3);
        PT.setSpeed('fast');
        const fast = PT.durationFor(0.5, 150 * DEG, 0.3);
        expect(slow).toBeGreaterThan(normal);
        expect(fast).toBeLessThan(normal);
        expect(fast).toBeGreaterThan(0);
    });

    test('instant stays instant at every speed', () => {
        for (const name of Object.keys(PT.SPEEDS)) {
            PT.setSpeed(name);
            expect(PT.durationFor(0, 180 * DEG, 1)).toBe(0);
        }
    });

    test('the choice survives a reload, and an unknown one is refused', () => {
        PT.setSpeed('slow');
        PT.reset(); // as a new page would
        expect(PT.getSpeed()).toBe('slow');
        expect(PT.setSpeed('warp')).toBe('slow');
        localStorage.setItem(PT.SPEED_KEY, 'warp');
        PT.reset();
        expect(PT.getSpeed()).toBe('normal');
    });
});

describe('UN24 + UN26 open-knees presets', () => {
    const vps = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRPoseSystem.js'), 'utf8');
    const panel = fs.readFileSync(path.join(__dirname, '../src/PoseStudioPanel.js'), 'utf8');
    const order = vps.slice(
        vps.indexOf('const PRESET_ORDER = ['),
        vps.indexOf('];', vps.indexOf('const PRESET_ORDER'))
    );

    for (const name of ['sittingOpen', 'floorOpen', 'kneelingWide', 'lyingKneesUp', 'straddle']) {
        test(`${name} is defined as adult, in the cycle and in Pose Studio as adult`, () => {
            const at = vps.indexOf(`    ${name}: {`);
            expect(at).toBeGreaterThan(0);
            const head = vps.slice(at, at + 200);
            expect(head).toMatch(/adult: true/);
            expect(head).not.toMatch(/hipsPosition/); // grounded by measurement, never typed
            expect(order).toContain(`'${name}'`);
            expect(panel).toMatch(new RegExp(`name: '${name}'[^}]*adult: true`));
        });
    }

    test('VRPoseSystem loads PoseTransition', () => {
        expect(vps).toMatch(/import '\.\/PoseTransition\.js'/);
    });
});
