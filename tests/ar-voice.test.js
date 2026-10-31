/**
 * AR2 — the AR microphone shows what the browser really did.
 *
 * Pinned: CompanionMode's public conversation API (startConversation / stopConversation /
 * conversationStatus + the `companion-conversation` event) reports "listening" only once the
 * browser opened the microphone, and reports a blocked or missing microphone as an error a caller
 * can show; ARConversation.voiceView turns that into the AR button and status line; and phone AR
 * no longer reaches into CompanionMode's private fields.
 */

const fs = require('fs');
const path = require('path');
const AR = require('../src/gltf-viewer/ARConversation.js');

require('../src/CompanionMode.js');
const CompanionMode = window.CompanionMode;

/** A SpeechRecognition the test drives by hand, as the browser would. */
class FakeRecognition {
    constructor() {
        FakeRecognition.last = this;
        this.started = false;
    }
    start() {
        this.started = true;
    }
    stop() {
        if (this.onend) this.onend();
    }
    abort() {
        this.stop();
    }
}

let events;
const record = (e) => events.push(e.detail);

beforeEach(() => {
    events = [];
    window.addEventListener('companion-conversation', record);
    localStorage.clear();
});

afterEach(() => {
    window.removeEventListener('companion-conversation', record);
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
});

function companion() {
    const cm = new CompanionMode({ interactive: false });
    cm._toast = jest.fn(); // the companion's own toast is not what this test is about
    return cm;
}

describe('CompanionMode — the public conversation API', () => {
    test('no speech recognition: refused with a reason, and said as an event', () => {
        const cm = companion();
        const r = cm.startConversation();
        expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(cm.conversationStatus().live).toBe(false);
        expect(events.find((d) => d.event === 'error')).toMatchObject({ reason: 'unsupported' });
    });

    test('a started call is live but not "listening" until the browser opens the mic', () => {
        window.SpeechRecognition = FakeRecognition;
        const cm = companion();
        expect(cm.startConversation()).toEqual({ ok: true });
        expect(cm.conversationStatus()).toMatchObject({ live: true, state: 'listening', micReady: false });
        expect(events.some((d) => d.event === 'mic-open')).toBe(false);

        FakeRecognition.last.onstart(); // the browser opened the microphone
        expect(cm.conversationStatus().micReady).toBe(true);
        expect(events.filter((d) => d.event === 'mic-open')).toHaveLength(1);

        cm.stopConversation();
        expect(cm.conversationStatus()).toMatchObject({ live: false, state: 'idle', micReady: false });
    });

    test('a blocked microphone ends the call and says why — before the idle state', () => {
        window.SpeechRecognition = FakeRecognition;
        const cm = companion();
        cm.startConversation();
        FakeRecognition.last.onerror({ error: 'not-allowed' });
        FakeRecognition.last.onend();
        const errorAt = events.findIndex((d) => d.event === 'error');
        expect(events[errorAt]).toMatchObject({ reason: 'mic-blocked' });
        expect(events[errorAt].message).toMatch(/blocked/i);
        const idleAfter = events.findIndex((d, i) => i > errorAt && d.state === 'idle');
        expect(idleAfter).toBeGreaterThan(errorAt);
        expect(cm.conversationStatus().live).toBe(false);
    });

    test('starting twice is harmless', () => {
        window.SpeechRecognition = FakeRecognition;
        const cm = companion();
        cm.startConversation();
        expect(cm.startConversation()).toMatchObject({ ok: true, already: true });
        cm.stopConversation();
    });
});

describe('ARConversation.voiceView — what the AR button and status line show', () => {
    test('asked but not yet open: active, not listening, says it is opening', () => {
        const v = AR.voiceView({ live: true, state: 'listening', micReady: false });
        expect(v).toMatchObject({ active: true, listening: false });
        expect(v.status).toMatch(/opening/i);
    });

    test('open: listening', () => {
        expect(AR.voiceView({ live: true, state: 'listening', micReady: true })).toMatchObject({
            active: true,
            listening: true,
        });
    });

    test('thinking, speaking and muted are not "listening"', () => {
        for (const state of ['thinking', 'speaking', 'muted']) {
            expect(AR.voiceView({ live: true, state, micReady: true }).listening).toBe(false);
        }
    });

    test('each error has a sentence that says what to do, and turns the mic off', () => {
        for (const reason of ['mic-blocked', 'mic-busy', 'unsupported']) {
            const v = AR.voiceView({ event: 'error', reason });
            expect(v).toMatchObject({ active: false, listening: false });
            expect(v.status).toMatch(/tap|type/i);
        }
        expect(AR.voiceView({ event: 'error', reason: 'other', message: 'x' }).status).toBe('x');
    });

    test('a call that ended leaves the status line alone (an error message stays readable)', () => {
        expect(AR.voiceView({ live: false, state: 'idle' })).toEqual({ active: false, listening: false, status: null });
    });
});

describe('wiring — phone AR uses only the public API', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf-8');
    const overlay = main.slice(
        main.indexOf('(function initAROverlay() {'),
        main.indexOf('PATCH_LLM_PROXY_TEST_CONNECTION_V1')
    );
    const code = overlay
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');

    test('no private CompanionMode fields, no polling', () => {
        expect(code).not.toMatch(/cm\._startLive|cm\._stopLive|cm\._live\b|cm\._convState/);
        expect(code).not.toMatch(/setInterval\(/);
        expect(code).toMatch(/cm\.startConversation\(\)/);
        expect(code).toMatch(/cm\.stopConversation\(\)/);
    });

    test('the button and status come from the conversation events', () => {
        expect(code).toMatch(/addEventListener\('companion-conversation'/);
        expect(code).toMatch(/AR\.voiceView\(detail, arT\)/);
    });
});
