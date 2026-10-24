/**
 * SW1. The viewer's half of the posed cloth correction (src/wardrobe/PoseClothCorrection.js).
 *
 * Once a pose has settled, this skins her body and every Forge garment on the CPU exactly as
 * the GPU does, sends the positions to the worker, and writes the answer back into each
 * garment's own bind space — the inverse of that vertex's skin transform — so the GPU's
 * skinning, applied to the corrected geometry, puts the cloth where the correction did. Her
 * body is never touched.
 *
 * Snapshot and restore, not undo: the first correction of a geometry keeps its original
 * positions, every correction starts from them, and `release` writes them back verbatim when
 * she moves (a new preset blending in, a bone being dragged, another avatar). A correction that
 * arrives after she has moved on is dropped: it belongs to a pose she is no longer in.
 *
 * Fail soft: with no worker, no Forge garment or anything unexpected, it warns and leaves the
 * skinned cloth as it was.
 */
import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

const SNAPSHOT = 'nexusPoseClothRest';
// three r147's BufferAttribute has getX…getW (normalised weights included), not getComponent.
const GET = ['getX', 'getY', 'getZ', 'getW'];
const component = (attribute, v, k) => attribute[GET[k]](v);
// A shoe holds her foot inside it: only cloth above her ankles is moved.
const FIXED_BONE = /foot|toe/i;
// Her arms are not what cloth rests on. With her arms down the nearest skin to a dress's sides
// is her forearm, and pushing the dress away from it drove it into her waist: arms that pass
// through cloth are the pose's problem, not the cloth's.
const NOT_A_SURFACE = /arm|hand|thumb|index|middle|ring|little|finger/i;

function forgeTag(object) {
    const node = forgeNode(object);
    return node ? node.userData.wardrobeForge : null;
}

/** The glTF node a garment piece belongs to: the one Forge tagged (several materials, one node). */
function forgeNode(object) {
    for (let node = object; node; node = node.parent) {
        const tag = node.userData && node.userData.wardrobeForge;
        if (tag && tag.kind === 'garment') return node;
    }
    return null;
}

function materialName(mesh) {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return (material && material.name) || '';
}

/** Her skin and the Forge garments, innermost layer first. */
export function collect(root) {
    const body = [];
    const garments = [];
    root.traverse((object) => {
        if (!object.isSkinnedMesh || !object.geometry || !object.geometry.attributes.position) return;
        const name = materialName(object);
        const tag = forgeTag(object);
        if (tag || /\[Forge_/.test(name)) {
            garments.push({ mesh: object, tag, name, node: forgeNode(object) || object });
        } else if (/_SKIN|^Body$/.test(name)) {
            body.push(object);
        }
    });
    const rank = (g) => {
        const role = g.tag && g.tag.role;
        const slot = (g.tag && g.tag.slot) || '';
        if (role === 'foundation') return 0;
        if (/shoes/i.test(slot) || /Shoes/.test(g.name)) return 3;
        return 1 + Math.min(1, Number((g.tag && g.tag.layer) || 1) / 10);
    };
    garments.sort((a, b) => rank(a) - rank(b));
    return { body, garments };
}

/** Per-vertex skin matrices of a skinned mesh, as the GPU computes them (world space). */
function skinMatrices(mesh) {
    mesh.skeleton.update();
    const geo = mesh.geometry;
    const index = geo.attributes.skinIndex;
    const weight = geo.attributes.skinWeight;
    const bones = mesh.skeleton.boneMatrices;
    const pre = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    const count = geo.attributes.position.count;
    const out = new Float32Array(count * 16);
    const blend = new THREE.Matrix4();
    const total = new THREE.Matrix4();
    for (let v = 0; v < count; v += 1) {
        const e = blend.elements;
        e.fill(0);
        for (let k = 0; k < 4; k += 1) {
            const w = component(weight, v, k);
            if (!w) continue;
            const j = component(index, v, k) * 16;
            for (let n = 0; n < 16; n += 1) e[n] += bones[j + n] * w;
        }
        total.multiplyMatrices(pre, blend).multiply(mesh.bindMatrix);
        out.set(total.elements, v * 16);
    }
    return out;
}

function apply(matrices, v, x, y, z, w, target, at) {
    const m = v * 16;
    target[at] = matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z + matrices[m + 12] * w;
    target[at + 1] = matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13] * w;
    target[at + 2] = matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z + matrices[m + 14] * w;
}

