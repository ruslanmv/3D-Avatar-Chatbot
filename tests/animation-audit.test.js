/**
 * AX16. Animation inventory + playback scorer stay honest: the committed audit
 * matches the generator, spoken motion intents resolve, and broken samples are
 * flagged without a browser.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'quality-lab', 'data', '3d', 'animations-audit.json');
const Scorer = require('../tools/qa/AnimationPlaybackScorer.js');

describe('AnimationPlaybackScorer', () => {
    const rest = {
        hips: { x: 0, y: 1, z: 0 },
        leftUpperArm: { x: -0.4, y: 1.2, z: 0 },
        rightUpperArm: { x: 0.4, y: 1.2, z: 0 },
        leftUpperLeg: { x: -0.1, y: 0.5, z: 0 },
        rightUpperLeg: { x: 0.1, y: 0.5, z: 0 },
    };

    test('ok when the clip played and bones moved', () => {
        const sample = {
            ...rest,
            hips: { x: 0, y: 0.92, z: 0.02 },
            leftUpperArm: { x: -0.2, y: 1.0, z: 0.1 },
            rightUpperArm: { x: 0.25, y: 1.05, z: -0.05 },
        };
        const r = Scorer.score({
            played: true,
            rest,
            samples: [sample],
            frame: { mean: 40, sd: 20, verdict: 'ok' },
            category: 'idle',
        });
        expect(r.verdict).toBe('ok');
        expect(r.flags).toEqual([]);
        expect(r.motion).toBeGreaterThan(0.05);
    });

    test('fail when playClip did not run', () => {
        const r = Scorer.score({ played: false, loadError: 'playClip-false', rest, samples: [] });
        expect(r.verdict).toBe('fail');
        expect(r.flags).toEqual(expect.arrayContaining(['play-failed', 'load-error']));
    });

    test('black void background does not fail a moving clip', () => {
        const sample = {
            ...rest,
            hips: { x: 0, y: 0.9, z: 0, qx: 0.1, qy: 0, qz: 0, qw: 0.99 },
            leftUpperArm: { x: -0.2, y: 1.0, z: 0.1, qx: 0.2, qy: 0, qz: 0, qw: 0.98 },
            rightUpperArm: { x: 0.25, y: 1.05, z: 0, qx: -0.2, qy: 0, qz: 0, qw: 0.98 },
        };
        const r = Scorer.score({
            played: true,
            rest,
            samples: [sample],
            frame: { mean: 5, sd: 20, verdict: 'near-black frame' },
            blackBackground: true,
            category: 'idle',
        });
        expect(r.flags).not.toContain('near-black');
        expect(r.verdict).toBe('ok');
    });

    test('fail on inverted legs (Mixamo-origin pattern)', () => {
        // Upper-leg joints stay near the pelvis; the defect is the hip→knee direction.
        const restLegs = {
            ...rest,
            leftUpperLeg: { x: -0.1, y: 0.9, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
            leftLowerLeg: { x: -0.1, y: 0.5, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
            rightUpperLeg: { x: 0.1, y: 0.9, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
            rightLowerLeg: { x: 0.1, y: 0.5, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
        };
        const sample = {
            ...restLegs,
            leftUpperLeg: { x: -0.1, y: 0.9, z: 0, qx: 1, qy: 0, qz: 0, qw: 0 },
            leftLowerLeg: { x: -0.1, y: 1.35, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
            rightUpperLeg: { x: 0.1, y: 0.9, z: 0, qx: 1, qy: 0, qz: 0, qw: 0 },
            rightLowerLeg: { x: 0.1, y: 1.35, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
        };
        const r = Scorer.score({
            played: true,
            rest: restLegs,
            samples: [sample],
            frame: { mean: 40, sd: 20, verdict: 'ok' },
        });
        expect(r.verdict).toBe('fail');
        expect(r.flags).toContain('legs-inverted');
    });

    test('fail when a clip floats her out of frame (Mixamo root track)', () => {
        // Measured: backflip.vrma 3.4 m, waving.vrma 2.39 m on AvatarSample_A, both scored "ok"
        // before hips-floating existed.
        const sample = {
            ...rest,
            hips: { x: 0, y: 2.39, z: 0 },
            leftUpperArm: { x: -0.2, y: 2.6, z: 0.1 },
            rightUpperArm: { x: 0.25, y: 2.6, z: 0 },
        };
        const r = Scorer.score({ played: true, rest, samples: [sample], category: 'actions-vrma' });
        expect(r.verdict).toBe('fail');
        expect(r.flags).toContain('hips-floating');
    });

    test('float and sink are judged against her standing height, not a displaced rest', () => {
        // After a sinking clip the next job's rest can start low (hips 0.4 here); a normal 0.82 m
        // dance must not read "floating" because of it.
        const lowRest = { ...rest, hips: { x: 0, y: 0.4, z: 0 } };
        const sample = { ...rest, hips: { x: 0, y: 0.82, z: 0 }, leftUpperArm: { x: -0.2, y: 1.0, z: 0.1 } };
        const r = Scorer.score({
            played: true,
            rest: lowRest,
            samples: [sample],
            category: 'dance-vrma',
            standingHipsY: 0.9,
        });
        expect(r.flags).not.toContain('hips-floating');
        expect(r.flags).not.toContain('hips-underground');
    });

    test('a jump-height bob is not a float', () => {
        const sample = { ...rest, hips: { x: 0, y: 1.3, z: 0 }, leftUpperArm: { x: -0.1, y: 1.5, z: 0 } };
        const r = Scorer.score({ played: true, rest, samples: [sample], category: 'dance-vrma' });
        expect(r.flags).not.toContain('hips-floating');
    });

    test('warn on experimental clips even when they play', () => {
        const sample = {
            ...rest,
            hips: { x: 0, y: 0.9, z: 0 },
            leftUpperArm: { x: -0.1, y: 1.0, z: 0 },
            rightUpperArm: { x: 0.1, y: 1.0, z: 0 },
        };
        const r = Scorer.score({
            played: true,
            experimental: true,
            rest,
            samples: [sample],
            frame: { mean: 40, sd: 20, verdict: 'ok' },
        });
        expect(r.verdict).toBe('warn');
        expect(r.flags).toContain('experimental');
    });

    test('CSV round-trip keeps the header and escapes commas', () => {
        const csv = Scorer.rowsToCsv([
            {
                avatar: 'Vita',
                avatarFile: 'Vita.vrm',
                kind: 'bvh',
                category: 'sitting',
                id: 'sit',
                path: 'vendor/animations/sitting/sit_idle4.bvh',
                played: true,
                verdict: 'ok',
                flags: [],
                motion: 0.1,
                hipsY: 0.5,
                frameMean: 40,
                frameSd: 12,
                frameVerdict: 'ok',
                shot: '',
                error: '',
            },
        ]);
        expect(csv.split('\n')[0]).toBe(Scorer.CSV_HEADER);
        expect(csv).toContain('Vita,Vita.vrm,bvh,sitting');
    });
});

describe('animations-audit.json', () => {
    test('the committed audit matches the generator today', () => {
        const run = () =>
            execFileSync(process.execPath, ['tools/qa/animation-audit.mjs', '--check'], {
                cwd: ROOT,
                stdio: 'pipe',
            });
        expect(run).not.toThrow();
    });

    test('covers every built-in avatar and the spoken motion contract', () => {
        const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        const avatars = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/avatars/avatars.json'), 'utf8'));
        expect(doc.schema).toBe(1);
        expect(doc.summary.fails).toBe(0);
        expect(doc.avatars.map((a) => a.file).sort()).toEqual(avatars.items.map((a) => a.file).sort());
        expect(doc.poses.length).toBeGreaterThanOrEqual(20);
        expect(doc.clips.length).toBeGreaterThan(50);
        const byUtterance = Object.fromEntries(doc.intentCoverage.map((i) => [i.utterance, i]));
        for (const u of ['sit down', 'dance', 'come with me', 'wave', 'lie down', 'stand up', 'bow']) {
            expect(byUtterance[u]).toBeTruthy();
            expect(byUtterance[u].ok).toBe(true);
        }
        expect(doc.rules.product).toMatch(/must move/);
    });

    test('default play plan is smaller than the full matrix and skips Mixamo experimental', () => {
        const node = (code) =>
            JSON.parse(
                execFileSync(process.execPath, ['--input-type=module', '-e', code], {
                    cwd: ROOT,
                    encoding: 'utf8',
                })
            );
        const out = node(`
            import { audit, buildPlayPlan } from './tools/qa/animation-audit.mjs';
            const inv = audit();
            const crit = buildPlayPlan(inv, {});
            const full = buildPlayPlan(inv, { full: true });
            const vita = buildPlayPlan(inv, { avatar: 'Vita', category: 'sitting' });
            console.log(JSON.stringify({
                critical: crit.length,
                full: full.length,
                vitaSitting: vita.length,
                experimentalInCritical: crit.filter((j) => j.experimental).length,
                matrix: inv.summary.matrixCells,
            }));
        `);
        expect(out.critical).toBeGreaterThan(0);
        expect(out.critical).toBeLessThan(out.full);
        expect(out.full).toBe(out.matrix);
        expect(out.experimentalInCritical).toBe(0);
        expect(out.vitaSitting).toBeGreaterThan(0);
        expect(out.vitaSitting).toBeLessThan(out.critical);
    });
});
