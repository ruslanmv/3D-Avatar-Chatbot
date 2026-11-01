/**
 * Q2–Q5 — TTSProvider: which engine speaks after a page load, and what the Meta Quest
 * switch does to it.
 *
 * Each test loads a fresh copy of QuestVoice + TTSProvider (they keep module state) and
 * registers a fake Piper, so what is asserted is the provider's own bookkeeping: the
 * stored choice, the active engine, the in-memory override, the fallback answer.
 */

const QUEST_UA =
    'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'OculusBrowser/35.3.0.0 SamsungBrowser/4.0 Chrome/126.0.6478.122 VR Safari/537.36';

const realUA = navigator.userAgent;

function setUA(ua) {
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function fakePiper(overrides) {
    return Object.assign(
        {
            displayName: 'Fake Piper',
            init: jest.fn(() => Promise.resolve()),
            speak: jest.fn(() => Promise.resolve()),
            stop: jest.fn(),
            getVoices: () => [
                { id: 'en_US-hfc_female-medium', lang: 'en-US' },
                { id: 'it_IT-paola-medium', lang: 'it-IT' },
            ],
        },
        overrides || {}
    );
}

/** Fresh QuestVoice + TTSProvider, Piper registered, not yet booted. */
function load(piper) {
    let QV;
    jest.isolateModules(() => {
        QV = require('../src/tts/QuestVoice.js');
        require('../src/TTSProvider.js');
    });
    const tp = window.TTSProvider;
    tp.registerProvider('piper-wasm', piper || fakePiper());
    return { QV, tp };
}

let logSpy;
beforeEach(() => {
    localStorage.clear();
    setUA(realUA);
    window.SpeechSettings = { lang: 'en-US' };
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
    setUA(realUA);
});

describe('Q2. after a reload, the saved engine is the one that speaks', () => {
    test('a saved Piper choice is active once the page has booted', async () => {
        // Before Q2, nothing set `_initialized` at page load, so isActive() was false and the
        // built-in voice spoke while Settings said Piper.
        localStorage.setItem('tts_engine', 'piper-wasm');
        const piper = fakePiper();
        const { tp } = load(piper);
        await tp.boot();
        expect(tp.getEngine()).toBe('piper-wasm');
        expect(tp.isActive()).toBe(true);
        expect(tp.isOverridden()).toBe(false);
        expect(piper.init).toHaveBeenCalledTimes(1);
    });

    test('a fresh profile stays on the built-in voice', async () => {
        const { tp } = load();
        await tp.boot();
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.isActive()).toBe(false);
        expect(tp.routesVR()).toBe(false);
    });

    test('Piper failing to start uses the built-in voice for this session only', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem('tts_engine', 'piper-wasm');
        const { tp } = load(fakePiper({ init: jest.fn(() => Promise.reject(new Error('CDN blocked'))) }));
        await tp.boot();
        warn.mockRestore();
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.isActive()).toBe(false);
        expect(tp.lastFailure()).toBe('piper-wasm');
        // The person's choice survives, so the next page load tries Piper again.
        expect(localStorage.getItem('tts_engine')).toBe('piper-wasm');
        expect(tp.getStoredEngine()).toBe('piper-wasm');
    });

    test('boot is idempotent', async () => {
        localStorage.setItem('tts_engine', 'piper-wasm');
        const piper = fakePiper();
        const { tp } = load(piper);
        await tp.boot();
        await tp.boot();
        expect(piper.init).toHaveBeenCalledTimes(1);
    });
});

describe('the Meta Quest switch', () => {
    test('off on a Quest: exactly the stored choice, no override, VR untouched', async () => {
        setUA(QUEST_UA);
        const { tp } = load();
        await tp.boot();
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.isOverridden()).toBe(false);
        expect(tp.routesVR()).toBe(false);
    });

    test('on, but not a Quest: nothing changes', async () => {
        const { QV, tp } = load();
        QV.set(true);
        await tp.boot();
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.routesVR()).toBe(false);
    });

    test('on a Quest: Piper speaks, VR included, and tts_engine is never rewritten', async () => {
        setUA(QUEST_UA);
        const { QV, tp } = load();
        QV.set(true);
        await tp.boot();
        expect(tp.getEngine()).toBe('piper-wasm');
        expect(tp.isActive()).toBe(true);
        expect(tp.isOverridden()).toBe(true);
        expect(tp.routesVR()).toBe(true);
        expect(localStorage.getItem('tts_engine')).toBeNull();
        expect(tp.getStoredEngine()).toBe('web-speech-api');
    });

    test('flipping it at runtime switches engines without a reload, and off restores the choice', async () => {
        setUA(QUEST_UA);
        const { QV, tp } = load();
        await tp.boot();
        expect(tp.getEngine()).toBe('web-speech-api');

        QV.set(true);
        await Promise.resolve();
        expect(tp.getEngine()).toBe('piper-wasm');
        expect(tp.routesVR()).toBe(true);

        QV.set(false);
        await Promise.resolve();
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.isOverridden()).toBe(false);
        expect(tp.routesVR()).toBe(false);
    });

    test('a person who chose Piper themselves is not "overridden"', async () => {
        setUA(QUEST_UA);
        localStorage.setItem('tts_engine', 'piper-wasm');
        const { QV, tp } = load();
        QV.set(true);
        await tp.boot();
        expect(tp.getEngine()).toBe('piper-wasm');
        expect(tp.isOverridden()).toBe(false);
        expect(tp.routesVR()).toBe(true);
    });

    test('for a language Piper has no voice for, the switch steps aside', async () => {
        setUA(QUEST_UA);
        const { QV, tp } = load();
        QV.set(true);
        await tp.boot();
        window.SpeechSettings.lang = 'ja-JP';
        expect(tp.isActive()).toBe(false);
        expect(tp.routesVR()).toBe(false);
        window.SpeechSettings.lang = 'it-IT';
        expect(tp.isActive()).toBe(true);
    });

    test('announces engine changes so Settings can follow them', async () => {
        setUA(QUEST_UA);
        const seen = [];
        const listener = (e) => seen.push(e.detail);
        window.addEventListener('nexus-tts-engine', listener);
        const { QV, tp } = load();
        await tp.boot();
        QV.set(true);
        await Promise.resolve();
        window.removeEventListener('nexus-tts-engine', listener);
        expect(seen[0]).toMatchObject({ engine: 'web-speech-api', overridden: false });
        expect(seen[seen.length - 1]).toMatchObject({ engine: 'piper-wasm', overridden: true });
    });
});

