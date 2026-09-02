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

/**
 * Globals through which a file can reach the engine without naming a path. Added in B3:
 * `main.js` calls `NEXUS_BD_BOOT()` and `NEXUS_BD.update()`, and a reference that the
 * harness cannot see is a reference nobody checks for a guard. B9 adds `NEXUS_BD_SAY`,
 * which needs its own pattern: the underscore means `\bNEXUS_BD\b` does not match it.
 * `NEXUS_BD_ENABLED` is the guard itself, not a reach, so it is not on this list.
 */
export const ENGINE_GLOBALS = [/\bNEXUS_BD_BOOT\b/, /\bNEXUS_BD_SAY\b/, /\bNEXUS_BD\b(?!_)/];

/** Does this line reach into the engine, by path or by global? */
function reachesEngine(line) {
    return ENGINE_NAMESPACES.some((ns) => line.includes(ns)) || ENGINE_GLOBALS.some((re) => re.test(line));
}

/** Is this file part of the engine itself? Then it is not a stray reference to it. */
function isEngineFile(rel) {
    return ENGINE_NAMESPACES.some((ns) => ns.endsWith('/') && rel.startsWith(ns));
}

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
        // The engine's own files name the engine constantly; that is not a stray.
        if (ALLOWLIST.includes(file) || isEngineFile(file)) continue;
        const text = readFileSync(join(ROOT, file), 'utf8');
        const hits = ENGINE_NAMESPACES.filter((ns) => text.includes(ns));
        if (hits.length) stray.push({ file, namespaces: hits });
    }
    return stray;
}

/**
 * Functions that refuse on the flag before they touch the engine, so every line inside one
 * is unreachable with the engine off.
 *
 * Until B33 every hook was a line or two beside its own `if (window.NEXUS_BD_ENABLED)`, and
 * proximity was a fair proxy for reachability. B33 had to move the bootstrap out of
 * `setupThreeJS()` — which only the legacy engine path calls, so the director had never
 * started in a shipped build — into a function both paths call. The guard became one early
 * return at the top: the same property, stated once instead of at every line. Proximity
 * cannot see that, so name the regions and check the guard is really in them.
 *
 * Deliberately a fixed list rather than inference. A new guarded function is a new seam and
 * belongs in a review, which is the same reason the reference count is recorded at all.
 */
const GUARDED_REGIONS = {
    'src/main.js': [
        // Refuses on the flag itself, before it appends the boot script.
        { name: 'startBehaviorDirector', guard: /if \(!window\.NEXUS_BD_ENABLED\) return false;/ },
        // Reached only from inside that refusal — asserted below, not assumed.
        { name: 'tickBehaviorDirector', calledOnlyFrom: 'startBehaviorDirector' },
    ],
};

/**
 * Line span of a top-level `function name(` declaration: from its line to the line before
 * the next top-level declaration. Column-anchored rather than brace-matched — a brace count
 * that miscounts one string or regex literal would silently widen a region and hide exactly
 * the unguarded reference this file exists to catch.
 */
function regionOf(lines, name) {
    const declares = (line) => /^(?:async\s+)?function\s/.test(line);
    const start = lines.findIndex((line) => new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`).test(line));
    if (start === -1) return null;
    let end = lines.length - 1;
    for (let i = start + 1; i < lines.length; i++) {
        if (declares(lines[i])) {
            end = i - 1;
            break;
        }
    }
    return { start, end };
}

/** The guarded regions of one file, as `{first, last}` line numbers, or [] if it has none. */
function guardedSpans(file, lines) {
    const spans = [];
    for (const region of GUARDED_REGIONS[file] || []) {
        const at = regionOf(lines, region.name);
        if (!at) continue; // renamed or removed: its references fall back to unguarded
        const body = lines.slice(at.start, at.end + 1).join('\n');
        if (region.guard && !region.guard.test(body)) continue; // the guard is gone — say so
        if (region.calledOnlyFrom) {
            const caller = regionOf(lines, region.calledOnlyFrom);
            const calls = lines
                .map((line, i) => ({ line, i }))
                .filter(({ line, i }) => i !== at.start && new RegExp(`\\b${region.name}\\(`).test(line));
            const outside = calls.filter(({ i }) => !caller || i < caller.start || i > caller.end);
            if (outside.length) continue; // called from somewhere the flag does not cover
        }
        spans.push(at);
    }
    return spans;
}

/**
 * Indices of lines that are entirely comment.
 *
 * Tracked across lines rather than matched per line: the continuation lines of a block
 * comment start with prose, not with a delimiter, and one of them names the engine. A
 * per-line regex reads that as executable code and fails the gate on a sentence.
 */
function commentLines(lines) {
    const out = new Set();
    let inBlock = false;
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (inBlock) {
            out.add(i);
            if (trimmed.includes('*/')) inBlock = false;
            return;
        }
        if (trimmed.startsWith('//')) return void out.add(i);
        if (trimmed.startsWith('/*')) {
            out.add(i);
            if (!trimmed.includes('*/')) inBlock = true;
        }
    });
    return out;
}

/**
 * Allowlisted files that reference the engine, with whether each reference is guarded —
 * either beside an inline flag check, or inside a region the flag makes unreachable. A hook
 * that forgets its guard is the failure this catches.
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
        const spans = guardedSpans(file, lines);
        const comments = commentLines(lines);
        lines.forEach((line, i) => {
            if (!reachesEngine(line)) return;
            // Six lines back: the guard often opens a block a few lines above the call.
            const window = lines.slice(Math.max(0, i - 6), i + 4).join('\n');
            const inline = /behaviorEngine|NEXUS_BD_ENABLED/.test(window);
            const inRegion = spans.some((s) => i >= s.start && i <= s.end);
            // A comment that names the engine is still recorded — moving one is drift a
            // reviewer should see — but it executes nothing, so it cannot be the unguarded
            // reference this gate fails on. Only the code has to be behind the flag.
            const comment = comments.has(i);
            refs.push({ file, line: i + 1, guarded: inline || inRegion, comment });
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
    const unguarded = current.allowlistReferences.filter((r) => !r.guarded && !r.comment);

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
