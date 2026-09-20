/**
 * "I press Keep it cozy and nothing happens."
 *
 * Every other Private test builds its own `AdultFlowMock` and its own `{emit, on}` bus. Both
 * are reasonable for testing the session's own logic, and between them they hid this bug
 * completely: the real `EventBus` drops any event outside a fixed vocabulary, the real
 * `ConsentFlow.exit('soft')` reports `from: 1, to: 1` when it is already at the bottom, and
 * the real card holds one message at a time. So these tests wire the **real** bus, the
 * **real** consent flow and the **real** adult profile, and press the button.
 *
 * The three things that were wrong, none of which was a broken event:
 *
 *   1. pressing it while a question was on screen destroyed the question, permanently —
 *      `_showMoodChoice` is a one-shot timer and never re-offers;
 *   2. from level 1 it claimed to have turned something down when `from === to`;
 *   3. the session emitted no motion intent, ever, so the avatar stood still through all of
 *      it while every other Together activity moves.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

Capability.installPrivateRuntime(PlaygroundActivity);

function setup({ scene = null } = {}) {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0, scene };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    const director = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD = director;
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;

    const intents = [];
    bus.on('intent', (intent) => intents.push(intent));

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, bus, blackboard, intents };
}

const actions = () => [...document.querySelectorAll('[data-private-action]')].map((b) => b.dataset.privateAction);
/** The most recent line. The card is a rolling transcript, not one replaced message. */
const copy = () => [...document.querySelectorAll('.nexus-private-copy')].pop().textContent;
const click = (action) => document.querySelector(`[data-private-action="${action}"]`).click();
/**
 * Past the step floor.
 *
 * `userStepMinMs` is measured from when the level was entered, and a session enters level 1 as it
 * starts — so the first four seconds of any evening cannot step. That is the floor doing its job
 * rather than an accident: somebody pressing `Closer` before the opening line has finished has not
 * read it yet.
 */
