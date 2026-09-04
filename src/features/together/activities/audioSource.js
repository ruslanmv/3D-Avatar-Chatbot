/**
 * Something for Music to listen to (batch B36).
 *
 * B14 built a beat detector, a drift tracker and a dance scheduler, and shipped a tile that
 * started all three against an `analyser` nothing ever supplied. `Music.start()` set
 * `running = true` and returned; `BeatDetector.sample()` read `this.analyser`, found `null`,
 * and returned `null` forever. The tile worked exactly as written and could not hear a thing.
 *
 * This is the missing half: a local audio file, decoded by the browser's own WebAudio graph,
 * with an `AnalyserNode` the detector can read. It is deliberately the smallest source that
 * makes the feature true rather than the most impressive one — a tab's audio would need a
 * display-capture grant and a very different consent conversation, and "open a file" needs
 * no permission at all.
 *
 * ── Why this is not in music.js ──────────────────────────────────────────────────────────
 *
 * `music.js` has a test that reads its source and fails if it names a clip id; the file is
 * kept deliberately free of anything but beat mathematics. An `AudioContext`, an `<audio>`
 * element and an object URL are none of those things. So the graph lives here and attaches
 * itself to the activity, which keeps `music.js` byte-identical and its tests untouched.
 *
 * Exposes: window.NEXUS_BD_AUDIO_SOURCE
 */
const AudioSource = (() => {
    'use strict';

    /** Matches `BeatDetector`'s default. A smaller FFT loses the bass bins it reads. */
    const FFT_SIZE = 1024;

    function contextClass(win) {
        const scope = win || (typeof window !== 'undefined' ? window : null);
        if (!scope) return null;
        return scope.AudioContext || scope.webkitAudioContext || null;
    }

    /**
     * Whether this browser can do it at all, as a reason rather than a boolean.
     *
     * Checked before the file picker opens: asking somebody to choose a track and then
     * telling them their browser cannot play it is the wrong order for that conversation.
     */
    function availability({ win } = {}) {
        if (!contextClass(win)) return { ok: false, why: 'This browser has no Web Audio support.' };
        return { ok: true, why: '' };
    }

    /**
     * Build the graph. Returns `{analyser, element, stop}` or `{ok:false, why}`.
     *
     * The element is routed to the destination as well as the analyser, because a listener
     * who cannot hear the track has no way to tell whether the beat detection is right — and
     * because "listen together" that plays nothing is not the feature.
     */
    function open(url, { win, doc, name = '' } = {}) {
        const Ctor = contextClass(win);
        if (!Ctor) return { ok: false, why: 'This browser has no Web Audio support.' };
        const document_ = doc || (typeof document !== 'undefined' ? document : null);
        if (!document_) return { ok: false, why: 'No document to play audio in.' };
        if (!url) return { ok: false, why: 'No audio file was chosen.' };

        let context;
        try {
            context = new Ctor();
        } catch (error) {
            return { ok: false, why: String((error && error.message) || error) };
        }

        const element = document_.createElement('audio');
        element.src = url;
        element.crossOrigin = 'anonymous';
        element.loop = false;

        let analyser;
        try {
            const source = context.createMediaElementSource(element);
            analyser = context.createAnalyser();
            analyser.fftSize = FFT_SIZE;
            source.connect(analyser);
            analyser.connect(context.destination);
        } catch (error) {
            try { context.close(); } catch (_) { /* already gone */ }
            return { ok: false, why: String((error && error.message) || error) };
        }

        // A context created outside a gesture starts suspended. The click that chose the
        // file is that gesture, so this resolves — and if it does not, playback simply does
        // not start, which the element's own error path reports.
        const started = Promise.resolve()
            .then(() => (context.state === 'suspended' ? context.resume() : null))
            .then(() => element.play())
            .catch(() => null);

        return {
            ok: true,
            name,
            analyser,
            element,
            started,
            stop() {
                try { element.pause(); } catch (_) { /* nothing playing */ }
                try { element.removeAttribute('src'); element.load(); } catch (_) { /* fine */ }
                // The object URL is ours; leaving it alive holds the whole file in memory
                // for the life of the tab.
                if (typeof URL !== 'undefined' && URL.revokeObjectURL && /^blob:/.test(url)) {
                    try { URL.revokeObjectURL(url); } catch (_) { /* already revoked */ }
                }
                try { context.close(); } catch (_) { /* already closed */ }
                return true;
            },
        };
    }

    /**
     * Give a `Music` activity `attachSource`/`detachSource`, which is what the contract's
     * availability check looks for.
     *
     * Additive in the strictest sense: two methods and a `trackName` are added to an existing
     * object, and nothing on it is replaced. An install without this file has a Music tile
     * that reports honestly that it has no source, rather than one that starts and is deaf.
     */
    function equip(music, { win, doc } = {}) {
        if (!music || typeof music.start !== 'function') return null;
        if (typeof music.attachSource === 'function') return music;

        music.attachSource = function attachSource(url, { name = '' } = {}) {
            this.detachSource('replaced');
            const opened = open(url, { win, doc, name });
            if (!opened.ok) return opened;
            this._audioSource = opened;
            this.trackName = name || '';
            this.analyser = opened.analyser;
            // The detector was constructed with a null analyser and reads it every sample,
            // so handing it one now is all that was ever missing.
            if (this.detector) this.detector.analyser = opened.analyser;
            return { ok: true, why: 'attached' };
        };

        music.detachSource = function detachSource() {
            const opened = this._audioSource;
            if (!opened) return false;
            opened.stop();
            this._audioSource = null;
            this.trackName = '';
            this.analyser = null;
            if (this.detector) this.detector.analyser = null;
            return true;
        };

        return music;
    }

    return { availability, open, equip, FFT_SIZE };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_AUDIO_SOURCE = AudioSource;
if (typeof module !== 'undefined' && module.exports) module.exports = AudioSource;
