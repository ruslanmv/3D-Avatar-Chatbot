/**
 * HV1/HV6. The remote recognizer, the switch that picks it, and the consent/config it obeys.
 *
 * The microphone and the voice link are scripted, so each test says exactly what the person
 * and the server did. The properties: no audio without consent; exactly one result per commit;
 * a release before the mic opened records nothing; a stale final is ignored; a remote choice
 * never becomes the browser's recognizer.
 */
const fs = require('fs');
const path = require('path');
const Config = require('../../src/stt/SonicAgentVoiceConfig.js');
const Stream = require('../../src/stt/StreamingSttSession.js');
const Events = require('../../src/stt/RemoteSttEvents.js');
const Router = require('../../src/stt/SttRouter.js');
const { Recognition } = require('../../src/stt/RemoteSonicAgentSTT.js');

const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

function fakeMic() {
    const mic = { opened: 0, leases: [] };
    mic.open = (o) => {
        mic.opened++;
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
            grant(rate = 16000) {
                lease.granted = true;
                resolve({ ok: true, sampleRate: rate });
            },
            feed(samples, rate = 16000) {
                o.onFrames(samples, rate);
            },
        };
        mic.leases.push(lease);
        return lease;
    };
    return mic;
}

function fakeLink(options = Stream.WANTED_OPTIONS, result = { ok: true }) {
    const listeners = { event: new Set(), close: new Set(), audio: new Set() };
    let seq = 0;
    const link = {
        binary: [],
        control: [],
        retained: 0,
        ensureResult: Object.assign({ options }, result),
        pending: null,
        ensure() {
            return new Promise((r) => (link.pending = () => r(link.ensureResult)));
        },
        on(type, fn) {
            listeners[type].add(fn);
            return () => listeners[type].delete(fn);
        },
        emit(type, ev) {
            for (const fn of Array.from(listeners[type])) fn(ev);
        },
        sendBinary(b) {
            link.binary.push(Stream.decodeFrame(b));
            return true;
        },
        sendControl(c) {
            link.control.push(c);
            return true;
        },
        retain() {
            link.retained++;
            return () => link.retained--;
        },
        nextSequence: () => seq,
        setNextSequence: (n) => (seq = n),
    };
    return link;
}

function enabledConfig(over = {}) {
    const c = Object.assign({ enabled: true, consent: true }, over);
    return {
        allowed: (kind) =>
            !c.enabled
                ? { ok: false, code: 'disabled' }
                : kind !== 'tts' && !c.consent
                  ? { ok: false, code: 'no_consent' }
                  : { ok: true },
        language: () => 'en',
        voiceFor: () => 'en_US-lessac-medium',
        get: () => ({ voice: '' }),
    };
}

beforeAll(() => {
    global.NEXUS_REMOTE_STT_EVENTS = Events;
});

function build(over) {
    const mic = fakeMic();
    const link = fakeLink(over && over.options, over && over.result);
    const rec = new Recognition({
        mic,
        link,
        stream: Stream,
        config: (over && over.config) || enabledConfig(),
        suppressWhile: () => false,
    });
    const seen = { results: [], errors: [], ends: 0 };
    rec.onresult = (e) => seen.results.push(e.results[e.resultIndex][0].transcript);
    rec.onerror = (e) => seen.errors.push(e.error);
    rec.onend = () => seen.ends++;
    return { rec, mic, link, seen };
}

describe('the gate: nothing leaves without the feature, consent and a pairing', () => {
    test.each([
        [{ enabled: false }, 'service-not-allowed'],
        [{ consent: false }, 'not-allowed'],
    ])('%o → %s, the microphone is never opened', async (over, error) => {
        const { rec, mic, link, seen } = build({ config: enabledConfig(over) });
        rec.start();
        await flush();
        expect(seen.errors).toEqual([error]);
        expect(seen.ends).toBe(1);
        expect(mic.opened).toBe(0);
        expect(link.binary).toHaveLength(0);
    });

    test('the real config: off by default, and turning it on does not grant consent', () => {
        localStorage.clear();
        expect(Config.get()).toMatchObject({
            enabled: false,
            consent: false,
            autoFallback: false,
            speakWhileStreaming: false,
        });
        Config.set({ enabled: true });
        expect(Config.allowed('stt')).toEqual({ ok: false, code: 'no_consent' });
        Config.grantConsent();
        expect(Config.allowed('stt')).toEqual({ ok: false, code: 'not_configured' });
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({ ollabridge: { base_url: 'https://app.ollabridge.com/', pair_token: 'tok' } })
        );
        expect(Config.allowed('stt')).toEqual({ ok: true });
        expect(Config.gatewayInfo()).toEqual({ baseUrl: 'https://app.ollabridge.com', token: 'tok' });
        Config.revokeConsent();
        expect(Config.allowed('stt').code).toBe('no_consent');
        expect(Config.allowed('tts').ok).toBe(true); // speaking her reply is not the microphone
        localStorage.clear();
    });
});

