/**
 * The voice uplink, client side (B10).
 *
 * B10 is an integration batch and the tests are shaped by that. What is asserted most often
 * here is what the adapter does *not* do: it does not build a recogniser, does not replace
 * the app's handlers, does not touch the transcript SpeechService already owns, and does not
 * turn a declined microphone into a broken session.
 *
 * The two acceptance sentences:
 *
 *   * speech → reply → gesture end to end — the last block runs a real transcript through a
 *     fake socket, a real SessionAdapter and the real registry/selector/ranker, and ends on
 *     a clip;
 *   * declining the mic leaves every other channel working — every test in
 *     "declining the microphone" is a negative assertion about a channel that still runs.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const Registry = require('../../src/behavior/registry/AnimationRegistry.js');
const AntiRepeat = require('../../src/behavior/selector/AntiRepeatMemory.js');
const { Ranker } = require('../../src/behavior/selector/UtilityRanker.js');
const { Selector } = require('../../src/behavior/selector/SemanticSelector.js');
const SessionAdapter = require('../../src/behavior/adapters/SessionAdapter.js');
const VoiceAdapter = require('../../src/behavior/adapters/VoiceAdapter.js');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'protocol');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

/** A stand-in for the app's SpeechService: the same surface, none of the browser. */
class FakeSpeechService {
    constructor({ granted = true, supported = true, recognition = true } = {}) {
        this.isRecognitionSupported = supported;
        this.recognition = recognition ? {} : null;
        this.granted = granted;
        this.permissionAsks = 0;
        this.appSaw = [];
        if (this.recognition) {
            // What SpeechService itself does with these today: logs. Recorded so a test can
            // prove the adapter chained rather than replaced.
            for (const key of ['onspeechstart', 'onspeechend', 'onerror', 'onend']) {
                this.recognition[key] = () => this.appSaw.push(key);
            }
        }
    }

    async requestMicrophonePermission() {
        this.permissionAsks++;
        return this.granted;
    }
}

class FakeSocket {
    constructor(url) {
        this.url = url;
        this.sent = [];
    }
    send(payload) {
        this.sent.push(JSON.parse(payload));
    }
    close() {}
    open() {
        if (this.onopen) this.onopen();
    }
    deliver(message) {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(message) });
    }
}

/** A live session adapter over a fake socket, plus a voice adapter bound to it. */
function rig({ speech = new FakeSpeechService(), bus = new EventBus({}), blackboard = new Blackboard({}) } = {}) {
    let socket;
    const session = new SessionAdapter.Adapter({
        bus,
        blackboard,
        config: { ...CONFIG, session: { enabled: true, url: 'wss://test/avatar/session' } },
        socketFactory: (url) => {
            socket = new FakeSocket(url);
            return socket;
        },
    });
    session.connect();
    socket.open();
    const voice = VoiceAdapter.attach({ bus, blackboard, session, config: CONFIG });
    return {
        bus,
        blackboard,
        session,
        voice,
        speech,
        socket,
        get sent() {
            return socket.sent;
        },
    };
}

let open = [];

beforeEach(() => {
    open = [];
    jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    for (const item of open) item.detach();
    jest.restoreAllMocks();
});

const track = (r) => {
    open.push(r.voice, r.session);
    return r;
};

