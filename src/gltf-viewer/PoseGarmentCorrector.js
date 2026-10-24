/**
 * PS4. A dress is one sheet. Sitting (Wide) was skinning that sheet to both
 * thighs, so a 15 mm crotch edge became a 66 mm triangle and the hem opened
 * onto bare skin.
 *
 * The skinned mesh stays the one on screen. Vertices of a dress or skirt
 * below the hip joint give their leg weight to the hips, which is where a
 * skirt hangs from. A brief keeps its own skinning. Where the leg opening
 * leaves the mound bare, a separate panel with its own material covers
 * that skin. Nothing is hidden, and the panel does not share the cloth
 * shader: a stand-in on the MToon program is what pulled the head and arms
 * off the body.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

const HANGING = /dress|skirt|gown|bodycon|frock/i;
const NOT_HANGING = /brief|bra|thong|bikini|legging|tight|stocking|underwear|jean|trouser|short|boot|shoe/i;
const BRIEF = /brief|panty|boyshort/i;
const THONG = /thong|tanga/i;
const LEG = /upperleg|lowerleg|thigh|shin|calf|foot|toe|knee/i;
const HIPS = /hips|pelvis/i;
const _hipPoint = new THREE.Vector3();

function isBodyMesh(mesh) {
    const api = globalThis.NEXUS_POSE_GARMENT_CORRECTION;
    const isBodyName = api && api.isBodyName
        ? api.isBodyName
        : (name) => {
            if (!name || /bodycon/i.test(name)) return false;
            return /(^|[^a-z0-9])body([^a-z0-9]|$)/i.test(name);
        };
    let node = mesh;
    while (node) {
        if (isBodyName(node.name || '')) return true;
        node = node.parent;
    }
    return false;
}

function hangingDress(mesh) {
    const name = `${mesh.name || ''} ${mesh.parent ? mesh.parent.name || '' : ''}`;
    if (NOT_HANGING.test(name)) return false;
    return HANGING.test(name);
}

function read4(attribute, index) {
    return [attribute.getX(index), attribute.getY(index), attribute.getZ(index), attribute.getW(index)];
}

function write4(attribute, index, values) {
    attribute.setXYZW(index, values[0], values[1], values[2], values[3]);
}

/** Remember the file's weights the first time, so a later avatar swap can put them back. */
function rememberSkin(mesh) {
    if (mesh.userData.poseGarmentSkin) return;
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    if (!index || !index.array || !weight || !weight.array) return;
    mesh.userData.poseGarmentSkin = { index: index.array.slice(), weight: weight.array.slice() };
}

function restoreSkin(mesh) {
    const saved = mesh.userData.poseGarmentSkin;
    if (!saved) return;
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    if (index && index.array && index.array.length === saved.index.length) {
        index.array.set(saved.index);
        index.needsUpdate = true;
    }
    if (weight && weight.array && weight.array.length === saved.weight.length) {
        weight.array.set(saved.weight);
        weight.needsUpdate = true;
    }
    delete mesh.userData.poseGarmentSkin;
}

/**
 * Move leg influence of every vertex below the hip joint onto the hips.
 * A second pass finds no leg weight left to move.
 */
