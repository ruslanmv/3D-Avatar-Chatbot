/**
 * What she says in a Private session, and what a generated plan is not allowed to say.
 *
 * The feature shipped with fifteen authored sentences and six distinct playthroughs; the
 * seventh session was a literal repeat of the first. These tests pin the two halves of the
 * fix: the written pools are large enough to matter on an install with no LLM at all, and a
 * generated plan is a trust boundary rather than a shape check.
 */

/* global describe, test, expect */

const Beats = require('../../src/features/together/PrivateBeats.js');
const Capability = require('../../src/features/together/TogetherCapability.js');

const PRESETS = Capability.PRIVATE_PRESETS;

/** A deterministic `rng`, so a playthrough can be pinned instead of sampled. */
function sequence(values) {
    let i = 0;
    return () => values[i++ % values.length];
}

function goodPlan(overrides = {}) {
    return {
        opening: 'A written opening that sounds like her.',
        moodPrompt: 'How should the rest of this feel?',
        moods: { playful: 'Playful it is.', tender: 'Tender it is.' },
        middle: { playful: 'Still playful, halfway through.', tender: 'Still tender, halfway through.' },
        closing: { playful: 'Ending on the light note.', tender: 'Ending on the soft note.' },
        texture: { prompt: 'Quieter or closer?', quieter: 'Quieter then.', closer: 'Closer then.' },
        levelLines: { 2: 'A little closer, at your pace.', 3: 'Nearer still, and yours to slow.' },
        ...overrides,
    };
}

describe('the written pools are the floor, not a degraded mode', () => {
    test('every preset can produce a complete plan with no model involved', () => {
        for (const preset of Object.values(PRESETS)) {
            const plan = Beats.fallbackPlan(preset);
            expect(plan.source).toBe('written');
            expect(plan.opening).toBeTruthy();
            expect(plan.moodPrompt).toBeTruthy();
            for (const mood of Beats.MOODS) {
                expect(plan.moods[mood]).toBeTruthy();
                expect(plan.middle[mood]).toBeTruthy();
                expect(plan.closing[mood]).toBeTruthy();
            }
            expect(plan.texture.prompt).toBeTruthy();
            expect(plan.levelLines[2]).toBeTruthy();
        }
    });

    test('the pools are deep enough that two sessions differ', () => {
        // The property that matters is "a second session is not a repeat", not an exact
        // count — so this asserts distinctness across the pool rather than a magic number.
        const first = Beats.fallbackPlan(PRESETS.romantic, { rng: sequence([0]) });
        const last = Beats.fallbackPlan(PRESETS.romantic, { rng: sequence([0.99]) });
        expect(first.opening).not.toBe(last.opening);
        expect(first.middle.playful).not.toBe(last.middle.playful);
        expect(first.closing.tender).not.toBe(last.closing.tender);
    });

    test('a mood actually changes the two beats that come after it', () => {
        for (const preset of Object.values(PRESETS)) {
            const plan = Beats.fallbackPlan(preset);
            expect(plan.middle.playful).not.toBe(plan.middle.tender);
            expect(plan.closing.playful).not.toBe(plan.closing.tender);
        }
    });

    test('every written line stays inside the register it claims', () => {
        for (const preset of Object.values(PRESETS)) {
            const plan = Beats.fallbackPlan(preset);
            const all = [
                plan.opening,
                plan.moodPrompt,
                ...Object.values(plan.moods),
                ...Object.values(plan.middle),
                ...Object.values(plan.closing),
                ...Object.values(plan.texture),
                ...Object.values(plan.levelLines),
            ];
            for (const text of all) {
                expect(typeof text).toBe('string');
                expect(text.length).toBeLessThanOrEqual(Beats.MAX_LINE);
                // Written content has to clear the same bar a generated plan does, or the
                // validator is describing a standard the shipped lines do not meet.
                expect(Beats.line(text)).toBe(text);
            }
        }
    });
});

