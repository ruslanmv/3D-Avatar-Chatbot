/**
 * HV-FIX Batch 2. The Settings microphone test with STT PROVIDER = SonicAgent.
 *
 * At 4222934 it recorded with its own capture, never contacted SonicAgent, and ended with
 * "Sound detected · no words recognized — The browser's recognizer returned nothing." Here it
 * runs the REAL remote recognizer (the class the mic button uses) over a scripted microphone
 * and voice link, so every assertion is about the actual path.
 */

require('../../src/stt/SpeechAudio.js');
const Stream = require('../../src/stt/StreamingSttSession.js');
const Events = require('../../src/stt/RemoteSttEvents.js');
const Remote = require('../../src/stt/RemoteSonicAgentSTT.js');
const SS = require('../../src/stt/SttSettings.js');

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

function page() {
    document.body.innerHTML = `
        <button id="close-settings">x</button>
        <div class="config-section">
          <div class="input-group"><select id="stt-provider">
            <option value="webspeech">Web Speech</option><option value="wasm">On-device</option>
            <option value="sonicagent-stream">SonicAgent</option></select>
            <p class="voice-status">old line</p></div>
          <div id="wasm-stt-settings"><div class="input-group"><select id="wasm-model-size">
            <option value="tiny">Tiny</option></select></div></div>
          <div class="input-group"><select id="stt-language"><option value="en-US">English</option></select></div>
          <div class="input-group"><select id="stt-microphone"><option value="">Default</option></select></div>
        </div>`;
}

function harness({ gate = { ok: true } } = {}) {
    page();
    window.SpeechService = { saveSTTConfig: () => {}, getSTTConfig: () => ({ wasm: { modelSize: 'tiny' } }) };
    window.NEXUS_STT = {
        status: () => ({ model: 'ready', progress: null, config: { downloadMB: 41 } }),
        preload: () => Promise.resolve(),
        clearCache: () => Promise.resolve(0),
        transcribeSamples: jest.fn(),
    };
    // The browser's recognizer must never be constructed for SonicAgent.
    window.webkitSpeechRecognition = jest.fn();
    window.SpeechRecognition = window.webkitSpeechRecognition;
    const leases = [];
    const mic = {
        open(o) {
            let resolve;
            const lease = {
                o,
                closed: false,
                ready: new Promise((r) => (resolve = r)),
                isOpen: () => lease.granted && !lease.closed,
                close() {
                    if (lease.closed) return;
                    lease.closed = true;
                    if (!lease.granted) resolve({ ok: false, reason: 'cancelled' });
                },
                grant() {
                    lease.granted = true;
                    resolve({ ok: true, sampleRate: 16000 });
                },
            };
            leases.push(lease);
            return lease;
        },
    };
    window.NEXUS_MIC_SESSION = { get: () => mic };
    const listeners = { event: new Set(), close: new Set(), audio: new Set() };
    let seq = 0;
    const link = {
        binary: [],
        control: [],
        ensure: async () => ({ ok: true, options: Stream.WANTED_OPTIONS }),
        on: (t, fn) => (listeners[t].add(fn), () => listeners[t].delete(fn)),
        emit: (t, ev) => Array.from(listeners[t]).forEach((fn) => fn(ev)),
        sendBinary: (b) => link.binary.push(Stream.decodeFrame(b)),
        sendControl: (c) => link.control.push(c),
        retain: () => () => {},
        nextSequence: () => seq,
        setNextSequence: (n) => (seq = n),
    };
    window.NEXUS_SONIC_STREAM = Object.assign({}, Stream, { shared: () => link });
    window.NEXUS_REMOTE_STT_EVENTS = Events;
    window.NEXUS_REMOTE_STT = Remote;
    window.NEXUS_SONIC_VOICE = {
        allowed: () => gate,
        language: () => 'en',
        get: () => ({ voice: '' }),
    };
    expect(SS.mount(document)).toBe(true);
    document.getElementById('stt-provider').value = 'sonicagent-stream';
    const $ = (s) => document.querySelector(s);
    return {
        leases,
        link,
        button: () => $('#stt-mic-test button'),
        chip: () => $('#stt-mic-test .stt-chip').textContent,
        heard: () => $('#stt-mic-test .stt-heard').textContent,
        lit: () => document.querySelectorAll('#stt-mic-test .stt-meter span.on').length,
    };
}

afterEach(() => {
    for (const k of [
        'SpeechService',
        'NEXUS_STT',
        'NEXUS_MIC_SESSION',
        'NEXUS_SONIC_STREAM',
        'NEXUS_REMOTE_STT',
        'NEXUS_REMOTE_STT_EVENTS',
        'NEXUS_SONIC_VOICE',
        'webkitSpeechRecognition',
        'SpeechRecognition',
    ])
        delete window[k];
});

