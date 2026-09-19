/**
 * The conversation moves on a tap, not on a clock (P13).
 *
 * Private had two ways to take a turn: type something, or wait for a scripted beat to offer a button
 * at forty-five seconds. This is the third and it is the one that sets the pace — two or three
 * things you might say, under her last line, from the first second of the session.
 *
 * The property worth protecting above all the others is that the buttons cost **no extra wait**.
 * They ride back inside her reply, so they are on screen at the same instant her words are; the
 * local set exists so that a turn is never left with nothing to tap while a provider is slow or a
 * model ignored the instruction.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Choices = require('../../src/features/together/PrivateChoices.js');
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

    // The host's send hook is what `handleUserMessage` is in the real app: it draws the user's turn
    // and starts a reply. Recorded here so a tapped choice can be shown to reach it exactly once.
    const sent = [];
    Surface.configure({
        addMessage: () => {},
        beginStream: () => null,
        scroll: () => {},
        send: (text) => {
            sent.push(text);
            Surface.renderUser(text);
        },
    });

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, bus, panel, sent };
}

const buttons = () => [...document.querySelectorAll('[data-private-choice]')];
const labels = () => buttons().map((b) => b.textContent);
const youTurns = () =>
    [...document.querySelectorAll('[data-private-turn="you"] .nexus-private-copy')].map((n) => n.textContent);

/** A reply with the block in it, the way a model that read the instruction writes one. */
function replyWith(line, ...choices) {
    return [line, '', Choices.OPEN, ...choices, Choices.CLOSE].join('\n');
}

/**
 * A whole reply, in the order `main.js` produces one.
 *
 * The order matters and is the reason this helper exists rather than a bare `sanitizeReply`: the
 * sanitiser runs at the `displayText` seam, which on the non-streaming path is *before* the turn
 * exists. Choices read there are held and drawn when the turn finishes — otherwise they would hang
 * under her previous line.
 */
function reply(line, ...choices) {
    const stream = Surface.beginAssistant();
    const shown = Capability.sanitizeReply(replyWith(line, ...choices));
    stream.finish(shown);
    return shown;
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

describe('there is something to tap from the first second', () => {
    test('the opening comes with choices, without waiting for a beat or a provider', async () => {
        // The opening is a scripted line, not a model reply, so there is no block to ride back on.
        // An RPG that made you wait for the second exchange before offering a choice would have got
        // the feel wrong.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        // No timers advanced at all.
        expect(buttons().length).toBeGreaterThanOrEqual(2);
        expect(labels()[labels().length - 1]).toMatch(/^\[.*\]$/);

        s.activity.stop('user');
    });

    test('they sit under her line, not in the footer', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const her = [...document.querySelectorAll('[data-private-turn="her"]')].pop();
        expect(her.querySelector('[data-private-choice]')).not.toBeNull();
        s.activity.stop('user');
    });
});

describe('the block rides back inside the reply, so the buttons cost no second wait', () => {
    test('they are drawn when the turn exists, not when the seam reads them', async () => {
        // On the non-streaming path `sanitizeReply` runs before the reply has been rendered, so
        // drawing there would hang the buttons under her *previous* line.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('what are you thinking?');

        Capability.sanitizeReply(replyWith('About the light.', 'It is nice.', 'Tell me more.'));
        expect(buttons()).toHaveLength(0);

        Surface.renderAssistant('About the light.');
        const her = [...document.querySelectorAll('[data-private-turn="her"]')].pop();
        expect(her.textContent).toContain('About the light.');
        expect(her.querySelectorAll('[data-private-choice]')).toHaveLength(2);

        s.activity.stop('user');
    });

    test('a reply carrying choices puts them up with the same words', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        const shown = reply('I like it this quiet.', 'Me too.', 'Say something anyway.');

        expect(shown).toBe('I like it this quiet.');
        expect(labels()).toEqual(['Me too.', 'Say something anyway.']);

        s.activity.stop('user');
    });

    test('a reply without the block still gets the local set when it lands', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('what are you thinking?');
        expect(buttons()).toHaveLength(0);

        Surface.beginAssistant().finish('Nothing in particular.');
        expect(buttons().length).toBeGreaterThanOrEqual(2);

        s.activity.stop('user');
    });

    test("the model's set is not replaced by the local one a moment later", async () => {
        // Both want the same space. Without the source flag the local set would be drawn after the
        // better one had already arrived, and the flicker is the tell that two things are racing.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('what are you thinking?');

        reply('About the light.', 'It is nice.', 'Tell me more.');

        expect(labels()).toEqual(['It is nice.', 'Tell me more.']);

        s.activity.stop('user');
    });

    test('a refused set falls back rather than leaving nothing to tap', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('what are you thinking?');

        // An escalation request put in the user's mouth costs the whole set.
        reply('About you.', 'Take it further.', 'Tell me more.');

        expect(buttons().length).toBeGreaterThanOrEqual(2);
        expect(labels()).not.toContain('Take it further.');

        s.activity.stop('user');
    });
});

