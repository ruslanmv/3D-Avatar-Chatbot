/**
 * MicrophoneSession — ST2. One owner of the microphone, and a start that can be taken back.
 *
 * Two things went wrong with the microphone before this, and both are rules here:
 *
 * 1. **A release before the mic opened was lost.** Push-to-talk asks for the microphone on
 *    press; asking takes time (a permission prompt the first time, a device open every time).
 *    A person who taps the trigger and lets go inside that window released *before* anything
 *    was listening, so the release stopped nothing — and then the microphone opened and kept
 *    recording with nobody holding the button. `open()` returns a lease at once; `close()` on
 *    it works whether or not the device has opened yet, and a stream that arrives after its
 *    lease was closed is stopped on arrival.
 * 2. **Two listeners at once.** The mic button, the VR panel and the companion each had their
 *    own recognizer. On a phone or a headset only one capture really gets audio. Here a second
 *    `open()` ends the first lease (its owner hears `onEnded('preempted')`), so there is never
 *    a recording nobody is reading.
 *
 * Audio is captured as raw float PCM through an AudioWorklet (ScriptProcessor where worklets
 * are missing) and handed to `onFrames(samples, sampleRate)`. The browser's echo cancellation,
 * noise suppression and auto gain are requested: on a Quest, her own voice comes out of the
 * speakers next to the microphone.
 *
 * Dependencies (getUserMedia, AudioContext) are injected so tests can script them.
 */
(function (global) {
    'use strict';

    const WORKLET_URL = 'src/stt/pcm-capture-worklet.js';

    function reasonOf(err) {
        const name = err && err.name;
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
            return 'no-device';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
        return 'unavailable';
    }

    const MESSAGES = Object.freeze({
        denied: 'Microphone access is blocked. Allow the microphone for this site and try again.',
        'no-device': 'No microphone was found.',
        busy: 'The microphone is in use by something else.',
        unavailable: 'The microphone could not be opened.',
        unsupported: 'This browser cannot record audio here (it needs HTTPS and a microphone API).',
        cancelled: 'Recording was stopped before the microphone opened.',
    });

    function create(deps) {
        const d = deps || {};
        const nav = d.navigator || (global && global.navigator);
        const AC = d.AudioContext || (global && (global.AudioContext || global.webkitAudioContext));
        const base = d.baseURI || (global && global.document && global.document.baseURI) || '';

        let gen = 0;
        let current = null; // the live lease

        function supported() {
            return !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function' && AC);
        }

        async function wire(ctx, stream, onFrames) {
            const source = ctx.createMediaStreamSource(stream);
            const sink = ctx.createGain();
            sink.gain.value = 0; // keep the graph pulled without playing the mic back
            sink.connect(ctx.destination);
            const rate = ctx.sampleRate;
            if (ctx.audioWorklet && typeof global.AudioWorkletNode === 'function') {
                try {
                    await ctx.audioWorklet.addModule(new URL(WORKLET_URL, base).href);
                    const node = new global.AudioWorkletNode(ctx, 'nexus-pcm-capture', {
                        numberOfInputs: 1,
                        numberOfOutputs: 1,
                        channelCount: 1,
                        channelCountMode: 'explicit',
                    });
                    node.port.onmessage = (e) => onFrames(e.data, rate);
                    source.connect(node);
                    node.connect(sink);
                    return { source, node, sink, flush: () => node.port.postMessage('flush') };
                } catch (err) {
                    if (global && global.console) global.console.warn('[MicrophoneSession] worklet unavailable:', err);
                }
            }
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            proc.onaudioprocess = (e) => onFrames(Float32Array.from(e.inputBuffer.getChannelData(0)), rate);
            source.connect(proc);
            proc.connect(sink);
            return { source, node: proc, sink, flush: () => {} };
        }

        /**
         * open({ owner, deviceId, onFrames, onEnded }) → lease, immediately.
         * `lease.ready` resolves { ok: true, sampleRate } or { ok: false, reason, message }.
         */
        function open(opts) {
            const o = opts || {};
            if (current) current.close('preempted');
            const myGen = ++gen;
            let closed = false;
            let stream = null;
            let ctx = null;
            let graph = null;
            let endReason = null;

            const lease = {
                owner: o.owner || 'unknown',
                ready: null,
                isOpen: () => !!stream && !closed,
                close(reason) {
                    if (closed) return;
                    closed = true;
                    endReason = reason || 'closed';
                    try {
                        if (graph) graph.flush();
                    } catch (_) {}
                    release();
                    if (current === lease) current = null;
                    if (reason && reason !== 'closed' && typeof o.onEnded === 'function') {
                        try {
                            o.onEnded(reason);
                        } catch (_) {}
                    }
                },
            };

            function release() {
                try {
                    if (graph) {
                        graph.source.disconnect();
                        graph.node.disconnect();
                        graph.sink.disconnect();
                    }
                } catch (_) {}
                graph = null;
                if (stream) {
                    for (const t of stream.getTracks()) {
                        try {
                            t.stop();
                        } catch (_) {}
                    }
                }
                stream = null;
                if (ctx) {
                    try {
                        ctx.close();
                    } catch (_) {}
                }
                ctx = null;
            }

            current = lease;
            lease.ready = (async () => {
                if (!supported()) return { ok: false, reason: 'unsupported', message: MESSAGES.unsupported };
                const audio = {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                };
                if (o.deviceId) audio.deviceId = { exact: o.deviceId };
                let s;
                try {
                    s = await nav.mediaDevices.getUserMedia({ audio });
                } catch (err) {
                    if (o.deviceId && err && err.name === 'OverconstrainedError') {
                        // The saved microphone is gone (unplugged, another headset): use the default.
                        try {
                            delete audio.deviceId;
                            s = await nav.mediaDevices.getUserMedia({ audio });
                        } catch (err2) {
                            err = err2;
                        }
                    }
                    if (!s) {
                        if (current === lease) current = null;
                        const reason = closed ? 'cancelled' : reasonOf(err);
                        return { ok: false, reason, message: MESSAGES[reason] };
                    }
                }
                if (closed || myGen !== gen) {
                    // Released (or superseded) while the browser was opening the device.
                    for (const t of s.getTracks()) t.stop();
                    return { ok: false, reason: 'cancelled', message: MESSAGES.cancelled };
                }
                stream = s;
                for (const t of s.getAudioTracks()) {
                    t.addEventListener('ended', () => lease.close('device-ended'));
                }
                try {
                    ctx = new AC();
                    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
                    graph = await wire(ctx, s, (samples, rate) => {
                        if (!closed && typeof o.onFrames === 'function') o.onFrames(samples, rate);
                    });
                } catch (err) {
                    lease.close();
                    return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };
                }
                if (closed) return { ok: false, reason: 'cancelled', message: MESSAGES.cancelled };
                return { ok: true, sampleRate: ctx.sampleRate };
            })();
            lease.endReason = () => endReason;
            return lease;
        }

        return {
            open,
            supported,
            owner: () => (current ? current.owner : null),
            closeAll(reason) {
                if (current) current.close(reason || 'closed');
            },
        };
    }

    let shared = null;
    function get() {
        if (!shared) shared = create();
        return shared;
    }

    const api = { create, get, MESSAGES, reasonOf, WORKLET_URL };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_MIC_SESSION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
