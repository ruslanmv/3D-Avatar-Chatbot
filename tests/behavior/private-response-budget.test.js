/**
 * How long her answer is worth, and the prompt that makes her finish inside it (P9).
 *
 * Every provider path asked for a fixed ceiling — 500, 800, 1024 — chosen once for the longest
 * thing the model might reasonably be asked. In an intimate conversation that is the wrong number
 * for almost every turn: eight hundred tokens for `So` is a hundred and fifty words nobody wanted
 * and several seconds of waiting for them, which is most of why Private read as slow rather than
 * as somebody being present with you.
 *
 * Two halves, and each is useless alone. `max_tokens` is a rule and it truncates, so on its own it
 * cuts a sentence in half; the prompt is a request and a model that ignores it hits the rule. The
 * tests pin both, plus the property that matters more than either: **nothing changes for a request
 * outside a Private session.**
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Director = require('../../src/features/together/PrivateTurnDirector.js');
const Choices = require('../../src/features/together/PrivateChoices.js');

/**
 * Room for the `<choices>` block, which rides back inside the reply rather than costing a second
 * request (P13). The turn budget is what she may spend on *words*; this is what the buttons cost.
 */
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

// Read from the module, never copied. A local `48` here is what let the P19 budget correction
// break four tests that were only ever asserting arithmetic about somebody else's constant.
const CHOICE_TOKENS = Capability.CHOICE_TOKENS;

Capability.installPrivateRuntime(PlaygroundActivity);

function setup() {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0, scene: null };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    const director = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD = director;
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
    Surface.configure({ addMessage: () => {}, beginStream: () => null, scroll: () => {} });

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, bus, panel };
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Surface.reset();
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    Surface.reset();
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    delete window.NEXUS_TOGETHER_SWITCH;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('no Private session, no change', () => {
    test('there is no budget and no overlay when nothing is running', () => {
        expect(Capability.responseBudget()).toBeNull();
        expect(Capability.experienceOverlay()).toBe('');
    });

    test('a finished session stops asking for a short reply', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('mm');
        expect(Capability.responseBudget()).toBeGreaterThan(0);

        s.activity.stop('user');
        expect(Capability.responseBudget()).toBeNull();
    });
});

describe('the budget answers what was actually said', () => {
    test('a two-word remark does not earn eight hundred tokens', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('mm, nice');
        expect(Capability.responseBudget()).toBeLessThanOrEqual(Director.MIN + CHOICE_TOKENS);

        s.activity.stop('user');
    });

    test('a real question earns a real answer', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('why do you think the quiet ones are the good evenings and the loud ones are not?');
        expect(Capability.responseBudget()).toBe(Director.BUDGET.question + CHOICE_TOKENS);

        s.activity.stop('user');
    });

    test('before anybody has said anything it is the ordinary-conversation budget', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.responseBudget()).toBe(Director.BUDGET.conversation + CHOICE_TOKENS);
        s.activity.stop('user');
    });
});

describe('the prompt says the same thing the budget enforces', () => {
    test('a short turn asks for a short reply in words, not only in tokens', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('mm');
        const prompt = Capability.privateSystemPromptSuffix();
        expect(prompt).toMatch(/said very little/i);
        expect(prompt).toMatch(/one short sentence/i);

        s.activity.stop('user');
    });

    test('she is told not to end every reply with a question', async () => {
        // The default behaviour of every assistant is to end on one, and a companion who answers
        // every remark with a question is conducting an interview.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        expect(Capability.privateSystemPromptSuffix()).toMatch(/not end every reply with a question/i);
        s.activity.stop('user');
    });

    test('asking for quiet changes the register, invisibly', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('can we just stay like this for a bit');
        expect(s.activity._privateExperience.style).toBe('quiet');
        expect(Capability.privateSystemPromptSuffix()).toMatch(/present rather than talkative/i);

        s.activity.stop('user');
    });

    test('the safety paragraph is still all there', async () => {
        // The length lines are an addition, not a replacement. Losing one of these to a reorder
        // would be the most expensive possible regression in this file.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const prompt = Capability.privateSystemPromptSuffix();
        for (const rule of [/non-explicit/i, /do not infer consent/i, /say stop or exit/i, /preset ceiling/i]) {
            expect(prompt).toMatch(rule);
        }
        s.activity.stop('user');
    });
});

