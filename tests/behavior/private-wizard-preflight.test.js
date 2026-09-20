/**
 * The third step of the wizard, where the loading actually is (P20).
 *
 * `private-preflight.test.js` covers the state machine against a hand-driven clock. This covers
 * the wizard: that the screens exist, that the marks say what really happened, that a required
 * failure keeps somebody on the summary rather than dropping them into a broken evening, and —
 * the performance property — that passing through three screens does not repeat a single piece
 * of the work step 1 already started.
 *
 * The flow this replaced raced a hidden 2.5-second budget:
 *
 *     win.setTimeout(once, PRIVATE_START_BUDGET);
 *     activity.prepared.then(once, once);
 *
 * Whichever won, the session began in whatever state the machine happened to be in.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const Preflight = require('../../src/features/together/PrivatePreflight.js');
const Locale = require('../../src/features/together/PrivateLocale.js');

Capability.installPrivateRuntime(PlaygroundActivity);

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
        this.checkIn = jest.fn(() => ({ ok: false }));
        this.hear = jest.fn(() => ({ action: 'heard', level: 1 }));
    }
}

/** A page where every step can succeed, so a test names only what it breaks. */
function setup({ reply = 'ready', voices = [{ name: 'a voice' }], intents = true, decodes = true } = {}) {
    document.body.innerHTML =
        '<div id="host"></div><div id="chat-history"></div><input id="speech-text"><button id="speak-btn">Send</button>';
    const panel = TogetherPanel.attach({
        consent: { state: 'idle', onChange: () => () => {}, revoke: () => true },
        doc: document,
        win: window,
    });
    panel.mount(document.getElementById('host'));

    const adult = new AdultFlowMock();
    const bus = { emit: jest.fn(), on: jest.fn(() => () => {}) };
    window.NEXUS_BD = {
        blackboard: {
            adultVerified: true,
            nsfwAllowed: true,
            activity: 'chat',
            scene: { id: 'black', label: 'Black' },
        },
        modes: { activeId: 'companion', activate: () => true, deactivate: () => true },
        adult,
        bus,
        togetherPanel: panel,
        intimate: null,
        registry: { forIntent: () => (intents ? [{ id: 'a-clip' }] : []) },
    };
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_SCENE_CATALOG = {
        list: () => [{ id: 'candlelit', label: 'Candlelit Room', src: 'assets/ambient/dark/ocean-moonlight.webp' }],
    };
    window.NEXUS_SCENE_AMBIENCE_CONTROLLER = { currentScene: () => 'black', apply: jest.fn(() => ({ changed: true })) };
    const search = jest.fn(() => Promise.resolve([{ id: 'trk-1', kind: 'music', title: 'Soft piano' }]));
    window.NEXUS_DISCOVERY = { warm: () => Promise.resolve([]), forCapability: () => ({ search }) };
    window.speechSynthesis = { getVoices: () => voices, addEventListener: () => {}, removeEventListener: () => {} };
    const sendMessage = jest.fn(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)));
    window._nexusLLM = { sendMessage };
    // jsdom has no decoder; the preload path only needs an object that fires one of the handlers.
    window.Image = class {
        set src(_value) {
            if (decodes) setTimeout(() => this.onload && this.onload(), 0);
            else setTimeout(() => this.onerror && this.onerror(), 0);
        }
    };

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    window.NEXUS_BD.intimate = activity;
    panel.register(activity);
    panel.open();
    return { panel, activity, adult, search, sendMessage };
}

const action = (name) => document.querySelector(`[data-action="${name}"]`);

/**
 * Only the preflight's own probe.
 *
 * `PrivateBeats.plan` is an LLM request too, so counting every `sendMessage` would count the
 * planner's. The probe is the one that asks for a single word.
 */
const probes = (s) => s.sendMessage.mock.calls.filter((call) => /one word/i.test(String(call[1] || ''))).length;
const steps = () =>
    Object.fromEntries(
        [...document.querySelectorAll('[data-preflight-step]')].map((row) => [
            row.dataset.preflightStep,
            row.dataset.preflightState,
        ])
    );

