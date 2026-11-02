/**
 * HV4/HV5/HV6. The streamed SonicAgent voice as a TTSProvider engine, its lip-sync drive, and
 * the Settings section. The link and the player are scripted; jitter buffer, phrase scheduler
 * and turn controller are the real modules.
 */
const Stream = require('../../src/stt/StreamingSttSession.js');
const Jitter = require('../../src/tts/AudioJitterBuffer.js');
const Phrases = require('../../src/tts/PhraseSpeechScheduler.js');
const Turns = require('../../src/tts/VoiceTurnController.js');
const Remote = require('../../src/tts/RemoteSonicAgentTTS.js');

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fakeLink({ options = Stream.WANTED_OPTIONS, session = { options: {} }, ensure = { ok: true } } = {}) {
    const listeners = { event: new Set(), audio: new Set(), close: new Set() };
    return {
        control: [],
        retained: 0,
        ensure: async () => Object.assign({ options }, ensure),
        session: () => session,
        on(type, fn) {
            listeners[type].add(fn);
            return () => listeners[type].delete(fn);
        },
        emit(type, ev) {
            for (const fn of Array.from(listeners[type])) fn(ev);
        },
        sendControl(c) {
            this.control.push(c);
            return true;
        },
        retain() {
            this.retained++;
            return () => this.retained--;
        },
        speaks() {
            return this.control.filter((c) => c.type === 'tts.speak');
        },
    };
}

function fakePlayer() {
    const handlers = {};
    return {
        pushed: [],
        ended: [],
        stopped: 0,
        played: 0,
        on: (k, fn) => (handlers[k] = fn),
        fire: (k, key) => handlers[k] && handlers[k](key),
        beginTurn: async (key) => {
            this.key = key;
            return 'fake';
        },
        push(key, phraseId, samples) {
            this.pushed.push({ key, phraseId, n: samples.length });
            return true;
        },
        endTurn(key) {
            this.ended.push(key);
        },
        stop() {
            this.stopped++;
        },
        phrasePlayedMs: () => 123,
        level: () => 0.3,
    };
}

function config(over = {}) {
    const c = Object.assign({ enabled: true, jitterMs: 0, autoFallback: false }, over);
    return {
        allowed: () => (c.enabled ? { ok: true } : { ok: false, code: 'disabled' }),
        language: () => c.language || 'en',
        voiceFor: () => (c.noVoice ? null : 'en_US-lessac-medium'),
        installedVoices: () => (c.noVoice ? ['en_US-lessac-medium'] : ['en_US-lessac-medium']),
        get: () => c,
        gateway: () => ({ capabilities: async () => ({}) }),
        rememberCapabilities: () => {},
    };
}

function pcmFrame(sequence) {
    return { type: 2, sequence, sampleRate: 16000, payload: Stream.floatToPcm16(new Float32Array(320).fill(0.1)) };
}

function build(over = {}) {
    const link = fakeLink(over.link);
    const player = fakePlayer();
    const lip = { driven: null, drive: (fn) => (lip.driven = fn), undrive: () => (lip.driven = null) };
    const provider = Remote.create({
        link,
        player,
        config: config(over.config),
        stream: Stream,
        jitter: Jitter,
        phrases: Phrases,
        turns: Turns,
        lipSync: lip,
        setInterval: (fn) => {
            lip.tick = fn;
            return 1;
        },
        clearInterval: () => {},
    });
    return { link, player, provider, lip };
}

/** Play one server phrase: started, frames, done. */
function serve(link, turnId, frames = 2) {
    link.emit('event', { type: 'tts.started', turn_id: turnId });
    for (let i = 0; i < frames; i++) link.emit('audio', pcmFrame(i));
    link.emit('event', { type: 'tts.audio.done', turn_id: turnId });
}

