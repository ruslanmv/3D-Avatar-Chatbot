/**
 * StreamingAudioPlayer — HV4. Plays speech that is still arriving, and says when it really plays.
 *
 * Piper WASM and the batch endpoints hand over a finished WAV; SonicAgent's stream hands over
 * 20–40 ms PCM16 frames while later sentences are still being synthesized. Waiting for all of
 * it would throw away the point of streaming, so this plays each piece as it comes, gap-free,
 * and keeps an honest clock of what has actually left the speaker:
 *
 *  - `onStart` fires when the first sample is played — not when the request went out or the
 *    first frame arrived — so her talk animation and lip-sync begin with her voice.
 *  - `onEnd` fires after the last sample is played, never when the network says "done".
 *  - `playedMs()` / `phrasePlayedMs(id)` feed SonicAgent's flow control (HV3 `playback.ack`).
 *  - `stop()` silences at once: a cancelled turn does not finish its buffered audio.
 *
 * Two engines, one contract. Where `AudioWorklet` exists (Quest Browser, Chrome, Safari 14.1+)
 * the samples are queued in `worklets/stream-playback.processor.js` on the audio thread, which
 * counts played samples itself. Elsewhere each piece is an `AudioBufferSourceNode` scheduled
 * back to back on the context clock. Either way nothing runs per sample on the page's thread
 * except the resampling of each piece to the context rate (worklet path), so the XR frame loop
 * is not where the audio work happens.
 *
 * An `AnalyserNode` sits after the output: `level()` is the RMS of what is audible now, which is
 * what drives her mouth (LipSyncEngine `drive`) for a voice whose text timing is unknown.
 */
