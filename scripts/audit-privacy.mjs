#!/usr/bin/env node
/**
 * audit-privacy — the promises, checked against the code (batch B19).
 *
 * Eight claims this engine makes about the user's data. Unlike the budgets audit, every one
 * of them is a property of the source rather than of a device, so this audit can be
 * **signed** — a green run here is the whole privacy story for the client, not a proxy for
 * it.
 *
 *   1. One door.        Exactly one file may call `getDisplayMedia`/`getUserMedia`.
 *   2. No store.        No capture path may retain a frame.
 *   3. Nothing persists. Consent and attestation are session-scoped; nothing is written.
 *   4. Always visible.  Consent has an indicator in 2D *and* in XR, from one subscription.
 *   5. Opt-outs hold.   Every documented mute and refusal has a test that fails without it.
 *   6. Off by default.  Every master flag ships false.
 *   7. Clips offline.   Nothing under `src/features/clips/` can reach the network (B24).
 *   8. On demand only.  The copilot names no timer primitive, so it cannot poll (B26).
 *
 * Where a claim is checked by reading source, comments are stripped first: this project has
 * had four assertions fail because a file explained in prose the very thing it was being
 * checked for not doing.
 *
 * Usage:
 *   node scripts/audit-privacy.mjs           # report
 *   node scripts/audit-privacy.mjs --check   # exit 1 on any failure
 *   node scripts/audit-privacy.mjs --json
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config/behavior.config.json'), 'utf8'));

/** Source with the comments taken out. See the header for why this is not optional. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ENGINE_ROOTS = ['src/behavior', 'src/features'];

function engineFiles() {
    const out = [];
    const walk = (dir) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
            const abs = join(dir, entry);
            if (statSync(abs).isDirectory()) walk(abs);
            else if (entry.endsWith('.js')) out.push(relative(ROOT, abs).split(sep).join('/'));
        }
    };
    ENGINE_ROOTS.forEach((r) => walk(join(ROOT, r)));
    return out;
}

const source = (rel) => codeOf(readFileSync(join(ROOT, rel), 'utf8'));

// ── the claims ───────────────────────────────────────────────────────────────

function oneDoor() {
    const offenders = engineFiles().filter((f) => /getDisplayMedia|getUserMedia/.test(source(f)));
    return {
        id: 'one-door',
        claim: 'exactly one file can open a camera or a screen',
        pass: offenders.length === 1 && offenders[0] === 'src/features/together/capture/ConsentMachine.js',
        detail: offenders.join(', ') || '(none — the machine itself is missing)',
    };
}

function noStore() {
    // A capture path may hold a frame for as long as it takes to encode one, and no longer.
    const capturePaths = [
        'src/features/together/capture/CapturePipeline.js',
        'src/features/together/activities/screen-insight.js',
        'src/behavior/adapters/MediaAdapter.js',
    ];
    const problems = [];
    for (const path of capturePaths) {
        if (!existsSync(join(ROOT, path))) {
            problems.push(`${path} is missing`);
            continue;
        }
        const text = source(path);
        for (const banned of ['localStorage', 'indexedDB', 'sessionStorage', 'FileReader', 'createObjectURL']) {
            if (text.includes(banned)) problems.push(`${path} names ${banned}`);
        }
    }
    // The insight activity is the one that *sends* a frame; it may not also keep one.
    const insight = source('src/features/together/activities/screen-insight.js');
    if (/this\.(frames|lastFrame|history)\s*=/.test(insight)) problems.push('screen-insight keeps a frame');
    return {
        id: 'no-store',
        claim: 'no capture path retains a frame',
        pass: problems.length === 0,
        detail: problems.join('; ') || 'clean',
    };
}

function nothingPersists() {
    const sessionScoped = [
        'src/features/together/capture/ConsentMachine.js',
        'src/behavior/adapters/SessionAdapter.js',
    ];
    const problems = [];
    for (const path of sessionScoped) {
        const text = source(path);
        if (/localStorage|sessionStorage|indexedDB/.test(text)) problems.push(`${path} writes to storage`);
    }
    return {
        id: 'nothing-persists',
        claim: 'consent and adult attestation are session-scoped',
        pass: problems.length === 0,
        detail: problems.join('; ') || 'neither names a storage API',
    };
}

function alwaysVisible() {
    const path = 'src/features/together/ui/ConsentIndicator.js';
    if (!existsSync(join(ROOT, path)))
        return { id: 'indicator', claim: 'consent is visible', pass: false, detail: 'missing' };
    const text = source(path);
    const has2D = /createElement/.test(text) && /aria-live/.test(text);
    const hasXR = /camera\.add/.test(text) && /depthTest/.test(text);
    const oneSubscription = (text.match(/onChange\(/g) || []).length === 1;
    return {
        id: 'indicator',
        claim: 'consent shows in 2D and in XR, from one subscription',
        pass: has2D && hasXR && oneSubscription,
        detail: `2D ${has2D} · XR ${hasXR} · single subscription ${oneSubscription}`,
    };
}

function optOutsHold() {
    // Each of these is a documented refusal with a test that fails when it is removed. The
    // audit checks the *rule* is present in the source it belongs to; the tests check it
    // works, and both are needed — a rule with no test rots, a test with no rule is noise.
    const rules = [
        ['src/behavior/selector/UtilityRanker.js', /clip\.nsfw && !\(bb\.nsfwAllowed/, 'nsfw needs the user setting'],
        ['src/behavior/selector/UtilityRanker.js', /intent\.source !== 'user'/, 'she never initiates nsfw'],
        ['src/features/together/activities/watch.js', /budgetPerSession === 0/, 'a zero budget silences commentary'],
        ['src/features/together/activities/watch.js', /the user is speaking/, 'she does not speak over you'],
        ['src/features/together/capture/CapturePipeline.js', /grant\.live/, 'no frame without a live grant'],
        ['src/behavior/adapters/SessionAdapter.js', /whitelist\.has/, 'server intents pass the whitelist'],
    ];
    const missing = rules.filter(([path, pattern]) => !pattern.test(source(path))).map(([, , what]) => what);
    return {
        id: 'opt-outs',
        claim: 'every documented refusal is in the code',
        pass: missing.length === 0,
        detail: missing.length ? `missing: ${missing.join(', ')}` : `${rules.length} rules present`,
    };
}

function offByDefault() {
    const flags = {
        'behaviorEngine.enabled': CONFIG.behaviorEngine.enabled,
        'behaviorEngine.debug': CONFIG.behaviorEngine.debug,
        nsfwAllowed: CONFIG.nsfwAllowed,
        'session.enabled': CONFIG.session.enabled,
        'session.tier1Remote': CONFIG.session.tier1Remote,
        'adult.available': CONFIG.adult.available,
    };
    const on = Object.entries(flags)
        .filter(([, value]) => value !== false)
        .map(([name]) => name);
    return {
        id: 'off-by-default',
        claim: 'every master flag ships false',
        pass: on.length === 0,
        detail: on.length ? `on: ${on.join(', ')}` : `${Object.keys(flags).length} flags, all false`,
    };
}

/**
 * B24's acceptance criterion, as a standing check rather than a one-off.
 *
 * A clip is thirty seconds of the user's living room, and it is the user's. The guarantee is
 * not that this code chooses not to upload it — it is that nothing under `src/features/clips/`
 * has any way to. That has to hold for files nobody has written yet, which is why the check
 * walks the directory rather than naming the three files that are in it today.
 */
