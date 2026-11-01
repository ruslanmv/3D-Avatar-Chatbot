/**
 * HV4/HV5. Jitter buffer, phrase scheduler, turn controller, player and playback worklet.
 * No Web Audio in jsdom: the AudioContext is a scripted fake with a hand-driven clock.
 */
const Jitter = require('../../src/tts/AudioJitterBuffer.js');
const Phrases = require('../../src/tts/PhraseSpeechScheduler.js');
const Turns = require('../../src/tts/VoiceTurnController.js');
const Player = require('../../src/tts/StreamingAudioPlayer.js');

const frame = (sequence, ms = 40, rate = 16000) => ({
    sequence,
    samples: new Float32Array((rate * ms) / 1000).fill(sequence + 1),
    sampleRate: rate,
});

describe('AudioJitterBuffer', () => {
    test('releases in sequence order, not arrival order, after the start target', () => {
        const b = Jitter.create({ startMs: 80 });
        b.push(frame(1));
        expect(b.pull()).toBeNull(); // 40 ms buffered < 80 ms
        b.push(frame(0));
        const out = b.drain();
        expect(out.map((p) => p.sequence)).toEqual([0, 1]);
    });

    test('duplicates and late frames are dropped and counted', () => {
        const b = Jitter.create({ startMs: 0 });
        expect(b.push(frame(0))).toBe('accepted');
        expect(b.push(frame(0))).toBe('duplicate');
        b.drain();
        expect(b.push(frame(0))).toBe('late');
        expect(b.stats()).toMatchObject({ duplicates: 1, late: 1 });
    });

    test('a gap is waited for, then filled with silence of its length — never skipped', () => {
        let t = 0;
        const b = Jitter.create({ startMs: 0, gapWaitMs: 100, now: () => t });
        b.push(frame(0));
        b.push(frame(3));
        expect(b.drain().map((p) => p.sequence)).toEqual([0]);
        t = 50;
        expect(b.pull()).toBeNull();
        t = 150;
        const fill = b.pull();
        expect(fill.fill).toBe(true);
        expect(fill.samples.length).toBe(2 * 640); // frames 1 and 2, 40 ms each at 16 kHz
        expect(fill.samples.every((v) => v === 0)).toBe(true);
        expect(b.pull().sequence).toBe(3);
        expect(b.stats()).toMatchObject({ gaps: 1, gapMs: 80 });
    });

    test('bounded: more than maxMs buffered is refused', () => {
        const b = Jitter.create({ startMs: 1000, maxMs: 100 });
        expect(b.push(frame(0))).toBe('accepted');
        expect(b.push(frame(1))).toBe('accepted');
        expect(b.push(frame(2))).toBe('overflow');
    });

    test('a short phrase that has ended plays at once, below the start target', () => {
        const b = Jitter.create({ startMs: 500 });
        b.push(frame(0));
        expect(b.pull()).toBeNull();
        b.end();
        expect(b.pull().sequence).toBe(0);
        expect(b.finished()).toBe(true);
    });
});

