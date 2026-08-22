/**
 * Tests for MotionPolicy — the capability gate for the Living-NPC stack.
 *
 * The module is pure, so every environmental fact is injected: settings via
 * _setOverride(), VR presence via ctx.inVR. No DOM, no globals, no THREE.
 *
 * The claims that matter most here:
 *   - exactly approach/retreat/follow are gated, never anything else;
 *   - stop and stop_follow survive every setting, including master-off;
 *   - a fully-gated plan is substituted, never emptied.
 */

/* global describe, test, expect, afterEach */

const Policy = require('../src/xr/MotionPolicy');
const Parser = require('../src/xr/MotionBlockParser');
const FastPath = require('../src/xr/IntentFastPath');

/** Settings shorthand. */
const ON_ALL = { enabled: true, movement: 'all' };
const ON_VR = { enabled: true, movement: 'vr' };
const ON_OFF = { enabled: true, movement: 'off' };
const MASTER_OFF = { enabled: false, movement: 'all' };

const IN_VR = { inVR: true };
const DESKTOP = { inVR: false };

const plan = (...types) => ({ commands: types.map((t) => ({ type: t })), interruptible: true });

afterEach(() => Policy._setOverride(null));

describe('MotionPolicy classification', () => {
    test('exactly three types are movement', () => {
        expect(Policy.MOVEMENT_TYPES).toEqual(['approach', 'retreat', 'follow']);
    });

    test('isMovement is case- and whitespace-tolerant', () => {
        expect(Policy.isMovement('FOLLOW')).toBe(true);
        expect(Policy.isMovement('gesture')).toBe(false);
        expect(Policy.isMovement(null)).toBe(false);
    });

    test('every gated type is a real parser type — no typos in the list', () => {
        for (const type of Policy.MOVEMENT_TYPES) {
            expect(Parser.ALLOWED_TYPES).toContain(type);
        }
        for (const type of Policy.ALWAYS_ALLOWED) {
            expect(Parser.ALLOWED_TYPES).toContain(type);
        }
    });

    test('stop_follow is never classified as movement', () => {
        // It is the *cancel* for follow — gating it would strand the user.
        expect(Policy.isMovement('stop_follow')).toBe(false);
    });
});

describe('MotionPolicy.allows', () => {
    test('movement = all permits movement on desktop and in VR', () => {
        Policy._setOverride(ON_ALL);
        for (const ctx of [DESKTOP, IN_VR]) {
            for (const type of Policy.MOVEMENT_TYPES) {
                expect(Policy.allows(type, ctx)).toBe(true);
            }
        }
    });

    test('movement = vr permits movement only while presenting', () => {
        Policy._setOverride(ON_VR);
        for (const type of Policy.MOVEMENT_TYPES) {
            expect(Policy.allows(type, IN_VR)).toBe(true);
            expect(Policy.allows(type, DESKTOP)).toBe(false);
        }
    });

    test('movement = off blocks movement everywhere', () => {
        Policy._setOverride(ON_OFF);
        for (const ctx of [DESKTOP, IN_VR]) {
            for (const type of Policy.MOVEMENT_TYPES) {
                expect(Policy.allows(type, ctx)).toBe(false);
            }
        }
    });

    test('Tier A is unaffected by the movement setting', () => {
        const tierA = ['gesture', 'look_at', 'expression', 'nod', 'point', 'offer_hand', 'sit', 'stand', 'wave'];
        for (const settings of [ON_ALL, ON_VR, ON_OFF]) {
            Policy._setOverride(settings);
            for (const type of tierA) {
                expect(Policy.allows(type, DESKTOP)).toBe(true);
            }
        }
    });

    test('stop and stop_follow are allowed at every setting, master included', () => {
        for (const settings of [ON_ALL, ON_VR, ON_OFF, MASTER_OFF]) {
            Policy._setOverride(settings);
            for (const ctx of [DESKTOP, IN_VR]) {
                expect(Policy.allows('stop', ctx)).toBe(true);
                expect(Policy.allows('stop_follow', ctx)).toBe(true);
            }
        }
    });

    test('master off blocks everything else, including Tier A', () => {
        Policy._setOverride(MASTER_OFF);
        for (const type of ['gesture', 'look_at', 'expression', 'follow', 'sit']) {
            expect(Policy.allows(type, IN_VR)).toBe(false);
        }
    });

    test('a missing ctx is treated as not-in-VR', () => {
        Policy._setOverride(ON_VR);
        expect(Policy.allows('follow')).toBe(false);
        expect(Policy.allows('follow', {})).toBe(false);
    });
});

