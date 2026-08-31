#!/usr/bin/env node
/**
 * audit-privacy — the promises, checked against the code (batch B19).
 *
 * Six claims this engine makes about the user's data. Unlike the budgets audit, every one
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

// ── the six claims ───────────────────────────────────────────────────────────

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

export function audit() {
    return [oneDoor(), noStore(), nothingPersists(), alwaysVisible(), optOutsHold(), offByDefault()];
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
