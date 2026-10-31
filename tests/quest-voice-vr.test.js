/**
 * Q4 — the VR panel's voice. VRChatIntegration speaks through SpeechService.speak(), which
 * only ever knew Web Speech. With the Meta Quest switch on (TTSProvider.routesVR() true) it
 * must hand the reply to the active engine; with it off, nothing about it may change.
 *
 * TTSProvider is stubbed: what is under test is SpeechService's side of the contract —
 * routing, the VOICE OUT toggle, `isSpeaking`, callbacks, stop, and the one-shot fallback.
 */

let service;
let logSpy;
let warnSpy;

beforeAll(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../js/speech-service.js');
    service = window.SpeechService;
});

afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
});

/** A stub engine. `hold` keeps the reply "playing" until the test calls finish(). */
function stubProvider({ routes = true, fail = null, hold = false, fallback = null } = {}) {
    const calls = { speak: [], stop: 0 };
    let pending = null;
    window.TTSProvider = {
        routesVR: () => routes,
        getEngine: () => 'piper-wasm',
        fallbackFor: jest.fn(() => fallback),
        stop: () => {
            calls.stop++;
        },
        speak: jest.fn(async (text, opts) => {
            calls.speak.push({ text, opts });
            if (fail) {
                opts.onError(fail);
                return;
            }
            opts.onStart();
            if (hold) {
                pending = opts;
                return;
            }
            opts.onEnd();
        }),
    };
    return { calls, finish: () => pending && pending.onEnd() };
}

beforeEach(() => {
    localStorage.clear();
    delete window.TTSProvider;
    service.isSpeaking = false;
    service._engineSpeaking = false;
});

test('switch on: the reply goes to the engine, with the voice settings and callbacks', async () => {
    localStorage.setItem('nexus_settings_v1', JSON.stringify({ speechRate: 1.2, speechPitch: 0.8 }));
    const { calls } = stubProvider();
    const cb = { onStart: jest.fn(), onEnd: jest.fn(), onError: jest.fn() };
    await service.speak('Hello from Piper', cb);
    expect(calls.speak).toHaveLength(1);
    expect(calls.speak[0].text).toBe('Hello from Piper');
    expect(calls.speak[0].opts).toMatchObject({ rate: 1.2, pitch: 0.8 });
    expect(cb.onStart).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(service.isSpeaking).toBe(false);
});

test('isSpeaking stays true while the engine plays — CompanionMode polls it for turn-taking', async () => {
    const { finish } = stubProvider({ hold: true });
    await service.speak('a long reply', {});
    expect(service.isSpeaking).toBe(true);
    expect(service.isSpeakingNow()).toBe(true);
    finish();
    expect(service.isSpeaking).toBe(false);
});

test('stopSpeaking() stops a reply this service gave the engine', async () => {
    const { calls } = stubProvider({ hold: true });
    await service.speak('a long reply', {});
    service.stopSpeaking();
    expect(calls.stop).toBe(1);
    expect(service.isSpeaking).toBe(false);
});

test('VOICE OUT off is honoured on the engine path too', async () => {
    localStorage.setItem('nexus_settings_v1', JSON.stringify({ ttsEnabled: false }));
    const { calls } = stubProvider();
    const cb = { onEnd: jest.fn() };
    await service.speak('quiet please', cb);
    expect(calls.speak).toHaveLength(0);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
});

test('switch off: the engine is never asked, and the old path runs as before', async () => {
    const { calls } = stubProvider({ routes: false });
    const cb = { onError: jest.fn() };
    // jsdom has no speechSynthesis, so the unchanged Web Speech path reports exactly what it
    // always reported in a browser without it.
    const ok = await service.speak('hello', cb);
    expect(calls.speak).toHaveLength(0);
    expect(ok).toBe(false);
    expect(cb.onError).toHaveBeenCalledWith('Text-to-speech is not supported in your browser');
});

test('an engine failure falls back to the built-in path once, and never loops back', async () => {
    const { calls } = stubProvider({ fail: new Error('CDN blocked'), fallback: 'web-speech-api' });
    const cb = { onError: jest.fn() };
    await service.speak('hello', cb);
    await Promise.resolve();
    // One engine attempt; the retry went to the Web Speech path (unsupported in jsdom, so it
    // reports that), not back to the engine.
    expect(calls.speak).toHaveLength(1);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith('Text-to-speech is not supported in your browser');
});

test('an engine failure with no fallback reports the error once', async () => {
    stubProvider({ fail: new Error('boom'), fallback: null });
    const cb = { onError: jest.fn() };
    await service.speak('hello', cb);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith('Text-to-speech failed');
});

test('no TTSProvider on the page (index-vr.html) leaves the old path alone', async () => {
    const cb = { onError: jest.fn() };
    const ok = await service.speak('hello', cb);
    expect(ok).toBe(false);
    expect(cb.onError).toHaveBeenCalledWith('Text-to-speech is not supported in your browser');
});
