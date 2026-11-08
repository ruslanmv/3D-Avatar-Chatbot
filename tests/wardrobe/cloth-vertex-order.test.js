/**
 * M1. A mesh that carries wardrobe.cloth/1 keeps the file vertex order its
 * WCL1 binding addresses. three-vrm 2.1.0's removeUnnecessaryVertices rebuilds
 * each indexed mesh with vertices ordered by first use in the index buffer;
 * the stand-in below does the same thing, so the A-line's file prefix
 * 0, 1, 34, 0, 34, 33 becomes 0, 1, 2, 0, 2, 3 when it is not protected.
 */
/** The slice of THREE.Object3D / Mesh / BufferGeometry the guard touches. */
class Node {
    constructor(isMesh = false) {
        this.isMesh = isMesh;
        this.parent = null;
        this.children = [];
        this.userData = {};
    }
    add(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
        return this;
    }
    traverse(fn) {
        fn(this);
        for (const child of this.children.slice()) child.traverse(fn);
    }
}
const geometryOf = (index) => ({ index: { array: Uint32Array.from(index) } });
const Pilot = require('../../src/wardrobe/XpbdSkirtPilot.js');

/** What three-vrm does to an indexed geometry: renumber by first use. */
function compactLikeThreeVrm(root) {
    root.traverse((node) => {
        if (!node.isMesh || !node.geometry.index) return;
        const old = node.geometry.index.array;
        const map = new Map();
        const index = Array.from(old, (v) => {
            if (!map.has(v)) map.set(v, map.size);
            return map.get(v);
        });
        node.geometry = geometryOf(index);
    });
}

function mesh(name, index, userData) {
    const out = new Node(true);
    out.geometry = geometryOf(index);
    out.name = name;
    if (userData) out.userData = userData;
    return out;
}

const FILE_ORDER = [0, 1, 34, 0, 34, 33, 1, 2, 35];
const cloth = { wardrobeForge: { templateId: 'dress-a-line-v1', clothAsset: { schema: 'wardrobe.cloth/1' } } };

function scene() {
    const root = new Node();
    const body = mesh('Body', [0, 5, 9, 0, 9, 7]);
    const dressGroup = new Node();
    dressGroup.userData = cloth; // GLTFLoader puts node extras on the group of a multi-primitive mesh
    const dress = mesh('Dress', FILE_ORDER);
    dressGroup.add(dress);
    const hair = mesh('Hair', [3, 8, 4]);
    root.add(body, dressGroup, hair);
    return { root, body, dressGroup, dress, hair };
}

describe('M1: cloth meshes keep file vertex order through three-vrm compaction', () => {
    test('the stand-in reproduces the audited renumbering when nothing is protected', () => {
        const { root, dress } = scene();
        compactLikeThreeVrm(root);
        expect(Array.from(dress.geometry.index.array)).toEqual([0, 1, 2, 0, 2, 3, 1, 4, 5]);
    });

    test('a wardrobe.cloth/1 mesh is skipped; every other mesh is still compacted', () => {
        const { root, body, dress, hair } = scene();
        const geometry = dress.geometry;
        expect(Pilot.compactExceptCloth(root, compactLikeThreeVrm)).toBe(1);
        expect(dress.geometry).toBe(geometry);
        expect(Array.from(dress.geometry.index.array)).toEqual(FILE_ORDER);
        expect(Array.from(body.geometry.index.array)).toEqual([0, 1, 2, 0, 2, 3]);
        expect(Array.from(hair.geometry.index.array)).toEqual([0, 1, 2]);
    });

    test('the scene graph is put back exactly: same parent, same child index', () => {
        const { root, dressGroup, dress, body, hair } = scene();
        const before = root.children.slice();
        Pilot.compactExceptCloth(root, compactLikeThreeVrm);
        expect(root.children).toEqual(before);
        expect(root.children.indexOf(body)).toBe(0);
        expect(root.children.indexOf(hair)).toBe(2);
        expect(dress.parent).toBe(dressGroup);
        expect(dressGroup.children).toEqual([dress]);
    });

    test('a compaction that throws still restores the cloth mesh', () => {
        const { root, dress, dressGroup } = scene();
        expect(() =>
            Pilot.compactExceptCloth(root, () => {
                throw new Error('three-vrm failed');
            })
        ).toThrow('three-vrm failed');
        expect(dress.parent).toBe(dressGroup);
        expect(dressGroup.children).toEqual([dress]);
    });

    test('several cloth meshes under one parent return to their own indices', () => {
        const root = new Node();
        const a = mesh('A', [0, 2, 1], cloth);
        const b = mesh('B', [0, 1, 2]);
        const c = mesh('C', [5, 4, 3], cloth);
        const d = mesh('D', [0, 1, 2], cloth);
        root.add(a, b, c, d);
        expect(Pilot.compactExceptCloth(root, compactLikeThreeVrm)).toBe(3);
        expect(root.children).toEqual([a, b, c, d]);
        expect(Array.from(c.geometry.index.array)).toEqual([5, 4, 3]);
    });

    test('an untagged garment, or another schema, is not protected', () => {
        expect(Pilot.carriesClothAsset(mesh('Tee', [0, 1, 2]))).toBe(false);
        expect(
            Pilot.carriesClothAsset(
                mesh('X', [0, 1, 2], { wardrobeForge: { clothAsset: { schema: 'wardrobe.cloth/2' } } })
            )
        ).toBe(false);
    });

    test('the default page still compacts every mesh: the guard is behind the cloth flag', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../src/gltf-viewer/AvatarManager.js'),
            'utf8'
        );
        expect(src).toMatch(/if \(clothFlag && clothFlag !== 'off' && pilot\?\.compactExceptCloth\)/);
        expect(src).toMatch(/\} else \{\s*compact\(vrm\.scene\);/);
    });
});
