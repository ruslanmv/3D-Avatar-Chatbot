/**
 * focus — body doubling (spec v1.1 §6.16, batch B22).
 *
 * Somebody else working in the room. That is the whole feature, and it is the cheapest proof
 * that the "quietly alive" profile from §6.7 actually works: twenty-five minutes in which she
 * is present, visibly breathing, occasionally mirroring you — and says nothing at all.
 *
 * ## The silence is structural, not disciplined
 *
 * "Zero spoken lines inside a focus block" is not enforced by this module remembering not to
 * speak. It is enforced by there being no speech path here at all — a test greps the file —
 * and, more importantly, by what the block does to the profile.
 *
 * On entering a focus block it installs an overlay with `initiative.budgetPerSession: 0` and
 * an empty `commentaryOpenings`. B12's `CommentaryGate` checks the budget **before** it
 * checks openings and before it checks attention, so with the overlay in force every path
 * through `may()` returns false. That is the same mechanism meditation uses (§6.11), reused
 * rather than reimplemented, and the acceptance test drives a real gate through a real
 * twenty-five minutes rather than asserting a flag.
 *
 * The corollary is uncomfortable and correct: **she will not start a block she cannot be
 * quiet in.** If the overlay function is missing, `start()` refuses with a reason rather
 * than running a focus session with the ordinary profile in force.
 *
 * ## What she does instead of talking
 *
 * She mirrors, from signals the engine already produces. You go still for a while — `user:idle`
 * — and she settles too; you come back — `user:active` — and she nods. Those are *intents*,
 * which is to say gestures the KB chooses a clip for; they are not speech and they do not
 * pass through the gate. There is a minute's cooldown on them, because a companion who
 * mirrors every twitch is a mime.
 *
 * ## The streak is memory, not a scoreboard
 *
 * A completed block sends one `streak` frame up the session, which HomePilot writes as a
 * `focus_streak` row in the persona's existing long-term memory. Client-side there is no
 * count of record: this module reports what it did this session and the server owns what it
 * means. §6.16 calls this the first place the user sees her memory, and that only works if
 * it is the same memory as everything else she remembers.
 *
 * Exposes: window.NEXUS_BD_FOCUS
 */