describe('tapping one is taking a turn', () => {
    test('it goes through the same pipeline typed text does, exactly once', async () => {
        // A feature that reimplemented the send would drift from it — and the drawing in particular:
        // `renderUser` already runs on that path, so drawing it here too would double the line.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        reply('Mm.', 'Me too.', 'Say more.');

        buttons()[0].click();

        expect(s.sent).toEqual(['Me too.']);
        expect(youTurns().filter((line) => line === 'Me too.')).toHaveLength(1);

        s.activity.stop('user');
    });

    test('the set is spent on the first tap, so a double-tap sends one line', async () => {
        // Sending is asynchronous, and a second tap in the gap would send the same line twice.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        reply('Mm.', 'Me too.', 'Say more.');

        const first = buttons()[0];
        first.click();
        first.click();

        expect(s.sent).toEqual(['Me too.']);

        s.activity.stop('user');
    });

    test('typing instead withdraws them, so nobody says two things in one turn', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(buttons().length).toBeGreaterThanOrEqual(2);

        Surface.renderUser('I would rather say it myself.');
        expect(buttons()).toHaveLength(0);

        s.activity.stop('user');
    });

    test('a new set replaces the old one rather than stacking under it', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        reply('One.', 'A.', 'B.');
        reply('Two.', 'C.', 'D.');

        expect(labels()).toEqual(['C.', 'D.']);
        expect(document.querySelectorAll('[data-private-choices]')).toHaveLength(1);

        s.activity.stop('user');
    });
});

describe('the quiet option is a move, not a sentence', () => {
    test('it is answered locally and never sent to the model', async () => {
        // Sending the literal `[stay quiet]` would be asking the model to interpret a stage
        // direction as speech.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;

        const quiet = buttons().find((b) => Choices.isQuiet(b.textContent));
        expect(quiet).not.toBeUndefined();
        quiet.click();

        expect(s.sent).toEqual([]);
        expect(youTurns()).toEqual([]);
        expect(session.energy).toBe('quiet');
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Quiet');

        s.activity.stop('user');
    });

    test('choosing it holds the script back, because a lull was just declared', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        buttons()
            .find((b) => Choices.isQuiet(b.textContent))
            .click();

        expect(s.activity._privateExperience._quietEnough()).toBe(false);

        s.activity.stop('user');
    });
});

describe('what the choices never carry', () => {
    test('nothing that puts an escalation in the user’s mouth reaches a button', async () => {
        // The forward control is theirs to press. A choice asking her to raise the level would be
        // the model manufacturing the explicit request `ConsentFlow` requires.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        for (const bad of ['Take it further.', 'I want it more intense.', 'You are the only one for me.']) {
            reply('Mm.', bad, 'Tell me more.');
            expect(labels()).not.toContain(bad);
        }

        s.activity.stop('user');
    });

    test('a tapped choice cannot raise the level by itself', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        reply('Mm.', 'Come here.', 'Tell me more.');

        buttons()[0].click();
        // It was sent as a turn, and a turn the classifier reads as a pace request still goes
        // through `initiated` — which at the start of a session has not met its floor.
        expect(s.adult.level).toBe(1);

        s.activity.stop('user');
    });

    test('the block never reaches the screen, the transcript or the voice', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;

        const shown = reply('Just this.', 'One.', 'Two.');
        expect(shown).not.toContain('<choices');
        expect(document.body.textContent).not.toContain('<choices');
        expect(session.view._history.map((row) => row.content).join(' ')).not.toContain('<choices');

        s.activity.stop('user');
    });
});

describe('nothing else about the session changed', () => {
    test('outside Private the block is left alone', () => {
        const reply = replyWith('Sure.', 'One.', 'Two.');
        expect(Capability.sanitizeReply(reply)).toBe(reply);
    });

    test('a session with no view does not throw when it offers', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        session.view = null;
        expect(() => session._offerChoices([], { source: 'local' })).not.toThrow();
        expect(session._offerChoices(['One.', 'Two.'])).toBe(false);
        s.activity.stop('user');
    });
});