describe('it observes the recogniser the app already has', () => {
    test('attaching asks for nothing — consent is a user action, not a boot step', () => {
        const speech = new FakeSpeechService();
        const r = track(rig({ speech }));
        r.voice.speech = speech;

        expect(speech.permissionAsks).toBe(0);
        expect(r.voice.stats.status).toBe('off');
    });

    test('enabling chains onto the app handlers rather than replacing them', async () => {
        const speech = new FakeSpeechService();
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        const before = speech.recognition.onspeechstart;

        await r.voice.enable();
        expect(speech.recognition.onspeechstart).not.toBe(before);

        speech.recognition.onspeechstart();
        // The app's own handler still ran. That is the difference between decorating and
        // taking over, and it is the whole reason js/speech-service.js is not edited.
        expect(speech.appSaw).toEqual(['onspeechstart']);
    });

    test('detach puts every original handler back exactly', async () => {
        const speech = new FakeSpeechService();
        const originals = { ...speech.recognition };
        const r = rig({ speech });
        r.voice.speech = speech;

        await r.voice.enable();
        r.voice.detach();
        r.session.detach();

        for (const key of Object.keys(originals)) {
            expect(`${key}: ${speech.recognition[key] === originals[key]}`).toBe(`${key}: true`);
        }
    });

    test('it carries no recogniser of its own', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src', 'behavior', 'adapters', 'VoiceAdapter.js'), 'utf8');
        const body = source.slice(source.indexOf('const VoiceAdapter'));
        for (const forbidden of ['webkitSpeechRecognition', 'new SpeechRecognition', 'MediaRecorder', 'AudioContext']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });
});

describe('voice activity reaches the bus', () => {
    async function listening() {
        const speech = new FakeSpeechService();
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await r.voice.enable();
        const events = [];
        r.bus.on('user:speaking', () => events.push('speaking'));
        r.bus.on('user:silent', () => events.push('silent'));
        return { ...r, speech, events };
    }

    test('the browser edges become user:speaking and user:silent', async () => {
        const r = await listening();
        r.speech.recognition.onspeechstart();
        r.speech.recognition.onspeechend();
        expect(r.events).toEqual(['speaking', 'silent']);
    });

    test('the blackboard flag follows, because §6.7 etiquette reads it', async () => {
        const r = await listening();
        r.speech.recognition.onspeechstart();
        expect(r.blackboard.flags.userSpeaking).toBe(true);
        r.speech.recognition.onspeechend();
        expect(r.blackboard.flags.userSpeaking).toBe(false);
    });

    test('repeated edges do not repeat the event', async () => {
        const r = await listening();
        r.speech.recognition.onspeechstart();
        r.speech.recognition.onspeechstart();
        r.speech.recognition.onspeechend();
        r.speech.recognition.onspeechend();
        expect(r.events).toEqual(['speaking', 'silent']);
    });

    test('a recogniser that errors or ends is not left latched as speaking', async () => {
        // onspeechend is unreliable on some builds. Latching here is how she ends up waiting
        // politely for a sentence that finished two minutes ago.
        for (const ending of ['onerror', 'onend']) {
            const r = await listening();
            r.speech.recognition.onspeechstart();
            r.speech.recognition[ending]({});
            expect(`${ending}: ${r.events.join()}`).toBe(`${ending}: speaking,silent`);
        }
    });

    test('the tick releases a stuck speaking flag after the tail', async () => {
        let clock = 0;
        const speech = new FakeSpeechService();
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        r.voice.now = () => clock;
        await r.voice.enable();

        r.voice.transcript('there we go', { final: true });
        r.voice.setSpeaking(true); // as if a late onspeechstart arrived and never ended
        clock += VoiceAdapter.SPEECH_TAIL_MS + 1;
        r.voice.tick();
        expect(r.voice.stats.speaking).toBe(false);
    });
});

