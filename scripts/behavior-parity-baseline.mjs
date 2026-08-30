#!/usr/bin/env node
/**
 * behavior-parity-baseline — proves, by script rather than by eyeball, that the
 * Behavior Director is inert while `behaviorEngine.enabled` is false.
 *
 * The claim B0 has to make good on is spec v1.1 §7: with the flag off the app is
 * byte-for-byte today's app. Hashing whole product files would prove that once and
 * then fail on every unrelated edit, so this harness asserts the narrower fact that
 * actually carries the claim:
 *
 *   nothing from the engine's namespace is loaded, imported or referenced by the
 *   shipping app, except from files on the §7 allowlist, and there only inside a
 *   flag guard.
 *
 * That statement stays true and stays checkable through B3 and beyond: when the
 * bootstrap hook lands, the boot script tag and the guarded call become the only
 * entries in the baseline, and any further reference has to be added deliberately.
 *
 * Usage:
 *   node scripts/behavior-parity-baseline.mjs            # report
 *   node scripts/behavior-parity-baseline.mjs --check    # exit 1 on drift (CI)
 *   node scripts/behavior-parity-baseline.mjs --write    # re-record the baseline
 *
 * Re-recording is a deliberate act: the diff is the review surface for every new
 * §7 touch, which is exactly where a reviewer should be looking.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = 'tests/behavior/baseline/boot-baseline.json';

/** Namespaces introduced by the Behavior Director. Nothing outside the allowlist may name them. */
export const ENGINE_NAMESPACES = [
    'src/behavior/',
    'src/features/together/',
    'src/features/clips/',
    'src/features/playmode/',
    'kb/',
    'config/behavior.config.json',
];

/**
 * The amended spec §7 allowlist: the only pre-existing files any batch may touch.
 * `index.html` and the settings panel are additions to the spec's list — this repo is a
 * script-tag app, so the bootstrap seam the spec assigns to `src/main.js` is two seams
 * here. See docs/PATHMAP.md §4.
 */
export const ALLOWLIST = [
    'index.html',
    'src/main.js',
    'src/LLMManager.js',
    'js/speech-service.js',
    'src/tts/PiperWasmTTSProvider.js',
    'src/FaceTracker.js',
    'src/xr/MotionContract.js',
    'src/PoseStudioPanel.js',
];

/** Directories that are ours (or not ours to police) and so are not scanned. */
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

/** Files that are documentation of the plan rather than shipping app code. */
const SKIP_FILES = new Set(['package-lock.json']);

/** Walk the repo, yielding every scannable product file as a repo-relative path. */
function productFiles(dir = ROOT, out = []) {
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const rel = relative(ROOT, abs).split(sep).join('/');
        if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
        if (statSync(abs).isDirectory()) {
            productFiles(abs, out);
        } else if (SCAN_EXTENSIONS.some((e) => entry.endsWith(e))) {
            out.push(rel);
        }
    }
    return out;
}

/** Every `<script src="...">` in index.html, in load order. */
function bootScripts() {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    return [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
}

/** Boot scripts that belong to the engine — the ones the flag has to keep inert. */
function engineBootScripts() {
    return bootScripts().filter((src) => ENGINE_NAMESPACES.some((ns) => src.startsWith(ns)));
}

/**
 * Product files outside the allowlist that name an engine namespace. Must always be empty:
 * a reference from an unlisted file is a §7 violation, and it is also the thing that would
 * make "delete the new directories for a clean uninstall" untrue.
 */
function strayReferences() {
    const stray = [];
    for (const file of productFiles()) {
        if (ALLOWLIST.includes(file)) continue;
        const text = readFileSync(join(ROOT, file), 'utf8');
        const hits = ENGINE_NAMESPACES.filter((ns) => text.includes(ns));
        if (hits.length) stray.push({ file, namespaces: hits });
    }
    return stray;
}

/**
 * Allowlisted files that reference the engine, with whether each reference sits near the
 * `behaviorEngine` flag guard. A hook that forgets its guard is the failure this catches.
 */
function allowlistReferences() {
    const refs = [];
    for (const file of ALLOWLIST) {
        let text;
        try {
            text = readFileSync(join(ROOT, file), 'utf8');
        } catch {
            continue; // an allowlisted file need not exist yet (PiperWasmTTSProvider paths vary)
        }
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            if (!ENGINE_NAMESPACES.some((ns) => line.includes(ns))) return;
            const window = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
            refs.push({
                file,
                line: i + 1,
                guarded: /behaviorEngine|NEXUS_BD_ENABLED/.test(window),
            });
        });
    }
    return refs;
}

