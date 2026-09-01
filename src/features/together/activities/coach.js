/**
 * coach — reps, form and practice (spec v1.1 UC-15, batch B27).
 *
 * The heaviest activity in the pack, and the one most likely to break §9's frame budget, so
 * almost every decision here is about giving frame time back.
 *
 * ## Pose joins the loader that is already there
 *
 * `FaceTracker` and `HandTracker` both load MediaPipe tasks-vision 0.10.14, and both cache
 * the module on `window.__MEDIAPIPE_VISION__` and the fileset on `window.__MEDIAPIPE_FILESET__`
 * precisely so the second one to start pays nothing. `PoseLandmarker` is the third, and it
 * reads those caches before it reaches for the network — a test asserts that a warm cache
 * produces no import at all. A second copy of a 2 MB WASM runtime is not a performance
 * problem, it is a bug with a download attached.
 *
 * Throttled to 15–20 fps like its siblings, from the same mobile/desktop pair of intervals.
 * Pose at 60 fps would be perfectly useless: a squat takes two seconds and nobody's knee
 * moves meaningfully in 16 ms.
 *
 * ## Fidgets pause, through the gate that already exists
 *
 * While Pose is running she stops fidgeting — and not by a new suppression flag. The coach
 * installs a profile overlay whose `allows(clip)` declines idle-class clips, and §6.5's
 * single enforcement point in `UtilityRanker` does the rest. One gate, the same one, with
 * one more mode narrowing it.
 *
 * That is worth being pedantic about: a second mechanism for "do not play this now" is how
 * two of them end up disagreeing, and the one that loses is always the one a reviewer did
 * not know about.
 *
 * ## The demo clip is chosen by intent, never by name
 *
 * `demo()` emits an intent whose name comes from `RepCounter.EXERCISES` — `squat`,
 * `jumping_jacks` — and Tier 1 picks the clip. This file contains no clip id and no
 * filename, asserted by a test.
 *
 * And when the KB has nothing for an exercise, she **says so**. There is no squat, push-up
 * or plank asset in this repository; playing a jog and calling it a squat would be a
 * demonstration of the wrong movement, which is worse than no demonstration in the one
 * activity where the user is copying what they see.
 *
 * Exposes: window.NEXUS_BD_COACH
 */
