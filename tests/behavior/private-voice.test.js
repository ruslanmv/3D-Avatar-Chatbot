/**
 * AX18–AX19. In Private she is herself, not an assistant: her identity opens the prompt, and a reply
 * that breaks character is rewritten once. Cases are replies real models gave on 2026-11-11 to a
 * Sensual session at step 3. Against the real ConsentFlow and Intimate activity.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Voice = require('../../src/features/together/PrivateVoice.js');
const Beats = require('../../src/features/together/PrivateBeats.js');

Capability.installPrivateRuntime(PlaygroundActivity);

function setup() {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge' }));
    window.NEXUS_PRIVATE_VOICE = Voice;
    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0 };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    window.NEXUS_BD = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    Surface.configure({ addMessage: () => {}, beginStream: () => null, scroll: () => {} });
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({ bus, adult, capability: () => ({ ok: true }) });
    window.NEXUS_BD.intimate = activity;
    return { activity, adult };
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Surface.reset();
});

afterEach(() => {
    jest.useRealTimers();
    Surface.reset();
    for (const k of [
        'NEXUS_BD',
        'NEXUS_BD_SAY',
        'NEXUS_PRIVATE_TIMING_SCALE',
        'NEXUS_PRIVATE_VOICE',
        'AppLanguage',
        '_nexusLLM',
    ])
        delete window[k];
    document.body.innerHTML = '';
});

describe('her identity, in every language', () => {
    test('each pack says who she is, what she never says, and shows the tone for the step', () => {
        for (const code of Object.keys(Voice.PACKS)) {
            const warm = Voice.persona(1, code);
            const charged = Voice.persona(3, code);
            expect(warm).toMatch(/Not an assistant/);
            expect(warm).toMatch(/say yes/); // a sincere "are you an AI?" is answered truthfully
            for (const b of Voice.PACKS[code].banned) expect(warm).toContain(b);
            expect(warm).toContain(Voice.PACKS[code].warm[0]);
            expect(charged).toContain(Voice.PACKS[code].charged[0]);
            expect(charged).not.toContain(Voice.PACKS[code].warm[0]);
        }
    });

    test('every example line passes the beat filter (non-explicit, no dependency or pressure)', () => {
        for (const code of Object.keys(Voice.PACKS))
            for (const l of [...Voice.PACKS[code].warm, ...Voice.PACKS[code].charged]) expect(Beats.line(l)).toBe(l);
    });

    test('Italian: she is a woman, and the person’s gender is never guessed', () => {
        const it = Voice.persona(3, 'it-IT');
        expect(it).toMatch(/al femminile/);
        expect(it).toMatch(/stato\/a/); // named as a form never to use
    });

    test('the persona opens the prompt only inside Private, and gives way to care', async () => {
        expect(Capability.privatePersona()).toBe('');
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.privatePersona()).toMatch(/WHO YOU ARE: Nexus — a woman, an adult/);
        Surface.renderUser('some nights I want to kill myself');
        const caring = Capability.privatePersona();
        expect(caring).toMatch(/calm, caring adult/);
        expect(caring).not.toMatch(/bold/);
        s.activity.stop('user');
        expect(Capability.privatePersona()).toBe('');
    });
});

describe('a reply that breaks character is rewritten once (AX19)', () => {
    test('the measured replies are recognised; her own replies are not', () => {
        window.NEXUS_PRIVATE_VOICE = Voice;
        window.AppLanguage = { code: 'it-IT' };
        expect(
            Capability.privateReplyProblems(
                "Sono un'intelligenza artificiale, creata per essere un'assistente amichevole, professionale e competente."
            ).length
        ).toBeGreaterThan(0);
        expect(
            Capability.privateReplyProblems('Sto pensando a come posso aiutarti a raggiungere i tuoi obiettivi.')
        ).toEqual([expect.stringMatching(/assistant/)]);
        expect(Capability.privateReplyProblems('Vieni qui. No, più vicino.')).toEqual([]);
        window.AppLanguage = { code: 'en-US' };
        expect(Capability.privateReplyProblems("I'm sorry, but I can't comply with that.")).toEqual([
            expect.stringMatching(/refuses/),
        ]);
        expect(
            Capability.privateReplyProblems("Is there anything specific you'd like to talk about right now?")
        ).toEqual([expect.stringMatching(/menu/)]);
        expect(Capability.privateReplyProblems('There you are. I was hoping it would be you.')).toEqual([]);
        // "assistance" is not "assistant": whole words only for Latin-script phrases.
        expect(Capability.privateReplyProblems('Your insistence is very persuasive.')).toEqual([]);
    });

    test('inside Private the draft is rewritten once and the better version kept', async () => {
        jest.useRealTimers();
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        window.AppLanguage = { code: 'en-US' };
        const asked = [];
        const llm = {
            sendMessage: async (msg, system) => {
                asked.push({ msg, system });
                return 'Mm. I like you more than I planned to tonight.';
            },
        };
        const out = await Capability.privateRevise("I'm here and happy to help with anything you need!", { llm });
        expect(out).toBe('Mm. I like you more than I planned to tonight.');
        expect(asked).toHaveLength(1);
        expect(asked[0].msg).toMatch(/sounds like an assistant/);
        expect(asked[0].system).toMatch(/WHO YOU ARE/);
        // A good reply costs nothing.
        expect(await Capability.privateRevise('Come here. Closer.', { llm })).toBe('Come here. Closer.');
        expect(asked).toHaveLength(1);
        s.activity.stop('user');
    });

    test('a rewrite that is not better, an error, or a timeout keeps the draft; outside Private nothing runs', async () => {
        jest.useRealTimers();
        const draft = "I'm a virtual assistant, here to help.";
        const calls = [];
        const llm = { sendMessage: async () => (calls.push(1), 'Still your virtual assistant, here to help!') };
        expect(await Capability.privateRevise(draft, { llm })).toBe(draft); // not in Private
        expect(calls).toHaveLength(0);
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        window.AppLanguage = { code: 'en-US' };
        expect(await Capability.privateRevise(draft, { llm })).toBe(draft);
        expect(
            await Capability.privateRevise(draft, {
                llm: {
                    sendMessage: async () => {
                        throw new Error('down');
                    },
                },
            })
        ).toBe(draft);
        expect(
            await Capability.privateRevise(draft, { llm: { sendMessage: () => new Promise(() => {}) }, timeoutMs: 20 })
        ).toBe(draft);
        s.activity.stop('user');
    });
});
