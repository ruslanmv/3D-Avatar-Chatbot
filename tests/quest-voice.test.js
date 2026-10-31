/**
 * Q1 — QuestVoice: the "Natural voice on Meta Quest" switch and the decisions behind it.
 *
 * The property every test here protects: with the switch off, or off a Quest, nothing
 * changes. Each decision function answers "what you had" in that case, so a profile that
 * never touches the toggle hears exactly what it heard before Q1.
 */

const QV = require('../src/tts/QuestVoice.js');

// Real user-agent strings, so the detector is tested against what devices actually send.
const UA = {
    quest3:
        'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'OculusBrowser/35.3.0.0 SamsungBrowser/4.0 Chrome/126.0.6478.122 VR Safari/537.36',
    quest2:
        'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'OculusBrowser/33.0.0.0 SamsungBrowser/4.0 Chrome/124.0.0.0 VR Safari/537.36',
    androidPhone:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Mobile Safari/537.36',
    desktopChrome:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',
};

beforeEach(() => {
    localStorage.clear();
    QV.reset();
});

describe('the switch', () => {
    test('is off for a profile that never touched it', () => {
        expect(QV.state()).toBeNull();
        expect(QV.isOn()).toBe(false);
    });

    test('persists on and off in localStorage', () => {
        expect(QV.set(true)).toBe(true);
        expect(localStorage.getItem(QV.KEY)).toBe('on');
        expect(QV.isOn()).toBe(true);
        expect(QV.set(false)).toBe(true);
        expect(localStorage.getItem(QV.KEY)).toBe('off');
        expect(QV.isOn()).toBe(false);
    });

    test('tells listeners once per real change, and not for a no-op', () => {
        const seen = [];
        const off = QV.onChange((v) => seen.push(v));
        QV.set(true);
        QV.set(true); // no change
        QV.set(false);
        off();
        QV.set(true); // unsubscribed
        expect(seen).toEqual(['on', 'off']);
    });

    test('a throwing listener does not stop the others', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const seen = [];
        const a = QV.onChange(() => {
            throw new Error('boom');
        });
        const b = QV.onChange((v) => seen.push(v));
        QV.set(true);
        a();
        b();
        warn.mockRestore();
        expect(seen).toEqual(['on']);
    });

    test('reset keeps listeners — TTSProvider subscribes once and must keep hearing', () => {
        const seen = [];
        const off = QV.onChange((v) => seen.push(v));
        QV.reset();
        QV.set(true);
        off();
        expect(seen).toEqual(['on']);
    });

    test('ignores a stored value it does not recognise', () => {
        localStorage.setItem(QV.KEY, 'yes please');
        expect(QV.state()).toBeNull();
        expect(QV.isOn()).toBe(false);
    });
});

describe('device detection', () => {
    test('recognises Quest browsers and nothing else', () => {
        expect(QV.isQuestUA(UA.quest3)).toBe(true);
        expect(QV.isQuestUA(UA.quest2)).toBe(true);
        expect(QV.isQuestUA(UA.androidPhone)).toBe(false);
        expect(QV.isQuestUA(UA.desktopChrome)).toBe(false);
        expect(QV.isQuestUA('')).toBe(false);
        expect(QV.isQuestUA(undefined)).toBe(false);
    });

    test('?questVoice=1 stands in for a headset, so the toggle can be tested from a desk', () => {
        const desk = { navigator: { userAgent: UA.desktopChrome } };
        expect(QV.detect({ ...desk, location: { search: '' } })).toBe(false);
        expect(QV.detect({ ...desk, location: { search: '?questVoice=1' } })).toBe(true);
        expect(QV.detect({ ...desk, location: { search: '?a=b&questVoice=1' } })).toBe(true);
        expect(QV.detect({ ...desk, location: { search: '?questVoice=10' } })).toBe(false);
        expect(QV.detect({ navigator: { userAgent: UA.quest3 }, location: { search: '' } })).toBe(true);
    });
});

