/**
 * UI2. Pose Studio fixes found by the UI tour (audits/ui/run.mjs --only pose).
 *
 *  - The Pitch/Yaw/Roll sliders read the bone they drive. They used to start from a cached value
 *    that went stale whenever something else moved the bone, so the first touch snapped the limb
 *    (an upper arm the T-pose correction had lowered 55° read "0°" and jumped back up).
 *  - Applying a preset from the Poses list puts the navigator on that preset in the list it shows.
 *    With Private off the list is filtered, and "T-Pose (Reset)" used to read "Lecturer 1 / 26".
 *  - UI3: the T-pose is an Advanced action, out of the navigator's cycle and the Poses list.
 *  - After an avatar swap, the panel binds the editor to the avatar on stage before acting.
 *  - Close hands focus back to the control that opened the studio.
 */

const THREE = require('../vendor/three-0.147.0/build/three.min.js');

function loadPoseModules() {
    window.THREE = THREE;
    jest.isolateModules(() => {
        require('../src/PoseState.js');
        require('../src/PoseApplier.js');
    });
    return { PoseApplier: window.NEXUS_POSE_APPLIER };
}

function rigWith(keys) {
    const bones = {};
    for (const k of keys) bones[k] = new THREE.Object3D();
    return { bones, getBone: (k) => bones[k] || null };
}

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

describe('UI2 sliders start from the bone', () => {
    test('a bone something else rotated reads its real angle, and one axis changes alone', () => {
        const { PoseApplier } = loadPoseModules();
        const rig = rigWith(['leftUpperArm']);
        const neutral = { leftUpperArm: { q: [0, 0, 0, 1] } };
        const applier = new PoseApplier({ rigMap: rig, neutralPose: neutral });
        // The T-pose correction lowers the arm 55° without telling the applier.
        rig.bones.leftUpperArm.quaternion.setFromEuler(new THREE.Euler(0, 0, rad(55), 'XYZ'));

        const read = applier.readAxes('leftUpperArm');
        expect(deg(read.z)).toBeCloseTo(55, 3);
        expect(deg(read.x)).toBeCloseTo(0, 3);

        // Touch Pitch: Roll must stay at 55°, not snap to 0.
        applier.setSelectedBoneAxisState('leftUpperArm', 'x', rad(20));
        const e = new THREE.Euler().setFromQuaternion(rig.bones.leftUpperArm.quaternion, 'XYZ');
        expect(deg(e.x)).toBeCloseTo(20, 3);
        expect(deg(e.z)).toBeCloseTo(55, 3);

        // Moving Roll to 60° is a 5° change, not a 60° jump from the T-pose.
        const before = rig.bones.leftUpperArm.quaternion.clone();
        applier.setSelectedBoneAxisState('leftUpperArm', 'z', rad(60));
        expect(deg(before.angleTo(rig.bones.leftUpperArm.quaternion))).toBeCloseTo(5, 1);
    });

    test('angles are read relative to the neutral pose', () => {
        const { PoseApplier } = loadPoseModules();
        const rig = rigWith(['head']);
        const nq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad(10), 0));
        const applier = new PoseApplier({ rigMap: rig, neutralPose: { head: { q: nq.toArray() } } });
        rig.bones.head.quaternion.copy(nq);
        expect(Object.values(applier.readAxes('head')).every((v) => Math.abs(v) < 1e-6)).toBe(true);
        applier.setSelectedBoneAxisState('head', 'y', rad(30));
        expect(deg(applier.readAxes('head').y)).toBeCloseTo(30, 3);
    });
});

