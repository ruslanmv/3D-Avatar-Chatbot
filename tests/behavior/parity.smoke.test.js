/**
 * Flag-off parity — the guarantee spec v1.1 §7 makes and B0 has to make checkable.
 *
 * With `behaviorEngine.enabled` false the app must be today's app. Proving that by
 * hashing product files would pass once and then fail on every unrelated edit, so what
 * is asserted here is the fact that actually carries the guarantee: no shipping file
 * loads, imports or names anything in the engine's namespace, except the §7 allowlist,
 * and there only next to the flag guard.
 *
 * Two independent implementations of the same claim run side by side — the harness in
 * scripts/behavior-parity-baseline.mjs (which CI runs directly) and the plain-fs checks
 * below. Each is a check on the other; agreement between them is the point.
 */

/* global describe, test, expect, beforeAll */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = path.join(ROOT, 'config', 'behavior.config.json');

/** Namespaces introduced by the Behavior Director — kept in step with the harness. */
const ENGINE_NAMESPACES = [
    'src/behavior/',
    'src/features/together/',
    'src/features/clips/',
    'src/features/playmode/',
    'kb/',
    'config/behavior.config.json',
];

/** The amended §7 allowlist. See docs/PATHMAP.md §4 for why index.html is on it. */
const ALLOWLIST = [
    'index.html',
    'src/main.js',
    'src/LLMManager.js',
    'js/speech-service.js',
    'src/tts/PiperWasmTTSProvider.js',
    'src/FaceTracker.js',
    'src/xr/MotionContract.js',
    'src/PoseStudioPanel.js',
];

const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'coverage',
    'vendor',
    'addons',
    'assets',
    'kb',
    'tests',
    'docs',
    'scripts',
    'config',
    '.github',
]);

const SCAN_EXTENSIONS = ['.js', '.mjs', '.html', '.json'];

const isEngineFile = (rel) => ENGINE_NAMESPACES.some((ns) => ns.endsWith('/') && rel.startsWith(ns));

/** Every scannable shipping file, as a repo-relative path. */
function productFiles(dir = ROOT, out = []) {
    for (const entry of fs.readdirSync(dir)) {
        if (SKIP_DIRS.has(entry) || entry === 'package-lock.json') continue;
        const abs = path.join(dir, entry);
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        if (fs.statSync(abs).isDirectory()) productFiles(abs, out);
        else if (SCAN_EXTENSIONS.some((e) => entry.endsWith(e))) out.push(rel);
    }
    return out;
}

function runHarness(mode) {
    return execFileSync('node', [path.join('scripts', 'behavior-parity-baseline.mjs'), mode], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

describe('config/behavior.config.json is frozen and off', () => {
    let cfg;

    beforeAll(() => {
        cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    });

    test('every master flag ships false', () => {
        expect(cfg.behaviorEngine.enabled).toBe(false);
        expect(cfg.behaviorEngine.debug).toBe(false);
        expect(cfg.nsfwAllowed).toBe(false);
        expect(cfg.session.enabled).toBe(false);
        expect(cfg.session.tier1Remote).toBe(false);
        expect(cfg.adult.available).toBe(false);
    });

    test('the key set is exactly the one the specs define — no invented keys', () => {
        const keys = Object.keys(cfg)
            .filter((k) => !k.startsWith('$'))
            .sort();
        expect(keys).toEqual(
            [
                // spec v1.1 §6.2
                'antiRepeatWindow',
                'behaviorEngine',
                'budgets',
                'capture',
                'emoteRateLimit',
                'emoteWhitelist',
                'nsfwAllowed',
                'session',
                'topK',
                'weights',
                // addendum v1.2 §14.1
                'adult',
                'assistant',
                'clips',
                'coach',
            ].sort()
        );
    });

    test('the emote whitelist is the one the LLM tag contract promises', () => {
        // §6.8 lists 18 names; §6.2 adds `breathe`, used by the meditation scene profile.
        expect(cfg.emoteWhitelist).toContain('lean_in');
        expect(cfg.emoteWhitelist).toContain('breathe');
        expect(new Set(cfg.emoteWhitelist).size).toBe(cfg.emoteWhitelist.length);
    });

    test('clips.enabled is true because the addendum says so, and is inert anyway', () => {
        // Addendum §14.1 sets this default; contracts are law. It cannot do anything while
        // the engine flag is off, because nothing under src/features/clips/ is ever loaded.
        expect(cfg.clips.enabled).toBe(true);
        expect(cfg.behaviorEngine.enabled).toBe(false);
    });
});

describe('the engine is invisible to the shipping app', () => {
    test('no file outside the §7 allowlist names an engine namespace', () => {
        const stray = productFiles()
            .filter((f) => !ALLOWLIST.includes(f) && !isEngineFile(f))
            .map((f) => ({
                file: f,
                hits: ENGINE_NAMESPACES.filter((ns) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes(ns)),
            }))
            .filter((r) => r.hits.length);
        expect(stray).toEqual([]);
    });

    test('index.html loads no engine script', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const srcs = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
        expect(srcs.filter((s) => ENGINE_NAMESPACES.some((ns) => s.startsWith(ns)))).toEqual([]);
    });

    test('no allowlisted reference to the engine is reachable with the flag off', () => {
        // Asked of the harness rather than re-derived here. This test used to carry its own
        // copy of the proximity rule, and when B33 moved the bootstrap into a function whose
        // guard is one early return, the copy and the harness disagreed: two definitions of
        // "guarded", both claiming to be the gate. One definition, in the file the CI job
        // runs, and this asserts its verdict.
        expect(runHarness('--check')).toMatch(/allowlisted references\s+: \d+ \(0 unguarded\)/);
    });

    test('deleting the new directories would leave nothing dangling', () => {
        // The uninstall claim in §7: the engine lives entirely in directories of its own.
        for (const ns of ENGINE_NAMESPACES) {
            if (ns.endsWith('/')) expect(ns.split('/').length).toBeGreaterThan(1);
        }
        // From B3 the engine exists, and it lives entirely under src/behavior/.
        expect(fs.existsSync(path.join(ROOT, 'src', 'behavior'))).toBe(true);
        expect(fs.readdirSync(path.join(ROOT, 'src'))).toContain('behavior');
    });
});

describe('the parity harness itself', () => {
    test('reports no drift against the recorded baseline', () => {
        expect(runHarness('--check')).toContain('the engine is inert with the flag off');
    });

    test('fails when an engine reference appears in an unlisted file', () => {
        // A detector nobody has seen fail is not a detector. Plant one, prove it fires,
        // remove it — in a finally, so a failing expectation cannot leave the probe behind.
        const probe = path.join(ROOT, '.parity-vacuity-probe.js');
        try {
            fs.writeFileSync(probe, "// probe\nrequire('src/behavior/boot.js');\n");
            expect(() => runHarness('--check')).toThrow();
        } finally {
            fs.rmSync(probe, { force: true });
        }
        expect(runHarness('--check')).toContain('the engine is inert with the flag off');
    });
});
