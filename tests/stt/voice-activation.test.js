/**
 * WU. Voice activation, with a fake clock and a fake recognizer.
 *
 * Real microphones, Quest, and iOS are not claimed here. What is claimed:
 * the hold threshold, one submission of a final transcript, wake opt-in,
 * permission failure, echo suppression, and the settings keys. Browser Web
 * Speech and on-device Whisper are represented by their result shapes
 * (interim + confidence, and a single final with no confidence).
 */
const fs = require('fs');
const path = require('path');
const VA = require('../../src/stt/VoiceActivation.js');

function memory() {
    const data = new Map();
    return {
        getItem(k) {
            return data.has(k) ? data.get(k) : null;
        },
        setItem(k, v) {
            data.set(k, String(v));
        },
        removeItem(k) {
            data.delete(k);
        },
        dump() {
            return data;
        },
    };
}

function finalEvent(text, confidence) {
    const alt = { transcript: text };
    if (confidence !== undefined) alt.confidence = confidence;
    const result = [alt];
    result.isFinal = true;
    return { results: [result] };
}

function interimEvent(text) {
    const result = [{ transcript: text, confidence: 0.2 }];
    result.isFinal = false;
    return { results: [result] };
}

function harness(extra) {
    const sends = [];
    const recs = [];
    const storage = extra && extra.storage ? extra.storage : memory();
    class Rec {
        constructor() {
            recs.push(this);
            this.lang = '';
            this.continuous = false;
            this.interimResults = false;
            this.isLocalWhisper = !!(extra && extra.whisper);
            this.isRemoteSonic = !!(extra && extra.remote);
        }
        start() {
            this.started = (this.started || 0) + 1;
            if (this.fail === 'not-allowed') {
                if (this.onerror) this.onerror({ error: 'not-allowed' });
                if (this.onend) this.onend();
                return;
            }
            if (this.onstart) this.onstart();
        }
        stop() {
            this.stopped = true;
            if (this.onend) this.onend();
        }
        abort() {
            this.aborted = true;
        }
    }
    const opts = Object.assign(
        {
            storage,
            recognitionClass: () => Rec,
            send(text) {
                sends.push(text);
            },
            dom: false,
        },
        extra || {}
    );
    delete opts.whisper;
    delete opts.remote;
    delete opts.storage;
    opts.storage = storage;
    const va = VA.createVoiceActivation(opts);
    return { va, sends, recs, storage, Rec };
}

describe('WU hold gesture', () => {
    test('a release before 3000 ms does not activate, and the click still taps', () => {
        const tracker = VA.createHoldTracker({ holdMs: 3000 });
        const actions = [];
        const down = tracker.pointerdown({ pointerId: 1, button: 0, clientX: 0, clientY: 0 }, 1000);
        actions.push(down.action);
        actions.push(tracker.tick(3999).action);
        actions.push(tracker.pointerup({ pointerId: 1 }, 3999).action);
        expect(actions).toEqual(['press', 'ignore', 'release']);
        expect(tracker.click().suppress).toBe(false);
    });

    test('holding to 3000 ms arms, release activates, and the following click is swallowed once', () => {
        const tracker = VA.createHoldTracker({ holdMs: 3000 });
        tracker.pointerdown({ pointerId: 1, button: 0, clientX: 2, clientY: 2 }, 0);
        expect(tracker.tick(2999).action).toBe('ignore');
        expect(tracker.tick(3000).action).toBe('arm');
        expect(tracker.pointerup({ pointerId: 1 }, 3000).action).toBe('activate');
        expect(tracker.click().suppress).toBe(true);
        expect(tracker.click().suppress).toBe(false);
    });

    test('pointer cancellation does not activate', () => {
        const tracker = VA.createHoldTracker({ holdMs: 3000 });
        tracker.pointerdown({ pointerId: 4, button: 0, clientX: 0, clientY: 0 }, 0);
        expect(tracker.pointercancel({ pointerId: 4 }).action).toBe('cancel');
        expect(tracker.tick(3000).action).toBe('ignore');
        expect(tracker.click().suppress).toBe(true);
    });

    test('a drag past the slop cancels before the threshold', () => {
        const tracker = VA.createHoldTracker({ holdMs: 3000, slopPx: 16 });
        tracker.pointerdown({ pointerId: 1, button: 0, clientX: 0, clientY: 0 }, 0);
        expect(tracker.pointermove({ pointerId: 1, clientX: 40, clientY: 0 }).action).toBe('drag-cancel');
        expect(tracker.tick(3000).action).toBe('ignore');
    });

    test('page exit and disabling the control cancel a press in progress', () => {
        const tracker = VA.createHoldTracker({ holdMs: 3000 });
        tracker.pointerdown({ pointerId: 1, button: 0, clientX: 0, clientY: 0 }, 0);
        expect(tracker.pagehide().action).toBe('cancel');
        tracker.pointerdown({ pointerId: 2, button: 0, clientX: 0, clientY: 0 }, 10);
        expect(tracker.disable().action).toBe('cancel');
        expect(tracker.tick(4000).action).toBe('ignore');
    });
});

