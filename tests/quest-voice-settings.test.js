/**
 * Q6 — the "Natural voice on Meta Quest" toggle in Settings ▸ Speech.
 *
 * Drawn only on a Quest, directly under TTS ENGINE; one checkbox that writes QuestVoice;
 * a sentence underneath that says what is actually happening.
 */

const QUEST_UA =
    'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'OculusBrowser/35.3.0.0 SamsungBrowser/4.0 Chrome/126.0.6478.122 VR Safari/537.36';
const realUA = navigator.userAgent;

function setUA(ua) {
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

const QV = require('../src/tts/QuestVoice.js');
const QVS = require('../src/tts/QuestVoiceSettings.js');

function settingsMarkup() {
    document.body.innerHTML = `
        <div id="speech-section">
            <div class="input-group">
                <select id="speech-lang">
                    <option value="en-US">English (US)</option>
                    <option value="ja-JP">日本語</option>
                </select>
            </div>
            <div class="input-group" id="engine-group">
                <select id="tts-engine">
                    <option value="web-speech-api">Web Speech API (built-in)</option>
                    <option value="piper-wasm">Piper</option>
                </select>
            </div>
            <div class="input-group" id="after"></div>
        </div>`;
}

beforeEach(() => {
    localStorage.clear();
    QV.reset();
    setUA(realUA);
    settingsMarkup();
    window.PiperWasmTTSProvider = { getVoices: () => [{ id: 'en_US-hfc_female-medium', lang: 'en-US' }] };
    window.TTSProvider = { lastFailure: () => null };
});

afterAll(() => setUA(realUA));

test('is not drawn off a Quest — desktop and phone Settings are unchanged', () => {
    expect(QVS.mount(document)).toBe(false);
    expect(document.getElementById(QVS.GROUP_ID)).toBeNull();
});

test('on a Quest it sits directly under TTS ENGINE, off by default', () => {
    setUA(QUEST_UA);
    expect(QVS.mount(document)).toBe(true);
    const group = document.getElementById(QVS.GROUP_ID);
    expect(group.previousElementSibling.id).toBe('engine-group');
    expect(group.nextElementSibling.id).toBe('after');
    const box = document.getElementById(QVS.TOGGLE_ID);
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
    expect(group.textContent).toContain(QVS.COPY.label);
    expect(group.querySelector('[data-qv="status"]').hidden).toBe(true);
});

test('ticking it turns the switch on at once, and says so', () => {
    setUA(QUEST_UA);
    QVS.mount(document);
    const box = document.getElementById(QVS.TOGGLE_ID);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(QV.isOn()).toBe(true);
    const status = document.querySelector('[data-qv="status"]');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(QVS.COPY.on);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(QV.isOn()).toBe(false);
    expect(status.hidden).toBe(true);
});

test('reflects a switch that was already on', () => {
    setUA(QUEST_UA);
    QV.set(true);
    QVS.mount(document);
    expect(document.getElementById(QVS.TOGGLE_ID).checked).toBe(true);
});

test('mounting twice draws one toggle', () => {
    setUA(QUEST_UA);
    QVS.mount(document);
    QVS.mount(document);
    expect(document.querySelectorAll('#' + QVS.GROUP_ID)).toHaveLength(1);
});

test('?questVoice=1 draws it on a desktop, for testing', () => {
    window.history.pushState({}, '', '/?questVoice=1');
    try {
        expect(QVS.mount(document)).toBe(true);
    } finally {
        window.history.pushState({}, '', '/');
    }
});

describe('the sentence under the toggle', () => {
    test('says nothing while off', () => {
        expect(QVS.statusText({ on: false, failed: 'piper-wasm', covers: false, langName: 'x' })).toBe('');
    });

    test('says Piper could not load, before anything else', () => {
        expect(QVS.statusText({ on: true, failed: 'piper-wasm', covers: true })).toBe(QVS.COPY.failed);
    });

    test('names a language Piper cannot speak', () => {
        expect(QVS.statusText({ on: true, failed: null, covers: false, langName: '日本語' })).toBe(
            QVS.COPY.noLang('日本語')
        );
    });

    test('follows a language change in Settings', () => {
        setUA(QUEST_UA);
        QV.set(true);
        QVS.mount(document);
        const lang = document.getElementById('speech-lang');
        lang.value = 'ja-JP';
        lang.dispatchEvent(new Event('change'));
        expect(document.querySelector('[data-qv="status"]').textContent).toContain('日本語');
    });

    test('follows an engine event — Piper failing to load after the panel was drawn', () => {
        setUA(QUEST_UA);
        QV.set(true);
        QVS.mount(document);
        window.TTSProvider = { lastFailure: () => 'piper-wasm' };
        window.dispatchEvent(new CustomEvent('nexus-tts-engine', { detail: {} }));
        expect(document.querySelector('[data-qv="status"]').textContent).toBe(QVS.COPY.failed);
    });
});
