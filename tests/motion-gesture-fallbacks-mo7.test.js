/**
 * MO7. Gestures the quarantine emptied still move her, and procedural gestures reach the bones
 * that are drawn.
 *
 * #152 quarantined the Mixamo action pack (floats / folds her). For seven names that pack was the
 * only candidate, so "bow", "clap", "victory"… resolved to nothing and the avatar stood still
 * while the chat said she had done it. Separately, the procedural nod / headshake and the IK reach
 * wrote to the NORMALIZED rig after three-vrm had already copied it onto the raw (drawn) rig for
 * the frame, so in a browser a "nod" moved her head ~2° — idle sway — while reporting success.
 */
const fs = require('fs');
const path = require('path');

const Clips = require('../src/xr/MotionClipMap.js');

describe('MO7: quarantined gestures fall through to grounded clips', () => {
    beforeAll(() => {
        // The browser loads vendor/animations/manifest.json; library-only mode (the default) keeps
        // only files from its non-experimental categories, so the test must see the same set.
        const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vendor/animations/manifest.json'), 'utf8'));
        Clips._setManifest(man);
    });
    afterAll(() => Clips._setManifest(null));

    const grounded = {
        clap: 'vendor/animations/emotion/approval2.bvh',
        victory: 'vendor/animations/emotion/excitement2.bvh',
        shrug: 'vendor/animations/emotion/confusion.bvh',
        sing: 'vendor/animations/emotion/joy.bvh',
        jumping_jacks: 'vendor/animations/exercise/exercise_jumping_jacks.bvh',
    };

    for (const [name, file] of Object.entries(grounded)) {
        test(`${name} resolves to a shipped clip that is not quarantined`, () => {
            const r = Clips.resolve(name);
            expect(r).toBeTruthy();
            expect(r.candidates.length).toBeGreaterThan(0);
            for (const c of r.candidates) expect(Clips.QUARANTINE[c]).toBeUndefined();
            expect(r.candidates.some((c) => c.endsWith(file.split('/').slice(-2).join('/')))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '..', file))).toBe(true);
        });
    }

    test('bow has no safe clip, so it is procedural', () => {
        const r = Clips.resolve('bow');
        expect(r.candidates).toEqual([]);
        expect(r.procedural).toBe('bow');
    });

    test('backflip is not offered: its only clip floats her and nothing stands in', () => {
        expect(Clips.resolve('backflip').candidates).toEqual([]);
        expect(Clips.availableNames()).not.toContain('backflip');
    });

    test('every advertised name can move her', () => {
        for (const n of Clips.availableNames()) {
            const r = Clips.resolve(n);
            expect(r && (r.candidates.length > 0 || !!r.procedural)).toBe(true);
        }
    });
});

describe('MO7: procedural motion writes the drawn (raw) rig', () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src/xr', f), 'utf8');

    test('HandContactIK resolves raw bones before normalized ones', () => {
        const s = src('HandContactIK.js');
        const get = s.slice(s.indexOf('const get = (name) =>'));
        expect(get.indexOf('getRawBoneNode')).toBeGreaterThan(-1);
        expect(get.indexOf('getRawBoneNode')).toBeLessThan(get.indexOf('getNormalizedBoneNode'));
    });

    test('head / body gestures turn raw bones about a world axis, never a local .x/.y', () => {
        const s = src('MotionIntegration.js');
        const upd = s.slice(s.indexOf('function _updateHeadFx'), s.indexOf('function _updateLook'));
        expect(upd).toMatch(/getRawBoneNode/);
        expect(upd).not.toMatch(/rotation\.[xy] \+=/);
        expect(s).toMatch(/res\.procedural === 'bow'/);
    });

    test('a one-shot reach is released; offer_hand is the held one', () => {
        const s = src('MotionIntegration.js');
        expect(s).toMatch(/_reach\.until = key === 'offer_hand' \? 0 :/);
        expect(s).toMatch(/_now\(\) > _reach\.until/);
    });
});
