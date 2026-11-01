/**
 * HV-FIX Batches 3–5. The SonicAgent voice in Settings ▸ SPEECH and on the wire.
 * Real config, library, policy and TTS engine; the voice link and player are scripted.
 */
const raw = require('../fixtures/sonicagent/voices-2026-11-01.json');
const Config = require('../../src/stt/SonicAgentVoiceConfig.js');
const Library = require('../../src/tts/VoiceLibrary.js');
const Policy = require('../../src/tts/VoiceSelectionPolicy.js');
const Stream = require('../../src/stt/StreamingSttSession.js');
const Jitter = require('../../src/tts/AudioJitterBuffer.js');
const Phrases = require('../../src/tts/PhraseSpeechScheduler.js');
const Turns = require('../../src/tts/VoiceTurnController.js');
const Remote = require('../../src/tts/RemoteSonicAgentTTS.js');
const Style = require('../../src/tts/VoiceStyleSettings.js');

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('speech_lang', 'en-US');
    localStorage.setItem('speech_voice_pref', 'female');
    window.NEXUS_VOICE_POLICY = Policy;
    window.NEXUS_VOICE_LIBRARY = Library;
    Config.rememberLibrary(Library.normalize(raw));
});

afterEach(() => {
    Config.rememberLibrary(null);
    delete window.NEXUS_VOICE_POLICY;
    delete window.NEXUS_VOICE_LIBRARY;
});

function page(engine = 'sonicagent-stream') {
    document.body.innerHTML = `
      <div class="input-group"><select id="tts-engine">
        <option value="web-speech-api">Browser</option><option value="piper-wasm">Piper</option>
        <option value="sonicagent-stream">SonicAgent</option></select></div>
      <input id="speech-rate" value="0.9" /><input id="speech-pitch" value="1.0" />
      <select id="speech-voice-pref"><option value="female">Female</option></select>`;
    document.getElementById('tts-engine').value = engine;
    const fakeTts = {
        refreshLibrary: jest.fn(async () => Config.library()),
        warm: jest.fn(async () => ({})),
        readiness: () => null,
    };
    const ui = Style.attach({
        doc: document,
        config: Config,
        policy: Policy,
        library: Library,
        tts: fakeTts,
        store: localStorage,
    });
    const $ = (id) => document.getElementById(id);
    return { ui, fakeTts, $ };
}

describe('Settings ▸ SPEECH with SonicAgent as TTS ENGINE', () => {
    test('hidden for other engines; shown for SonicAgent with Auto naming the Companion preset', () => {
        const other = page('web-speech-api');
        expect(other.$('sonic-voice-group').style.display).toBe('none');
        expect(other.$('speech-rate').disabled).toBe(false);
        const t = page('sonicagent-stream');
        expect(t.$('sonic-voice-group').style.display).toBe('');
        const sel = t.$('sonic-voice-select');
        expect(sel.options[0].textContent).toBe('Auto — Kristin (Companion, English (US))');
        expect(sel.value).toBe('');
    });

    test('every one of the 49 catalogue entries is in the VOICE list, grouped by locale', () => {
        const { $ } = page();
        const sel = $('sonic-voice-select');
        const ids = Array.from(sel.querySelectorAll('optgroup option')).map((o) => o.value);
        expect(ids).toHaveLength(49);
        expect(new Set(ids).size).toBe(49);
        expect(sel.querySelectorAll('optgroup')).toHaveLength(8);
        expect(sel.querySelector('optgroup').label).toBe('English (US)');
        expect($('sonic-voice-status').textContent).toMatch(/49 voices in the catalog, 49 playable/);
    });

    test('Secretary switches the voice, not just the label', () => {
        const { $ } = page();
        Config.set({ voice: 'en_US-amy-medium' });
        const secretary = document.querySelector('input[name="sonic-voice-style"][value="secretary"]');
        secretary.checked = true;
        secretary.dispatchEvent(new Event('change'));
        expect(Config.get()).toMatchObject({ profile: 'secretary', voice: '' });
        expect($('sonic-voice-select').options[0].textContent).toBe('Auto — Lessac (Secretary, English (US))');
        expect(Config.voiceFor()).toBe('en_US-lessac-medium');
    });

    test('an explicit pick is kept across a catalogue refresh', async () => {
        const { $, ui } = page();
        const sel = $('sonic-voice-select');
        sel.value = 'en_US-hfc_female-medium';
        sel.dispatchEvent(new Event('change'));
        expect(Config.get().voice).toBe('en_US-hfc_female-medium');
        Config.rememberLibrary(Library.normalize(raw)); // the refresh lands
        await ui.load(true);
        expect($('sonic-voice-select').value).toBe('en_US-hfc_female-medium');
        expect(Config.voiceFor()).toBe('en_US-hfc_female-medium');
    });

    test('rate and pitch are disabled and explained for SonicAgent', () => {
        const { $ } = page();
        expect($('speech-rate').disabled).toBe(true);
        expect($('speech-pitch').title).toBe(Style.RATE_NOTE);
    });

    test('a language SonicAgent has no voice for says so and offers another engine', () => {
        const { $ } = page();
        Config.set({ ttsLanguage: 'en-US' });
        localStorage.setItem('speech_lang', 'ja-JP');
        Config.set({ ttsLanguage: '' });
        expect($('sonic-voice-status').textContent).toMatch(
            /^No SonicAgent voice is available for the selected language\./
        );
        expect($('sonic-voice-other-engine').style.display).toBe('');
    });

    test('an old local Piper id stored as the voice is shown as not a SonicAgent voice, and not used', () => {
        Config.set({ voice: 'en_US-lessac-high' });
        const { $ } = page();
        expect($('sonic-voice-status').textContent).toMatch(
            /“en_US-lessac-high” is not a SonicAgent voice; using Auto/
        );
        expect(Config.voiceFor()).toBe('en_US-kristin-medium');
    });
});