const ready = () => jest.advanceTimersByTime(5000);

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('the forward control, over the real consent flow (P12)', () => {
    test('`Closer` is the prominent control, and easing is not offered at the floor', async () => {
        // The correction P12 exists for: P11 made de-escalation the loudest thing in the card, which
        // is backwards for an experience whose emotional action is moving forward. At Warm there is
        // nothing to ease, so there is no easing control either.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        expect(actions()).toEqual(['closer', 'end']);
        const forward = document.querySelector('[data-private-action="closer"]');
        expect(forward.textContent).toBe('Closer →');
        expect(forward.classList.contains('is-primary')).toBe(true);

        s.activity.stop('user');
    });

    test('one tap is one level, immediately, with no timer in the way', async () => {
        // The mechanism was already here, buried behind a two-minute scripted question. A person who
        // presses the button has asked; making them wait for `perLevelMinMs` is the interface
        // refusing a request it was just given.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(s.adult.level).toBe(1);

        ready();
        click('closer');
        expect(s.adult.level).toBe(2);
        // No timers advanced at all.
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Romantic');
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Romantic');

        s.activity.stop('user');
    });

    test('the label changes so the second step does not look like a failed first', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        ready();
        click('closer');
        expect(document.querySelector('[data-private-action="closer"]').textContent).toBe('More →');
        s.activity.stop('user');
    });

    test('the ladder shows the ceiling and the position at once', async () => {
        // The most confusing thing in the screenshot: the header said `Sensual`, the footer said
        // `Warm`. Both true — ceiling and current — and nobody could be expected to know that.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        const rungs = () => [...document.querySelectorAll('[data-private-step]')];
        const badge = () => document.querySelector('.nexus-private-heading-title').textContent;
        expect(rungs().map((n) => n.dataset.privateStep)).toEqual(['1', '2', '3']);
        expect(rungs().filter((n) => n.classList.contains('is-reached'))).toHaveLength(1);
        // The ladder is the shape; the header badge is the word (P26). It used to be on the
        // current rung as well, which repeated it two inches below itself.
        expect(rungs().every((n) => n.textContent === '•')).toBe(true);
        expect(badge()).toBe('Warm');

        ready();
        click('closer');
        expect(rungs().filter((n) => n.classList.contains('is-reached'))).toHaveLength(2);
        expect(badge()).toBe('Romantic');

        s.activity.stop('user');
    });

    test('easing appears once there is a step to give back, and takes exactly one', async () => {
        // P11 dropped Sensual straight to Warm in one tap. Correct for a safe *word*; a cliff for a
        // control somebody is steering with.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        click('closer');
        ready();
        click('closer');
        expect(s.adult.level).toBe(3);
        expect(actions()).toEqual(['ease', 'end']);

        click('ease');
        expect(s.adult.level).toBe(2);
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Romantic');
        expect(actions()).toEqual(['ease', 'closer', 'end']);

        s.activity.stop('user');
    });

    test('a double-tap does not carry the evening to the ceiling', async () => {
        // The one floor that belongs on a user-initiated step: enough to outlast a stray finger,
        // invisible to anybody moving at the pace of a conversation.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        ready();
        click('closer');
        click('closer');
        expect(s.adult.level).toBe(2);
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Give it a moment');

        ready();
        click('closer');
        expect(s.adult.level).toBe(3);

        s.activity.stop('user');
    });

    test('at the ceiling the forward control is gone, and nothing completes the session', async () => {
        // Reaching Sensual is a place to stay, not an ending.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        click('closer');
        ready();
        click('closer');

        expect(actions()).not.toContain('closer');
        jest.advanceTimersByTime(600000);
        expect(s.activity._privateExperience.state).not.toBe('complete');
        expect(document.querySelector('.nexus-private-complete')).toBeNull();
        expect(actions()).toContain('end');

        s.activity.stop('user');
    });

    test('each step says one short line, and never the same one twice', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const said = () =>
            [...document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy')].map((n) => n.textContent);

        ready();
        click('closer');
        const afterUp = said().pop();
        expect(afterUp).toBeTruthy();

        click('ease');
        const afterDown = said().pop();
        expect(afterDown).not.toBe(afterUp);

        // Up again, and the line it said the first time is not repeated.
        ready();
        click('closer');
        expect(said().filter((line) => line === afterUp)).toHaveLength(1);

        s.activity.stop('user');
    });

    test('a step acknowledgement is not conversation the model reads', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        const before = session.view._history.length;

        ready();
        click('closer');
        expect(session.view._history.length).toBe(before);

        s.activity.stop('user');
    });

    test('easing at the floor is a no-op: no line, no repeat', async () => {
        // The reported screenshot, as a test. Six taps produced six identical HER turns; now the
        // control is not even drawn at the floor, and driving it directly adds nothing.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        session.energy = 'quiet';
        const before = document.querySelectorAll('[data-private-turn="her"]').length;

        for (let i = 0; i < 6; i += 1) session._easeUp();

        expect(document.querySelectorAll('[data-private-turn="her"]').length).toBe(before);
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Already gentle');

        s.activity.stop('user');
    });

    test('a typed slow-down is a word, not a step: it goes all the way down', async () => {
        // `exit('soft')` is the right mechanism for a safe word — one tick, from anywhere, no
        // degrees. A person typing "too much" should not have to type it three times.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        click('closer');
        ready();
        click('closer');
        expect(s.adult.level).toBe(3);

        s.activity._privateExperience._onUserTurn('that is too much, slow down');
        expect(s.adult.level).toBe(1);
        expect(s.activity._privateExperience.energy).toBe('quiet');

        s.activity.stop('user');
    });

    test('a typed request for more goes through the same gate as the button', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        s.activity._privateExperience._onUserTurn('come closer');
        expect(s.adult.level).toBe(2);
        s.activity.stop('user');
    });

    test('each step down says its own line, so the second is not silenced', async () => {
        // `_speakStepLine` refuses a line it has already said this session, so a single shared
        // fallback would leave the second ease step silent — which reads as the control breaking.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        click('closer');
        ready();
        click('closer');
        const said = () =>
            [...document.querySelectorAll('[data-private-turn="her"] .nexus-private-copy')].map((n) => n.textContent);

        click('ease');
        const first = said().pop();
        click('ease');
        const second = said().pop();

        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        expect(second).not.toBe(first);

        s.activity.stop('user');
    });

    test('the music comes back up when the person asks for more, not only down', async () => {
        // Without this the music would remember a request the person had since reversed.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const view = s.activity._privateExperience.view;
        const asked = [];
        view._soundtrackCard = {
            _nexusPlayback: {
                setVolume: (v) => {
                    asked.push(v);
                    return true;
                },
            },
        };

        ready();
        click('closer');
        click('ease');

        expect(asked).toHaveLength(2);
        expect(asked[0]).toBeGreaterThan(asked[1]);

        s.activity.stop('user');
    });

    test('the scripted consent check-in is gone, not merely unreachable', async () => {
        // It was the forward mechanism, and a mechanism reachable only on a two-minute timer is not
        // a control. Leaving a `checkin-pending` state nothing can enter would read as live code.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;

        expect(session._offerCheckIn).toBeUndefined();
        expect(session._acceptCheckIn).toBeUndefined();
        expect(session.view.showConsentCheckIn).toBeUndefined();

        jest.advanceTimersByTime(600000);
        expect(actions()).not.toEqual(expect.arrayContaining(['advance', 'keep-sweet']));
        expect(session.state).toBe('active');

        s.activity.stop('user');
    });

    test('time passing never raises anything', async () => {
        // The invariant worth keeping from every earlier version: friendliness, a long conversation
        // and a clock must never move the level. Only an explicit request does.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(600000);
        expect(s.adult.level).toBe(1);
        s.activity.stop('user');
    });
});

