/**
 * The animation knowledge base — coverage, provenance, and a gate that actually bites.
 *
 * B1's promise is narrow and checkable: every shipped asset has exactly one record, every
 * record points at something that exists, and the eight clips this repo knows are broken
 * are labelled as such rather than sitting in the pool looking like any other dance.
 *
 * The last describe block is the one that matters most. A validator nobody has watched
 * reject anything is decoration, so each way a record can be wrong is broken on purpose,
 * against a copy of the manifest, and the gate has to fail.
 */

/* global describe, test, expect, beforeAll */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'kb', 'animations.manifest.jsonl');
const REPORT = path.join(ROOT, 'kb', 'harvest-report.json');

/** The eight Mixamo-origin clips MotionClipMap deliberately keeps out of its pools. */
const EXCLUDED_MIXAMO = [
    'breakdanceUprock.vrma',
    'dancingTwerk.vrma',
    'hipHopDance.vrma',
    'hipHopDancing.vrma',
    'rumbaDancing.vrma',
    'sambaDancing.vrma',
    'sillyDancing.vrma',
    'twistDance.vrma',
];

/** Adult behaviours, per AnimationPresets' own `adult: true` flag. */
const ADULT_BEHAVIORS = ['flirt', 'tease', 'intimate', 'sensualSway', 'beckon', 'slowBurn'];

function readManifest(file = MANIFEST) {
    return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function runScript(script, args = []) {
    return execFileSync('node', [path.join('kb', 'scripts', script), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

/** Write a copy of the manifest with `mutate` applied, and validate it. */
function validateMutated(mutate) {
    const records = readManifest();
    mutate(records);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')), 'broken.jsonl');
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    try {
        runScript('validate-manifest.mjs', ['--manifest', file]);
        return null; // no error thrown means the gate let it through
    } catch (error) {
        return String(error.stderr || error.stdout || error.message);
    } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
}

describe('manifest coverage', () => {
    let records;

    beforeAll(() => {
        records = readManifest();
    });

    test('the validator passes at the structural level', () => {
        expect(runScript('validate-manifest.mjs')).toContain('every shipped asset has exactly one record');
    });

    test('every shipped asset has exactly one record', () => {
        const shipped = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir)) {
                const abs = path.join(dir, entry);
                if (fs.statSync(abs).isDirectory()) walk(abs);
                else if (/\.(bvh|vrma)$/i.test(entry)) shipped.push(path.relative(ROOT, abs).split(path.sep).join('/'));
            }
        };
        for (const dir of ['vendor/animations', 'addons/vrma-actions', 'addons/vrma-dance']) walk(path.join(ROOT, dir));

        const byFile = records.filter((r) => r.file).map((r) => r.file);
        expect(byFile.slice().sort()).toEqual(shipped.slice().sort());
        expect(new Set(byFile).size).toBe(byFile.length);
    });

    test('every referenced file exists on disk', () => {
        const missing = records.filter((r) => r.file && !fs.existsSync(path.join(ROOT, r.file)));
        expect(missing.map((r) => r.file)).toEqual([]);
    });

    test('ids are unique and stable in shape', () => {
        const ids = records.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    });

    test('the 15 procedural behaviours carry a behaviorRef and never a file', () => {
        const procedural = records.filter((r) => r.kind === 'procedural');
        expect(procedural).toHaveLength(15);
        for (const record of procedural) {
            expect(record.behaviorRef).toBeTruthy();
            expect(record.file).toBeUndefined();
        }
    });

    test('exactly the six adult behaviours are nsfw', () => {
        const nsfw = records.filter((r) => r.nsfw).map((r) => r.behaviorRef);
        expect(nsfw.slice().sort()).toEqual(ADULT_BEHAVIORS.slice().sort());
    });
});

describe('the clips this repo knows are broken', () => {
    let byFile;

    beforeAll(() => {
        byFile = new Map(
            readManifest()
                .filter((r) => r.file)
                .map((r) => [path.basename(r.file), r])
        );
    });

    test('the eight Mixamo dance clips are experimental, never silently in the pool', () => {
        for (const name of EXCLUDED_MIXAMO) {
            const record = byFile.get(name);
            expect(record).toBeDefined();
            expect(record.quality).toBe('experimental');
        }
    });

    test('each one carries the retarget note explaining why', () => {
        for (const name of EXCLUDED_MIXAMO) {
            expect(byFile.get(name).retarget).toMatch(/rest-pose mismatch/);
        }
    });

    test('the converted dance pack is production — it is what the app actually plays', () => {
        // Same category name as the experimental BVH pack, different provenance: these
        // were converted in-repo with bvh2vrma and sit in MotionClipMap's candidate lists.
        expect(byFile.get('dance_1.vrma').quality).toBe('production');
        expect(byFile.get('dance_1.vrma').source).toMatch(/bvh2vrma/);
    });

    test("the BVH dance pack inherits the vendor manifest's own experimental flag", () => {
        expect(byFile.get('dance_1.bvh').quality).toBe('experimental');
        expect(byFile.get('dance_1.bvh').retarget).toMatch(/experimental/);
    });
});

describe('harvest is reproducible', () => {
    test('re-running the harvester reproduces the manifest byte for byte', () => {
        const before = fs.readFileSync(MANIFEST);
        const beforeReport = fs.readFileSync(REPORT);
        runScript('harvest-existing.mjs', ['--write']);
        expect(fs.readFileSync(MANIFEST).equals(before)).toBe(true);
        expect(fs.readFileSync(REPORT).equals(beforeReport)).toBe(true);
    });

    test('the harvest report names the assets nothing could reach before the KB', () => {
        const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
        expect(report.excludedMixamoClips.slice().sort()).toEqual(EXCLUDED_MIXAMO.slice().sort());
        // The point of the KB in one number: most of the shipped library is currently
        // unreachable, because no clip-map entry and no emotion mapping names it.
        expect(report.orphans.ids.length).toBeGreaterThan(50);
        expect(report.danglingCandidates).toEqual([]);
    });
});

describe('the gate rejects a hand-broken record', () => {
    test('an unknown field', () => {
        expect(validateMutated((r) => (r[0].mood = 'sparkly'))).toMatch(/unknown field "mood"/);
    });

    test('a file that does not exist', () => {
        expect(validateMutated((r) => (r[0].file = 'vendor/animations/nope.bvh'))).toMatch(/file does not exist/);
    });

    test('a duplicate id', () => {
        expect(validateMutated((r) => (r[1].id = r[0].id))).toMatch(/duplicate id/);
    });

    test('a missing record — coverage is checked in both directions', () => {
        expect(validateMutated((r) => r.splice(0, 1))).toMatch(/no record for shipped asset/);
    });

    test('an experimental clip with no explanation', () => {
        expect(
            validateMutated((r) => {
                const broken = r.find((x) => x.quality === 'experimental');
                delete broken.retarget;
            })
        ).toMatch(/missing required field "retarget"/);
    });

    test('a value outside its contracted range', () => {
        expect(validateMutated((r) => (r[0].energy = 4))).toMatch(/4 > 1/);
    });

    test('a procedural record that smuggles in a file', () => {
        expect(
            validateMutated((r) => {
                const proc = r.find((x) => x.kind === 'procedural');
                proc.file = 'vendor/animations/idle/neutral.bvh';
            })
        ).toMatch(/must not match/);
    });

    test('and passes the untouched manifest, so the failures above mean something', () => {
        expect(validateMutated(() => {})).toBeNull();
    });
});
