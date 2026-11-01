/**
 * HV1. The wire under SonicAgent voice: frame codec, streaming resampler, framer, and the link.
 * No network: WebSocket and the OllaBridge client are scripted.
 */
const S = require('../../src/stt/StreamingSttSession.js');

function sine(rate, hz, seconds, amp = 0.5) {
    const n = Math.round(rate * seconds);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
    return out;
}

describe('the v1 frame', () => {
    test('header layout matches SonicAgent ">2sBBBBH I Q I", byte for byte', () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const f = S.encodeFrame({ type: 1, flags: 1, sampleRate: 16000, sequence: 7, timestampUs: 140000, payload });
        expect(Array.from(f.slice(0, 6))).toEqual([0x53, 0x41, 1, 1, 1, 1]);
        const v = new DataView(f.buffer);
        expect(v.getUint16(6)).toBe(16000);
        expect(v.getUint32(8)).toBe(7);
        expect(v.getUint32(12) * 2 ** 32 + v.getUint32(16)).toBe(140000);
        expect(v.getUint32(20)).toBe(4);
        expect(f.length).toBe(S.HEADER + 4);
        const back = S.decodeFrame(f);
        expect(back).toMatchObject({ type: 1, flags: 1, sampleRate: 16000, sequence: 7, timestampUs: 140000 });
        expect(Array.from(back.payload)).toEqual([1, 2, 3, 4]);
    });

    test('malformed frames are refused, not misread', () => {
        const good = S.encodeFrame({ type: 2, sampleRate: 22050, sequence: 0, payload: new Uint8Array(4) });
        expect(() => S.decodeFrame(good.slice(0, 10))).toThrow(/header/);
        const bad = good.slice();
        bad[0] = 0;
        expect(() => S.decodeFrame(bad)).toThrow(/magic/);
        expect(() => S.decodeFrame(good.slice(0, good.length - 1))).toThrow(/length/);
        expect(() => S.encodeFrame({ sampleRate: 70000, sequence: 0 })).toThrow(RangeError);
    });

    test('PCM16 round trip keeps the signal', () => {
        const x = Float32Array.from([0, 0.5, -0.5, 1, -1]);
        const y = S.pcm16ToFloat(S.floatToPcm16(x));
        x.forEach((v, i) => expect(y[i]).toBeCloseTo(v, 3));
    });
});

describe('the streaming resampler', () => {
    test('48 kHz → 16 kHz keeps a 440 Hz tone and its level', () => {
        const r = S.createResampler(48000, 16000);
        const out = Array.from(r.push(sine(48000, 440, 0.5))).concat(Array.from(r.flush()));
        expect(Math.abs(out.length - 8000)).toBeLessThanOrEqual(2);
        const mid = out.slice(1000, 7000);
        const rms = Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length);
        expect(rms).toBeGreaterThan(0.34);
        expect(rms).toBeLessThan(0.37); // 0.5 / √2
    });

    test('a tone above the new Nyquist is removed, not folded into the speech band', () => {
        const r = S.createResampler(48000, 16000);
        const out = Array.from(r.push(sine(48000, 12000, 0.3))).concat(Array.from(r.flush()));
        const mid = out.slice(500, out.length - 500);
        const rms = Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length);
        expect(rms).toBeLessThan(0.02);
    });

    test('128-sample worklet blocks give the same audio as one block: no clicks at the edges', () => {
        const x = sine(48000, 300, 0.25);
        const whole = S.createResampler(48000, 16000);
        const a = Array.from(whole.push(x)).concat(Array.from(whole.flush()));
        const parts = S.createResampler(48000, 16000);
        let b = [];
        for (let i = 0; i < x.length; i += 128) b = b.concat(Array.from(parts.push(x.subarray(i, i + 128))));
        b = b.concat(Array.from(parts.flush()));
        expect(b.length).toBe(a.length);
        let worst = 0;
        for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
        expect(worst).toBeLessThan(1e-4);
    });
});

describe('the framer', () => {
    test('20 ms frames, consecutive sequence numbers, the commit flagged last', () => {
        const f = S.createFramer({ frameMs: 20, firstSequence: 5 });
        const frames = f.push(sine(16000, 200, 0.1), 16000);
        expect(frames).toHaveLength(5);
        const seqs = frames.map((x) => S.decodeFrame(x).sequence);
        expect(seqs).toEqual([5, 6, 7, 8, 9]);
        expect(frames.every((x) => S.decodeFrame(x).payload.length === 640)).toBe(true);
        expect(frames.every((x) => S.decodeFrame(x).flags === 0)).toBe(true);
        f.push(new Float32Array(100), 16000);
        const { frames: tail, commitSeq } = f.commit();
        expect(tail).toHaveLength(1);
        const last = S.decodeFrame(tail[0]);
        expect(last.flags).toBe(S.FLAG_END);
        expect(last.sequence).toBe(10);
        expect(commitSeq).toBe(10);
        expect(f.nextSequence()).toBe(11);
    });

    test('an empty commit still sends one end-of-utterance frame, so the server answers', () => {
        const f = S.createFramer({});
        const { frames, commitSeq } = f.commit();
        expect(frames).toHaveLength(1);
        expect(S.decodeFrame(frames[0]).payload.length).toBe(0);
        expect(commitSeq).toBe(0);
    });

    test('48 kHz input comes out as 16 kHz frames only — never another rate', () => {
        const f = S.createFramer({ frameMs: 40 });
        const out = f.push(sine(48000, 300, 0.2), 48000);
        expect(out.length).toBeGreaterThanOrEqual(4);
        for (const x of out) {
            const d = S.decodeFrame(x);
            expect(d.sampleRate).toBe(16000);
            expect(d.payload.length).toBe(1280);
        }
    });
});