const CoachActivity = (() => {
    'use strict';

    /** The version `FaceTracker` and `HandTracker` already load. Kept in step deliberately. */
    const MEDIAPIPE_VERSION = '0.10.14';
    const MEDIAPIPE_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
    const MEDIAPIPE_CDN = `${MEDIAPIPE_MODULE}/wasm`;
    const POSE_MODEL =
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker.task';

    /** 20 fps and 15 fps. The plan's band, and the same shape as the two trackers'. */
    const DESKTOP_DETECT_INTERVAL_MS = 50;
    const MOBILE_DETECT_INTERVAL_MS = 66;

    /** MediaPipe's own landmark indices. Named, because 25 is not a leg. */
    const LM = {
        leftShoulder: 11,
        rightShoulder: 12,
        leftElbow: 13,
        rightElbow: 14,
        leftWrist: 15,
        rightWrist: 16,
        leftHip: 23,
        rightHip: 24,
        leftKnee: 25,
        rightKnee: 26,
        leftAnkle: 27,
        rightAnkle: 28,
    };

    /**
     * How each signal is reduced from landmarks. `RepCounter` names the signal and knows
     * nothing about how it is produced; this is the other half of that split.
     */
    const SIGNALS = {
        kneeAngle: (p) =>
            meanAngle(p, [LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightHip, LM.rightKnee, LM.rightAnkle]),
        elbowAngle: (p) =>
            meanAngle(
                p,
                [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
                [LM.rightShoulder, LM.rightElbow, LM.rightWrist]
            ),
        hipAngle: (p) =>
            meanAngle(p, [LM.leftShoulder, LM.leftHip, LM.leftKnee], [LM.rightShoulder, LM.rightHip, LM.rightKnee]),
        // Wrist height in frame, inverted so "up" is a larger number like every other signal.
        wristHeight: (p) => {
            const left = p[LM.leftWrist];
            const right = p[LM.rightWrist];
            if (!left || !right) return NaN;
            return 1 - (left.y + right.y) / 2;
        },
    };

    /** Clips the coach declines while Pose is running. Idle-class work, by priority. */
    const FIDGET_MAX_PRIORITY = 2;

    /** She counts out loud on the way up, and marks the set at the end. */
    const CALL_EVERY = 1;

    /** Interior angle at `b`, in degrees. NaN when a landmark is missing or degenerate. */
    function angle(a, b, c) {
        if (!a || !b || !c) return NaN;
        const abx = a.x - b.x;
        const aby = a.y - b.y;
        const cbx = c.x - b.x;
        const cby = c.y - b.y;
        const dot = abx * cbx + aby * cby;
        const magnitude = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
        if (!magnitude) return NaN;
        return (Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180) / Math.PI;
    }

    /** Both sides, averaged. One occluded knee should not stop a set. */
    function meanAngle(points, left, right) {
        const a = angle(points[left[0]], points[left[1]], points[left[2]]);
        const b = angle(points[right[0]], points[right[1]], points[right[2]]);
        if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
        return Number.isFinite(a) ? a : b;
    }

    /**
     * The profile overlay in force while Pose is running.
     *
     * `allows` is the whole of it. Not a new flag, not a scheduler mode: §6.5's single
     * enforcement point already asks the mode whether a clip may play, and this is one more
     * mode narrowing it.
     */
    const COACH_OVERLAY = {
        idleProfile: 'relaxed-attentive',
        commentaryOpenings: ['coach:rep', 'coach:set_end'],
        initiative: { budgetPerSession: 3, minGapMs: 30000 },
        attention: { primary: 'user', glanceUserEveryMs: [4000, 9000] },
        allows(clip) {
            // A fidget while somebody is copying your movement is a distraction with a
            // frame cost attached. The demo clip is priority 3 and passes.
            const priority = (clip && clip.priority) || 0;
            return priority > FIDGET_MAX_PRIORITY;
        },
    };

    class Coach {
        constructor({
            bus,
            blackboard,
            insight,
            registry,
            counters,
            gate,
            derive,
            say,
            video,
            importer,
            now = () => Date.now(),
            isMobile,
        } = {}) {
            this.id = 'coach';
            this.label = 'Coach';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.insight = insight || null;
            this.registry = registry || null;
            this.gate = gate || null;
            this.now = now;
            this._video = video || null;
            this._isMobile = isMobile || defaultIsMobile;
            this._import = importer === undefined ? defaultImport : importer;
            this._say = say === undefined ? defaultSay : say;

            this._counters =
                counters === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_REP_COUNTER) || null
                    : counters;
            this._derive =
                derive === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_JOURNEY && window.NEXUS_BD_JOURNEY.derive) ||
                      null
                    : derive;

            this.running = false;
            this.exercise = null;
            this.counter = null;
            this.landmarker = null;
            this.snapshot = null;
            this.sets = [];
            this.detections = 0;
            /** Null, not 0 — a detection at timestamp zero is a real one. */
            this.lastDetectAt = null;
            this.lastError = null;
        }

        get name() {
            return 'Coach';
        }

        get reps() {
            return this.counter ? this.counter.reps : 0;
        }

        get intervalMs() {
            return this._isMobile() ? MOBILE_DETECT_INTERVAL_MS : DESKTOP_DETECT_INTERVAL_MS;
        }

        // ── the loader ───────────────────────────────────────────────────────

        /**
         * The tasks-vision module, from the cache the other two trackers fill.
         *
         * Returns `{ vision, cached }` so a test can assert the warm path imports nothing —
         * a second copy of a 2 MB WASM runtime is a bug with a download attached.
         */
        async _vision() {
            const global_ = typeof window !== 'undefined' ? window : {};
            if (global_.__MEDIAPIPE_VISION__) return { vision: global_.__MEDIAPIPE_VISION__, cached: true };
            if (!this._import) throw new Error('no MediaPipe importer');
            const vision = await this._import(MEDIAPIPE_MODULE);
            global_.__MEDIAPIPE_VISION__ = vision;
            return { vision, cached: false };
        }

        async _loadLandmarker() {
            if (this.landmarker) return this.landmarker;
            const { vision } = await this._vision();
            const global_ = typeof window !== 'undefined' ? window : {};
            // Reuse FaceTracker's fileset when it is there, exactly as HandTracker does.
            const fileset =
                global_.__MEDIAPIPE_FILESET__ || (await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_CDN));
            global_.__MEDIAPIPE_FILESET__ = fileset;

            this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
                numPoses: 1,
                runningMode: 'VIDEO',
            });
            return this.landmarker;
        }

        // ── lifecycle ────────────────────────────────────────────────────────

        /**
         * Start a set. The camera comes through B11 by way of B26's route — this file has
         * no other way to one, so the consent indicator appears because consent happened.
         */
        async start(exercise = 'squat') {
            if (this.running) return { ok: false, why: 'already running' };
            if (!this._counters) return { ok: false, why: 'no rep counter available' };
            if (typeof this._derive !== 'function') {
                return { ok: false, why: 'no profile overlay available — refusing to start' };
            }
            const spec = this._counters.EXERCISES[exercise];
            if (!spec) return { ok: false, why: `I do not know how to count ${exercise}` };
            if (!this.insight) return { ok: false, why: 'no vision activity available' };

            const started = await this.insight.start('camera');
            if (!started) return { ok: false, why: 'camera consent was declined' };

            try {
                await this._loadLandmarker();
            } catch (error) {
                this.lastError = error;
                this.insight.stop('pose unavailable');
                return { ok: false, why: 'pose tracking is unavailable on this device' };
            }

            this.exercise = exercise;
            this.counter = this._counters.attach({ exercise, now: this.now });
            this._applyOverlay();
            this.running = true;
            if (this.bus) this.bus.emit('coach:set_start', { exercise, at: this.now() });
            return { ok: true, why: exercise, spec };
        }

        stop(why = 'user') {
            if (!this.running) return false;
            const set = {
                exercise: this.exercise,
                reps: this.reps,
                tempoMs: this.counter && this.counter.tempoMs,
                at: this.now(),
                why,
            };
            this.sets.push(set);
            this._restoreSnapshot();
            this.running = false;
            if (this.insight) this.insight.stop(why);
            if (this.bus) this.bus.emit('coach:set_end', set);
            this._speak(set.reps ? `${set.reps}. Nice set.` : 'Set ended.');
            this.counter = null;
            this.exercise = null;
            return true;
        }

        detach() {
            this.stop('detached');
            if (this.landmarker && typeof this.landmarker.close === 'function') {
                try {
                    this.landmarker.close();
                } catch (error) {
                    console.warn('[BD] the pose landmarker refused to close', error);
                }
            }
            this.landmarker = null;
        }

        // ── the detection ────────────────────────────────────────────────────

        /**
         * Called from the render loop, and rate-limited to `intervalMs` internally — so
         * calling it every frame costs one subtraction on all but fifteen to twenty of them.
         * Pose at 60 fps would be perfectly useless: nobody's knee moves meaningfully in
         * 16 ms.
         */
        tick(at = this.now()) {
            if (!this.running || !this.landmarker) return null;
            if (this.lastDetectAt !== null && at - this.lastDetectAt < this.intervalMs) return null;
            const video = this._videoElement();
            if (!video || video.readyState < 2) return null;

            this.lastDetectAt = at;
            let result;
            try {
                result = this.landmarker.detectForVideo(video, at);
            } catch (error) {
                if (!this.lastError) console.warn('[BD] pose detection failed', error);
                this.lastError = error;
                return null;
            }
            this.detections++;
            return this.observe(result, at);
        }

        /**
         * One detection. Split from `tick` so the acceptance test can drive a recorded set
         * through it with no MediaPipe, no WASM and no video decoder.
         */
        observe(result, at = this.now()) {
            const points = (result && result.landmarks && result.landmarks[0]) || null;
            if (!points || !this.counter) return null;
            const reduce = SIGNALS[this.counter.spec.signal];
            if (!reduce) return null;
            return this.feed(reduce(points), at);
        }

        /** The scalar path. `RepCounter` never sees a landmark; this is where that ends. */
        feed(value, at = this.now()) {
            if (!this.counter) return null;
            const result = this.counter.feed(value, at);
            if (result && result.rep) {
                if (this.bus) this.bus.emit('coach:rep', { exercise: this.exercise, reps: result.reps, at });
                if (result.reps % CALL_EVERY === 0) this._speak(String(result.reps));
            }
            return result;
        }

        // ── the demo ─────────────────────────────────────────────────────────

        /**
         * Show them the movement. By **intent**, never by name — this file holds no clip id
         * and no filename, and Tier 1 does the choosing.
         *
         * @returns {{ok: boolean, why: string, intent?: string}}
         */
        demo(exercise = this.exercise) {
            if (!this._counters) return { ok: false, why: 'no rep counter available' };
            const spec = this._counters.EXERCISES[exercise];
            if (!spec) return { ok: false, why: `I do not know ${exercise}` };

            // Ask the KB whether it has anything, rather than emitting an intent into the
            // dark. Playing a jog and calling it a squat is a demonstration of the wrong
            // movement, in the one activity where the user is copying what they see.
            const available = this.registry ? this.registry.forIntent(spec.intent) : null;
            if (this.registry && (!available || !available.length)) {
                this._speak(`I do not have a clip for ${exercise.replace(/_/g, ' ')} yet.`);
                return { ok: false, why: 'no clip for that exercise', intent: spec.intent };
            }

            if (this.bus) this.bus.emit('intent', { name: spec.intent, intensity: 0.7, source: 'coach' });
            return { ok: true, why: 'demonstrating', intent: spec.intent };
        }

        // ── the overlay ──────────────────────────────────────────────────────

        _applyOverlay() {
            if (this.snapshot) return null;
            const base = this.blackboard ? this.blackboard.mode : null;
            this.snapshot = { mode: base, gateProfile: this.gate ? this.gate.profile : undefined };
            const derived = this._derive(base, COACH_OVERLAY);
            if (this.blackboard) this.blackboard.mode = derived;
            if (this.gate) this.gate.setProfile(derived);
            return derived;
        }

        _restoreSnapshot() {
            if (!this.snapshot) return;
            // By reference, like §6.11: an equal copy passes a deep-equality test and is
            // still the bug.
            if (this.blackboard) this.blackboard.mode = this.snapshot.mode;
            if (this.gate && this.snapshot.gateProfile !== undefined) {
                this.gate.setProfile(this.snapshot.gateProfile);
            }
            this.snapshot = null;
        }

        _videoElement() {
            if (this._video) return this._video;
            if (typeof document === 'undefined') return null;
            this._video = document.querySelector('video[data-nexus-camera]') || document.querySelector('video');
            return this._video;
        }

        _speak(text) {
            if (typeof this._say === 'function') this._say(text, { source: 'coach' });
        }

        get stats() {
            return {
                running: this.running,
                exercise: this.exercise,
                reps: this.reps,
                tempoMs: this.counter && this.counter.tempoMs,
                detections: this.detections,
                intervalMs: this.intervalMs,
                sets: this.sets.length,
                pose: Boolean(this.landmarker),
                error: this.lastError ? String(this.lastError.message || this.lastError) : null,
            };
        }
    }

    function defaultIsMobile() {
        try {
            return /Android|iPhone|iPad|Mobile|Quest/i.test(navigator.userAgent);
        } catch {
            return false;
        }
    }

    function defaultImport(url) {
        return import(/* webpackIgnore: true */ url);
    }

    function defaultSay(text, options) {
        try {
            const say = typeof window !== 'undefined' ? window.NEXUS_BD_SAY : null;
            if (typeof say === 'function') say(text, options);
        } catch (error) {
            console.warn('[BD] the coach could not speak', error);
        }
    }

    function attach(deps) {
        return new Coach(deps);
    }

    return {
        attach,
        Coach,
        angle,
        meanAngle,
        SIGNALS,
        LM,
        COACH_OVERLAY,
        MEDIAPIPE_VERSION,
        MEDIAPIPE_MODULE,
        MEDIAPIPE_CDN,
        POSE_MODEL,
        DESKTOP_DETECT_INTERVAL_MS,
        MOBILE_DETECT_INTERVAL_MS,
        FIDGET_MAX_PRIORITY,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_COACH = CoachActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = CoachActivity;
