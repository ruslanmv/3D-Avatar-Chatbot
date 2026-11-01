/**
 * StreamingSttSession — HV1. The wire under SonicAgent voice: frames, resampling, one link.
 *
 * Three pieces, all here because each is only meaningful with the others:
 *
 *  1. **The frame.** SonicAgent's `sonic-speech-stream-v1` binary frame: a 24-byte big-endian
 *     header ("SA", version 1, type, codec, flags, rate as u16, sequence u32, timestamp µs u64,
 *     payload length u32) and mono PCM16 little-endian. `encodeFrame` / `decodeFrame` speak it
 *     byte for byte, so the gateway can relay frames without decoding them and a header bug
 *     shows up here, in a test, rather than as silence on a headset.
 *
 *  2. **The framer.** The microphone delivers float samples at whatever rate the device runs
 *     (48 kHz on a Quest, 44.1 kHz on some laptops) in whatever block size the worklet uses.
 *     SonicAgent decodes 16 kHz and refuses anything else (HV3), so this resamples *as the audio
 *     arrives* — a streaming windowed-sinc low-pass decimator that carries its history across
 *     calls, because resampling each 2.7 ms worklet block on its own would put a click at every
 *     block edge. It then cuts fixed 20/40 ms PCM16 frames with consecutive sequence numbers,
 *     and `commit()` sends what is left with the end-of-utterance flag. It never pads audio and
 *     never skips a sequence number: the server treats a gap as an error, not as silence.
 *
 *  3. **The link.** One WebSocket to OllaBridge Cloud's `/v1/voice/stream/{id}`, shared by
 *     listening and speaking, opened on first use and closed after a quiet minute. Creating a
 *     session costs an HTTPS round trip and a socket handshake; doing that on every press of the
 *     microphone would put it in front of every transcript. The link negotiates SonicAgent's HV3
 *     options and reports what the server actually granted (`options`), because the Space may be
 *     running code from before HV3, which ignores them: callers adapt to `granted`, never to
 *     what they asked for.
 *
 * Nothing here touches the DOM. `WebSocket`, `fetch` and the clock are injected so every rule
 * above is tested without a network.
 */