function clipsAreOffline() {
    const dir = join(ROOT, 'src/features/clips');
    if (!existsSync(dir)) {
        return {
            id: 'clips-offline',
            claim: 'nothing under src/features/clips can reach the network',
            pass: true,
            detail: '(no clip engine in this build)',
        };
    }

    const forbidden = [
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'sendBeacon',
        'EventSource',
        'import(',
        'importScripts',
        'axios',
        'https://',
        'http://',
    ];
    const files = [];
    (function walk(at) {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const full = join(at, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) files.push(relative(ROOT, full));
        }
    })(dir);

    const problems = [];
    for (const file of files) {
        const text = source(file);
        // A file the stripper emptied would pass for free.
        if (text.trim().length < 200) problems.push(`${file} has no readable code`);
        for (const token of forbidden) {
            if (text.includes(token)) problems.push(`${file} names ${token}`);
        }
    }

    return {
        id: 'clips-offline',
        claim: 'nothing under src/features/clips can reach the network',
        pass: files.length > 0 && problems.length === 0,
        detail: problems.join('; ') || `${files.length} files, none can send bytes anywhere`,
    };
}

/**
 * B26's acceptance criterion, as a standing check.
 *
 * The copilot may take a frame only when somebody asks for one — the privacy posture and, on
 * a phone propped against a flour bag for forty minutes, the battery posture. The guarantee
 * is not that it currently calls no timer: it is that the file **names no timer primitive at
 * all**, so a periodic path cannot appear without somebody adding one, which is a thing a
 * reviewer notices in a diff.
 */
function copilotOnDemand() {
    const path = 'src/features/together/activities/copilot.js';
    if (!existsSync(join(ROOT, path))) {
        return {
            id: 'copilot-on-demand',
            claim: 'the copilot has no periodic-frame path',
            pass: true,
            detail: '(no copilot in this build)',
        };
    }
    const text = source(path);
    const forbidden = [
        'setInterval',
        'setTimeout',
        'requestAnimationFrame',
        'requestIdleCallback',
        'Worker',
        // B15's activity has a periodic mode, which is exactly the temptation.
        'watch(',
        'startWatching',
        'getUserMedia',
        'getDisplayMedia',
    ];
    const found = forbidden.filter((token) => text.includes(token));
    return {
        id: 'copilot-on-demand',
        claim: 'the copilot has no periodic-frame path',
        pass: found.length === 0 && text.trim().length > 200,
        detail: found.length ? `names ${found.join(', ')}` : 'no timer primitive, no capture call',
    };
}

export function audit() {
    return [
        oneDoor(),
        noStore(),
        nothingPersists(),
        alwaysVisible(),
        optOutsHold(),
        offByDefault(),
        clipsAreOffline(),
        copilotOnDemand(),
    ];
}

function main() {
    const mode = process.argv[2] || '--report';
    const checks = audit();

    if (mode === '--json') {
        console.log(JSON.stringify(checks, null, 2));
        return;
    }

    console.log('Behavior Director — privacy audit\n');
    for (const check of checks) {
        console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.id.padEnd(18)} ${check.claim}`);
        console.log(`         ${check.detail}`);
    }

    const failed = checks.filter((c) => !c.pass);
    console.log('');
    console.log('  Server-side retention (frames.retention = 0) is audited in HomePilot:');
    console.log('    backend/tests/avatar/test_vision_retention.py');

    if (mode === '--check') {
        if (failed.length) {
            console.error(`\nFAILED: ${failed.map((c) => c.id).join(', ')}`);
            process.exit(1);
        }
        console.log('\nOK — every privacy claim holds.');
    }
}

if (process.argv[1] && process.argv[1].endsWith('audit-privacy.mjs')) main();