describe('UI2 the panel', () => {
    let panel;
    let editor;
    let applied;

    function build() {
        document.body.innerHTML =
            '<button id="openPoseStudioBtn">Pose</button><div id="poseStudioRoot" class="hidden"></div>';
        applied = [];
        window.NEXUS_SPICY = { isEnabled: () => false };
        window.vrPoseSystem = {
            applyPreset: (name) => applied.push(name),
            isHoldingBones: () => false,
            getCurrentPreset: () => applied[applied.length - 1] || null,
        };
        editor = {
            selectedBone: 'head',
            applier: null,
            rebound: 0,
            getState: () => ({ userPoses: [], selectedBone: 'head' }),
            rebindIfStale() {
                this.rebound += 1;
                return false;
            },
            exit() {},
            enter: () => true,
        };
        jest.isolateModules(() => require('../src/PoseStudioPanel.js'));
        panel = new window.NEXUS_POSE_STUDIO_PANEL({ editor, rootEl: document.getElementById('poseStudioRoot') });
        panel.init();
    }

    afterEach(() => {
        if (panel && panel._keyHandler) document.removeEventListener('keydown', panel._keyHandler);
        delete window.vrPoseSystem;
        delete window.NEXUS_SPICY;
    });

    test('Apply from the Poses list puts the navigator on that preset in the list it shows', () => {
        build();
        const shown = window.NEXUS_POSE_STUDIO_PANEL.catalogue().filter((p) => p.name !== 'standing');
        const last = shown[shown.length - 1];
        document.getElementById('posePresetSelect').value = last.name;
        document.getElementById('poseApplyBtn').click();
        expect(applied).toContain(last.name);
        expect(document.getElementById('poseNavLabel').textContent).toBe(last.label);
        expect(document.getElementById('poseNavCounter').textContent).toBe(`${shown.length} / ${shown.length}`);
    });

    test('UI3: the T-pose is out of the navigator cycle and the Poses list, and still nameable in words', () => {
        build();
        const options = [...document.querySelectorAll('#posePresetSelect option')].map((o) => o.value);
        expect(options).not.toContain('standing');
        expect(window.NEXUS_POSE_STUDIO_PANEL.catalogue().some((p) => p.name === 'standing')).toBe(true);
        const n = options.length;
        for (let i = 0; i < n; i++) document.getElementById('poseNavNext').click();
        expect(applied).not.toContain('standing');
        expect(document.getElementById('poseNavCounter').textContent).toBe(`1 / ${n}`);
    });

    test('UI3: held in the T-pose, the navigator names it without counting it, and › leaves it', () => {
        build();
        const n = document.querySelectorAll('#posePresetSelect option').length;
        window.dispatchEvent(new CustomEvent('vr-pose-changed', { detail: { preset: 'standing' } }));
        expect(document.getElementById('poseNavLabel').textContent).toBe('T-Pose');
        expect(document.getElementById('poseNavCounter').textContent).toBe(`\u2013 / ${n}`);
        document.getElementById('poseNavNext').click();
        expect(document.getElementById('poseNavCounter').textContent).toBe(`1 / ${n}`);
    });

    test('UI3: the correction strength and the T-pose live in a closed Advanced section', () => {
        build();
        const adv = document.getElementById('poseAdvanced');
        expect(adv.tagName).toBe('DETAILS');
        expect(adv.open).toBe(false);
        expect(adv.contains(document.getElementById('poseTposeIntensitySlider'))).toBe(true);
        expect(adv.contains(document.getElementById('poseTposeStartBtn'))).toBe(true);
        expect(adv.contains(document.getElementById('poseTposePresetSelect'))).toBe(false);
    });

    test('UI4: bone editing and saving live in Advanced; the everyday controls stay in view', () => {
        build();
        const adv = document.getElementById('poseAdvanced');
        for (const id of [
            'poseMouseEditToggle',
            'posePuppetToggle',
            'poseBoneSelect',
            'poseSliderX',
            'poseSliderY',
            'poseSliderZ',
            'poseResetSelectedBtn',
            'poseMirrorBtn',
            'poseSaveName',
            'poseSaveBtn',
            'poseUndoBtn',
            'poseRedoBtn',
        ])
            expect([id, adv.contains(document.getElementById(id))]).toEqual([id, true]);
        for (const id of [
            'poseNavNext',
            'poseNavPrev',
            'poseTposePresetSelect',
            'posePresetSelect',
            'poseApplyBtn',
            'poseResetBtn',
            'poseAnimGridEmotes',
        ])
            expect([id, adv.contains(document.getElementById(id))]).toEqual([id, false]);
    });

    test('UI4: closing Advanced puts the joint handles away; opening it brings them back', () => {
        const gizmo = {
            on: false,
            isEnabled: () => gizmo.on,
            enable: () => ((gizmo.on = true), true),
            disable: () => (gizmo.on = false),
        };
        window.NEXUS_POSE_GIZMO_OVERLAY = gizmo;
        try {
            build();
            const adv = document.getElementById('poseAdvanced');
            const sw = document.getElementById('poseMouseEditToggle');
            adv.open = true;
            adv.dispatchEvent(new Event('toggle'));
            sw.checked = true;
            sw.dispatchEvent(new Event('change'));
            expect(gizmo.on).toBe(true);
            adv.open = false;
            adv.dispatchEvent(new Event('toggle'));
            expect(gizmo.on).toBe(false);
            expect(sw.checked).toBe(true); // the setting is kept
            adv.open = true;
            adv.dispatchEvent(new Event('toggle'));
            expect(gizmo.on).toBe(true);
        } finally {
            delete window.NEXUS_POSE_GIZMO_OVERLAY;
        }
    });

    test('actions bind the editor to the avatar on stage first', () => {
        build();
        const n = editor.rebound;
        document.getElementById('posePresetSelect').value = 'sitting';
        document.getElementById('poseApplyBtn').click();
        document.getElementById('poseNavNext').click();
        expect(editor.rebound).toBeGreaterThanOrEqual(n + 2);
    });

    test('Close returns focus to the control that opened the studio', () => {
        build();
        const opener = document.getElementById('openPoseStudioBtn');
        // jsdom has no layout; give both elements a size so "visible" means what it does in a browser.
        const box = () => ({ width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20 });
        opener.getBoundingClientRect = box;
        opener.focus();
        panel.show();
        document.getElementById('poseStudioCloseBtn').focus();
        document.getElementById('poseStudioCloseBtn').click();
        expect(document.getElementById('poseStudioRoot').classList.contains('hidden')).toBe(true);
        expect(document.activeElement).toBe(opener);
    });
});