function hangFromPelvis(mesh) {
    const geometry = mesh.geometry;
    const skinIndex = geometry && geometry.attributes && geometry.attributes.skinIndex;
    const skinWeight = geometry && geometry.attributes && geometry.attributes.skinWeight;
    const position = geometry && geometry.attributes && geometry.attributes.position;
    const bones = mesh.skeleton && mesh.skeleton.bones;
    if (!skinIndex || !skinWeight || !position || !bones || skinIndex.itemSize < 4) return false;
    const hips = bones.find((bone) => HIPS.test(bone.name || '') && !LEG.test(bone.name || ''));
    if (!hips) return false;
    const hipsIndex = bones.indexOf(hips);
    const leg = new Set();
    bones.forEach((bone, index) => {
        if (LEG.test(bone.name || '')) leg.add(index);
    });
    if (!leg.size) return false;

    mesh.updateMatrixWorld(true);
    const hipLocal = mesh.worldToLocal(hips.getWorldPosition(_hipPoint));
    const cut = hipLocal.y + 0.01;
    rememberSkin(mesh);

    let movedVertices = 0;
    for (let i = 0; i < position.count; i += 1) {
        if (position.getY(i) >= cut) continue;
        const joints = read4(skinIndex, i);
        const weights = read4(skinWeight, i);
        let moved = 0;
        for (let corner = 0; corner < 4; corner += 1) {
            if (!leg.has(joints[corner]) || weights[corner] <= 0) continue;
            moved += weights[corner];
            weights[corner] = 0;
        }
        if (moved <= 1e-5) continue;
        let placed = false;
        for (let corner = 0; corner < 4; corner += 1) {
            if (joints[corner] !== hipsIndex) continue;
            weights[corner] += moved;
            placed = true;
            break;
        }
        if (!placed) {
            for (let corner = 0; corner < 4; corner += 1) {
                if (weights[corner] > 1e-6) continue;
                joints[corner] = hipsIndex;
                weights[corner] = moved;
                placed = true;
                break;
            }
        }
        const total = weights[0] + weights[1] + weights[2] + weights[3];
        if (total > 1e-6) {
            for (let corner = 0; corner < 4; corner += 1) weights[corner] /= total;
        }
        write4(skinIndex, i, joints);
        write4(skinWeight, i, weights);
        movedVertices += 1;
    }
    if (movedVertices) {
        skinIndex.needsUpdate = true;
        skinWeight.needsUpdate = true;
    }
    return movedVertices > 0;
}

/** Drop a leftover static stand-in from the earlier pass and show the skinned cloth. */
export function dropPosedOverlays(root) {
    if (!root) return;
    const drop = [];
    root.traverse((object) => {
        if (object.userData && object.userData.poseGarmentOverlay) drop.push(object);
    });
    for (const mesh of drop) {
        const overlay = mesh.userData.poseGarmentOverlay;
        if (overlay.geometry) overlay.geometry.dispose();
        if (overlay.userData && overlay.userData.poseGarmentOwnsMaterial && overlay.material && overlay.material.dispose) {
            overlay.material.dispose();
        }
        overlay.removeFromParent();
        delete mesh.userData.poseGarmentOverlay;
        mesh.visible = true;
    }
}

function isBriefMesh(mesh) {
    const name = `${mesh.name || ''} ${mesh.parent ? mesh.parent.name || '' : ''}`;
    if (THONG.test(name) || isBodyMesh(mesh)) return false;
    return BRIEF.test(name);
}

/**
 * Open a pinched gusset back to the 24 mm panel that sits on the mound.
 * The edit is in the bind pose, so every pose inherits it, and the seams
 * are not moved. A second call finds the rows already open. The saved
 * positions go back when the avatar is replaced.
 */
function seatBriefGusset(mesh) {
    if (!isBriefMesh(mesh) || (mesh.userData && mesh.userData.poseGarmentGusset)) return false;
    const api = globalThis.NEXUS_POSE_GARMENT_CORRECTION;
    const widen = api && api.widenCollapsedGusset;
    const position = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    const index = mesh.geometry && mesh.geometry.index;
    if (!widen || !position || !position.array || !index || !index.array) return false;
    const saved = position.array.slice();
    const opened = widen(position.array, index.array);
    if (!opened) return false;
    position.needsUpdate = true;
    mesh.userData.poseGarmentGusset = saved;
    return true;
}

function restoreGusset(mesh) {
    const saved = mesh.userData && mesh.userData.poseGarmentGusset;
    if (!saved) return;
    const position = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (position && position.array && position.array.length === saved.length) {
        position.array.set(saved);
        position.needsUpdate = true;
    }
    delete mesh.userData.poseGarmentGusset;
}

/** Put the file's weights and the gusset back. Used when the avatar itself is replaced. */
export function clearPosedGarments(root) {
    if (!root) return;
    dropPosedOverlays(root);
    root.traverse((object) => {
        if (!object.isSkinnedMesh) return;
        restoreGusset(object);
        restoreSkin(object);
    });
}

/**
 * Hang every dress and skirt from the pelvis, and open a pinched brief gusset
 * back to the panel on the mound. Returns how many meshes changed.
 * The body is never one of them.
 */
export function correctPosedGarments(root) {
    if (!root) return 0;
    dropPosedOverlays(root);
    let changed = 0;
    root.traverse((object) => {
        if (!object.isSkinnedMesh || !object.geometry || !object.geometry.attributes || !object.geometry.attributes.position) return;
        if (object.userData && object.userData.poseGarmentCorrection) return;
        if (isBodyMesh(object)) return;
        if (hangingDress(object) && hangFromPelvis(object)) changed += 1;
        if (seatBriefGusset(object)) changed += 1;
    });
    return changed;
}

