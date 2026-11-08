/**
 * The XPBD prototype. It parses a Forge WCL1 buffer, keeps a pinned particle
 * still, lets a slack particle fall to its rest length, and pushes a particle
 * out of a capsule. It does not claim a live skirt is fixed.
 */
const fs = require('fs');
const path = require('path');

const Asset = require('../../src/wardrobe/ClothAsset.js');
const Sim = require('../../src/wardrobe/ClothSimulation.js');
const Body = require('../../src/wardrobe/BodyCollision.js');
const Deform = require('../../src/wardrobe/GarmentDeformation.js');

function chain() {
    // Hung from a pin. The middle particle is already at rest. The bottom one
    // starts above its rest length, still below the middle, so the edge cannot
    // flip over the pin while it drops.
    return {
        schema: 'wardrobe.cloth/1',
        positions: new Float32Array([0, 0.3, 0, 0, 0.1, 0, 0, 0.05, 0]),
        attachment: new Float32Array([1, 0, 0]),
        stretch: [
            { a: 0, b: 1, rest: 0.2, lambda: 0 },
            { a: 1, b: 2, rest: 0.2, lambda: 0 },
        ],
        shear: [],
        bend: [],
        triangles: new Uint32Array(0),
    };
}

describe('cloth asset', () => {
    test('decodes the Forge WCL1 fixture', () => {
        const asset = Asset.decode(fs.readFileSync(path.join(__dirname, 'fixtures/triangle.wcl1')));
        expect(asset.schema).toBe('wardrobe.cloth/1');
        expect(asset.particles).toBe(3);
        expect(asset.triangles.length).toBe(3);
        expect(asset.stretch).toHaveLength(3);
        expect(asset.shear).toHaveLength(1);
        expect(asset.bend).toHaveLength(0);
        expect(asset.heightFallback).toBe(false);
        const rests = asset.stretch.map((edge) => edge.rest).sort((a, b) => a - b);
        expect(rests[0]).toBeCloseTo(0.1, 5);
        expect(rests[2]).toBeCloseTo(Math.hypot(0.1, 0.1), 5);
        const pinned = [...asset.attachment].filter((weight) => weight >= 0.999);
        expect(pinned).toHaveLength(2);
    });

    test('refuses a buffer that is not a cloth asset', () => {
        expect(() => Asset.decode(new Uint8Array([1, 2, 3, 4]))).toThrow(/unsupported cloth asset/);
    });
});

describe('xpbd', () => {
    test('a pinned end stays and a slack end drops toward the rest length', () => {
        const state = Sim.create(chain(), { substeps: 8, iterations: 8 });
        const pinned = state.x[1];
        for (let frame = 0; frame < 90; frame += 1) Sim.step(state, 1 / 60, { gravity: -9.81 });
        expect(state.x[1]).toBeCloseTo(pinned, 5);
        expect(state.x[7]).toBeLessThan(0);
        expect(Sim.maxStrain(state)).toBeLessThan(1.15);
        expect(state.x.some((value) => Number.isNaN(value))).toBe(false);
        const settled = state.x[7];
        Sim.step(state, 1 / 60, { gravity: -9.81 });
        expect(Math.abs(state.x[7] - settled)).toBeLessThan(0.01);
    });

    test('reset puts the mesh back on its rest pose', () => {
        const state = Sim.create(chain());
        Sim.step(state, 1 / 60, { gravity: -9.81 });
        Sim.reset(state);
        expect(state.x[7]).toBeCloseTo(0.05, 5);
        expect(state.v[7]).toBe(0);
    });

    test('a particle inside a capsule ends up outside it', () => {
        const asset = {
            positions: new Float32Array([0.05, 0, 0]),
            attachment: new Float32Array([0]),
            stretch: [],
            shear: [],
            bend: [],
        };
        const state = Sim.create(asset, { substeps: 1, iterations: 4 });
        const thigh = Body.capsule(0, -1, 0, 0, 1, 0, 0.2);
        Sim.step(state, 1 / 60, { gravity: 0, capsules: [thigh], thickness: 0, collide: Body.collide });
        expect(Math.hypot(state.x[0], state.x[2])).toBeGreaterThanOrEqual(0.2 - 1e-4);
    });

    test('two opposing capsules both contribute in one pass', () => {
        const asset = {
            positions: new Float32Array([0, 0, 0]),
            attachment: new Float32Array([0]),
            stretch: [],
            shear: [],
            bend: [],
        };
        const state = Sim.create(asset, { substeps: 1, iterations: 1 });
        const left = Body.capsule(-0.15, -1, 0, -0.15, 1, 0, 0.2);
        const right = Body.capsule(0.15, -1, 0, 0.15, 1, 0, 0.2);
        const moved = Body.collide(state, [left, right], 0);
        expect(moved).toBe(1);
        expect(Math.abs(state.x[0])).toBeLessThan(0.05);
    });
});

describe('garment strategy', () => {
    test('maps a profile to a deformation and keeps the old solver unless asked', () => {
        expect(Deform.strategyFor('cloth')).toBe('xpbd');
        expect(Deform.strategyFor('corrective')).toMatch(/pose-space/);
        expect(Deform.strategyFor('rigid')).toMatch(/rigid/);
        expect(Deform.strategyFor('skinning')).toMatch(/skinning/);
        expect(Deform.selectLod([], 'mobile-low').simulation).toBe('skinning');
        const summary = { schema: 'wardrobe.cloth/1', simulation: 'xpbd' };
        expect(Deform.solverFor(summary, 'xpbd')).toBe('xpbd');
        expect(Deform.solverFor(summary, undefined)).toBe('pose-correction');
        expect(Deform.solverFor({ schema: 'wardrobe.cloth/1', simulation: 'fallback-skinning' }, 'xpbd')).toBe('pose-correction');
    });
});
