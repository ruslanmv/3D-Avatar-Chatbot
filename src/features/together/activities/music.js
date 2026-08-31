/**
 * music — Listen Together (spec v1.1 §6.7, batch B13).
 *
 * Sound in, a groove out. Three parts, and the interesting one is the third.
 *
 *   `BeatDetector` — spectral flux in the bass band against its own rolling history.
 *   `EnergyDrift`  — the track's loudness, pushed onto the blackboard.
 *   `Activity`     — decides *when* she dances, and never *what*.
 *
 * ## She dances to what the KB chooses
 *
 * There is not a single clip id in this file, and a test reads the source to keep it that
 * way. When a beat streak says the music is worth moving to, this emits an `intent` named
 * `dance` on the bus and stops. Tier 1 does the rest: the selector narrows to clips that
 * declare that intent, and the ranker picks among them using — among other terms —
 * `1 - |clip.energy - blackboard.energy|`. Which is why "she grooves in time" needs no
 * special mechanism: the same energy this file pushes onto the blackboard is what makes a
 * loud track pull an energetic dance and a quiet one pull a sway. Thirty-one clips declare
 * `dance`; naming one here would throw the other thirty away and would go stale the first
 * time the KB was re-harvested.
 *
 * ## Silence must never leave a dance running
 *
 * Two independent mechanisms, because this is the failure that would be most obvious and
 * most embarrassing:
 *
 *   1. **A watchdog.** Beats stop arriving → after `SILENCE_MS` the scheduler is stopped.
 *      Fast, and it does not wait for anything to decay.
 *   2. **Energy decay.** The blackboard already eases energy back toward rest on its own
 *      (`MOOD_DECAY_TAU`), so once this stops pushing, energy falls without a second decay
 *      implementation here. A stale `bb.energy` would also keep pulling energetic clips
 *      long after the music stopped, which is the quieter version of the same bug.
 *
 * `media:paused` and `stop()` both go through the same path, so there is one way a dance
 * ends rather than three.
 *
 * Exposes: window.NEXUS_BD_MUSIC
 */