function restPositions(mesh) {
    const geo = mesh.geometry;
    if (!geo.userData[SNAPSHOT]) geo.userData[SNAPSHOT] = Float32Array.from(geo.attributes.position.array);
    return geo.userData[SNAPSHOT];
}

/** Posed positions (and normals, for her skin) in world space, from the snapshot. */
function posed(mesh, matrices, withNormals) {
    const rest = restPositions(mesh);
    const count = rest.length / 3;
    const pos = new Float32Array(count * 3);
    const nrm = withNormals ? new Float32Array(count * 3) : null;
    const normals = withNormals && mesh.geometry.attributes.normal;
    for (let v = 0; v < count; v += 1) {
        apply(matrices, v, rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2], 1, pos, v * 3);
        if (nrm && normals) {
            apply(matrices, v, normals.getX(v), normals.getY(v), normals.getZ(v), 0, nrm, v * 3);
            const len = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
            nrm[v * 3] /= len;
            nrm[v * 3 + 1] /= len;
            nrm[v * 3 + 2] /= len;
        }
    }
    return { pos, nrm };
}

function triangles(geometry) {
    if (geometry.index) return Array.from(geometry.index.array);
    const count = geometry.attributes.position.count;
    return Array.from({ length: count - (count % 3) }, (_, i) => i);
}

/** The bone carrying most of each vertex's weight. */
function dominantBones(mesh) {
    const geo = mesh.geometry;
    const index = geo.attributes.skinIndex;
    const weight = geo.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    const out = new Array(geo.attributes.position.count);
    for (let v = 0; v < out.length; v += 1) {
        let best = 0;
        let top = -1;
        for (let k = 0; k < 4; k += 1) {
            const w = component(weight, v, k);
            if (w > best) {
                best = w;
                top = component(index, v, k);
            }
        }
        out[v] = top >= 0 && bones[top] ? bones[top].name : '';
    }
    return out;
}

/** Keep only her torso and legs: the surfaces cloth lies on. */
function torsoAndLegs(mesh, pos, nrm) {
    const names = dominantBones(mesh);
    const keep = [];
    for (let v = 0; v < names.length; v += 1) if (!NOT_A_SURFACE.test(names[v])) keep.push(v);
    const p = new Float32Array(keep.length * 3);
    const n = new Float32Array(keep.length * 3);
    keep.forEach((v, i) => {
        p.set(pos.subarray(v * 3, v * 3 + 3), i * 3);
        n.set(nrm.subarray(v * 3, v * 3 + 3), i * 3);
    });
    return { pos: p, nrm: n };
}

function movableOf(mesh) {
    const geo = mesh.geometry;
    const index = geo.attributes.skinIndex;
    const weight = geo.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    const out = new Uint8Array(geo.attributes.position.count);
    for (let v = 0; v < out.length; v += 1) {
        let best = 0;
        let top = -1;
        for (let k = 0; k < 4; k += 1) {
            const w = component(weight, v, k);
            if (w > best) {
                best = w;
                top = component(index, v, k);
            }
        }
        const bone = top >= 0 ? bones[top] : null;
        out[v] = bone && FIXED_BONE.test(bone.name) ? 0 : 1;
    }
    return out;
}

export class PoseClothCorrector {
    constructor(options = {}) {
        this.workerUrl = options.workerUrl || new URL('../wardrobe/PoseClothWorker.js', import.meta.url);
        this.worker = null;
        this.generation = 0;
        this.root = null;
        this.last = null; // the before/after numbers of the last correction, for QA
        this.onCorrected = options.onCorrected || null;
    }

    _worker() {
        if (!this.worker && typeof Worker !== 'undefined') this.worker = new Worker(this.workerUrl);
        return this.worker;
    }

    /** Put every corrected garment of `root` back as the file made it. */
    release(root = this.root) {
        this.generation += 1;
        if (!root) return;
        root.traverse((object) => {
            const geo = object.isSkinnedMesh && object.geometry;
            const snapshot = geo && geo.userData[SNAPSHOT];
            if (!snapshot) return;
            geo.attributes.position.array.set(snapshot);
            geo.attributes.position.needsUpdate = true;
        });
    }

    /** Correct the garments of `root` for the pose it is in now. Resolves to the numbers; never throws. */
    correct(root) {
        try {
            return this._correct(root);
        } catch (error) {
            console.warn('[PoseCloth] correction skipped', error);
            return Promise.resolve(null);
        }
    }