describe('WU listen button', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    function button() {
        const btn = document.createElement('button');
        btn.id = 'listen-btn';
        document.body.appendChild(btn);
        const taps = [];
        const acts = [];
        const { va } = harness({});
        const types = [];
        const orig = btn.addEventListener.bind(btn);
        btn.addEventListener = (type, fn, opt) => {
            types.push(type);
            return orig(type, fn, opt);
        };
        va.attachHold(btn, {
            onTap: () => taps.push('tap'),
            onActivate: () => acts.push('hold'),
        });
        return { btn, taps, acts, va, types };
    }

    // This jsdom has no PointerEvent. The listeners only read the fields below.
    function pointer(type, id, x, y) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        event.pointerId = id;
        event.button = 0;
        event.clientX = x || 0;
        event.clientY = y || 0;
        return event;
    }

    test('a short tap still calls the normal toggle once', () => {
        const { btn, taps, acts } = button();
        btn.dispatchEvent(pointer('pointerdown', 1));
        btn.dispatchEvent(pointer('pointerup', 1));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(taps).toEqual(['tap']);
        expect(acts).toEqual([]);
    });

    test('a three-second hold activates and does not also tap', () => {
        const { btn, taps, acts } = button();
        btn.dispatchEvent(pointer('pointerdown', 1));
        expect(btn.classList.contains('hold-arming')).toBe(true);
        jest.advanceTimersByTime(3000);
        expect(btn.classList.contains('hold-armed')).toBe(true);
        btn.dispatchEvent(pointer('pointerup', 1));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(acts).toEqual(['hold']);
        expect(taps).toEqual([]);
    });

    test('pointercancel does not activate and does not tap', () => {
        const { btn, taps, acts } = button();
        btn.dispatchEvent(pointer('pointerdown', 1));
        btn.dispatchEvent(pointer('pointercancel', 1));
        jest.advanceTimersByTime(3000);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(acts).toEqual([]);
        expect(taps).toEqual([]);
        expect(btn.classList.contains('hold-armed')).toBe(false);
    });

    test('the hold listeners are not registered twice', () => {
        const { btn, va, types } = button();
        const before = types.filter((t) => t === 'pointerdown').length;
        expect(va.attachHold(btn, { onTap() {} })).toBe(false);
        expect(types.filter((t) => t === 'pointerdown').length).toBe(before);
    });
});

