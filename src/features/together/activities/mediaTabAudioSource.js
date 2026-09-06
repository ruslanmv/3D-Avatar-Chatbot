/**
 * Dancing to a shared tab (batch D7).
 *
 * Music's beat detector needs an `AnalyserNode` with something in it. A local file gives it
 * one — `audioSource.js` — but a YouTube video published to the conversation cannot: its
 * player is a cross-origin iframe, and `createMediaElementSource` cannot reach across that
 * boundary. That is why D5's Music picker says she will not dance to YouTube.
 *
 * There is one way round it that is not a hack: the *tab* can be shared, and a display grant
 * already carries the tab's audio. `ConsentMachine.request('screen')` asks for
 * `getDisplayMedia({ video, audio: true })` today, and Chrome hands over an audio track when
 * the user picks a tab. So the sound is already in a stream the user explicitly shared — this
 * file just reads it.
 *
 * ## What it does not do
 *
 * **It never asks for the stream.** No `getDisplayMedia` here, no call into the consent
 * machine: it is handed a grant somebody else obtained, or it does nothing. `ConsentMachine`
 * stays the single door, and a standing audit checks that it is.
 *
 * **It never connects to `destination`.** The shared tab is already playing out loud; routing
 * the captured copy to the speakers as well would play everything twice, slightly apart. This
 * graph analyses and stops — which is the one difference from `audioSource.js`, whose element
 * is silent until it is connected.
 *
 * ## Why it is not in music.js
 *
 * Same reason as `audioSource.js`: `music.js` has a test that reads its own source and fails
 * if it names anything but beat mathematics. An `AudioContext` is not beat mathematics.
 *
 * Exposes: window.NEXUS_BD_TAB_AUDIO
 */
const MediaTabAudioSource = (() => {
    'use strict';

    /** Matches `BeatDetector`'s default and `audioSource.js`. A smaller FFT loses the bass. */
    const FFT_SIZE = 1024;

    function contextClass(win) {
        const scope = win || (typeof window !== 'undefined' ? window : null);
        if (!scope) {
            return null;
        }
        return scope.AudioContext || scope.webkitAudioContext || null;
    }

    /**
     * Can this grant be listened to, and if not, why — in words a person can act on.
     *
     * "No audio track" is by far the common case and is not a fault: Chrome only offers to
     * share audio for a tab, the checkbox is off by default, and a whole-screen share has no
     * audio at all on most platforms. Saying which of those happened is the difference
     * between a fixable mistake and a feature that seems broken.
     */
    function availability(grant, { win } = {}) {
        if (!contextClass(win)) {
            return { ok: false, why: 'This browser has no Web Audio support.' };
        }
        const stream = grant && (grant.stream || grant);
        if (!stream || typeof stream.getAudioTracks !== 'function') {
            return { ok: false, why: 'Nothing is being shared to listen to.' };
        }
        if (!stream.getAudioTracks().length) {
            return {
                ok: false,
                why: 'That share has no sound. Re-share the tab with "Share tab audio" ticked.',
            };
        }
        return { ok: true, why: '' };
    }

    /**
     * Build the graph over an existing grant. `{ok, analyser, stop}` or `{ok:false, why}`.
     *
     * The stream is not ours: it belongs to whoever requested the grant, and stopping this
     * source must not stop their video. So `stop()` closes the context and drops the
     * reference — it never touches the tracks.
     */
    function open(grant, { win, name = '' } = {}) {
        const can = availability(grant, { win });
        if (!can.ok) {
            return { ok: false, why: can.why };
        }
        const Ctor = contextClass(win);
        const stream = grant.stream || grant;

        let context;
        try {
            context = new Ctor();
        } catch (error) {
            return { ok: false, why: String((error && error.message) || error) };
        }

        let analyser;
        try {
            const source = context.createMediaStreamSource(stream);
            analyser = context.createAnalyser();
            analyser.fftSize = FFT_SIZE;
            source.connect(analyser);
            // Deliberately not `analyser.connect(context.destination)`. The tab is audible
            // already; a second path to the speakers is an echo, not a feature.
        } catch (error) {
            try {
                context.close();
            } catch (_) {
                /* already gone */
            }
            return { ok: false, why: String((error && error.message) || error) };
        }

        const started = Promise.resolve()
            .then(() => (context.state === 'suspended' ? context.resume() : null))
            .catch(() => null);

        return {
            ok: true,
            name,
            analyser,
            started,
            stop() {
                try {
                    context.close();
                } catch (_) {
                    /* already closed */
                }
                // The tracks belong to the share. Stopping them here would end somebody's
                // video because they turned the dancing off.
            },
        };
    }

    /**
     * Give Music a second way to hear, alongside the file it already has.
     *
     * Written as `attachStream` rather than folded into `attachSource`, so a caller says
     * which kind of source it has and the two cannot be confused. Both go through
     * `detachSource`, which means only one is ever live — the analyser is a single field on
     * the detector, and two sources writing it would be a race nobody could see.
     */
    function equip(music, { win } = {}) {
        if (!music || typeof music.start !== 'function') {
            return null;
        }
        if (typeof music.attachStream === 'function') {
            return music;
        }

        music.attachStream = function attachStream(grant, { name = '' } = {}) {
            if (typeof this.detachSource === 'function') {
                this.detachSource('replaced');
            }
            const opened = open(grant, { win, name });
            if (!opened.ok) {
                return opened;
            }
            this._audioSource = opened;
            this.trackName = name || '';
            this.analyser = opened.analyser;
            if (this.detector) {
                this.detector.analyser = opened.analyser;
            }
            return { ok: true, why: 'attached' };
        };

        return music;
    }

    return { availability, open, equip, FFT_SIZE };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_BD_TAB_AUDIO = MediaTabAudioSource;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaTabAudioSource;
}
