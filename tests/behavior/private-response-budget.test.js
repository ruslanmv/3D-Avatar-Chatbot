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
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

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
        expect(Capability.responseBudget()).toBeLessThanOrEqual(48);

        s.activity.stop('user');
    });

    test('a real question earns a real answer', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('why do you think the quiet ones are the good evenings and the loud ones are not?');
        expect(Capability.responseBudget()).toBe(Director.BUDGET.question);

        s.activity.stop('user');
    });

    test('before anybody has said anything it is the ordinary-conversation budget', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.responseBudget()).toBe(Director.BUDGET.conversation);
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