describe('WU utterance completion', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test('silence does not send', () => {
        const { va, sends, recs } = harness({});
        expect(va.captureUtterance({ owner: 'hold' })).toBe(true);
        jest.advanceTimersByTime(7000);
        expect(sends).toEqual([]);
        expect(va.state()).not.toBe('SENDING');
        expect(recs[0].aborted || recs[0].stopped).toBeTruthy();
    });

    test('browser speech: interim is not sent, a final is sent once, confidence is not required', () => {
        const { va, sends, recs } = harness({});
        va.captureUtterance({ owner: 'hold' });
        const rec = recs[0];
        expect(rec.continuous).toBe(true);
        rec.onresult(interimEvent('hel'));
        jest.advanceTimersByTime(899);
        expect(sends).toEqual([]);
        rec.onresult(finalEvent('hello there', 0));
        jest.advanceTimersByTime(899);
        expect(sends).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(sends).toEqual(['hello there']);
        jest.advanceTimersByTime(10000);
        expect(sends).toEqual(['hello there']);
    });

    test('interim text that never becomes final is not sent', () => {
        const { va, sends, recs } = harness({});
        va.captureUtterance({ owner: 'hold' });
        recs[0].onresult(interimEvent('almost'));
        jest.advanceTimersByTime(900);
        expect(sends).toEqual([]);
        expect(recs[0].stopped).toBe(true);
    });

    test('on-device Whisper sends one final and does not invent a confidence gate', () => {
        const { va, sends, recs } = harness({ whisper: true });
        va.captureUtterance({ owner: 'hold' });
        const rec = recs[0];
        expect(rec.continuous).toBe(false);
        expect(rec.isLocalWhisper).toBe(true);
        rec.onaudioend && rec.onaudioend();
        expect(va.state()).toBe('TRANSCRIBING');
        rec.onresult(finalEvent('ciao'));
        expect(sends).toEqual(['ciao']);
        expect(recs).toHaveLength(1);
    });

    test('a remote recognizer with no confidence is sent once', () => {
        const { va, sends, recs } = harness({ remote: true });
        va.captureUtterance({ owner: 'assist' });
        recs[0].onresult(finalEvent('pronto'));
        expect(sends).toEqual(['pronto']);
    });

    test('a second capture while one is open does not start another recognizer', () => {
        const { va, recs } = harness({});
        expect(va.captureUtterance({ owner: 'hold' })).toBe(true);
        expect(va.captureUtterance({ owner: 'hold' })).toBe(false);
        expect(recs).toHaveLength(1);
    });

    test('a cancelled generation cannot send or restart recognition', () => {
        const { va, sends, recs } = harness({});
        va.captureUtterance({ owner: 'hold' });
        const handler = recs[0].onresult;
        const starts = recs[0].started || 1;
        va.cancel('hidden');
        handler(finalEvent('should not send'));
        jest.advanceTimersByTime(30000);
        expect(sends).toEqual([]);
        expect(recs).toHaveLength(1);
        expect(recs[0].started || starts).toBe(starts);
        expect(va.state()).toBe('PAUSED');
    });
});

describe('WU auto-send setting', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('with auto-send off the final is not submitted', () => {
        const filled = [];
        const { va, sends, recs } = harness({
            fillInput(text) {
                filled.push(text);
            },
        });
        va.setAutoSend(false);
        va.captureUtterance({ owner: 'hold' });
        recs[0].onresult(finalEvent('hold this', 0.99));
        jest.advanceTimersByTime(900);
        expect(sends).toEqual([]);
        expect(filled).toContain('hold this');
    });
});

