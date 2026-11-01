/**
 * stream-playback.processor.js — HV4. Streamed speech, played on the audio thread.
 *
 * The page posts Float32 chunks already at the context's rate; this processor plays them back
 * to back from a queue and reports, about every 50 ms, how many samples it has actually played.
 * That count is what "played" means everywhere else: the moment playback really began (so
 * `onStart` fires when she is audible, not when the network answered), the acknowledgements
 * SonicAgent paces itself by (HV3 `playback.ack`), and the moment the last sample left
 * (`onEnd` after drain, never before).
 *
 * Messages in:  { type: 'push', samples: Float32Array }  |  { type: 'end' }  |  { type: 'clear' }
 * Messages out: { type: 'started' } | { type: 'played', samples } | { type: 'drained', samples }
 *               | { type: 'underrun' }
 *
 * `clear` empties the queue at once — a cancelled turn stops within one 128-sample quantum
 * (2.7 ms at 48 kHz) instead of finishing its buffered audio.
 *
 * The class is exported for Node tests through `globalThis.__NEXUS_PLAYBACK_PROCESSOR__` when
 * `registerProcessor` is a test stub; in a browser that line does nothing.
 */
class StreamPlaybackProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.offset = 0; // read position inside queue[0]
        this.played = 0;
        this.reported = 0;
        this.started = false;
        this.ending = false;
        this.starved = false;
        this.port.onmessage = (e) => this.onMessage(e.data);
    }

    onMessage(msg) {
        if (!msg) return;
        if (msg.type === 'push' && msg.samples && msg.samples.length) {
            this.queue.push(msg.samples);
            this.starved = false;
        } else if (msg.type === 'end') {
            this.ending = true;
            if (!this.queue.length) this.finish();
        } else if (msg.type === 'clear') {
            this.queue = [];
            this.offset = 0;
            this.ending = false;
            this.started = false;
            this.played = 0;
            this.reported = 0;
        }
    }

    finish() {
        this.port.postMessage({ type: 'drained', samples: this.played });
        this.ending = false;
        this.started = false;
        this.played = 0;
        this.reported = 0;
    }

    process(_inputs, outputs) {
        const out = outputs[0] && outputs[0][0];
        if (!out) return true;
        let i = 0;
        while (i < out.length && this.queue.length) {
            const head = this.queue[0];
            const n = Math.min(out.length - i, head.length - this.offset);
            out.set(head.subarray(this.offset, this.offset + n), i);
            i += n;
            this.offset += n;
            if (this.offset >= head.length) {
                this.queue.shift();
                this.offset = 0;
            }
        }
        if (i > 0) {
            if (!this.started) {
                this.started = true;
                this.port.postMessage({ type: 'started' });
            }
            this.played += i;
        }
        for (let k = i; k < out.length; k++) out[k] = 0;
        for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
        if (this.started && !this.queue.length) {
            if (this.ending) this.finish();
            else if (!this.starved) {
                this.starved = true;
                this.port.postMessage({ type: 'underrun' });
            }
        }
        // ~50 ms at 48 kHz: often enough for acks and lip-sync timing, quiet enough for VR.
        if (this.played - this.reported >= 2400) {
            this.reported = this.played;
            this.port.postMessage({ type: 'played', samples: this.played });
        }
        return true;
    }
}

registerProcessor('nexus-stream-playback', StreamPlaybackProcessor);
if (typeof globalThis !== 'undefined' && globalThis.__NEXUS_TEST_EXPORT__) {
    globalThis.__NEXUS_PLAYBACK_PROCESSOR__ = StreamPlaybackProcessor;
}