const MusicActivity = (() => {
    'use strict';

    /**
     * Onset detection reads the bass. Kick drums live under ~200 Hz, and with the default
     * 1024-point FFT at 44.1 kHz each bin is ~43 Hz, so the first five bins is the band.
     * Using the whole spectrum makes vocals and cymbals count as beats.
     */
    const BASS_BINS = 5;

    /** ~1 s of history at a 60 Hz poll. The comparison window for "louder than usual". */
    const HISTORY = 60;

    /**
     * How far above the local mean counts as an onset. Scaled by the variance of the
     * history, so a track that is uniformly loud does not read as a continuous beat and a
     * quiet passage can still register its own beats.
     */
    const SENSITIVITY = 1.35;

    /** 240 BPM. Faster than this is a buzz, not a beat, and is usually one kick ringing. */
    const MIN_BEAT_GAP_MS = 250;

    /** Beats this consistent, in a row, before she starts moving. */
    const STREAK = 4;

    /** Consecutive intervals within this ratio count as the same tempo. */
    const TEMPO_TOLERANCE = 0.28;

    /** No beat for this long and the music has stopped, whatever the last energy said. */
    const SILENCE_MS = 1600;

    /** Do not ask for a new dance more often than this, however long the track is. */
    const DANCE_GAP_MS = 20000;

    /** Smoothing for the loudness the blackboard sees. Fast up, slow down: a track's
     *  first chorus should land, and its last note should not snap to silence. */
    const RISE = 0.35;
    const FALL = 0.08;

    // ── beats ────────────────────────────────────────────────────────────────

    /**
     * Spectral-flux onset detection against a rolling history — the standard approach, and
     * the reason it is standard is that a fixed threshold cannot work across tracks.
     */
    class BeatDetector {
        constructor({ analyser, bins = BASS_BINS, sensitivity = SENSITIVITY, now = () => Date.now() } = {}) {
            this.analyser = analyser || null;
            this.bins = bins;
            this.sensitivity = sensitivity;
            this.now = now;

            this.history = [];
            this.lastBeatAt = null;
            this.intervals = [];
            this.beats = 0;
            this.streak = 0;
            this._spectrum = null;
        }

        /** Instantaneous bass energy, 0..1. Null when there is no analyser to read. */
        level() {
            const analyser = this.analyser;
            if (!analyser || typeof analyser.getByteFrequencyData !== 'function') return null;
            const size = analyser.frequencyBinCount || (analyser.fftSize ? analyser.fftSize / 2 : 512);
            if (!this._spectrum || this._spectrum.length !== size) this._spectrum = new Uint8Array(size);
            analyser.getByteFrequencyData(this._spectrum);

            const count = Math.min(this.bins, size);
            let sum = 0;
            for (let i = 0; i < count; i++) sum += this._spectrum[i];
            return sum / count / 255;
        }

        /**
         * One poll. Returns `{level, beat, bpm}` or null when there is nothing to read.
         *
         * The history is updated whether or not a beat fired, so a passage that gets
         * steadily louder raises its own bar rather than firing on every sample.
         */
        sample(at = this.now()) {
            const level = this.level();
            if (level === null) return null;

            const mean = this.history.length ? this.history.reduce((a, b) => a + b, 0) / this.history.length : level;
            const variance = this.history.length
                ? this.history.reduce((a, b) => a + (b - mean) * (b - mean), 0) / this.history.length
                : 0;

            this.history.push(level);
            if (this.history.length > HISTORY) this.history.shift();

            // A full history is needed before the mean means anything, and a near-silent
            // band should not produce beats out of its own rounding noise.
            const ready = this.history.length >= Math.min(HISTORY, 16);
            const threshold = mean * this.sensitivity + Math.sqrt(variance);
            const loudEnough = level > 0.04;
            const tooSoon = this.lastBeatAt !== null && at - this.lastBeatAt < MIN_BEAT_GAP_MS;

            if (!ready || !loudEnough || tooSoon || level <= threshold) {
                return { level, beat: false, bpm: this.bpm };
            }

            if (this.lastBeatAt !== null) {
                const interval = at - this.lastBeatAt;
                const last = this.intervals[this.intervals.length - 1];
                // A streak is consistency, not just repetition: four beats a random
                // distance apart is a noisy room, not a tempo.
                this.streak = last && Math.abs(interval - last) / last <= TEMPO_TOLERANCE ? this.streak + 1 : 1;
                this.intervals.push(interval);
                if (this.intervals.length > 8) this.intervals.shift();
            } else {
                this.streak = 1;
            }

            this.lastBeatAt = at;
            this.beats++;
            return { level, beat: true, bpm: this.bpm };
        }

        /** Median of the recent intervals, as BPM. Median, because one dropped beat
         *  doubles an interval and would drag a mean halfway to nonsense. */
        get bpm() {
            if (this.intervals.length < 2) return null;
            const sorted = [...this.intervals].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            return median > 0 ? Math.round(60000 / median) : null;
        }

        /** How long a beat lasts at the current tempo. The watchdog and the "in time"
         *  claim are both expressed in these rather than in milliseconds. */
        get beatPeriodMs() {
            const bpm = this.bpm;
            return bpm ? 60000 / bpm : null;
        }

        reset() {
            this.history.length = 0;
            this.intervals.length = 0;
            this.lastBeatAt = null;
            this.streak = 0;
        }
    }

    // ── energy ───────────────────────────────────────────────────────────────

    /**
     * The track's loudness as a mood. Pushes; never decays. Decay is the blackboard's job
     * (§4A, `MOOD_DECAY_TAU`), and a second decay here would fight it — the classic bug
     * where two systems ease the same number and the result eases at neither rate.
     */
    class EnergyDrift {
        constructor({ blackboard, rise = RISE, fall = FALL } = {}) {
            this.blackboard = blackboard;
            this.rise = rise;
            this.fall = fall;
            this.smoothed = 0;
            this.peak = 0;
        }

        /** @param {number} level 0..1 */
        push(level) {
            if (!Number.isFinite(level)) return this.smoothed;
            const k = level > this.smoothed ? this.rise : this.fall;
            this.smoothed += (level - this.smoothed) * k;
            this.peak = Math.max(this.peak, this.smoothed);

            if (this.blackboard) {
                // Never *lower* the blackboard here. Pushing down is decay, and decay
                // belongs to the blackboard; this only ever says "there is at least this
                // much going on".
                const energy = Math.min(1, this.smoothed);
                if (energy > this.blackboard.energy) this.blackboard.setMood(undefined, energy);
            }
            return this.smoothed;
        }

        reset() {
            this.smoothed = 0;
            this.peak = 0;
        }
    }

    // ── the activity ─────────────────────────────────────────────────────────

    class Activity {
        constructor({ bus, blackboard, scheduler, analyser, config = {}, now = () => Date.now() } = {}) {
            this.id = 'music';
            this.label = 'Listen together';

            this.bus = bus;
            this.blackboard = blackboard;
            this.scheduler = scheduler || null;
            this.config = config;
            this.now = now;

            this.detector = new BeatDetector({ analyser, now });
            this.drift = new EnergyDrift({ blackboard });

            this.dancing = false;
            this.lastDanceAt = null;
            this.dancesAsked = 0;
            this.stoppedForSilence = 0;
            this.running = false;
            this._unsubscribes = [];
            if (bus) this._listen();
        }

        get name() {
            return 'MusicActivity';
        }

        get analyser() {
            return this.detector.analyser;
        }

        set analyser(value) {
            this.detector.analyser = value;
            this.detector.reset();
        }

        _listen() {
            // A paused track and a silent one end a dance by the same path. One way out.
            this._unsubscribes.push(this.bus.on('media:paused', () => this._endDance('media paused')));
        }

        start() {
            this.running = true;
            this.detector.reset();
            this.drift.reset();
            if (this.blackboard) this.blackboard.activity = 'music';
            return this;
        }

        /**
         * Called from the render loop. Everything happens here and nothing is scheduled on
         * a timer, so a tab that stops being rendered stops analysing rather than dancing
         * to a track nobody can hear.
         */
        update(at = this.now()) {
            if (!this.running) return null;
            const result = this.detector.sample(at);
            if (!result) return null;

            this.drift.push(result.level);

            if (result.beat) {
                this.bus.emit('media:beat', { bpm: result.bpm, level: result.level, streak: this.detector.streak });
                this._maybeDance(at, result);
            } else {
                this._maybeSilence(at);
            }
            return result;
        }

        /**
         * The dance decision, and the whole of it. Note what is absent: any name, any id,
         * any call to the scheduler with a clip. It asks for an *intent* and Tier 1 answers.
         */
        _maybeDance(at, result) {
            if (this.detector.streak < STREAK) return null;
            if (this.lastDanceAt !== null && at - this.lastDanceAt < DANCE_GAP_MS) return null;

            this.lastDanceAt = at;
            this.dancesAsked++;
            this.dancing = true;
            // Emitted on the beat, not between beats: the clip starts with the music
            // rather than a random distance into a bar.
            this.bus.emit('intent', {
                name: 'dance',
                intensity: Math.min(1, 0.4 + result.level),
                source: 'music',
                query: `dance to a ${result.bpm || 'steady'} bpm track`,
            });
            return 'dance';
        }

        /** The watchdog. Independent of energy, and deliberately faster than it. */
        _maybeSilence(at) {
            if (!this.dancing) return null;
            const since = this.detector.lastBeatAt === null ? Infinity : at - this.detector.lastBeatAt;
            const limit = this.detector.beatPeriodMs
                ? Math.max(SILENCE_MS, this.detector.beatPeriodMs * 4)
                : SILENCE_MS;
            if (since < limit) return null;

            this.stoppedForSilence++;
            return this._endDance('silence');
        }

        /**
         * The one way a dance ends. `AnimationResolver` owns the rig, so this goes through
         * the scheduler exactly as a normal handover would (§6.6's single-owner rule).
         */
        _endDance(why) {
            if (!this.dancing) return null;
            this.dancing = false;
            this.detector.streak = 0;
            if (this.scheduler && typeof this.scheduler.stop === 'function') this.scheduler.stop();
            return why;
        }

        stop() {
            this._endDance('activity stopped');
            this.running = false;
            this.detector.reset();
            this.drift.reset();
            return this;
        }

        detach() {
            this.stop();
            for (const off of this._unsubscribes.splice(0)) off();
        }

        get stats() {
            return {
                running: this.running,
                dancing: this.dancing,
                beats: this.detector.beats,
                streak: this.detector.streak,
                bpm: this.detector.bpm,
                energy: Math.round(this.drift.smoothed * 1000) / 1000,
                peak: Math.round(this.drift.peak * 1000) / 1000,
                dancesAsked: this.dancesAsked,
                stoppedForSilence: this.stoppedForSilence,
            };
        }
    }

    /**
     * Build an analyser from a media element, if this page has WebAudio.
     *
     * The trap worth naming: `createMediaElementSource` *re-routes* the element's audio
     * into the graph, so failing to connect onward to `destination` silences the track
     * completely. It is the classic way a visualiser ships with no sound.
     */
    function analyserFor(element, { context } = {}) {
        try {
            const Ctx =
                context || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
            if (!Ctx || !element) return null;
            const audio = typeof Ctx === 'function' ? new Ctx() : Ctx;
            const source = audio.createMediaElementSource(element);
            const analyser = audio.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.6;
            source.connect(analyser);
            analyser.connect(audio.destination); // or the track goes silent
            return analyser;
        } catch (error) {
            console.warn('[BD] no audio analysis for this source — beats are off', error);
            return null;
        }
    }

    function attach(deps) {
        return new Activity(deps);
    }

    return {
        attach,
        Activity,
        BeatDetector,
        EnergyDrift,
        analyserFor,
        BASS_BINS,
        HISTORY,
        SENSITIVITY,
        MIN_BEAT_GAP_MS,
        STREAK,
        SILENCE_MS,
        DANCE_GAP_MS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_MUSIC = MusicActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = MusicActivity;