describe('MotionPolicy.filterPlan', () => {
    test('strips exactly the movement commands and keeps the rest', () => {
        Policy._setOverride(ON_OFF);
        const res = Policy.filterPlan(plan('look_at', 'follow', 'expression', 'approach'), DESKTOP);
        expect(res.plan.commands.map((c) => c.type)).toEqual(['look_at', 'expression']);
        expect(res.stripped).toEqual(['follow', 'approach']);
        expect(res.substituted).toBe(false);
    });

    test('strips nothing when movement is allowed', () => {
        Policy._setOverride(ON_ALL);
        const res = Policy.filterPlan(plan('look_at', 'follow'), DESKTOP);
        expect(res.stripped).toEqual([]);
        expect(res.plan.commands).toHaveLength(2);
    });

    test('a fully-gated plan is substituted, never emptied', () => {
        Policy._setOverride(ON_OFF);
        const res = Policy.filterPlan(plan('follow'), DESKTOP);
        expect(res.substituted).toBe(true);
        expect(res.plan.commands.length).toBeGreaterThan(0);
        expect(res.plan.commands.map((c) => c.type)).toContain('look_at');
        expect(res.stripped).toEqual(['follow']);
    });

    test('the substitute is itself a valid plan the DSL can run', () => {
        Policy._setOverride(ON_OFF);
        const res = Policy.filterPlan(plan('approach'), DESKTOP);
        expect(Parser.validatePlan(res.plan)).not.toBeNull();
    });

    test('a stop survives even with the master off', () => {
        Policy._setOverride(MASTER_OFF);
        const res = Policy.filterPlan(plan('follow', 'stop'), IN_VR);
        expect(res.plan.commands.map((c) => c.type)).toEqual(['stop']);
    });

    test('master off with no stop yields a null plan — nothing runs', () => {
        Policy._setOverride(MASTER_OFF);
        const res = Policy.filterPlan(plan('gesture', 'look_at'), IN_VR);
        expect(res.plan).toBeNull();
    });

    test('plan-level fields are preserved through filtering', () => {
        Policy._setOverride(ON_OFF);
        const src = { commands: [{ type: 'look_at' }, { type: 'follow' }], interruptible: false, priority: 'high' };
        const res = Policy.filterPlan(src, DESKTOP);
        expect(res.plan.interruptible).toBe(false);
        expect(res.plan.priority).toBe('high');
    });

    test('the input plan is not mutated', () => {
        Policy._setOverride(ON_OFF);
        const src = plan('look_at', 'follow');
        Policy.filterPlan(src, DESKTOP);
        expect(src.commands.map((c) => c.type)).toEqual(['look_at', 'follow']);
    });

    test('malformed input degrades safely', () => {
        Policy._setOverride(ON_ALL);
        for (const bad of [null, undefined, {}, { commands: 'nope' }]) {
            const res = Policy.filterPlan(bad, DESKTOP);
            expect(res.plan).toBeNull();
            expect(res.stripped).toEqual([]);
        }
    });

    test('commands without a type are dropped without being reported as stripped', () => {
        Policy._setOverride(ON_ALL);
        const res = Policy.filterPlan({ commands: [{ type: 'look_at' }, {}, null] }, DESKTOP);
        expect(res.plan.commands).toHaveLength(1);
        expect(res.stripped).toEqual([]);
    });
});

describe('MotionPolicy.allowedTypes', () => {
    test('movement types disappear from the vocabulary when movement is off', () => {
        Policy._setOverride(ON_OFF);
        const types = Policy.allowedTypes(Parser.ALLOWED_TYPES, DESKTOP);
        for (const type of Policy.MOVEMENT_TYPES) {
            expect(types).not.toContain(type);
        }
        expect(types).toContain('gesture');
        expect(types).toContain('stop');
    });

    test('movement = vr advertises movement only while presenting', () => {
        Policy._setOverride(ON_VR);
        expect(Policy.allowedTypes(Parser.ALLOWED_TYPES, IN_VR)).toContain('follow');
        expect(Policy.allowedTypes(Parser.ALLOWED_TYPES, DESKTOP)).not.toContain('follow');
    });

    test('master off advertises nothing — zero prompt tokens are spent', () => {
        Policy._setOverride(MASTER_OFF);
        expect(Policy.allowedTypes(Parser.ALLOWED_TYPES, IN_VR)).toEqual([]);
    });

    test('the full whitelist survives when everything is enabled', () => {
        Policy._setOverride(ON_ALL);
        expect(Policy.allowedTypes(Parser.ALLOWED_TYPES, IN_VR)).toEqual(Parser.ALLOWED_TYPES);
    });

    test('bad input yields an empty list rather than throwing', () => {
        Policy._setOverride(ON_ALL);
        expect(Policy.allowedTypes(null, DESKTOP)).toEqual([]);
    });
});

