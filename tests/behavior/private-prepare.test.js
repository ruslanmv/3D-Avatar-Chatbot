/**
 * Private prepares before it plays, the way Scene Tale always has.
 *
 * Private went straight from "pick a preset" to a running session, and every piece of
 * asynchronous work — planning her beats, searching for a track — happened *after* Begin, while
 * she had already started talking. So the first line anybody heard was a written fallback with
 * the real plan still in flight, and the soundtrack turned up some seconds into an evening that
 * had begun without it.
 *
 * And the room: `adult.profile` has always declared `scenes: ['sunset', 'candlelit']`, and
 * nothing in the repository ever read that field. The setup screen showed the current place as
 * a read-only label and the session never touched the background.
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

function setup({ withMusic = true, scenes = SCENES } = {}) {
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
    const search = jest.fn(() => Promise.resolve(withMusic ? [track()] : []));
    window.NEXUS_DISCOVERY = { warm: () => Promise.resolve([]), forCapability: () => ({ search }) };

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
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('the intermediate state', () => {
    test('choosing a preset prepares rather than starting', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[1].click();

        document.querySelector('.nexus-private-begin').click();

        // Preparing, not playing: the consent flow has not been entered.
        expect(s.activity.sessionState).toBe('preparing');
        expect(s.adult.enter).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(4);
        expect(action('cancel-private')).not.toBeNull();

        await settle();
        expect(s.activity.sessionState).toBe('ready');
    });

    test('the steps tick over as the work is done', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();

        // On the ready screen now, so re-open preparing to read the final state of the rows.
        expect([...s.activity.prepareProgress].sort()).toEqual(['music', 'pace', 'scene', 'words']);
    });

    test('ready says what was prepared, and only Begin starts it', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[1].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();

        const summary = document.querySelector('.nexus-private-ready').textContent;
        expect(summary).toMatch(/Romantic/);
        expect(summary).toMatch(/Soundtrack ready/);
        expect(s.adult.enter).not.toHaveBeenCalled();

        action('begin-private').click();
        await settle();
        expect(s.adult.enter).toHaveBeenCalledTimes(1);
        expect(s.activity.active).toBe(true);

        s.activity.stop('user');
    });

    test('the session plays the prepared plan and track rather than searching again', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();
        expect(s.search).toHaveBeenCalledTimes(1);

        action('begin-private').click();
        await settle();

        const session = s.activity._privateExperience;
        expect(session.plan).toBe(s.activity.preparedPlan);
        expect(session.track).toEqual(expect.objectContaining({ id: 'trk-00000001' }));
        // Not a second search: the evening was prepared.
        expect(s.search).toHaveBeenCalledTimes(1);

        s.activity.stop('user');
    });

    test('no soundtrack found is said plainly rather than hidden', async () => {
        const s = setup({ withMusic: false });
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();

        expect(document.querySelector('.nexus-private-ready').textContent).toMatch(/No soundtrack found/);
        expect(s.activity.sessionState).toBe('ready');
    });

    test('cancel and Edit setup both go back to the first screen', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        action('cancel-private').click();
        expect(s.activity.sessionState).toBe('configure');
        expect(document.querySelector('.nexus-private-preset-grid')).not.toBeNull();

        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();
        action('edit-private').click();
        expect(s.activity.sessionState).toBe('configure');
    });

    test('a cancelled prepare cannot land its result afterwards', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        action('cancel-private').click();
        await settle();

        expect(s.activity.sessionState).toBe('configure');
        expect(s.activity.preparedPlan).toBeNull();
    });
});

describe('the scenes are connected', () => {
    test('every catalogue scene is offered, alongside keeping this one', () => {
        const s = setup();
        s.panel.choose('intimate');
        const values = [...document.querySelectorAll('input[name="private-scene"]')].map((r) => r.value);
        expect(values).toEqual(['current', 'candlelit', 'sunset']);
        expect(document.querySelector('input[name="private-scene"]').checked).toBe(true);
    });

    test('a chosen scene is applied on Begin and restored on exit', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[2].click();
        document.querySelector('input[name="private-scene"][value="candlelit"]').click();
        document.querySelector('.nexus-private-begin').click();
        await settle();

        // Named on the ready screen, and not applied yet — nothing has started.
        expect(document.querySelector('.nexus-private-ready').textContent).toMatch(/Candlelit Room/);
        expect(s.applied).toHaveLength(0);

        action('begin-private').click();
        await settle();
        expect(s.applied).toEqual([{ id: 'candlelit', source: 'private' }]);

        s.activity.stop('user');
        // Snapshot and restore, so an evening's room never leaks into the rest of the app.
        expect(s.applied[s.applied.length - 1]).toEqual({ id: 'black', source: 'private' });
    });

    test('keeping this place touches the background at all', async () => {
        const s = setup();
        s.panel.choose('intimate');
        document.querySelectorAll('.nexus-private-preset')[0].click();
        document.querySelector('.nexus-private-begin').click();
        await settle();
        action('begin-private').click();
        await settle();

        expect(s.applied).toHaveLength(0);
        s.activity.stop('user');
        expect(s.applied).toHaveLength(0);
    });

    test('no catalogue means no scene row and no crash', () => {
        const s = setup({ scenes: [] });
        delete window.NEXUS_SCENE_CATALOG;
        s.panel.choose('intimate');
        expect([...document.querySelectorAll('input[name="private-scene"]')].map((r) => r.value)).toEqual(['current']);
    });
});
