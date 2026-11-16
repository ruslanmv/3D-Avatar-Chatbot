/**
 * AC4. Letting go of a position in Private gives her own idle back.
 *
 * The real controller and the real PuppetSkeleton claim, with a stand-in animator that keeps
 * ProceduralAnimator's flag semantics (src/ProceduralAnimator.js `setEditMode` / `setPoseMode`):
 * pose mode implies edit mode, leaving pose mode leaves edit mode on, and an animator in edit mode
 * and not in pose mode returns early every frame. Before this batch a Private pose, once released,
 * left the animator in exactly that state: her bones went back and her idle never moved her again.
 */

/* global describe, test, expect, beforeEach, jest */

const Poses = require('../../src/experiences/private/PrivatePoseController.js');
const PS = require('../../src/gltf-viewer/PuppetSkeleton.js');

function animator(initial = {}) {
    let poseMode = Boolean(initial.poseMode);
    let editMode = Boolean(initial.editMode) || poseMode;
    return {
        isPoseMode: () => poseMode,
        isEditMode: () => editMode,
        setPoseMode: (on) => {
            poseMode = !!on;
            if (on) editMode = true;
        },
        setEditMode: (on) => {
            editMode = !!on;
            if (!on) poseMode = false;
        },
        /** What ProceduralAnimator.update() does with these flags: runs unless this is true. */
        frozen: () => editMode && !poseMode,
    };
}

function world(initial) {
    const anim = animator(initial);
    const skeleton = PS.create({ animator: () => anim });
    let preset = null;
    const hold = jest.fn();
    const vps = {
        getPresetList: () => [{ name: 'kneeling' }, { name: 'lyingBack' }, { name: 'handsKnees' }],
        applyPreset: jest.fn((name) => {
            preset = name === 'refused' ? preset : name;
        }),
        getCurrentPreset: () => preset,
        claimBones: () => skeleton.claim(),
        releaseBones: (o) => skeleton.release(o),
    };
    const win = {
        NEXUS_PROCEDURAL_ANIMATOR: anim,
        NEXUS_MOTION: { holdForPoseStudio: hold, state: { sitting: true, laying: true } },
        NEXUS_CLIP_LOADER: { stopClip: jest.fn() },
        NEXUS_ANIMATION_RESOLVER: { stop: jest.fn() },
        setTimeout,
    };
    const poses = Poses.create({ win, system: vps });
    return { anim, hold, vps, poses, win };
}

describe('AC4: a released pose hands the animator back', () => {
    test('standing up leaves her idle running, not frozen in edit mode', () => {
        const w = world();
        expect(w.poses.apply('kneel')).toEqual({ ok: true, pose: 'kneel' });
        expect(w.anim.isPoseMode()).toBe(true);
        w.poses.release();
        expect(w.anim.isPoseMode()).toBe(false);
        expect(w.anim.isEditMode()).toBe(false);
        expect(w.anim.frozen()).toBe(false);
        expect(w.hold).toHaveBeenLastCalledWith(false);
    });

    test('changing position and then standing up is still a clean hand-back', () => {
        const w = world();
        w.poses.apply('kneel');
        w.poses.apply('lie-back');
        expect(w.poses.held()).toBe('lie-back');
        w.poses.back();
        expect(w.poses.held()).toBe('kneel');
        w.poses.release();
        expect(w.anim.frozen()).toBe(false);
        expect(w.anim.isEditMode()).toBe(false);
    });

    test('a first pose that fails does not leave her in pose mode with her motion on hold', () => {
        const w = world();
        w.vps.applyPreset = jest.fn(); // the system never reaches the preset
        const out = w.poses.apply('kneel');
        expect(out).toEqual({ ok: false, why: 'not-applied' });
        expect(w.poses.held()).toBeNull();
        expect(w.anim.isPoseMode()).toBe(false);
        expect(w.anim.frozen()).toBe(false);
        expect(w.hold).toHaveBeenLastCalledWith(false);
    });

    test('a pose system that throws is the same: nothing is left switched on', () => {
        const w = world();
        w.vps.applyPreset = jest.fn(() => {
            throw new Error('no skeleton');
        });
        expect(w.poses.apply('kneel')).toEqual({ ok: false, why: 'pose-failed' });
        expect(w.anim.frozen()).toBe(false);
        expect(w.anim.isEditMode()).toBe(false);
    });

    test('pose mode that was already on (Pose Studio is open) is not ended by Private', () => {
        const w = world({ poseMode: true });
        w.poses.apply('kneel');
        w.poses.release();
        expect(w.anim.isPoseMode()).toBe(true);
        expect(w.hold).toHaveBeenLastCalledWith(true);
    });

    test('releasing with nothing held and nothing entered changes nothing', () => {
        const w = world();
        expect(w.poses.release()).toBe(false);
        expect(w.anim.isPoseMode()).toBe(false);
        expect(w.anim.isEditMode()).toBe(false);
    });
});