    _correct(root) {
        const generation = ++this.generation;
        this.root = root;
        let found;
        try {
            found = collect(root);
        } catch (error) {
            console.warn('[PoseCloth] could not read the avatar', error);
            return Promise.resolve(null);
        }
        if (!found.body.length || !found.garments.length) return Promise.resolve(null);
        const worker = this._worker();
        if (!worker) return Promise.resolve(null);
        root.updateMatrixWorld(true);
        const bodyPos = [];
        const bodyNrm = [];
        found.body.forEach((mesh) => {
            const all = posed(mesh, skinMatrices(mesh), true);
            const p = torsoAndLegs(mesh, all.pos, all.nrm);
            bodyPos.push(p.pos);
            bodyNrm.push(p.nrm);
        });
        const join = (parts) => {
            const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
            let at = 0;
            parts.forEach((p) => {
                out.set(p, at);
                at += p.length;
            });
            return out;
        };
        const meshes = [];
        const garments = found.garments.map((g) => {
            const matrices = skinMatrices(g.mesh);
            const rest = restPositions(g.mesh);
            const world = new Float32Array(rest.length);
            const m = g.mesh.matrixWorld.elements;
            for (let v = 0; v < rest.length / 3; v += 1) {
                const x = rest[v * 3];
                const y = rest[v * 3 + 1];
                const z = rest[v * 3 + 2];
                world[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
                world[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                world[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
            }
            meshes.push({ mesh: g.mesh, matrices });
            return {
                name: g.name,
                posed: posed(g.mesh, matrices, false).pos,
                rest: world,
                indices: triangles(g.mesh.geometry),
                movable: movableOf(g.mesh),
                // SW2. A shoe is corrected gently: firm relaxation tore a boot's shaft at her knee.
                profile: /shoes/i.test((g.tag && g.tag.slot) || '') || /Shoes/.test(g.name) ? 'shoe' : undefined,
                // SW3. A boot's shell, sole and lining are one garment (one glTF node, three
                // materials, three meshes here): corrected apart, the lining was pushed out
                // through the shell as if it were a layer beneath it.
                group: g.node.uuid,
            };
        });
        const input = { bodyPos: join(bodyPos), bodyNrm: join(bodyNrm), garments };
        return new Promise((resolve) => {
            const onMessage = (event) => {
                const answer = event.data || {};
                if (answer.id !== generation) return;
                worker.removeEventListener('message', onMessage);
                if (generation !== this.generation) return resolve(null); // she has moved on
                if (!answer.ok) {
                    console.warn('[PoseCloth] correction failed:', answer.why);
                    return resolve(null);
                }
                answer.garments.forEach((result, i) => this._write(meshes[i], result.positions));
                this.last = answer.garments.map((g) => ({ name: g.name, before: g.before, after: g.after }));
                if (this.onCorrected) this.onCorrected(this.last);
                resolve(this.last);
            };
            worker.addEventListener('message', onMessage);
            worker.postMessage({ id: generation, input });
        });
    }

    /** World-space corrected positions → this garment's bind space, through each vertex's skin. */
    _write({ mesh, matrices }, corrected) {
        const rest = restPositions(mesh);
        const attribute = mesh.geometry.attributes.position;
        const out = attribute.array;
        const inverse = new THREE.Matrix4();
        const point = new THREE.Vector3();
        const skinned = new Float32Array(3);
        for (let v = 0; v < rest.length / 3; v += 1) {
            apply(matrices, v, rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2], 1, skinned, 0);
            const dx = corrected[v * 3] - skinned[0];
            const dy = corrected[v * 3 + 1] - skinned[1];
            const dz = corrected[v * 3 + 2] - skinned[2];
            if (dx * dx + dy * dy + dz * dz < 1e-12) {
                out[v * 3] = rest[v * 3];
                out[v * 3 + 1] = rest[v * 3 + 1];
                out[v * 3 + 2] = rest[v * 3 + 2];
                continue;
            }
            inverse.fromArray(matrices, v * 16).invert();
            point.set(corrected[v * 3], corrected[v * 3 + 1], corrected[v * 3 + 2]).applyMatrix4(inverse);
            out[v * 3] = point.x;
            out[v * 3 + 1] = point.y;
            out[v * 3 + 2] = point.z;
        }
        attribute.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
    }
}
