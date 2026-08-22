/**
 * Misfire proxy + privacy gating (M-series follow-up).
 *
 * `recall_gap_hits` sees only the recall direction — the fast path staying
 * silent when it should have acted. The misfire proxy watches the opposite
 * failure: the user saying "stop" right after an action is the cheapest
 * observable correction signal for the fast path acting when it should NOT
 * have ("don't dance" → dance). And raw missed utterances are user speech,
 * so they only leave the telemetry closure when config.debug is on.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll, jest */

// MotionIntegration reads its collaborators off `window`, so they must be
// required (which registers them) before it will do anything.
require('../src/xr/MotionBlockParser'); // → window.NEXUS_MOTION_PARSER
require('../src/xr/IntentFastPath'); // → window.NEXUS_INTENT_FASTPATH
const MI = require('../src/xr/MotionIntegration');
const Policy = require('../src/xr/MotionPolicy');

const block = (cmds) => '```motion\n{"commands":' + JSON.stringify(cmds) + '}\n```';

/** Counters are module-level; measure deltas rather than absolutes. */
function delta(fn) {
    const before = MI.getTelemetry();
    fn();
    const after = MI.getTelemetry();
    return {
        misfire_stops: after.misfire_stops - before.misfire_stops,
        recall_gap_hits: after.recall_gap_hits - before.recall_gap_hits,
    };
}

beforeEach(() => {
    Policy._setOverride({ enabled: true, movement: 'all' });
    jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
afterAll(() => Policy._setOverride(null));

describe('misfire proxy — a quick stop is a correction signal', () => {
    test('a stop right after a fast-path action counts and names the action', () => {
        const before = MI.getTelemetry();
        MI.onUserUtterance('dance');
        MI.onUserUtterance('stop');
        const after = MI.getTelemetry();
        expect(after.misfire_stops - before.misfire_stops).toBe(1);
        expect(after.misfire_recent[after.misfire_recent.length - 1]).toBe('dance');
    });

    test('a stop more than 5 s later is a normal stop, not a correction', () => {
        const d = delta(() => {
            MI.onUserUtterance('dance');
            jest.advanceTimersByTime(6000);
            MI.onUserUtterance('stop');
        });
        expect(d.misfire_stops).toBe(0);
    });

    test('a cold stop (nothing acted recently) does not count', () => {
        jest.advanceTimersByTime(10000); // outlive any action from earlier tests
        const d = delta(() => MI.onUserUtterance('stop'));
        expect(d.misfire_stops).toBe(0);
    });

    test('stop after stop does not double-count', () => {
        const d = delta(() => {
            MI.onUserUtterance('dance');
            MI.onUserUtterance('stop');
            MI.onUserUtterance('stop');
        });
        expect(d.misfire_stops).toBe(1);
    });

    test('a long-phrased stop the regex missed but the LLM honoured counts too', () => {
        const d = delta(() => {
            MI.onUserUtterance('dance');
            MI.processReply('On it!\n\n' + block([{ type: 'gesture', name: 'dance' }])); // suppressed duplicate
            MI.onUserUtterance('would you kindly stop doing that now'); // 7 words → fast path misses
            MI.processReply('Stopping.\n\n' + block([{ type: 'stop' }]));
        });
        expect(d.misfire_stops).toBe(1);
        // The same turn is also, correctly, a recall gap: the regex should
        // have caught a stop request and did not.
        expect(d.recall_gap_hits).toBe(1);
    });
});

describe('privacy — raw missed utterances are debug-gated', () => {
    test('texts are hidden by default; the count is always available', () => {
        MI.onUserUtterance('an utterly unmatched sentence about nothing');
        const t = MI.getTelemetry();
        expect(t.missed_recent).toEqual([]);
        expect(t.missed_count).toBeGreaterThan(0);
    });

    test('config.debug = true reveals the texts for mining', () => {
        MI.onUserUtterance('another unmatched sentence for the miners');
        MI.config.debug = true;
        const t = MI.getTelemetry();
        MI.config.debug = false;
        expect(t.missed_recent.length).toBeGreaterThan(0);
        expect(t.missed_recent[t.missed_recent.length - 1]).toContain('miners');
    });
});