const FocusActivity = (() => {
    'use strict';

    /** The classic pomodoro. Configurable, but these are the defaults the tests drive. */
    const FOCUS_MS = 25 * 60 * 1000;
    const BREAK_MS = 5 * 60 * 1000;
    const LONG_BREAK_MS = 15 * 60 * 1000;
    const BLOCKS_BEFORE_LONG_BREAK = 4;

    /**
     * The overlay in force during a focus block.
     *
     * `budgetPerSession: 0` is the load-bearing field — see the header. The rest is posture:
     * she is in the room with you rather than watching you, so her attention rests on you
     * loosely and she looks over rarely.
     */
    const QUIET_OVERLAY = {
        idleProfile: 'relaxed-attentive',
        commentaryOpenings: [],
        initiative: { budgetPerSession: 0, minGapMs: Number.MAX_SAFE_INTEGER },
        attention: { primary: 'user', glanceUserEveryMs: [20000, 45000] },
    };

    /**
     * What she mirrors with. Intent *names* from the protocol whitelist — the KB picks the
     * clip, per §6.4, and this file names no animation.
     */
    const MIRROR = { settle: 'breathe', refocus: 'nod_along' };

    /** Gentle. A mirror is company, not a performance. */
    const MIRROR_INTENSITY = 0.3;

    /** She mirrors at most this often. Without it she is a mime. */
    const MIRROR_MIN_GAP_MS = 60000;

    /** The phases. `idle` means no session is running at all. */
    const PHASES = ['idle', 'focus', 'break'];

    /** The activity name the streak is filed under, matching the server's `ACTIVITIES`. */
    const STREAK_ACTIVITY = 'focus';

    class Focus {
        constructor({ bus, blackboard, gate, session, derive, config = {}, now = () => Date.now() } = {}) {
            this.id = 'focus';
            this.label = 'Focus together';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.gate = gate || null;
            this.session = session || null;
            this.now = now;

            // B14 wrote and tested the overlay semantics; a second merger here would be a
            // second answer to "what does an overlay do to `initiative`". `undefined` means
            // "find it yourself"; an explicit `null` means "there isn't one", which is the
            // case `start()` refuses. Same idiom as the renderer's `three`.
            this._derive =
                derive === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_JOURNEY && window.NEXUS_BD_JOURNEY.derive) ||
                      null
                    : derive;

            const timings = config.focus || {};
            this.focusMs = timings.focusMs || FOCUS_MS;
            this.breakMs = timings.breakMs || BREAK_MS;
            this.longBreakMs = timings.longBreakMs || LONG_BREAK_MS;
            this.blocksBeforeLongBreak = timings.blocksBeforeLongBreak || BLOCKS_BEFORE_LONG_BREAK;

            this.phase = 'idle';
            this.phaseStartedAt = null;
            this.blocks = 0;
            this.snapshot = null;
            /** Null, not 0 — an event at timestamp zero is a real event, and `0` is falsy.
             *  The same sentinel mistake has been made four times in this engine now. */
            this.lastMirrorAt = null;
            this.mirrors = 0;
            this.wasIdle = false;
            this.sent = [];
            this._unsubscribes = [];
        }

        get name() {
            return 'Focus';
        }

        get running() {
            return this.phase !== 'idle';
        }

        /** True exactly when she must be silent. Read by the tests and by the HUD. */
        get inBlock() {
            return this.phase === 'focus';
        }

        // ── the session ──────────────────────────────────────────────────────

        /**
         * Begin. Refuses rather than starting a block it cannot keep quiet.
         *
         * @returns {{ok: boolean, why?: string}}
         */
        start(at = this.now()) {
            if (this.running) return { ok: false, why: 'already running' };
            if (typeof this._derive !== 'function') {
                // See the header. A focus block with the ordinary profile in force is a
                // companion who chats at you for twenty-five minutes, which is worse than
                // no feature at all.
                return { ok: false, why: 'no profile overlay available — refusing to start' };
            }
            this._listen();
            this._enter('focus', at);
            return { ok: true, why: 'focus' };
        }

        /** End, from wherever we are. The profile goes back exactly as it was found. */
        stop(why = 'user', at = this.now()) {
            if (!this.running) return false;
            const from = this.phase;
            this._restoreSnapshot();
            this.phase = 'idle';
            this.phaseStartedAt = null;
            for (const stop of this._unsubscribes.splice(0)) stop();
            this._announce(from, 'idle', why, at);
            return true;
        }

        /**
         * Called from the render loop. The only thing that happens on a tick is a phase
         * boundary — nothing is said, at a boundary or anywhere else.
         */
        update(at = this.now()) {
            if (!this.running || this.phaseStartedAt === null) return null;
            const elapsed = at - this.phaseStartedAt;
            if (elapsed < this._lengthOf(this.phase)) return null;

            if (this.phase === 'focus') {
                this.blocks++;
                // The block is what earns the streak, so it is sent at the boundary rather
                // than at `stop` — a session abandoned mid-break still did the work.
                this._sendStreak();
                this._enter('break', at);
                return { from: 'focus', to: 'break', block: this.blocks };
            }
            this._enter('focus', at);
            return { from: 'break', to: 'focus', block: this.blocks };
        }

        _lengthOf(phase) {
            if (phase === 'focus') return this.focusMs;
            const long = this.blocks > 0 && this.blocks % this.blocksBeforeLongBreak === 0;
            return long ? this.longBreakMs : this.breakMs;
        }

        _enter(phase, at) {
            const from = this.phase;
            this.phase = phase;
            this.phaseStartedAt = at;
            if (phase === 'focus') this._applyOverlay();
            else this._restoreSnapshot();
            this._announce(from, phase, 'elapsed', at);
        }

        _announce(from, to, why, at) {
            if (!this.bus) return;
            // One typed event carrying the phase, following B14's `scene:anchor`: the bus
            // vocabulary stays closed, so a typo is still caught.
            this.bus.emit('focus:phase', { from, to, why, block: this.blocks, at });
        }

        // ── the overlay ──────────────────────────────────────────────────────

        _applyOverlay() {
            // Entering a break restores, so today nothing applies the overlay twice without
            // a restore between and this guard cannot fire from the phase machine. It is
            // here for the phase somebody adds later: without it a second apply would
            // snapshot the *derived* profile as the thing to restore, and she would never
            // speak again after the first block. Exercised directly by a test, because a
            // guard nothing reaches is a guard nothing protects.
            if (this.snapshot) return null;
            const base = this.blackboard ? this.blackboard.mode : null;
            this.snapshot = { mode: base, gateProfile: this.gate ? this.gate.profile : undefined };
            const derived = this._derive(base, QUIET_OVERLAY);
            if (this.blackboard) this.blackboard.mode = derived;
            if (this.gate) this.gate.setProfile(derived);
            return derived;
        }

        _restoreSnapshot() {
            if (!this.snapshot) return;
            // By reference, like §6.11: restoring an equal copy passes a deep-equality test
            // and is still the bug.
            if (this.blackboard) this.blackboard.mode = this.snapshot.mode;
            if (this.gate && this.snapshot.gateProfile !== undefined) {
                this.gate.setProfile(this.snapshot.gateProfile);
            }
            this.snapshot = null;
        }

        // ── mirroring ────────────────────────────────────────────────────────

        _listen() {
            if (!this.bus) return;
            this._unsubscribes.push(
                this.bus.on('user:idle', () => this._mirror('settle')),
                this.bus.on('user:active', () => this._mirror('refocus'))
            );
        }

        /**
         * A gesture, not a line. Only inside a focus block — during a break she is on the
         * ordinary profile and the engine's own idle behaviour has it.
         */
        _mirror(kind, at = this.now()) {
            if (!this.inBlock) return null;
            const name = MIRROR[kind];
            if (!name) return null;
            if (kind === 'refocus' && !this.wasIdle) return null;
            if (this.lastMirrorAt !== null && at - this.lastMirrorAt < MIRROR_MIN_GAP_MS) return null;

            this.wasIdle = kind === 'settle';
            this.lastMirrorAt = at;
            this.mirrors++;
            if (this.bus) this.bus.emit('intent', { name, intensity: MIRROR_INTENSITY, source: 'focus' });
            return name;
        }

        // ── the streak ───────────────────────────────────────────────────────

        /**
         * One frame up the session per completed block. There is no client-side count of
         * record: the server owns what a streak means, and this reports only what happened.
         */
        _sendStreak() {
            const frame = { v: 1, type: 'streak', activity: STREAK_ACTIVITY, value: 1 };
            this.sent.push(frame);
            if (this.session && typeof this.session.send === 'function') {
                try {
                    this.session.send(frame);
                } catch (error) {
                    // A dropped streak is not worth a broken focus session.
                    console.warn('[BD] the streak did not go up', error);
                }
            }
            return frame;
        }

        detach() {
            this.stop('detached');
        }

        get stats() {
            return {
                phase: this.phase,
                blocks: this.blocks,
                mirrors: this.mirrors,
                quiet: Boolean(this.snapshot),
                sent: this.sent.length,
            };
        }
    }

    function attach(deps) {
        return new Focus(deps);
    }

    return {
        attach,
        Focus,
        QUIET_OVERLAY,
        MIRROR,
        MIRROR_INTENSITY,
        MIRROR_MIN_GAP_MS,
        PHASES,
        FOCUS_MS,
        BREAK_MS,
        LONG_BREAK_MS,
        BLOCKS_BEFORE_LONG_BREAK,
        STREAK_ACTIVITY,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_FOCUS = FocusActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = FocusActivity;
