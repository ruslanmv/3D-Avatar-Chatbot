/**
 * meeting — recording the call you are in (MeetingSense batch MS19).
 *
 * The eighth activity in the 👥 launcher, and the smallest, because almost none of it is
 * new. B11 owns the consent and the revoke; B12 owns the capture pipeline; HomePilot's
 * MeetingSense addon owns the audio graph, the segmenter, the socket and the transcript.
 * What this file adds is the join between them, and one rule.
 *
 * ## It cannot obtain a stream
 *
 * The same structural guarantee every other activity here has: there is no `navigator` in
 * this file, no display or user media call, and no canvas. A stream comes from a grant, a
 * grant comes from the consent machine, and `tests/behavior/capture.test.js` proves that by
 * reading the source of every engine file.
 *
 * That is also why the recorder is handed streams rather than left to open its own. It can
 * open its own — that is how it works on the HomePilot page, where there is no launcher and
 * no consent machine — and letting it do so *here* would be a second consent story for the
 * same screen, on a page whose whole design is that there is one.
 *
 * ## Screen and microphone, after the choice and never before
 *
 * A meeting is two sources: the call on the screen and this side of it in the room. Both are
 * asked for by the `meeting` compound source, in that order, once the user has chosen the
 * activity. Nothing is requested when the activity is merely registered or shown in the
 * launcher — the dialog is a consequence of pressing start, not of browsing the list.
 *
 * ## Revoking stops capture inside a frame
 *
 * Not "eventually", and not "after the next await". B11's epoch makes every grant read dead
 * synchronously, and this file's consent listener stops the recorder in the same tick. There
 * is no window in which a revoked grant is still recording, and the test asserts it with no
 * timers at all.
 *
 * Exposes: window.NEXUS_BD_MEETING
 */
