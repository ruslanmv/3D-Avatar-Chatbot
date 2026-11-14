/**
 * PX16. Her face must never be skipped because a stale bounding sphere says it is off screen.
 *
 * AvatarManager is an ES module (src/gltf-viewer), so — like camera-presets.test.js — the code is
 * read from the file. The rule is checked at the one seam every avatar and every outfit passes
 * through: where the loaded root becomes `currentRoot`.
 */
/* global describe, test, expect */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/AvatarManager.js'), 'utf8');

describe('the loaded avatar is always drawn', () => {
    test('every mesh under the new root has frustum culling turned off, right where it becomes current', () => {
        const at = src.indexOf('this.currentRoot = root;');
        expect(at).toBeGreaterThan(-1);
        const after = src.slice(at, at + 2500);
        expect(after).toMatch(
            /root\.traverse\(\(node\) => \{\s*if \(node\.isMesh \|\| node\.isSkinnedMesh\) node\.frustumCulled = false;/
        );
    });

    test('the rule, run on a stand-in scene graph, reaches every mesh and nothing else', () => {
        const at = src.indexOf('root.traverse((node) => {', src.indexOf('this.currentRoot = root;'));
        const block = src.slice(at, src.indexOf('});', at) + 3);
        const meshes = [
            { name: 'Face', isMesh: true, isSkinnedMesh: true, frustumCulled: true },
            { name: 'Hair', isMesh: true, isSkinnedMesh: true, frustumCulled: true },
            { name: 'Body', isMesh: true, frustumCulled: true },
        ];
        const bone = { name: 'J_Bip_C_Head', isBone: true, frustumCulled: true };
        const root = { traverse: (fn) => [...meshes, bone].forEach(fn) };
        // eslint-disable-next-line no-new-func
        new Function('root', block)(root);
        expect(meshes.every((m) => m.frustumCulled === false)).toBe(true);
        expect(bone.frustumCulled).toBe(true);
    });
});
