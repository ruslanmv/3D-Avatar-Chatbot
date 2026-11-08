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
const Pilot = require('../../src/wardrobe/XpbdSkirtPilot.js');

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
        const summary = { schema: 'wardrobe.cloth/1', simulation: 'xpbd', profile: 'cloth' };
        expect(Deform.solverFor(summary, 'xpbd')).toBe('xpbd');
        expect(Deform.solverFor(summary, undefined)).toBe('pose-correction');
        expect(Deform.solverFor({ ...summary, profile: 'corrective' }, 'xpbd')).toBe('pose-correction');
        expect(Deform.pilotFor({ templateId: 'top-fitted-v1', clothAsset: summary }, 'xpbd')).toBe(false);
        expect(Deform.pilotFor({ templateId: 'dress-a-line-v1', clothAsset: summary }, 'xpbd')).toBe(true);
        expect(Deform.solverFor({ schema: 'wardrobe.cloth/1', simulation: 'fallback-skinning' }, 'xpbd')).toBe('pose-correction');
    });
});

describe('skirt-only lap pilot', () => {
    test('thigh capsule blocks a hem particle from the underside, at radius 0.2', () => {
        const state = Sim.create({
            positions: new Float32Array([0, -0.04, 0]),
            attachment: new Float32Array([0]), stretch: [], shear: [], bend: [],
        }, { substeps: 1, iterations: 1 });
        const thigh = { ...Body.capsule(-0.3, 0, 0, 0.3, 0, 0, 0.2), lap: true };
        expect(Body.collideLap(state, [thigh], new Uint8Array([1]), 0)).toBe(1);
        expect(state.x[1]).toBeGreaterThanOrEqual(0.2 - 1e-5);
    });

    test('two lap contacts average and do not move a pinned waist or a side hem', () => {
        const state = Sim.create({
            positions: new Float32Array([0, -0.02, 0, 0.2, -0.02, 0, 0, 0.3, 0]),
            attachment: new Float32Array([0, 0, 1]), stretch: [], shear: [], bend: [],
        });
        const left = { ...Body.capsule(-0.05, 0, -0.02, 0.05, 0, -0.02, 0.2), lap: true };
        const right = { ...Body.capsule(-0.05, 0, 0.02, 0.05, 0, 0.02, 0.2), lap: true };
        const n = Body.collideLap(state, [left, right], new Uint8Array([1, 0, 1]), 0);
        expect(n).toBe(1);
        expect(state.x[1]).toBeGreaterThan(0.18);
        expect(state.x[4]).toBeCloseTo(-0.02, 5);
        expect(state.x[7]).toBeCloseTo(0.3, 5);
    });

    test('brief clearance holds the front hem above the brief lower silhouette only', () => {
        const state = Sim.create({
            positions: new Float32Array([0, 0.2, 0, 0.1, 0.2, 0]),
            attachment: new Float32Array([0, 0]), stretch: [], shear: [], bend: [],
        });
        Body.clearBriefs(state, { minY: 0.28 }, new Uint8Array([1, 0]), 0.012);
        expect(state.x[1]).toBeCloseTo(0.292, 5);
        expect(state.x[4]).toBeCloseTo(0.2, 5);
    });

    test('WCL binding initializes simulation particles from skinned world positions', () => {
        const asset = {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            binding: [
                { i0: 0, i1: 0, i2: 0, w0: 1, w1: 0, w2: 0 },
                { i0: 1, i1: 1, i2: 1, w0: 1, w1: 0, w2: 0 },
            ],
        };
        const current = Pilot.initialParticles(asset, new Float32Array([2, 3, 4, 5, 6, 7]));
        expect(Array.from(current)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(Pilot.eligible({
            templateId: 'dress-a-line-v1',
            clothAsset: { schema: 'wardrobe.cloth/1', profile: 'cloth', simulation: 'xpbd' },
        })).toBe(true);
        expect(Pilot.eligible({
            templateId: 'top-fitted-v1',
            clothAsset: { schema: 'wardrobe.cloth/1', profile: 'cloth', simulation: 'xpbd' },
        })).toBe(false);
    });
});