describe('a push-to-talk turn', () => {
    test('streams frames while held, commits on release, delivers the matching final once', async () => {
        const { rec, mic, link, seen } = build();
        rec.holdToTalk = true;
        rec.start();
        mic.leases[0].grant(16000);
        await flush();
        link.pending();
        await flush();
        mic.leases[0].feed(new Float32Array(640).fill(0.2));
        expect(link.binary).toHaveLength(2);
        rec.stop();
        const last = link.binary.at(-1);
        expect(last.flags).toBe(Stream.FLAG_END);
        const commit = last.sequence;
        link.emit('event', { type: 'transcript.final', text: 'hello', commit_seq: commit + 5 }); // not ours
        expect(seen.results).toEqual([]);
        link.emit('event', { type: 'transcript.final', text: 'hello', commit_seq: commit });
        link.emit('event', { type: 'transcript.final', text: 'hello', commit_seq: commit }); // repeat
        await flush();
        expect(seen.results).toEqual(['hello']);
        expect(seen.errors).toEqual([]);
        expect(seen.ends).toBe(1);
        expect(link.retained).toBe(0);
    });

    test('audio captured while the link opens is held and sent the moment it is ready', async () => {
        const { rec, mic, link } = build();
        rec.holdToTalk = true;
        rec.start();
        mic.leases[0].grant(16000);
        await flush();
        mic.leases[0].feed(new Float32Array(960).fill(0.1));
        expect(link.binary).toHaveLength(0);
        link.pending();
        await flush();
        expect(link.binary.map((f) => f.sequence)).toEqual([0, 1, 2]);
    });

    test('released before the microphone opened: nothing recorded, nothing sent, no error', async () => {
        const { rec, mic, link, seen } = build();
        rec.holdToTalk = true;
        rec.start();
        rec.stop();
        await flush();
        link.pending();
        await flush();
        expect(mic.leases[0].closed).toBe(true);
        expect(link.binary).toHaveLength(0);
        expect(seen.errors).toEqual([]);
        expect(seen.ends).toBe(1);
    });

    test('an empty final is "no speech", not an empty chat message', async () => {
        const { rec, mic, link, seen } = build();
        rec.holdToTalk = true;
        rec.start();
        mic.leases[0].grant();
        await flush();
        link.pending();
        await flush();
        rec.stop();
        link.emit('event', {
            type: 'transcript.final',
            text: '',
            no_speech: true,
            commit_seq: link.binary.at(-1).sequence,
        });
        await flush();
        expect(seen.results).toEqual([]);
        expect(seen.errors).toEqual(['no-speech']);
    });

    test('abort: the server is told, and a final that arrives later is ignored', async () => {
        const { rec, mic, link, seen } = build();
        rec.holdToTalk = true;
        rec.start();
        mic.leases[0].grant();
        await flush();
        link.pending();
        await flush();
        rec.stop();
        const commit = link.binary.at(-1).sequence;
        rec.abort();
        link.emit('event', { type: 'transcript.final', text: 'too late', commit_seq: commit });
        await flush();
        expect(seen.results).toEqual([]);
        expect(seen.errors).toEqual(['aborted']);
        expect(link.control).toContainEqual({ type: 'turn.cancel', target: 'stt' });
    });
});

