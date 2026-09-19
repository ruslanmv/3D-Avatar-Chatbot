/**
 * The silence clock inside a running session (P17).
 *
 * `private-idle-clock.test.js` covers the arithmetic. This covers the half that is actually risky:
 * the busy predicate. Every entry in it is somebody mid-turn, and a nudge over the top of any of
 * them is worse than no nudge at all — she would be interrupting her own voice, or answering a
 * sentence still being typed.
 *
 * And the rule the whole design is arranged around: **silence is not consent**. A companion who
 * gets closer because you stopped typing is the failure this feature could most easily become, so
 * it is pinned here rather than trusted to a comment.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const IdleClock = require('../../src/features/together/PrivateIdleClock.js');
const PrivateChoices = require('../../src/features/together/PrivateChoices.js');

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
    /**
     * `send` is `handleUserMessage` in the real app, and it is the hook that was missing.
     *
     * Not a stub that only records: it draws the user's turn and then a reply, the way the host
     * does, because the reported defect was a tap that produced no answer and a recorder alone
     * cannot tell a dropped send from one that sent and never came back.
     */
    const sent = [];
    Surface.configure({
        addMessage: () => {},
        beginStream: () => null,
        scroll: () => {},
        send: (text) => {
            sent.push(text);
            Surface.renderUser(text);
            Surface.renderAssistant(`about "${text}" — yes.`);
        },
    });
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, blackboard, bus, sent };
}

const herLines = () =>
    [...document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy')].map((n) => n.textContent);
const choices = () => [...document.querySelectorAll('[data-private-choice]')].map((b) => b.textContent);

/** Wind the clock forward without letting the beats run — a tab nobody was looking at. */
function quietFor(ms) {
    jest.setSystemTime(new Date(Date.now() + ms));
}

/**
 * Retire the authored beats, which are not what these tests are about.
 *
 * They win a tick the silence clock would otherwise take — deliberately: "what kind of mood should
 * we keep?" is the evening's one real branch and a generic noticing line is not. Interleaving the
 * two is real behaviour and is covered where it belongs, under *one unanswered question at a time*.
 * Here it would only make every assertion depend on the arc's timings. Marking them done leaves the
 * state this file is about: nothing scheduled, nothing owed, nobody talking.
 */
function scriptDone(session) {
    for (const beat of session._beats) beat.done = true;
    session._noteLive();
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
    delete window.companionMode;
    delete window.SpeechService;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('she notices a silence, and then stops', () => {
    test('a minute of nothing produces one line, and it is not a system notice', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        const before = herLines().length;

        quietFor(65000);
        session._tick();

        const spoken = herLines().slice(before);
        expect(spoken.length).toBe(1);
        // The one failure mode worth a dedicated test: "are you still there?" is correct, harmless,
        // and it ends the scene.
        expect(IdleClock.usable(spoken[0])).toBe(spoken[0]);
        expect(spoken[0]).not.toMatch(/are you (still )?there/i);

        s.activity.stop('user');
    });

    test('and a minute after that, buttons instead of another line', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        quietFor(65000);
        session._tick();
        const afterNudge = herLines().length;

        quietFor(65000);
        session._tick();

        // No model call, and nothing new said — the person who has been quiet for two minutes is
        // the last one who should be asked to wait for a provider.
        expect(herLines().length).toBe(afterNudge);
        expect(choices()).toEqual(PrivateChoices.idle());

        s.activity.stop('user');
    });

    test('then nothing, however long it goes on', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        for (let i = 0; i < 3; i += 1) {
            quietFor(65000);
            session._tick();
        }
        const settled = herLines().length;

        for (let i = 0; i < 10; i += 1) {
            quietFor(120000);
            session._tick();
        }
        expect(herLines().length).toBe(settled);
        expect(session._idle.stage).toBe(IdleClock.LAST_STAGE);

        s.activity.stop('user');
    });

    test('a line the person sends puts it back to nothing', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        quietFor(65000);
        session._tick();
        expect(session._idle.stage).toBe(1);

        Surface.renderUser('still here');
        expect(session._idle.stage).toBe(0);

        s.activity.stop('user');
    });
});

describe('the busy predicate, which is the whole of the risk', () => {
    test('a reply still streaming is not a silence', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        Surface.renderUser('tell me something');
        Surface.beginAssistant();
        const before = herLines().length;

        quietFor(65000);
        session._tick();

        expect(herLines().length).toBe(before);
        expect(session._idle.stage).toBe(0);

        s.activity.stop('user');
    });

    test('nor is her voice still playing — through the companion, not speechSynthesis', async () => {
        // Piper plays through WebAudio and is invisible to `speechSynthesis.speaking`, so a naive
        // check reads a reply still being spoken as finished. Interrupting herself mid-sentence to
        // remark on the silence is the worst possible version of this feature.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        let speaking = true;
        window.companionMode = { _replyAudioBusy: () => speaking };
        const before = herLines().length;

        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before);

        speaking = false;
        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before + 1);

        s.activity.stop('user');
    });

    test('nor a half-typed line nobody has sent', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        document.getElementById('speech-text').value = 'I was going to say';
        const before = herLines().length;

        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before);

        document.getElementById('speech-text').value = '';
        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before + 1);

        s.activity.stop('user');
    });

    test('nor a live microphone', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        window.SpeechService = { isRecognizing: true };
        const before = herLines().length;

        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before);

        s.activity.stop('user');
    });

    test('a busy check that throws does not mute the clock for the rest of the evening', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        window.companionMode = {
            _replyAudioBusy() {
                throw new Error('the engine went away');
            },
        };
        const before = herLines().length;

        quietFor(65000);
        session._tick();
        expect(herLines().length).toBe(before + 1);

        s.activity.stop('user');
    });
});