// ---- the link ------------------------------------------------------------------------------

class FakeWS {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        FakeWS.last = this;
        FakeWS.all.push(this);
    }
    send(x) {
        this.sent.push(x);
    }
    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        if (this.onclose) this.onclose({ code: 1000 });
    }
    open(ready = { type: 'session.ready', options: undefined }) {
        this.readyState = 1;
        if (this.onopen) this.onopen();
        this.onmessage({ data: JSON.stringify(ready) });
    }
}
FakeWS.all = [];

function gateway(answer) {
    const calls = [];
    return {
        calls,
        baseUrl: () => 'https://app.ollabridge.com',
        createStreamSession: async (body) => {
            calls.push(body);
            if (answer instanceof Error) throw answer;
            return Object.assign(
                { session_id: 'vs_1', ticket: 'tick et', websocket_url: '/v1/voice/stream/vs_1' },
                answer || {}
            );
        },
    };
}

async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('the link', () => {
    beforeEach(() => {
        FakeWS.all = [];
    });

    test('asks for the HV3 options and reports what the server GRANTED', async () => {
        const g = gateway({
            options: {
                endpointing: 'client',
                chunk_events: 'none',
                output_frame_ms: 40,
                flow_control: 'ack',
                tts_queue: true,
            },
        });
        const link = S.createLink({ gateway: g, WebSocket: FakeWS });
        const p = link.ensure({ language: 'it', voiceId: 'it_IT-paola-medium' });
        await flush();
        expect(FakeWS.last.url).toBe('wss://app.ollabridge.com/v1/voice/stream/vs_1?ticket=tick%20et');
        expect(FakeWS.last.binaryType).toBe('arraybuffer');
        FakeWS.last.open({
            type: 'session.ready',
            options: {
                endpointing: 'client',
                chunk_events: 'none',
                output_frame_ms: 40,
                flow_control: 'ack',
                tts_queue: true,
            },
        });
        const res = await p;
        expect(res.ok).toBe(true);
        expect(g.calls[0]).toMatchObject({ mode: 'duplex_speech', language: 'it', voice_id: 'it_IT-paola-medium' });
        expect(g.calls[0].stream_options).toEqual(S.WANTED_OPTIONS);
        expect(res.options.endpointing).toBe('client');
    });

    test('a SonicAgent from before HV3 (no options echoed) is treated as v1', async () => {
        const link = S.createLink({ gateway: gateway({}), WebSocket: FakeWS });
        const p = link.ensure({});
        await flush();
        FakeWS.last.open();
        const res = await p;
        expect(res.options).toEqual(S.V1_OPTIONS);
    });

    test('an open link is reused; a different language reopens it only when nobody is mid-turn', async () => {
        const g = gateway({});
        const link = S.createLink({ gateway: g, WebSocket: FakeWS });
        const first = link.ensure({ language: 'en' });
        await flush();
        FakeWS.last.open();
        await first;
        expect((await link.ensure({ language: 'en' })).reused).toBe(true);
        const release = link.retain();
        const busy = await link.ensure({ language: 'it' });
        expect(busy.mismatch).toBe(true);
        expect(g.calls).toHaveLength(1);
        release();
        const reopening = link.ensure({ language: 'it' });
        await flush();
        FakeWS.last.open();
        await reopening;
        expect(g.calls).toHaveLength(2);
        expect(FakeWS.all[0].readyState).toBe(3);
    });

    test('a refused session is an answer with the gateway code, not a throw', async () => {
        const err = Object.assign(new Error('starting'), { code: 'backend_warming', retryAfter: 20 });
        const link = S.createLink({ gateway: gateway(err), WebSocket: FakeWS });
        const res = await link.ensure({});
        expect(res).toMatchObject({ ok: false, code: 'backend_warming', retryAfter: 20 });
        expect(FakeWS.all).toHaveLength(0);
    });

    test('a ticket refused at the socket (1008) reads as unauthenticated', async () => {
        const link = S.createLink({ gateway: gateway({}), WebSocket: FakeWS });
        const p = link.ensure({});
        await flush();
        FakeWS.last.onclose({ code: 1008 });
        expect(await p).toMatchObject({ ok: false, code: 'unauthenticated' });
    });

    test('events and output audio reach listeners; the idle timer closes an unused link', async () => {
        jest.useFakeTimers();
        try {
            const link = S.createLink({ gateway: gateway({}), WebSocket: FakeWS });
            const p = link.ensure({});
            await flush();
            FakeWS.last.open();
            await p;
            const events = [];
            const audio = [];
            link.on('event', (e) => events.push(e.type));
            link.on('audio', (a) => audio.push(a.sequence));
            FakeWS.last.onmessage({ data: JSON.stringify({ type: 'transcript.final', text: 'x' }) });
            const out = S.encodeFrame({
                type: S.TYPE_OUTPUT,
                sampleRate: 22050,
                sequence: 3,
                payload: new Uint8Array(4),
            });
            FakeWS.last.onmessage({ data: out.buffer });
            expect(events).toEqual(['transcript.final']);
            expect(audio).toEqual([3]);
            jest.advanceTimersByTime(S.IDLE_CLOSE_MS + 1);
            expect(link.isOpen()).toBe(false);
            expect(FakeWS.last.sent.map(String)).toContain('{"type":"session.close"}');
        } finally {
            jest.useRealTimers();
        }
    });
});
