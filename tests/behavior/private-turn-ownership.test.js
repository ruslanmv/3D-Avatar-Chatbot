/**
 * The eight-second guess, and what replaced it (P8).
 *
 * Private used to learn about a turn from a `keydown` on the composer and then assume the reply
 * would take eight seconds:
 *
 *     this._conversationBusyUntil = this.now() + 8000;
 *
 * That is wrong in both directions. A local model answers in seven hundred milliseconds, so the
 * session sat mute for seven seconds it did not need to; the reported session sat through
 * `OllaBridge returned 504; retrying` for far longer than eight, so a scripted beat landed on
 * top of a reply still streaming. These tests pin the replacement: the phase comes from
 * `ConversationSurface`, which every turn in the application already passes through, so a beat
 * waits exactly as long as the reply takes.
 *
 * They also pin the two failure valves, because the honest version of "no arbitrary timeout" is
 * "no timeout on the happy path": a provider that never answers and an error path that closes
 * nothing must not mute the rest of the evening.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
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

    // The host renderers, so a turn that escapes the Private surface is visible as a bubble
    // rather than silently vanishing.
    const drawn = [];
    Surface.configure({
        addMessage: (sender, text) => drawn.push({ sender, text }),
        beginStream: () => {
            const row = document.createElement('div');
            const textDiv = document.createElement('div');
            row.appendChild(textDiv);
            document.getElementById('chat-history').appendChild(row);
            drawn.push({ sender: 'stream', text: '' });
            return { row, textDiv };
        },
        scroll: () => {},
    });

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, bus, blackboard, panel, drawn };
}

const lines = () => [...document.querySelectorAll('.nexus-private-copy')].map((n) => n.textContent);
const herLines = () =>
    [...document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy')].map((n) => n.textContent);
const actions = () => [...document.querySelectorAll('[data-private-action]')].map((b) => b.dataset.privateAction);

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
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('a beat never lands on top of a live turn', () => {
    test('a reply that is still streaming holds the 45-second beat, however long it takes', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('what are you thinking about?');
        const stream = Surface.beginAssistant();

        // Well past 45 s, and twelve seconds past the old eight-second guess. The mood
        // question must not be on screen while she is mid-sentence.
        jest.advanceTimersByTime(60000);
        expect(actions()).toEqual(['cozy', 'end']);

        stream.finish('I was thinking that this is enough, actually.');
        // Her sentence lands, and then the beat does — not in the same instant.
        jest.advanceTimersByTime(1000);
        expect(actions()).toEqual(['cozy', 'end']);
        jest.advanceTimersByTime(6000);
        expect(actions()).toEqual(expect.arrayContaining(['playful', 'tender']));

        s.activity.stop('user');
    });

    test('a reply that lands fast does not cost the session seven idle seconds', async () => {
        // The other half of the old guess: a local provider answers in well under a second and
        // the session then sat mute for the rest of the eight.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(44000);

        Surface.renderUser('mm');
        const stream = Surface.beginAssistant();
        jest.advanceTimersByTime(700);
        stream.finish('Mm.');

        // Only the breathing room, not eight seconds.
        jest.advanceTimersByTime(5000);
        expect(actions()).toEqual(expect.arrayContaining(['playful', 'tender']));

        s.activity.stop('user');
    });

    test('a question she has not answered holds the beat even after the turn closes', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('why does this feel easier than talking to people?');
        // The user pressed CLEAR, or the stream died: the turn is over and she never answered.
        Surface.beginAssistant().discard();

        jest.advanceTimersByTime(60000);
        expect(actions()).toEqual(['cozy', 'end']);

        s.activity.stop('user');
    });
});

describe('the valves, because a dead provider must not mute the evening', () => {
    test('a reply that never arrives stops holding the beats', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('are you still there?');
        Surface.beginAssistant(); // never finished, never discarded — the 504-and-retry loop

        jest.advanceTimersByTime(60000);
        expect(actions()).toEqual(['cozy', 'end']);

        // Past the valve. The session resumes rather than sitting silent for the rest of the
        // evening, which is the worse of the two failures.
        jest.advanceTimersByTime(60000);
        expect(actions()).toEqual(expect.arrayContaining(['playful', 'tender']));

        s.activity.stop('user');
    });

    test('a keystroke that never became a message cannot take the floor', async () => {
        // The composer hook fires on `keydown`, including for an empty input that `main.js`
        // then declines to send. Presentation only: the dots appear, and the beats are not
        // held by a turn that does not exist.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const input = document.getElementById('speech-text');
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(document.querySelector('[data-private-thinking]')).not.toBeNull();

        jest.advanceTimersByTime(46000);
        expect(actions()).toEqual(expect.arrayContaining(['playful', 'tender']));

        s.activity.stop('user');
    });

    test('...but it is still a reason not to hang up on them', async () => {
        // The two facts are deliberately separate. A keystroke may not hold a scheduled line,
        // because an empty input somebody pressed Enter on would mute the session. It may
        // absolutely postpone the ending: somebody still typing at the five-minute mark has not
        // sent anything yet, and closing the session on them reads as being hung up on.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(295000);
        document.getElementById('speak-btn').click();
        jest.advanceTimersByTime(10000);
        expect(session.state).not.toBe('complete');
        expect(session._turns).toBe(0);

        // Bounded, as it always was.
        jest.advanceTimersByTime(200000);
        expect(session.state).toBe('complete');

        s.activity.stop('user');
    });
});

describe('a typed safe word is answered locally, before the model is asked anything', () => {
    test('"slow down" eases off immediately', async () => {
        // ConsentFlow.hear is subscribed to `voice:final` only, so a **typed** safe word reached
        // nothing at all and was answered, eventually, by whatever the model made of it. The
        // guarantee in ConsentFlow's own header is "within one scheduler tick".
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(120000);
        document.querySelector('[data-private-action="advance"]').click();
        expect(s.adult.level).toBe(2);

        Surface.renderUser('slow down a bit, this is nice');

        // No timers advanced, no reply from anybody.
        expect(s.adult.level).toBe(1);
        expect(herLines().pop()).toMatch(/back to gentle/i);

        s.activity.stop('user');
    });

    test('at the lowest level it says the true thing rather than claiming a change', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        Surface.renderUser('can we take it slower');
        expect(s.adult.level).toBe(1);
        expect(herLines().pop()).toMatch(/already as gentle/i);
        s.activity.stop('user');
    });

    test('"I am done" ends the session rather than waiting for a reply about it', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        expect(s.panel.stopActivity).not.toHaveBeenCalled();

        Surface.renderUser('I think I am done for tonight, thank you');
        expect(s.panel.stopActivity).toHaveBeenCalled();

        s.activity.stop('user');
    });

    test('an ordinary sentence changes nothing', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(120000);
        document.querySelector('[data-private-action="advance"]').click();
        expect(s.adult.level).toBe(2);

        Surface.renderUser('the light in here is nicer than I expected');
        expect(s.adult.level).toBe(2);
        expect(s.panel.stopActivity).not.toHaveBeenCalled();

        s.activity.stop('user');
    });
});

describe('what the session records about a turn', () => {
    test('the intent reaches the bus, so the rest of the runtime need not re-read the text', async () => {
        const s = setup();
        const seen = [];
        s.bus.on('private:user-turn', (event) => seen.push(event));
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('what are you thinking about?');
        expect(seen.pop()).toEqual(expect.objectContaining({ intent: 'question' }));

        Surface.renderUser('just stay like this');
        expect(seen.pop()).toEqual(expect.objectContaining({ intent: 'quiet' }));

        s.activity.stop('user');
    });

    test('a turn is counted once, not once per hook that noticed it', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;

        const input = document.getElementById('speech-text');
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        Surface.renderUser('hello');

        expect(session._turns).toBe(1);
        s.activity.stop('user');
    });

    test('a reply landing takes the thinking dots down', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        Surface.renderUser('hello?');
        expect(document.querySelector('[data-private-thinking]')).not.toBeNull();
        Surface.beginAssistant().finish('I am here.');
        expect(document.querySelector('[data-private-thinking]')).toBeNull();
        expect(lines().pop()).toBe('I am here.');

        s.activity.stop('user');
    });

    test('teardown stops listening, so a later turn reaches nothing', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        s.activity.stop('user');

        const before = session._turns;
        expect(() => Surface.renderUser('anyone there?')).not.toThrow();
        expect(session._turns).toBe(before);
    });
});