describe('the timer advances liveness, never intimacy', () => {
    test('ten minutes of silence changes no level, and asks for none', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        scriptDone(session);
        const initiated = jest.spyOn(s.adult, 'initiated');
        const checkIn = jest.spyOn(s.adult, 'checkIn');
        // What the session opened at, not zero: entering Private starts at level 1, which is the
        // preset's floor rather than an escalation.
        const opened = s.blackboard.escalationLevel;

        for (let i = 0; i < 10; i += 1) {
            quietFor(65000);
            session._tick();
        }

        expect(s.adult.level).toBe(1);
        expect(s.blackboard.escalationLevel).toBe(opened);
        expect(initiated).not.toHaveBeenCalled();
        expect(checkIn).not.toHaveBeenCalled();
        expect(session.energy).not.toBe('playful');

        s.activity.stop('user');
    });

    test('and the buttons it offers put no escalation in anybody’s mouth', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        quietFor(65000);
        session._tick();
        quietFor(65000);
        session._tick();

        const offered = choices();
        expect(offered).toEqual(PrivateChoices.idle());
        for (const line of offered) {
            expect(line.toLowerCase()).not.toMatch(/closer|more|further|intense/);
        }

        s.activity.stop('user');
    });
});

describe('one unanswered question at a time', () => {
    test('a question that got silence is taken back rather than followed by another', async () => {
        // `PrivateNovelty`'s ignored-question rule stops the script asking a second thing. This is
        // the other half: three questions in three minutes is an interrogation.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        // Let the 45-second mood beat put its question and its buttons up.
        jest.advanceTimersByTime(60000);
        expect(document.querySelectorAll('[data-private-action="playful"]').length).toBe(1);

        quietFor(65000);
        session._tick();

        const last = herLines().pop();
        expect(IdleClock.RELEASING).toContain(last);
        // And the offer on screen has stopped being an offer.
        expect(document.querySelector('.nexus-private-actions:not([data-spent])')).toBeNull();

        s.activity.stop('user');
    });
});

describe('teardown', () => {
    test('a stopped session has no clock left to tick', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        s.activity.stop('user');

        expect(session._idle).toBeNull();
        const before = herLines().length;
        quietFor(600000);
        session._tick();
        expect(herLines().length).toBe(before);
    });
});

describe('the closed vocabulary, which has now swallowed three batches of events', () => {
    test('every private event the capability emits is one the bus will carry', () => {
        // `private:session-start` and three others were emitted for several batches and heard by
        // nothing, because the vocabulary is closed and an unknown name is dropped with a warning
        // only `debug` shows. Adding `private:intensity` (P12) and `private:choices` (P13) made the
        // same omission twice more. A grep is a blunt test and it is the one that would have caught
        // all six.
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.join(__dirname, '../../src/features/together/TogetherCapability.js'),
            'utf8'
        );
        const emitted = [...source.matchAll(/_emit\('(private:[a-z-]+)'/g)].map((m) => m[1]);
        expect(emitted.length).toBeGreaterThan(0);
        const unknown = emitted.filter((name) => !EventBus.EVENTS.includes(name));
        expect(unknown).toEqual([]);
    });
});

describe('the button the clock puts up is wired to an answer', () => {
    test('tapping an idle choice sends it and she replies', async () => {
        // The reported defect, end to end: "I clicked and did not receive the answer." The button,
        // the handler and the send were all correct; `ConversationSurface.configure` had never run,
        // so `send` read `host.send` on an empty host and returned false. See
        // `conversation-surface-boot-order.test.js` for the cause.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        scriptDone(session);

        quietFor(65000);
        session._tick();
        quietFor(65000);
        session._tick();

        const buttons = [...document.querySelectorAll('[data-private-choice]')];
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        const chosen = buttons[0].textContent;
        buttons[0].click();

        // It went out as their turn…
        expect(s.sent).toEqual([chosen]);
        expect(
            [...document.querySelectorAll('[data-private-turn="you"] .nexus-private-copy')].map((n) => n.textContent)
        ).toContain(chosen);
        // …and an answer came back into the card.
        expect(herLines().pop()).toBe(`about "${chosen}" — yes.`);
    });

    test('and so does a choice offered under one of her own lines', async () => {
        // Same seam, the ordinary path: the opening offers choices from the first second.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        const buttons = [...document.querySelectorAll('[data-private-choice]')];
        const spoken = buttons.map((b) => b.textContent).find((text) => !PrivateChoices.isQuiet(text));
        expect(spoken).toBeTruthy();
        buttons.find((b) => b.textContent === spoken).click();

        expect(s.sent).toEqual([spoken]);
        expect(herLines().pop()).toBe(`about "${spoken}" — yes.`);

        s.activity.stop('user');
    });

    test('the quiet option is the one that deliberately sends nothing', async () => {
        // "Say nothing" is a move, not a sentence. Sending the literal `[stay quiet]` to the model
        // would be asking it to read a stage direction as speech.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        const quiet = [...document.querySelectorAll('[data-private-choice]')].find((b) =>
            PrivateChoices.isQuiet(b.textContent)
        );
        expect(quiet).toBeTruthy();
        quiet.click();

        expect(s.sent).toEqual([]);
        expect(s.activity._privateExperience.energy).toBe('quiet');

        s.activity.stop('user');
    });
});
