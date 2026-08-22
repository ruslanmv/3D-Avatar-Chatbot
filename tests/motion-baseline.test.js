/**
 * Characterization tests for the Living-NPC motion stack.
 *
 * These pin the stack's behaviour EXACTLY as it is today, before the
 * MotionPolicy work changes any defaults. They are not here to say the current
 * behaviour is correct — they are here so the batches that follow can prove
 * they changed only what they meant to:
 *
 *   - B1 adds MotionPolicy with no consumers      → this file must stay green.
 *   - B2 wires the policy with neutral defaults   → this file must stay green
 *                                                   UNCHANGED. Any edit needed
 *                                                   here means B2 was not the
 *                                                   behaviour-neutral batch it
 *                                                   claims to be.
 *   - B3 flips the default to off                 → this file is expected to
 *                                                   change, deliberately, in
 *                                                   the same commit.
 *
 * So: if you find yourself editing this file, check which batch you are on.
 *
 * Only pure modules are covered (no DOM, no THREE) — MotionIntegration itself
 * needs a browser and is verified manually.
 */

/* global describe, test, expect */

const Parser = require('../src/xr/MotionBlockParser');
const FastPath = require('../src/xr/IntentFastPath');
const Contract = require('../src/xr/MotionContract');
const Clips = require('../src/xr/MotionClipMap');

// ─────────────────────────────────────────────────────────────────────────────
// The command vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/** Exactly the types the parser accepts today, in declaration order. */
const BASELINE_TYPES = [
    'approach',
    'retreat',
    'follow',
    'stop_follow',
    'stop',
    'look_at',
    'expression',
    'gesture',
    'wave',
    'nod',
    'point',
    'offer_hand',
    'wait_contact',
    'turn', // added in B4
    'raise_hand', // added in B4
    'sit',
    'lay',
    'stand',
    'idle',
    'speak_start',
    'speak_end',
    'pause',
];

/** The three types MotionPolicy will gate. Named here so the split is explicit. */
const MOVEMENT_TYPES = ['approach', 'retreat', 'follow'];

