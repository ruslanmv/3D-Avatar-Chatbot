/**
 * The Private session as an experience rather than a state machine.
 *
 * `intimate-experience.test.js` proves the session is reversible, gated and restores what it
 * touched. These prove it is worth having: that she is the same person in both channels, that
 * the one choice in it changes what follows, that an escalation is answered in her voice, and
 * that the ending waits for somebody who is mid-sentence.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Memory = require('../../src/features/together/PrivateMemory.js');

Capability.installPrivateRuntime(PlaygroundActivity);

function bus() {
    const listeners = new Map();
    return {
        events: [],
        emit: jest.fn(function (name, payload) {
            this.events.push({ name, payload });
            for (const fn of [...(listeners.get(name) || [])]) fn(payload);
        }),
        on(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
            return () => listeners.get(name).delete(fn);
        },
    };
}

class AdultFlowMock {
    constructor({ blackboard, eventBus }) {
        this.blackboard = blackboard;
        this.bus = eventBus;
        this.profile = { escalation: { levels: 4, perLevelMinMs: 120000 } };
        this.perLevelMinMs = 120000;
        this.active = false;
        this.level = 1;
        this.maxLevel = 4;
        this.pending = null;
        this.enter = jest.fn(() => {
            this.active = true;
            this.level = 1;
            return { ok: true, why: 'entered', level: 1 };
        });
        this.exit = jest.fn(() => {
            this.active = false;
            return { ok: true, kind: 'hard', level: 1 };
        });
        this.earned = jest.fn(() => true);
        this.stepReady = jest.fn(() => true);
        // P12's two routes: an explicit step up, and one level back.
        this.initiated = jest.fn(() => {
            if (this.level >= this.maxLevel) return { action: 'ignored', why: 'at the top already' };
            this.level += 1;
            this.blackboard.escalationLevel = this.level;
            return { action: 'advanced', level: this.level, why: 'initiated' };
        });
        this.eased = jest.fn(() => {
            this.pending = null;
            if (this.level <= 1) return { action: 'ignored', why: 'at the bottom already' };
            this.level -= 1;
            this.blackboard.escalationLevel = this.level;
            return { action: 'advanced', level: this.level, why: 'eased' };
        });
        this.checkIn = jest.fn(() => {
            if (this.level >= this.maxLevel) return { ok: false, why: 'at the top' };
            this.pending = { level: this.level + 1 };
            return { ok: true, to: this.level + 1 };
        });
        this.hear = jest.fn(() => {
            if (!this.pending) return { action: 'heard', level: this.level };
            this.level = this.pending.level;
            this.pending = null;
            return { action: 'advanced', level: this.level };
        });
    }
}

/**
 * The global store, and a spy on anything that reaches it.
 *
 * As of P10 a Private session must write **nothing** here: `_persistChat` puts this array in
 * `localStorage`, so a line that lands in it survives the session, the page and the browser
 * restart and comes back as ordinary chat scrollback.
 */
function transcript() {
    const rows = [];
    window.chatHistory = {
        addMessage: (role, content) => rows.push({ role, content }),
        getHistory: () => rows.slice(),
    };
    return rows;
}

/**
 * What the model will actually be sent.
 *
 * The conversation store of whoever is drawing — `window.chatHistory` in ordinary chat, and the
 * session-local buffer while a Private card is up. Read through the surface rather than named
 * directly, because which one it is is the thing P10 changed.
 */
const modelRows = () => Surface.history().getHistory();

function setup({ preset = 'romantic' } = {}) {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    const eventBus = bus();
    const blackboard = {
        adultVerified: true,
        nsfwAllowed: true,
        activity: 'chat',
        escalationLevel: 0,
        scene: { id: 'coastal-terrace-twilight', label: 'Coastal Terrace · Twilight' },
    };
    const adult = new AdultFlowMock({ blackboard, eventBus });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    const director = {
        blackboard,
        modes: { activeId: 'companion', activate: () => true, deactivate: () => true },
        adult,
        bus: eventBus,
        togetherPanel: panel,
        intimate: null,
    };
    window.NEXUS_BD = director;
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_SPICY = { usable: () => true };
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus: eventBus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, blackboard, panel, eventBus, director, preset };
}

function click(action) {
    const node = document.querySelector(`[data-private-action="${action}"]`);
    expect(node).not.toBeNull();
    node.click();
}

