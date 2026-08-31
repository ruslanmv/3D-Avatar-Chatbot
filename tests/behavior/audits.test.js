/**
 * The QA instrumentation and the two automated audits (B19).
 *
 * B19's acceptance is three green audits. Two are scripts and are checked here by running
 * them; the third is `docs/QA_CHECKLIST.md`, which is a person on a headset and which no
 * test can stand in for — so what is asserted about it is that it exists, covers what it
 * claims to, and is not silently signed.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PickLog = require('../../src/behavior/debug/PickLog.js');
const DebugHUD = require('../../src/behavior/debug/DebugHUD.js');

const ROOT = path.join(__dirname, '..', '..');
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function run(script, mode) {
    return execFileSync('node', [path.join('scripts', script), mode], { cwd: ROOT, encoding: 'utf8' });
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── the pick log ─────────────────────────────────────────────────────────────

describe('the pick log', () => {
    const intent = { name: 'happy', source: 'llm', similarity: 0.61 };
    const picked = {
        clip: { id: 'bvh_happy_1' },
        score: 0.72,
        breakdown: [
            { clip: { id: 'bvh_happy_1' }, score: 0.72 },
            { clip: { id: 'vrma_smile' }, score: 0.68 },
        ],
    };

    test('off by default, and free while off', () => {
        const log = PickLog.attach();
        expect(log.record(intent, picked, {})).toBe(null);
        expect(log.stats).toMatchObject({ enabled: false, held: 0, seen: 0 });
    });

    test('on, it records the choice and the runners-up', () => {
        const log = PickLog.attach({ enabled: true, now: () => 1000 });
        const entry = log.record(intent, picked, { valence: 0.4, energy: 0.5, mode: 'companion' });

        expect(entry).toMatchObject({ intent: 'happy', source: 'llm', chose: 'bvh_happy_1', score: 0.72 });
        expect(entry.candidates).toEqual([
            { id: 'bvh_happy_1', score: 0.72 },
            { id: 'vrma_smile', score: 0.68 },
        ]);
        expect(entry.mood).toEqual({ valence: 0.4, energy: 0.5 });
    });

    test('a refusal is recorded too — it is the hardest thing to debug', () => {
        const log = PickLog.attach({ enabled: true });
        const entry = log.record(intent, null, {});
        expect(entry.chose).toBe(null);
        expect(entry.intent).toBe('happy');
    });

    test('it is a ring buffer, and a small one', () => {
        const log = PickLog.attach({ enabled: true, capacity: 4 });
        for (let i = 0; i < 20; i++) log.record({ name: `i${i}` }, picked, {});

        expect(log.stats).toMatchObject({ held: 4, seen: 20, dropped: 16 });
        expect(log.recent(4).map((e) => e.intent)).toEqual(['i19', 'i18', 'i17', 'i16']);
    });

    test('recent is newest first, which is how a person reads a log', () => {
        const log = PickLog.attach({ enabled: true });
        log.record({ name: 'first' }, picked, {});
        log.record({ name: 'second' }, picked, {});
        expect(log.recent(2).map((e) => e.intent)).toEqual(['second', 'first']);
    });

    test('it produces a line a person can paste into a bug report', () => {
        const log = PickLog.attach({ enabled: true });
        log.record(intent, picked, {});
        expect(log.toText(1)).toBe('happy → bvh_happy_1 (0.72) over vrma_smile 0.68');
    });

    test('it records and never decides', () => {
        // A debug facility that could change behaviour makes every observation suspect.
        const body = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/debug/PickLog.js'), 'utf8'));
        for (const forbidden of ['scheduler', 'mixer', 'emit(', 'request(', 'bus']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });
});

// ── the HUD ──────────────────────────────────────────────────────────────────

describe('the debug HUD', () => {
    const director = {
        pickLog: PickLog.attach({ enabled: true }),
        stats: () => ({
            registry: { bvh: 107, vrma: 44, procedural: 15 },
            tier1: { ready: true, vocabulary: 3638 },
            layers: [
                { name: 'procedural', weight: 1 },
                { name: 'clipA', weight: 0.35 },
                { name: 'head', weight: 1 },
            ],
            blackboard: {
                valence: 0.4,
                energy: 0.55,
                mode: 'together',
                scene: 'ocean',
                attention: 0.8,
                flags: { sessionUp: true, userIdle: false },
            },
            session: { connected: true, voiceState: 'listening' },
            consent: { state: 'active' },
        }),
    };

    test('it is not requested without the URL parameter or the config flag', () => {
        expect(DebugHUD.requested({}, { search: '' })).toBe(false);
        expect(DebugHUD.requested({ behaviorEngine: { debug: false } }, { search: '?x=1' })).toBe(false);
    });

    test('and is requested by either', () => {
        expect(DebugHUD.requested({}, { search: '?behaviorDebug=1' })).toBe(true);
        expect(DebugHUD.requested({ behaviorEngine: { debug: true } }, { search: '' })).toBe(true);
    });

    test('it shows what the three questions need answering', () => {
        const hud = DebugHUD.attach({ director, doc: null });
        director.pickLog.record(
            { name: 'happy', source: 'llm' },
            { clip: { id: 'bvh_happy_1' }, score: 0.72, breakdown: [] },
            {}
        );
        const text = hud.render();

        expect(text).toContain('BEHAVIOR DIRECTOR');
        expect(text).toContain('107 bvh');
        expect(text).toContain('clipA'); // what is playing
        expect(text).toContain('bvh_happy_1'); // why that clip
        expect(text).toContain('up (listening)'); // is the session even up
        expect(text).toContain('together · ocean');
    });

    test('layer weights render as a bar, so a crossfade is visible', () => {
        const hud = DebugHUD.attach({ director, doc: null });
        const text = hud.render();
        expect(text).toMatch(/procedural\s+\[█{8}\]/);
        expect(text).toMatch(/clipA\s+\[█{3}·{5}\]/);
    });

    test('with no picks yet it says so rather than showing nothing', () => {
        const hud = DebugHUD.attach({
            director: { ...director, pickLog: PickLog.attach({ enabled: true }) },
            doc: null,
        });
        expect(hud.render()).toContain('(none yet)');
    });

    test('a director whose stats throw does not take the frame with it', () => {
        const hud = DebugHUD.attach({
            director: {
                stats() {
                    throw new Error('boom');
                },
            },
            doc: null,
        });
        expect(hud.render()).toContain('stats threw: boom');
    });

    test('no director at all is a message, not a crash', () => {
        expect(DebugHUD.attach({ director: null, doc: null }).render()).toContain('not running');
    });

    test('it reads and never writes', () => {
        const body = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/debug/DebugHUD.js'), 'utf8'));
        for (const forbidden of ['scheduler', 'emit(', 'request(', 'handleIntent', 'setMood']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('mounting and detaching leaves no node behind', () => {
        const appended = [];
        const doc = {
            body: {
                appendChild: (el) => appended.push(el),
                removeChild: (el) => appended.splice(appended.indexOf(el), 1),
            },
            createElement: () => ({
                style: {},
                setAttribute() {},
                get parentNode() {
                    return appended.includes(this) ? doc.body : null;
                },
            }),
        };
        const hud = DebugHUD.attach({ director, doc });
        hud.mount();
        expect(appended).toHaveLength(1);
        hud.detach();
        expect(appended).toHaveLength(0);
    });
});

// ── the audits ───────────────────────────────────────────────────────────────

describe('the budgets audit', () => {
    test('it passes', () => {
        expect(run('audit-budgets.mjs', '--check')).toContain('every measurable budget is inside its headroom');
    });

    test('it measures rather than asserts a hoped-for number', () => {
        const report = JSON.parse(run('audit-budgets.mjs', '--json'));
        const frame = report.checks.find((c) => c.id === 'frame');
        const tier1 = report.checks.find((c) => c.id === 'tier1');

        expect(frame.value).toBeGreaterThan(0);
        expect(tier1.value).toBeGreaterThan(0);
        expect(report.detail.frame.bones).toBeGreaterThan(20);
        expect(report.detail.tier1.records).toBeGreaterThan(100);
    });

    test('it demands headroom rather than merely fitting', () => {
        // Node is not a Quest. Coming in at 1.9 of a 2 ms budget on a desktop core has
        // already failed, and the audit is what says so.
        const report = JSON.parse(run('audit-budgets.mjs', '--json'));
        expect(report.headroom).toBeLessThanOrEqual(0.25);
        for (const check of report.checks.filter((c) => c.ceiling)) {
            expect(`${check.id}: ${check.value < check.ceiling}`).toBe(`${check.id}: true`);
        }
    });

    test('it is honest about what it cannot measure', () => {
        const text = run('audit-budgets.mjs', '--report');
        expect(text).toContain('not on a Quest');
        expect(text).toContain('QA_CHECKLIST');
    });
});

describe('the privacy audit', () => {
    test('it passes', () => {
        expect(run('audit-privacy.mjs', '--check')).toContain('every privacy claim holds');
    });

    test('all six claims are checked and all six hold', () => {
        const checks = JSON.parse(run('audit-privacy.mjs', '--json'));
        expect(checks.map((c) => c.id).sort()).toEqual(
            ['indicator', 'no-store', 'nothing-persists', 'off-by-default', 'one-door', 'opt-outs'].sort()
        );
        expect(checks.filter((c) => !c.pass)).toEqual([]);
    });

    test('it fails when a claim stops holding', () => {
        // A detector nobody has seen fail is not a detector. Plant a second door, prove the
        // audit finds it, remove it — in a finally, so a failed expectation cannot leave it.
        const probe = path.join(ROOT, 'src/behavior/adapters/_audit_probe.js');
        try {
            fs.writeFileSync(probe, 'const s = navigator.mediaDevices.getUserMedia({});\n');
            expect(() => run('audit-privacy.mjs', '--check')).toThrow();
        } finally {
            fs.rmSync(probe, { force: true });
        }
        expect(run('audit-privacy.mjs', '--check')).toContain('every privacy claim holds');
    });

    test('it strips comments before reading source', () => {
        // Four assertions in this project have failed because a file explained the thing it
        // was checked for not doing. The audit must not be the fifth.
        const body = fs.readFileSync(path.join(ROOT, 'scripts/audit-privacy.mjs'), 'utf8');
        expect(body).toContain('codeOf');
        expect(run('audit-privacy.mjs', '--json')).toContain('"pass": true');
    });
});

// ── the checklist ────────────────────────────────────────────────────────────

describe('the visual checklist', () => {
    const checklist = fs.readFileSync(path.join(ROOT, 'docs/QA_CHECKLIST.md'), 'utf8');

    test('it covers every section the engine grew', () => {
        for (const section of [
            'Boot and inertness',
            'Motion quality',
            'Joint attention',
            'Music',
            'Scenes',
            'Consent',
            'HUD',
            'Budgets, on the device',
        ]) {
            expect(`${section}: ${checklist.includes(section)}`).toBe(`${section}: true`);
        }
    });

    test('it names the acceptance criteria the batches were bought on', () => {
        for (const claim of [
            'No pop at the transition',
            'Lipsync keeps running',
            'She says nothing',
            'Nothing is left running',
            'She says only the script lines',
            'Her answer never arrives',
        ]) {
            expect(`${claim}: ${checklist.includes(claim)}`).toBe(`${claim}: true`);
        }
    });

    test('it is unsigned, and says an unsigned checklist is not a green audit', () => {
        expect(checklist).toContain('Signed               ____________________');
        expect(checklist).toContain('An unsigned checklist is not a green audit');
    });

    test('it puts the default flip in its own PR, after the audits', () => {
        expect(checklist).toContain('in its own PR');
        expect(checklist).toContain('HomePilot');
        expect(checklist).toMatch(/does \*\*not\*\* flip|stays opt-in/);
    });

    test('the default has not been flipped', () => {
        // B19 builds the audits. The flip is a separate PR, and this is what makes sure
        // this batch did not quietly take it.
        const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/behavior.config.json'), 'utf8'));
        expect(config.behaviorEngine.enabled).toBe(false);
    });
});
