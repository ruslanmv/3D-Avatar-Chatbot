/**
 * MediaAdapter — what the thing you are watching is doing (spec v1.1 §6.3, batch B12).
 *
 * Three events, and each of them is an *opening* in `together.profile` — the moments where
 * she is allowed to speak. That is the whole reason this adapter exists: Together Mode's
 * rule is that her silence is the default, so the events that break it have to be few,
 * well-defined and cheap to detect.
 *
 *   `media:playing` / `media:paused` — the element's own events, not a poll.
 *   `media:cut`                      — a scene change, from luma and audio deltas.
 *
 * ## The cut detector reads pixels, so it is gated like anything that reads pixels
 *
 * B11's rule is that no capture code path exists outside the consent machine. A local file
 * the user opened is not capture — it is their file, in their `<video>`, and no grant is
 * involved. A shared tab *is*, so when the source came from a grant this refuses to sample
 * unless that grant is live, and stops the moment it is revoked.
 *
 * What it produces is also different in kind from what `CapturePipeline` produces: a mean
 * luma is a number. There is no `toDataURL` in this file and nothing here can hand anybody
 * an image — which is the distinction that makes reading pixels for a scalar acceptable
 * where sending them would not be.
 *
 * ## Cheap on purpose
 *
 * The detector draws into a 32×18 canvas a few times a second. At that size a frame is 576
 * pixels and the mean is a sum over an array that fits in L1; the cost is the `drawImage`
 * scale, which the GPU does. A full-resolution read would be the wrong thing on a Quest and
 * would also be no better at spotting a cut.
 *
 * Exposes: window.NEXUS_BD_MEDIA_ADAPTER
 */
