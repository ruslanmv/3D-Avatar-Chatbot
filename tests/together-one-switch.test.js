/**
 * One switch for Together, and the paragraph that stops her apologising (batches T1, T2).
 *
 * The transcript this work exists to change:
 *
 *     YOU    can you find music about relaxation
 *     NEXUS  I'm sorry, but I don't have the capability to directly find specific music…
 *     YOU    can you play it
 *     NEXUS  I'm sorry, but I don't have the ability to directly play music.
 *
 * She was right, and that is the point. Nothing in her system prompt had ever said this app can
 * search and play media, so "I can't" was the only honest answer available. Adding patterns to
 * the intent matcher would not have fixed it — a pattern that misses hands the message to the
 * same uninformed model, and no list of patterns is ever complete.
 */

const Switch = require('../src/features/together/TogetherSwitch.js');
const Capability = require('../src/features/together/TogetherCapability.js');

const REGISTRY = { forCapability: () => ({ search: async () => [] }), why: () => 'ok', warm: async () => [] };

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_DISCOVERY = REGISTRY;
    delete window.NEXUS_DISCOVERY_SAMPLES;
});

describe('three states, because two would lose the one that matters', () => {
    test('a fresh profile has not turned it on', () => {
        // "Never touched" and "deliberately off" are different facts. Collapsing them would
        // either turn Together on for people who have not asked for it, or make the first tap
        // do nothing.
        expect(Switch.state()).toBeNull();
        expect(Switch.isOn()).toBe(false);
    });

    test('but it can still see it — the launcher is how you turn it on', () => {
        expect(Switch.isVisible()).toBe(true);
    });

    test('using it turns it on', () => {
        expect(Switch.enable('tile')).toBe(true);
        expect(Switch.isOn()).toBe(true);
        expect(Switch.lastReason()).toBe('tile');
    });

    test('and turning it on again is not an event', () => {
        // The tile handler calls this on every press without caring whether it is the first.
        Switch.enable('tile');
        expect(Switch.enable('tile')).toBe(false);
    });

    test('off hides it and keeps it off', () => {
        Switch.enable('tile');
        expect(Switch.disable('settings')).toBe(true);
        expect(Switch.isOn()).toBe(false);
        expect(Switch.isVisible()).toBe(false);
    });

    test('the choice survives a reload', () => {
        Switch.enable('tile');
        expect(localStorage.getItem(Switch.KEY)).toBe('on');
        // A fresh module instance reading the same storage — what a reload actually is.
        jest.resetModules();
        const reloaded = require('../src/features/together/TogetherSwitch.js');
        expect(reloaded.isOn()).toBe(true);
    });

    test('listeners hear a change, and only a change', () => {
        const seen = [];
        const stop = Switch.onChange((v) => seen.push(v));
        Switch.enable('tile');
        Switch.enable('tile');
        Switch.disable('settings');
        stop();
        Switch.enable('tile');
        expect(seen).toEqual(['on', 'off']);
    });

    test('a browser with no storage still works for the life of the page', () => {
        // Private mode, an embedded webview. There is no stored opt-out to honour, so the
        // launcher shows and using it works — it just cannot be remembered.
        const real = window.localStorage;
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('denied');
            },
        });
        try {
            Switch.reset();
            expect(Switch.isVisible()).toBe(true);
            expect(Switch.enable('tile')).toBe(true);
            expect(Switch.isOn()).toBe(true);
        } finally {
            Object.defineProperty(window, 'localStorage', { configurable: true, value: real });
        }
    });
});

