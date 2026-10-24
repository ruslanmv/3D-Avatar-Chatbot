/**
 * PS4. Runs the lap correction on the avatar Pose Studio is showing.
 *
 * The skinned garment stays the source of the bind pose. A sibling mesh
 * receives the corrected positions, and the skinned one is hidden, so the
 * existing renderer draws the corrected cloth. The body is never replaced
 * and never hidden: the pelvic surface in the file stays the one on screen.
 * Each pass starts from boneTransform of the bind pose, so changing pose
 * and coming back does not stack the correction.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

const SKIP = /hair|eye|teeth|brow|tongue|lash|face|tear|highlight/i;
const _bind = new THREE.Vector3();
const _posed = new THREE.Vector3();

function localSkinned(mesh) {
    const position = mesh.geometry.attributes.position;
    const count = position.count;
    const out = new Float32Array(count * 3);
    mesh.skeleton.update();
    for (let i = 0; i < count; i += 1) {
        _bind.fromBufferAttribute(position, i);
        mesh.boneTransform(i, _bind);
        out[i * 3] = _bind.x;
        out[i * 3 + 1] = _bind.y;
        out[i * 3 + 2] = _bind.z;
    }
    return out;
}

const LEG = /leg|thigh|foot|toe|knee/i;

/**
 * The lap of a dress is one sheet. Sitting (Wide) gives that sheet both thighs,
 * so the hem follows the legs apart and the crotch cloth leaves the pelvis.
 * Re-skin those vertices with the hips and spine only, then the cloth solver
 * runs. Vertices with no other bone keep the posed result.
 */
function unpinThighs(mesh, posed, lap) {
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    if (!skinIndex || !skinWeight || !mesh.skeleton) return posed;
    const bones = mesh.skeleton.bones;
    const out = new Float32Array(posed.length);
    out.set(posed);
    const position = mesh.geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const accum = new THREE.Vector3();
    const temp = new THREE.Vector3();
    const boneMat = new THREE.Matrix4();
    const read = (attribute, index, corner) => {
        if (corner === 0) return attribute.getX(index);
        if (corner === 1) return attribute.getY(index);
        if (corner === 2) return attribute.getZ(index);
        return attribute.getW(index);
    };
    for (let i = 0; i < lap.length; i += 1) {
        if (!lap[i]) continue;
        let kept = 0;
        const weights = [0, 0, 0, 0];
        const joints = [0, 0, 0, 0];
        for (let corner = 0; corner < 4; corner += 1) {
            joints[corner] = read(skinIndex, i, corner);
            const bone = bones[joints[corner]];
            const weight = read(skinWeight, i, corner);
            if (!bone || LEG.test(bone.name || '')) continue;
            weights[corner] = weight;
            kept += weight;
        }
        if (kept < 1e-4) continue;
        vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
        accum.set(0, 0, 0);
        for (let corner = 0; corner < 4; corner += 1) {
            if (weights[corner] <= 0) continue;
            boneMat.fromArray(mesh.skeleton.boneMatrices, joints[corner] * 16);
            temp.copy(vertex).applyMatrix4(boneMat).multiplyScalar(weights[corner] / kept);
            accum.add(temp);
        }
        accum.applyMatrix4(mesh.bindMatrixInverse);
        out[i * 3] = accum.x;
        out[i * 3 + 1] = accum.y;
        out[i * 3 + 2] = accum.z;
    }
    return out;
}

function localRest(mesh) {
    const position = mesh.geometry.attributes.position;
    const count = position.count;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        _bind.fromBufferAttribute(position, i);
        out[i * 3] = _bind.x;
        out[i * 3 + 1] = _bind.y;
        out[i * 3 + 2] = _bind.z;
    }
    return out;
}

/** Body points posed in world space, then expressed in ``mesh`` local space so the cloth and the skin share a frame. */
function bodyInGarmentSpace(bodyMesh, garmentMesh) {
    const world = localSkinned(bodyMesh);
    const change = new THREE.Matrix4().multiplyMatrices(
        new THREE.Matrix4().copy(garmentMesh.matrixWorld).invert(),
        bodyMesh.matrixWorld
    );
    const count = world.length / 3;
    for (let i = 0; i < count; i += 1) {
        _posed.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]).applyMatrix4(change);
        world[i * 3] = _posed.x;
        world[i * 3 + 1] = _posed.y;
        world[i * 3 + 2] = _posed.z;
    }
    return { positions: world, normals: bodyNormals(world, indexArray(bodyMesh.geometry)) };
}

function lapOf(rest) {
    const count = rest.length / 3;
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    for (let i = 0; i < count; i += 1) {
        cx += rest[i * 3];
        const y = rest[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    cx /= count || 1;
    const cut = minY + (maxY - minY) * 0.5;
    const lap = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
        if (rest[i * 3 + 1] <= cut && Math.abs(rest[i * 3] - cx) < 0.16) lap[i] = 1;
    }
    return lap;
}

function bodyNormals(positions, index) {
    const normals = new Float32Array(positions.length);
    if (!index) return normals;
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t];
        const b = index[t + 1];
        const c = index[t + 2];
        const ax = positions[a * 3];
        const ay = positions[a * 3 + 1];
        const az = positions[a * 3 + 2];
        const e1x = positions[b * 3] - ax;
        const e1y = positions[b * 3 + 1] - ay;
        const e1z = positions[b * 3 + 2] - az;
        const e2x = positions[c * 3] - ax;
        const e2y = positions[c * 3 + 1] - ay;
        const e2z = positions[c * 3 + 2] - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        normals[a * 3] += nx;
        normals[a * 3 + 1] += ny;
        normals[a * 3 + 2] += nz;
        normals[b * 3] += nx;
        normals[b * 3 + 1] += ny;
        normals[b * 3 + 2] += nz;
        normals[c * 3] += nx;
        normals[c * 3 + 1] += ny;
        normals[c * 3 + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        if (len > 1e-8) {
            normals[i] /= len;
            normals[i + 1] /= len;
            normals[i + 2] /= len;
        } else {
            normals[i + 1] = 1;
        }
    }
    return normals;
}

