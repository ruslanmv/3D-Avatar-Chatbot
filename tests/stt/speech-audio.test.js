/**
 * ST1 — SpeechAudio: the numbers between a microphone and Whisper.
 *
 * Pinned: resampling keeps pitch (a relabelled 48 kHz buffer would not); the gate refuses
 * silence, too-short and noise-only recordings before any inference; the endpointer finds a
 * sentence, keeps its first consonant (pre-roll), ignores the gaps between words, ends on a
 * pause and cuts a runaway; judgeTranscript strips Whisper's non-speech tokens, refuses loops,
 * and refuses phantom phrases only when the audio held little speech.
 */

const A = require('../../src/stt/SpeechAudio.js');

const tone = (hz, ms, rate, amp = 0.5) =>
    Float32Array.from(
        { length: Math.round((rate * ms) / 1000) },
        (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate)
    );
const silence = (ms, rate, amp = 0) =>
    Float32Array.from({ length: Math.round((rate * ms) / 1000) }, () => (amp ? (Math.random() * 2 - 1) * amp : 0));

function zeroCrossings(x) {
    let n = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
    return n;
}

describe('mono and resampling', () => {
    test('two channels are averaged; one is copied', () => {
        expect(Array.from(A.toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5]);
        const one = Float32Array.of(0.2, 0.4);
        const out = A.toMono(one);
        expect(Array.from(out)).toEqual([Math.fround(0.2), Math.fround(0.4)]);
        expect(out).not.toBe(one);
    });

    test('48 kHz → 16 kHz keeps a 1 kHz tone at 1 kHz (really resampled, not relabelled)', () => {
        const x = tone(1000, 1000, 48000);
        const y = A.resample(x, 48000, 16000);
        expect(y.length).toBe(16000);
        // 1 kHz for 1 s crosses zero ~2000 times at any sample rate
        expect(Math.abs(zeroCrossings(y) - 2000)).toBeLessThan(20);
    });

    test('content above the new Nyquist is filtered out, not folded back', () => {
        const y = A.resample(tone(12000, 500, 48000), 48000, 16000);
        const peak = y.subarray(200, y.length - 200).reduce((m, v) => Math.max(m, Math.abs(v)), 0); // edges: kernel cut off
        expect(peak).toBeLessThan(0.005);
    });

    test('same rate: a copy', () => {
        const x = Float32Array.of(0.1, 0.2);
        expect(A.resample(x, 16000, 16000)).not.toBe(x);
    });
});

describe('analysis and gate', () => {
    const rate = 16000;
    test('digital silence is refused as silent', () => {
        expect(A.gate(A.analyze(silence(2000, rate), rate))).toEqual({ ok: false, reason: 'silent' });
    });
    test('a 100 ms blip is refused as too short', () => {
        expect(A.gate(A.analyze(tone(300, 100, rate), rate)).reason).toBe('too-short');
    });
    test('steady room noise has no speech in it', () => {
        const a = A.analyze(silence(3000, rate, 0.02), rate);
        expect(A.gate(a)).toEqual({ ok: false, reason: 'no-speech' });
    });
    test('speech-like bursts over a quiet floor pass, and are measured', () => {
        const x = A.concat([silence(500, rate, 0.002), tone(200, 800, rate), silence(500, rate, 0.002)]);
        const a = A.analyze(x, rate);
        expect(A.gate(a)).toEqual({ ok: true });
        expect(a.speechMs).toBeGreaterThan(600);
        expect(a.durationMs).toBe(1800);
    });
    test('NaN samples count as invalid', () => {
        const x = tone(200, 500, rate);
        for (let i = 0; i < 2000; i++) x[i] = NaN;
        expect(A.gate(A.analyze(x, rate)).reason).toBe('invalid-audio');
    });
    test('normalize lifts quiet speech but never past maxGain, never attenuates', () => {
        expect(Math.max(...A.normalize(Float32Array.of(0.1, -0.1)))).toBeCloseTo(0.8, 5); // capped at 8×
        expect(Math.max(...A.normalize(Float32Array.of(0.95)))).toBeCloseTo(0.95, 5);
    });
});

