/**
 * CapturePipeline — frames, at the caps, only while consent is live (spec v1.1 §6.13, B11).
 *
 * ## It cannot obtain a stream
 *
 * That is the design, not an accident of this implementation. There is no `navigator` in
 * this file: the pipeline is constructed *from a grant*, and a grant only comes out of
 * `ConsentMachine.request()`. A future batch that wants frames has to ask for consent to
 * get an object it can build this with, which is a much stronger guarantee than a check
 * somebody has to remember to write, and it is what the "absence of a bypass" test reads
 * this file to confirm.
 *
 * ## The caps are enforced here, once
 *
 * §6.2 sets `maxFps: 1`, `frameLongEdgePx: 512`, `jpegQuality: 0.7`. They are ceilings, not
 * defaults: a caller asking for 30 fps gets 1, and a caller asking for 1080 px gets 512.
 * Enforcing them at the one place frames are produced means the four consumers in the plan
 * cannot each get them subtly wrong, and it means the server's own re-check (§6.13) is a
 * second opinion rather than the only one.
 *
 * ## Revocation beats the frame
 *
 * Sampling is `drawImage` → `toBlob` → base64, and every step after an await re-reads
 * `grant.live`. Revoking bumps an integer the grant compares against, so there is no
 * window where a revoked grant still looks alive: a sample already in flight resolves to
 * null and its bytes are never handed to anybody. The canvas is wiped on the way out, so
 * the last frame is not sitting in a backing store waiting for the next reader.
 *
 * Nothing is retained. There is no frame array, no ring buffer, no "last frame" property;
 * a sample is handed to its caller and forgotten, which is the client half of the §6.13
 * retention rule.
 *
 * Exposes: window.NEXUS_BD_CAPTURE
 */