test('the provider line describes SonicAgent, not the browser', () => {
    const text = SS.providerText('sonicagent-stream', false);
    expect(text).toMatch(/OllaBridge Cloud to SonicAgent/);
    expect(text).toMatch(/not your browser’s recognition service/);
    expect(SS.providerText('webspeech', false)).toMatch(/browser vendor/);
    expect(SS.providerText('wasm', false)).not.toMatch(/SonicAgent/);
});

test('a real round trip: one capture, frames up, commit on Stop, the matching final shown', async () => {
    const t = harness();
    t.button().click();
    await flush();
    expect(t.leases).toHaveLength(1); // the recognizer's own capture — no second one for a meter
    t.leases[0].grant();
    await flush();
    expect(t.chip()).toBe('Listening through SonicAgent…');
    t.leases[0].o.onFrames(
        Float32Array.from({ length: 640 }, (_, i) => 0.4 * Math.sin(i / 3)),
        16000
    );
    expect(t.lit()).toBeGreaterThan(0); // the meter reads the recognizer's own level
    expect(t.link.binary.length).toBeGreaterThan(0);
    t.button().click(); // Stop
    await flush();
    expect(t.chip()).toBe('Transcribing with SonicAgent…');
    expect(t.button().disabled).toBe(true);
    const commit = t.link.binary.at(-1);
    expect(commit.flags).toBe(Stream.FLAG_END);
    t.link.emit('event', { type: 'transcript.final', text: 'hello sonic', commit_seq: commit.sequence });
    t.link.emit('event', { type: 'transcript.final', text: 'hello sonic', commit_seq: commit.sequence }); // repeat
    await flush();
    expect(t.chip()).toMatch(/^Recognized by SonicAgent · \d[\d,]* ms after Stop$/);
    expect(t.heard()).toBe('hello sonic');
    expect(t.leases[0].closed).toBe(true);
    expect(window.webkitSpeechRecognition).not.toHaveBeenCalled();
    expect(t.button().disabled).toBe(false);
});

test('no microphone permission: nothing opened, nothing sent, the exact sentence', async () => {
    const t = harness({ gate: { ok: false, code: 'no_consent' } });
    t.button().click();
    await flush();
    expect(t.leases).toHaveLength(0);
    expect(t.link.binary).toHaveLength(0);
    expect(t.heard()).toBe(
        'Allow microphone upload to SonicAgent before testing remote recognition: tick the box under STT PROVIDER.'
    );
});

test('no OllaBridge connection says so', async () => {
    const t = harness({ gate: { ok: false, code: 'not_configured' } });
    t.button().click();
    await flush();
    expect(t.heard()).toBe('Connect OllaBridge Cloud to use SonicAgent speech recognition.');
});

test('an empty final is "No speech recognized by SonicAgent", never the browser', async () => {
    const t = harness();
    t.button().click();
    await flush();
    t.leases[0].grant();
    await flush();
    t.button().click();
    await flush();
    t.link.emit('event', { type: 'transcript.final', text: '', commit_seq: t.link.binary.at(-1).sequence });
    await flush();
    expect(t.heard()).toBe('No speech recognized by SonicAgent.');
    expect(t.heard()).not.toMatch(/browser/i);
});

test('a warming Space is named as such', async () => {
    const t = harness();
    t.link.ensure = async () => ({ ok: false, code: 'backend_warming', retryAfter: 20 });
    t.button().click();
    await flush();
    t.leases[0].grant();
    await flush();
    expect(t.heard()).toBe('SonicAgent is warming up.');
    expect(t.leases[0].closed).toBe(true);
});

test('Stop before the microphone opened is safe: nothing recorded, nothing sent', async () => {
    const t = harness();
    t.button().click();
    await flush();
    t.button().click(); // released before permission resolved
    await flush();
    expect(t.leases[0].closed).toBe(true);
    expect(t.link.binary).toHaveLength(0);
});

test('closing Settings mid-test releases the microphone and tells SonicAgent', async () => {
    const t = harness();
    t.button().click();
    await flush();
    t.leases[0].grant();
    await flush();
    t.leases[0].o.onFrames(new Float32Array(640).fill(0.2), 16000);
    t.button().click(); // Stop: the commit is in flight
    await flush();
    document.getElementById('close-settings').click();
    await flush();
    expect(t.leases[0].closed).toBe(true);
    expect(t.link.control).toContainEqual({ type: 'turn.cancel', target: 'stt' });
    // A final that arrives afterwards changes nothing.
    t.link.emit('event', { type: 'transcript.final', text: 'late', commit_seq: t.link.binary.at(-1).sequence });
    await flush();
    expect(t.heard()).not.toBe('late');
});