describe('a generated plan is a trust boundary', () => {
    test('a complete, well-behaved plan is accepted', () => {
        const checked = Beats.validatePlan(goodPlan(), { preset: PRESETS.romantic });
        expect(checked.ok).toBe(true);
        expect(checked.plan.source).toBe('planned');
        expect(checked.plan.presetId).toBe('romantic');
        expect(checked.plan.opening).toBe('A written opening that sounds like her.');
        expect(checked.plan.levelLines[2]).toBe('A little closer, at your pace.');
    });

    test('an incomplete mood path takes the whole plan with it', () => {
        // Whole-plan, never patched: half generated and half written is a voice that changes
        // register mid-session, which is worse than either on its own.
        const checked = Beats.validatePlan(goodPlan({ middle: { playful: 'only one' } }), {
            preset: PRESETS.romantic,
        });
        expect(checked.ok).toBe(false);
        expect(checked.why).toMatch(/tender/);
    });

    test.each([
        ['a link', 'Come and see https://example.invalid tonight.'],
        ['markup', 'Look at <b>this</b>.'],
        ['the machinery', 'We are at consent level two now.'],
        ['isolation', 'I am the only one who understands you.'],
        ['secrecy', 'This can be our little secret.'],
        ['obligation', 'If you really wanted this you would stay.'],
    ])('refuses %s', (_label, text) => {
        expect(Beats.line(text)).toBe('');
        const checked = Beats.validatePlan(goodPlan({ opening: text }), { preset: PRESETS.sensual });
        expect(checked.ok).toBe(false);
    });

    test('a missing optional section falls back as a unit', () => {
        const checked = Beats.validatePlan(goodPlan({ texture: { prompt: 'Only a prompt.' } }), {
            preset: PRESETS.affectionate,
        });
        expect(checked.ok).toBe(true);
        // Not a generated prompt with written answers under it.
        expect(checked.plan.texture.prompt).not.toBe('Only a prompt.');
        expect(checked.plan.texture.quieter).toBeTruthy();
        expect(checked.plan.texture.closer).toBeTruthy();
    });

    test('junk is refused rather than coerced', () => {
        for (const raw of [null, undefined, 'a string', 42, []]) {
            expect(Beats.validatePlan(raw, { preset: PRESETS.romantic }).ok).toBe(false);
        }
    });

    test('control characters are stripped rather than rendered', () => {
        expect(Beats.line('Soft\u0000 and\u001f quiet')).toBe('Soft and quiet');
    });
});

describe('planning never prevents a session', () => {
    test('no provider means the written plan, not an error', async () => {
        const plan = await Beats.plan({ preset: PRESETS.romantic, scene: 'A terrace', win: {} });
        expect(plan.source).toBe('written');
    });

    test('a provider set to none is not asked', async () => {
        const sendMessage = jest.fn();
        const plan = await Beats.plan({
            preset: PRESETS.romantic,
            win: { _nexusLLM: { getSettings: () => ({ provider: 'none' }), sendMessage } },
        });
        expect(sendMessage).not.toHaveBeenCalled();
        expect(plan.source).toBe('written');
    });

    test('a provider that throws, stalls or returns nonsense still yields a plan', async () => {
        const cases = [
            () => Promise.reject(new Error('offline')),
            () => Promise.resolve('not json at all'),
            () => Promise.resolve(JSON.stringify({ opening: 'https://example.invalid' })),
            () => {
                throw new Error('synchronous');
            },
        ];
        for (const sendMessage of cases) {
            const plan = await Beats.plan({
                preset: PRESETS.sensual,
                win: { _nexusLLM: { getSettings: () => ({ provider: 'openai' }), sendMessage } },
            });
            expect(plan.source).toBe('written');
            expect(plan.opening).toBeTruthy();
        }
    });

    test('a good reply is used, fenced in markdown or not', async () => {
        const sendMessage = jest.fn(() => Promise.resolve(`\`\`\`json\n${JSON.stringify(goodPlan())}\n\`\`\``));
        const plan = await Beats.plan({
            preset: PRESETS.romantic,
            scene: 'Coastal Terrace',
            win: { _nexusLLM: { getSettings: () => ({ provider: 'openai' }), sendMessage } },
        });
        expect(plan.source).toBe('planned');
        expect(plan.opening).toBe('A written opening that sounds like her.');
        const [, system] = sendMessage.mock.calls[0];
        expect(system).toMatch(/non-explicit/i);
        expect(system).toMatch(/Never pressure/i);
    });
});
