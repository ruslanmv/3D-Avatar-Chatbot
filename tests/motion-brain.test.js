/**
 * Tests for the Living-NPC brain: MotionBlockParser, IntentFastPath,
 * MotionContract. These modules are pure (no DOM) and provider-agnostic.
 */

/* global describe, test, expect */

const Parser = require('../src/xr/MotionBlockParser');
const FastPath = require('../src/xr/IntentFastPath');
const Contract = require('../src/xr/MotionContract');

describe('MotionBlockParser', () => {
    test('extracts a valid plan and strips the block from display text', () => {
        const reply =
            'Of course, lead the way!\n\n```motion\n' +
            '{"commands":[{"type":"look_at","target":"user_head"},' +
            '{"type":"follow","target":"user","distance_m":1.5}],' +
            '"interruptible":true,"priority":"normal"}\n```';
        const { cleanText, plan } = Parser.extract(reply);
        expect(cleanText).toBe('Of course, lead the way!');
        expect(plan).not.toBeNull();
        expect(plan.commands).toHaveLength(2);
        expect(plan.commands[1].type).toBe('follow');
        expect(plan.commands[1].distance_m).toBe(1.5);
        expect(plan.interruptible).toBe(true);
    });

    test('malformed JSON never throws and still cleans the text', () => {
        const reply = 'Hi there ```motion\n{"commands": [BROKEN\n``` bye';
        const { cleanText, plan } = Parser.extract(reply);
        expect(plan).toBeNull();
        expect(cleanText).toContain('Hi there');
        expect(cleanText).not.toContain('BROKEN');
    });

    test('drops unknown command types and clamps values', () => {
        const raw = {
            commands: [
                { type: 'self_destruct' },
                { type: 'approach', distance_m: 99, speed: -4 },
                { type: 'expression', name: 'happy', weight: 7 },
            ],
        };
        const plan = Parser.validatePlan(raw);
        expect(plan.commands).toHaveLength(2);
        expect(plan.commands[0].distance_m).toBeLessThanOrEqual(6);
        expect(plan.commands[0].speed).toBeGreaterThanOrEqual(0.1);
        expect(plan.commands[1].weight).toBeLessThanOrEqual(1);
    });

    test('last block wins when the model repeats itself', () => {
        const reply =
            'a ```motion\n{"commands":[{"type":"wave"}]}\n``` b ' + '```motion\n{"commands":[{"type":"sit"}]}\n``` c';
        const { plan } = Parser.extract(reply);
        expect(plan.commands[0].type).toBe('sit');
    });

    test('caps command count at 8', () => {
        const raw = { commands: new Array(20).fill({ type: 'nod' }) };
        expect(Parser.validatePlan(raw).commands).toHaveLength(8);
    });

    test('maskStreaming hides the block as soon as its fence starts', () => {
        expect(Parser.maskStreaming('Sure thing!\n```motion\n{"comm')).toBe('Sure thing!');
        expect(Parser.maskStreaming('Sure thing!\n``')).toBe('Sure thing!');
        expect(Parser.maskStreaming('No block here')).toBe('No block here');
    });

    test('text without any fence passes through untouched', () => {
        const { cleanText, plan } = Parser.extract('plain answer');
        expect(cleanText).toBe('plain answer');
        expect(plan).toBeNull();
    });
});

describe('IntentFastPath', () => {
    const cases = [
        ['follow me please', 'follow'],
        ['¡Sígueme!', 'follow'],
        ['seguimi', 'follow'],
        ['sit down', 'sit'],
        ['siéntate', 'sit'],
        ['assieds-toi', 'sit'],
        ['stand up now', 'stand'],
        ['go away', 'go_away'],
        ['aléjate', 'go_away'],
        ['come here', 'come_here'],
        ['shake my hand', 'handshake'],
        ['dame la mano', 'handshake'],
        ['gib mir die Hand', 'handshake'],
        ['stop', 'stop'],
        ['dance for me', 'dance'],
        ['look at me', 'look_at_me'],
    ];

    test.each(cases)('matches "%s" → %s', (utterance, label) => {
        const hit = FastPath.match(utterance);
        expect(hit).not.toBeNull();
        expect(hit.label).toBe(label);
        expect(Array.isArray(hit.plan.commands)).toBe(true);
        expect(hit.plan.commands.length).toBeGreaterThan(0);
    });

    test('handshake plan contains the full contact sequence in order', () => {
        const types = FastPath.match('shake my hand').plan.commands.map((c) => c.type);
        expect(types).toEqual(expect.arrayContaining(['approach', 'offer_hand', 'wait_contact', 'gesture']));
        expect(types.indexOf('offer_hand')).toBeLessThan(types.indexOf('wait_contact'));
    });

    test('fast-path plans validate against the parser schema', () => {
        for (const rule of FastPath.RULES) {
            expect(Parser.validatePlan(rule.plan())).not.toBeNull();
        }
    });

    test('conversational sentences fall through to the LLM', () => {
        expect(FastPath.match('what do you think about the weather in Rome?')).toBeNull();
        expect(FastPath.match('')).toBeNull();
        expect(FastPath.match(null)).toBeNull();
    });
});

describe('MotionContract', () => {
    test('suffix advertises real clips and live world state', () => {
        const snap = {
            user: { distance_to_avatar_m: 2.34, in_vr: true, hands_tracked: true },
            avatar: { state: 'idle', sitting: true, following: false },
            anchors: [{ type: 'seat' }],
        };
        const s = Contract.systemPromptSuffix(snap, ['wave', 'bow', 'handshake']);
        expect(s).toContain('```motion');
        expect(s).toContain('wave, bow, handshake');
        expect(s).toContain('user_distance_m=2.34');
        expect(s).toContain('user_in_vr=yes');
        expect(s).toContain('avatar_sitting=yes');
        expect(s).toContain('anchors=seat');
        expect(s).toContain('wait_contact');
    });

    test('empty snapshot never throws', () => {
        expect(() => Contract.systemPromptSuffix(null, null)).not.toThrow();
    });
});
