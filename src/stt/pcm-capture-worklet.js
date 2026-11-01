/**
 * pcm-capture-worklet.js — ST2. Raw microphone samples, off the page's thread.
 *
 * An AudioWorkletProcessor that copies the first input channel and posts it to the page in
 * ~2048-sample blocks (≈43 ms at 48 kHz). Posting every 128-frame render quantum would be ~375
 * messages a second; batching keeps the page's message queue quiet while VR is drawing.
 *
 * Raw PCM rather than MediaRecorder: a compressed recording has to be decoded again before
 * Whisper can read it, and a decoder that does not support the recorder's codec (it varies by
 * browser) fails only at the end, after the person has spoken.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.block = new Float32Array(2048);
        this.fill = 0;
        this.port.onmessage = (e) => {
            if (e.data === 'flush' && this.fill) {
                this.port.postMessage(this.block.slice(0, this.fill));
                this.fill = 0;
            }
        };
    }

    process(inputs) {
        const input = inputs[0];
        const ch = input && input[0];
        if (ch) {
            let i = 0;
            while (i < ch.length) {
                const n = Math.min(ch.length - i, this.block.length - this.fill);
                this.block.set(ch.subarray(i, i + n), this.fill);
                this.fill += n;
                i += n;
                if (this.fill === this.block.length) {
                    this.port.postMessage(this.block.slice(0));
                    this.fill = 0;
                }
            }
        }
        return true;
    }
}

registerProcessor('nexus-pcm-capture', PcmCaptureProcessor);