const _posed = new THREE.Vector3();
const _front = new THREE.Vector3();
const _hips = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _toParent = new THREE.Matrix4();

function posedPositions(mesh) {
    const position = mesh.geometry.attributes.position;
    const out = new Float32Array(position.count * 3);
    mesh.updateMatrixWorld(true);
    if (mesh.skeleton) mesh.skeleton.update();
    for (let i = 0; i < position.count; i += 1) {
        _posed.fromBufferAttribute(position, i);
        mesh.boneTransform(i, _posed);
        out[i * 3] = _posed.x;
        out[i * 3 + 1] = _posed.y;
        out[i * 3 + 2] = _posed.z;
    }
    return out;
}

/**
 * Cover the mound the brief's leg opening leaves bare once the pose has
 * reached the raw skeleton. The skinned brief stays on screen. The panel is
 * a separate mesh with its own material, so it does not share the cloth
 * shader and it does not hide anything. Dropped with the other overlays.
 */
export function seatMoundPanels(root) {
    if (!root) return 0;
    const api = globalThis.NEXUS_POSE_GARMENT_CORRECTION;
    if (!api || !api.moundPanel) return 0;
    dropPosedOverlays(root);

    let body = null;
    const briefs = [];
    root.traverse((object) => {
        if (!object.isSkinnedMesh || !object.geometry || !object.geometry.index) return;
        if (!object.geometry.attributes || !object.geometry.attributes.position) return;
        if (isBodyMesh(object) && !/hair|face/i.test(object.name || '')) {
            if (!body || object.geometry.attributes.position.count > body.geometry.attributes.position.count) {
                body = object;
            }
        } else if (isBriefMesh(object)) {
            briefs.push(object);
        }
    });
    if (!body || !body.skeleton || !briefs.length) return 0;

    const hipsBone = body.skeleton.bones.find((bone) => HIPS.test(bone.name || '') && !LEG.test(bone.name || ''));
    if (!hipsBone) return 0;
    body.updateMatrixWorld(true);
    _front.set(0, 0, -1).transformDirection(body.matrixWorld);
    hipsBone.getWorldPosition(_hips);
    // The eye that the coverage was measured from: in front of her hips,
    // a little below them, looking back at the mound.
    _eye.copy(_hips).addScaledVector(_front, 0.42).addScaledVector(_up, -0.23);
    _target.copy(_hips).addScaledVector(_up, -0.06).addScaledVector(_front, 0.02);

    const skin = posedPositions(body);
    const skinFaces = body.geometry.index.array;
    let added = 0;
    for (const mesh of briefs) {
        const brief = posedPositions(mesh);
        const panel = api.moundPanel({
            skin,
            skinFaces,
            brief,
            briefFaces: mesh.geometry.index.array,
            hips: [_hips.x, _hips.y, _hips.z],
            front: [_front.x, _front.y, _front.z],
            up: [0, 1, 0],
            eye: [_eye.x, _eye.y, _eye.z],
            target: [_target.x, _target.y, _target.z],
        });
        if (!panel) continue;
        const parent = mesh.parent || root;
        parent.updateMatrixWorld(true);
        _toParent.copy(parent.matrixWorld).invert();
        const local = panel.positions;
        for (let i = 0; i < local.length; i += 3) {
            _posed.set(local[i], local[i + 1], local[i + 2]).applyMatrix4(_toParent);
            local[i] = _posed.x;
            local[i + 1] = _posed.y;
            local[i + 2] = _posed.z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(local, 3));
        geometry.setIndex(new THREE.BufferAttribute(panel.indices, 1));
        geometry.computeVertexNormals();
        const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const color = source && source.color ? source.color.clone() : new THREE.Color(0.723, 0.604, 0.434);
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.84,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        const overlay = new THREE.Mesh(geometry, material);
        overlay.name = 'MoundPanel';
        overlay.frustumCulled = false;
        overlay.userData.poseGarmentOwnsMaterial = true;
        mesh.userData.poseGarmentOverlay = overlay;
        parent.add(overlay);
        added += 1;
    }
    return added;
}