describe('baseline: command vocabulary', () => {
    test('the parser whitelist is exactly these 22 types', () => {
        // Membership, not just length — a new type must show up in this diff.
        expect(Parser.ALLOWED_TYPES).toEqual(BASELINE_TYPES);
    });

    test('every movement type is currently allowed and ungated', () => {
        for (const type of MOVEMENT_TYPES) {
            expect(Parser.ALLOWED_TYPES).toContain(type);
            const plan = Parser.validatePlan({ commands: [{ type, target: 'user' }] });
            expect(plan).not.toBeNull();
            expect(plan.commands[0].type).toBe(type);
        }
    });

    test('stop and stop_follow survive validation — they must never be gated', () => {
        for (const type of ['stop', 'stop_follow']) {
            const plan = Parser.validatePlan({ commands: [{ type }] });
            expect(plan).not.toBeNull();
            expect(plan.commands[0].type).toBe(type);
        }
    });

    test('unknown command types are dropped', () => {
        expect(Parser.validatePlan({ commands: [{ type: 'teleport' }] })).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fast path
// ─────────────────────────────────────────────────────────────────────────────

/** Every fast-path rule today, in priority order. */
const BASELINE_RULES = [
    'stop',
    'follow',
    'stop_follow',
    'come_here',
    'go_away',
    'turn_around', // added in B4
    'turn_to_me', // added in B4
    'raise_hand', // added in B4
    'sit',
    'lay', // the laying posture
    'stand',
    'handshake',
    'high_five',
    'look_at_me',
    'wave',
    'dance',
    'bow',
    'nod_yes',
    'backflip',
];

describe('baseline: IntentFastPath', () => {
    test('the rule set is exactly these 19 labels, in this order', () => {
        expect(FastPath.RULES.map((r) => r.label)).toEqual(BASELINE_RULES);
    });

    test('canonical utterances still map to their rules', () => {
        const cases = [
            ['stop', 'stop'],
            ['follow me', 'follow'],
            ['come here', 'come_here'],
            ['go away', 'go_away'],
            ['sit down', 'sit'],
            ['stand up', 'stand'],
            ['shake my hand', 'handshake'],
            ['look at me', 'look_at_me'],
            ['dance', 'dance'],
        ];
        for (const [utterance, label] of cases) {
            const hit = FastPath.match(utterance);
            expect(hit).not.toBeNull();
            expect(hit.label).toBe(label);
        }
    });

    test('every rule produces a plan that survives parser validation', () => {
        // The fast path and the LLM share one schema; this is the contract
        // between them, and B2 will route both through the same filter.
        for (const rule of FastPath.RULES) {
            const plan = rule.plan();
            expect(Parser.validatePlan(plan)).not.toBeNull();
        }
    });

    test('the movement rules currently emit ungated movement commands', () => {
        // Documents precisely what B3 will change once Movement defaults to off.
        const movementRules = { follow: 'follow', come_here: 'approach', go_away: 'retreat' };
        for (const [label, expectedType] of Object.entries(movementRules)) {
            const rule = FastPath.RULES.find((r) => r.label === label);
            const types = rule.plan().commands.map((c) => c.type);
            expect(types).toContain(expectedType);
        }
    });

    test('conversational sentences do not match any rule', () => {
        expect(FastPath.match('what do you think about the weather today')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clip inventory
// ─────────────────────────────────────────────────────────────────────────────

describe('baseline: MotionClipMap', () => {
    test('26 entries and 21 aliases resolve today', () => {
        // +raise_hand in B4; +lay/lay_idle and eight laying phrasings when the
        // laying POSTURE landed.
        expect(Object.keys(Clips.ENTRIES)).toHaveLength(26);
        expect(Object.keys(Clips.ALIASES)).toHaveLength(21);
    });

    test('21 names are advertised to the model — every *_idle is withheld', () => {
        const names = Clips.availableNames();
        expect(names).toHaveLength(21);
        expect(names).toContain('dance');
        expect(names).toContain('sit');
        expect(names).toContain('lay'); // the posture IS offered
        expect(names).not.toContain('idle');
        // The reschedule targets are not: the model asks for the posture and
        // _scheduleIdle holds it. lay_idle leaked here until availableNames
        // matched the suffix instead of naming sit_idle alone.
        expect(names).not.toContain('sit_idle');
        expect(names).not.toContain('lay_idle');
    });

    test('every alias resolves to a real entry', () => {
        for (const alias of Object.keys(Clips.ALIASES)) {
            expect(Clips.resolve(alias)).not.toBeNull();
        }
    });

    test('name normalization is case- and separator-insensitive', () => {
        // Library-only mode (the default) may return a filtered copy of an
        // entry, so the contract is structural equality, not identity.
        expect(Clips.resolve('HIGH FIVE')).toStrictEqual(Clips.resolve('high_five'));
        expect(Clips.resolve('sit-down')).toStrictEqual(Clips.resolve('sit'));
    });

    test('an unknown name resolves to null — the silent-failure case B5 fixes', () => {
        // Documented, not endorsed: today this returns null and playAnimation
        // then does nothing at all, with no log. B5 replaces it with a
        // reported failure plus a substitute.
        expect(Clips.resolve('moonwalk')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The prompt contract
// ─────────────────────────────────────────────────────────────────────────────

describe('baseline: MotionContract', () => {
    const snapshot = {
        user: { distance_to_avatar_m: 2.3, in_vr: true, hands_tracked: true },
        avatar: { state: 'idle', sitting: false, following: false },
        anchors: [{ type: 'seat' }],
    };

    test('the suffix is non-empty and advertises every clip it is given', () => {
        const suffix = Contract.systemPromptSuffix(snapshot, Clips.availableNames());
        expect(suffix.length).toBeGreaterThan(0);
        for (const name of Clips.availableNames()) {
            expect(suffix).toContain(name);
        }
    });

    test('movement commands are advertised unconditionally today', () => {
        // B2 makes this list conditional; B3 turns it off by default. Pinning
        // it here means that change cannot happen silently.
        const suffix = Contract.systemPromptSuffix(snapshot, Clips.availableNames());
        for (const type of MOVEMENT_TYPES) {
            expect(suffix).toContain(type);
        }
    });

    test('the world snapshot line carries the fields the model reasons over', () => {
        const line = Contract._snapshotLine(snapshot);
        expect(line).toContain('user_distance_m=2.3');
        expect(line).toContain('user_in_vr=yes');
        expect(line).toContain('avatar_sitting=no');
        expect(line).toContain('anchors=seat');
    });

    test('an empty snapshot never throws', () => {
        expect(() => Contract.systemPromptSuffix({}, [])).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 neutrality
// ─────────────────────────────────────────────────────────────────────────────

describe('baseline: B2 is behaviour-neutral', () => {
    const snapshot = {
        user: { distance_to_avatar_m: 2.3, in_vr: true, hands_tracked: true },
        avatar: { state: 'idle', sitting: false, following: false },
        anchors: [{ type: 'seat' }],
    };

    /**
     * Omitting the third argument must keep the hand-wrapped prompt intact —
     * the guarantee that made B2 behaviour-neutral. The type lines themselves
     * grow when a batch adds vocabulary (B4 added turn and raise_hand); what
     * must never change silently is the SHAPE of the ungated prompt.
     */
    test('omitting allowedTypes keeps the full hand-wrapped type block', () => {
        const suffix = Contract.systemPromptSuffix(snapshot, ['wave', 'bow']);

        expect(suffix).toContain(
            [
                'Command types: approach, retreat, follow, stop_follow, stop, look_at,',
                'expression, gesture, wave, nod, point, offer_hand, wait_contact, turn,',
                'raise_hand, sit, stand, idle, pause, speak_start, speak_end.',
            ].join('\n')
        );
        expect(suffix).toContain('- If the user asks you to move, sit, follow, come, leave, or touch,');
        expect(suffix).toContain('- Physical contact (handshake, high five): approach to 0.65m, then');
    });

    test('passing the full whitelist keeps every type advertised', () => {
        const suffix = Contract.systemPromptSuffix(snapshot, ['wave'], Parser.ALLOWED_TYPES);
        for (const type of Parser.ALLOWED_TYPES) {
            expect(suffix).toContain(type);
        }
        // Movement is present, so the movement rules stay.
        expect(suffix).toContain('you MUST include the matching commands.');
    });

    test('a snapshot without last_action emits no last_action field', () => {
        // The pre-B2 snapshot had no such key; its absence must stay silent.
        expect(Contract._snapshotLine(snapshot)).not.toContain('last_action');
    });
});