/** The most recent spoken line; the card is a rolling transcript now. */
function cardText() {
    return [...document.querySelectorAll('.nexus-private-copy')].pop().textContent;
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-18T20:00:00Z'));
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    delete window.NEXUS_BD;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    delete window.chatHistory;
    delete window._nexusLLM;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('she is the same person in both channels', () => {
    test('every spoken beat reaches the transcript the model reads', async () => {
        const global = transcript();
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        // The opening. Before this, NEXUS_BD_SAY was TTS only — she said four things the
        // model answering the user had no record of, and could contradict in the next bubble.
        expect(modelRows()).toHaveLength(1);
        expect(modelRows()[0].role).toBe('assistant');
        expect(modelRows()[0].content).toContain('Coastal Terrace');

        jest.advanceTimersByTime(45000);
        click('tender');
        expect(modelRows()).toHaveLength(2);

        jest.advanceTimersByTime(165000);
        expect(modelRows().length).toBeGreaterThanOrEqual(3);
        for (const row of modelRows()) expect(row.role).toBe('assistant');
        // And none of it reached the store `_persistChat` writes to disk. See P10.
        expect(global).toHaveLength(0);

        s.activity.stop('user');
    });

    test('the global store is left alone whatever else is on the page', async () => {
        // `_remember` used to inspect `window.ChatManager` and skip writing when a page had one,
        // because ChatManager records what it draws and writing to `chatHistory` too would double
        // every line. P10 made that check unnecessary rather than merely satisfied: Private writes
        // to its own store, so there is nothing for either of them to double.
        const rows = transcript();
        window.ChatManager = { addMessage: jest.fn() };
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        expect(rows).toHaveLength(0);
        expect(window.ChatManager.addMessage).not.toHaveBeenCalled();
        expect(modelRows().length).toBeGreaterThan(0);
        s.activity.stop('user');
        delete window.ChatManager;
    });
});

describe('the one choice in the session has consequences', () => {
    test('the mood selects the later beats and reaches the prompt', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        expect(session.mood).toBeNull();
        // The property is that the *chosen mood* has not leaked, not that the words never appear:
        // P22's Warm register legitimately says "warm and playful" about the level itself.
        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/chose a (playful|tender) mood/i);

        jest.advanceTimersByTime(45000);
        click('playful');

        expect(session.mood).toBe('playful');
        expect(Capability.privateSystemPromptSuffix()).toMatch(/playful/i);

        // The 210s beat is now the playful middle rather than one fixed string.
        jest.advanceTimersByTime(165000);
        expect(cardText()).toBe(session.plan.middle.playful);
        expect(session.plan.middle.playful).not.toBe(session.plan.middle.tender);

        s.activity.stop('user');
    });

    test('the two moods produce different lines, spoken rather than only stored', async () => {
        const spoken = [];
        for (const mood of ['playful', 'tender']) {
            const s = setup();
            await s.activity.start({ input: { id: 'romantic' } });
            jest.advanceTimersByTime(45000);
            click(mood);
            jest.advanceTimersByTime(180000);
            spoken.push(cardText());
            s.activity.stop('user');
        }
        expect(spoken[0]).not.toBe(spoken[1]);
    });
});

describe('progression is the primary control, and a ceiling is not a dead end', () => {
    test('a step forward gets a line, not just a repainted label', async () => {
        transcript();
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(5000);
        click('closer');

        expect(s.adult.level).toBe(2);
        expect(cardText()).toBe(session.plan.levelLines[2]);
        // Said and heard, and deliberately not remembered: the model already knows the level from
        // the prompt overlay, and a line about the control is something it might elaborate on.
        expect(modelRows().map((row) => row.content)).not.toContain(session.plan.levelLines[2]);

        s.activity.stop('user');
    });

    test('the overlay says the step was asked for, not that a number went up', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        expect(Capability.privateSystemPromptSuffix()).toMatch(/have not asked for anything more intense/i);

        jest.advanceTimersByTime(5000);
        click('closer');
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toMatch(/asked for this step themselves/i);
        expect(suffix).toMatch(/without proposing the next one/i);
        expect(suffix).toContain('Current consent level: 2');

        s.activity.stop('user');
    });

    test('Affectionate has no ladder to climb, and is offered texture instead', async () => {
        // maxLevel 1, so there is no forward step at all — and a preset with one level gets no
        // ladder, because `Warm` on its own is not progress.
        const s = setup();
        await s.activity.start({ input: { id: 'affectionate' } });
        const session = s.activity._privateExperience;

        expect(document.querySelector('[data-private-action="closer"]')).toBeNull();
        expect(document.querySelectorAll('[data-private-step]')).toHaveLength(0);
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Warm');

        jest.advanceTimersByTime(330000);
        expect(cardText()).toBe(session.plan.texture.prompt);
        click('texture-closer');
        expect(session.texture).toBe('closer');
        expect(cardText()).toBe(session.plan.texture.closer);
        // Texture is not escalation: it grants nothing and asks for no consent step.
        expect(s.adult.level).toBe(1);
        expect(s.adult.checkIn).not.toHaveBeenCalled();

        s.activity.stop('user');
    });
});