describe('on the wire', () => {
    function engine() {
        const listeners = { event: new Set(), audio: new Set(), close: new Set() };
        const link = {
            control: [],
            isOpen: () => true,
            ensure: jest.fn(async () => ({ ok: true, options: Stream.WANTED_OPTIONS })),
            session: () => ({ options: {} }),
            on: (t, fn) => (listeners[t].add(fn), () => listeners[t].delete(fn)),
            emit: (t, e) => Array.from(listeners[t]).forEach((fn) => fn(e)),
            sendControl(c) {
                this.control.push(c);
                return true;
            },
            retain: () => () => {},
        };
        const player = {
            on() {},
            beginTurn: async () => 'fake',
            push() {
                return true;
            },
            endTurn() {},
            stop() {},
            phrasePlayedMs: () => 0,
            level: () => 0,
        };
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({ ollabridge: { base_url: 'https://app.ollabridge.com', pair_token: 't' } })
        );
        Config.set({ enabled: true });
        const provider = Remote.create({
            link,
            player,
            config: Config,
            stream: Stream,
            jitter: Jitter,
            phrases: Phrases,
            turns: Turns,
            lipSync: null,
        });
        return { link, provider };
    }

    test('every phrase of a reply carries the resolved canonical voice_id', async () => {
        const { link, provider } = engine();
        await provider.speak('Hello there, it is good to see you again. Shall we start with your plans for today?', {});
        await flush();
        const speaks = link.control.filter((c) => c.type === 'tts.speak');
        expect(speaks.length).toBeGreaterThan(1);
        expect(speaks.every((s) => s.voice_id === 'en_US-kristin-medium')).toBe(true);
        expect(link.ensure).toHaveBeenCalledWith({}); // the voice travels per phrase, not in the link
    });

    test('Secretary sends Lessac; Italian Companion sends Paola Companion', async () => {
        const a = engine();
        Config.set({ profile: 'secretary' });
        await a.provider.speak('Good morning. Your schedule is ready.', {});
        expect(a.link.control.find((c) => c.type === 'tts.speak').voice_id).toBe('en_US-lessac-medium');
        const b = engine();
        Config.set({ profile: 'companion', ttsLanguage: 'it-IT' });
        await b.provider.speak('Ciao, è bello sentirti.', {});
        expect(b.link.control.find((c) => c.type === 'tts.speak').voice_id).toBe('it_IT-paola-companion');
    });

    test('a stale session voice from the server stops the turn instead of speaking the wrong voice', async () => {
        const { link, provider } = engine();
        const onError = jest.fn();
        await provider.speak('Hello there, it is lovely to hear you.', { onError });
        await flush();
        const s = link.control.find((c) => c.type === 'tts.speak');
        link.emit('event', { type: 'tts.started', turn_id: s.turn_id, voice_id: 'en_US-hfc_female-medium' });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'voice_unavailable' }));
    });

    test('no SonicAgent voice for the language: a clear error, nothing sent', async () => {
        const { link, provider } = engine();
        Config.set({ ttsLanguage: 'ko-KR' });
        const onError = jest.fn();
        await provider.speak('안녕하세요', { onError });
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'No SonicAgent voice is available for the selected language.' })
        );
        expect(link.control.filter((c) => c.type === 'tts.speak')).toHaveLength(0);
    });

    test('previews: the spec’s sentences, localized', () => {
        expect(Library.previewText('en', 'companion')).toBe("Hello, it's lovely to hear your voice. I'm right here.");
        expect(Library.previewText('en', 'secretary')).toBe(
            'Good morning. Your schedule is ready. How may I assist you?'
        );
        for (const l of ['it', 'es', 'fr', 'de']) {
            expect(Library.previewText(l, 'companion')).toBeTruthy();
            expect(Library.previewText(l, 'secretary')).not.toBe(Library.previewText(l, 'companion'));
        }
    });
});