function chainName(object) {
    const parts = [];
    let node = object;
    while (node) {
        if (node.name) parts.push(node.name);
        node = node.parent;
    }
    return parts.join(' ');
}

/** Skin, including a VRM body split into several primitives. Never a bodycon garment. */
function isBodyMesh(mesh, api) {
    let node = mesh;
    while (node) {
        if (api.isBodyName(node.name || '')) return true;
        node = node.parent;
    }
    return false;
}

function bodyCloud(bodies, garment) {
    const parts = bodies.map((mesh) => bodyInGarmentSpace(mesh, garment));
    const length = parts.reduce((sum, part) => sum + part.positions.length, 0);
    const positions = new Float32Array(length);
    const normals = new Float32Array(length);
    let offset = 0;
    for (const part of parts) {
        positions.set(part.positions, offset);
        normals.set(part.normals, offset);
        offset += part.positions.length;
    }
    return { positions, normals };
}

function indexArray(geometry) {
    if (geometry.index) return geometry.index.array;
    const count = geometry.attributes.position.count;
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) out[i] = i;
    return out;
}

function showCorrected(mesh, local) {
    if (!mesh.parent) return null;
    let overlay = mesh.userData.poseGarmentOverlay;
    if (!overlay) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(local, 3));
        if (mesh.geometry.attributes.uv) geometry.setAttribute('uv', mesh.geometry.attributes.uv.clone());
        if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        overlay = new THREE.Mesh(geometry, mesh.material);
        overlay.name = `${mesh.name || 'garment'}:pose-corrected`;
        overlay.frustumCulled = false;
        overlay.matrixAutoUpdate = false;
        overlay.userData.poseGarmentCorrection = true;
        mesh.parent.add(overlay);
        mesh.userData.poseGarmentOverlay = overlay;
    } else {
        overlay.geometry.attributes.position.array.set(local);
        overlay.geometry.attributes.position.needsUpdate = true;
        overlay.geometry.computeVertexNormals();
        overlay.geometry.computeBoundingSphere();
    }
    overlay.matrix.copy(mesh.matrix);
    overlay.matrixWorldNeedsUpdate = true;
    overlay.visible = true;
    mesh.visible = false;
    return overlay;
}

/**
 * Correct every garment on ``root``. Returns the number of garments corrected.
 * No second renderer: one Mesh per garment, in the avatar's existing scene.
 */
export function correctPosedGarments(root) {
    const api = globalThis.NEXUS_POSE_GARMENT_CORRECTION;
    if (!api || !root) return 0;
    root.updateMatrixWorld(true);
    const skinned = [];
    root.traverse((object) => {
        if (object.isSkinnedMesh && object.geometry?.attributes?.position && !object.userData.poseGarmentCorrection) {
            skinned.push(object);
        }
    });
    const bodies = skinned.filter((mesh) => isBodyMesh(mesh, api));
    const pool = bodies.length ? bodies : skinned;
    const body = pool.reduce((largest, mesh) => {
        if (!largest) return mesh;
        return mesh.geometry.attributes.position.count > largest.geometry.attributes.position.count ? mesh : largest;
    }, null);
    if (!body) return 0;
    let corrected = 0;
    for (const mesh of skinned) {
        if (bodies.includes(mesh) || mesh === body) continue;
        if (SKIP.test(mesh.name || '') || SKIP.test(chainName(mesh))) continue;
        const rest = localRest(mesh);
        const lap = lapOf(rest);
        const posed = unpinThighs(mesh, localSkinned(mesh), lap);
        const bodyLocal = bodyCloud(bodies.length ? bodies : [body], mesh);
        const bodyPos = bodyLocal.positions;
        const bodyNrm = bodyLocal.normals;
        if (!lap.some((flag) => flag)) continue;
        const positions = api.correct({
            posed,
            rest,
            indices: indexArray(mesh.geometry),
            lap,
            bodyPos,
            bodyNrm,
        });
        if (showCorrected(mesh, positions)) corrected += 1;
    }
    return corrected;
}

/** Drop corrected meshes and show the skinned garments again. Used when the avatar changes. */
export function clearPosedGarments(root) {
    if (!root) return;
    const drop = [];
    root.traverse((object) => {
        if (object.userData?.poseGarmentOverlay) {
            drop.push(object);
        }
    });
    for (const mesh of drop) {
        const overlay = mesh.userData.poseGarmentOverlay;
        overlay.geometry.dispose();
        overlay.removeFromParent();
        delete mesh.userData.poseGarmentOverlay;
        mesh.visible = true;
    }
}