/** The frozen key set of config/behavior.config.json (spec v1.1 §6.2 + addendum v1.2 §14.1). */
function configReport() {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config/behavior.config.json'), 'utf8'));
    return {
        keys: Object.keys(cfg)
            .filter((k) => !k.startsWith('$'))
            .sort(),
        masterFlagsOff: {
            'behaviorEngine.enabled': cfg.behaviorEngine.enabled === false,
            'behaviorEngine.debug': cfg.behaviorEngine.debug === false,
            nsfwAllowed: cfg.nsfwAllowed === false,
            'session.enabled': cfg.session.enabled === false,
            'session.tier1Remote': cfg.session.tier1Remote === false,
            'adult.available': cfg.adult.available === false,
        },
    };
}

/** Collect the whole picture. */
export function collect() {
    const config = configReport();
    return {
        $comment:
            'Recorded by scripts/behavior-parity-baseline.mjs. Re-record deliberately with --write; ' +
            'the diff is the review surface for every new §7 touch.',
        engineBootScripts: engineBootScripts(),
        strayReferences: strayReferences(),
        allowlistReferences: allowlistReferences(),
        configKeys: config.keys,
        masterFlagsOff: config.masterFlagsOff,
        informational: { totalBootScripts: bootScripts().length },
    };
}

/** Compare against the recorded baseline, ignoring the informational block. */
export function diff(current, baseline) {
    const problems = [];
    const cmp = (key) => {
        const a = JSON.stringify(current[key]);
        const b = JSON.stringify(baseline[key]);
        if (a !== b) problems.push(`${key} drifted\n  baseline: ${b}\n  current:  ${a}`);
    };
    ['engineBootScripts', 'strayReferences', 'allowlistReferences', 'configKeys', 'masterFlagsOff'].forEach(cmp);
    return problems;
}

function main() {
    const mode = process.argv[2] || '--report';
    const current = collect();

    if (mode === '--write') {
        writeFileSync(join(ROOT, BASELINE), JSON.stringify(current, null, 2) + '\n');
        console.log(`baseline re-recorded → ${BASELINE}`);
        return;
    }

    const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
    const problems = diff(current, baseline);
    const unguarded = current.allowlistReferences.filter((r) => !r.guarded);

    console.log('Behavior Director — flag-off parity');
    console.log(`  engine scripts in index.html : ${current.engineBootScripts.length}`);
    console.log(`  stray references             : ${current.strayReferences.length}`);
    console.log(
        `  allowlisted references       : ${current.allowlistReferences.length} (${unguarded.length} unguarded)`
    );
    console.log(`  master flags off             : ${Object.values(current.masterFlagsOff).every(Boolean)}`);
    console.log(`  boot scripts (informational) : ${current.informational.totalBootScripts}`);

    if (mode === '--check') {
        for (const p of problems) console.error(`\ndrift: ${p}`);
        for (const r of unguarded) console.error(`\nunguarded engine reference: ${r.file}:${r.line}`);
        if (problems.length || unguarded.length) {
            console.error('\nIf the change was deliberate, re-record with --write and explain it in the PR.');
            process.exit(1);
        }
        console.log('\nOK — the engine is inert with the flag off.');
    }
}

if (process.argv[1] && process.argv[1].endsWith('behavior-parity-baseline.mjs')) main();