async function settle() {
    for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Mood → atmosphere → the checklist, and wait for it. */
async function toChecklist(s, preset = 'romantic', scene = 'candlelit') {
    s.panel.choose('intimate');
    document.querySelector(`[data-preset="${preset}"]`).click();
    if (scene) document.querySelector(`[data-scene="${scene}"]`).click();
    await settle();
    action('ready-private').click();
    await settle();
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    for (const key of [
        'NEXUS_BD',
        'NEXUS_TOGETHER_SWITCH',
        'NEXUS_BD_SAY',
        'NEXUS_SCENE_CATALOG',
        'NEXUS_SCENE_AMBIENCE_CONTROLLER',
        'NEXUS_DISCOVERY',
        '_nexusLLM',
        'speechSynthesis',
        'Image',
    ]) {
        delete window[key];
    }
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('the checklist is real work, named', () => {
    test('every step the module declares appears, and lands', async () => {
        const s = setup();
        await toChecklist(s);

        expect(s.activity.sessionState).toBe('ready');
        expect(Object.keys(steps()).length).toBe(0); // the checklist is gone; the summary replaced it
        const summary = document.querySelector('[data-preflight-summary="1"]');
        expect(summary).not.toBeNull();
        for (const step of Preflight.STEPS) {
            expect(summary.textContent).toContain(Locale.t(step.key));
        }
    });

    test('the work happened — a probe at the real budget, a search, a decode', async () => {
        const s = setup();
        await toChecklist(s);

        // Not a plausible interval: the provider was actually asked, and the scene actually loaded.
        expect(probes(s)).toBe(1);
        expect(s.search).toHaveBeenCalledTimes(1);
        expect(s.activity.preflightShown.list.find((e) => e.id === 'place').state).toBe('done');
    });

    test('a step that had nothing to do says skipped, not done', async () => {
        // "Keep this place" loads no scene. A ✓ there would be the checklist claiming work it
        // never performed, which is the same picture whether or not it worked.
        const s = setup();
        await toChecklist(s, 'romantic', null);
        expect(s.activity.preflightShown.list.find((e) => e.id === 'place').state).toBe('skipped');
        expect(s.activity.preflightShown.ready).toBe(true);
    });

    test('and the summary is in the card language, not English by construction', async () => {
        window.AppLanguage = { code: 'it-IT' };
        const s = setup();
        await toChecklist(s);
        const summary = document.querySelector('[data-preflight-summary="1"]');
        expect(summary.textContent).toContain(Locale.PACKS['it-IT']['preflight.voice']);
        expect(summary.textContent).not.toContain(Locale.PACKS['en-US']['preflight.voice']);
        delete window.AppLanguage;
    });
});

describe('a required failure keeps them here', () => {
    test('a provider that answers nothing blocks, and Begin is not offered', async () => {
        // The reported first turn, caught one screen earlier: the model produced no visible token
        // inside its allowance, and the card printed "No response" under a HER label.
        const s = setup({ reply: '' });
        await toChecklist(s);

        expect(s.activity.preflightShown.ready).toBe(false);
        expect(document.querySelector('[data-preflight-blocked="1"]')).not.toBeNull();
        expect(action('begin-private')).toBeNull();
        expect(action('retry-preflight')).not.toBeNull();
        expect(s.adult.enter).not.toHaveBeenCalled();
    });

    test('an EmptyCompletionError is the same answer, not a crash', async () => {
        const boom = new Error('stopped at the token limit');
        boom.name = 'EmptyCompletionError';
        const s = setup({ reply: boom });
        await toChecklist(s);
        expect(s.activity.preflightShown.list.find((e) => e.id === 'model').state).toBe('failed');
    });

    test('retry runs it again rather than replaying the stored failure', async () => {
        const s = setup({ reply: '' });
        await toChecklist(s);
        expect(probes(s)).toBe(1);

        s.sendMessage.mockImplementation(() => Promise.resolve('ready'));
        action('retry-preflight').click();
        await settle();

        expect(probes(s)).toBe(2);
        expect(s.activity.preflightShown.ready).toBe(true);
        expect(action('begin-private')).not.toBeNull();
    });

    test('Start anyway is offered, secondary, because it is their machine', async () => {
        const s = setup({ reply: '' });
        await toChecklist(s);
        const anyway = action('begin-anyway');
        expect(anyway).not.toBeNull();
        anyway.click();
        await settle();
        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        s.activity.stop('user');
    });

    test('an optional failure does not block anything', async () => {
        // No clip for any of her three intents is worth saying and is not worth stopping for: a
        // missing clip plays nothing, the same fail-soft every caller of the intent bus gets.
        const s = setup({ intents: false });
        await toChecklist(s);
        expect(s.activity.preflightShown.list.find((e) => e.id === 'movement').state).toBe('failed');
        expect(s.activity.preflightShown.ready).toBe(true);
        expect(action('begin-private')).not.toBeNull();
    });
});

describe('performance: three screens, one of each piece of work', () => {
    test('the preflight waits on what prewarm started rather than starting again', async () => {
        const s = setup();
        await toChecklist(s);
        action('begin-private').click();
        await settle();

        // One search for the whole wizard — step 1's prefetch, reused by the checklist and again
        // by the session. Before the cache, changing the scene on step 2 fired a fresh one each
        // time and the preflight would have added another.
        expect(s.search).toHaveBeenCalledTimes(1);
        s.activity.stop('user');
    });

    test('changing your mind on step two does not multiply the media lookups', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();
        // Three changes, each of which calls `prewarm`.
        document.querySelector('[data-scene="candlelit"]').click();
        document.querySelector('[data-scene="current"]').click();
        document.querySelector('[data-scene="candlelit"]').click();
        await settle();

        expect(s.search).toHaveBeenCalledTimes(1);
    });

    test('and flipping between two scenes asks the planner once per scene, not once per click', async () => {
        // Generating a plan is an LLM request, and `prewarm` runs on every change to step 2. Two
        // distinct questions, however many times you change your mind between them.
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();
        const before = s.sendMessage.mock.calls.length;
        for (let i = 0; i < 3; i += 1) {
            document.querySelector('[data-scene="candlelit"]').click();
            document.querySelector('[data-scene="current"]').click();
        }
        await settle();
        // At most one more question than the two places involved; never one per click.
        expect(s.sendMessage.mock.calls.length - before).toBeLessThanOrEqual(2);
    });

    test('the session starts from what the checklist prepared', async () => {
        const s = setup();
        await toChecklist(s);
        action('begin-private').click();
        await settle();

        const session = s.activity._privateExperience;
        expect(session.plan).toBe(s.activity.preparedPlan);
        expect(session.track).toEqual(expect.objectContaining({ id: 'trk-1' }));
        s.activity.stop('user');
    });
});

describe('cancelling', () => {
    test('goes back to step two and abandons the run', async () => {
        const s = setup({ reply: new Promise(() => {}) });
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();
        action('ready-private').click();

        expect(s.activity.sessionState).toBe('preparing');
        action('cancel-preflight').click();

        expect(s.activity.sessionState).toBe('atmosphere');
        expect(s.activity.preflightShown).toBeNull();
        expect(action('ready-private')).not.toBeNull();
    });
});
