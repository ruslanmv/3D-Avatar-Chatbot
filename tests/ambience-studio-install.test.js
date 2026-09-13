/**
 * Installing a published Studio package into this app (batch A19).
 *
 * The last step of a production batch used to be a person copying two files and hand-editing a
 * JSON array. Every failure mode of that step is silent in the runtime: a wrong path falls back to
 * a colour, a forgotten portrait variant looks fine until somebody picks up a phone, a duplicate
 * id means one of two scenes can never be selected.
 *
 * So the assertions here are mostly about what the installer *refuses*.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const TOOL = path.join(root, 'tools/ambience/install-studio-package.mjs');

/**
 * Run the installer for real, in dry-run.
 *
 * The tool is an ES module and this suite is CommonJS, so it cannot be `require`d — the same
 * constraint `tests/ambience-camera-contract.test.js` works around the same way. Driving the real
 * binary is the better test anyway: it exercises argument parsing and the exit code, which is what
 * a batch script will actually depend on.
 */
function install(dir, extra = []) {
    try {
        const stdout = execFileSync('node', [TOOL, dir, '--dry-run', ...extra], {
            cwd: root,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, stdout, stderr: '' };
    } catch (error) {
        return { code: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
    }
}

/** A real WebP of an exact size, encoded by the browserless path Jest has: none. */
function webp(width, height) {
    // A lossless VP8L header is enough — the installer reads dimensions from the bitstream, so a
    // synthetic header exercises the same code path a real file does without a codec.
    const body = Buffer.alloc(16);
    body.write('VP8L', 0, 'ascii');
    body.writeUInt32LE(10, 4);
    body[8] = 0x2f;
    const bits = (width - 1) | ((height - 1) << 14);
    body.writeUInt32LE(bits, 9);
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(body.length + 4, 4);
    riff.write('WEBP', 8, 'ascii');
    return Buffer.concat([riff, body, Buffer.alloc(16)]);
}

function makePackage(dir, options = {}) {
    const desktop = options.desktop === null ? null : options.desktop || [1920, 1080];
    const mobile = options.mobile === null ? null : options.mobile || [1080, 1920];
    fs.mkdirSync(path.join(dir, 'desktop'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'mobile'), { recursive: true });
    const variants = {};
    if (desktop) {
        fs.writeFileSync(path.join(dir, 'desktop/background.webp'), webp(desktop[0], desktop[1]));
        variants.desktop = { type: 'plate', background: 'desktop/background.webp' };
    }
    if (mobile) {
        fs.writeFileSync(path.join(dir, 'mobile/background.webp'), webp(mobile[0], mobile[1]));
        variants.mobile = { type: 'plate', background: 'mobile/background.webp' };
    }
    fs.writeFileSync(
        path.join(dir, 'environment.json'),
        JSON.stringify({
            id: options.id || 'coastal-terrace-twilight',
            version: '1.0.0',
            name: options.name || 'Coastal Terrace — Twilight',
            category: 'chill',
            tags: ['water', 'coast'],
            variants,
        })
    );
    return dir;
}

let tmp;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-'));
});
afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('what it refuses', () => {
    test('a package with only a desktop plate', () => {
        // The failure this route exists to remove, arriving through the tool built to prevent it:
        // one plate installed as a whole scene means a phone gets a cropped landscape picture.
        const result = install(makePackage(tmp, { mobile: null }));
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/no "mobile" plate/);
    });

    test('a package with only a portrait plate', () => {
        const result = install(makePackage(tmp, { desktop: null }));
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/no "desktop" plate/);
    });

    test('a plate that is not the master size for its profile', () => {
        // A plate is composed for one projection. One that is not that shape was composed for
        // something else, whatever its manifest says.
        const result = install(makePackage(tmp, { desktop: [1600, 900] }));
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/1600x900 is not the landscape master 1920x1080/);
    });

    test('a portrait plate at the landscape size', () => {
        const result = install(makePackage(tmp, { mobile: [1920, 1080] }));
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/is not the portrait master 1080x1920/);
    });

    test('a package whose file is named in the manifest but absent', () => {
        const dir = makePackage(tmp);
        fs.unlinkSync(path.join(dir, 'mobile/background.webp'));
        const result = install(dir);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/is missing from the package/);
    });

    test('a directory that is not a package at all', () => {
        const result = install(tmp);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/no environment.json/);
    });
});

describe('what it accepts', () => {
    test('both plates at their master sizes', () => {
        const result = install(makePackage(tmp));
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/desktop\s+1920x1080/);
        expect(result.stdout).toMatch(/mobile\s+1080x1920/);
    });

    test('a dry run writes nothing', () => {
        const before = fs.readFileSync(path.join(root, 'assets/ambient/backgrounds.json'), 'utf-8');
        install(makePackage(tmp));
        expect(fs.readFileSync(path.join(root, 'assets/ambient/backgrounds.json'), 'utf-8')).toBe(before);
    });
});

describe('the catalogue id it suggests', () => {
    const pattern = /ambient:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*/;

    test('the last word becomes the variant, and the id matches what ingest accepts', () => {
        // `ID_PATTERN` in ViewportBackgroundCatalog refuses anything else, so an id this tool
        // invents that does not match would be rejected at load with the scene simply absent.
        const result = install(makePackage(tmp, { id: 'meditation-garden-night' }));
        expect(result.stdout).toMatch(/→ ambient:meditation-garden:night/);
        expect(result.stdout.match(pattern)).not.toBeNull();
    });

    test('an explicit id overrides the suggestion', () => {
        const result = install(makePackage(tmp), ['--id', 'ambient:terrace:dusk']);
        expect(result.stdout).toMatch(/→ ambient:terrace:dusk/);
    });
});