describe('negotiation', () => {
    test('the uplink is offered only once there is a microphone', async () => {
        const speech = new FakeSpeechService();
        const r = track(rig({ speech }));
        r.voice.speech = speech;

        expect(r.sent.filter((m) => m.type === 'voice_offer')).toEqual([]);
        await r.voice.enable();

        const offer = r.sent.find((m) => m.type === 'voice_offer');
        expect(offer).toEqual({ v: 1, type: 'voice_offer', mode: 'transcript', sdp: '' });
    });

    test('a declined microphone offers nothing to the server', async () => {
        const speech = new FakeSpeechService({ granted: false });
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await r.voice.enable();
        expect(r.sent.some((m) => m.type === 'voice_offer')).toBe(false);
    });

    test('the answer records the mode the server accepted, not the one offered', () => {
        const r = track(rig());
        r.socket.deliver({ v: 1, type: 'voice_answer', sdp: '', mode: 'transcript' });
        expect(r.session.stats.voice).toBe('transcript');
    });

    test('the answer fixture round-trips', () => {
        const r = track(rig());
        expect(r.session.receive(fixture('s2c-voice_answer.json').message).action).toBe('applied');
        expect(r.session.receive(fixture('s2c-voice_state.json').message).action).toBe('applied');
        expect(r.session.stats.voiceState).toBe('listening');
    });

    test('an unknown voice state is dropped rather than shown', () => {
        const r = track(rig());
        expect(r.session.receive({ v: 1, type: 'voice_state', state: 'dancing' }).why).toBe('unknown voice state');
        expect(r.session.stats.voiceState).toBe('idle');
    });

    test('voice_state never reaches the bus — it is an indicator, not a feeling', () => {
        const r = track(rig());
        const seen = [];
        for (const event of EventBus.EVENTS) r.bus.on(event, () => seen.push(event));
        r.session.receive({ v: 1, type: 'voice_state', state: 'thinking' });
        expect(seen).toEqual([]);
    });

    test('a transcript before the answer is kept local rather than posted into the void', () => {
        const r = track(rig());
        expect(r.voice.transcript('hello', { final: true })).toEqual({
            action: 'local',
            why: 'uplink not negotiated',
        });
        expect(r.sent.some((m) => m.type === 'voice_transcript')).toBe(false);
    });

    test('losing the socket forgets the negotiation, so the reconnect re-offers', () => {
        const r = track(rig());
        r.socket.deliver({ v: 1, type: 'voice_answer', sdp: '', mode: 'transcript' });
        expect(r.session.stats.voice).toBe('transcript');

        r.socket.onclose();
        expect(r.session.stats.voice).toBe(null);
        expect(r.voice.transcript('still there?', { final: true }).action).toBe('local');
    });
});

describe('transcripts', () => {
    function negotiated() {
        const r = track(rig());
        r.socket.deliver({ v: 1, type: 'voice_answer', sdp: '', mode: 'transcript' });
        return r;
    }

    test('a final transcript goes up in the fixture shape', () => {
        const r = negotiated();
        expect(r.voice.transcript('did the parcel arrive?', { final: true }).action).toBe('sent');
        expect(r.sent.pop()).toEqual({
            v: 1,
            type: 'voice_transcript',
            text: 'did the parcel arrive?',
            final: true,
            lang: 'en',
        });
    });

    test('interim text moves the VAD edge and sends nothing', () => {
        const r = negotiated();
        const events = [];
        r.bus.on('user:speaking', () => events.push('speaking'));

        expect(r.voice.transcript('did the par', { final: false }).action).toBe('interim');
        expect(events).toEqual(['speaking']);
        expect(r.sent.some((m) => m.type === 'voice_transcript')).toBe(false);
    });

    test('an empty transcript is ignored', () => {
        const r = negotiated();
        expect(r.voice.transcript('   ', { final: true }).why).toBe('empty');
    });

    test('with no session the transcript stays local — nothing was taken away', () => {
        const voice = VoiceAdapter.attach({ bus: new EventBus({}), blackboard: new Blackboard({}) });
        expect(voice.transcript('hello', { final: true })).toEqual({ action: 'local', why: 'no session' });
    });
});

