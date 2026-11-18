/**
 * UI2. Pose Studio fixes found by the UI tour (audits/ui/run.mjs --only pose).
 *
 *  - The Pitch/Yaw/Roll sliders read the bone they drive. They used to start from a cached value
 *    that went stale whenever something else moved the bone, so the first touch snapped the limb
 *    (an upper arm the T-pose correction had lowered 55° read "0°" and jumped back up).
 *  - Applying a preset from the Poses list puts the navigator on that preset in the list it shows.
 *    With Private off the list is filtered, and "T-Pose (Reset)" used to read "Lecturer 1 / 26".
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

    test('Apply "T-Pose (Reset)" with Private off puts the navigator on it, last of the filtered list', () => {
        build();
        const list = window.NEXUS_POSE_STUDIO_PANEL.catalogue();
        expect(list.some((p) => p.adult)).toBe(false);
        document.getElementById('posePresetSelect').value = 'standing';
        document.getElementById('poseApplyBtn').click();
        expect(applied).toContain('standing');
        expect(document.getElementById('poseNavLabel').textContent).toBe('T-Pose (Reset)');
        expect(document.getElementById('poseNavCounter').textContent).toBe(`${list.length} / ${list.length}`);
    });

    test('a pose change announced by the pose system lands on the same filtered index', () => {
        build();
        const list = window.NEXUS_POSE_STUDIO_PANEL.catalogue();
        window.dispatchEvent(new CustomEvent('vr-pose-changed', { detail: { preset: 'standing' } }));
        expect(document.getElementById('poseNavCounter').textContent).toBe(`${list.length} / ${list.length}`);
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