const MediaAdapter = (() => {
    'use strict';

    /** Sample rate for the cut detector. Four a second catches a cut inside 250 ms. */
    const SAMPLE_MS = 250;

    /** Downsample size. Aspect is irrelevant to a mean; small is the point. */
    const PROBE_W = 32;
    const PROBE_H = 18;

    /**
     * Mean-luma jump that counts as a cut, on 0..1. Tuned against the fixture in
     * tests/behavior/watch.test.js: a dissolve moves ~0.05 per sample and must not fire,
     * a hard cut moves 0.2 and up.
     */
    const LUMA_DELTA = 0.16;

    /** Audio RMS jump that counts on its own — a cut to silence, or a cut to a bang. */
    const AUDIO_DELTA = 0.25;

    /** Two cuts inside this are one cut. Stops a strobing sequence firing every sample. */
    const CUT_COOLDOWN_MS = 1200;

    class Adapter {
        /**
         * @param {object} deps
         * @param {object} deps.bus
         * @param {object} [deps.blackboard]
         * @param {HTMLVideoElement} [deps.video]  attach later with `watch()`
         * @param {object} [deps.grant]  B11 grant, when the source is a shared tab
         */
        constructor({ bus, blackboard, video, grant, makeCanvas, analyser, now = () => Date.now() } = {}) {
            this.bus = bus;
            this.blackboard = blackboard;
            this.now = now;
            this.analyser = analyser || null;

            this.video = null;
            this.grant = grant || null;
            this.playing = false;

            this.lastSampleAt = 0;
            /** Null, not 0: "no cut yet" is not "a cut at timestamp zero". With 0 the
             *  cooldown swallows the first cut of a session, which is the one most likely
             *  to be the opening titles ending. */
            this.lastCutAt = null;
            this.lastLuma = null;
            this.lastRms = null;
            this.cuts = 0;
            this.samples = 0;
            /** Latched when a source turns out to be unreadable. See `_luma`. */
            this.lumaBlocked = false;

            this._makeCanvas = makeCanvas || defaultCanvas;
            this._probe = null;
            this._bound = [];
            if (video) this.watch(video, grant);
        }

        get name() {
            return 'MediaAdapter';
        }

        /** Start following an element. Replaces whatever was being followed. */
        watch(video, grant = null) {
            this.unwatch();
            this.video = video;
            this.grant = grant;
            this.lastLuma = null;
            this.lastRms = null;
            this.lumaBlocked = false;

            const on = (event, handler) => {
                if (typeof video.addEventListener !== 'function') return;
                video.addEventListener(event, handler);
                this._bound.push([event, handler]);
            };
            on('play', () => this._setPlaying(true));
            on('playing', () => this._setPlaying(true));
            on('pause', () => this._setPlaying(false));
            on('ended', () => this._setPlaying(false));
            // A stalled stream is not paused, and treating it as playing would keep her
            // quiet through a buffering spinner she should be commenting on.
            on('waiting', () => this._setPlaying(false));

            if (!video.paused) this._setPlaying(true);
            return this;
        }

        unwatch() {
            if (this.video && typeof this.video.removeEventListener === 'function') {
                for (const [event, handler] of this._bound) this.video.removeEventListener(event, handler);
            }
            this._bound = [];
            this.video = null;
            this._setPlaying(false);
        }

        _setPlaying(value) {
            if (value === this.playing) return null;
            this.playing = value;
            if (this.blackboard) {
                this.blackboard.activity = value ? 'watch' : this.blackboard.activity;
                // Attention is what §6.7 etiquette reads: 1 is "wholly on the activity".
                this.blackboard.attention = value ? 0.85 : 0.3;
            }
            const event = value ? 'media:playing' : 'media:paused';
            this.bus.emit(event, {});
            return event;
        }

        // ── the cut detector ─────────────────────────────────────────────────

        /** Can this source be read right now? A revoked grant is a no. */
        get readable() {
            if (!this.video || !this.playing) return false;
            if (this.grant && !this.grant.live) return false;
            return true;
        }

        /**
         * Called from the render loop. Rate-limited to `SAMPLE_MS` internally, so calling
         * it every frame costs one subtraction on all but four frames a second.
         */
        tick() {
            if (!this.readable) return null;
            const at = this.now();
            if (at - this.lastSampleAt < SAMPLE_MS) return null;
            this.lastSampleAt = at;
            return this.sample(at);
        }

        /**
         * One measurement. Returns `{luma, rms, cut}` — a scalar summary and nothing that
         * could be mistaken for a frame.
         */
        sample(at = this.now()) {
            const luma = this._luma();
            const rms = this._rms();
            if (luma === null && rms === null) return null;
            this.samples++;

            const lumaJump = this.lastLuma === null || luma === null ? 0 : Math.abs(luma - this.lastLuma);
            const rmsJump = this.lastRms === null || rms === null ? 0 : Math.abs(rms - this.lastRms);
            this.lastLuma = luma;
            this.lastRms = rms;

            const cut = lumaJump >= LUMA_DELTA || rmsJump >= AUDIO_DELTA;
            if (cut && (this.lastCutAt === null || at - this.lastCutAt >= CUT_COOLDOWN_MS)) {
                this.lastCutAt = at;
                this.cuts++;
                this.bus.emit('media:cut', { lumaJump, rmsJump });
                return { luma, rms, cut: true, lumaJump, rmsJump };
            }
            return { luma, rms, cut: false, lumaJump, rmsJump };
        }

        /** Mean luma of a 32×18 draw, on 0..1. Null when the frame has no size yet. */
        _luma() {
            if (this.lumaBlocked) return null;
            const width = this.video.videoWidth || 0;
            const height = this.video.videoHeight || 0;
            if (!width || !height) return null;

            if (!this._probe) this._probe = this._makeCanvas(PROBE_W, PROBE_H);
            const context = this._probe.getContext('2d');
            let pixels;
            try {
                context.drawImage(this.video, 0, 0, PROBE_W, PROBE_H);
                pixels = context.getImageData(0, 0, PROBE_W, PROBE_H).data;
            } catch (error) {
                // A tainted canvas: the source is cross-origin and cannot be read. Latch
                // it off rather than throwing the same exception four times a second — a
                // degraded feature, not a broken one, since the other openings still work.
                console.warn('[BD] cannot read frames from this source — cut detection off', error);
                this.lumaBlocked = true;
                this._probe = null;
                return null;
            }

            let sum = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                // Rec. 601 luma. Integer weights keep this an integer sum.
                sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            }
            const mean = sum / (pixels.length / 4) / 255;
            context.clearRect(0, 0, PROBE_W, PROBE_H);
            return mean;
        }

        /** RMS of the analyser's time domain, on 0..1. Null with no analyser. */
        _rms() {
            if (!this.analyser || typeof this.analyser.getByteTimeDomainData !== 'function') return null;
            const size = this.analyser.fftSize || 256;
            if (!this._audioBuffer || this._audioBuffer.length !== size) this._audioBuffer = new Uint8Array(size);
            this.analyser.getByteTimeDomainData(this._audioBuffer);

            let sum = 0;
            for (let i = 0; i < size; i++) {
                const centred = (this._audioBuffer[i] - 128) / 128;
                sum += centred * centred;
            }
            return Math.sqrt(sum / size);
        }

        detach() {
            this.unwatch();
            this._probe = null;
            this._audioBuffer = null;
        }

        get stats() {
            return {
                playing: this.playing,
                readable: this.readable,
                samples: this.samples,
                cuts: this.cuts,
                lumaBlocked: this.lumaBlocked,
                luma: this.lastLuma,
                rms: this.lastRms,
            };
        }
    }

    function defaultCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function attach(deps) {
        return new Adapter(deps);
    }

    return { attach, Adapter, SAMPLE_MS, LUMA_DELTA, AUDIO_DELTA, CUT_COOLDOWN_MS, PROBE_W, PROBE_H };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_MEDIA_ADAPTER = MediaAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = MediaAdapter;
