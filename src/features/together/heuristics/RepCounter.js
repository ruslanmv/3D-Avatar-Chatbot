/**
 * RepCounter — counting reps from a joint angle (spec v1.1 UC-15, batch B27).
 *
 * One number per frame goes in — a knee angle, an elbow angle, a wrist height — and reps
 * come out. It never sees a landmark, a frame or a camera; `coach.js` reduces a pose to a
 * scalar and hands it over. That separation is what lets the acceptance test drive a
 * recorded set through the counter with no MediaPipe, no WASM and no video decoder.
 *
 * ## Two thresholds, not one
 *
 * The obvious counter fires when the signal crosses a midpoint. It is also useless: a knee
 * hovering at 90° with a degree of tracking noise counts forty reps in three seconds. So a
 * rep is a **round trip through a band**: the signal has to get past `low`, and then past
 * `high`, before anything is counted. Schmitt trigger, one of the oldest ideas in signal
 * processing, and it is the whole algorithm.
 *
 * ## And a refractory period, because people are not oscillators
 *
 * A rep faster than `minRepMs` is a tracking glitch or a bounce, not a repetition. It is
 * counted as *rejected* rather than dropped silently, because a set that reads 8 when the
 * user did 12 needs a reason somewhere.
 *
 * ## What "±1 against ground truth" is really testing
 *
 * Not the arithmetic — the arithmetic is a comparison. It is testing the thresholds against
 * the shapes real sets have: reps that slow down as the set goes on, a pause halfway through,
 * a partial rep that does not reach depth and must **not** count, and the tracking noise a
 * lite pose model produces at 15 fps. The fixture in `tests/fixtures/pose/` contains all
 * four, and its header says exactly what it is and is not.
 *
 * Exposes: window.NEXUS_BD_REP_COUNTER
 */
const RepCounter = (() => {
    'use strict';

    /**
     * Exercises this can count, and the signal each one is counted from.
     *
     * `intent` is what `coach.js` asks the selector for — a name from the KB, never a clip
     * id. `signal` names the reduction `coach.js` performs on the landmarks; this file does
     * not perform it and does not know how.
     *
     * `low`/`high` are in the signal's own units: degrees for a joint angle, normalised
     * frame height for a position. `low` is the *bottom* of the movement, so for a squat it
     * is a small knee angle and for a jumping jack it is a low wrist.
     */
    const EXERCISES = {
        squat: { intent: 'squat', signal: 'kneeAngle', low: 100, high: 160, minRepMs: 700 },
        pushup: { intent: 'pushup', signal: 'elbowAngle', low: 100, high: 155, minRepMs: 600 },
        crunch: { intent: 'crunch', signal: 'hipAngle', low: 115, high: 160, minRepMs: 500 },
        jumping_jacks: { intent: 'jumping_jacks', signal: 'wristHeight', low: 0.35, high: 0.75, minRepMs: 350 },
        lunge: { intent: 'lunge', signal: 'kneeAngle', low: 105, high: 160, minRepMs: 800 },
    };

    /** Where in the round trip we are. `high` is the top of the movement, and the start. */
    const PHASES = ['unknown', 'high', 'low'];

    class Counter {
        /**
         * @param {object} deps
         * @param {string} deps.exercise  a key of `EXERCISES`
         * @param {object} [deps.spec]    an override, for an exercise the table lacks
         */
        constructor({ exercise = 'squat', spec, now = () => Date.now() } = {}) {
            this.exercise = exercise;
            this.spec = spec || EXERCISES[exercise] || null;
            this.now = now;

            this.reps = 0;
            this.phase = 'unknown';
            this.samples = 0;
            /** Null, not 0 — a rep at timestamp zero is a real rep, and `0` is falsy. */
            this.lastRepAt = null;
            this.enteredLowAt = null;
            this.rejected = { tooFast: 0, noSpec: 0 };
            this.history = [];
        }

        get name() {
            return 'RepCounter';
        }

        get ready() {
            return Boolean(this.spec);
        }

        /**
         * One frame's signal value.
         *
         * @returns {{rep: boolean, phase: string, reps: number}|null} — null when there is
         * no spec to count against, which is a configuration answer rather than a rep.
         */
        feed(value, at = this.now()) {
            if (!this.spec) {
                this.rejected.noSpec++;
                return null;
            }
            if (!Number.isFinite(value)) return { rep: false, phase: this.phase, reps: this.reps };

            this.samples++;
            const { low, high } = this.spec;
            let rep = false;

            if (value <= low) {
                // Bottom of the movement. Remembered, not counted: a rep is the *return*.
                if (this.phase !== 'low') this.enteredLowAt = at;
                this.phase = 'low';
            } else if (value >= high) {
                if (this.phase === 'low') {
                    // A round trip. The only place `reps` is ever incremented.
                    const took = this.enteredLowAt === null ? Infinity : at - this.enteredLowAt;
                    if (took >= this.spec.minRepMs) {
                        this.reps++;
                        this.lastRepAt = at;
                        this.history.push({ at, took });
                        rep = true;
                    } else {
                        // A bounce or a tracking glitch. Counted as rejected, because a set
                        // that reads 8 when they did 12 needs a reason somewhere.
                        this.rejected.tooFast++;
                    }
                }
                this.phase = 'high';
                this.enteredLowAt = null;
            }
            // Between the thresholds nothing changes. That band is the whole point: a knee
            // hovering at 90° with a degree of noise would otherwise count forty reps in
            // three seconds.

            return { rep, phase: this.phase, reps: this.reps };
        }

        reset() {
            this.reps = 0;
            this.phase = 'unknown';
            this.samples = 0;
            this.lastRepAt = null;
            this.enteredLowAt = null;
            this.history = [];
            return this;
        }

        /** Median rep duration this set, or null. Median: one long pause is not the tempo. */
        get tempoMs() {
            if (!this.history.length) return null;
            const sorted = this.history.map((h) => h.took).sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length / 2)];
        }

        get stats() {
            return {
                exercise: this.exercise,
                reps: this.reps,
                phase: this.phase,
                samples: this.samples,
                tempoMs: this.tempoMs,
                rejected: { ...this.rejected },
            };
        }
    }

    function attach(deps) {
        return new Counter(deps);
    }

    return { attach, Counter, EXERCISES, PHASES };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_REP_COUNTER = RepCounter;
if (typeof module !== 'undefined' && module.exports) module.exports = RepCounter;