describe('she is told what she can do', () => {
    test('nothing is added before Together is on', () => {
        // A fresh chat sends the prompt it has always sent, byte for byte.
        expect(Capability.systemPromptSuffix()).toBe('');
    });

    test('once it is on, the prompt says she can play media', () => {
        Switch.enable('tile');
        const suffix = Capability.systemPromptSuffix();
        expect(suffix).toContain('search for and play music and video');
        expect(suffix).toContain('<play kind="music">');
    });

    test('and tells her not to ask first, which is what the transcript did wrong', () => {
        // Her second turn was asking whether to search, getting "yes", and then listing genres
        // instead of playing anything. Every extra turn is a chance to lose the thread.
        //
        // Asserted by intent rather than by sentence. An earlier version pinned the exact
        // string "Do not ask permission first", so rewording the paragraph broke a test whose
        // claim was still true — the test was measuring the prose, not the instruction.
        Switch.enable('tile');
        const suffix = Capability.systemPromptSuffix();
        // `\s+`, not a space: the paragraph is hard-wrapped, so the phrase spans a line break.
        expect(suffix).toMatch(/do not ask\s+permission/i);
        expect(suffix).toMatch(/choose something\s+yourself/i);
    });

    test('and that proposing is a way of asking', () => {
        // Observed live: "How about some soothing acoustic guitar to help you unwind? 🎶" —
        // no tag, nothing played. It obeys "do not ask permission" to the letter and still
        // leaves the person waiting, so the instruction has to name it.
        Switch.enable('tile');
        expect(Capability.systemPromptSuffix()).toMatch(/do not\s+propose/i);
    });

    test('and that an indirect request is still a request', () => {
        // "I want to relax" is a request for music. Recognising that is the whole reason the
        // model is in this path — a regex could have caught "play relaxing music" alone.
        Switch.enable('tile');
        expect(Capability.systemPromptSuffix()).toContain('I want to relax');
    });

    test('and to write at most one tag', () => {
        Switch.enable('tile');
        expect(Capability.systemPromptSuffix()).toMatch(/at most one tag/i);
    });

    test('turning it off takes the promise away with the launcher', () => {
        // A switch that hides the button while she still offers to play music is worse than no
        // switch: the failure is invisible until somebody takes her up on it.
        Switch.enable('tile');
        Switch.disable('settings');
        expect(Capability.systemPromptSuffix()).toBe('');
    });

    test('nothing is promised when nothing can search', () => {
        Switch.enable('tile');
        window.NEXUS_DISCOVERY = { forCapability: () => null, why: () => 'no-key' };
        expect(Capability.systemPromptSuffix()).toBe('');
    });

    test('but the keyless samples count as being able to play something', () => {
        // With no API key anywhere she can still play the fallback, so she can still truthfully
        // say she can play something.
        Switch.enable('tile');
        window.NEXUS_DISCOVERY = { forCapability: () => null, why: () => 'no-key' };
        window.NEXUS_DISCOVERY_SAMPLES = require('../src/features/discovery/samples.js');
        expect(Capability.systemPromptSuffix()).not.toBe('');
    });

    test('a registry that throws is a registry that cannot search', () => {
        Switch.enable('tile');
        window.NEXUS_DISCOVERY = {
            forCapability: () => {
                throw new Error('boom');
            },
        };
        expect(() => Capability.systemPromptSuffix()).not.toThrow();
        expect(Capability.systemPromptSuffix()).toBe('');
    });
});

describe('the wiring', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    test('every prompt site appends it, beside the ones already there', () => {
        const main = read('src/main.js');
        const motion = (main.match(/NEXUS_MOTION\?\.systemPromptSuffix/g) || []).length;
        const capability = (main.match(/NEXUS_TOGETHER_CAPABILITY\?\.systemPromptSuffix/g) || []).length;
        // One per site that already carries the motion suffix, plus the shared helper the
        // OpenAI and Claude paths use.
        expect(capability).toBeGreaterThanOrEqual(motion);
    });

    test('choosing a tile turns the switch on', () => {
        const panel = read('src/features/together/ui/TogetherPanel.js');
        const choose = panel.slice(panel.indexOf('        choose(id) {'), panel.indexOf('        choose(id) {') + 1200);
        expect(choose).toMatch(/NEXUS_TOGETHER_SWITCH[\s\S]{0,200}enable\('tile'\)/);
    });

    test('the launcher hides itself when the switch is off', () => {
        const launcher = read('src/features/together/ui/TogetherLauncher.js');
        expect(launcher).toContain('_reflectSwitch');
        expect(launcher).toMatch(/isVisible/);
    });

    test('Settings has one Together row, not seven', () => {
        const html = read('index.html');
        expect(html).toContain('together-enabled-toggle');
        expect((html.match(/id="together-[a-z-]*toggle"/g) || []).length).toBe(1);
    });

    test('the modules load before anything that reads them', () => {
        const boot = read('src/behavior/boot.js');
        const sw = boot.indexOf('TogetherSwitch.js');
        const cap = boot.indexOf('TogetherCapability.js');
        const launcher = boot.indexOf('TogetherLauncher.js');
        expect(sw).toBeGreaterThan(-1);
        expect(cap).toBeGreaterThan(sw);
        expect(launcher).toBeGreaterThan(cap);
    });
});