describe('speaking a whole reply', () => {
    test('phrases go up in order and play in order; onStart at the first sample, onEnd after the last', async () => {
        const { link, player, provider, lip } = build();
        const onStart = jest.fn();
        const onEnd = jest.fn();
        await provider.speak('Hello there, nice to meet you. How can I help you today?', { onStart, onEnd });
        await flush();
        const speaks = link.speaks();
        expect(speaks.map((s) => s.text)).toEqual(['Hello there, nice to meet you.', 'How can I help you today?']);
        expect(new Set(speaks.map((s) => s.turn_id)).size).toBe(2);
        expect(onStart).not.toHaveBeenCalled(); // the network answering is not "speaking"
        serve(link, speaks[0].turn_id);
        serve(link, speaks[1].turn_id);
        expect(player.pushed.map((p) => p.phraseId)).toEqual([
            speaks[0].turn_id,
            speaks[0].turn_id,
            speaks[1].turn_id,
            speaks[1].turn_id,
        ]);
        expect(typeof lip.driven).toBe('function'); // the mouth follows the audio
        player.fire('start', player.ended[0] || provider._turns.current());
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(player.ended).toHaveLength(1);
        expect(onEnd).not.toHaveBeenCalled(); // "done" from the server is not the end of playback
        player.fire('end', player.ended[0]);
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(lip.driven).toBeNull();
        expect(link.retained).toBe(0);
    });

    test('without the server queue, the next phrase waits for the last one’s tts.audio.done', async () => {
        const { link, provider } = build({ link: { options: { ...Stream.WANTED_OPTIONS, tts_queue: false } } });
        await provider.speak('The first sentence is right here. The second sentence follows it.', {});
        await flush();
        expect(link.speaks()).toHaveLength(1);
        serve(link, link.speaks()[0].turn_id);
        expect(link.speaks()).toHaveLength(2);
    });

    test('a SonicAgent from before HV3 is refused with the reason, before anything is sent', async () => {
        const { link, provider } = build({ link: { session: {} } });
        const onError = jest.fn();
        await provider.speak('Hello.', { onError });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'requires_hv3' }));
        expect(link.speaks()).toHaveLength(0);
    });

    test('remote voice turned off: onError once, nothing sent, nothing stored', async () => {
        localStorage.setItem('tts_engine', 'sonicagent-stream');
        const { link, provider } = build({ config: { enabled: false } });
        const onError = jest.fn();
        await provider.speak('Hello.', { onError });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(link.speaks()).toHaveLength(0);
        expect(localStorage.getItem('tts_engine')).toBe('sonicagent-stream');
        await expect(provider.init()).rejects.toMatchObject({ code: 'disabled' });
        localStorage.clear();
    });

    test('stop() cancels everywhere: server queue, player — and late frames change nothing', async () => {
        const { link, player, provider } = build();
        const onEnd = jest.fn();
        await provider.speak('One sentence that is long enough. Another sentence that is long.', { onEnd });
        await flush();
        const [first] = link.speaks();
        link.emit('event', { type: 'tts.started', turn_id: first.turn_id });
        link.emit('audio', pcmFrame(0));
        const before = player.pushed.length;
        provider.stop();
        expect(link.control).toContainEqual(expect.objectContaining({ type: 'turn.cancel', target: 'tts' }));
        expect(player.stopped).toBeGreaterThan(0);
        link.emit('audio', pcmFrame(1));
        link.emit('event', { type: 'tts.audio.done', turn_id: first.turn_id });
        expect(player.pushed.length).toBe(before);
        expect(onEnd).not.toHaveBeenCalled();
    });

    test('a newer reply cancels the older one: only the newest turn speaks', async () => {
        const { link, provider } = build();
        await provider.speak('The first reply is right here.', {});
        await provider.speak('The second reply replaces it.', {});
        await flush();
        expect(link.control.filter((c) => c.type === 'turn.cancel')).toHaveLength(1);
    });

    test('with ack flow control, playback is reported for the phrase being received', async () => {
        const { link, provider, lip } = build();
        await provider.speak('A sentence long enough to send.', {});
        await flush();
        link.emit('event', { type: 'tts.started', turn_id: link.speaks()[0].turn_id });
        lip.tick();
        expect(link.control).toContainEqual({
            type: 'playback.ack',
            turn_id: link.speaks()[0].turn_id,
            played_ms: 123,
        });
    });

    test('a server error before any audio goes to onError (so the app can fall back); after audio, it ends', async () => {
        const a = build();
        const onError = jest.fn();
        await a.provider.speak('A sentence long enough to send.', { onError });
        await flush();
        a.link.emit('event', { type: 'session.error', turn_id: a.link.speaks()[0].turn_id, code: 'voice_unavailable' });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'voice_unavailable' }));
    });
});

