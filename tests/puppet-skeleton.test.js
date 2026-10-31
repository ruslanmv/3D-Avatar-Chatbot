/**
 * VP1 — what the VR puppet moves is what she does (src/gltf-viewer/PuppetSkeleton.js).
 *
 * The bug: VRPoseSystem wrote three-vrm's normalized proxy rig while the app keeps
 * `autoUpdateHumanBones` false for the idle animator, so in VR a grabbed sphere moved and her mesh
 * did not. These tests run the module against the vendored three.js and a rig built exactly the way
 * three-vrm 2.1.0's VRMHumanoidRig builds one (its _setupTransforms and update(), transcribed), so
 * the inverse is checked against the real forward copy rather than against itself.
 */

const THREE = require('../vendor/three-0.147.0/build/three.min.js');
const fs = require('fs');
const path = require('path');
const PS = require('../src/gltf-viewer/PuppetSkeleton.js');

const PARENT = { hips: null, spine: 'hips', chest: 'spine', upperArm: 'chest', lowerArm: 'upperArm', hand: 'lowerArm' };
const NAMES = Object.keys(PARENT);

/**
 * A raw skeleton with awkward rest rotations. The root is turned (VRM0-style) and moved only AFTER
 * the rig is built — three-vrm builds its rig at load, before rotateVRM0 or the app place her.
 */
function rawSkeleton() {
    const root = new THREE.Group();
    const armature = new THREE.Object3D(); // a non-human node between root and hips, as VRoid has
    armature.quaternion.setFromEuler(new THREE.Euler(0.1, -0.2, 0.05));
    root.add(armature);
    const bones = {};
    const rest = {
        hips: [0, 0.9, 0.02, 0.2, 0.1, -0.1],
        spine: [0, 0.1, 0, -0.15, 0, 0.05],
        chest: [0, 0.15, 0, 0.1, 0.2, 0],
        upperArm: [0.1, 0.2, 0, 0, 0, -1.1],
        lowerArm: [0.25, 0, 0, 0.3, -0.4, 0.2],
        hand: [0.22, 0, 0, -0.2, 0.1, 0.5],
    };
    for (const name of NAMES) {
        const b = new THREE.Bone();
        b.name = name;
        const [x, y, z, rx, ry, rz] = rest[name];
        b.position.set(x, y, z);
        b.quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
        (PARENT[name] ? bones[PARENT[name]] : armature).add(b);
        bones[name] = b;
    }
    root.updateMatrixWorld(true);
    return { root, bones };
}

