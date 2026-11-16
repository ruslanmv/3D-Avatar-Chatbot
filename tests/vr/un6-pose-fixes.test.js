/**
 * UN6. The pose fixes found on the real avatar (2026-11-15), locked where jsdom can see them.
 *
 * What the renderer showed is checked by tools/qa/private-pose-render-audit.mjs; these lock the
 * causes: the sign of the trunk in the two standing bends, the roll that put "on her side" on
 * her back, the distinct hands-and-knees route, and the crouch after "alzati".
 */
const fs = require('fs');
const path = require('path');

const source = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const block = (code, name) => {
    const begin = code.indexOf('    ' + name + ': {');
    const end = code.indexOf('\n    },', begin);
    return begin === -1 || end === -1 ? null : code.slice(begin, end + 7);
};
const euler = (blk, bone) => {
    const m = new RegExp(`\\b${bone}: eulerDegToQuat\\((-?[\\d.]+), (-?[\\d.]+), (-?[\\d.]+)\\)`).exec(blk);
    return m ? m.slice(1).map(Number) : null;
};

describe('UN6 shared preset definitions (VRPoseSystem is their only owner)', () => {
    const engine = source('src/gltf-viewer/VRPoseSystem.js');

    test('bent over: the trunk flexes forward (negative X) and the thighs undo the hinge', () => {
        const b = block(engine, 'standingBendForward');
        expect(euler(b, 'hips')[0]).toBeLessThan(-20);
        expect(euler(b, 'spine')[0]).toBeLessThan(0);
        // Legs stay under her: the thigh counter-rotation is within 10° of the hinge.
        expect(Math.abs(euler(b, 'hips')[0] + euler(b, 'leftUpperLeg')[0])).toBeLessThanOrEqual(10);
        // Arms hang: well below the T-pose, not 25° under it.
        expect(euler(b, 'leftUpperArm')[2]).toBeGreaterThan(60);
        expect(euler(b, 'rightUpperArm')[2]).toBeLessThan(-60);
    });

    test('bent backward: the spine extends (positive X) and the arms are down', () => {
        const b = block(engine, 'standingBentBackward');
        expect(euler(b, 'spine')[0]).toBeGreaterThan(0);
        expect(euler(b, 'chest')[0]).toBeGreaterThan(0);
        expect(euler(b, 'leftUpperArm')[2]).toBeGreaterThan(60);
        expect(euler(b, 'rightUpperArm')[2]).toBeLessThan(-60);
    });

    test('on her side: a roll about Z only — an X turn after it put her chest to the ceiling', () => {
        const b = block(engine, 'lyingSide');
        expect(euler(b, 'hips')).toEqual([0, 0, -90]);
        expect(b).toMatch(/support: \{ ground: \[/);
    });

    test('hands and knees rests on its knees and places its hands; the standing bends are untouched', () => {
        const hk = block(engine, 'handsKnees');
        expect(hk).toMatch(
            /support: \{ ground: \['leftLowerLeg', 'rightLowerLeg'\], reach: \['leftHand', 'rightHand'\] \}/
        );
        expect(euler(hk, 'hips')).toEqual([-78, 0, 0]);
        expect(block(engine, 'allFoursArched')).not.toMatch(/support:/);
        expect(block(engine, 'doggyStyle')).not.toMatch(/support:/);
        // The hand contact is the arm chain's IK, never a hips move.
        const place = engine.slice(engine.indexOf('_placeSupportHands() {'), engine.indexOf('_lowestJointY() {'));
        expect(place).toMatch(/solveCCDIK\(chain, target/);
        expect(place).not.toMatch(/hipsBone|_hipsPositionTo/);
    });
});

describe('UN6 Private routing', () => {
    test('"all fours" is the distinct handsKnees preset, adult-gated', () => {
        const Poses = require('../../src/experiences/private/PrivatePoseController.js');
        expect(Poses.POSES['all-fours']).toEqual({ preset: 'handsKnees', adult: true });
    });

    test('letting go of a Private position leaves the chat motion stack standing', () => {
        const Poses = require('../../src/experiences/private/PrivatePoseController.js');
        const motion = { state: { sitting: false, laying: true }, holdForPoseStudio: jest.fn() };
        const vps = {
            claimBones: jest.fn(),
            releaseBones: jest.fn(),
            applyPreset: jest.fn(),
            getCurrentPreset: () => 'lyingSide',
            getPresetList: () => [{ name: 'lyingSide' }],
        };
        const c = Poses.create({ win: { NEXUS_MOTION: motion }, system: vps });
        expect(c.apply('lie-side').ok).toBe(true);
        c.release();
        expect(motion.state).toEqual({ sitting: false, laying: false });
        expect(motion.holdForPoseStudio).toHaveBeenLastCalledWith(false);
    });

    test('the motion fast path stands aside for words Private turns into a position', () => {
        require('../../src/xr/MotionBlockParser');
        require('../../src/xr/IntentFastPath');
        const MI = require('../../src/xr/MotionIntegration');
        const Policy = require('../../src/xr/MotionPolicy');
        Policy._setOverride({ enabled: true, movement: 'all' });
        window.NEXUS_PRIVATE_ACTIONS = { ownsBody: (t) => /sdraiati/i.test(t) };
        try {
            const before = MI.getTelemetry().utterances;
            MI.onUserUtterance('Sdraiati sul fianco');
            expect(MI.getTelemetry().utterances).toBe(before);
            MI.onUserUtterance('dance');
            expect(MI.getTelemetry().utterances).toBe(before + 1);
        } finally {
            delete window.NEXUS_PRIVATE_ACTIONS;
            Policy._setOverride(null);
        }
    });
});
