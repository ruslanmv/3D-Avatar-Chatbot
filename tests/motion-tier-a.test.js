/**
 * B4 — Tier A vocabulary: turn, raise_hand, and the fast-path false-positive
 * gate.
 *
 * Everything here is Tier A: yaw and arms only, never the avatar's root
 * position. So none of it is affected by the movement policy, on desktop or in
 * VR — which is the point of the tier split, and is asserted below.
 */

/* global describe, test, expect, afterEach */

const FastPath = require('../src/xr/IntentFastPath');
const Parser = require('../src/xr/MotionBlockParser');
const Clips = require('../src/xr/MotionClipMap');
const Policy = require('../src/xr/MotionPolicy');

afterEach(() => Policy._setOverride(null));

describe('B4: turn', () => {
    test('"turn around" and its translations emit a 180 turn', () => {
        const utterances = [
            'turn around',
            'turn round',
            'date la vuelta',
            'girati',
            'dreh dich um',
            'tourne toi', // FR: matched by turn_to_me only with "vers moi"
        ];
        for (const u of utterances) {
            const hit = FastPath.match(u);
            expect(hit).not.toBeNull();
            const types = hit.plan.commands.map((c) => c.type);
            expect(types).toContain('turn');
        }
    });

    test('"turn around" specifically asks for 180 degrees', () => {
        const hit = FastPath.match('turn around');
        expect(hit.label).toBe('turn_around');
        expect(hit.plan.commands[0].degrees).toBe(180);
    });

    test('"face me" turns toward the user rather than by an angle', () => {
        const hit = FastPath.match('face me');
        expect(hit.label).toBe('turn_to_me');
        const turn = hit.plan.commands.find((c) => c.type === 'turn');
        expect(turn.target).toBe('user');
        expect(turn.degrees).toBeUndefined();
    });

    test('degrees are clamped to a half circle each way', () => {
        const plan = Parser.validatePlan({ commands: [{ type: 'turn', degrees: 720 }] });
        expect(plan.commands[0].degrees).toBe(180);
        const back = Parser.validatePlan({ commands: [{ type: 'turn', degrees: -900 }] });
        expect(back.commands[0].degrees).toBe(-180);
    });

    test('a non-numeric angle falls back to a half turn instead of NaN', () => {
        const plan = Parser.validatePlan({ commands: [{ type: 'turn', degrees: 'around' }] });
        expect(plan.commands[0].degrees).toBe(180);
    });
});

describe('B4: raise_hand', () => {
    test('"raise your hand" and its translations emit raise_hand', () => {
        for (const u of ['raise your hand', 'raise hand', 'hands up', 'levanta la mano', 'alza la mano']) {
            const hit = FastPath.match(u);
            expect(hit).not.toBeNull();
            expect(hit.label).toBe('raise_hand');
        }
    });

    test('"levanta la mano" is not swallowed by the stand rule', () => {
        // The stand rule matches `levanta( te)?`, which also matches
        // "levanta la mano". raise_hand must therefore be ordered BEFORE
        // stand — this test is the reason that ordering exists.
        const hit = FastPath.match('levanta la mano');
        expect(hit.label).toBe('raise_hand');
        expect(hit.label).not.toBe('stand');
    });

    test('the clip entry falls back to procedural IK, so it works with no assets', () => {
        const entry = Clips.resolve('raise_hand');
        expect(entry).not.toBeNull();
        expect(entry.procedural).toBe('reach_high');
    });

    test('raise_hand is advertised to the model', () => {
        expect(Clips.availableNames()).toContain('raise_hand');
    });
});

describe('B4: both commands are Tier A', () => {
    test('turn and raise_hand survive every movement setting', () => {
        for (const movement of ['off', 'vr', 'all']) {
            Policy._setOverride({ enabled: true, movement });
            for (const inVR of [true, false]) {
                expect(Policy.allows('turn', { inVR })).toBe(true);
                expect(Policy.allows('raise_hand', { inVR })).toBe(true);
            }
        }
    });

    test('their plans are never stripped, even with movement off', () => {
        Policy._setOverride({ enabled: true, movement: 'off' });
        for (const label of ['turn_around', 'turn_to_me', 'raise_hand']) {
            const rule = FastPath.RULES.find((r) => r.label === label);
            const res = Policy.filterPlan(rule.plan(), { inVR: false });
            expect(res.stripped).toEqual([]);
            expect(res.substituted).toBe(false);
        }
    });

    test('every new rule emits a plan the parser accepts', () => {
        for (const label of ['turn_around', 'turn_to_me', 'raise_hand']) {
            const rule = FastPath.RULES.find((r) => r.label === label);
            expect(Parser.validatePlan(rule.plan())).not.toBeNull();
        }
    });
});

describe('B4: fast-path false-positive gate', () => {
    test('short imperative commands still fire', () => {
        for (const u of ['stop', 'please stop', 'stop now', 'dance', 'sit down', 'shake my hand']) {
            expect(FastPath.match(u)).not.toBeNull();
        }
    });

    test('utterances longer than the word limit fall through to the LLM', () => {
        const long = 'i was going to say we should stop by the shop later';
        expect(long.split(' ').length).toBeGreaterThan(FastPath.MAX_WORDS);
        expect(FastPath.match(long)).toBeNull();
    });

    test('the word limit is a real boundary, not an approximation', () => {
        const sixWords = 'please turn around for me right now';
        expect(sixWords.split(' ').length).toBeGreaterThan(FastPath.MAX_WORDS);
        expect(FastPath.match(sixWords)).toBeNull();
        expect(FastPath.match('please turn around for me')).not.toBeNull();
    });

    test('SHORT false positives are caught by the negative guards', () => {
        // The whole point: "can you stop being sarcastic" is five words, so
        // the word gate lets it through. Only the per-rule `not` pattern
        // stops the avatar freezing mid-conversation.
        for (const u of [
            'stop being sarcastic',
            'can you stop being rude',
            'stop talking about that',
            'dont stop',
            'never stop',
            'deja de hablar',
            'smetti di parlare',
        ]) {
            expect(FastPath.match(u)).toBeNull();
        }
    });

    test('the guard does not block a real stop that happens to be short', () => {
        for (const u of ['stop', 'stop please', 'freeze', 'quieto', 'halt']) {
            const hit = FastPath.match(u);
            expect(hit).not.toBeNull();
            expect(hit.label).toBe('stop');
        }
    });

    test('only rules that need a guard carry one', () => {
        // A `not` pattern is a maintenance cost; it should be the exception.
        const guarded = FastPath.RULES.filter((r) => r.not).map((r) => r.label);
        expect(guarded).toEqual(['stop']);
    });
});
