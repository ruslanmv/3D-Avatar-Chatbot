/**
 * The Private card must never look dead, and its beats must survive a backgrounded tab.
 *
 * Two reports, one cause each:
 *
 *   "when the AI is thinking or processing it keeps frozen" — the card was a still image
 *   while the provider worked, and in the reported session the provider was answering
 *   `OllaBridge returned 504; retrying`. Nothing on screen moved, which is indistinguishable
 *   from a crash.
 *
 *   "keep with <the 210s line> ... so later nothing happens" — the five beats were five
 *   independent setTimeouts spanning five minutes with 75-90 second gaps. A hidden tab has its
 *   timers clamped to roughly one a minute and can have them frozen outright; locking a phone
 *   does the same. Look away after the middle line and the closing and the completion never
 *   arrive. The card stays mounted, with its buttons, and nothing will ever fire again.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const View = require('../../src/features/together/ui/PrivateConversationView.js');

Capability.installPrivateRuntime(PlaygroundActivity);

function bus() {
    const listeners = new Map();
    return {
        emit: jest.fn((name, payload) => {
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
    constructor() {
        this.active = false;
        this.level = 1;
        this.maxLevel = 4;
        this.profile = { escalation: { levels: 4 } };
        this.enter = jest.fn(() => {
            this.active = true;
            return { ok: true, level: 1 };
        });
        this.exit = jest.fn(() => {
            this.active = false;
            return { ok: true, kind: 'hard', level: 1 };
        });
        this.earned = jest.fn(() => true);
        this.checkIn = jest.fn(() => ({ ok: false, why: 'at the top' }));
        this.hear = jest.fn(() => ({ action: 'heard', level: this.level }));
    }
}

function setup() {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    const eventBus = bus();
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0, scene: null };
    const adult = new AdultFlowMock();
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
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus: eventBus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult };
}

/** The most recent line. The card is a rolling transcript, not one replaced message. */
const copy = () => [...document.querySelectorAll('.nexus-private-copy')].pop().textContent;
const dots = () => document.querySelector('[data-private-thinking="1"]');

/** Pretend the tab was hidden: advance the clock without letting timers run on time. */
function hiddenFor(ms) {
    jest.setSystemTime(new Date(Date.now() + ms));
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-18T22:00:00Z'));
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    delete window.NEXUS_BD;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    document.body.innerHTML = '';
});

describe('the beats survive a tab that was not being watched', () => {
    test('a session catches up on everything it missed', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        jest.advanceTimersByTime(45000);
        expect(copy()).toMatch(/mood|feel/i);

        // Four minutes of wall clock pass with the tab hidden and its timers throttled to a
        // single late tick. Before this, the closing and the completion were simply lost.
        hiddenFor(260000);
        jest.advanceTimersByTime(60000);

        expect(session.state).toBe('complete');
        expect(document.querySelector('.nexus-private-complete')).not.toBeNull();

        s.activity.stop('user');
    });

    test('coming back to the tab fires what is due, without waiting for a timer', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        hiddenFor(215000);
        // No timer runs at all — only the visibility event, which is what actually fires the
        // instant somebody returns to a throttled tab.
        document.dispatchEvent(new Event('visibilitychange'));

        expect(session._beats.filter((b) => b.done).length).toBeGreaterThanOrEqual(3);
        expect(copy()).toBeTruthy();

        s.activity.stop('user');
    });

    test('a caught-up session does not replay the backlog line by line', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;

        hiddenFor(300000);
        // One late tick, which is all a throttled tab gets.
        jest.advanceTimersByTime(60000);

        // Every beat is marked done exactly once, and the session lands at the end rather
        // than walking through five minutes of catch-up.
        expect(session._beats.every((b) => b.done)).toBe(true);
        expect(session.state).toBe('complete');

        s.activity.stop('user');
    });

    test('a beat that throws does not take the rest of the evening with it', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        session._beats[1].run = () => {
            throw new Error('beat exploded');
        };
        hiddenFor(300000);
        jest.advanceTimersByTime(60000);

        expect(session.state).toBe('complete');
        expect(console.warn).toHaveBeenCalled();
        console.warn.mockRestore();
        s.activity.stop('user');
    });

    test('stopping clears the beats and the visibility listener', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        const session = s.activity._privateExperience;
        expect(session._unwatchVisibility).not.toBeNull();

        s.activity.stop('user');

        expect(session._beats).toEqual([]);
        expect(session._unwatchVisibility).toBeNull();
        // And a late visibility event on a stopped session does nothing.
        expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
    });
});

describe('something moves while she is thinking', () => {
    test('typing raises the dots, and a reply takes them down', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        expect(dots()).toBeNull();

        document.getElementById('speak-btn').click();
        expect(dots()).not.toBeNull();
        expect(dots().getAttribute('role')).toBe('status');

        // The chat pipeline writes the reply into the history; the view is watching for it.
        const reply = document.createElement('div');
        reply.className = 'chat-row';
        document.getElementById('chat-history').appendChild(reply);
        await Promise.resolve();

        expect(dots()).toBeNull();
        s.activity.stop('user');
    });

    test('the dots do not disturb a question that is on screen', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        jest.advanceTimersByTime(45000);
        expect(document.querySelectorAll('[data-private-action]')).toHaveLength(4);

        document.getElementById('speak-btn').click();

        expect(dots()).not.toBeNull();
        // Still tappable while she thinks.
        expect(document.querySelectorAll('[data-private-action]')).toHaveLength(4);
        s.activity.stop('user');
    });

    test('a reply that never comes gives up rather than spinning forever', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        document.getElementById('speak-btn').click();
        expect(dots()).not.toBeNull();

        // The 504-and-retry case from the report: nothing ever lands in the transcript.
        jest.advanceTimersByTime(95000);
        expect(dots()).toBeNull();

        s.activity.stop('user');
    });

    test('the session repairing its own row does not count as a reply', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'romantic' } });
        document.getElementById('speak-btn').click();
        expect(dots()).not.toBeNull();

        // Chat restore replaces the children; the view re-appends its own row. That is the
        // session healing itself, not her answering.
        const host = document.getElementById('chat-history');
        const row = document.getElementById(View.ROW_ID);
        host.removeChild(row);
        host.appendChild(row);
        await Promise.resolve();

        expect(dots()).not.toBeNull();
        s.activity.stop('user');
    });
});
