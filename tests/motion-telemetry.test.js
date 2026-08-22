/**
 * Telemetry (M-series) — the counters that decide whether a local ML tier is
 * worth building.
 *
 * The number under test is `recall_gap_hits`: utterances the regex missed
 * where the LLM then acted on a real COMMAND. Its whole value is being
 * trustworthy, so the ambient case is pinned first — MotionContract mandates
 * an ambient plan (look_at + expression) on every plain-conversation turn, so
 * a naive implementation that counts any plan scores 100% on pure small talk
 * and the metric becomes worthless.
 */

/* global describe, test, expect, beforeEach, afterAll */

// MotionIntegration reads its collaborators off `window`, so they must be
// required (which registers them) before it will do anything.
require('../src/xr/MotionBlockParser'); // → window.NEXUS_MOTION_PARSER
require('../src/xr/IntentFastPath'); // → window.NEXUS_INTENT_FASTPATH
const MI = require('../src/xr/MotionIntegration');
const Policy = require('../src/xr/MotionPolicy');

const block = (cmds) => '```motion\n{"commands":' + JSON.stringify(cmds) + '}\n```';
const AMBIENT = [
    { type: 'look_at', target: 'user_head' },
    { type: 'expression', name: 'happy', weight: 0.4 },
];
const REAL = [
    { type: 'look_at', target: 'user_head' },
    { type: 'gesture', name: 'dance' },
];

/** Counters are module-level; measure deltas rather than absolutes. */
function delta(fn) {
    const before = MI.getTelemetry();
    fn();
    const after = MI.getTelemetry();
    return {
        utterances: after.utterances - before.utterances,
        llm_plans: after.llm_plans - before.llm_plans,
        recall_gap_hits: after.recall_gap_hits - before.recall_gap_hits,
        fastpath_hits: after.fastpath_hits - before.fastpath_hits,
        suppressed: after.suppressed_llm_plans - before.suppressed_llm_plans,
    };
}

beforeEach(() => Policy._setOverride({ enabled: true, movement: 'all' }));
afterAll(() => Policy._setOverride(null));

describe('recall_gap_hits measures COMMANDS, not conversation', () => {
    test('small talk with an ambient plan does not count as a recall gap', () => {
        const d = delta(() => {
            for (let i = 0; i < 5; i++) {
                MI.onUserUtterance('what do you think about the weather today');
                MI.processReply('Lovely out there.\n\n' + block(AMBIENT));
            }
        });
        expect(d.utterances).toBe(5);
        expect(d.llm_plans).toBe(5); // the plans DID arrive...
        expect(d.recall_gap_hits).toBe(0); // ...but none was a command
    });

    test('a missed utterance the LLM answers with a real command does count', () => {
        const d = delta(() => {
            MI.onUserUtterance('why dont you show me some moves');
            MI.processReply('Sure!\n\n' + block(REAL));
        });
        expect(d.recall_gap_hits).toBe(1);
    });

    test('one miss counts at most once', () => {
        const d = delta(() => {
            MI.onUserUtterance('why dont you show me some moves');
            MI.processReply('Sure!\n\n' + block(REAL));
            MI.processReply('And again.\n\n' + block(REAL)); // same miss, second plan
        });
        expect(d.recall_gap_hits).toBe(1);
    });
});

describe('the other counters', () => {
    test('a fast-path hit counts as a hit and suppresses the LLM plan', () => {
        const d = delta(() => {
            MI.onUserUtterance('dance');
            MI.processReply('Watch this!\n\n' + block(REAL));
        });
        expect(d.fastpath_hits).toBe(1);
        expect(d.suppressed).toBe(1);
        expect(d.recall_gap_hits).toBe(0); // the regex did NOT miss
    });

    test('missed utterances are retained for mining, capped and truncated', () => {
        for (let i = 0; i < 30; i++) MI.onUserUtterance('a totally unmatched sentence number ' + i);
        MI.config.debug = true; // raw texts are debug-gated (privacy)
        const t = MI.getTelemetry();
        MI.config.debug = false;
        expect(t.missed_count).toBeGreaterThan(0);
        expect(t.missed_recent.length).toBeLessThanOrEqual(20);
        for (const s of t.missed_recent) expect(s.length).toBeLessThanOrEqual(80);
    });

    test('getTelemetry returns a copy — callers cannot corrupt the counters', () => {
        const t = MI.getTelemetry();
        t.utterances = 99999;
        t.missed_recent.push('injected');
        t.by_label.fake = 1;
        const fresh = MI.getTelemetry();
        expect(fresh.utterances).not.toBe(99999);
        expect(fresh.missed_recent).not.toContain('injected');
        expect(fresh.by_label.fake).toBeUndefined();
    });

    test('nothing is counted while the feature is disabled', () => {
        Policy._setOverride({ enabled: false, movement: 'off' });
        const d = delta(() => MI.onUserUtterance('dance'));
        expect(d.utterances).toBe(0);
    });
});