const MeetingActivity = (() => {
    'use strict';

    class Meeting {
        constructor({
            bus,
            blackboard,
            consent,
            recorder,
            session,
            config = {},
            now = () => Date.now(),
        } = {}) {
            this.id = 'meeting';
            this.label = 'Record this meeting';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.consent = consent || null;
            // `undefined` means "find it yourself"; an explicit `null` means "there is none",
            // which `start()` refuses. The same idiom the other activities use.
            this.recorder =
                recorder === undefined
                    ? (typeof window !== 'undefined' && window.hpMeetingSense) || null
                    : recorder;
            this.session = session || null;
            this.config = config;
            this.now = now;

            this.grant = null;
            this.meetingId = null;
            this.startedAt = null;
            this.stops = { user: 0, revoked: 0, failed: 0 };
            this._unsubscribes = [];
            if (this.consent) this._unsubscribes.push(this.consent.onChange((s) => this._onConsent(s)));
        }

        get name() {
            return 'Meeting';
        }

        get recording() {
            return Boolean(this.grant && this.grant.live && this.meetingId);
        }

        /**
         * Ask for the screen and the microphone, then record.
         *
         * @returns {Promise<{ok, meetingId?, error?}>} — a refusal is an answer, not an
         * exception, exactly as `consent.request` treats one.
         */
        async start(options = {}) {
            if (this.recording) return { ok: false, error: 'already recording' };
            if (!this.consent) return { ok: false, error: 'no consent machine' };
            if (!this.recorder) return { ok: false, error: 'the meeting recorder is not loaded' };
            if (!options.conversationId) return { ok: false, error: 'conversationId is required' };

            // One request, two dialogs, in the order B11's COMPOUND names them. Declining
            // either leaves nothing granted and nothing recording.
            const grant = await this.consent.request('meeting');
            if (!grant) return { ok: false, error: this.consent.reason || 'declined' };

            const [screen, mic] = grant.streams;
            let result;
            try {
                result = await this.recorder.startWithStreams(
                    { screen, mic },
                    { ...options, source: options.source || 'together' },
                );
            } catch (error) {
                this.stops.failed++;
                this.consent.revoke('recorder failed');
                return { ok: false, error: String((error && error.message) || error) };
            }

            if (!result || !result.ok) {
                // The grant is released rather than left open: a recording indicator over a
                // recorder that never started is the worst thing this activity could show.
                this.consent.revoke('recorder refused');
                this.stops.failed++;
                return result || { ok: false, error: 'the recorder refused' };
            }

            this.grant = grant;
            this.meetingId = result.meetingId || null;
            this.startedAt = this.now();
            if (this.session) this.session.sendUserEvent('capture:start');
            this._announce('start');
            return { ok: true, meetingId: this.meetingId, audioMode: result.audioMode };
        }

        /**
         * Stop deliberately. Revoking is what actually releases the screen.
         *
         * Synchronous, and complete before it returns, for the same reason `revoke` is: a
         * stop that resolves a promise later leaves a window in which the indicator is off
         * and the capture is on. What the recorder does with its socket afterwards is the
         * recorder's business — see `_halt`.
         */
        stop(why = 'user') {
            if (!this.meetingId && !this.grant) return { ok: false, error: 'not recording' };
            this.stops[why === 'user' ? 'user' : 'revoked']++;
            const id = this.meetingId;
            this._halt();
            // Released **before** the revoke, not after: revoking fires this activity's own
            // consent listener, and a listener that still sees a grant announces a second
            // stop and counts a revocation that was really a deliberate stop. The order is
            // the whole difference between one event and two.
            this.grant = null;
            if (this.consent && this.consent.state === 'active') this.consent.revoke(why);
            if (this.session) this.session.sendUserEvent('capture:stop');
            this._announce('stop', why);
            return { ok: true, meetingId: id };
        }

        _announce(phase, why) {
            if (!this.bus) return;
            this.bus.emit('meeting:phase', { phase, meetingId: this.meetingId, why: why || null });
        }

        /**
         * A revoke from anywhere — the browser's own bar, the panel, another activity taking
         * the screen — lands here, and the recorder is stopped **synchronously**.
         *
         * `stop()` on the recorder returns a promise, and awaiting it here would leave a
         * revoked grant recording for however long that promise takes. So the promise is
         * dropped on the floor deliberately: the capture is torn down inside this call, and
         * whatever the socket does afterwards is the socket's business.
         */
        _onConsent(state) {
            if (state.state === 'active') return;
            if (!this.grant && !this.meetingId) return;
            this.stops.revoked++;
            const id = this.meetingId;
            this._halt();
            this.grant = null;
            if (this.bus) {
                this.bus.emit('meeting:phase', { phase: 'stop', meetingId: id, why: 'revoked' });
            }
        }

        _halt() {
            const id = this.meetingId;
            this.meetingId = null;
            this.startedAt = null;
            if (!id || !this.recorder || typeof this.recorder.stop !== 'function') return null;
            try {
                // Not awaited — see `_onConsent`. A revoke that waits on a network round trip
                // is a revoke that did not happen yet.
                const pending = this.recorder.stop();
                if (pending && typeof pending.catch === 'function') {
                    pending.catch((error) => console.warn('[BD] the meeting did not stop cleanly', error));
                }
                return pending;
            } catch (error) {
                console.warn('[BD] the meeting did not stop cleanly', error);
                return null;
            }
        }

        /** Mute this side only; the call keeps recording. Straight through to the recorder. */
        muteMic(muted) {
            if (!this.recorder || typeof this.recorder.muteMic !== 'function') return false;
            return this.recorder.muteMic(Boolean(muted));
        }

        detach() {
            this.stop('detached');
            for (const off of this._unsubscribes.splice(0)) off();
        }

        get stats() {
            return {
                recording: this.recording,
                meetingId: this.meetingId,
                startedAt: this.startedAt,
                stops: { ...this.stops },
            };
        }
    }

    function attach(deps) {
        return new Meeting(deps);
    }

    return { attach, Meeting };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_MEETING = MeetingActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = MeetingActivity;