/** three-vrm 2.1.0 VRMHumanoidRig, transcribed: same fields, same maths. */
function humanoidFor(root, bones) {
    const original = { getBoneNode: (n) => bones[n] || null };
    const rigRoot = new THREE.Object3D();
    rigRoot.name = 'VRMHumanoidRig';
    const worldPos = {};
    const boneRotations = {};
    const parentWorldRotations = {};
    const s = new THREE.Vector3();
    for (const name of NAMES) {
        const b = bones[name];
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        b.updateWorldMatrix(true, false);
        b.matrixWorld.decompose(p, q, s);
        worldPos[name] = p;
        boneRotations[name] = b.quaternion.clone();
        const pq = new THREE.Quaternion();
        b.parent.matrixWorld.decompose(new THREE.Vector3(), pq, s);
        parentWorldRotations[name] = pq;
    }
    const nodes = {};
    for (const name of NAMES) {
        const n = new THREE.Object3D();
        n.name = 'Normalized_' + name;
        (PARENT[name] ? nodes[PARENT[name]] : rigRoot).add(n);
        n.position.copy(worldPos[name]);
        if (PARENT[name]) n.position.sub(worldPos[PARENT[name]]);
        nodes[name] = n;
    }
    root.add(rigRoot); // three-vrm adds the rig root to vrm.scene
    root.rotation.y = Math.PI; // …then the VRM0 turn and the app's placement
    root.position.set(0, 0, -1);
    root.updateMatrixWorld(true);
    const rig = {
        original,
        root: rigRoot,
        _parentWorldRotations: parentWorldRotations,
        _boneRotations: boneRotations,
        getBoneNode: (n) => nodes[n] || null,
        update() {
            const qa = new THREE.Quaternion();
            for (const name of NAMES) {
                const boneNode = original.getBoneNode(name);
                const rigBoneNode = nodes[name];
                const P = parentWorldRotations[name];
                const inv = qa.copy(P).invert();
                boneNode.quaternion
                    .copy(rigBoneNode.quaternion)
                    .multiply(P)
                    .premultiply(inv)
                    .multiply(boneRotations[name]);
                if (name === 'hips') {
                    const wp = rigBoneNode.getWorldPosition(new THREE.Vector3());
                    boneNode.parent.updateWorldMatrix(true, false);
                    const m = boneNode.parent.matrixWorld.clone().invert();
                    boneNode.position.copy(wp.applyMatrix4(m));
                }
            }
        },
    };
    const humanoid = {
        autoUpdateHumanBones: false,
        _normalizedHumanBones: rig,
        humanBones: Object.fromEntries(NAMES.map((n) => [n, { node: nodes[n] }])),
        getRawBoneNode: (n) => bones[n] || null,
        getNormalizedBoneNode: (n) => nodes[n] || null,
        update() {
            if (this.autoUpdateHumanBones) rig.update();
        },
    };
    return { humanoid, nodes, rig };
}

/** Pose the raw skeleton the way an idle animator would: rotations and a hips shift. */
function animate(bones, seed) {
    const r = (i) => Math.sin(seed * 12.9898 + i * 78.233) * 0.6;
    NAMES.forEach((name, i) => {
        bones[name].quaternion.multiply(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(r(i), r(i + 7), r(i + 13)))
        );
    });
    bones.hips.position.x += 0.06;
    bones.hips.position.y -= 0.02;
}

const worldOf = (o) => o.getWorldPosition(new THREE.Vector3());
const snapshot = (bones) =>
    Object.fromEntries(NAMES.map((n) => [n, { q: bones[n].quaternion.clone(), p: bones[n].position.clone() }]));

describe('carry-over is the exact inverse of three-vrm’s copy', () => {
    test.each([1, 2, 3])('a posed skeleton survives proxy → skeleton unchanged (seed %i)', (seed) => {
        const { root, bones } = rawSkeleton();
        const { humanoid, nodes, rig } = humanoidFor(root, bones);
        animate(bones, seed);
        root.updateMatrixWorld(true);
        const before = snapshot(bones);
        const handBefore = worldOf(bones.hand);

        expect(PS.carryOver(humanoid)).toBe(NAMES.length);
        // The proxy's hand is now where her hand is: handles placed on either agree.
        expect(worldOf(nodes.hand).distanceTo(handBefore)).toBeLessThan(1e-6);

        rig.update(); // what vrm.update() does with auto-update on
        for (const n of NAMES) {
            expect(Math.abs(bones[n].quaternion.dot(before[n].q))).toBeGreaterThan(1 - 1e-9);
        }
        expect(bones.hips.position.distanceTo(before.hips.p)).toBeLessThan(1e-6);
        expect(worldOf(bones.hand).distanceTo(handBefore)).toBeLessThan(1e-6);
    });

    test('without the rig internals nothing is carried and sync falls back to humanoid.update()', () => {
        const { root, bones } = rawSkeleton();
        const { humanoid, nodes } = humanoidFor(root, bones);
        const rig = humanoid._normalizedHumanBones;
        const plain = {
            autoUpdateHumanBones: false,
            update() {
                if (this.autoUpdateHumanBones) rig.update();
            },
        };
        expect(PS.carryOver(plain)).toBe(0);
        nodes.hand.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.8));
        expect(PS.sync(plain)).toBe(true);
        expect(plain.autoUpdateHumanBones).toBe(false); // put back as it was
        expect(PS.sync({})).toBe(false);
    });
});