describe('PhraseSpeechScheduler', () => {
    const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

    test('whole sentences, short ones joined, never a cut inside a word', () => {
        // The opening only needs `firstMinChars` (8): what the person waits for goes out alone.
        const out = Phrases.split('Hi! Sure. The weather in Rome is sunny today. Bring sunglasses!', { minChars: 24 });
        expect(out).toEqual(['Hi! Sure.', 'The weather in Rome is sunny today.', 'Bring sunglasses!']);
        // Later short sentences are joined until minChars.
        expect(Phrases.split('Okay, here goes. Yes. No. Maybe so. That is all.', { minChars: 24 })).toEqual([
            'Okay, here goes.',
            'Yes. No. Maybe so. That is all.',
        ]);
    });

    test('streamed tokens are cut only behind a boundary later tokens cannot move', () => {
        const said = [];
        const s = Phrases.create(Object.assign({ minChars: 10, onPhrase: (p) => said.push(p) }, noTimers));
        for (const tok of ['The answ', 'er is for', 'ty-two. And', ' that is all']) s.push(tok);
        expect(said).toEqual(['The answer is forty-two.']);
        s.end();
        expect(said).toEqual(['The answer is forty-two.', 'And that is all']);
    });

    test('directives and fenced blocks are never spoken; an open tag is held until it closes', () => {
        const said = [];
        const s = Phrases.create(Object.assign({ minChars: 5, onPhrase: (p) => said.push(p) }, noTimers));
        s.push('Playing it now. <play kind="music">lofi beats');
        expect(said).toEqual(['Playing it now.']);
        s.push('</play> Enjoy the music. ```motion\n{"wave":1}\n``` <ambience scene="beach"/> See you at the beach!');
        s.end();
        expect(said.join(' ')).toBe('Playing it now. Enjoy the music. See you at the beach!');
        expect(said.join(' ')).not.toMatch(/lofi|wave|ambience|motion/);
    });

    test('a long sentence with no end is cut at a clause after maxWaitMs', () => {
        jest.useFakeTimers();
        try {
            const said = [];
            const s = Phrases.create({ minChars: 10, maxWaitMs: 500, onPhrase: (p) => said.push(p) });
            s.push('Well, thinking about everything you said, and about the trip next');
            expect(said).toEqual([]);
            jest.advanceTimersByTime(600);
            expect(said).toEqual([
                'Well, thinking about everything you said, and about the trip next'.slice(0, 41).trim(),
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('finish(final): speaks the rest of the FINAL text when what was said is still in it', () => {
        const said = [];
        const s = Phrases.create(Object.assign({ minChars: 5, onPhrase: (p) => said.push(p) }, noTimers));
        s.push('Hello there. I can help **with that** <wardrobe action="wear" look="red"/>');
        expect(said).toEqual(['Hello there.']);
        expect(s.finish('Hello there. I can help with that. Here is your red dress!')).toBe(true);
        expect(said).toEqual(['Hello there.', 'I can help with that.', 'Here is your red dress!']);
    });

    test('finish(final) answers false when the final text no longer contains what was spoken', () => {
        const said = [];
        const s = Phrases.create(Object.assign({ minChars: 5, onPhrase: (p) => said.push(p) }, noTimers));
        s.push('Let me look that up for you. ');
        expect(s.finish('The capital of Australia is Canberra.')).toBe(false);
        expect(said).toEqual(['Let me look that up for you.']);
    });

    test('bounded: never more than maxPhrases requests for one reply', () => {
        const out = Phrases.split('A b c d. '.repeat(500), { minChars: 1, maxPhrases: 64 });
        expect(out.length).toBeLessThanOrEqual(64);
    });
});

describe('VoiceTurnController', () => {
    test('only the newest turn is current; begin() cancels the previous one', () => {
        const t = Turns.create();
        const a = t.begin();
        const undo = jest.fn();
        t.onCancel(a, undo);
        const b = t.begin();
        expect(undo).toHaveBeenCalledTimes(1);
        expect(t.isCurrent(a)).toBe(false);
        expect(t.isCurrent(b)).toBe(true);
    });

    test('registering against a stale turn undoes at once; end() forgets without undoing', () => {
        const t = Turns.create();
        const a = t.begin();
        t.begin();
        const late = jest.fn();
        t.onCancel(a, late);
        expect(late).toHaveBeenCalled();
        const c = t.begin();
        const keep = jest.fn();
        t.onCancel(c, keep);
        t.end(c);
        t.cancel();
        expect(keep).not.toHaveBeenCalled();
    });
});

// ---- the player, on its BufferSource engine ---------------------------------------------------

function fakeContext() {
    const ctx = {
        currentTime: 0,
        sampleRate: 48000,
        state: 'running',
        destination: {},
        sources: [],
        createAnalyser: () => ({ fftSize: 0, connect() {}, getFloatTimeDomainData: (b) => b.fill(0.2) }),
        createBuffer: (ch, n, rate) => {
            const data = new Float32Array(n);
            return { duration: n / rate, getChannelData: () => data };
        },
        createBufferSource: () => {
            const src = {
                connect() {},
                start(at) {
                    src.at = at;
                },
                stop() {
                    src.stopped = true;
                },
            };
            ctx.sources.push(src);
            return src;
        },
        resume: async () => {},
        close: async () => {},
    };
    return ctx;
}

describe('StreamingAudioPlayer (BufferSource engine)', () => {
    test('onStart fires when the first sample plays, onEnd after the last one', async () => {
        jest.useFakeTimers();
        try {
            const ctx = fakeContext();
            const p = Player.create({ createContext: () => ctx, preferWorklet: false });
            const started = jest.fn();
            const ended = jest.fn();
            p.on('start', started);
            p.on('end', ended);
            expect(await p.beginTurn('t1')).toBe('buffer-source');
            p.push('t1', 'p0', new Float32Array(2205), 22050);
            p.push('t1', 'p0', new Float32Array(2205), 22050);
            expect(ctx.sources[1].at).toBeCloseTo(ctx.sources[0].at + 0.1, 6); // back to back
            expect(started).not.toHaveBeenCalled();
            jest.advanceTimersByTime(40);
            expect(started).toHaveBeenCalledWith('t1');
            p.endTurn('t1');
            expect(ended).not.toHaveBeenCalled();
            ctx.sources.forEach((s) => s.onended());
            expect(ended).toHaveBeenCalledWith('t1');
            ctx.currentTime = ctx.sources[0].at + 0.15;
            expect(p.phrasePlayedMs('p0')).toBeCloseTo(150, 0);
            expect(p.level()).toBeCloseTo(0.2, 5);
        } finally {
            jest.useRealTimers();
        }
    });

    test('stop() silences at once and audio for another turn is dropped', async () => {
        const ctx = fakeContext();
        const p = Player.create({ createContext: () => ctx, preferWorklet: false });
        const ended = jest.fn();
        p.on('end', ended);
        await p.beginTurn('a');
        p.push('a', 'p0', new Float32Array(100), 16000);
        expect(p.push('b', 'p0', new Float32Array(100), 16000)).toBe(false);
        p.stop();
        expect(ctx.sources[0].stopped).toBe(true);
        expect(ended).not.toHaveBeenCalled();
    });

    test('a turn that never queued audio ends immediately', async () => {
        const p = Player.create({ createContext: fakeContext, preferWorklet: false });
        const ended = jest.fn();
        p.on('end', ended);
        await p.beginTurn('empty');
        p.endTurn('empty');
        expect(ended).toHaveBeenCalledWith('empty');
    });
});

describe('the playback worklet processor', () => {
    let Processor;
    beforeAll(() => {
        global.AudioWorkletProcessor = class {
            constructor() {
                this.port = { posted: [], postMessage: (m) => this.port.posted.push(m) };
            }
        };
        global.registerProcessor = () => {};
        global.__NEXUS_TEST_EXPORT__ = true;
        require('../../src/tts/worklets/stream-playback.processor.js');
        Processor = global.__NEXUS_PLAYBACK_PROCESSOR__;
    });

    const quantum = () => [[new Float32Array(128)]];

    test('plays queued chunks back to back and reports started, then drained after end', () => {
        const p = new Processor();
        p.onMessage({ type: 'push', samples: new Float32Array(200).fill(0.5) });
        const out1 = quantum();
        p.process([], out1);
        expect(out1[0][0].every((v) => v === 0.5)).toBe(true);
        expect(p.port.posted[0]).toEqual({ type: 'started' });
        p.onMessage({ type: 'end' });
        const out2 = quantum();
        p.process([], out2);
        expect(out2[0][0].slice(0, 72).every((v) => v === 0.5)).toBe(true);
        expect(out2[0][0].slice(72).every((v) => v === 0)).toBe(true);
        expect(p.port.posted.at(-1)).toEqual({ type: 'drained', samples: 200 });
    });

    test('clear empties the queue within one quantum: a cancelled turn stops at once', () => {
        const p = new Processor();
        p.onMessage({ type: 'push', samples: new Float32Array(48000).fill(0.3) });
        p.process([], quantum());
        p.onMessage({ type: 'clear' });
        const out = quantum();
        p.process([], out);
        expect(out[0][0].every((v) => v === 0)).toBe(true);
    });

    test('an empty queue mid-turn is an underrun, reported once, not the end', () => {
        const p = new Processor();
        p.onMessage({ type: 'push', samples: new Float32Array(128) });
        p.process([], quantum());
        p.process([], quantum());
        p.process([], quantum());
        const kinds = p.port.posted.map((m) => m.type);
        expect(kinds.filter((k) => k === 'underrun')).toHaveLength(1);
        expect(kinds).not.toContain('drained');
    });
});