(function (global) {
    'use strict';

    const WORKLET_URL = 'src/tts/worklets/stream-playback.processor.js';

    function lib(name) {
        return (global && global[name]) || null;
    }

    function create(deps) {
        const d = deps || {};
        const makeContext =
            d.createContext ||
            (() => {
                const AC = global && (global.AudioContext || global.webkitAudioContext);
                return AC ? new AC() : null;
            });
        const base = d.baseURI || (global && global.document && global.document.baseURI) || '';
        const preferWorklet = d.preferWorklet !== false;
        const later = d.setTimeout || setTimeout;

        let ctx = null;
        let analyser = null;
        let levelBuf = null;
        let engine = null; // { kind, push(samples, rate), end(), clear(), playedSamples(), rate }
        let enginePromise = null;
        let turn = null; // { key, started, ended, drained, segments: [{ id, start, length }] }
        const handlers = { start: null, end: null, underrun: null };

        async function ensureEngine() {
            if (engine) return engine;
            if (enginePromise) return enginePromise;
            enginePromise = (async () => {
                ctx = makeContext();
                if (!ctx) throw new Error('This browser cannot play streamed audio (no Web Audio).');
                analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                levelBuf = new Float32Array(analyser.fftSize);
                analyser.connect(ctx.destination);
                if (preferWorklet && ctx.audioWorklet && typeof global.AudioWorkletNode === 'function') {
                    try {
                        await ctx.audioWorklet.addModule(new URL(WORKLET_URL, base).href);
                        engine = workletEngine();
                        return engine;
                    } catch (err) {
                        if (global && global.console)
                            global.console.warn('[StreamingAudioPlayer] worklet unavailable:', err);
                    }
                }
                engine = sourceEngine();
                return engine;
            })();
            try {
                return await enginePromise;
            } finally {
                enginePromise = null;
            }
        }

        function fire(kind, key) {
            const fn = handlers[kind];
            if (typeof fn === 'function') {
                try {
                    fn(key);
                } catch (_) {}
            }
        }

        // ---- AudioWorklet engine ----------------------------------------------------------------

        function workletEngine() {
            const node = new global.AudioWorkletNode(ctx, 'nexus-stream-playback', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
            });
            node.connect(analyser);
            let played = 0;
            let resampler = null;
            let resampleFrom = 0;
            node.port.onmessage = (e) => {
                const m = e.data || {};
                const key = turn && turn.key;
                if (m.type === 'started') markStarted(key);
                else if (m.type === 'played') played = m.samples;
                else if (m.type === 'underrun') fire('underrun', key);
                else if (m.type === 'drained') {
                    played = m.samples;
                    markDrained(key);
                }
            };
            return {
                kind: 'worklet',
                push(samples, rate) {
                    let pcm = samples;
                    if (rate !== ctx.sampleRate) {
                        const S = lib('NEXUS_SONIC_STREAM');
                        if (!resampler || resampleFrom !== rate) {
                            resampler = S ? S.createResampler(rate, ctx.sampleRate) : null;
                            resampleFrom = rate;
                        }
                        pcm = resampler ? resampler.push(samples) : samples;
                    }
                    if (pcm.length) node.port.postMessage({ type: 'push', samples: pcm }, [pcm.buffer]);
                },
                end() {
                    if (resampler) {
                        const tail = resampler.flush();
                        if (tail.length) node.port.postMessage({ type: 'push', samples: tail }, [tail.buffer]);
                        resampler = null;
                    }
                    node.port.postMessage({ type: 'end' });
                },
                clear() {
                    resampler = null;
                    played = 0;
                    node.port.postMessage({ type: 'clear' });
                },
                playedSamples: () => played,
                rate: () => ctx.sampleRate,
            };
        }

        // ---- AudioBufferSourceNode engine (no worklet) --------------------------------------------

        function sourceEngine() {
            let nextTime = 0;
            let firstTime = null;
            let scheduledSec = 0;
            let live = new Set();
            let ending = false;
            let startTimer = null;
            const LEAD = 0.03;

            function maybeDrained(key) {
                if (ending && live.size === 0) {
                    ending = false;
                    markDrained(key);
                }
            }

            return {
                kind: 'buffer-source',
                push(samples, rate) {
                    if (!samples.length) return;
                    const buffer = ctx.createBuffer(1, samples.length, rate);
                    buffer.getChannelData(0).set(samples);
                    const src = ctx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(analyser);
                    const nowT = ctx.currentTime;
                    if (nextTime < nowT + 0.005) {
                        if (firstTime != null) fire('underrun', turn && turn.key);
                        nextTime = nowT + LEAD;
                    }
                    if (firstTime == null) {
                        firstTime = nextTime;
                        const key = turn && turn.key;
                        startTimer = later(() => markStarted(key), Math.max(0, (firstTime - nowT) * 1000));
                    }
                    const key = turn && turn.key;
                    src.onended = () => {
                        live.delete(src);
                        maybeDrained(key);
                    };
                    live.add(src);
                    src.start(nextTime);
                    nextTime += buffer.duration;
                    scheduledSec += buffer.duration;
                },
                end() {
                    ending = true;
                    maybeDrained(turn && turn.key);
                },
                clear() {
                    if (startTimer) clearTimeout(startTimer);
                    for (const src of live) {
                        try {
                            src.onended = null;
                            src.stop();
                        } catch (_) {}
                    }
                    live = new Set();
                    nextTime = 0;
                    firstTime = null;
                    scheduledSec = 0;
                    ending = false;
                },
                playedSamples() {
                    if (firstTime == null) return 0;
                    const sec = Math.min(scheduledSec, Math.max(0, ctx.currentTime - firstTime));
                    return Math.round(sec * ctx.sampleRate);
                },
                rate: () => ctx.sampleRate,
            };
        }

        // ---- turn bookkeeping ---------------------------------------------------------------------

        function markStarted(key) {
            if (!turn || turn.key !== key || turn.started) return;
            turn.started = true;
            turn.startedAt = Date.now();
            fire('start', key);
        }

        function markDrained(key) {
            if (!turn || turn.key !== key || turn.drained) return;
            turn.drained = true;
            fire('end', key);
        }

        function playedMs() {
            if (!engine) return 0;
            return (engine.playedSamples() / engine.rate()) * 1000;
        }

        return {
            WORKLET_URL,
            on(kind, fn) {
                handlers[kind] = fn;
            },
            /** Start a new turn: anything still playing stops. */
            async beginTurn(key) {
                const e = await ensureEngine();
                if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                    try {
                        await ctx.resume();
                    } catch (_) {}
                }
                e.clear();
                turn = { key, started: false, ended: false, drained: false, segments: [], queuedMs: 0 };
                return e.kind;
            },
            /** Append audio for `phraseId` of turn `key`. Audio for any other turn is dropped. */
            push(key, phraseId, samples, rate) {
                if (!engine || !turn || turn.key !== key || turn.ended) return false;
                let seg = turn.segments[turn.segments.length - 1];
                if (!seg || seg.id !== phraseId) {
                    seg = { id: phraseId, startMs: turn.queuedMs, ms: 0 };
                    turn.segments.push(seg);
                }
                const ms = (samples.length / rate) * 1000;
                seg.ms += ms;
                turn.queuedMs += ms;
                engine.push(samples, rate);
                return true;
            },
            /** No more audio for this turn: `end` fires once the last sample has played. */
            endTurn(key) {
                if (!engine || !turn || turn.key !== key || turn.ended) return;
                turn.ended = true;
                if (!turn.queuedMs) {
                    // Nothing was ever queued: there is nothing to wait for.
                    turn.drained = true;
                    fire('end', key);
                    return;
                }
                engine.end();
            },
            /** Silence now. The turn ends without `end` (the caller cancelled it). */
            stop() {
                if (engine) engine.clear();
                turn = null;
            },
            playedMs,
            phrasePlayedMs(phraseId) {
                if (!turn) return 0;
                const seg = turn.segments.find((s) => s.id === phraseId);
                if (!seg) return 0;
                return Math.max(0, Math.min(seg.ms, playedMs() - seg.startMs));
            },
            /** RMS of what is audible now, 0..1 (≈0.3 is loud speech). */
            level() {
                if (!analyser || !levelBuf) return 0;
                analyser.getFloatTimeDomainData(levelBuf);
                let sum = 0;
                for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
                return Math.sqrt(sum / levelBuf.length);
            },
            kind: () => (engine ? engine.kind : null),
            current: () => (turn ? Object.assign({}, turn, { segments: turn.segments.slice() }) : null),
            /** Release the audio device (XR exit, page hide). A later turn opens a new one. */
            async dispose() {
                try {
                    if (engine) engine.clear();
                } catch (_) {}
                turn = null;
                engine = null;
                const c = ctx;
                ctx = null;
                analyser = null;
                if (c && typeof c.close === 'function') {
                    try {
                        await c.close();
                    } catch (_) {}
                }
            },
        };
    }

    let shared = null;

    const api = {
        create,
        WORKLET_URL,
        shared() {
            if (!shared) shared = create();
            return shared;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STREAM_PLAYER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
