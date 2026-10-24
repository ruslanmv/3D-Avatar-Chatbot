/**
 * PS4. A dress is one sheet. Sitting (Wide) was skinning that sheet to both
 * thighs, so a 15 mm crotch edge became a 66 mm triangle and the hem opened
 * onto bare skin.
 *
 * The skinned mesh stays the one on screen. Vertices of a dress or skirt
 * below the hip joint give their leg weight to the hips, which is where a
 * skirt hangs from. The body, the face and anything that is not a dress
 * (briefs, a bra, leggings) are not rewritten. Nothing is hidden and no
 * second mesh is added: a static stand-in shares the cloth material and
 * the MToon program, and that is what pulled the head and arms off the body.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

const HANGING = /dress|skirt|gown|bodycon|frock/i;
const NOT_HANGING = /brief|bra|thong|bikini|legging|tight|stocking|underwear|jean|trouser|short|boot|shoe/i;
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
        overlay.removeFromParent();
        delete mesh.userData.poseGarmentOverlay;
        mesh.visible = true;
    }
}

/** Put the file's weights back. Used when the avatar itself is replaced. */
export function clearPosedGarments(root) {
    if (!root) return;
    dropPosedOverlays(root);
    root.traverse((object) => {
        if (object.isSkinnedMesh) restoreSkin(object);
    });
}

/**
 * Hang every dress and skirt from the pelvis. Returns how many meshes changed.
 * The body is never one of them.
 */
export function correctPosedGarments(root) {
    if (!root) return 0;
    dropPosedOverlays(root);
    let hung = 0;
    root.traverse((object) => {
        if (!object.isSkinnedMesh || !object.geometry || !object.geometry.attributes || !object.geometry.attributes.position) return;
        if (object.userData && object.userData.poseGarmentCorrection) return;
        if (isBodyMesh(object) || !hangingDress(object)) return;
        if (hangFromPelvis(object)) hung += 1;
    });
    return hung;
}
