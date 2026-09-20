/**
 * Two screens to start a private moment, and never one that only says "wait".
 *
 * The first attempt at preparing-before-playing exposed all four internal states as screens:
 * configure, a preparing screen with four ticking rows, a ready screen, then Begin. Four
 * screens and two confirmations for something that should feel spontaneous. This pins the
 * redesign: mood, atmosphere, playing — with the work started the instant a mood is chosen and
 * raced against a budget rather than watched.
 *
 * It also pins the scene bug that shipped with the first attempt. `SceneCatalog.list()`
 * concatenates every registered source, so a scene the built-ins and an imported pack both
 * carry came back twice and rendered twice.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Capability = require('../../src/features/together/TogetherCapability.js');

Capability.installPrivateRuntime(PlaygroundActivity);

const SCENES = [
    { id: 'candlelit', label: 'Candlelit Room' },
    { id: 'sunset', label: 'Sunset Terrace' },
];

function track() {
    return { id: 'trk-00000001', provider: 'youtube', kind: 'music', title: 'Soft piano', url: 'https://x.invalid/1' };
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
        this.checkIn = jest.fn(() => ({ ok: false }));
        this.hear = jest.fn(() => ({ action: 'heard', level: 1 }));
    }
}

function setup({ withMusic = true, scenes = SCENES, onSearch = null, onPlan = null, hangPlan = false } = {}) {
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
    };
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_SCENE_CATALOG = { list: () => scenes.map((s) => ({ ...s })) };
    const applied = [];
    window.NEXUS_SCENE_AMBIENCE_CONTROLLER = {
        currentScene: () => 'black',
        apply: jest.fn((id, opts) => {
            applied.push({ id, ...opts });
            return { changed: true, id };
        }),
    };
    const search = jest.fn(() => {
        if (onSearch) onSearch();
        return Promise.resolve(withMusic ? [track()] : []);
    });
    window.NEXUS_DISCOVERY = { warm: () => Promise.resolve([]), forCapability: () => ({ search }) };
    if (onPlan || hangPlan) {
        const beats = require('../../src/features/together/PrivateBeats.js');
        window.NEXUS_PRIVATE_BEATS = {
            ...beats,
            plan: jest.fn((args) => {
                if (onPlan) onPlan();
                return hangPlan ? new Promise(() => {}) : beats.plan(args);
            }),
        };
    }

    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    window.NEXUS_BD.intimate = activity;
    panel.register(activity);
    // The chooser has to be open before a setup screen paints: `_paint` bails on a closed panel.
    panel.open();
    return { panel, activity, adult, applied, search };
}

const rows = () => [...document.querySelectorAll('.nexus-private-progress-row')].map((r) => r.textContent.trim());
const action = (name) => document.querySelector(`[data-action="${name}"]`);

/** Let the prepare chain settle: it awaits a plan and a search. */
async function settle() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/**
 * Step 2 → the checklist → the summary (P20).
 *
 * `Get ready →` loads the evening and `Begin →` starts it, so a test that wants a running session
 * walks both. Named rather than inlined because six tests do it and the interesting assertion is
 * never this hop.
 */
async function getReady() {
    action('ready-private').click();
    await settle();
    await settle();
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    delete window.NEXUS_BD;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_SCENE_CATALOG;
    delete window.NEXUS_SCENE_AMBIENCE_CONTROLLER;
    delete window.NEXUS_DISCOVERY;
    delete window._nexusLLM;
    delete window.NEXUS_PRIVATE_BEATS;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('two screens, not four', () => {
    test('step one asks one question and nothing else', () => {
        const s = setup();
        s.panel.choose('intimate');

        expect(document.querySelectorAll('.nexus-private-preset')).toHaveLength(3);
        // No scene list, no music form, no duration, no progress: one decision.
        expect(document.querySelectorAll('input[name="private-scene"]')).toHaveLength(0);
        expect(document.querySelector('.nexus-private-segmented')).toBeNull();
        expect(document.querySelector('.nexus-private-progress-row')).toBeNull();
        expect(document.querySelector('[data-step="1"]')).not.toBeNull();
    });

    test('choosing a mood continues and starts the work at once', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();

        expect(s.activity.sessionState).toBe('atmosphere');
        expect(document.querySelector('[data-step="2"]')).not.toBeNull();
        // Prefetch, before anybody is waiting on it.
        expect(s.activity.prepared).not.toBeNull();
        await settle();
        expect(s.search).toHaveBeenCalledTimes(1);
        // And nothing has entered the consent flow.
        expect(s.adult.enter).not.toHaveBeenCalled();
    });

    test('step two loads, and the summary is what begins (P20)', async () => {
        // This used to assert the opposite — that `Begin` went straight to playing. That was the
        // defect: it began into whatever state the machine happened to be in, which is how a
        // first line got spoken before there was a voice to say it in. Three screens now, and the
        // third one is a checklist of work that actually happened.
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();

        await getReady();
        expect(s.activity.sessionState).toBe('ready');
        expect(s.adult.enter).not.toHaveBeenCalled();
        expect(document.querySelector('[data-preflight-summary="1"]')).not.toBeNull();

        action('begin-private').click();
        await settle();

        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        expect(s.activity.active).toBe(true);
        s.activity.stop('user');
    });

    test('Back on step two returns to the mood question', () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="sensual"]').click();
        action('edit-private').click();

        expect(s.activity.sessionState).toBe('mood');
        expect(document.querySelectorAll('.nexus-private-preset')).toHaveLength(3);
    });
});