describe('declining the microphone', () => {
    test('a refusal is a status, not an exception', async () => {
        const speech = new FakeSpeechService({ granted: false });
        const r = track(rig({ speech }));
        r.voice.speech = speech;

        await expect(r.voice.enable()).resolves.toBe('unavailable');
        expect(r.voice.stats.reason).toBe('microphone declined');
    });

    test('a browser with no recogniser says so specifically', async () => {
        const speech = new FakeSpeechService({ supported: false });
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await r.voice.enable();
        expect(r.voice.stats.reason).toContain('no speech recognition');
    });

    test('a permission request that throws is caught, not propagated', async () => {
        const speech = new FakeSpeechService();
        speech.requestMicrophonePermission = async () => {
            throw new Error('SecurityError');
        };
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await expect(r.voice.enable()).resolves.toBe('unavailable');
    });

    test('every other channel still works after the refusal', async () => {
        const speech = new FakeSpeechService({ granted: false });
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await r.voice.enable();

        // The session socket: still up, still delivering.
        const intents = [];
        r.bus.on('intent', (intent) => intents.push(intent.name));
        r.socket.deliver({ v: 1, type: 'intent', name: 'wave', intensity: 0.6, source: 'curiosity' });
        expect(intents).toEqual(['wave']);

        // The bus and the blackboard: untouched.
        r.bus.emit('user:idle', {});
        r.blackboard.setMood(0.5, 0.4);
        expect(r.blackboard.snapshot().valence).toBe(0.5);

        // And the server can still speak, which is the channel a mic refusal would most
        // plausibly have broken.
        let spoken = null;
        r.session.say = (text) => {
            spoken = text;
        };
        r.socket.deliver({ v: 1, type: 'say', text: 'no problem.', source: 'curiosity' });
        expect(spoken).toBe('no problem.');
    });

    test('it never observes the recogniser it was refused', async () => {
        const speech = new FakeSpeechService({ granted: false });
        const originals = { ...speech.recognition };
        const r = track(rig({ speech }));
        r.voice.speech = speech;
        await r.voice.enable();
        for (const key of Object.keys(originals)) {
            expect(`${key}: ${speech.recognition[key] === originals[key]}`).toBe(`${key}: true`);
        }
    });
});

describe('speech to reply to gesture', () => {
    /**
     * The acceptance sentence, with nothing faked between the transcript and the clip: a
     * real SessionAdapter over a fake socket, then the real registry, selector and ranker
     * that boot.js wires. Only the network and the microphone are stand-ins.
     */
    test('a spoken sentence ends in a clip', () => {
        const registry = new Registry().loadText(
            fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8')
        );
        const selector = new Selector()
            .loadVocabularyText(fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.vocab.tsv'), 'utf8'))
            .index(registry.records);
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(CONFIG.antiRepeatWindow) });

        const r = track(rig());
        const picks = [];
        const spoken = [];
        r.session.say = (text) => spoken.push(text);
        r.bus.on('intent', (intent) => {
            picks.push(ranker.best(selector.topK(intent, registry, CONFIG.topK), intent, r.blackboard));
        });

        r.socket.deliver({ v: 1, type: 'voice_answer', sdp: '', mode: 'transcript' });

        // 1. She hears it.
        expect(r.voice.transcript('I missed you', { final: true }).action).toBe('sent');
        expect(r.sent.pop().text).toBe('I missed you');

        // 2. The server answers: the reply, already split into a gesture and a sentence.
        r.socket.deliver({ v: 1, type: 'intent', name: 'happy', intensity: 0.8, source: 'voice' });
        r.socket.deliver({ v: 1, type: 'say', text: 'I missed you too.', source: 'voice' });

        // 3. She speaks and she moves.
        expect(spoken).toEqual(['I missed you too.']);
        expect(picks).toHaveLength(1);
        expect(typeof picks[0].clip.id).toBe('string');
        expect(picks[0].clip.intents).toContain('happy');
    });

    test('a voice gesture is still held to the whitelist and the gates', () => {
        const r = track(rig());
        const seen = [];
        r.bus.on('intent', (intent) => seen.push(intent));
        r.socket.deliver({ v: 1, type: 'voice_answer', sdp: '', mode: 'transcript' });

        r.socket.deliver({ v: 1, type: 'intent', name: 'twerk', intensity: 1, source: 'voice' });
        expect(seen).toEqual([]);
        expect(r.session.stats.dropped.notWhitelisted).toBe(1);

        // And `voice` is not `user`, so §6.5's NSFW gate still holds against it.
        const blackboard = new Blackboard({ nsfwAllowed: true });
        blackboard.mode = { id: 'test', allowNsfw: true, allows: () => true };
        const spicy = { id: 'x', nsfw: true, energy: 0.5, valence: 0, quality: 'production' };
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(5) });
        expect(ranker.score(spicy, { name: 'flirt', source: 'voice' }, blackboard)).toBe(-Infinity);
    });
});
