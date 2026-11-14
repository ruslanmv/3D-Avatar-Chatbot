/**
 * Grounded hands-and-knees candidate — structural review gates.
 *
 * These checks deliberately do NOT claim ground-contact accuracy. The real VRM
 * four-contact and screenshots test is tools/qa/hands-knees-visual-audit.mjs.
 */
const fs = require('fs');
const path = require('path');

const source = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const presetBlock = (code, name) => {
    const begin = code.indexOf('    ' + name + ': {');
    if (begin === -1) return null;
    const end = code.indexOf('\n    },', begin);
    return end === -1 ? null : code.slice(begin, end + 7);
};

describe('Hands-and-knees experimental pose isolation', () => {
    const engine = source('src/gltf-viewer/VRPoseSystem.js');
    const navigator = source('src/PoseStudioPanel.js');

    test('adds a distinct, restricted pose without changing the standing forward bends', () => {
        const grounded = presetBlock(engine, 'handsKnees');
        const bend = presetBlock(engine, 'allFoursArched');
        const oldAdult = presetBlock(engine, 'doggyStyle');

        expect(grounded).not.toBeNull();
        expect(bend).not.toBeNull();
        expect(oldAdult).not.toBeNull();
        expect(grounded).toContain('adult: true');
        expect(grounded).toContain("label: 'Hands and Knees (Candidate)'");
        expect(grounded).not.toMatch(/^\\s*hipsPosition:\\s*\\{/m);
        expect(bend).toContain("label: 'Bent Forward (Arched)'");
        expect(oldAdult).toContain("label: 'Doggy Style'");
        expect(bend).not.toEqual(grounded);
        expect(oldAdult).not.toEqual(grounded);
    });

    test('specifies a pitched trunk, flexed knees, and both upper and lower arms', () => {
        const candidate = presetBlock(engine, 'handsKnees');
        for (const bone of [
            'hips',
            'spine',
            'chest',
            'leftUpperLeg',
            'rightUpperLeg',
            'leftLowerLeg',
            'rightLowerLeg',
            'leftUpperArm',
            'rightUpperArm',
            'leftLowerArm',
            'rightLowerArm',
            'leftHand',
            'rightHand',
        ]) {
            expect(candidate).toContain(bone + ': eulerDegToQuat(');
        }
        expect(candidate).toContain('hips: eulerDegToQuat(-78, 0, 0)');
        expect(candidate).toContain('leftLowerLeg: eulerDegToQuat(-99, 0, 0)');
        expect(candidate).toContain('rightLowerLeg: eulerDegToQuat(-99, 0, 0)');
    });

    test('uses the same adult restriction in preset order and Pose Studio navigator', () => {
        expect(engine).toContain("    'handsKnees',");
        expect(navigator).toContain(
            "{ name: 'handsKnees', label: 'Hands and Knees (Candidate)', category: 'Ground', adult: true }"
        );
        expect(engine.split("    'handsKnees',").length - 1).toBe(1);
        expect(navigator.split("name: 'handsKnees'").length - 1).toBe(1);
    });

    test('reuses existing ground settlement, skeleton ownership, and reset paths', () => {
        expect(engine).toContain('_groundSettledPose() {');
        expect(engine).toContain('this._groundPending = !preset.hipsPosition;');
        expect(engine).toContain('claimBones() {');
        expect(engine).toContain('releaseBones({ blendSeconds = 0.4 } = {})');
        expect(engine).toContain("this.applyPreset('standing', 0.4);");
    });
});
