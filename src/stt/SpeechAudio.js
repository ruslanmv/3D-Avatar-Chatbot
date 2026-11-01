/**
 * SpeechAudio — ST1. The numbers between a microphone and Whisper, as pure functions.
 *
 * Everything here takes samples and returns samples or figures, so the parts of on-device
 * speech recognition that decide whether a sentence reaches her are testable without a
 * browser, a microphone or a model:
 *
 *  - **mono + 16 kHz.** Whisper reads 16 kHz mono float PCM. A Quest microphone delivers
 *    48 kHz. Relabelling a 48 kHz buffer as 16 kHz plays it three times slower — a mistake that
 *    produces confident nonsense rather than an error, so `resample` low-passes and really
 *    re-samples (windowed sinc), and a test checks a 1 kHz tone keeps its pitch.
 *  - **analysis and gate.** Whisper does not say "nothing was said"; given silence or room hum
 *    it writes something — "Thank you.", "[BLANK_AUDIO]", a subtitle credit. So a recording is
 *    measured (length, level, how much of it is speech) before any inference, and a recording
 *    that is too short or holds no speech never reaches the model, let alone the chat.
 *  - **endpointer.** Hands-free listening and the mic button's "stop when I stop talking" need
 *    to know where a sentence begins and ends. An adaptive energy detector: it learns the room's
 *    noise floor and calls speech what rises clearly above it, keeps a little audio from before
 *    the start (the first consonant is quieter than the vowel after it) and ends a sentence
 *    after a pause, never on the gap between two words.
 *  - **judgeTranscript.** The second guard, after the model: strip the non-speech tokens
 *    Whisper emits, refuse a transcript that is only those, refuse a runaway repetition loop,
 *    and refuse the well-known phantom phrases ONLY when the audio held little speech — a
 *    person who really says "thank you" is heard.
 *
 * Loaded by index.html (and imported for its side effect by the Whisper module worker, where
 * there is no window — the global falls back to globalThis there).
 */