describe('nothing but End finishes a Private session', () => {
    test('a silent session does not end on a timer', async () => {
        // Warm → Romantic → Sensual is not an arc toward completion. It is a place the person drives
        // to and then stays, so the clock has no opinion about when an evening is finished.
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(900000);
        expect(session.state).not.toBe('complete');
        expect(document.querySelector('.nexus-private-complete')).toBeNull();
        expect(document.querySelector('[data-private-action="end"]')).not.toBeNull();

        s.activity.stop('user');
    });

    test('a session at its ceiling stays there rather than completing', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        jest.advanceTimersByTime(5000);
        click('closer');
        expect(s.adult.level).toBe(2);

        jest.advanceTimersByTime(600000);
        expect(session.state).not.toBe('complete');
        expect(s.adult.level).toBe(2);

        s.activity.stop('user');
    });

    test('End shows the completion card, which is where the promise is made', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        click('end');
        expect(session.state).toBe('complete');
        expect(document.querySelector('.nexus-private-complete')).not.toBeNull();
        expect(document.body.textContent).toMatch(/nothing from this private moment/i);

        s.activity.stop('user');
    });
});

describe('continuity between sessions', () => {
    test('a completed session is remembered; an abandoned one is not', async () => {
        const first = setup();
        await first.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(45000);
        click('tender');
        first.activity.stop('user');
        expect(Memory.read().sessions).toBe(0);

        const second = setup();
        await second.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(45000);
        click('playful');
        // Remembered on a deliberate exit, not on a stopwatch reaching five minutes.
        click('end');
        expect(second.activity._privateExperience.state).toBe('complete');

        const kept = Memory.read();
        expect(kept.preset).toBe('sensual');
        expect(kept.mood).toBe('playful');
        expect(kept.sessions).toBe(1);

        second.activity.stop('user');
    });
});

describe('the model path never delays or breaks a session', () => {
    test('the opening is spoken before any planner could answer', async () => {
        transcript();
        let resolve = null;
        window._nexusLLM = {
            getSettings: () => ({ provider: 'openai' }),
            sendMessage: jest.fn(
                () =>
                    new Promise((r) => {
                        resolve = r;
                    })
            ),
        };
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        // Spoken immediately, from the written plan, with the provider still thinking.
        expect(modelRows()).toHaveLength(1);
        expect(s.activity._privateExperience.plan.source).toBe('written');
        expect(window._nexusLLM.sendMessage).toHaveBeenCalledTimes(1);

        resolve('not json');
        await Promise.resolve();
        await Promise.resolve();
        expect(s.activity._privateExperience.plan.source).toBe('written');

        s.activity.stop('user');
    });

    test('a plan that arrives after the session ended is not swapped in', async () => {
        let resolve = null;
        window._nexusLLM = {
            getSettings: () => ({ provider: 'openai' }),
            sendMessage: jest.fn(
                () =>
                    new Promise((r) => {
                        resolve = r;
                    })
            ),
        };
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        s.activity.stop('user');

        resolve(
            JSON.stringify({
                opening: 'Too late to matter.',
                moodPrompt: 'How should this feel?',
                moods: { playful: 'a', tender: 'b' },
                middle: { playful: 'c', tender: 'd' },
                closing: { playful: 'e', tender: 'f' },
            })
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(session.plan.opening).not.toBe('Too late to matter.');
    });
});
