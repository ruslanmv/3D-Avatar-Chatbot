/**
 * HV-FIX Batch 1. Choosing SonicAgent must make SonicAgent speak — and when it cannot, the
 * person's choice must survive, the reason must be the real one, and nothing may pretend the
 * browser voice is SonicAgent.
 *
 * Reproduces 4222934: TTS ENGINE = SonicAgent, ADVANCED VOICE switch off. init() refused with
 * "not set up (disabled)", setEngine() wrote 'web-speech-api' into tts_engine, and every reload
 * after that spoke with the browser voice.
 */

const Config = require('../../src/stt/SonicAgentVoiceConfig.js');
const Stream = require('../../src/stt/StreamingSttSession.js');
const Jitter = require('../../src/tts/AudioJitterBuffer.js');
const Phrases = require('../../src/tts/PhraseSpeechScheduler.js');
const Turns = require('../../src/tts/VoiceTurnController.js');
const Remote = require('../../src/tts/RemoteSonicAgentTTS.js');

function loadProvider() {
    jest.isolateModules(() => {
        require('../../src/TTSProvider.js');
    });
    return window.TTSProvider;
}

function paired() {
    localStorage.setItem(
        'nexus_llm_settings',
        JSON.stringify({ ollabridge: { base_url: 'https://app.ollabridge.com', pair_token: 'pair-tok' } })
    );
}

function remoteWith(capabilities) {
    const gateway = {
        capabilities: jest.fn(async () => {
            if (capabilities instanceof Error) throw capabilities;
            return capabilities;
        }),
        voices: jest.fn(async () => ({ voices: [] })),
        warmVoice: jest.fn(async () => ({})),
        baseUrl: () => 'https://app.ollabridge.com',
    };
    const config = Object.assign({}, Config, { gateway: () => gateway });
    const provider = Remote.create({
        config,
        stream: Stream,
        jitter: Jitter,
        phrases: Phrases,
        turns: Turns,
        lipSync: null,
    });
    return { provider, gateway };
}

const READY = { mode: 'huggingface', available: true, backend: { location: 'huggingface', state: 'ready' } };
const GATEWAY_OFF = { mode: 'disabled', available: false, reason: 'voice is disabled on this gateway' };

let errSpy;
let logSpy;
beforeEach(() => {
    localStorage.clear();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    errSpy.mockRestore();
    logSpy.mockRestore();
});

describe('choosing SonicAgent switches remote voice on', () => {
    test('with the ADVANCED VOICE switch off and a paired gateway, SonicAgent becomes the active engine', async () => {
        paired();
        const tp = loadProvider();
        const { provider } = remoteWith(READY);
        tp.registerProvider('sonicagent-stream', provider);
        expect(Config.get().enabled).toBe(false);
        expect(await tp.setEngine('sonicagent-stream')).toBe(true);
        expect(Config.get().enabled).toBe(true);
        expect(Config.get().consent).toBe(false); // speaking her replies is not the microphone
        expect(tp.getEngine()).toBe('sonicagent-stream');
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
    });

    test('page load restores but never switches anything on', async () => {
        paired();
        localStorage.setItem('tts_engine', 'sonicagent-stream');
        const tp = loadProvider();
        const { provider } = remoteWith(READY);
        tp.registerProvider('sonicagent-stream', provider);
        await tp.boot();
        expect(Config.get().enabled).toBe(false);
        expect(tp.getEngine()).toBe('web-speech-api'); // for this session, with the reason
        expect(tp.getStoredEngine()).toBe('sonicagent-stream');
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
    });
});

describe('a failure never overwrites the stored choice', () => {
    test('no pairing: the actionable sentence, the choice kept, the browser voice only for now', async () => {
        const tp = loadProvider();
        const { provider } = remoteWith(READY);
        tp.registerProvider('sonicagent-stream', provider);
        expect(await tp.setEngine('sonicagent-stream')).toBe(false);
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
        expect(tp.getStoredEngine()).toBe('sonicagent-stream');
        expect(tp.getEngine()).toBe('web-speech-api');
        expect(tp.lastFailureDetail()).toEqual({
            engine: 'sonicagent-stream',
            code: 'not_configured',
            message:
                'SonicAgent needs an OllaBridge Cloud connection. Connect OllaBridge in Settings → LLM to use remote voice.',
        });
    });

    test('the gateway has voice switched off: says so, keeps the choice', async () => {
        paired();
        const tp = loadProvider();
        const { provider } = remoteWith(GATEWAY_OFF);
        tp.registerProvider('sonicagent-stream', provider);
        expect(await tp.setEngine('sonicagent-stream')).toBe(false);
        const d = tp.lastFailureDetail();
        expect(d.code).toBe('voice_unavailable');
        expect(d.message).toMatch(/voice is disabled on this gateway/);
        expect(d.message).not.toMatch(/CDN|download/i);
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
    });

    test('an unreachable gateway: backend_unavailable, choice kept; choosing again retries', async () => {
        paired();
        const tp = loadProvider();
        const down = Object.assign(new Error('x'), { code: 'backend_unavailable' });
        const { provider, gateway } = remoteWith(down);
        tp.registerProvider('sonicagent-stream', provider);
        expect(await tp.setEngine('sonicagent-stream')).toBe(false);
        expect(tp.lastFailureDetail().code).toBe('backend_unavailable');
        gateway.capabilities.mockResolvedValue(READY);
        expect(await tp.setEngine('sonicagent-stream')).toBe(true);
        expect(tp.getEngine()).toBe('sonicagent-stream');
        expect(tp.lastFailureDetail()).toBeNull();
    });

    test('an engine that is not loaded keeps the stored choice too', async () => {
        const tp = loadProvider();
        expect(await tp.setEngine('sonicagent-stream')).toBe(false);
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
        expect(tp.getEngine()).toBe('web-speech-api');
    });

    test('the person choosing the browser voice is still stored', async () => {
        const tp = loadProvider();
        await tp.setEngine('web-speech-api');
        expect(localStorage.getItem('tts_engine')).toBe('web-speech-api');
    });
});