describe('the rest of the card', () => {
    test('an answered question stops offering itself', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(45000);
        click('tender');
        jest.advanceTimersByTime(165000);
        // Asked once and answered once. The label stays visible as part of the conversation,
        // but it is no longer a control — in a transcript an un-consumed choice could be taken
        // twice, an hour apart.
        expect(actions().filter((a) => a === 'tender' || a === 'playful')).toHaveLength(0);
        expect(document.querySelector('.nexus-private-btn.is-chosen').textContent).toBe('Tender');
        // The permanent controls are untouched.
        expect(actions()).toEqual(expect.arrayContaining(['closer', 'end']));
        s.activity.stop('user');
    });
});

describe('she is not motionless for five minutes', () => {
    test('beats ask for a movement, the way every other Together activity does', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        expect(s.intents.length).toBeGreaterThan(0);
        expect(s.intents[0]).toEqual(expect.objectContaining({ source: 'private' }));

        jest.advanceTimersByTime(45000);
        const before = s.intents.length;
        click('playful');
        expect(s.intents.length).toBeGreaterThan(before);

        s.activity.stop('user');
    });

    test('never the adult ceiling s own intents', async () => {
        // `flirt`/`tease`/`sensualSway` map to nsfw clips, which `UtilityRanker` refuses for
        // any intent the user did not raise, and `proactiveNsfw: false` says she may never
        // initiate one. Private asks for presence, not performance.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        ready();
        click('closer');
        jest.advanceTimersByTime(180000);

        const forbidden = ['flirt', 'tease', 'beckon', 'sensualSway', 'slowBurn', 'intimate'];
        for (const intent of s.intents) expect(forbidden).not.toContain(intent.name);
        expect(s.intents.length).toBeGreaterThan(0);

        s.activity.stop('user');
    });

    test('a bus that throws takes down neither the line nor the teardown', async () => {
        // Teardown emits too, and `_emit` was unguarded — so a broken bus left the adult mode
        // entered, the ceiling installed and the blackboard unrestored. Exit is the last place
        // that may be allowed to throw.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        session.bus = {
            emit: () => {
                throw new Error('bus is gone');
            },
        };

        expect(() => session._speak('Still says it.')).not.toThrow();
        expect(copy()).toBe('Still says it.');

        expect(() => s.activity.stop('user')).not.toThrow();
        expect(s.adult.active).toBe(false);
        expect(s.blackboard.activity).toBe('chat');
    });
});

describe('the opening does not read like a placeholder', () => {
    test('no scene means no scene sentence', async () => {
        const s = setup({ scene: null });
        await s.activity.start({ input: { id: 'romantic' } });
        // Not "… this place feels like a good place for it."
        expect(copy()).not.toMatch(/this place feels like/i);
        s.activity.stop('user');
    });

    test('a real scene is still named', async () => {
        const s = setup({ scene: { id: 'coastal-terrace', label: 'Coastal Terrace · Twilight' } });
        await s.activity.start({ input: { id: 'romantic' } });
        expect(copy()).toMatch(/Coastal Terrace · Twilight feels like a good place for it\./);
        s.activity.stop('user');
    });
});