describe('Q3. fallback', () => {
    function withWebSpeech() {
        window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] };
        window.SpeechSynthesisUtterance = function () {};
    }

    test('Piper failing on a Quest with the switch on falls back to the built-in voice', async () => {
        setUA(QUEST_UA);
        withWebSpeech();
        const { QV, tp } = load();
        QV.set(true);
        await tp.boot();
        expect(tp.fallbackFor('piper-wasm')).toBe('web-speech-api');
        expect(tp.fallbackFor('piper-wasm', { alreadyFellBack: true })).toBeNull();
    });

    test('with the switch off there is no fallback — the failure is what it always was', async () => {
        setUA(QUEST_UA);
        withWebSpeech();
        localStorage.setItem('tts_engine', 'piper-wasm');
        const { tp } = load();
        await tp.boot();
        expect(tp.fallbackFor('piper-wasm')).toBeNull();
    });
});

describe('speak and stop', () => {
    test('opts.engine sends one reply to a named provider without changing the active one', async () => {
        const piper = fakePiper();
        const { tp } = load(piper);
        await tp.boot();
        await tp.speak('hello', { engine: 'piper-wasm' });
        expect(piper.speak).toHaveBeenCalledWith('hello', expect.objectContaining({ engine: 'piper-wasm' }));
        expect(tp.getEngine()).toBe('web-speech-api');
    });

    test('stop() reaches every provider, not only the active one', async () => {
        const piper = fakePiper();
        const { tp } = load(piper);
        await tp.boot();
        tp.stop();
        expect(piper.stop).toHaveBeenCalled();
    });
});

describe('Q5. preload', () => {
    afterEach(() => jest.useRealTimers());

    async function bootWith({ quest, on }) {
        jest.useFakeTimers();
        if (quest) setUA(QUEST_UA);
        const piper = fakePiper({ warmUp: jest.fn(() => Promise.resolve(true)) });
        const { QV, tp } = load(piper);
        if (on) QV.set(true);
        await tp.boot();
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();
        return piper;
    }

    test('fetches the model in the background on a Quest with the switch on', async () => {
        const piper = await bootWith({ quest: true, on: true });
        expect(piper.warmUp).toHaveBeenCalledTimes(1);
    });

    test('never downloads anything with the switch off, even for a saved Piper choice', async () => {
        localStorage.setItem('tts_engine', 'piper-wasm');
        const piper = await bootWith({ quest: true, on: false });
        expect(piper.warmUp).not.toHaveBeenCalled();
    });

    test('never preloads off a Quest', async () => {
        const piper = await bootWith({ quest: false, on: true });
        expect(piper.warmUp).not.toHaveBeenCalled();
    });
});

describe('HV-FIX 9. SonicAgent in the headset', () => {
    function withRemote(tp) {
        const remote = fakePiper({ displayName: 'Fake SonicAgent', getVoices: () => [] });
        tp.registerProvider('sonicagent-stream', remote);
        return remote;
    }

    test('a stored SonicAgent choice speaks the VR panel too, with the Quest switch off', async () => {
        setUA(QUEST_UA);
        localStorage.setItem('tts_engine', 'sonicagent-stream');
        const { QV, tp } = load();
        withRemote(tp);
        QV.set(false);
        await tp.boot();
        expect(tp.getEngine()).toBe('sonicagent-stream');
        expect(tp.routesVR()).toBe(true);
    });

    test('the Quest switch never replaces SonicAgent with on-device Piper', async () => {
        setUA(QUEST_UA);
        localStorage.setItem('tts_engine', 'sonicagent-stream');
        const { QV, tp } = load();
        withRemote(tp);
        QV.set(true);
        await tp.boot();
        expect(tp.getEngine()).toBe('sonicagent-stream');
        expect(tp.isOverridden()).toBe(false);
        expect(tp.routesVR()).toBe(true);
        expect(QV.effectiveEngine({ stored: 'sonicagent-stream', isQuest: true, on: true, piperAvailable: true })).toBe(
            'sonicagent-stream'
        );
    });

    test('the built-in voice still does not route through the engine path', async () => {
        const { tp } = load();
        await tp.boot();
        expect(tp.routesVR()).toBe(false);
    });
});