describe('WU wake policy', () => {
    test('the plan is off unless the page switch is on, even if Companion overlay wake is stored', () => {
        expect(VA.monitorPlan({ enabled: false, overlayWake: true, detectorLocal: true })).toBe('off');
        expect(VA.monitorPlan({ enabled: true, paused: true, detectorLocal: true })).toBe('paused');
        expect(VA.monitorPlan({ enabled: true, hidden: true })).toBe('paused');
        expect(VA.monitorPlan({ enabled: true, speaking: true, detectorLocal: true })).toBe('suspended');
        expect(VA.monitorPlan({ enabled: true, companionActive: true, detectorLocal: true })).toBe('companion');
        expect(VA.monitorPlan({ enabled: true, detectorLocal: true })).toBe('local-detector');
        expect(VA.monitorPlan({ enabled: true, canVad: true, recognition: true })).toBe('vad-then-stt');
        expect(VA.monitorPlan({ enabled: true })).toBe('manual-only');
        expect(VA.monitorPlan({ enabled: true, detectorLocal: true })).not.toBe('continuous-cloud');
    });

    test('a wake hit is ignored when disabled, paused, hidden, echoing, unauthorized, or unmatched', () => {
        expect(VA.decideWake({ enabled: false, matched: true, authorized: true }).reason).toBe('disabled');
        expect(VA.decideWake({ enabled: true, paused: true, matched: true, authorized: true }).reason).toBe('paused');
        expect(VA.decideWake({ enabled: true, speaking: true, matched: true, authorized: true }).reason).toBe('echo');
        expect(VA.decideWake({ enabled: true, echo: true, matched: true, authorized: true }).reason).toBe('echo');
        expect(VA.decideWake({ enabled: true, matched: true, authorized: false }).reason).toBe('unauthorized');
        expect(VA.decideWake({ enabled: true, matched: false, authorized: true }).reason).toBe('mismatch');
        expect(VA.decideWake({ enabled: true, permission: 'denied', matched: true, authorized: true }).action).toBe(
            'error'
        );
        expect(
            VA.decideWake({ enabled: true, matched: true, authorized: true, command: 'what time is it' }).action
        ).toBe('send-command');
        expect(VA.decideWake({ enabled: true, matched: true, authorized: true, command: '' }).action).toBe('session');
    });

    test('wake detection does not start a recognizer until the person opts in', () => {
        const starts = [];
        const detector = {
            local: true,
            start(hooks) {
                starts.push(hooks);
            },
            stop() {},
        };
        const { va, recs } = harness({ detector: () => detector });
        va.sync();
        expect(starts).toHaveLength(0);
        va.decideWake({ enabled: false, matched: true, authorized: true });
        expect(recs).toHaveLength(0);
    });

    test('an opted-in local detector opens one authorized command session and not before', () => {
        const starts = [];
        const detector = {
            local: true,
            start(hooks) {
                starts.push(hooks);
            },
            stop() {},
        };
        const { va, recs, sends } = harness({ detector: () => detector });
        va.setWakeEnabled(true);
        expect(va.plan()).toBe('local-detector');
        expect(starts).toHaveLength(1);
        expect(recs).toHaveLength(0);
        starts[0].onWake({ transcript: '' });
        expect(recs).toHaveLength(1);
        expect(va.state()).toBe('LISTENING');
        expect(va.owner()).toBe('wake');
        expect(sends).toEqual([]);
    });

    test('a cloud-shaped detector is refused', () => {
        const detector = { local: false, start() {}, stop() {} };
        const { va } = harness({ detector: () => detector });
        va.setWakeEnabled(true);
        expect(va.plan()).not.toBe('local-detector');
    });

    test('avatar speech cannot wake a session', () => {
        jest.useFakeTimers();
        const starts = [];
        const detector = {
            local: true,
            start(hooks) {
                starts.push(hooks);
            },
            stop() {},
        };
        const { va, recs, sends } = harness({ detector: () => detector });
        va.setWakeEnabled(true);
        va.noteSpoken('hey nexus what time is it');
        va.noteSpeaking(true);
        starts[0].onWake({ transcript: 'hey nexus' });
        expect(recs).toHaveLength(0);
        expect(sends).toEqual([]);
        expect(VA.decideWake({ enabled: true, speaking: true, matched: true, authorized: true }).reason).toBe('echo');
        va.noteSpeaking(false);
        jest.useRealTimers();
    });

    test('microphone permission denial fails closed', () => {
        const seen = [];
        const { va, sends } = harness({
            recognitionClass() {
                return class Deny {
                    constructor() {
                        seen.push(this);
                    }
                    start() {
                        if (this.onerror) this.onerror({ error: 'not-allowed' });
                        if (this.onend) this.onend();
                    }
                    stop() {}
                    abort() {
                        this.aborted = true;
                    }
                };
            },
        });
        expect(va.captureUtterance({ owner: 'hold' })).toBe(true);
        expect(sends).toEqual([]);
        expect(va.state()).toBe('ERROR');
        expect(seen).toHaveLength(1);
    });
});