(function (global) {
    'use strict';

    const MAGIC0 = 0x53; // 'S'
    const MAGIC1 = 0x41; // 'A'
    const VERSION = 1;
    const HEADER = 24;
    const TYPE_INPUT = 1;
    const TYPE_OUTPUT = 2;
    const CODEC_PCM16 = 1;
    const FLAG_END = 1;
    const TARGET_RATE = 16000;
    const U32 = 0x100000000;

    // ---- 1. the frame ------------------------------------------------------------------------

    function encodeFrame(f) {
        const payload = f.payload instanceof Uint8Array ? f.payload : new Uint8Array(f.payload || 0);
        if (!(f.sampleRate >= 1 && f.sampleRate <= 65535)) throw new RangeError('sampleRate out of range');
        const out = new Uint8Array(HEADER + payload.length);
        const v = new DataView(out.buffer);
        out[0] = MAGIC0;
        out[1] = MAGIC1;
        out[2] = VERSION;
        out[3] = f.type || TYPE_INPUT;
        out[4] = CODEC_PCM16;
        out[5] = f.flags || 0;
        v.setUint16(6, f.sampleRate);
        v.setUint32(8, f.sequence >>> 0);
        const ts = Math.max(0, Math.floor(f.timestampUs || 0));
        v.setUint32(12, Math.floor(ts / U32));
        v.setUint32(16, ts % U32);
        v.setUint32(20, payload.length);
        out.set(payload, HEADER);
        return out;
    }

    /** → { type, codec, flags, sampleRate, sequence, timestampUs, payload } or throws. */
    function decodeFrame(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length < HEADER) throw new Error('frame shorter than its header');
        if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) throw new Error('bad magic');
        if (bytes[2] !== VERSION) throw new Error('unsupported protocol version');
        if (bytes[4] !== CODEC_PCM16) throw new Error('not a PCM16 frame');
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const len = v.getUint32(20);
        if (bytes.length - HEADER !== len) throw new Error('payload length mismatch');
        if (len % 2) throw new Error('odd PCM16 payload');
        return {
            type: bytes[3],
            codec: bytes[4],
            flags: bytes[5],
            sampleRate: v.getUint16(6),
            sequence: v.getUint32(8),
            timestampUs: v.getUint32(12) * U32 + v.getUint32(16),
            payload: bytes.subarray(HEADER),
        };
    }

    /** Float [-1, 1] → PCM16 little-endian bytes. */
    function floatToPcm16(samples) {
        const out = new Uint8Array(samples.length * 2);
        const v = new DataView(out.buffer);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i] > 1 ? 1 : samples[i] < -1 ? -1 : samples[i] || 0;
            v.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
        }
        return out;
    }

    /** PCM16 little-endian bytes → Float32Array. */
    function pcm16ToFloat(bytes) {
        const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const out = new Float32Array(b.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
        return out;
    }

    // ---- 2. the resampler and the framer -----------------------------------------------------

    /**
     * A streaming resampler: push(blocks) in, 16 kHz out, the state carried between calls.
     *
     * Windowed sinc (Blackman), cut off at 0.45 × the output rate so nothing above 7.2 kHz folds
     * back into the speech band when 48 kHz is taken down to 16 kHz. `HALF` taps either side is
     * plenty for speech; the cost is ~2 × HALF multiply-adds per output sample, about half a
     * million a second — nothing next to a frame of rendering.
     */
    function createResampler(fromRate, toRate) {
        const to = toRate || TARGET_RATE;
        if (!(fromRate > 0)) throw new RangeError('fromRate must be positive');
        const ratio = fromRate / to;
        if (Math.abs(ratio - 1) < 1e-9) {
            return { push: (x) => Float32Array.from(x), flush: () => new Float32Array(0), ratio: 1 };
        }
        // The filter is computed once, as a polyphase table: PHASES rows of TAPS weights, one row
        // per fractional input position. Per output sample that is TAPS multiply-adds and no
        // trigonometry — the first version called sin/cos per tap and needed ~1 s of CPU per second
        // of 48 kHz audio, which a Quest's page thread cannot spare beside the XR frame loop.
        const PHASES = 256;
        const HALF = 16;
        const cutoff = Math.min(1, 1 / ratio) * 0.9; // of the input Nyquist
        const width = HALF * Math.max(1, ratio);
        const R = Math.ceil(width);
        const TAPS = 2 * R + 1;
        const table = new Float32Array(PHASES * TAPS);
        for (let p = 0; p < PHASES; p++) {
            const frac = p / PHASES;
            let sum = 0;
            for (let j = 0; j < TAPS; j++) {
                const x = j - R - frac;
                let k = 0;
                if (x === 0) k = cutoff;
                else if (Math.abs(x) < width) {
                    const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / width) + 0.08 * Math.cos((2 * Math.PI * x) / width);
                    k = (Math.sin(Math.PI * cutoff * x) / (Math.PI * x)) * w;
                }
                table[p * TAPS + j] = k;
                sum += k;
            }
            for (let j = 0; j < TAPS; j++) table[p * TAPS + j] /= sum || 1; // unity gain at DC
        }

        // Input history with R zeros in front, so the first outputs see silence before the start.
        let hist = new Float32Array(R);
        let pos = R; // position of the next output sample, in `hist` coordinates

        function run(final) {
            const n = Math.max(0, Math.ceil((hist.length - (final ? 0 : R) - pos) / ratio));
            const out = new Float32Array(n);
            let produced = 0;
            for (let o = 0; o < n; o++) {
                const base = Math.floor(pos);
                if (!final && base + R >= hist.length) break;
                if (base >= hist.length) break;
                const row = Math.min(PHASES - 1, Math.floor((pos - base) * PHASES)) * TAPS;
                let acc = 0;
                const first = base - R;
                for (let j = 0; j < TAPS; j++) {
                    const i = first + j;
                    if (i >= 0 && i < hist.length) acc += hist[i] * table[row + j];
                }
                out[produced++] = acc;
                pos += ratio;
            }
            // Keep only what the next output sample can still reach.
            const keepFrom = Math.max(0, Math.floor(pos) - R - 1);
            if (keepFrom > 0) {
                hist = hist.slice(keepFrom);
                pos -= keepFrom;
            }
            return produced === n ? out : out.slice(0, produced);
        }

        return {
            ratio,
            push(block) {
                const add = block instanceof Float32Array ? block : Float32Array.from(block || []);
                const merged = new Float32Array(hist.length + add.length);
                merged.set(hist, 0);
                merged.set(add, hist.length);
                hist = merged;
                return run(false);
            },
            flush() {
                const out = run(true);
                hist = new Float32Array(R);
                pos = R;
                return out;
            },
        };
    }

    /**
     * Mic blocks in, wire frames out. `frameMs` 20 or 40. `firstSequence` continues a socket's
     * numbering across utterances: SonicAgent validates sequence per socket, not per turn.
     */
    function createFramer(opts) {
        const o = opts || {};
        const frameMs = o.frameMs === 40 ? 40 : 20;
        const per = (TARGET_RATE * frameMs) / 1000;
        let seq = o.firstSequence >>> 0 || 0;
        let resampler = null;
        let rateIn = 0;
        let pending = new Float32Array(0);
        let sentSamples = 0;
        let frames = 0;

        function append(x) {
            if (!x.length) return;
            const m = new Float32Array(pending.length + x.length);
            m.set(pending, 0);
            m.set(x, pending.length);
            pending = m;
        }

        function cut(flags) {
            const piece = pending.subarray(0, Math.min(per, pending.length));
            pending = pending.slice(piece.length);
            const frame = encodeFrame({
                type: TYPE_INPUT,
                flags,
                sampleRate: TARGET_RATE,
                sequence: seq,
                timestampUs: Math.round((sentSamples / TARGET_RATE) * 1e6),
                payload: floatToPcm16(piece),
            });
            seq = (seq + 1) >>> 0;
            sentSamples += piece.length;
            frames++;
            return frame;
        }

        return {
            frameMs,
            /** Float blocks at `rate` → zero or more complete frames. */
            push(samples, rate) {
                if (!resampler || rate !== rateIn) {
                    // A device that changes rate mid-utterance gets a fresh filter; rare, and
                    // a click is better than mis-pitched speech.
                    rateIn = rate;
                    resampler = createResampler(rate, TARGET_RATE);
                }
                append(resampler.push(samples));
                const out = [];
                while (pending.length >= per) out.push(cut(0));
                return out;
            },
            /** The rest of the utterance, the last frame flagged end-of-utterance. Always ≥ 1 frame. */
            commit() {
                if (resampler) append(resampler.flush());
                const out = [];
                while (pending.length > per) out.push(cut(0));
                out.push(cut(FLAG_END)); // may be empty: an empty commit still asks for an answer
                const commitSeq = (seq - 1) >>> 0;
                resampler = null;
                rateIn = 0;
                return { frames: out, commitSeq };
            },
            /** Drop what was buffered without sending it (abort, cancel). */
            discard() {
                pending = new Float32Array(0);
                resampler = null;
                rateIn = 0;
            },
            nextSequence: () => seq,
            stats: () => ({ frames, sentMs: Math.round((sentSamples / TARGET_RATE) * 1000) }),
        };
    }

    // ---- 3. the link -------------------------------------------------------------------------

    /** What this client asks SonicAgent for. Granted options come back in the session answer. */
    const WANTED_OPTIONS = Object.freeze({
        endpointing: 'client',
        chunk_events: 'none',
        output_frame_ms: 40,
        flow_control: 'ack',
        tts_queue: true,
    });

    /** v1 behaviour: what a SonicAgent from before HV3 does, whatever was asked. */
    const V1_OPTIONS = Object.freeze({
        endpointing: 'server',
        chunk_events: 'all',
        output_frame_ms: 20,
        flow_control: 'none',
        tts_queue: false,
    });

    const IDLE_CLOSE_MS = 60000;

    function wsUrl(base, path, ticket) {
        const b = String(base || '').replace(/\/+$/, '');
        const ws = b.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
        return `${ws}${path}?ticket=${encodeURIComponent(ticket)}`;
    }

    /**
     * createLink({ gateway, WebSocket, setTimeout, clearTimeout, now })
     *
     * `gateway` is SonicAgentVoiceConfig's client: `createStreamSession(body)` → the gateway's
     * answer or a thrown { code, message, retryAfter }; `baseUrl()`.
     */
    function createLink(deps) {
        const d = deps || {};
        const WS = d.WebSocket || (global && global.WebSocket);
        const later = d.setTimeout || setTimeout;
        const cancelLater = d.clearTimeout || clearTimeout;
        const now = d.now || (() => (global && global.performance ? global.performance.now() : Date.now()));
        const listeners = new Map();
        let ws = null;
        let opening = null;
        let granted = null;
        let session = null;
        let sequence = 0;
        let idleTimer = null;
        let users = 0;
        let lastConnect = null;
        let opened = null; // { language, voiceId } the open session was created with

        function emit(type, payload) {
            for (const fn of Array.from(listeners.get(type) || [])) {
                try {
                    fn(payload);
                } catch (err) {
                    if (global && global.console) global.console.warn('[SonicLink] listener failed:', err);
                }
            }
        }

        function on(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
            return () => listeners.get(type).delete(fn);
        }

        function touch() {
            if (idleTimer) cancelLater(idleTimer);
            idleTimer = null;
            if (users > 0 || !ws) return;
            idleTimer = later(() => close('idle'), IDLE_CLOSE_MS);
        }

        function isOpen() {
            return !!ws && ws.readyState === 1;
        }

        async function ensure(opts) {
            const o = opts || {};
            if (isOpen()) {
                // The session's language and Piper voice are fixed when it is created. A turn
                // that needs others reopens the link — but only when nobody is mid-turn on it;
                // otherwise it shares the open one and is told so (`mismatch`).
                const differs =
                    (o.language && opened && o.language !== opened.language) ||
                    (o.voiceId && opened && o.voiceId !== opened.voiceId);
                if (!differs) return { ok: true, reused: true, options: granted, session };
                if (users > 0) return { ok: true, reused: true, mismatch: true, options: granted, session };
                close('reopen');
            }
            if (opening) return opening;
            const t0 = now();
            opening = (async () => {
                let answer;
                try {
                    answer = await d.gateway.createStreamSession({
                        mode: 'duplex_speech',
                        language: o.language || 'en',
                        voice_id: o.voiceId || undefined,
                        stream_options: Object.assign({}, WANTED_OPTIONS),
                    });
                } catch (err) {
                    return {
                        ok: false,
                        code: (err && err.code) || 'backend_unavailable',
                        message: (err && err.message) || 'The speech service cannot be reached.',
                        retryAfter: err && err.retryAfter,
                    };
                }
                const tSession = now();
                // Before HV3 the server ignores `stream_options` and echoes none: v1 rules apply.
                granted = Object.assign({}, V1_OPTIONS, (answer && answer.options) || {});
                session = answer;
                if (!WS) return { ok: false, code: 'unsupported', message: 'This browser has no WebSocket.' };
                const socket = new WS(wsUrl(d.gateway.baseUrl(), answer.websocket_url, answer.ticket));
                socket.binaryType = 'arraybuffer';
                const ready = await new Promise((resolve) => {
                    let settled = false;
                    const done = (r) => {
                        if (!settled) {
                            settled = true;
                            resolve(r);
                        }
                    };
                    socket.onopen = () => {};
                    socket.onmessage = (ev) => {
                        if (typeof ev.data === 'string') {
                            let event = null;
                            try {
                                event = JSON.parse(ev.data);
                            } catch (_) {
                                return;
                            }
                            if (event && event.type === 'session.ready') {
                                if (event.options) granted = Object.assign({}, V1_OPTIONS, event.options);
                                done({ ok: true });
                            } else if (!settled && event && event.type === 'session.error') {
                                done({ ok: false, code: event.code || 'backend_error', message: event.message });
                            }
                            if (settled) emit('event', event);
                            return;
                        }
                        let frame;
                        try {
                            frame = decodeFrame(ev.data);
                        } catch (err) {
                            emit('event', { type: 'client.bad_frame', message: String(err && err.message) });
                            return;
                        }
                        if (frame.type === TYPE_OUTPUT) emit('audio', frame);
                    };
                    socket.onerror = () =>
                        done({ ok: false, code: 'backend_unavailable', message: 'Voice link failed.' });
                    socket.onclose = (ev) => {
                        done({
                            ok: false,
                            code: ev && ev.code === 1008 ? 'unauthenticated' : 'backend_unavailable',
                            message: 'The voice link closed.',
                        });
                        if (ws === socket) {
                            ws = null;
                            emit('close', { code: ev && ev.code, reason: ev && ev.reason });
                        }
                    };
                });
                if (!ready.ok) {
                    try {
                        socket.close();
                    } catch (_) {}
                    return ready;
                }
                ws = socket;
                sequence = 0;
                opened = { language: o.language || 'en', voiceId: o.voiceId || null };
                lastConnect = { sessionMs: Math.round(tSession - t0), totalMs: Math.round(now() - t0) };
                touch();
                return { ok: true, reused: false, options: granted, session, connect: lastConnect };
            })();
            try {
                return await opening;
            } finally {
                opening = null;
            }
        }

        function sendBinary(bytes) {
            if (!isOpen()) return false;
            ws.send(bytes);
            touch();
            return true;
        }

        function sendControl(obj) {
            if (!isOpen()) return false;
            ws.send(JSON.stringify(obj));
            touch();
            return true;
        }

        function close(reason) {
            if (idleTimer) cancelLater(idleTimer);
            idleTimer = null;
            const socket = ws;
            ws = null;
            if (socket) {
                try {
                    if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'session.close' }));
                } catch (_) {}
                try {
                    socket.close(1000, String(reason || 'closed').slice(0, 60));
                } catch (_) {}
                emit('close', { code: 1000, reason: reason || 'closed' });
            }
        }

        return {
            ensure,
            on,
            isOpen,
            sendBinary,
            sendControl,
            close,
            /** Hold the link open while someone is mid-turn; the idle timer waits for release. */
            retain() {
                users++;
                touch();
                return () => {
                    users = Math.max(0, users - 1);
                    touch();
                };
            },
            options: () => granted,
            session: () => session,
            openedWith: () => (opened ? Object.assign({}, opened) : null),
            lastConnect: () => lastConnect,
            /** A shared, per-socket input sequence (SonicAgent checks it per socket). */
            takeSequence(count) {
                const first = sequence;
                sequence = (sequence + (count || 0)) >>> 0;
                return first;
            },
            nextSequence: () => sequence,
            setNextSequence(n) {
                sequence = n >>> 0;
            },
        };
    }

    let shared = null;

    const api = {
        HEADER,
        TARGET_RATE,
        TYPE_INPUT,
        TYPE_OUTPUT,
        FLAG_END,
        WANTED_OPTIONS,
        V1_OPTIONS,
        IDLE_CLOSE_MS,
        encodeFrame,
        decodeFrame,
        floatToPcm16,
        pcm16ToFloat,
        createResampler,
        createFramer,
        createLink,
        wsUrl,
        /** The page's one link, built on first use from the voice config's gateway client. */
        shared() {
            if (!shared) {
                const cfg = global && global.NEXUS_SONIC_VOICE;
                if (!cfg) throw new Error('SonicAgentVoiceConfig is not loaded');
                shared = createLink({ gateway: cfg.gateway() });
            }
            return shared;
        },
        _resetShared() {
            if (shared) shared.close('reset');
            shared = null;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SONIC_STREAM = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
