/**
 * ConsentMachine — the only door to a camera or a screen (spec v1.1 §6.13, batch B11).
 *
 * This batch lands before any consumer exists, and that ordering is the whole design. Four
 * later batches want frames — screen insight (B15), the game co-host (B23), the camera
 * activities (B26, B27) — and if any of them could reach `getDisplayMedia` directly there
 * would be four consent stories to keep true instead of one. So there is exactly one call
 * site in the engine for `getDisplayMedia` and `getUserMedia`, it is in this file, and
 * `tests/behavior/capture.test.js` asserts that by reading the source of every other file.
 *
 * ## What a grant is
 *
 * `request()` hands back a **grant**, and a grant is the only object in the system that
 * carries a `MediaStream`. `CapturePipeline` cannot be built without one and never touches
 * `navigator.mediaDevices` itself, so "capture requires consent" is not a check somebody
 * has to remember to write — it is the shape of the API.
 *
 * A grant carries an `epoch`. Revoking bumps the machine's epoch, which makes every grant
 * ever issued read `live === false` in the same tick, with no listener to fire and no
 * promise to await. That is what lets an in-flight sample be abandoned inside one frame:
 * the sampler re-reads `grant.live` after every await, and there is no window in which a
 * revoked grant still looks alive.
 *
 * ## What it does not do
 *
 * It does not remember. Nothing here is written to storage, and a reload starts at `idle` —
 * consent to share a screen five minutes ago is not consent to share it now. It also does
 * not decide *what* is captured, sampled or sent; the caps live in `CapturePipeline` and
 * the sending lives in the session adapter.
 *
 * Exposes: window.NEXUS_BD_CONSENT
 */
