/**
 * M2. Rests from the skinned start pose, and a thigh capsule measured from the
 * posed body rather than 0.29 x the bone length.
 */
const Sim = require('../../src/wardrobe/ClothSimulation.js');
const Pilot = require('../../src/wardrobe/XpbdSkirtPilot.js');

function strip() {
    // Two particles pinned at the top, one free below; bind rests 0.10 m.
    return {
        positions: new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 0.9, 0]),
        attachment: new Float32Array([1, 1, 0]),
        stretch: [
            { a: 0, b: 1, rest: 0.1, lambda: 0 },
            { a: 0, b: 2, rest: 0.1, lambda: 0 },
            { a: 1, b: 2, rest: Math.SQRT2 * 0.1, lambda: 0 },
        ],
        shear: [{ a: 0, b: 1, c: 2, rest: 0.1, lambda: 0 }],
        bend: [],
    };
}

describe('M2: pose-space rests', () => {
    test('bind rests are the default: nothing changes without restSpace', () => {
        const asset = strip();
        Sim.create(asset, { initial: new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 0.85, 0]) });
        expect(asset.stretch[1].rest).toBeCloseTo(0.1, 6);
        expect(asset.stretch[1].authoredRest).toBeUndefined();
    });

    test("restSpace 'pose' takes each rest from the skinned start and keeps the authored one", () => {
        const asset = strip();
        // Skinning laid the garment 0.15 m long where Forge built it 0.10 m.
        const initial = new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 0.85, 0]);
        Sim.create(asset, { initial, restSpace: 'pose' });
        expect(asset.stretch[1].rest).toBeCloseTo(0.15, 6);
        expect(asset.stretch[1].authoredRest).toBeCloseTo(0.1, 6);
        expect(asset.shear[0].rest).toBeCloseTo(Math.hypot(0.05, 0.15), 6);
        expect(asset.shear[0].authoredRest).toBeCloseTo(0.1, 6);
    });

    test('a 1 mm bridge is not pulled back to its bind length by the solver', () => {
        // Two pinned waist particles and a free bridge partner 1 mm below in bind
        // space; skinning moved the partner 3 mm away. Bind rests drag it back.
        const make = () => ({
            positions: new Float32Array([0, 1, 0, 0.02, 1, 0, 0, 0.999, 0]),
            attachment: new Float32Array([1, 1, 0]),
            stretch: [{ a: 0, b: 2, rest: 0.001, lambda: 0 }],
            shear: [],
            bend: [],
        });
        const initial = new Float32Array([0, 1, 0, 0.02, 1, 0, 0, 0.997, 0]);
        const run = (restSpace) => {
            const state = Sim.create(make(), { initial, restSpace, substeps: 2, iterations: 6 });
            Sim.step(state, 1 / 60, { gravity: 0, stretchCompliance: 1e-9 });
            return Math.hypot(state.x[6] - state.x[0], state.x[7] - state.x[1], state.x[8] - state.x[2]);
        };
        expect(run('bind')).toBeCloseTo(0.001, 4);
        expect(run('pose')).toBeCloseTo(0.003, 4);
    });

    test('pose rests refuse to run without a start pose', () => {
        expect(() => Sim.create(strip(), { restSpace: 'pose' })).toThrow(/initialization/);
    });
});

describe('M2: thigh capsules measured from the posed body', () => {
    // A thigh along -Y from (±0.1, 0.9, 0) to (±0.1, 0.5, 0); skin 84 mm out.
    const capsule = (x) => ({ ax: x, ay: 0.9, az: 0, bx: x, by: 0.5, bz: 0, radius: 0.102, lap: true });
    function ring(x, r, ys, around = 24) {
        const out = [];
        for (const y of ys) {
            for (let k = 0; k < around; k += 1) {
                const a = (2 * Math.PI * k) / around;
                out.push(x + r * Math.cos(a), y, r * Math.sin(a));
            }
        }
        return out;
    }

    test('the radius is the median skin distance, not 0.29 x bone length', () => {
        const ys = [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55];
        // The two thighs are 0.2 m apart and 84 mm thick, so neither ring reaches the other bone.
        const body = Float32Array.from([...ring(-0.1, 0.084, ys), ...ring(0.1, 0.084, ys)]);
        const [left, right] = Pilot.fitCapsulesToBody([capsule(-0.1), capsule(0.1)], body);
        expect(left.fitted).toBe(true);
        expect(left.radius).toBeCloseTo(0.084, 4);
        expect(right.radius).toBeCloseTo(0.084, 4);
        expect(left.boneRadius).toBeCloseTo(0.102, 6);
        expect(left.lap).toBe(true);
    });

    test('hip and knee vertices are not sampled', () => {
        const middle = ring(-0.1, 0.08, [0.8, 0.7, 0.6]);
        const joints = ring(-0.1, 0.15, [0.9, 0.88, 0.52, 0.5]); // a wide hip and knee
        const [fit] = Pilot.fitCapsulesToBody([capsule(-0.1)], Float32Array.from([...middle, ...joints]));
        expect(fit.radius).toBeCloseTo(0.08, 4);
    });

    test('too few body vertices keep the bone radius and say it was not fitted', () => {
        const [fit] = Pilot.fitCapsulesToBody([capsule(-0.1)], Float32Array.from(ring(-0.1, 0.08, [0.7], 8)));
        expect(fit.fitted).toBe(false);
        expect(fit.radius).toBeCloseTo(0.102, 6);
    });

    test('the live corrector sends pose rests and fitted capsules only on the xpbd pilot path', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../src/gltf-viewer/PoseClothCorrector.js'),
            'utf8'
        );
        expect(src).toMatch(/restSpace: 'pose'/);
        expect(src).toMatch(/fitCapsulesToBody\(Pilot\.thighCapsules\(found\.body\), input\.bodyPos\)/);
        const worker = require('fs').readFileSync(
            require('path').join(__dirname, '../../src/wardrobe/PoseClothWorker.js'),
            'utf8'
        );
        expect(worker).toMatch(/restSpace: job\.restSpace === 'pose' \? 'pose' : 'bind'/);
    });
});