describe('the work is concurrent, and budgeted', () => {
    test('the music lookup does not wait for the plan', async () => {
        // The property, stated as the failure it prevents: serially the wait was planning
        // plus searching. With the planner hung forever, a serial implementation never
        // searches at all — and this one has the track in hand.
        const s = setup({ hangPlan: true });
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();

        expect(s.search).toHaveBeenCalledTimes(1);
        expect(s.activity.preparedPlan).toBeNull();
    });

    test('a planner that never answers shows a named step, not a frozen card', async () => {
        // The old version of this pinned a hidden 2.5-second budget that `Begin` raced. The budget
        // is gone; the checklist is what replaced it. A step that is still running says so by
        // name, which is the whole reason the screen exists.
        const s = setup({ hangPlan: true });
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();

        action('ready-private').click();
        await settle();

        expect(s.adult.enter).not.toHaveBeenCalled();
        expect(s.activity.sessionState).toBe('preparing');
        const story = document.querySelector('[data-preflight-step="story"]');
        expect(story).not.toBeNull();
        expect(['pending', 'running']).toContain(story.dataset.preflightState);
        // And it is cancellable, rather than a screen you are stuck on.
        action('cancel-preflight').click();
        expect(s.activity.sessionState).toBe('atmosphere');
    });

    test('a prepared evening passes the checklist without repeating any of the work', async () => {
        // The performance property, and the reason the screen is usually brief: the preflight
        // waits on the promises `prewarm` already started rather than starting its own. One
        // search for the whole wizard, however many screens it passes through.
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();

        await getReady();
        expect(s.search).toHaveBeenCalledTimes(1);
        expect(s.activity.preflightShown.ready).toBe(true);

        action('begin-private').click();
        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        expect(s.search).toHaveBeenCalledTimes(1);
        s.activity.stop('user');
    });

    test('the session plays what was prepared rather than searching again', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        await settle();
        await getReady();
        action('begin-private').click();
        await settle();

        const session = s.activity._privateExperience;
        expect(session.plan).toBe(s.activity.preparedPlan);
        expect(session.track).toEqual(expect.objectContaining({ id: 'trk-00000001' }));
        expect(s.search).toHaveBeenCalledTimes(1);
        s.activity.stop('user');
    });
});

describe('the scenes are connected, and each appears once', () => {
    test('a scene carried by two sources is offered once', () => {
        // The shipped bug: Ocean, Meditation Garden and Coastal Terrace rendered two and three
        // times over, because the catalogue concatenates its sources.
        const s = setup({
            scenes: [
                { id: 'ocean', label: 'Ocean' },
                { id: 'garden', label: 'Meditation Garden' },
                { id: 'ocean', label: 'Ocean' },
                { id: 'garden', label: 'Meditation Garden' },
            ],
        });
        expect(s.activity.scenes().map((e) => e.id)).toEqual(['ocean', 'garden']);
    });

    test('at most three scenes plus the current one, with the rest behind More', () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ id: `scene-${i}`, label: `Scene ${i}` }));
        const s = setup({ scenes: many });
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();

        // The current place, plus three.
        expect(document.querySelectorAll('.nexus-private-scene-card')).toHaveLength(4);
        expect(action('more-scenes')).not.toBeNull();

        action('more-scenes').click();
        expect(document.querySelectorAll('.nexus-private-scene-card')).toHaveLength(10);
    });

    test('music is three buttons rather than a radio form', () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();

        expect([...document.querySelectorAll('.nexus-private-segment')].map((b) => b.textContent)).toEqual([
            'Auto',
            'Keep',
            'Off',
        ]);
        document.querySelector('[data-music="none"]').click();
        expect(s.activity.soundtrackChoice).toBe('none');
    });

    test('a chosen scene is applied on Begin and restored on exit', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="sensual"]').click();
        document.querySelector('[data-scene="candlelit"]').click();
        await settle();
        expect(s.applied).toHaveLength(0);

        await getReady();
        action('begin-private').click();
        await settle();
        expect(s.applied).toEqual([{ id: 'candlelit', source: 'private' }]);

        s.activity.stop('user');
        expect(s.applied[s.applied.length - 1]).toEqual({ id: 'black', source: 'private' });
    });

    test('keeping this place never touches the background', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelector('[data-preset="affectionate"]').click();
        await settle();
        await getReady();
        action('begin-private').click();
        await settle();

        expect(s.applied).toHaveLength(0);
        s.activity.stop('user');
        expect(s.applied).toHaveLength(0);
    });

    test('no catalogue means the current place and nothing else', () => {
        const s = setup({ scenes: [] });
        s.panel.choose('intimate');
        document.querySelector('[data-preset="romantic"]').click();
        expect(document.querySelectorAll('.nexus-private-scene-card')).toHaveLength(1);
        expect(action('more-scenes')).toBeNull();
    });
});

describe('a returning person gets there in two taps', () => {
    test('the last setup is offered, and starts without the wizard', async () => {
        localStorage.setItem(
            'nexus_private_prefs',
            JSON.stringify({
                preset: 'romantic',
                mood: 'tender',
                soundtrack: 'choose',
                scene: 'candlelit',
                sessions: 3,
                lastAt: 1,
            })
        );
        const s = setup();
        s.panel.choose('intimate');

        const again = document.querySelector('[data-private-last="1"]');
        expect(again).not.toBeNull();
        expect(again.textContent).toMatch(/Romantic/);
        expect(again.textContent).toMatch(/Candlelit Room/);

        action('private-again').click();
        await settle();
        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        expect(s.activity._privateExperience.scene).toBe('candlelit');
        s.activity.stop('user');
    });

    test('a newcomer is not offered a last time', () => {
        const s = setup();
        s.panel.choose('intimate');
        expect(document.querySelector('[data-private-last="1"]')).toBeNull();
    });
});