const ConsentMachine = (() => {
    'use strict';

    /**
     * Every source a grant can cover. Present in full from the first batch on purpose: the
     * plan has three consumers arriving later, and adding one should be a registration
     * rather than surgery on the machine that gates them.
     */
    const SOURCES = ['screen', 'camera', 'game', 'meeting'];

    /** Human wording for the indicator. A generic "sharing" badge is not an honest one. */
    const LABELS = {
        screen: 'Sharing your screen',
        camera: 'Camera on',
        game: 'Sharing your game',
        meeting: 'Recording this meeting',
    };

    /**
     * Sources that need more than one stream (MS19). `meeting` is the first: recording a call
     * means the screen *and* this microphone, and they come from two different browser
     * dialogs.
     *
     * Registered here rather than special-cased in the consumer, which is what this file's
     * own docstring asks for — a consumer that assembled its own second stream would be a
     * second place capture can start, and the whole point of the machine is that there is
     * one. It also means one revoke stops both, in the same tick, by the same epoch bump.
     */
    const COMPOUND = { meeting: ['screen', 'mic'] };

    const STATES = ['idle', 'requesting', 'active', 'denied'];

    class Grant {
        constructor(machine, source, stream) {
            this.id = `grant_${source}_${machine._issued++}`;
            this.source = source;
            /**
             * Every stream this grant covers. One for most sources; for a compound source it
             * is what each part returned, in the order COMPOUND names them.
             */
            this.streams = Array.isArray(stream) ? stream.filter(Boolean) : [stream].filter(Boolean);
            /** The primary stream — the video one. Unchanged for every existing consumer. */
            this.stream = this.streams[0] || null;
            this.startedAt = machine.now();
            this._machine = machine;
            this._epoch = machine.epoch;
        }

        /**
         * The one question every capture path asks, and it is a plain synchronous read of a
         * number. No event, no promise, no listener that might not have run yet.
         */
        get live() {
            return this._machine.epoch === this._epoch && this._machine.state === 'active';
        }

        get label() {
            return LABELS[this.source] || 'Sharing';
        }

        revoke(reason = 'grant') {
            return this._machine.revoke(reason);
        }
    }

    class Machine {
        /**
         * @param {object} [deps]
         * @param {object} [deps.media]  navigator.mediaDevices, injectable for tests
         * @param {object} [deps.config] behavior.config.json
         */
        constructor({ media, config = {}, now = () => Date.now() } = {}) {
            this.media = media || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
            this.config = config;
            this.now = now;

            this.state = 'idle';
            this.source = null;
            this.grant = null;
            this.reason = '';

            /**
             * Bumped on every revoke. A grant compares against it, so invalidation is a
             * single integer write rather than a walk over anything that might be missed.
             */
            this.epoch = 1;
            this._issued = 1;
            this._listeners = [];
            this._trackWatch = null;
        }

        /** Subscribe to state changes. Returns an unsubscribe. */
        onChange(handler) {
            if (typeof handler !== 'function') return () => {};
            this._listeners.push(handler);
            handler(this.snapshot());
            return () => {
                const i = this._listeners.indexOf(handler);
                if (i >= 0) this._listeners.splice(i, 1);
            };
        }

        snapshot() {
            return {
                state: this.state,
                source: this.source,
                label: this.grant ? this.grant.label : '',
                since: this.grant ? this.grant.startedAt : 0,
                reason: this.reason,
                epoch: this.epoch,
            };
        }

        _announce() {
            const snapshot = this.snapshot();
            for (const handler of this._listeners.slice()) {
                try {
                    handler(snapshot);
                } catch (error) {
                    console.warn('[BD] a consent listener threw', error);
                }
            }
        }

        /**
         * Ask for a source. The browser's own permission dialog is the consent; this wraps
         * it so the app has a state it can revoke instantly and an indicator it can trust.
         *
         * Resolves to a grant, or to `null` if the user said no — a refusal is an answer,
         * not an exception, and every caller here treats it as one.
         */
        async request(source, { constraints } = {}) {
            if (!SOURCES.includes(source)) {
                this.reason = `unknown source ${source}`;
                return null;
            }
            if (this.state === 'requesting') return null; // one dialog at a time
            if (this.state === 'active') this.revoke('replaced');

            if (!this.media) return this._denied('no media devices on this platform');

            this.state = 'requesting';
            this.source = source;
            this.reason = '';
            this._announce();

            let stream;
            try {
                stream = await this._acquire(source, constraints);
            } catch (error) {
                // NotAllowedError is the user clicking "no". Everything else is a device or
                // platform problem. Neither is a crash, and neither leaves capture running.
                return this._denied((error && error.name) === 'NotAllowedError' ? 'declined' : String(error));
            }
            if (!stream) return this._denied('no stream');

            this.grant = new Grant(this, source, stream);
            this.state = 'active';
            this._watchTracks(stream);
            this._announce();
            return this.grant;
        }

        /**
         * The only place in the engine that names these two APIs. The test that proves it
         * reads every other engine file looking for them.
         */
        async _acquire(source, constraints) {
            const parts = COMPOUND[source];
            if (parts) {
                // In order, and the screen first: it is the dialog the user is most likely to
                // cancel, and somebody who declines it should not already have granted a
                // microphone they now have no use for. A cancelled first part aborts the rest.
                const streams = [];
                for (const part of parts) {
                    const stream = await this._acquireOne(part, constraints);
                    if (!stream) return null;
                    streams.push(stream);
                }
                return streams;
            }
            return this._acquireOne(source, constraints);
        }

        _acquireOne(source, constraints) {
            if (source === 'camera') {
                return this.media.getUserMedia({ video: constraints || { facingMode: 'environment' }, audio: false });
            }
            if (source === 'mic') {
                // Echo cancellation and noise suppression on: this microphone is in the room
                // with the speakers playing the other side of the call, and without them the
                // transcript of this side is the other side, twice.
                return this.media.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                    video: false,
                });
            }
            // screen and game are both display capture; they differ in what the indicator
            // says and in which consumer registered them, not in how they are acquired.
            //
            // `audio: true` asks for the call's own sound, which Chrome grants on a tab share
            // and silently omits everywhere else. Asking costs nothing where it is refused,
            // and where it is granted it is the other half of the conversation.
            return this.media.getDisplayMedia({ video: constraints || true, audio: true });
        }

        _denied(reason) {
            this.state = 'denied';
            this.reason = reason;
            this.grant = null;
            this._announce();
            return null;
        }

        /**
         * The user can also stop sharing from the browser's own bar, and when they do the
         * track ends without telling us. An indicator that kept saying "sharing your screen"
         * after that would be worse than no indicator at all.
         */
        _watchTracks(stream) {
            const streams = Array.isArray(stream) ? stream : [stream];
            const tracks = streams.flatMap((s) => (s && s.getTracks && s.getTracks()) || []);
            const onEnded = () => this.revoke('ended by the browser');
            for (const track of tracks) {
                if (typeof track.addEventListener === 'function') track.addEventListener('ended', onEnded);
                else track.onended = onEnded;
            }
            this._trackWatch = { tracks, onEnded };
        }

        /**
         * Stop. Synchronous, and complete before it returns: the epoch moves first, so any
         * sampler that resumes after its next await already sees a dead grant.
         */
        revoke(reason = 'revoked') {
            if (this.state !== 'active' && this.state !== 'requesting') return false;

            this.epoch++; // first, and before anything that can yield
            const grant = this.grant;
            this.state = 'idle';
            this.grant = null;
            this.source = null;
            this.reason = reason;

            if (this._trackWatch) {
                for (const track of this._trackWatch.tracks) {
                    if (typeof track.removeEventListener === 'function') {
                        track.removeEventListener('ended', this._trackWatch.onEnded);
                    }
                    try {
                        track.stop();
                    } catch (error) {
                        console.warn('[BD] a media track refused to stop', error);
                    }
                }
                this._trackWatch = null;
            }
            if (grant) grant.stream = null;

            this._announce();
            return true;
        }

        get active() {
            return this.state === 'active';
        }
    }

    return { Machine, Grant, SOURCES, LABELS, STATES };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CONSENT = ConsentMachine;
if (typeof module !== 'undefined' && module.exports) module.exports = ConsentMachine;