describe('failures say why, and never fall back', () => {
    test('a warming Space: network error with a readable reason; the microphone is released', async () => {
        const { rec, mic, link, seen } = build({ result: { ok: false, code: 'backend_warming', retryAfter: 20 } });
        let message = null;
        rec.onerror = (e) => {
            seen.errors.push(e.error);
            message = e.message;
        };
        rec.start();
        mic.leases[0].grant();
        await flush();
        link.pending();
        await flush();
        expect(seen.errors).toEqual(['network']);
        expect(message).toMatch(/starting up.*20 s/);
        expect(mic.leases[0].closed).toBe(true);
    });

    test('the link closing while a transcript is awaited ends the run with the reason', async () => {
        const { rec, mic, link, seen } = build();
        rec.holdToTalk = true;
        rec.start();
        mic.leases[0].grant();
        await flush();
        link.pending();
        await flush();
        rec.stop();
        link.emit('close', { code: 1013 });
        expect(seen.errors).toEqual(['network']);
        expect(seen.ends).toBe(1);
    });

    test('against a SonicAgent from before HV3, finals are counted until the line is quiet', async () => {
        jest.useFakeTimers();
        try {
            const { rec, mic, link, seen } = build({ options: Stream.V1_OPTIONS });
            rec.holdToTalk = true;
            rec.start();
            mic.leases[0].grant();
            await flush();
            link.pending();
            await flush();
            rec.stop();
            link.emit('event', { type: 'speech.stopped', turn_id: 'a' });
            link.emit('event', { type: 'speech.stopped', turn_id: 'b' });
            link.emit('event', { type: 'transcript.final', text: 'one', turn_id: 'a' });
            jest.advanceTimersByTime(1000);
            expect(seen.ends).toBe(0); // one transcription still outstanding
            link.emit('event', { type: 'transcript.final', text: 'two', turn_id: 'b' });
            jest.advanceTimersByTime(1000);
            expect(seen.results).toEqual(['one', 'two']);
            expect(seen.ends).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('the switch', () => {
    const caps = { secure: true, mic: true, audio: true, worker: true, wasm: true, websocket: true };

    test('sonicagent-stream routes to the remote engine and never to the browser', () => {
        expect(Router.decide({ provider: 'sonicagent-stream', capabilities: caps })).toEqual({
            engine: 'remote',
            reason: 'setting',
        });
        expect(Router.decide({ provider: 'sonicagent-stream', capabilities: { ...caps, websocket: false } })).toEqual({
            engine: 'unavailable',
            reason: 'no-websocket',
        });
        // Existing choices are unchanged.
        expect(Router.decide({ provider: 'webspeech', capabilities: caps }).engine).toBe('browser');
        expect(Router.decide({ provider: 'wasm', capabilities: caps }).engine).toBe('local');
    });

    test('SpeechService handles the remote provider before its browser fallback chain', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../js/speech-service.js'), 'utf8');
        const start = src.indexOf('async startSTT(');
        const remoteCase = src.indexOf("case 'sonicagent-stream':", start);
        const fallback = src.indexOf('// Automatic fallback chain', start);
        expect(remoteCase).toBeGreaterThan(start);
        expect(remoteCase).toBeLessThan(fallback);
        const body = src.slice(remoteCase, src.indexOf('case ', remoteCase + 10));
        expect(body).toMatch(/return this\.startRecognition\(callbacks\)/);
    });
});

describe('voice choice', () => {
    test('the person’s pick wins; the on-device Piper voice is never a candidate; never another language', () => {
        // HV-FIX: `piper_voice` belongs to the on-device engine; it used to outrank the presets.
        const installed = ['en_US-lessac-medium', 'it_IT-paola-medium', 'it_IT-riccardo-x_low'];
        expect(Config.pickVoice({ language: 'it', installed, chosen: 'it_IT-riccardo-x_low' })).toBe(
            'it_IT-riccardo-x_low'
        );
        expect(Config.pickVoice({ language: 'it', installed, piperVoice: 'it_IT-riccardo-x_low' })).toBe(
            'it_IT-paola-medium'
        );
        expect(Config.pickVoice({ language: 'de', installed })).toBeNull();
    });
});

describe('the OllaBridge voice client', () => {
    test('sends the pairing token, never asks for a SonicAgent key, and maps error envelopes', async () => {
        const calls = [];
        const fetch = async (url, init) => {
            calls.push({ url, init });
            if (url.endsWith('/stream-sessions')) {
                return {
                    ok: false,
                    status: 503,
                    headers: { get: (h) => (h === 'retry-after' ? '20' : 'application/json') },
                    json: async () => ({ detail: { error: 'backend_warming', message: 'starting' } }),
                };
            }
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ available: true }),
            };
        };
        const g = Config.createGateway({
            fetch,
            info: () => ({ baseUrl: 'https://app.ollabridge.com', token: 'pair-tok' }),
        });
        expect(await g.capabilities(true)).toEqual({ available: true });
        expect(calls[0].url).toBe('https://app.ollabridge.com/v1/voice/capabilities?fresh=1');
        expect(calls[0].init.headers.Authorization).toBe('Bearer pair-tok');
        await expect(g.createStreamSession({ mode: 'stt_only' })).rejects.toMatchObject({
            code: 'backend_warming',
            retryAfter: 20,
        });
    });

    test('every error code has a sentence in the browser’s vocabulary', () => {
        for (const code of [
            'backend_warming',
            'unauthenticated',
            'no_consent',
            'disabled',
            'not_configured',
            'link_closed',
        ]) {
            const f = Events.errorFor(code);
            expect(['network', 'not-allowed', 'service-not-allowed']).toContain(f.error);
            expect(f.message.length).toBeGreaterThan(10);
        }
    });
});
