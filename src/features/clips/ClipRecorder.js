/**
 * ClipRecorder — the last thirty seconds, always (addendum v1.2 §15.1, batch B24).
 *
 * A rolling buffer that is always running while Together Mode is, so the good moment is
 * already recorded by the time anybody realises it was one. Nothing here has a button: B25
 * adds those. This batch exists to prove the trim works before there is any way to trigger it,
 * which is the only order in which "the saved clip is thirty seconds" can be a claim rather
 * than a hope.
 *
 * ## The header problem, which is the whole batch
 *
 * `MediaRecorder` with a one-second timeslice does **not** produce thirty interchangeable
 * one-second files. The first blob carries the WebM EBML header and the initialisation
 * segment; every blob after it is a bare cluster. Concatenate blobs 6 through 35 and you
 * get thirty seconds of video that no player on earth will open.
 *
 * So the header blob is kept forever, outside the ring, and prepended to every trim — unless
 * it is still inside the window, in which case prepending it would duplicate it. That is the
 * entire trick, it is four lines, and getting it wrong produces a file that is exactly the
 * right size and completely broken, which is the worst kind of bug to find in a share sheet.
 *
 * ## Why the ring is 35 s and the clip is 30
 *
 * Timeslices are a request, not a guarantee: a browser under load emits a 1400 ms blob and
 * then a 600 ms one. Five seconds of slack means the trim always has thirty seconds of
 * material to choose from rather than twenty-eight and an apology. The surplus is dropped,
 * so the buffer's memory is bounded by time rather than by how long the session has run.
 *
 * ## Immersive XR cannot be captured, and that is not a bug
 *
 * In an immersive session the frames go to the headset's own framebuffer; the page's canvas
 * is not what the user is seeing and `captureStream` on it returns whatever the mirror view
 * happens to be. There is no API that hands a page the composited XR frame, on any platform,
 * by design. So the mirror view **is** the clip in XR — documented, reported through
 * `stats.source`, and not worked around, because the workaround does not exist.
 *
 * ## Nothing here can reach the network
 *
 * Not by policy — by construction, and audited. `scripts/audit-privacy.mjs` walks every file
 * under `src/features/clips/` and fails on `fetch`, `XMLHttpRequest`, `WebSocket`,
 * `navigator.sendBeacon`, `import(`, and the rest. A clip is the user's; it goes to their
 * disk through an object URL and nowhere else.
 *
 * Exposes: window.NEXUS_BD_CLIP_RECORDER
 */