describe('WU settings', () => {
    test('settings persist across a new controller and overlay wake does not opt in', () => {
        const storage = memory();
        storage.setItem('overlay_wakeword', 'on');
        storage.setItem('overlay_wakephrase', 'ava');
        const first = VA.createVoiceActivation({ storage, dom: false, recognitionClass: () => null });
        const migration = first.migrate();
        expect(migration.copiedPhrase).toBe(true);
        expect(migration.enabledStaysOff).toBe(true);
        expect(first.settings().wakeEnabled).toBe(false);
        expect(first.settings().phrase).toBe('ava');
        expect(storage.getItem('nexus_wake_enabled')).not.toBe('on');
        first.setWakeEnabled(true);
        first.setPhrase('hey nexus');
        first.setAutoSend(false);
        first.setContinuous(true);
        first.pause();
        const second = VA.createVoiceActivation({ storage, dom: false, recognitionClass: () => null });
        expect(second.settings()).toMatchObject({
            wakeEnabled: true,
            phrase: 'hey nexus',
            autoSend: false,
            continuous: true,
            paused: true,
        });
        expect(second.settings().overlayWakeWord).toBe(true);
        second.sync();
        expect(second.plan()).toBe('paused');
    });

    test('Italian and English labels and the default phrase follow the language', () => {
        const en = VA.labelsFor('en-US');
        const it = VA.labelsFor('it-IT');
        expect(en.wakeListening).not.toBe(it.wakeListening);
        expect(en.wakeTitle).toBe('WAKE UP');
        expect(it.wakeSpeak).toMatch(/Parla/);
        expect(VA.defaultPhrase('en-US')).toBe('hey nexus');
        expect(VA.defaultPhrase('it-IT')).toBe('ehi nexus');
        const english = harness({ language: () => 'en-GB' });
        english.va.captureUtterance({ owner: 'assist' });
        expect(english.recs[0].lang).toBe('en-GB');
        english.va.cancel('hidden');
        const italian = harness({ language: () => 'it-IT' });
        italian.va.captureUtterance({ owner: 'assist' });
        expect(italian.recs[0].lang).toBe('it-IT');
        italian.va.cancel('hidden');
        expect(italian.va.settings().phrase).toBe('ehi nexus');
        expect(italian.va.label('wakeStandby')).toBe(it.wakeStandby);
    });
});

describe('WU arbitration and privacy', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('VR and Companion already holding the mic block a second recognizer', () => {
        const { va, recs } = harness({});
        expect(va.claim('vr')).toBe(true);
        expect(va.adopt('vr', 'LISTENING')).toBe(true);
        expect(va.captureUtterance({ owner: 'wake' })).toBe(false);
        expect(va.claim('companion')).toBe(false);
        expect(recs).toHaveLength(0);
        va.release('vr');
        expect(va.claim('companion')).toBe(true);
    });

    test('private speech is delivered once and is not written to the diagnostic log', () => {
        const logs = [];
        const spy = jest.spyOn(console, 'info').mockImplementation((...args) => {
            logs.push(args.map(String).join(' '));
        });
        const { va, sends, recs } = harness({ whisper: true, isPrivate: () => true });
        va.captureUtterance({ owner: 'hold' });
        recs[0].onresult(finalEvent('secret private words'));
        expect(sends).toEqual(['secret private words']);
        expect(logs.join('\n')).not.toContain('secret');
        expect(logs.join('\n')).toContain('submit-private');
        spy.mockRestore();
    });

    test('the page wires the hold into the existing conversation owner', () => {
        const root = path.resolve(__dirname, '../..');
        const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const companion = fs.readFileSync(path.join(root, 'src/CompanionMode.js'), 'utf8');
        const vr = fs.readFileSync(path.join(root, 'src/gltf-viewer/VRChatIntegration.js'), 'utf8');
        expect(main).toMatch(/send: \(text\) => handleUserMessage\(text\)/);
        expect(main).toMatch(/voiceActivation\.attachHold\(listenBtn/);
        expect(main).toMatch(/function startVoiceInput\(\)/);
        expect(html).toMatch(/id="wake-up-section"/);
        expect(html).toMatch(/src="src\/stt\/VoiceActivation\.js"/);
        expect(companion).toMatch(/VA\.claim\('companion'\)|VA\.claim && !VA\.claim\('companion'\)/);
        expect(vr).toMatch(/claim\('vr'\)/);
        expect(vr).toMatch(/release\?\.\('vr'\)/);
        // Private turns still enter through the conversation surface inside handleUserMessage.
        expect(main).toMatch(/function handleUserMessage\(text\) \{[\s\S]*?_surface\(\)\.renderUser\(text\)/);
    });
});
