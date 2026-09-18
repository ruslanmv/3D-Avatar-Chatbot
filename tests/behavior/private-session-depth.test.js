/**
 * The Private session as an experience rather than a state machine.
 *
 * `intimate-experience.test.js` proves the session is reversible, gated and restores what it
 * touched. These prove it is worth having: that she is the same person in both channels, that
 * the one choice in it changes what follows, that an escalation is answered in her voice, and
 * that the ending waits for somebody who is mid-sentence.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

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

/** The model-facing transcript, which is what `chatHistory` is in the real app. */
function transcript() {
    const rows = [];
    window.chatHistory = { addMessage: (role, content) => rows.push({ role, content }) };
    return rows;
}

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

/** The spoken copy alone — `.nexus-private-card` also contains any action buttons. */
function cardText() {
    return document.querySelector('.nexus-private-copy').textContent;
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
        const rows = transcript();
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });

        // The opening. Before this, NEXUS_BD_SAY was TTS only — she said four things the
        // model answering the user had no record of, and could contradict in the next bubble.
        expect(rows).toHaveLength(1);
        expect(rows[0].role).toBe('assistant');
        expect(rows[0].content).toContain('Coastal Terrace');

        jest.advanceTimersByTime(45000);
        click('tender');
        expect(rows).toHaveLength(2);

        jest.advanceTimersByTime(165000);
        expect(rows.length).toBeGreaterThanOrEqual(3);
        for (const row of rows) expect(row.role).toBe('assistant');

        s.activity.stop('user');
    });

    test('a page whose ChatManager owns its own history is left alone', async () => {
        const rows = transcript();
        window.ChatManager = { addMessage: jest.fn() };
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        // ChatManager records what it draws, so writing here too would double every line.
        expect(rows).toHaveLength(0);
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
        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/playful|tender/i);

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

    test('the two moods produce different endings', async () => {
        const endings = [];
        for (const mood of ['playful', 'tender']) {
            const s = setup();
            await s.activity.start({ input: { id: 'romantic' } });
            const session = s.activity._privateExperience;
            jest.advanceTimersByTime(45000);
            click(mood);
            jest.advanceTimersByTime(240000);
            endings.push(session.plan.closing[mood]);
            s.activity.stop('user');
        }
        expect(endings[0]).not.toBe(endings[1]);
    });
});

describe('escalation is answered, and a ceiling is not a dead end', () => {
    test('saying yes to a check-in gets a line, not just a repainted label', async () => {
        const rows = transcript();
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        const before = rows.length;

        jest.advanceTimersByTime(120000);
        click('advance');

        expect(s.adult.level).toBe(2);
        expect(rows.length).toBeGreaterThan(before);
        expect(rows[rows.length - 1].content).toBe(session.plan.levelLines[2]);

        s.activity.stop('user');
    });

    test('Affectionate gets a real choice at its ceiling instead of a line saying no', async () => {
        // maxLevel 1, so this branch used to be one sentence with no buttons — the emptiest
        // run in the feature, in the preset most people try first.
        const s = setup();
        await s.activity.start({ input: { id: 'affectionate' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(120000);
        expect(cardText()).toBe(session.plan.texture.prompt);
        click('closer');
        expect(session.texture).toBe('closer');
        expect(cardText()).toBe(session.plan.texture.closer);
        // Texture is not escalation: it grants nothing and asks for no consent step.
        expect(s.adult.level).toBe(1);
        expect(s.adult.checkIn).not.toHaveBeenCalled();

        s.activity.stop('user');
    });
});

describe('the ending waits for a person who is mid-sentence', () => {
    test('a live conversation defers the completion card', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(295000);
        // Somebody typing five seconds before the scripted end.
        document.getElementById('speak-btn').click();
        jest.advanceTimersByTime(10000);

        expect(session.state).not.toBe('complete');
        expect(session._turns).toBe(1);

        // And it does not wait forever: the grace is bounded.
        jest.advanceTimersByTime(200000);
        expect(session.state).toBe('complete');

        s.activity.stop('user');
    });

    test('a silent session still ends on time', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        jest.advanceTimersByTime(300000);
        expect(session.state).toBe('complete');
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
        jest.advanceTimersByTime(255000);
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
        const rows = transcript();
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
        expect(rows).toHaveLength(1);
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