describe('UI3 a near-T-pose correction is not remembered', () => {
    const KEY = 'nexus_pose_normalizer';
    const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');

    beforeEach(() => {
        localStorage.clear();
        window.THREE = THREE;
        jest.isolateModules(() => require('../src/PoseNormalizer.js'));
    });

    test('below 0.5 applies for this visit, and storage keeps the last value at or above it', () => {
        const PN = window.NEXUS_POSE_NORMALIZER;
        PN.updateSettings({ intensity: 0.8 });
        expect(stored().intensity).toBe(0.8);
        PN.updateSettings({ intensity: 0.1 });
        expect(PN.getSettings().intensity).toBe(0.1); // the session sees what was asked for
        expect(stored().intensity).toBe(0.8); // the next visit does not start in a T-pose
        PN.updateSettings({ intensity: 1.2 });
        expect(stored().intensity).toBe(1.2);
    });

    test('with nothing stored yet, a near-T-pose value stores the default', () => {
        const PN = window.NEXUS_POSE_NORMALIZER;
        PN.updateSettings({ intensity: 0 });
        expect(stored().intensity).toBeGreaterThanOrEqual(0.5);
    });
});

describe('UI3 an undo step is the whole pose, hips included', () => {
    test('undoing a T-pose put on a sitting pose brings her hips back down too', () => {
        window.THREE = THREE;
        window.NEXUS_POSE_LIBRARY = function () {
            return { getUserPoses: () => [], getBuiltInPoses: () => [] };
        };
        window.NEXUS_POSE_RIG_MAP = function () {};
        jest.isolateModules(() => {
            require('../src/PoseState.js');
            require('../src/PoseApplier.js');
            require('../src/PoseEditor.js');
        });
        const rig = rigWith(['hips', 'leftUpperLeg']);
        const editor = new window.NEXUS_POSE_EDITOR({});
        editor.rigMap = rig;
        editor.neutralPose = window.NEXUS_POSE_STATE.createNeutralSnapshot(rig);
        editor.applier = new window.NEXUS_POSE_APPLIER({ rigMap: rig, neutralPose: editor.neutralPose });
        editor.enabled = true;

        // Sitting: hips low, thigh forward.
        rig.bones.hips.position.set(0, 0.55, 0);
        rig.bones.leftUpperLeg.quaternion.setFromEuler(new THREE.Euler(rad(-80), 0, 0));
        const sitQ = rig.bones.leftUpperLeg.quaternion.clone();

        // Start from T-pose: one undo step, then standing height and neutral rotations.
        editor._pushUndoSnapshot();
        rig.bones.hips.position.set(0, 0.9, 0);
        editor.applier.resetAll();

        editor.undo();
        expect(rig.bones.hips.position.y).toBeCloseTo(0.55, 6);
        expect(deg(rig.bones.leftUpperLeg.quaternion.angleTo(sitQ))).toBeLessThan(0.01);

        editor.redo();
        expect(rig.bones.hips.position.y).toBeCloseTo(0.9, 6);
    });
});
