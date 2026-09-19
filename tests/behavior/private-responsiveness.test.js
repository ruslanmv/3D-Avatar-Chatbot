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

describe('Slow down, over the real consent flow', () => {
    test('the request is acted on, and acknowledged once', async () => {
        // The real EventBus silently drops any name outside its vocabulary, so this also
        // pins that `adult:exit` is in it — a rename would otherwise fail in the browser
        // only, and look exactly like a dead button.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const before = copy();

        click('cozy');
        // Two words, not a paragraph explaining what the control did.
        expect(copy()).not.toBe(before);
        expect(copy()).toBe('Got you.');
        expect(s.activity._privateExperience.energy).toBe('quiet');

        s.activity.stop('user');
    });

    test('at level 1 it still has somewhere to go, because energy is the second dimension', async () => {
        // Private used to think only in pace, so at Warm there was genuinely nothing left to
        // lower and the only honest answer was a sentence saying so. Energy is texture rather
        // than consent, so it can always be brought down without touching the ceiling.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        expect(s.adult.level).toBe(1);
        expect(session.energy).toBe('present');

        click('cozy');
        expect(session.energy).toBe('quiet');
        expect(session.style).toBe('quiet');
        expect(s.adult.level).toBe(1);

        s.activity.stop('user');
    });

    test('at the floor it is a no-op: no line, no repeat, no button', async () => {
        // The reported screenshot, as a test. Six taps produced six identical HER turns because
        // `ConsentFlow.exit('soft')` emits `adult:exit` even at the floor and the listener spoke
        // on every event. A safety control that generates dialogue can be made to repeat itself.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        click('cozy');
        const after = document.querySelectorAll('[data-private-turn="her"]').length;

        // The control has stopped being a control, so the loop cannot even be started.
        const button = document.querySelector('.nexus-private-btn.is-gentle');
        expect(button.textContent).toBe('✓ Gentle');
        expect(button.disabled).toBe(true);

        // And driving it directly five more times still adds nothing.
        for (let i = 0; i < 5; i += 1) s.activity._privateExperience._slowDown();
        expect(document.querySelectorAll('[data-private-turn="her"]').length).toBe(after);
        expect(document.body.textContent.match(/Got you\./g)).toHaveLength(1);

        s.activity.stop('user');
    });

    test('from a raised level the pace comes down, and the footer says so', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(120000);
        click('advance');
        expect(s.adult.level).toBe(2);

        click('cozy');
        expect(s.adult.level).toBe(1);
        expect(document.querySelector('.nexus-private-level').textContent).toBe('Warm');
        // Where the acknowledgement lives now: UI state that fades, not a turn that stays.
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Pace softened');

        s.activity.stop('user');
    });

    test('the confirmation fades, and never becomes conversation the model reads', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const session = s.activity._privateExperience;
        const before = session.view._history.length;

        click('cozy');
        const status = document.querySelector('.nexus-private-status');
        expect(status.classList.contains('is-visible')).toBe(true);

        jest.advanceTimersByTime(2000);
        expect(status.classList.contains('is-visible')).toBe(false);
        expect(status.textContent).toBe('');
        // `Got you.` is spoken and drawn but deliberately not remembered: a safety confirmation
        // in the history is context the model may answer, elaborate on, or bring up again.
        expect(session.view._history.length).toBe(before);

        s.activity.stop('user');
    });

    test('it withdraws the offer it landed on rather than arguing with the person', async () => {
        // The old guarantee was that pressing this did not *destroy* the question. The question
        // still stands on screen — it is part of the conversation — but `Playful` is more energy
        // and offering it to somebody who just asked for less is the interface arguing back.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(45000);
        expect(actions()).toEqual(['playful', 'tender', 'cozy', 'end']);

        click('cozy');

        // The choices are gone as controls; the footer's two stay, with `cozy` now `✓ Gentle`
        // and disabled.
        expect(actions()).toEqual(['cozy', 'end']);
        expect(document.querySelector('[data-private-action="cozy"]').disabled).toBe(true);
        expect(document.body.textContent).toMatch(/Playful/);
        for (const button of document.querySelectorAll('.nexus-private-actions button')) {
            expect(button.disabled).toBe(true);
        }

        s.activity.stop('user');
    });

    test('the control cannot disagree with the state it is showing', async () => {
        // `Keep it sweet` on a check-in also soft-exits, which brings the energy down. Before the
        // footer was painted from the state, the button went on saying `↓ Slow down` while there was
        // nothing left to lower — which is the invitation that produced six identical lines.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(120000);
        click('advance');
        expect(s.adult.level).toBe(2);
        expect(document.querySelector('[data-private-action="cozy"]').disabled).toBe(false);

        jest.advanceTimersByTime(120000);
        click('keep-sweet');

        const button = document.querySelector('[data-private-action="cozy"]');
        expect(s.activity._privateExperience.energy).toBe('quiet');
        expect(button.textContent).toBe('✓ Gentle');
        expect(button.disabled).toBe(true);

        s.activity.stop('user');
    });

    test('and it is not re-offered later, nor is a consent check-in', async () => {
        // Deferred would be worse than dropped: a check-in arriving two minutes after somebody
        // asked to slow down turns the control into a negotiation.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        click('cozy');

        jest.advanceTimersByTime(400000);
        expect(actions()).not.toEqual(expect.arrayContaining(['playful', 'tender']));
        expect(actions()).not.toEqual(expect.arrayContaining(['advance', 'keep-sweet']));
        expect(s.adult.level).toBe(1);

        s.activity.stop('user');
    });

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
        // The permanent controls are untouched — and a *later* beat may of course ask its own
        // question, which is the check-in at 120s that this window has crossed.
        expect(actions()).toEqual(expect.arrayContaining(['cozy', 'end']));
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
        jest.advanceTimersByTime(120000);
        click('advance');
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