const CapturePipeline = (() => {
    'use strict';

    /** §6.2. Ceilings — a caller may ask for less, never for more. */
    const CAPS = { maxFps: 1, frameLongEdgePx: 512, jpegQuality: 0.7 };

    const MIME = 'image/jpeg';

    class Pipeline {
        /**
         * @param {object} deps
         * @param {object} deps.grant     from ConsentMachine.request(); required
         * @param {object} [deps.config]  behavior.config.json; its `capture` block narrows
         * @param {function} [deps.makeCanvas] injectable for tests and for OffscreenCanvas
         */
        constructor({ grant, config = {}, makeCanvas, makeSource, now = () => Date.now() } = {}) {
            if (!grant || typeof grant.live !== 'boolean') {
                throw new Error('CapturePipeline needs a consent grant — there is no other way in');
            }
            this.grant = grant;
            this.now = now;

            const asked = config.capture || {};
            // Both directions of clamping matter. `Math.min` on fps stops a caller widening
            // it; `Math.max(1, …)` stops a config typo of 0 turning into a divide-by-zero
            // interval, and a negative one into "sample constantly".
            this.caps = {
                maxFps: Math.max(0.01, Math.min(CAPS.maxFps, Number(asked.maxFps) || CAPS.maxFps)),
                frameLongEdgePx: Math.max(
                    16,
                    Math.min(CAPS.frameLongEdgePx, Number(asked.frameLongEdgePx) || CAPS.frameLongEdgePx)
                ),
                jpegQuality: Math.max(0.1, Math.min(CAPS.jpegQuality, Number(asked.jpegQuality) || CAPS.jpegQuality)),
            };
            this.minIntervalMs = Math.round(1000 / this.caps.maxFps);

            this._makeCanvas = makeCanvas || defaultCanvas;
            this._makeSource = makeSource || defaultSource;
            this._source = null;
            this._canvas = null;

            this.lastSampleAt = 0;
            this.samples = 0;
            this.refused = { noConsent: 0, tooSoon: 0, revokedMidFlight: 0 };
            this.stopped = false;
        }

        /** The element the frames are drawn from. Built lazily: an ask may never come. */
        _sourceElement() {
            if (!this._source) this._source = this._makeSource(this.grant.stream);
            return this._source;
        }

        /**
         * One frame, or null. Null is the normal answer for "consent is gone" and for
         * "too soon" — a caller that cannot tell those apart reads `refused`.
         *
         * @returns {Promise<{dataUrl, width, height, at}|null>}
         */
        async sample({ force = false } = {}) {
            if (this.stopped || !this.grant.live) {
                this.refused.noConsent++;
                return null;
            }
            const at = this.now();
            if (!force && this.lastSampleAt && at - this.lastSampleAt < this.minIntervalMs) {
                this.refused.tooSoon++;
                return null;
            }
            this.lastSampleAt = at;

            const source = this._sourceElement();
            const size = fit(sourceWidth(source), sourceHeight(source), this.caps.frameLongEdgePx);
            if (!size) {
                this.refused.noConsent++;
                return null;
            }

            const canvas = this._canvasFor(size.width, size.height);
            const context = canvas.getContext('2d');
            context.drawImage(source, 0, 0, size.width, size.height);

            // Everything past here can yield, so every step re-reads the grant. This is the
            // "within one frame" claim: the check is after each await, not before the first.
            let dataUrl;
            try {
                dataUrl = await encode(canvas, this.caps.jpegQuality);
            } catch (error) {
                this._wipe(context, size);
                console.warn('[BD] frame encode failed', error);
                return null;
            }
            if (!this.grant.live || this.stopped) {
                this.refused.revokedMidFlight++;
                this._wipe(context, size);
                return null;
            }

            this._wipe(context, size);
            this.samples++;
            return { dataUrl, width: size.width, height: size.height, at, source: this.grant.source };
        }

        /**
         * Sample repeatedly. Returns a stop function. The loop checks consent every tick as
         * well as inside `sample`, so a revoke ends it without waiting for the next timer.
         */
        start(onFrame, { intervalMs } = {}) {
            const period = Math.max(this.minIntervalMs, Number(intervalMs) || 0);
            let timer = null;
            const stop = () => {
                if (timer) clearInterval(timer);
                timer = null;
            };
            const tick = async () => {
                if (!this.grant.live || this.stopped) return stop();
                const frame = await this.sample();
                if (frame && this.grant.live) onFrame(frame);
                return undefined;
            };
            if (typeof setInterval === 'function') timer = setInterval(tick, period);
            return stop;
        }

        _canvasFor(width, height) {
            if (!this._canvas) this._canvas = this._makeCanvas(width, height);
            this._canvas.width = width;
            this._canvas.height = height;
            return this._canvas;
        }

        /** Leave nothing behind in the backing store between samples. */
        _wipe(context, size) {
            try {
                context.clearRect(0, 0, size.width, size.height);
            } catch (error) {
                console.warn('[BD] could not clear the capture canvas', error);
            }
        }

        /** Release everything. Idempotent; does not revoke the grant, which is not ours. */
        stop() {
            this.stopped = true;
            if (this._canvas) {
                this._canvas.width = 0;
                this._canvas.height = 0;
            }
            this._canvas = null;
            this._source = null;
        }

        get stats() {
            return {
                caps: { ...this.caps },
                minIntervalMs: this.minIntervalMs,
                samples: this.samples,
                refused: { ...this.refused },
                live: this.grant.live,
            };
        }
    }

    /** Long-edge downscale, aspect preserved. Null when the source has no size yet. */
    function fit(width, height, longEdge) {
        if (!width || !height) return null;
        const scale = Math.min(1, longEdge / Math.max(width, height));
        return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    }

    function sourceWidth(source) {
        return source.videoWidth || source.width || 0;
    }

    function sourceHeight(source) {
        return source.videoHeight || source.height || 0;
    }

    function encode(canvas, quality) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toDataURL === 'function') {
                try {
                    return resolve(canvas.toDataURL(MIME, quality));
                } catch (error) {
                    return reject(error);
                }
            }
            return reject(new Error('canvas cannot encode'));
        });
    }

    function defaultCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function defaultSource(stream) {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        const played = video.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
        return video;
    }

    /** The only constructor. Named so a reader sees the grant is not optional. */
    function fromGrant(grant, options = {}) {
        return new Pipeline({ ...options, grant });
    }

    return { Pipeline, fromGrant, CAPS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CAPTURE = CapturePipeline;
if (typeof module !== 'undefined' && module.exports) module.exports = CapturePipeline;