function fakeAnimator() {
    let poseMode = false;
    let editMode = false;
    return {
        isPoseMode: () => poseMode,
        isEditMode: () => editMode,
        setPoseMode: jest.fn((on) => {
            poseMode = !!on;
            if (on) editMode = true; // as ProceduralAnimator does
        }),
        setEditMode: jest.fn((on) => {
            editMode = !!on;
            if (!on) poseMode = false;
        }),
    };
}

function setup(opts = {}) {
    const { root, bones } = rawSkeleton();
    const { humanoid, nodes, rig } = humanoidFor(root, bones);
    animate(bones, 5);
    root.updateMatrixWorld(true);
    const animator = fakeAnimator();
    const clips = {
        playing: !!opts.clipPlaying,
        getCurrentPlaybackState() {
            return { isPlaying: this.playing };
        },
        stopClip: jest.fn(),
    };
    const resolver = {
        getCurrentState: () => ({ clipPlaying: !!opts.resolverPlaying }),
        stop: jest.fn(async () => {}),
    };
    const warn = jest.fn();
    const own = PS.create({ animator: () => animator, clips: () => clips, resolver: () => resolver, warn });
    return { root, bones, humanoid, nodes, rig, animator, clips, resolver, warn, own };
}

describe('claim, hold, release', () => {
    test('claim takes her from the animator without moving her, and only stops what is playing', () => {
        const s = setup();
        const handBefore = worldOf(s.bones.hand);
        expect(s.own.claim({ humanoid: s.humanoid })).toBe(true);
        expect(s.own.claim({ humanoid: s.humanoid })).toBe(false); // idempotent
        expect(s.own.isClaimed()).toBe(true);
        expect(s.humanoid.autoUpdateHumanBones).toBe(true);
        expect(s.animator.isPoseMode()).toBe(true);
        expect(worldOf(s.bones.hand).distanceTo(handBefore)).toBeLessThan(1e-6); // no pop
        expect(s.clips.stopClip).not.toHaveBeenCalled();
        expect(s.resolver.stop).not.toHaveBeenCalled();

        const p = setup({ clipPlaying: true, resolverPlaying: true });
        p.own.claim({ humanoid: p.humanoid });
        expect(p.clips.stopClip).toHaveBeenCalledTimes(1);
        expect(p.resolver.stop).toHaveBeenCalledTimes(1);
    });

    test('while held, what is written to the proxy reaches her skeleton on sync', () => {
        const s = setup();
        s.own.claim({ humanoid: s.humanoid });
        s.nodes.lowerArm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.9)));
        const before = worldOf(s.bones.hand);
        expect(s.own.sync()).toBe(true);
        s.root.updateMatrixWorld(true);
        expect(worldOf(s.bones.hand).distanceTo(before)).toBeGreaterThan(0.05);
        expect(worldOf(s.bones.hand).distanceTo(worldOf(s.nodes.hand))).toBeLessThan(1e-6);
    });

    test('release puts back both skeletons, the copy flag and both animator modes', () => {
        const s = setup();
        const raw = snapshot(s.bones);
        const norm = snapshot(s.nodes);
        s.own.claim({ humanoid: s.humanoid });
        s.nodes.hand.quaternion.setFromEuler(new THREE.Euler(1, 0, 0));
        s.own.sync();
        expect(s.own.release({ blendSeconds: 0 })).toBe(true);
        expect(s.own.release({ blendSeconds: 0 })).toBe(false);
        for (const n of NAMES) {
            expect(s.bones[n].quaternion.equals(raw[n].q)).toBe(true);
            expect(s.nodes[n].quaternion.equals(norm[n].q)).toBe(true);
        }
        expect(s.humanoid.autoUpdateHumanBones).toBe(false);
        expect(s.animator.isPoseMode()).toBe(false);
        // The trap: setPoseMode(true) switched edit mode on, and an animator left in edit mode
        // never moves her again.
        expect(s.animator.isEditMode()).toBe(false);
        expect(s.own.isBlending()).toBe(false);
    });

    test('a pose mode the desktop had set before VR is handed back as it was', () => {
        const s = setup();
        s.animator.setPoseMode(true);
        s.humanoid.autoUpdateHumanBones = true;
        s.own.claim({ humanoid: s.humanoid });
        s.own.release({ blendSeconds: 0 });
        expect(s.animator.isPoseMode()).toBe(true);
        expect(s.humanoid.autoUpdateHumanBones).toBe(true);
    });

    test('the release blend eases from the held pose into what the animator now writes', () => {
        const s = setup();
        s.own.claim({ humanoid: s.humanoid });
        s.nodes.upperArm.quaternion.setFromEuler(new THREE.Euler(0, 0, 1.2));
        s.nodes.spine.quaternion.setFromEuler(new THREE.Euler(0.5, 0, 0));
        s.own.sync();
        const held = snapshot(s.bones);
        s.own.release({ blendSeconds: 0.4 });
        // Release shows the held pose for this frame…
        expect(s.bones.upperArm.quaternion.equals(held.upperArm.q)).toBe(true);

        // …then each frame the animator writes the arm (fresh target) and never the spine.
        const idleArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.3));
        const angle = (a, b) => a.angleTo(b);
        let last = Infinity;
        for (let i = 0; i < 5; i++) {
            s.bones.upperArm.quaternion.copy(idleArm); // the animator's absolute write
            s.own.update(0.05);
            const now = angle(s.bones.upperArm.quaternion, idleArm);
            expect(now).toBeLessThan(last); // monotone towards the idle
            last = now;
        }
        expect(s.own.isBlending()).toBe(true);
        for (let i = 0; i < 10; i++) {
            s.bones.upperArm.quaternion.copy(idleArm);
            s.own.update(0.05);
        }
        expect(s.own.isBlending()).toBe(false);
        expect(angle(s.bones.upperArm.quaternion, idleArm)).toBeLessThan(1e-6);
    });

    test('a bone nobody writes settles on the restored snapshot, not back on the held pose', () => {
        const s = setup();
        const pre = s.bones.spine.quaternion.clone();
        s.own.claim({ humanoid: s.humanoid });
        s.nodes.spine.quaternion.setFromEuler(new THREE.Euler(0.7, 0, 0));
        s.own.sync();
        s.own.release({ blendSeconds: 0.3 });
        for (let i = 0; i < 20; i++) s.own.update(0.05);
        expect(s.bones.spine.quaternion.angleTo(pre)).toBeLessThan(1e-6);
    });

    test('a release still settling is superseded when she is taken again', () => {
        const s = setup();
        s.own.claim({ humanoid: s.humanoid });
        s.own.release({ blendSeconds: 1 });
        expect(s.own.isBlending()).toBe(true);
        s.own.claim({ humanoid: s.humanoid });
        expect(s.own.isBlending()).toBe(false);
        expect(s.own.isClaimed()).toBe(true);
    });

    test('a three-vrm without reachable internals still claims, and says once that it will pop', () => {
        const s = setup();
        const odd = {
            autoUpdateHumanBones: false,
            humanBones: s.humanoid.humanBones,
            getRawBoneNode: s.humanoid.getRawBoneNode,
            getNormalizedBoneNode: s.humanoid.getNormalizedBoneNode,
            update() {},
        };
        expect(s.own.claim({ humanoid: odd })).toBe(true);
        s.own.release({ blendSeconds: 0 });
        s.own.claim({ humanoid: odd });
        expect(s.warn).toHaveBeenCalledTimes(1);
    });

    test('a plain glTF (no humanoid) is held through the animator alone', () => {
        const s = setup();
        const bones = [s.bones.upperArm, s.bones.lowerArm];
        const pre = s.bones.lowerArm.quaternion.clone();
        expect(s.own.claim({ humanoid: null, bones })).toBe(true);
        expect(s.animator.isPoseMode()).toBe(true);
        s.bones.lowerArm.quaternion.setFromEuler(new THREE.Euler(0, 1, 0));
        s.own.release({ blendSeconds: 0 });
        expect(s.bones.lowerArm.quaternion.equals(pre)).toBe(true);
    });
});

