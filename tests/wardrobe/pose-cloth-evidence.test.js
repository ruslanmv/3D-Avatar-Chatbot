/**
 * The research question that has to be answered before a new solver:
 * does this mesh contain a seated shape, or only connectivity and a standing cut?
 *
 * A connected skirt panel can be held together. Its rest positions are not a seated drape.
 * An open crotch whose boundaries are not the same rest point has no seam pair to stitch.
 * Proximity is not a seam. evidenceOf records that and does not repair it.
 */
const C = require('../../src/wardrobe/PoseClothCorrection.js');

function panel(y, x0, x1, z0, z1, n) {
    const pos = [];
    const indices = [];
    for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
            const px = x0 + ((x1 - x0) * i) / (n - 1);
            const pz = z0 + ((z1 - z0) * j) / (n - 1);
            pos.push(px, y, pz);
        }
    }
    for (let i = 0; i < n - 1; i += 1) {
        for (let j = 0; j < n - 1; j += 1) {
            const a = i * n + j;
            indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
    }
    return { pos, indices };
}

function quad(x, z) {
    const pos = [x, 0.8, z, x + 0.02, 0.8, z, x, 0.8, z + 0.02, x + 0.02, 0.8, z + 0.02];
    return { pos, indices: [0, 2, 1, 1, 2, 3] };
}

describe('what the mesh knows about a seated shape', () => {
    test('a skirt panel is one piece across the opening, and the rest pose is not a seated drape', () => {
        const cloth = panel(0.9, -0.15, 0.15, -0.06, 0.06, 11);
        const evidence = C.evidenceOf(cloth.pos, cloth.indices);
        expect(evidence.components).toBe(1);
        expect(evidence.panelCrossesOpening).toBe(true);
        expect(evidence.unpairedBoundaries).toBe(0);
        expect(evidence.canEnforceKnownPanel).toBe(true);
        expect(evidence.seatedDrapeInRest).toBe(false);
        expect(evidence.canRepairOpenSeam).toBe(false);
    });

    test('two crotch boundaries 8 mm apart are not a seam the weld can close', () => {
        const left = quad(-0.02, 0);
        const right = quad(0.008, 0);
        const pos = left.pos.concat(right.pos);
        const indices = right.indices.map((index) => index + 4).concat(left.indices);
        const evidence = C.evidenceOf(pos, indices);
        expect(evidence.copiesWelded).toBe(0);
        expect(evidence.components).toBe(2);
        expect(evidence.unpairedBoundaries).toBeGreaterThan(0);
        expect(evidence.canRepairOpenSeam).toBe(false);
        expect(evidence.canEnforceKnownPanel).toBe(false);
    });

    test('UV copies that share a rest point are the only seam pairs', () => {
        const cloth = panel(0.9, -0.04, 0.04, -0.04, 0.04, 3);
        const pos = cloth.pos.concat(cloth.pos);
        const indices = cloth.indices.concat(cloth.indices.map((index) => index + cloth.pos.length / 3));
        const evidence = C.evidenceOf(pos, indices);
        expect(evidence.vertices).toBe(18);
        expect(evidence.particles).toBe(9);
        expect(evidence.copiesWelded).toBe(9);
        expect(evidence.components).toBe(1);
    });
});
