/**
 * MO11. The motion audit's scorer catches the two failures hips height missed on 2026-11-14:
 * a clip that tips her over sideways (BOOTH Spin before MO10) and one that flips her legs above
 * her head (the Mixamo pack) — both at standing hips height.
 */
const S = require('../tools/qa/MotionAuditScorer.js');

const stand = { hipsY: 0.9, headAboveHips: 0.55 };
const upright = (hipsY = 0.9) => ({ hipsY, headY: hipsY + 0.55, footY: [0.05, 0.05] });

describe('MotionAuditScorer', () => {
    test('a grounded, upright gesture that moves is ok', () => {
        const r = S.score({ kind: 'gesture', played: true, stand, samples: [upright(), upright(0.88)], motionDeg: 30 });
        expect(r.verdict).toBe('ok');
        expect(r.flags).toEqual([]);
    });

    test('tipped over sideways at standing hips height fails (BOOTH Spin before MO10)', () => {
        const lying = { hipsY: 0.9, headY: 0.95, footY: [0.85, 0.85] };
        const r = S.score({ kind: 'gesture', played: true, stand, samples: [upright(), lying], motionDeg: 90 });
        expect(r.verdict).toBe('fail');
        expect(r.flags).toContain('tipped-over');
    });

    test('legs above the head at standing hips height fails (Mixamo flip)', () => {
        const flipped = { hipsY: 0.9, headY: 1.45, footY: [1.7, 1.75] };
        const r = S.score({ kind: 'gesture', played: true, stand, samples: [flipped], motionDeg: 120 });
        expect(r.verdict).toBe('fail');
        expect(r.flags).toContain('legs-flipped');
    });

    test('floating and sinking fail; sitting and lying are judged as postures', () => {
        expect(S.score({ played: true, stand, samples: [upright(1.3)], motionDeg: 10 }).flags).toContain('floating');
        expect(S.score({ played: true, stand, samples: [upright(0.1)], motionDeg: 10 }).flags).toContain('sinking');
        const sat = S.score({ played: true, stand, samples: [upright(0.5)], motionDeg: 40, posture: 'sit' });
        expect(sat.verdict).toBe('ok');
        const lay = { hipsY: 0.12, headY: 0.15, footY: [0.1, 0.1] };
        expect(S.score({ played: true, stand, samples: [lay], motionDeg: 80, posture: 'lay' }).verdict).toBe('ok');
        expect(
            S.score({ played: true, stand, samples: [upright(0.88)], motionDeg: 20, posture: 'sit' }).flags
        ).toContain('sit-not-lowered');
    });

    test('nothing visible is a warning, unless the action is ambient', () => {
        expect(S.score({ played: true, stand, samples: [upright()], motionDeg: 0.5 }).verdict).toBe('warn');
        expect(S.score({ played: true, stand, samples: [upright()], motionDeg: 0.5, ambient: true }).verdict).toBe(
            'ok'
        );
    });

    test('a phrase that is not understood, or an action that never played, fails', () => {
        expect(
            S.score({ played: true, stand, samples: [upright()], motionDeg: 20, expectLabel: 'spin', gotLabel: null })
                .flags
        ).toContain('phrase-not-understood');
        expect(S.score({ played: false, stand, samples: [], motionDeg: 0 }).verdict).toBe('fail');
    });

    test('summarize counts verdicts', () => {
        expect(S.summarize([{ verdict: 'ok' }, { verdict: 'fail' }, { verdict: 'ok' }])).toEqual({
            total: 3,
            ok: 2,
            warn: 0,
            fail: 1,
        });
    });
});