describe('endpointer', () => {
    const rate = 16000;
    function run(parts, opts) {
        const ep = A.createEndpointer(rate, opts);
        const events = [];
        for (const p of parts) for (let i = 0; i < p.length; i += 512) events.push(...ep.push(p.subarray(i, i + 512)));
        return { events, ep };
    }

    test('one sentence: start, then end after the pause, with pre-roll', () => {
        const { events } = run([silence(1000, rate, 0.002), tone(220, 1200, rate), silence(1500, rate, 0.002)]);
        expect(events.map((e) => e.type)).toEqual(['speech-start', 'speech-end']);
        const ms = (events[1].samples.length / rate) * 1000;
        expect(ms).toBeGreaterThan(1200 + 200); // speech + pre-roll + trailing pause
        expect(events[1].reason).toBe('silence');
    });

    test('the gap between two words does not end the sentence', () => {
        const { events } = run([
            silence(800, rate, 0.002),
            tone(220, 400, rate),
            silence(250, rate, 0.002),
            tone(220, 400, rate),
            silence(1500, rate, 0.002),
        ]);
        expect(events.filter((e) => e.type === 'speech-end')).toHaveLength(1);
    });

    test('noise alone never starts a sentence', () => {
        const { events } = run([silence(4000, rate, 0.01)]);
        expect(events).toEqual([]);
    });

    test('a runaway sentence is cut at maxUtteranceMs', () => {
        const { events } = run([silence(500, rate, 0.002), tone(220, 3000, rate)], { maxUtteranceMs: 1000 });
        expect(events.find((e) => e.type === 'speech-end').reason).toBe('max-length');
    });

    test('flush ends a sentence in progress (the person stopped recording)', () => {
        const { ep } = run([silence(500, rate, 0.002), tone(220, 800, rate)]);
        expect(ep.inSpeech()).toBe(true);
        const [end] = ep.flush();
        expect(end.reason).toBe('stopped');
        expect(ep.inSpeech()).toBe(false);
    });
});

describe('judgeTranscript', () => {
    const strong = { speechMs: 2000, activeFraction: 0.6 };
    const weak = { speechMs: 200, activeFraction: 0.05 };
    test('non-speech tokens are stripped; nothing left means empty', () => {
        expect(A.judgeTranscript(' [BLANK_AUDIO] ', strong)).toEqual({ accept: false, reason: 'empty' });
        expect(A.judgeTranscript('(music) ♪♪', strong).reason).toBe('empty');
        expect(A.judgeTranscript('[Music] hello there', strong)).toEqual({ accept: true, text: 'hello there' });
    });
    test('a decoding loop is refused', () => {
        expect(A.judgeTranscript('I am. I am. I am. I am. I am. I am.', strong).reason).toBe('repetition');
        expect(A.judgeTranscript('one two three four five six seven eight', strong).accept).toBe(true);
    });
    test('“Thank you.” from near-silence is a phantom; said clearly, it is heard', () => {
        expect(A.judgeTranscript('Thank you.', weak)).toEqual({ accept: false, reason: 'phantom' });
        expect(A.judgeTranscript('Thank you.', strong)).toEqual({ accept: true, text: 'Thank you.' });
        expect(A.judgeTranscript('Grazie per la visione', weak).reason).toBe('phantom');
    });
});

describe('small helpers', () => {
    test('whisperLanguage', () => {
        expect(A.whisperLanguage('it-IT')).toBe('it');
        expect(A.whisperLanguage('en_US')).toBe('en');
        expect(A.whisperLanguage('')).toBeNull();
        expect(A.whisperLanguage('auto')).toBeNull();
    });
    test('encodeWav writes a 16-bit mono header', () => {
        const v = new DataView(A.encodeWav(Float32Array.of(0, 1, -1), 16000));
        expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
        expect(v.getUint32(24, true)).toBe(16000);
        expect(v.getUint16(34, true)).toBe(16);
        expect(v.getInt16(46, true)).toBe(32767);
    });
});