describe('the block is headroom, not a licence to write more (P13)', () => {
    test('the words budget is still the words budget', async () => {
        // A budget that did not allow for the block would truncate it — leaving a dangling
        // `<choices>` and no buttons, which is the worst of both. A budget that allowed for it
        // twice would undo P9.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('mm');
        const tiny = Capability.responseBudget();
        Surface.renderUser('why do you think the quiet ones are the good evenings?');
        const asked = Capability.responseBudget();

        expect(asked - tiny).toBe(Director.BUDGET.question - Director.MIN);
        expect(tiny - CHOICE_TOKENS).toBeLessThanOrEqual(Director.MIN);
        // And the floor holds even for the shortest possible turn, which is the P19 invariant:
        // a cap the model reaches before its first visible token is an empty reply.
        expect(tiny - CHOICE_TOKENS).toBeGreaterThanOrEqual(Director.MIN);

        s.activity.stop('user');
    });

    test('she is told how to write the block, and where', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const prompt = Capability.privateSystemPromptSuffix();
        expect(prompt).toContain(Choices.OPEN);
        expect(prompt).toContain(Choices.CLOSE);
        expect(prompt).toMatch(/never write a choice that asks you to be more intense/i);
        expect(prompt).toMatch(/not spoken and never appears on screen/i);
        s.activity.stop('user');
    });

    test('the block is taken out of the reply, and becomes buttons', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        const raw = [
            'I like it when it is this quiet.',
            Choices.OPEN,
            'Me too.',
            'Say something anyway.',
            Choices.CLOSE,
        ].join('\n');

        // Two steps, and the order is the point: the sanitiser reads the block at the `displayText`
        // seam, which on the non-streaming path is before the reply's turn exists. The buttons go up
        // when there is a turn to put them under. See `private-dialogue-choices.test.js`.
        const stream = Surface.beginAssistant();
        const shown = Capability.sanitizeReply(raw);
        stream.finish(shown);

        expect(shown).toBe('I like it when it is this quiet.');
        expect([...document.querySelectorAll('[data-private-choice]')].map((b) => b.textContent)).toEqual([
            'Me too.',
            'Say something anyway.',
        ]);

        s.activity.stop('user');
    });

    test('outside a Private session the block is left alone', () => {
        // The same gate as the stage-direction sanitiser: nothing outside Private moves.
        const reply = `Sure.\n${Choices.OPEN}\nOne\nTwo\n${Choices.CLOSE}`;
        expect(Capability.sanitizeReply(reply)).toBe(reply);
    });
});

describe('stage directions, and the gate on the sanitiser (P14)', () => {
    test('outside a Private session nothing is touched', () => {
        // `*smiles*` in ordinary chat may be exactly what somebody wants — a roleplay in normal
        // conversation is theirs to write however they like.
        const text = '*she smiles softly* I am glad you said so.';
        expect(Capability.sanitizeReply(text)).toBe(text);
    });

    test('inside one, the marker comes out of the line', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        expect(Capability.sanitizeReply('[smile] I like it when the room is this quiet.')).toBe(
            'I like it when the room is this quiet.'
        );

        s.activity.stop('user');
    });

    test('the marker becomes a movement instead of text', async () => {
        const s = setup();
        const intents = [];
        s.bus.on('intent', (intent) => intents.push(intent));
        await s.activity.start({ input: { id: 'sensual' } });

        const before = intents.length;
        Capability.sanitizeReply('[smiles] Mm. [nods] I think so too.');
        // One per reply, not one per marker: three intents in a tick would make her twitch.
        expect(intents.length).toBe(before + 1);
        expect(intents[intents.length - 1]).toEqual(expect.objectContaining({ name: 'smile_soft', source: 'private' }));

        s.activity.stop('user');
    });

    test('a reply that was nothing but a direction is kept, not emptied', async () => {
        // A turn with nothing in it reads as a failure, which is worse than a marker on screen.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.sanitizeReply('[smile]')).toBe('[smile]');
        s.activity.stop('user');
    });

    test('she is told not to write them in the first place', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.privateSystemPromptSuffix()).toMatch(/no stage directions/i);
        s.activity.stop('user');
    });
});

describe('the pace state reaches the model, explicitly (P11/P12)', () => {
    test('nothing is added before anybody asks', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/asked to slow down/i);
        s.activity.stop('user');
    });

    test('after the control, the state is stated rather than inferred from an absence', async () => {
        // The ten-turn window (P10) already stops old context pulling her back past a Slow down
        // implicitly. A model that can only infer the request from what is missing will eventually
        // infer wrong.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        // At Warm there is no easing control — nothing to ease — so the typed word is the route.
        s.activity._privateExperience._softenAllTheWay();

        const prompt = Capability.privateSystemPromptSuffix();
        expect(prompt).toMatch(/asked to slow down/i);
        expect(prompt).toMatch(/do not propose, hint at, or ask about anything more intense/i);
        expect(prompt).toMatch(/do not mention their request again/i);
        expect(prompt).toMatch(/only a clear, explicit request from them changes it/i);

        s.activity.stop('user');
    });

    test('it does not lapse because the conversation warmed up again', async () => {
        // The rule that matters most: warmth is not permission. Only an explicit request leaves
        // this state, and time passing is not one.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        s.activity._privateExperience._softenAllTheWay();

        Surface.renderUser('you are lovely, you know');
        Surface.renderUser('what were you going to say before?');
        jest.advanceTimersByTime(400000);

        expect(Capability.privateSystemPromptSuffix()).toMatch(/asked to slow down/i);
        s.activity.stop('user');
    });

    test('the reply budget follows the quieter register', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        s.activity._privateExperience._softenAllTheWay();
        Surface.renderUser('mm');
        expect(Capability.responseBudget()).toBeLessThanOrEqual(Director.MIN + CHOICE_TOKENS);
        expect(Capability.privateSystemPromptSuffix()).toMatch(/present rather than talkative/i);
        s.activity.stop('user');
    });
});

describe('a remote persona is no longer sent a Private session with no rules', () => {
    test('the overlay carries the safety paragraph', async () => {
        // `_chatOllaBridge` sends no system prompt at all for a remote persona — correctly, since
        // the gateway supplies the persona's own. That also dropped everything the app appends,
        // and the app appends the safety half of Private. Silently.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        const overlay = Capability.experienceOverlay();
        expect(overlay).toMatch(/ACTIVE PRIVATE EXPERIENCE/);
        expect(overlay).toMatch(/do not infer consent/i);
        expect(overlay).toMatch(/say stop or exit/i);

        s.activity.stop('user');
    });

    test('it is empty the rest of the time, so ordinary persona chat is untouched', () => {
        expect(Capability.experienceOverlay()).toBe('');
    });
});