describe('MotionPolicy settings resolution', () => {
    test('B3: the feature is off by default — this is the experimental opt-in', () => {
        // Changed in B3, deliberately and in that same commit. Until then the
        // defaults were enabled:true / movement:'all', which is what made B2
        // provably behaviour-neutral. Reverting B3 restores those.
        expect(Policy.DEFAULTS.enabled).toBe(false);
        expect(Policy.DEFAULTS.movement).toBe('off');
    });

    test('a fresh install runs no motion at all', () => {
        Policy._setOverride(null);
        localStorage.removeItem(Policy.KEY_ENABLED);
        localStorage.removeItem(Policy.KEY_MOVEMENT);

        expect(Policy.isEnabled()).toBe(false);
        // Nothing is advertised, so a disabled user spends ZERO prompt tokens
        // on the motion contract — the main argument for shipping it off.
        expect(Policy.allowedTypes(Parser.ALLOWED_TYPES, IN_VR)).toEqual([]);
        // ...and no plan survives, except a stop.
        expect(Policy.filterPlan(plan('gesture', 'look_at'), IN_VR).plan).toBeNull();
        expect(Policy.filterPlan(plan('stop'), IN_VR).plan.commands).toHaveLength(1);
    });

    test('opting in enables Tier A but still not movement', () => {
        Policy._setOverride(null);
        localStorage.setItem(Policy.KEY_ENABLED, 'true');
        localStorage.removeItem(Policy.KEY_MOVEMENT); // movement untouched → off

        expect(Policy.isEnabled()).toBe(true);
        expect(Policy.movementMode()).toBe('off');
        expect(Policy.allows('gesture', DESKTOP)).toBe(true);
        expect(Policy.allows('follow', DESKTOP)).toBe(false);
        expect(Policy.allows('follow', IN_VR)).toBe(false);

        localStorage.removeItem(Policy.KEY_ENABLED);
    });

    test('an unrecognised movement value falls back to the default', () => {
        Policy._setOverride({ enabled: true, movement: 'sideways' });
        expect(Policy.movementMode()).toBe(Policy.DEFAULTS.movement);
    });

    test('reads localStorage when no override is set', () => {
        Policy._setOverride(null);
        localStorage.setItem(Policy.KEY_ENABLED, 'false');
        localStorage.setItem(Policy.KEY_MOVEMENT, 'vr');
        expect(Policy.isEnabled()).toBe(false);
        expect(Policy.movementMode()).toBe('vr');
        localStorage.removeItem(Policy.KEY_ENABLED);
        localStorage.removeItem(Policy.KEY_MOVEMENT);
    });

    test('absent keys fall back to the defaults', () => {
        Policy._setOverride(null);
        localStorage.removeItem(Policy.KEY_ENABLED);
        localStorage.removeItem(Policy.KEY_MOVEMENT);
        expect(Policy.isEnabled()).toBe(Policy.DEFAULTS.enabled);
        expect(Policy.movementMode()).toBe(Policy.DEFAULTS.movement);
    });
});

describe('MotionPolicy against the real fast path', () => {
    test('"follow me" keeps its gaze and expression when movement is off', () => {
        Policy._setOverride(ON_OFF);
        const hit = FastPath.match('follow me');
        const res = Policy.filterPlan(hit.plan, DESKTOP);
        expect(res.stripped).toContain('follow');
        expect(res.plan.commands.length).toBeGreaterThan(0);
        expect(res.plan.commands.map((c) => c.type)).not.toContain('follow');
    });

    test('"stop" is untouched at every setting', () => {
        const hit = FastPath.match('stop');
        for (const settings of [ON_ALL, ON_VR, ON_OFF, MASTER_OFF]) {
            Policy._setOverride(settings);
            const res = Policy.filterPlan(hit.plan, DESKTOP);
            expect(res.plan.commands.map((c) => c.type)).toContain('stop');
        }
    });

    test('pure Tier A rules are never stripped, at any movement setting', () => {
        const pureTierA = ['sit', 'stand', 'look_at_me', 'wave', 'dance', 'bow', 'nod_yes', 'backflip'];
        for (const settings of [ON_ALL, ON_VR, ON_OFF]) {
            Policy._setOverride(settings);
            for (const label of pureTierA) {
                const rule = FastPath.RULES.find((r) => r.label === label);
                const res = Policy.filterPlan(rule.plan(), DESKTOP);
                expect(res.stripped).toEqual([]);
            }
        }
    });

    test('handshake and high_five are MIXED tier — only the approach step is gated', () => {
        // These two plans open with `approach` (0.65 m / 0.7 m) and then run a
        // pure Tier A contact sequence. With movement off she must still offer
        // her hand and wait — the user closes the distance instead, which is
        // exactly the VR interaction HandContactIK was built for. Losing the
        // whole gesture here would be a real regression, so pin it.
        Policy._setOverride(ON_OFF);
        for (const label of ['handshake', 'high_five']) {
            const rule = FastPath.RULES.find((r) => r.label === label);
            const res = Policy.filterPlan(rule.plan(), DESKTOP);

            expect(res.stripped).toEqual(['approach']);
            expect(res.substituted).toBe(false); // Tier A remained, so no substitute

            const kept = res.plan.commands.map((c) => c.type);
            expect(kept).toContain('offer_hand');
            expect(kept).toContain('wait_contact');
            expect(kept).not.toContain('approach');
        }
    });

    test('handshake keeps its approach when movement is permitted', () => {
        Policy._setOverride(ON_VR);
        const rule = FastPath.RULES.find((r) => r.label === 'handshake');
        const res = Policy.filterPlan(rule.plan(), IN_VR);
        expect(res.stripped).toEqual([]);
        expect(res.plan.commands.map((c) => c.type)).toContain('approach');
    });
});