describe('which engine speaks', () => {
    const base = { piperAvailable: true };

    test('off, or off a Quest, the stored choice is returned untouched', () => {
        for (const stored of ['web-speech-api', 'piper-wasm']) {
            expect(QV.effectiveEngine({ ...base, stored, isQuest: true, on: false })).toBe(stored);
            expect(QV.effectiveEngine({ ...base, stored, isQuest: false, on: true })).toBe(stored);
            expect(QV.effectiveEngine({ ...base, stored, isQuest: false, on: false })).toBe(stored);
        }
    });

    test('nothing stored means the built-in voice, as it always has', () => {
        expect(QV.effectiveEngine({ ...base, isQuest: false, on: false })).toBe('web-speech-api');
    });

    test('on a Quest with the switch on, Piper speaks', () => {
        expect(QV.effectiveEngine({ ...base, stored: 'web-speech-api', isQuest: true, on: true })).toBe('piper-wasm');
    });

    test('without the Piper provider registered, the switch changes nothing', () => {
        expect(QV.effectiveEngine({ stored: 'web-speech-api', isQuest: true, on: true, piperAvailable: false })).toBe(
            'web-speech-api'
        );
    });
});

describe('falling back when an engine cannot start', () => {
    const quest = { isQuest: true, on: true, webSpeechAvailable: true };

    test('Piper failing on a Quest with the switch on hands the reply to the built-in voice', () => {
        expect(QV.fallbackFor({ ...quest, failed: 'piper-wasm' })).toBe('web-speech-api');
    });

    test('a fallback never falls back again', () => {
        expect(QV.fallbackFor({ ...quest, failed: 'piper-wasm', alreadyFellBack: true })).toBeNull();
    });

    test('switch off, or not a Quest: fail exactly as before', () => {
        expect(QV.fallbackFor({ ...quest, on: false, failed: 'piper-wasm' })).toBeNull();
        expect(QV.fallbackFor({ ...quest, isQuest: false, failed: 'piper-wasm' })).toBeNull();
    });

    test('no built-in voice to fall back to means no fallback', () => {
        expect(QV.fallbackFor({ ...quest, webSpeechAvailable: false, failed: 'piper-wasm' })).toBeNull();
    });

    test('the built-in voice failing has nowhere to go — the switch only causes the other failure', () => {
        expect(QV.fallbackFor({ ...quest, failed: 'web-speech-api' })).toBeNull();
    });
});

describe('Piper language coverage', () => {
    const voices = [
        { id: 'en_US-hfc_female-medium', lang: 'en-US' },
        { id: 'es_MX-ald-medium', lang: 'es-ES' },
        { id: 'zh_CN-huayan-medium', lang: 'zh-CN' },
    ];

    test('matches on the base language, the way Settings lists Piper voices', () => {
        expect(QV.piperCovers('en-GB', voices)).toBe(true);
        expect(QV.piperCovers('es-ES', voices)).toBe(true);
        expect(QV.piperCovers('zh-CN', voices)).toBe(true);
    });

    test('Japanese and Korean have no Piper voice', () => {
        expect(QV.piperCovers('ja-JP', voices)).toBe(false);
        expect(QV.piperCovers('ko-KR', voices)).toBe(false);
    });

    test('bad input is "not covered", never a throw', () => {
        expect(QV.piperCovers('', voices)).toBe(false);
        expect(QV.piperCovers('en-US', null)).toBe(false);
    });

    test('agrees with the real Piper catalogue', () => {
        window.TTSProvider = window.TTSProvider || { registerProvider() {} };
        jest.isolateModules(() => require('../src/tts/PiperWasmTTSProvider.js'));
        const catalogue = window.PiperWasmTTSProvider.getVoices();
        for (const lang of ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'zh-CN']) {
            expect([lang, QV.piperCovers(lang, catalogue)]).toEqual([lang, true]);
        }
        for (const lang of ['ja-JP', 'ko-KR']) {
            expect([lang, QV.piperCovers(lang, catalogue)]).toEqual([lang, false]);
        }
    });
});