const ClipRecorder = (() => {
    'use strict';

    /** What a saved clip is. The number in the acceptance criterion. */
    const CLIP_SECONDS = 30;

    /**
     * What the ring holds. The five seconds of slack absorb timeslice jitter — a browser
     * under load emits a 1400 ms blob and then a 600 ms one, and the trim still has thirty
     * seconds to choose from.
     */
    const RING_SECONDS = 35;

    /** One blob a second. Small enough to trim precisely, large enough not to thrash. */
    const TIMESLICE_MS = 1000;

    /** Capture rate. 30 is the plan's number and what `CompanionMode` already uses. */
    const FPS = 30;

    /** Preferred containers, best first. The first the browser admits to wins. */
    const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

    /**
     * Where the pixels came from, reported on every clip.
     *
     * `canvas` is the ordinary case. `mirror` is an immersive XR session, where the page's
     * canvas holds the mirror view rather than what the user is seeing — see the header.
     */
    const SOURCES = ['canvas', 'mirror'];

    function pickMimeType(Recorder) {
        if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return MIME_TYPES[MIME_TYPES.length - 1];
        for (const type of MIME_TYPES) {
            if (Recorder.isTypeSupported(type)) return type;
        }
        return MIME_TYPES[MIME_TYPES.length - 1];
    }

    // ── the ring ─────────────────────────────────────────────────────────────

    /**
     * A bounded window of blobs, measured in seconds rather than in entries.
     *
     * Separated from the recorder so the trim can be tested against a scripted sequence of
     * chunk durations — including the ugly ones — without a browser, a canvas or a codec.
     * That separation is what lets the acceptance test exist before any UI does.
     */
    class ChunkRing {
        constructor({ seconds = RING_SECONDS } = {}) {
            this.seconds = seconds;
            this.chunks = [];
            /** The first blob ever seen: the EBML header. Never evicted. See the header. */
            this.header = null;
            this.pushed = 0;
            this.dropped = 0;
        }

        get durationMs() {
            return this.chunks.reduce((total, chunk) => total + chunk.durationMs, 0);
        }

        get size() {
            return this.chunks.reduce((total, chunk) => total + (chunk.size || 0), 0);
        }

        /** @param {{blob: *, durationMs: number, at: number, size?: number}} chunk */
        push(chunk) {
            if (!chunk || !chunk.blob) return this;
            const entry = {
                blob: chunk.blob,
                durationMs: Number.isFinite(chunk.durationMs) ? chunk.durationMs : TIMESLICE_MS,
                at: chunk.at,
                size: chunk.size || (chunk.blob && chunk.blob.size) || 0,
            };
            if (this.header === null) this.header = entry;
            this.chunks.push(entry);
            this.pushed++;
            this._evict();
            return this;
        }

        _evict() {
            const limit = this.seconds * 1000;
            while (this.chunks.length > 1 && this.durationMs - this.chunks[0].durationMs >= limit) {
                this.chunks.shift();
                this.dropped++;
            }
        }

        /**
         * The last `seconds` of material, oldest first, with the header in front of it.
         *
         * Trims from the *end* backwards, because the interesting thirty seconds are the
         * ones that just happened. A chunk that straddles the boundary is kept whole — a
         * clip is 30 s ± one chunk, and cutting a cluster in half produces a file that is
         * the right length and unplayable.
         */
        window(seconds = CLIP_SECONDS) {
            const limit = seconds * 1000;
            const kept = [];
            let total = 0;
            for (let i = this.chunks.length - 1; i >= 0; i--) {
                kept.unshift(this.chunks[i]);
                total += this.chunks[i].durationMs;
                if (total >= limit) break;
            }
            // The header is the initialisation segment. Without it the blobs are clusters
            // with nothing to interpret them, and the file opens in nothing.
            if (this.header && kept[0] !== this.header) kept.unshift(this.header);
            return kept;
        }

        /**
         * Is the header still real material, rather than something to prepend?
         *
         * It is both things at different times: for the first thirty-five seconds it is the
         * oldest chunk in the window *and* the initialisation segment, and after that it is
         * only the latter. Whoever measures a clip's length has to know which — counting a
         * prepended header reports a thirty-one-second clip, and skipping a resident one
         * reports a four-second clip as five.
         */
        get headerIsResident() {
            return this.header !== null && this.chunks.includes(this.header);
        }

        clear() {
            this.chunks = [];
            this.header = null;
            return this;
        }

        get stats() {
            return {
                chunks: this.chunks.length,
                seconds: Math.round(this.durationMs / 100) / 10,
                bytes: this.size,
                pushed: this.pushed,
                dropped: this.dropped,
                header: this.header !== null,
                headerResident: this.headerIsResident,
            };
        }
    }

    // ── the recorder ─────────────────────────────────────────────────────────

    class Recorder {
        constructor({
            bus,
            canvas,
            audio,
            makeCanvas,
            RecorderImpl,
            makeBlob,
            fps = FPS,
            seconds = RING_SECONDS,
            clipSeconds = CLIP_SECONDS,
            now = () => Date.now(),
        } = {}) {
            this.id = 'clips';
            this.label = 'Clips';

            this.bus = bus || null;
            this.now = now;
            this.fps = fps;
            this.clipSeconds = clipSeconds;

            this._canvas = canvas || null;
            this._audio = audio || null;
            this._makeCanvas = makeCanvas || defaultCanvas;
            this._Recorder =
                RecorderImpl === undefined
                    ? (typeof window !== 'undefined' && window.MediaRecorder) || null
                    : RecorderImpl;
            this._makeBlob = makeBlob === undefined ? (typeof Blob !== 'undefined' ? defaultBlob : null) : makeBlob;

            this.ring = new ChunkRing({ seconds });
            this.recording = false;
            this.recorder = null;
            this.stream = null;
            this.composite = null;
            this.context = null;
            this.mimeType = '';
            this.frames = 0;
            this.saves = 0;
            this.lastError = null;
        }

        get name() {
            return 'ClipRecorder';
        }

        /**
         * Where the pixels come from right now. In an immersive session the page canvas is
         * the mirror view — see the header. Reported rather than corrected.
         */
        get source() {
            const viewer = typeof window !== 'undefined' ? window.NEXUS_VIEWER : null;
            const immersive = Boolean(
                viewer && ((viewer.xrSupport && viewer.xrSupport.isPresenting) || viewer.isPresenting)
            );
            return immersive ? 'mirror' : 'canvas';
        }

        get available() {
            return Boolean(this._Recorder && this._canvasOrNull() && this._makeBlob);
        }

        _canvasOrNull() {
            if (this._canvas) return this._canvas;
            if (typeof document === 'undefined') return null;
            this._canvas = document.querySelector('canvas');
            return this._canvas;
        }

        // ── lifecycle ────────────────────────────────────────────────────────

        /**
         * Begin buffering. Returns a reason rather than throwing: a browser without
         * `MediaRecorder` should cost the user a feature, not a session.
         */
        start() {
            if (this.recording) return { ok: false, why: 'already recording' };
            const canvas = this._canvasOrNull();
            if (!canvas) return { ok: false, why: 'no canvas to record' };
            if (!this._Recorder) return { ok: false, why: 'this browser has no MediaRecorder' };
            if (typeof canvas.captureStream !== 'function') {
                return { ok: false, why: 'this browser cannot capture a canvas' };
            }

            try {
                this.composite = this._makeCanvas(Math.max(2, canvas.width), Math.max(2, canvas.height));
                this.context = this.composite.getContext('2d');
                this.stream = this.composite.captureStream(this.fps);
                this._mixAudio(this.stream);

                this.mimeType = pickMimeType(this._Recorder);
                this.recorder = new this._Recorder(this.stream, { mimeType: this.mimeType });
                this.recorder.ondataavailable = (event) => this._chunk(event);
                this.recorder.onerror = (event) => {
                    this.lastError = (event && event.error) || event;
                    console.warn('[BD] the clip recorder stopped', this.lastError);
                };
                this.recorder.start(TIMESLICE_MS);
                this.recording = true;
                return { ok: true, why: this.mimeType, source: this.source };
            } catch (error) {
                this.lastError = error;
                this.stop('failed');
                return { ok: false, why: String((error && error.message) || error) };
            }
        }

        stop(why = 'user') {
            if (this.recorder) {
                try {
                    if (this.recorder.state !== 'inactive') this.recorder.stop();
                } catch (error) {
                    console.warn('[BD] the clip recorder refused to stop', error);
                }
            }
            for (const track of (this.stream && this.stream.getTracks && this.stream.getTracks()) || []) {
                try {
                    track.stop();
                } catch {
                    /* a track that is already gone is not a problem */
                }
            }
            this.recorder = null;
            this.stream = null;
            this.composite = null;
            this.context = null;
            this.recording = false;
            // The buffer is dropped with the session. Thirty seconds of the user's living
            // room must not outlive the thing that was recording it.
            this.ring.clear();
            return why;
        }

        detach() {
            this.stop('detached');
        }

        /**
         * Mix whatever audio the page already has into the capture. Best-effort: a clip with
         * no sound is a clip; a thrown exception is not.
         */
        _mixAudio(stream) {
            const audio = this._audio;
            if (!audio || !stream || typeof stream.addTrack !== 'function') return null;
            try {
                const tracks =
                    typeof audio.getAudioTracks === 'function'
                        ? audio.getAudioTracks()
                        : (audio.stream && audio.stream.getAudioTracks && audio.stream.getAudioTracks()) || [];
                for (const track of tracks) stream.addTrack(track);
                return tracks.length;
            } catch (error) {
                console.warn('[BD] the clip has no sound', error);
                return null;
            }
        }

        _chunk(event) {
            const blob = event && event.data;
            if (!blob || !blob.size) return null;
            const chunk = { blob, durationMs: TIMESLICE_MS, at: this.now(), size: blob.size };
            this.ring.push(chunk);
            return chunk;
        }

        // ── the per-frame cost ───────────────────────────────────────────────

        /**
         * Called from the render loop. One `drawImage` and two increments.
         *
         * The app's WebGL canvas has `preserveDrawingBuffer: false`, so it reads back blank
         * unless it is copied inside a render frame — the same constraint `CompanionMode`
         * hit and solved the same way. That is why this is a tick rather than a timer.
         */
        tick() {
            if (!this.recording || !this.context) return 0;
            const canvas = this._canvas;
            if (!canvas) return 0;
            try {
                this.context.drawImage(canvas, 0, 0, this.composite.width, this.composite.height);
            } catch (error) {
                // A tainted or zero-sized source throws every frame; say so once.
                if (!this.lastError) console.warn('[BD] the clip frame did not copy', error);
                this.lastError = error;
                return 0;
            }
            this.frames++;
            return 1;
        }

        // ── the trim ─────────────────────────────────────────────────────────

        /**
         * The last thirty seconds, as one blob. Returns null when there is nothing buffered.
         *
         * Deliberately synchronous and deliberately without a filename, a download or a
         * share sheet: this batch produces a blob and stops. B25 decides what to do with it.
         */
        save({ seconds = this.clipSeconds } = {}) {
            const kept = this.ring.window(seconds);
            if (!kept.length || !this._makeBlob) return null;
            const resident = this.ring.headerIsResident;
            const blob = this._makeBlob(
                kept.map((chunk) => chunk.blob),
                this.mimeType || MIME_TYPES[MIME_TYPES.length - 1]
            );
            this.saves++;
            const clip = {
                blob,
                mimeType: this.mimeType,
                source: this.source,
                chunks: kept.length,
                // What was actually captured. A *prepended* header contributes no playing
                // time; a header still inside the window is ordinary material and does.
                durationMs: kept
                    .filter((chunk, index) => !(index === 0 && chunk === this.ring.header && !resident))
                    .reduce((total, chunk) => total + chunk.durationMs, 0),
                at: this.now(),
            };
            if (this.bus) this.bus.emit('clip:saved', { ...clip, blob: undefined });
            return clip;
        }

        get stats() {
            return {
                recording: this.recording,
                source: this.source,
                mimeType: this.mimeType,
                frames: this.frames,
                saves: this.saves,
                ring: this.ring.stats,
                error: this.lastError ? String(this.lastError.message || this.lastError) : null,
            };
        }
    }

    function defaultCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function defaultBlob(parts, type) {
        return new Blob(parts, { type });
    }

    function attach(deps) {
        return new Recorder(deps);
    }

    return {
        attach,
        Recorder,
        ChunkRing,
        pickMimeType,
        CLIP_SECONDS,
        RING_SECONDS,
        TIMESLICE_MS,
        FPS,
        MIME_TYPES,
        SOURCES,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CLIP_RECORDER = ClipRecorder;
if (typeof module !== 'undefined' && module.exports) module.exports = ClipRecorder;