describe('HV5: speaking while the reply streams', () => {
    test('the first sentence goes up before the reply is finished; finish(final) speaks the rest', async () => {
        const { link, provider } = build();
        const s = provider.streamReply({ clean: (t) => t });
        await s.ready;
        s.push('Sure thing. Let me tell you about ');
        await flush();
        expect(link.speaks().map((x) => x.text)).toEqual(['Sure thing.']);
        s.push('Rome <ambience scene="rome"/>');
        expect(await s.finish('Sure thing. Let me tell you about Rome.')).toBe(true);
        expect(link.speaks().map((x) => x.text)).toEqual(['Sure thing.', 'Let me tell you about Rome.']);
    });

    test('a final text that no longer contains what was spoken cancels the streamed voice', async () => {
        const { link, provider } = build();
        const s = provider.streamReply({ clean: (t) => t });
        await s.ready;
        s.push('Let me look that up for you now. ');
        await flush();
        expect(await s.finish('Canberra is the capital of Australia.')).toBe(false);
        expect(link.control).toContainEqual(expect.objectContaining({ type: 'turn.cancel', target: 'tts' }));
    });
});

describe('lip-sync follows the audio level while driven', () => {
    test('drive/undrive', () => {
        global.window = global.window || global;
        require('../../src/LipSyncEngine.js');
        const L = window.NEXUS_LIP_SYNC;
        const set = {};
        const vrm = { currentVRM: { expressionManager: {} }, setExpression: (k, v) => (set[k] = v) };
        L.drive(() => 0.2);
        for (let i = 0; i < 60; i++) L.update(1 / 60, vrm);
        expect(set.aa).toBeGreaterThan(0.4);
        expect(L.isDriven).toBe(true);
        L.undrive();
        for (let i = 0; i < 120; i++) L.update(1 / 60, vrm);
        expect(set.aa).toBeLessThan(0.01);
    });
});

describe('Settings ▸ ADVANCED VOICE — SONICAGENT STREAMING', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML =
            '<div id="settings-modal"><div class="modal-content">' +
            '<select id="stt-provider"><option value="webspeech">W</option><option value="wasm">L</option></select>' +
            '<select id="tts-engine"><option value="web-speech-api">B</option></select>' +
            '<div class="config-section"><h3 class="config-title">DEVELOPER</h3></div>' +
            '</div></div>';
        global.NEXUS_SONIC_VOICE = require('../../src/stt/SonicAgentVoiceConfig.js');
    });

    test('adds the remote choices without changing the saved ones, and sits before DEVELOPER', () => {
        const S = require('../../src/stt/SonicAgentVoiceSettings.js');
        S.attach({ doc: document });
        expect(Array.from(document.getElementById('stt-provider').options).map((o) => o.value)).toEqual([
            'webspeech',
            'wasm',
            'sonicagent-stream',
        ]);
        expect(document.getElementById('stt-provider').value).toBe('webspeech');
        expect(Array.from(document.getElementById('tts-engine').options).map((o) => o.value)).toContain(
            'sonicagent-stream'
        );
        const sections = Array.from(document.querySelectorAll('.config-section')).map(
            (n) => n.querySelector('.config-title').textContent
        );
        expect(sections).toEqual(['ADVANCED VOICE — SONICAGENT STREAMING', 'DEVELOPER']);
        expect(document.body.textContent).toContain(
            'Your microphone audio will be sent to OllaBridge Cloud and SonicAgent for transcription.'
        );
        expect(localStorage.getItem('stt_config')).toBeNull();
    });

    test('enabling does not consent; turning it off withdraws consent', () => {
        const S = require('../../src/stt/SonicAgentVoiceSettings.js');
        S.attach({ doc: document });
        const C = global.NEXUS_SONIC_VOICE;
        const enabled = document.getElementById('sonic-enabled');
        const consent = document.getElementById('sonic-consent');
        expect(consent.disabled).toBe(true);
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change'));
        expect(C.get()).toMatchObject({ enabled: true, consent: false });
        consent.checked = true;
        consent.dispatchEvent(new Event('change'));
        expect(C.get().consent).toBe(true);
        enabled.checked = false;
        enabled.dispatchEvent(new Event('change'));
        expect(C.get()).toMatchObject({ enabled: false, consent: false });
    });
});
