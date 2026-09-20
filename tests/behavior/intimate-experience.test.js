/**
 * End-to-end Private experience runtime.
 *
 * The launcher/gate tests live in intimate-ui.test.js. These tests start where eligibility is
 * already satisfied and prove that starting a preset now creates a real, reversible experience:
 * adult mode, viewport HUD, TTS/media orchestration, earned check-ins, active prompt boundary,
 * and exact restoration on exit.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

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

class ModesMock {
    constructor(blackboard) {
        this.blackboard = blackboard;
        this.activeId = 'companion';
        this.stack = [];
        this.blackboard.mode = { id: 'companion' };
        this.blackboard.attention = 0;
    }

    activate(id) {
        if (this.activeId === id) return true;
        this.stack.push({
            activeId: this.activeId,
            mode: this.blackboard.mode,
            attention: this.blackboard.attention,
        });
        this.activeId = id;
        this.blackboard.mode = { id };
        this.blackboard.attention = id === 'adult' ? 0.8 : 0;
        return true;
    }

    deactivate() {
        const previous = this.stack.pop();
        if (!previous) return false;
        this.activeId = previous.activeId;
        this.blackboard.mode = previous.mode;
        this.blackboard.attention = previous.attention;
        return true;
    }
}

class AdultFlowMock {
    constructor({ blackboard, modes, eventBus }) {
        this.blackboard = blackboard;
        this.modes = modes;
        this.bus = eventBus;
        this.profile = {
            escalation: {
                levels: 4,
                start: 1,
                perLevelMinMs: 120000,
                userStepMinMs: 4000,
                decayToLevel: 1,
            },
        };
        this.active = false;
        this.level = 1;
        this.levelSince = null;
        this.pending = null;
        this.enter = jest.fn(() => {
            if (!this.blackboard.adultVerified || !this.blackboard.nsfwAllowed) {
                return { ok: false, why: 'not permitted' };
            }
            this.active = true;
            this.level = 1;
            this.levelSince = Date.now();
            this.pending = null;
            this.blackboard.escalationLevel = 1;
            this.bus.emit('adult:enter', { level: 1, at: Date.now() });
            return { ok: true, why: 'entered', level: 1 };
        });
        this.exit = jest.fn((kind = 'hard') => {
            const from = this.level;
            this.pending = null;
            if (kind === 'soft') {
                this.level = 1;
                this.levelSince = Date.now();
                this.blackboard.escalationLevel = 1;
                this.bus.emit('adult:exit', { kind, from, to: 1, at: Date.now() });
                return { ok: true, kind, level: 1 };
            }
            this.active = false;
            this.level = 1;
            this.levelSince = null;
            this.blackboard.escalationLevel = 1;
            this.modes.activate('companion');
            this.bus.emit('adult:exit', { kind, from, to: 1, at: Date.now() });
            return { ok: true, kind, level: 1 };
        });
        this.checkIn = jest.fn(() => {
            if (!this.active) return { ok: false, why: 'not in the tier' };
            if (this.pending) return { ok: false, why: 'already asked' };
            if (this.level >= this.maxLevel) return { ok: false, why: 'at the top already' };
            if (!this.earned()) return { ok: false, why: 'this level has not been held long enough' };
            this.pending = { level: this.level + 1, at: Date.now() };
            this.bus.emit('adult:checkin', { from: this.level, to: this.level + 1, at: Date.now() });
            return { ok: true, why: 'asked', to: this.level + 1 };
        });
        // P12's two routes. `initiated` is a user-initiated step, floored by `userStepMinMs`
        // rather than the two-minute cadence for *her* asking; `eased` gives one level back.
        this.initiated = jest.fn(() => {
            if (!this.active) return { action: 'ignored', why: 'not in the tier' };
            if (this.level >= this.maxLevel) return { action: 'ignored', why: 'at the top already' };
            if (!this.stepReady()) return { action: 'ignored', why: 'this level has only just started' };
            this.level += 1;
            this.levelSince = Date.now();
            this.blackboard.escalationLevel = this.level;
            this.bus.emit('adult:level', { level: this.level, why: 'initiated', at: Date.now() });
            return { action: 'advanced', level: this.level, why: 'initiated' };
        });
        this.eased = jest.fn(() => {
            if (!this.active) return { action: 'ignored', why: 'not in the tier' };
            this.pending = null;
            if (this.level <= 1) return { action: 'ignored', why: 'at the bottom already' };
            this.level -= 1;
            this.levelSince = Date.now();
            this.blackboard.escalationLevel = this.level;
            this.bus.emit('adult:level', { level: this.level, why: 'eased', at: Date.now() });
            return { action: 'advanced', level: this.level, why: 'eased' };
        });
        this.hear = jest.fn((text) => {
            if (!this.pending || String(text).toLowerCase() !== 'yes') return { action: 'heard', level: this.level };
            const target = this.pending.level;
            this.pending = null;
            this.level = Math.min(this.maxLevel, target);
            this.levelSince = Date.now();
            this.blackboard.escalationLevel = this.level;
            this.bus.emit('adult:level', { level: this.level, why: 'checkin', at: Date.now() });
            return { action: 'advanced', level: this.level, why: 'checkin' };
        });
    }

    get maxLevel() {
        return this.profile.escalation.levels;
    }

    get perLevelMinMs() {
        return this.profile.escalation.perLevelMinMs;
    }

    get userStepMinMs() {
        return this.profile.escalation.userStepMinMs;
    }

    earned() {
        return this.levelSince !== null && Date.now() - this.levelSince >= this.perLevelMinMs;
    }

    stepReady() {
        return this.levelSince !== null && Date.now() - this.levelSince >= this.userStepMinMs;
    }
}

function setup({ preset = 'romantic', withDiscovery = false, mediaPlaying = false } = {}) {
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
    const modes = new ModesMock(blackboard);
    const adult = new AdultFlowMock({ blackboard, modes, eventBus });
    const panel = {
        active: 'intimate',
        activeActivity: 'intimate',
        stopActivity: jest.fn(),
        open: jest.fn(),
    };
    const director = {
        blackboard,
        modes,
        adult,
        bus: eventBus,
        togetherPanel: panel,
        intimate: null,
    };
    window.NEXUS_BD = director;
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;

    const media = {
        get: jest.fn(() =>
            mediaPlaying
                ? { status: 'playing', current: { id: 'existing', kind: 'music', title: 'Existing music' } }
                : { status: 'idle', current: null }
        ),
        requestPlay: jest.fn(),
        stop: jest.fn(),
    };
    window.NEXUS_MEDIA_SESSION = media;
    window.NEXUS_CONVERSATION_PUBLISHER = { publish: jest.fn() };

    let provider = null;
    if (withDiscovery) {
        provider = {
            search: jest.fn(() =>
                Promise.resolve([
                    {
                        id: 'track-1',
                        provider: 'youtube',
                        kind: 'music',
                        title: 'Soft instrumental',
                        creator: 'Example',
                        url: 'https://example.invalid/track-1',
                    },
                ])
            ),
        };
        window.NEXUS_DISCOVERY = {
            warm: jest.fn(() => Promise.resolve([])),
            forCapability: jest.fn((capability) => (capability === 'music.search' ? provider : null)),
        };
    } else {
        delete window.NEXUS_DISCOVERY;
    }

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus: eventBus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;

    panel.stopActivity.mockImplementation((why) => {
        panel.active = null;
        panel.activeActivity = null;
        activity.stop(why || 'panel');
        return true;
    });

    return { activity, adult, blackboard, modes, panel, eventBus, media, provider, preset };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    delete window.NEXUS_BD;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_CONVERSATION_PUBLISHER;
    delete window.NEXUS_DISCOVERY;
    document.body.innerHTML = '';
});

describe('Private runtime integration', () => {
    test('starting Romantic creates a real viewport experience and an active prompt boundary', async () => {
        const s = setup({ preset: 'romantic' });
        const result = await s.activity.start({ input: { id: 'romantic' } });

        expect(result).toEqual(
            expect.objectContaining({ ok: true, preset: 'romantic', maxLevel: 2, experience: 'private-evening' })
        );
        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        expect(s.adult.active).toBe(true);
        expect(s.adult.maxLevel).toBe(2);
        expect(s.modes.activeId).toBe('adult');
        expect(s.blackboard.activity).toBe('intimate');
        expect(document.getElementById('nexus-private-hud')).toBeNull();
        // The heading shows where the evening *is* (P12). The preset is the ceiling, and the ladder
        // in the footer carries it — the two words in two places were the confusing part.
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Warm');
        expect(document.querySelectorAll('[data-private-step]')).toHaveLength(2);
        expect(document.getElementById('speech-text').placeholder).toBe('Talk privately…');
        expect(window.NEXUS_BD_SAY).toHaveBeenCalled();

        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('ACTIVE PRIVATE EXPERIENCE');
        expect(suffix).toContain('Romantic');
        expect(suffix).toContain('Current consent level: 1');
        expect(suffix).toContain('Preset ceiling: 2');
        expect(suffix).toMatch(/consenting adult/i);

        s.activity.stop('user');
        expect(document.getElementById('nexus-private-conversation-row')).toBeNull();
        expect(s.adult.active).toBe(false);
        expect(s.adult.maxLevel).toBe(4);
        expect(s.modes.activeId).toBe('companion');
        expect(s.blackboard.activity).toBe('chat');
        expect(s.blackboard.escalationLevel).toBe(0);
        expect(Capability.privateSystemPromptSuffix()).toBe('');
    });

    test('the prompt names the language, and only when there is one worth naming (P14)', async () => {
        // The rest of this suffix is a page of English, and a model that has just read a page of
        // English is liable to answer in it whatever the request opened with. `AppLanguage`'s
        // directive reaches every provider path now; this is the same instruction in the same block
        // as the rules for this reply, which costs nine tokens.
        const s = setup({ preset: 'romantic' });
        await s.activity.start({ input: { id: 'romantic' } });

        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/^LANGUAGE:/m);

        window.AppLanguage = { code: 'it-IT' };
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('LANGUAGE: Italian (it-IT)');
        // Named inside the tag too: a model told to answer in Italian has been seen translating the
        // tag name along with everything else, and a translated tag is one the parser cannot find.
        expect(suffix).toMatch(/<choices>/);
        delete window.AppLanguage;

        s.activity.stop('user');
    });

    test('Romantic steps to its ceiling on an explicit press, and no further', async () => {
        // The two-minute floor was the cadence for *her* asking. A person pressing the button has
        // asked, so the floor on this route is `userStepMinMs` — enough to outlast a stray finger.
        const s = setup({ preset: 'romantic' });
        await s.activity.start({ input: { id: 'romantic' } });

        expect(document.querySelector('[data-private-action="closer"]')).not.toBeNull();
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();

        expect(s.adult.initiated).toHaveBeenCalledTimes(1);
        // Not through the check-in path: that is the route for a question she asked.
        expect(s.adult.checkIn).not.toHaveBeenCalled();
        expect(s.adult.level).toBe(2);
        expect(s.blackboard.escalationLevel).toBe(2);
        expect(Capability.privateSystemPromptSuffix()).toContain('Current consent level: 2');

        // At the preset's ceiling the forward control is gone, and nothing offers to raise it.
        expect(document.querySelector('[data-private-action="closer"]')).toBeNull();
        jest.advanceTimersByTime(300000);
        expect(s.adult.level).toBe(2);
        expect(document.querySelector('[data-private-action="closer"]')).toBeNull();

        s.activity.stop('user');
    });

    test('Sensual takes two explicit steps to reach level 3 and never opens level 4', async () => {
        const s = setup({ preset: 'sensual' });
        await s.activity.start({ input: { id: 'sensual' } });

        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        expect(s.adult.level).toBe(2);
        expect(s.adult.maxLevel).toBe(3);

        jest.advanceTimersByTime(5000);
        const second = document.querySelector('[data-private-action="closer"]');
        expect(second).not.toBeNull();
        second.click();
        expect(s.adult.level).toBe(3);
        expect(s.adult.maxLevel).toBe(3);

        // The preset's ceiling is the ceiling. Level 4 exists in the profile and is never reachable.
        jest.advanceTimersByTime(30000);
        expect(s.adult.level).toBe(3);
        expect(document.querySelector('[data-private-action="closer"]')).toBeNull();

        s.activity.stop('user');
        expect(s.adult.maxLevel).toBe(4);
    });

    test('Ease up gives back exactly one level, and never ends the experience', async () => {
        const s = setup({ preset: 'sensual' });
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        expect(s.adult.level).toBe(3);

        document.querySelector('[data-private-action="ease"]').click();
        expect(s.adult.eased).toHaveBeenCalledTimes(1);
        // One step, not a jump to the bottom. `exit('soft')` stays the safe word's mechanism.
        expect(s.adult.exit).not.toHaveBeenCalled();
        expect(s.adult.level).toBe(2);
        expect(s.adult.active).toBe(true);
        expect(document.getElementById('nexus-private-conversation-row')).not.toBeNull();

        s.activity.stop('user');
    });

    test('a typed safe word still goes all the way down, through exit', async () => {
        const s = setup({ preset: 'sensual' });
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        expect(s.adult.level).toBe(3);

        s.activity._privateExperience._onUserTurn('this is too much');
        expect(s.adult.exit).toHaveBeenCalledWith('soft');
        expect(s.adult.level).toBe(1);
        expect(s.adult.active).toBe(true);

        s.activity.stop('user');
    });

    test('Private soundtrack search is optional and never replaces media already playing', async () => {
        const idle = setup({ preset: 'affectionate', withDiscovery: true });
        await idle.activity.start({ input: { id: 'affectionate' } });
        await Promise.resolve();
        await Promise.resolve();

        expect(idle.provider.search).toHaveBeenCalledWith(
            expect.stringMatching(/instrumental/i),
            expect.objectContaining({ kind: 'music' })
        );
        expect(idle.media.requestPlay).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.nexus-private-soundtrack').textContent).toContain('Soft instrumental');
        idle.activity.stop('user');
        expect(idle.media.stop).toHaveBeenCalled();

        const existing = setup({ preset: 'affectionate', withDiscovery: true, mediaPlaying: true });
        await existing.activity.start({ input: { id: 'affectionate' } });
        await Promise.resolve();
        expect(existing.provider.search).not.toHaveBeenCalled();
        expect(existing.media.requestPlay).not.toHaveBeenCalled();
        existing.activity.stop('user');
    });

    test('ten enter/exit cycles restore the pre-Private mode and blackboard with no stack drift', async () => {
        const s = setup({ preset: 'affectionate' });
        const originalMode = s.blackboard.mode;
        for (let i = 0; i < 10; i += 1) {
            const started = await s.activity.start({ input: { id: 'affectionate' } });
            expect(started.ok).toBe(true);
            expect(s.modes.activeId).toBe('adult');
            s.activity.stop('cycle');
            expect(s.modes.activeId).toBe('companion');
            expect(s.modes.stack).toHaveLength(0);
            expect(s.blackboard.mode).toBe(originalMode);
            expect(s.blackboard.activity).toBe('chat');
            expect(s.blackboard.escalationLevel).toBe(0);
        }
    });

    test('the private prompt disappears immediately when either trusted gate is lost', async () => {
        const s = setup({ preset: 'romantic' });
        await s.activity.start({ input: { id: 'romantic' } });
        expect(Capability.privateSystemPromptSuffix()).not.toBe('');

        s.blackboard.adultVerified = false;
        expect(Capability.privateSystemPromptSuffix()).toBe('');
        s.blackboard.adultVerified = true;
        s.blackboard.nsfwAllowed = false;
        expect(Capability.privateSystemPromptSuffix()).toBe('');

        s.blackboard.nsfwAllowed = true;
        s.activity.stop('user');
    });
});