(function (global) {
    'use strict';

    const TARGET_RATE = 16000;

    /** Mix any number of channels into one, averaging. One channel is returned as a copy. */
    function toMono(channels) {
        const list = Array.isArray(channels) ? channels.filter(Boolean) : [channels].filter(Boolean);
        if (!list.length) return new Float32Array(0);
        const n = Math.min(...list.map((c) => c.length));
        const out = new Float32Array(n);
        for (const c of list) for (let i = 0; i < n; i++) out[i] += c[i];
        if (list.length > 1) for (let i = 0; i < n; i++) out[i] /= list.length;
        return out;
    }

    /** Join Float32Array chunks into one. */
    function concat(chunks) {
        let n = 0;
        for (const c of chunks) n += c.length;
        const out = new Float32Array(n);
        let o = 0;
        for (const c of chunks) {
            out.set(c, o);
            o += c.length;
        }
        return out;
    }

    /**
     * Resample with a Hann-windowed sinc low-pass. Downsampling 48 k → 16 k without the low-pass
     * folds everything above 8 kHz back into the speech band (sibilants turn into hiss under the
     * vowels); with it, the result is what a 16 kHz microphone would have recorded.
     */
    // ST16. Kernel tables, by (rates, phase). Measured: the per-tap sin/cos version spent 418 ms
    // resampling 4.1 s of 44.1 kHz audio in the worker — 17% of a 2.5 s stop → transcript on a
    // desktop CPU, more on a headset's. The filter is the same; its weights are computed once per
    // fractional phase (1/PHASES of an input sample) instead of once per tap per output sample.
    // 48 kHz → 16 kHz (a Quest microphone) has a single phase, so a single table.
    const PHASES = 1024;
    const kernelCache = new Map();

    function kernelFor(fromRate, to, phase) {
        const key = `${fromRate}>${to}:${phase}`;
        let k = kernelCache.get(key);
        if (k) return k;
        const ratio = fromRate / to;
        const cutoff = Math.min(1, to / fromRate) * 0.95; // a little under Nyquist
        const half = Math.ceil(16 * Math.max(1, ratio)); // taps either side
        const frac = phase / PHASES;
        k = new Float32Array(2 * half + 1); // offsets -half … +half from floor(center)
        for (let o = -half; o <= half; o++) {
            const x = o - frac;
            if (x < -half || x > half) continue;
            const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
            // Blackman window: ~-58 dB side lobes, so what is above the new Nyquist stays out.
            const t = (Math.PI * x) / (half + 1);
            k[o + half] = sinc * (0.42 + 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t));
        }
        if (kernelCache.size > 4096) kernelCache.clear(); // bounded: a few rate pairs × PHASES
        kernelCache.set(key, k);
        return k;
    }

    function resample(input, fromRate, toRate) {
        const to = toRate || TARGET_RATE;
        if (!input || !input.length) return new Float32Array(0);
        if (!(fromRate > 0) || fromRate === to) return Float32Array.from(input);
        const ratio = fromRate / to;
        const outLen = Math.floor(input.length / ratio);
        const out = new Float32Array(outLen);
        const half = Math.ceil(16 * Math.max(1, ratio));
        const last = input.length - 1;
        for (let i = 0; i < outLen; i++) {
            const center = i * ratio;
            let base = Math.floor(center);
            let phase = Math.round((center - base) * PHASES);
            if (phase === PHASES) {
                base += 1;
                phase = 0;
            }
            const k = kernelFor(fromRate, to, phase);
            const from = Math.max(-half, -base);
            const toO = Math.min(half, last - base);
            let acc = 0;
            let wsum = 0;
            for (let o = from; o <= toO; o++) {
                const w = k[o + half];
                acc += input[base + o] * w;
                wsum += w;
            }
            out[i] = wsum ? acc / wsum : 0;
        }
        return out;
    }

    function db(rms) {
        return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    }

    /**
     * Measure a recording. `speechMs` and `activeFraction` count 30 ms frames clearly above the
     * recording's own quiet floor (and above an absolute floor), which is what "did anybody say
     * anything" means better than a single average level does.
     */
    function analyze(samples, sampleRate, opts) {
        const o = Object.assign({ frameMs: 30, minDb: -50, overFloorDb: 10 }, opts || {});
        const rate = sampleRate || TARGET_RATE;
        const n = samples ? samples.length : 0;
        let peak = 0;
        let sum = 0;
        let invalid = 0;
        let clipped = 0;
        for (let i = 0; i < n; i++) {
            const v = samples[i];
            if (!Number.isFinite(v)) {
                invalid++;
                continue;
            }
            const a = Math.abs(v);
            if (a > peak) peak = a;
            if (a >= 0.99) clipped++;
            sum += v * v;
        }
        const rms = n ? Math.sqrt(sum / Math.max(1, n - invalid)) : 0;
        const frame = Math.max(1, Math.round((rate * o.frameMs) / 1000));
        const levels = [];
        for (let f = 0; f + frame <= n; f += frame) {
            let s = 0;
            for (let i = f; i < f + frame; i++) {
                const v = samples[i];
                if (Number.isFinite(v)) s += v * v;
            }
            levels.push(db(Math.sqrt(s / frame)));
        }
        // Digital silence (a muted or gated microphone) is -Infinity dB: count it as the
        // quietest possible floor rather than dropping it, or a recording that is half true
        // silence takes its floor from the speech and finds no speech in it.
        const sorted = levels.map((l) => (Number.isFinite(l) ? l : -120)).sort((a, b) => a - b);
        const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -Infinity;
        const threshold = Math.max(o.minDb, floor + o.overFloorDb);
        const active = levels.filter((l) => l > threshold).length;
        return {
            sampleRate: rate,
            durationMs: Math.round((n / rate) * 1000),
            peak,
            rms,
            rmsDb: db(rms),
            floorDb: floor,
            invalid,
            clippedFraction: n ? clipped / n : 0,
            activeFraction: levels.length ? active / levels.length : 0,
            speechMs: active * o.frameMs,
        };
    }

    const GATE_DEFAULTS = Object.freeze({ minDurationMs: 300, minSpeechMs: 150, minPeak: 0.01, maxDurationMs: 60000 });

    /** Should this recording go to the model at all? { ok } or { ok: false, reason }. */
    function gate(analysis, opts) {
        const o = Object.assign({}, GATE_DEFAULTS, opts || {});
        const a = analysis || {};
        if (a.invalid && a.invalid > (a.durationMs || 0) * 0.016) return { ok: false, reason: 'invalid-audio' };
        if (!(a.durationMs >= o.minDurationMs)) return { ok: false, reason: 'too-short' };
        if (a.durationMs > o.maxDurationMs) return { ok: false, reason: 'too-long' };
        if (!(a.peak >= o.minPeak)) return { ok: false, reason: 'silent' };
        if (!(a.speechMs >= o.minSpeechMs)) return { ok: false, reason: 'no-speech' };
        return { ok: true };
    }

    /**
     * Bring a quiet recording up to a usable level (Whisper copes better with speech near full
     * scale). Never attenuates and never boosts more than `maxGain`, so noise is not inflated
     * into "speech".
     */
    function normalize(samples, targetPeak, maxGain) {
        const target = targetPeak || 0.9;
        const limit = maxGain || 8;
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
            const a = Math.abs(samples[i]);
            if (Number.isFinite(a) && a > peak) peak = a;
        }
        const out = new Float32Array(samples.length);
        const g = peak > 0 ? Math.min(limit, Math.max(1, target / peak)) : 1;
        for (let i = 0; i < samples.length; i++) out[i] = Number.isFinite(samples[i]) ? samples[i] * g : 0;
        return out;
    }

    const ENDPOINT_DEFAULTS = Object.freeze({
        frameMs: 30,
        startFrames: 3, // ~90 ms above threshold before it counts as speech
        endSilenceMs: 900, // pause that ends a sentence (a gap between words is ~100–300 ms)
        preRollMs: 300,
        minDb: -50,
        overFloorDb: 12,
        floorAdapt: 0.05, // how fast the noise floor follows quiet frames
        calibrateMs: 150, // the first frames only teach the floor: the room before anyone speaks
        maxUtteranceMs: 28000, // Whisper reads 30 s windows; cut a little before
    });

    /**
     * A streaming sentence detector. Feed it frames of any size with `push(samples)`; it returns
     * the events that frame produced: { type: 'speech-start' } and
     * { type: 'speech-end', samples, reason } where `samples` is the sentence including the
     * pre-roll. `flush()` ends a sentence in progress (the person stopped the recording).
     */
    function createEndpointer(sampleRate, opts) {
        const o = Object.assign({}, ENDPOINT_DEFAULTS, opts || {});
        const rate = sampleRate || TARGET_RATE;
        const frameLen = Math.max(1, Math.round((rate * o.frameMs) / 1000));
        const preFrames = Math.ceil(o.preRollMs / o.frameMs);
        const endFrames = Math.ceil(o.endSilenceMs / o.frameMs);
        const maxFrames = Math.ceil(o.maxUtteranceMs / o.frameMs);
        const calibrateFrames = Math.ceil(o.calibrateMs / o.frameMs);
        let seen = 0;
        let pending = new Float32Array(0);
        let floor = null;
        let hot = 0;
        let quiet = 0;
        let inSpeech = false;
        let pre = [];
        let utter = [];

        function threshold() {
            return Math.max(o.minDb, (floor == null ? -70 : floor) + o.overFloorDb);
        }

        function end(reason, events) {
            const samples = concat(utter);
            utter = [];
            inSpeech = false;
            hot = 0;
            quiet = 0;
            events.push({ type: 'speech-end', samples, reason });
        }

        function frameIn(frame, events) {
            let s = 0;
            for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
            const level = db(Math.sqrt(s / frame.length));
            seen++;
            if (seen <= calibrateFrames) {
                // Calibration: a fan or a headset's own hiss is the floor, not speech. Without
                // it, steady noise above the absolute minimum started a "sentence" at once.
                if (Number.isFinite(level)) floor = floor == null ? level : Math.max(floor, level);
                pre.push(frame);
                if (pre.length > preFrames + o.startFrames) pre.shift();
                return;
            }
            const loud = level > threshold();
            if (!inSpeech) {
                // Only quiet frames teach the floor, so a long sentence never raises it; a
                // quieter room is followed quickly, a louder one slowly.
                if (!loud && Number.isFinite(level)) {
                    const k = floor != null && level < floor ? 0.3 : o.floorAdapt;
                    floor = floor == null ? level : floor + (level - floor) * k;
                }
                pre.push(frame);
                if (pre.length > preFrames + o.startFrames) pre.shift();
                hot = loud ? hot + 1 : 0;
                if (hot >= o.startFrames) {
                    inSpeech = true;
                    quiet = 0;
                    utter = pre.slice();
                    pre = [];
                    events.push({ type: 'speech-start' });
                }
                return;
            }
            utter.push(frame);
            quiet = loud ? 0 : quiet + 1;
            if (quiet >= endFrames) end('silence', events);
            else if (utter.length >= maxFrames) end('max-length', events);
        }

        return {
            push(samples) {
                const events = [];
                if (!samples || !samples.length) return events;
                const joined = concat([pending, samples]);
                let i = 0;
                for (; i + frameLen <= joined.length; i += frameLen) frameIn(joined.subarray(i, i + frameLen), events);
                pending = joined.slice(i);
                return events;
            },
            flush() {
                const events = [];
                if (inSpeech) end('stopped', events);
                return events;
            },
            reset() {
                pending = new Float32Array(0);
                seen = 0;
                floor = null;
                hot = 0;
                quiet = 0;
                inSpeech = false;
                pre = [];
                utter = [];
            },
            inSpeech: () => inSpeech,
            noiseFloorDb: () => floor,
            thresholdDb: threshold,
        };
    }

    // Tokens Whisper writes for non-speech. Removed from any transcript, never shown to her.
    const NON_SPEECH =
        /\[(?:blank_audio|music|silence|noise|applause|laughter|inaudible|sound|no speech)[^\]]*\]|\((?:music|silence|applause|laughs?|noise|inaudible|sighs?)[^)]*\)|[♪♫]+/gi;

    // Phrases Whisper is known to invent from silence (YouTube subtitle residue). Refused only
    // when the audio held little speech — see judgeTranscript.
    const PHANTOMS = [
        'thank you',
        'thank you.',
        'thanks for watching',
        'thank you for watching',
        'please subscribe',
        'subtitles by',
        'you',
        'bye',
        'grazie',
        'grazie a tutti',
        'grazie per la visione',
        'sottotitoli',
        'sottotitoli a cura di',
        'amara.org',
    ];

    function plain(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[.,!?¡¿…"'“”‘’\-–—:;]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** True when one short phrase repeats itself four or more times (a decoding loop). */
    function isLoop(text) {
        const words = plain(text).split(' ').filter(Boolean);
        if (words.length < 8) return false;
        for (let size = 1; size <= 4; size++) {
            let run = 1;
            for (let i = size; i + size <= words.length; i += size) {
                const same = words.slice(i, i + size).join(' ') === words.slice(i - size, i).join(' ');
                run = same ? run + 1 : 1;
                if (run >= 4) return true;
            }
        }
        return false;
    }

    /**
     * After the model: { accept: true, text } or { accept: false, reason }. `analysis` is the
     * recording's (from analyze); without it the phantom check is skipped rather than guessed.
     */
    function judgeTranscript(text, analysis) {
        const cleaned = String(text || '')
            .replace(NON_SPEECH, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!plain(cleaned)) return { accept: false, reason: 'empty' };
        if (isLoop(cleaned)) return { accept: false, reason: 'repetition' };
        const weak = analysis && (analysis.speechMs < 500 || analysis.activeFraction < 0.12);
        const key = plain(cleaned);
        if (weak && PHANTOMS.some((p) => plain(p) === key)) return { accept: false, reason: 'phantom' };
        return { accept: true, text: cleaned };
    }

    /** 16-bit PCM WAV of mono float samples — for the diagnostics page's playback and saving. */
    function encodeWav(samples, sampleRate) {
        const rate = sampleRate || TARGET_RATE;
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const v = new DataView(buffer);
        const str = (off, s) => {
            for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
        };
        str(0, 'RIFF');
        v.setUint32(4, 36 + samples.length * 2, true);
        str(8, 'WAVE');
        str(12, 'fmt ');
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, rate, true);
        v.setUint32(28, rate * 2, true);
        v.setUint16(32, 2, true);
        v.setUint16(34, 16, true);
        str(36, 'data');
        v.setUint32(40, samples.length * 2, true);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
            v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
    }

    /**
     * Whisper's language code from a BCP-47 tag ('it-IT' → 'it'). '' or 'auto' → null, which the
     * runtime treats as English — it does not detect the language — so callers pass the app's
     * language rather than nothing.
     */
    function whisperLanguage(tag) {
        const t = String(tag || '')
            .trim()
            .toLowerCase();
        if (!t || t === 'auto') return null;
        const primary = t.split(/[-_]/)[0];
        return /^[a-z]{2,3}$/.test(primary) ? primary : null;
    }

    const api = {
        TARGET_RATE,
        GATE_DEFAULTS,
        ENDPOINT_DEFAULTS,
        toMono,
        concat,
        resample,
        analyze,
        gate,
        normalize,
        createEndpointer,
        judgeTranscript,
        isLoop,
        encodeWav,
        whisperLanguage,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STT_AUDIO = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