describe('the disclosures', () => {
    test('remote TTS discloses that reply text is sent; STT keeps its own consent sentence', () => {
        expect(Config.TTS_NOTICE).toBe(
            "The text of your avatar's replies is sent through OllaBridge Cloud to SonicAgent to generate speech."
        );
        expect(Config.CONSENT_TEXT).toBe(
            'Your microphone audio will be sent to OllaBridge Cloud and SonicAgent for transcription.'
        );
    });

    test('choosing SonicAgent in either dropdown enables remote voice and never grants consent', () => {
        document.body.innerHTML =
            '<div id="settings-modal"><div class="modal-content">' +
            '<select id="stt-provider"><option value="webspeech">W</option></select>' +
            '<select id="tts-engine"><option value="web-speech-api">B</option></select>' +
            '<div class="config-section"><h3 class="config-title">DEVELOPER</h3></div></div></div>';
        global.NEXUS_SONIC_VOICE = Config;
        const S = require('../../src/stt/SonicAgentVoiceSettings.js');
        S.attach({ doc: document, config: Config });
        const stt = document.getElementById('stt-provider');
        stt.value = 'sonicagent-stream';
        stt.dispatchEvent(new Event('change'));
        expect(Config.get()).toMatchObject({ enabled: true, consent: false });
        expect(document.getElementById('sonic-stt-notice').textContent).toMatch(/OllaBridge Cloud connection/);
        paired();
        const tts = document.getElementById('tts-engine');
        tts.value = 'sonicagent-stream';
        tts.dispatchEvent(new Event('change'));
        expect(document.getElementById('sonic-tts-notice').textContent).toBe(Config.TTS_NOTICE);
        expect(document.getElementById('sonic-stt-notice').textContent).toMatch(/Allow microphone upload/);
        expect(Config.get().consent).toBe(false);
    });
});

describe('the gateway', () => {
    test('a Cloud without /v1/voice routes is named as such, and the choice is kept', async () => {
        paired();
        const fetch = async () => ({
            ok: false,
            status: 404,
            headers: { get: () => 'application/json' },
            json: async () => ({ detail: 'Not Found' }),
        });
        const gateway = Config.createGateway({ fetch, info: () => ({ baseUrl: 'https://old.example', token: 't' }) });
        const config = Object.assign({}, Config, { gateway: () => gateway });
        const provider = Remote.create({
            config,
            stream: Stream,
            jitter: Jitter,
            phrases: Phrases,
            turns: Turns,
            lipSync: null,
        });
        const tp = loadProvider();
        tp.registerProvider('sonicagent-stream', provider);
        expect(await tp.setEngine('sonicagent-stream')).toBe(false);
        expect(tp.lastFailureDetail()).toMatchObject({ code: 'voice_routes_missing' });
        expect(tp.lastFailureDetail().message).toMatch(/no voice routes/);
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
    });

    test('the browser only ever presents the pairing token; never a SonicAgent key', async () => {
        const calls = [];
        const fetch = async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ voices: [] }),
            };
        };
        const g = Config.createGateway({
            fetch,
            info: () => ({ baseUrl: 'https://app.ollabridge.com', token: 'pair-tok' }),
        });
        await g.voices(true);
        await g.warmVoice('en_US-kristin-medium');
        expect(calls.map((c) => c.url)).toEqual([
            'https://app.ollabridge.com/v1/voice/voices?fresh=1',
            'https://app.ollabridge.com/v1/voice/voices/warm',
        ]);
        expect(calls.every((c) => c.init.headers.Authorization === 'Bearer pair-tok')).toBe(true);
        expect(calls.some((c) => /realtime|\/v1\/audio/.test(c.url))).toBe(false);
    });
});
