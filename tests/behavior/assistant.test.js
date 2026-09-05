/**
 * Embodied HomePilot, client side (B21).
 *
 * The acceptance criterion is mostly a server one — "good morning" produces a panel, a
 * spoken summary and exactly one confirm-level tool call — and it is tested where those
 * things are built, in `HomePilot/backend/tests/avatar/test_assistant.py`. What is testable
 * here is the half the client owns, and the half it deliberately does not have:
 *
 *   * attention. She looks at the panel, points at it once if it is hers, and drifts back
 *     to you — and puts `activityTarget` back exactly as she found it.
 *   * silence. Not one word of a brief originates in this module.
 *   * the absence of a second approval path. Not "there is no handler" but "there is no
 *     frame" — the protocol carries no action for a handler to run.
 */

/* global describe, test, expect, beforeEach */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const SessionAdapter = require('../../src/behavior/adapters/SessionAdapter.js');
const PanelRenderer = require('../../src/features/together/panels/PanelRenderer.js');
const Assistant = require('../../src/features/together/activities/assistant.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'assistant.js');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

/** Source with comments removed — every grep in this repo has matched its own prose once. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function harness({ target = 'user' } = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    blackboard.activityTarget = target;
    const intents = [];
    bus.on('intent', (intent) => intents.push(intent));
    let clock = 1000;
    const now = () => clock;
    const assistant = Assistant.attach({ bus, blackboard, now });
    return { bus, blackboard, assistant, intents, tick: (ms) => (clock += ms), at: () => clock };
}

// ── attention ────────────────────────────────────────────────────────────────

describe('she looks at the panel she just put up', () => {
    test('a shown panel takes her attention', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        expect(h.blackboard.activityTarget).toBe(Assistant.PANEL_TARGET);
        expect(h.assistant.stats.attending).toBe('agenda');
    });

    test('she points at it, once', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        expect(h.intents.filter((i) => i.name === Assistant.POINT)).toHaveLength(1);
        expect(h.assistant.stats.pointed).toBe(1);
    });

    test('a redrawn panel at the same instant does not make her point again', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'stats', lines: 4 });
        h.bus.emit('panel:shown', { kind: 'stats', lines: 4 });
        expect(h.intents.filter((i) => i.name === Assistant.POINT)).toHaveLength(1);
    });

    test('the gesture is a name, not a filename', () => {
        expect(Assistant.POINT).toBe('point');
        expect(Assistant.POINT).not.toMatch(/\.(fbx|glb|vrma|bvh)$/i);
    });

    test('she gestures gently — this is a nod at a screen, not stage direction', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        expect(h.intents[0].intensity).toBeLessThanOrEqual(0.6);
    });

    test('she looks at a card the user made but does not point at it', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'share', lines: 2 });
        expect(h.blackboard.activityTarget).toBe(Assistant.PANEL_TARGET);
        expect(h.assistant.stats.pointed).toBe(0);
    });

    test('a kind she does not attend to is ignored entirely', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'nonsense' });
        expect(h.blackboard.activityTarget).toBe('user');
        expect(h.assistant.stats.attending).toBeNull();
    });
});

describe('and then she looks back at you', () => {
    test('attention drifts back after the window', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        h.tick(Assistant.ATTENTION_MS + 1);
        expect(h.assistant.update()).toEqual({ kind: 'agenda', why: 'drifted' });
        expect(h.blackboard.activityTarget).toBe('user');
    });

    test('a tick inside the window changes nothing', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        h.tick(Assistant.ATTENTION_MS - 1);
        expect(h.assistant.update()).toBeNull();
        expect(h.blackboard.activityTarget).toBe(Assistant.PANEL_TARGET);
    });

    test('closing the panel releases her attention', () => {
        const h = harness();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        h.bus.emit('panel:closed', { kind: 'agenda', why: 'user' });
        expect(h.blackboard.activityTarget).toBe('user');
        expect(h.assistant.stats.attending).toBeNull();
    });

    test('a tick with no panel up does nothing at all', () => {
        const h = harness();
        expect(h.assistant.update()).toBeNull();
        expect(h.assistant.stats.drifted).toBe(0);
    });
});

describe('the world goes back exactly as she found it', () => {
    test('a panel over a film hands the film back', () => {
        const h = harness({ target: 'screen' });
        h.bus.emit('panel:shown', { kind: 'tool_result', lines: 2 });
        h.bus.emit('panel:closed', { kind: 'tool_result', why: 'user' });
        expect(h.blackboard.activityTarget).toBe('screen');
    });

    test('ten show/close cycles leave it unchanged', () => {
        const h = harness({ target: 'screen' });
        for (let i = 0; i < 10; i++) {
            h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
            h.tick(100);
            h.bus.emit('panel:closed', { kind: 'agenda', why: 'user' });
        }
        expect(h.blackboard.activityTarget).toBe('screen');
        expect(h.assistant.stats.shown).toBe(10);
    });

    test('a second panel while one is up does not overwrite the original snapshot', () => {
        // The bug this guards: snapshotting on every show would capture "panel" as the
        // thing to restore, and she would never look away again.
        const h = harness({ target: 'screen' });
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        h.bus.emit('panel:shown', { kind: 'stats', lines: 4 });
        h.bus.emit('panel:closed', { kind: 'stats', why: 'user' });
        expect(h.blackboard.activityTarget).toBe('screen');
    });

    test('detach releases whatever was held', () => {
        const h = harness({ target: 'screen' });
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        h.assistant.detach();
        expect(h.blackboard.activityTarget).toBe('screen');
    });

    test('after detach a panel no longer moves her', () => {
        const h = harness({ target: 'screen' });
        h.assistant.detach();
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        expect(h.blackboard.activityTarget).toBe('screen');
    });
});

// ── silence ──────────────────────────────────────────────────────────────────

describe('not one word of a brief originates here', () => {
    const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));

    test('the module never speaks', () => {
        for (const token of ['NEXUS_BD_SAY', 'speakText', 'speechSynthesis', '.say(']) {
            expect(source).not.toContain(token);
        }
    });

    test('the stripper is not vacuous', () => {
        expect(source).toContain('class Assistant');
        expect(source).toContain('ATTENTION_MS');
    });

    test('showing a panel emits nothing but the one gesture', () => {
        const h = harness();
        const seen = [];
        for (const event of ['tts:start', 'session:up', 'scene:enter', 'vision:insight']) {
            h.bus.on(event, () => seen.push(event));
        }
        h.bus.emit('panel:shown', { kind: 'agenda', lines: 3 });
        expect(seen).toEqual([]);
        expect(h.intents.map((i) => i.name)).toEqual([Assistant.POINT]);
    });
});

// ── no tool runs outside the safety layer ────────────────────────────────────

describe('there is no second approval path, because there is no frame', () => {
    const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));

    test('the module cannot reach anything', () => {
        for (const token of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.send', 'import(']) {
            expect(source).not.toContain(token);
        }
    });

    test('it has no approve, execute or confirm', () => {
        const assistant = Assistant.attach({ bus: new EventBus(), blackboard: new Blackboard() });
        for (const verb of ['approve', 'execute', 'run', 'confirm', 'call', 'send']) {
            expect(typeof assistant[verb]).toBe('undefined');
        }
    });

    test('the protocol carries no message type that could be an action', () => {
        // The stronger statement. A handler is absent because the frame is absent: a
        // proposal lives in `x_directives` on the chat response, which DayPilot reads and
        // drafts behind its own Approval Center. It never reaches this client at all.
        const bus = new EventBus();
        const adapter = new SessionAdapter.Adapter({ bus, config: CONFIG, blackboard: new Blackboard() });
        const forbidden = ['tool_call', 'proposal', 'approve', 'execute', 'action', 'directive'];
        for (const type of forbidden) {
            const result = adapter.receive({ v: 1, type });
            expect(result.action).toBe('ignored');
            expect(result.why).toBe('unknown type');
        }
    });

    test('an unknown frame does not close the session', () => {
        const bus = new EventBus();
        const adapter = new SessionAdapter.Adapter({ bus, config: CONFIG, blackboard: new Blackboard() });
        adapter.receive({ v: 1, type: 'tool_call', capability: 'email.send' });
        adapter.receive({ v: 1, type: 'ping' });
        expect(adapter.stats.dropped.unknownType).toBe(1);
    });
});

// ── the brief, end to end through the client's own seams ─────────────────────

describe('a brief arrives as three ordinary frames', () => {
    function client() {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        blackboard.activityTarget = 'user';
        const spoken = [];
        const intents = [];
        bus.on('intent', (i) => intents.push(i));
        const panels = PanelRenderer.attach({
            bus,
            three: null,
            makeCanvas: () => ({
                width: 2048,
                height: 1152,
                getContext: () => ({
                    fillRect() {},
                    fillText() {},
                    measureText: () => ({ width: 100 }),
                    save() {},
                    restore() {},
                    clearRect() {},
                    beginPath() {},
                    moveTo() {},
                    lineTo() {},
                    stroke() {},
                    set font(v) {},
                    set fillStyle(v) {},
                    set strokeStyle(v) {},
                    set textBaseline(v) {},
                    set textAlign(v) {},
                }),
            }),
        });
        const assistant = Assistant.attach({ bus, blackboard, panels });
        const adapter = new SessionAdapter.Adapter({
            bus,
            config: CONFIG,
            blackboard,
            panels,
            say: (text) => spoken.push(text),
        });
        return { bus, blackboard, panels, assistant, adapter, spoken, intents };
    }

    const BRIEF = [
        {
            v: 1,
            type: 'display',
            kind: 'agenda',
            data: {
                title: 'Today',
                items: [
                    { key: '09:00', value: 'Standup' },
                    { key: '11:30', value: 'Dentist' },
                ],
            },
        },
        { v: 1, type: 'intent', name: 'point', intensity: 0.5, source: 'assistant' },
        { v: 1, type: 'say', text: "Morning. You've got standup and dentist.", source: 'assistant' },
    ];

    test('panel, gesture, sentence — in that order', () => {
        const c = client();
        const results = BRIEF.map((frame) => c.adapter.receive(frame));
        expect(results.map((r) => r.action)).toEqual(['applied', 'emitted', 'spoken']);
        expect(c.panels.stats.showing).toBe('agenda');
        expect(c.spoken).toHaveLength(1);
    });

    test('the panel goes up before the sentence about it', () => {
        // Narrating into space is exactly this in the wrong order.
        const c = client();
        c.adapter.receive(BRIEF[0]);
        expect(c.blackboard.activityTarget).toBe(Assistant.PANEL_TARGET);
        c.adapter.receive(BRIEF[2]);
        expect(c.spoken[0]).toContain('Morning');
    });

    test('she points because the panel went up, not because the server told her to', () => {
        // Only the display frame is delivered; the gesture is the client's own reading of
        // its own screen. That is what makes it embodiment rather than remote control.
        const c = client();
        c.adapter.receive(BRIEF[0]);
        expect(c.intents.map((i) => i.name)).toEqual(['point']);
        expect(c.intents[0].source).toBe('assistant');
    });

    test('a client with no renderer takes the sentence and ignores the panel', () => {
        const bus = new EventBus();
        const spoken = [];
        const adapter = new SessionAdapter.Adapter({
            bus,
            config: CONFIG,
            blackboard: new Blackboard(),
            say: (text) => spoken.push(text),
        });
        expect(adapter.receive(BRIEF[0])).toEqual({ action: 'ignored', why: 'no panel renderer' });
        expect(adapter.receive(BRIEF[2]).action).toBe('spoken');
        expect(spoken).toHaveLength(1);
    });
});