describe('wiring: every VR path that poses her claims her skeleton first', () => {
    const read = (f) => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf-8');
    const pose = read('gltf-viewer/VRPoseSystem.js');
    const puppet = read('gltf-viewer/VRPuppetInteraction.js');
    const grabber = read('gltf-viewer/VRBoneGrabber.js');
    const panel = read('gltf-viewer/VRChatPanel.js');
    const intimacy = read('gltf-viewer/VRIntimacySystem.js');
    const animator = read('ProceduralAnimator.js');
    const body = (src, sig) => {
        const start = src.indexOf(sig);
        expect(start).toBeGreaterThan(-1);
        return src.slice(start, src.indexOf('\n    }\n', start));
    };

    test('IK claims before measuring the grab offset', () => {
        const ik = body(pose, '    startIK(boneKey, controller) {');
        expect(ik.indexOf('this.claimBones()')).toBeGreaterThan(-1);
        expect(ik.indexOf('this.claimBones()')).toBeLessThan(ik.indexOf('grabOffset.subVectors'));
    });

    test('the pose system syncs while held, after it solved; leaving VR or a new avatar releases', () => {
        const update = body(pose, '    update(dt) {');
        expect(update.indexOf('this._own.sync()')).toBeGreaterThan(update.indexOf('this.updateIK()'));
        expect(body(pose, '    setEnabled(enabled) {')).toMatch(/releaseBones\(\{ blendSeconds: 0 \}\)/);
        expect(body(pose, '    setAvatar(root) {')).toMatch(/releaseBones\(\{ blendSeconds: 0 \}\)/);
        expect(body(pose, '    cyclePreset() {')).toContain('this.claimBones()');
        expect(body(pose, '    cyclePrevPreset() {')).toContain('this.claimBones()');
        expect(body(pose, '    resetToRest() {')).toContain('this.releaseBones(');
    });

    test('the puppet syncs after its own solve and grab, and puts handles on the drawn skeleton', () => {
        const active = body(puppet, '    _updateActiveInteraction(_dt) {');
        expect(active.indexOf('syncSkeleton')).toBeGreaterThan(active.indexOf('updateIK'));
        expect(active.lastIndexOf('syncSkeleton')).toBeGreaterThan(active.indexOf('updateGrab'));
        expect(body(puppet, '    _updateHandlePositions() {')).toContain('this._getVisualBone(boneKey)');
    });

    test('a direct bone grab, Place mode and intimacy poses claim; Place mode off releases', () => {
        const grab = body(grabber, '    tryGrab(controller) {');
        expect(grab.indexOf('claimBones')).toBeGreaterThan(-1);
        expect(grab.indexOf('claimBones')).toBeLessThan(grab.indexOf('this._grabStartQuat.copy'));
        expect(panel).toMatch(/claimBones\?\.\(\);\s*vps\.applyPreset\('sitting'/);
        expect(panel).toMatch(/releaseBones\?\.\(\{ blendSeconds: 0\.5 \}\)/);
        expect(intimacy).toMatch(/claimBones\?\.\(\);[^\n]*\n\s*this\.poseSystem\.applyPreset/);
    });

    test('the animator exposes both modes so they can be handed back', () => {
        expect(animator).toMatch(/isPoseMode: \(\) => poseMode/);
        expect(animator).toMatch(/isEditMode: \(\) => editMode/);
    });
});
