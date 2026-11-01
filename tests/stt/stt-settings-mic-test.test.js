/**
 * ST8 — the STT section: choices apply at once, and the microphone test is honest.
 *
 * Pinned: picking On-device Whisper writes stt_config immediately (closing Settings with ✕ used
 * to leave the browser recognizer in force — on a Quest, the mic then heard nothing); the meter
 * lights only from real input and goes dark on Stop; while the result is worked out the button
 * cannot start a second recording; "sound but no words" is told apart from "recognized".
 */

require('../../src/stt/SpeechAudio.js');
const SS = require('../../src/stt/SttSettings.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const voice = (n = 4096) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i / 4));
const quiet = (n = 4096) => new Float32Array(n);

function page() {
    document.body.innerHTML = `
        <div class="config-section">
          <div class="input-group"><select id="stt-provider">
            <option value="webspeech">Web Speech</option><option value="wasm">On-device</option></select>
            <p class="voice-status">old line</p></div>
          <div id="wasm-stt-settings"><div class="input-group"><select id="wasm-model-size">
            <option value="tiny">Tiny</option><option value="base">Base</option></select></div></div>
          <div class="input-group"><select id="stt-language"><option value="en-US">English</option>
            <option value="it-IT">Italiano</option></select></div>
          <div class="input-group"><select id="stt-microphone"><option value="">Default</option></select></div>
        </div>`;
}

function setup({ text = 'testing one two three', accept = true } = {}) {
    page();
    const saved = [];
    window.SpeechService = {
        saveSTTConfig: (p) => saved.push(p),
        getSTTConfig: () => ({ wasm: { modelSize: 'tiny' } }),
        setRecognitionOptions: () => {},
    };
    let release;
    const transcribe = jest.fn(
        () => new Promise((r) => (release = () => r(accept ? { accept, text } : { accept: false, reason: 'phantom' })))
    );
    window.NEXUS_STT = {
        status: () => ({ model: 'ready', progress: null, config: { downloadMB: 41 } }),
        preload: () => Promise.resolve(),
        clearCache: () => Promise.resolve(0),
        transcribeSamples: transcribe,
    };
    const mic = { opens: [] };
    mic.open = (o) => {
        const lease = { ready: Promise.resolve({ ok: true, sampleRate: 16000 }), close: jest.fn() };
        mic.opens.push({ o, lease });
        return lease;
    };
    window.NEXUS_MIC_SESSION = { get: () => mic };
    expect(SS.mount(document)).toBe(true);
    const $ = (s) => document.querySelector(s);
    return {
        saved,
        mic,
        transcribe,
        release: () => release(),
        button: () => $('#stt-mic-test button'),
        chip: () => $('#stt-mic-test .stt-chip').textContent,
        heard: () => $('#stt-mic-test .stt-heard').textContent,
        lit: () => document.querySelectorAll('#stt-mic-test .stt-meter span.on').length,
        feed: (s) => mic.opens[mic.opens.length - 1].o.onFrames(s, 16000),
    };
}

afterEach(() => {
    delete window.SpeechService;
    delete window.NEXUS_STT;
    delete window.NEXUS_MIC_SESSION;
});

test('choosing a provider applies at once — no SAVE needed', () => {
    const t = setup();
    const sel = document.getElementById('stt-provider');
    sel.value = 'wasm';
    sel.dispatchEvent(new Event('change'));
    expect(t.saved.pop()).toMatchObject({ provider: 'wasm', language: 'en-US', wasm: { modelSize: 'tiny' } });
    expect(document.getElementById('stt-provider-help').textContent).toBe(SS.COPY.wasm);
});

test('the test sits right under STT LANGUAGE', () => {
    setup();
    const lang = document.getElementById('stt-language').closest('.input-group');
    expect(lang.nextElementSibling.id).toBe(SS.TEST_ID);
});

test('meter from real input; dark after Stop; locked while transcribing; then the words', async () => {
    const t = setup();
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(quiet());
    expect(t.lit()).toBe(0);
    t.feed(voice());
    expect(t.lit()).toBeGreaterThan(8);
    expect(t.chip()).toBe('Sound detected');
    t.button().click(); // Stop
    await tick();
    expect(t.lit()).toBe(0);
    expect(t.button().disabled).toBe(true);
    expect(t.chip()).toBe('Transcribing…');
    t.button().click(); // ignored while transcribing
    expect(t.mic.opens).toHaveLength(1);
    t.release();
    await tick();
    await tick();
    expect(t.chip()).toBe('Mic works · recognized');
    expect(t.heard()).toBe('testing one two three');
    expect(t.button().disabled).toBe(false);
    expect(t.transcribe.mock.calls[0][2]).toEqual({ language: 'en-US' });
});

test('sound but no words is not "recognized"', async () => {
    const t = setup({ accept: false });
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(voice());
    t.button().click();
    await tick();
    t.release();
    await tick();
    await tick();
    expect(t.chip()).toBe('Sound detected · no words recognized');
});

test('a silent microphone says so, and the model is never asked', async () => {
    const t = setup();
    document.getElementById('stt-provider').value = 'wasm';
    t.button().click();
    await tick();
    t.feed(quiet());
    t.button().click();
    await tick();
    await tick();
    expect(t.chip()).toBe('No sound');
    expect(t.transcribe).not.toHaveBeenCalled();
});
