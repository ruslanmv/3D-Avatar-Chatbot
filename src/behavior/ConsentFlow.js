/**
 * ConsentFlow — the escalation state machine (spec v1.1 §16.4, batch B29).
 *
 * The design rules are the deliverable, not the content. This file is the rules.
 *
 * ## Escalation is earned
 *
 * A level advances on exactly two things: an explicit affirmative answer to a check-in she
 * asked, or unmistakable user initiation. Never on a timer, never on inference, never
 * because the conversation "seemed to be going that way". And never before `perLevelMinMs`
 * has passed at the current level — so the fastest possible path from level 1 to level 4 is
 * six minutes of somebody actively saying yes three times.
 *
 * The check-in is not a formality to be got past. `checkIn()` asks and then **waits**: until
 * an answer arrives the flow is `pending`, and a pending flow does not advance no matter
 * what else happens. An ambiguous answer is a *no* for now — it does not advance, and it
 * does not re-ask. That asymmetry is the whole ethic of the file: yes has to be said, no
 * happens by default.
 *
 * ## And reversible, from anywhere, in one tick
 *
 * `soft` — the word `cozy` — drops to level 1 and crossfades to warmth, **with no
 * commentary**. Nobody wants to be asked why. `hard` — `stop` or `exit` — leaves the mode
 * entirely for companion and a neutral idle, also without comment. Both work from any
 * state including mid-check-in, and both are synchronous: §16.7's fifth invariant is "within
 * one scheduler tick", so neither of them awaits anything.
 *
 * ## She never initiates
 *
 * There is no method here that raises a level without an input from the user, and
 * `proactiveNsfw` has no `true` branch anywhere in the codebase. The ranker's source rule is
 * the actual enforcement; this file simply has nothing that could ask for it.
 *
 * ## What it does to the recorder
 *
 * Tears it down on entry, per §16.7's fourth invariant and the profile's
 * `privacy.clipEngine: false`. Not "does not offer to record" — stops the ring buffer and
 * drops it, the way B25 does, because a hidden button leaves thirty seconds of the evening
 * in memory.
 *
 * Exposes: window.NEXUS_BD_CONSENT_FLOW
 */
const ConsentFlow = (() => {
    'use strict';

    /**
     * The local classifier. Deliberately small and deliberately biased: a word not on either
     * list is *not* a yes. §16.4 allows an LLM to be consulted on ambiguity, and the hook is
     * `onAmbiguous`, but the default with no hook is to treat ambiguity as "not now".
     */
    const AFFIRMATIVE = [
        'yes',
        'yeah',
        'yep',
        'sure',
        'please',
        'go on',
        'keep going',
        'i want',
        "i'd like",
        'absolutely',
        'definitely',
        'okay',
        'ok',
    ];

    const NEGATIVE = ['no', 'nope', 'not now', 'later', 'wait', "don't", 'do not', 'hold on', 'stop'];

    /** §16.3's words. Read from the profile at runtime; these are the fallbacks. */
    const SOFT_EXIT = 'cozy';
    const HARD_EXIT = ['stop', 'exit'];

    /** What a classification can be. `unclear` is a first-class answer, not an error. */
    const ANSWERS = ['yes', 'no', 'unclear'];

    /**
     * Classify one utterance. Pure, so the ethic above can be checked directly rather than
     * inferred from behaviour.
     *
     * Negatives are checked **first**: "no, keep going" is a person changing their mind
     * mid-sentence, and reading the affirmative out of it is exactly the failure this whole
     * file exists to prevent.
     */
    function classify(text) {
        const clean = String(text || '')
            .toLowerCase()
            .trim();
        if (!clean) return 'unclear';
        if (NEGATIVE.some((word) => clean.includes(word))) return 'no';
        if (AFFIRMATIVE.some((word) => clean.includes(word))) return 'yes';
        return 'unclear';
    }

    /** Is this the soft-exit word? Whole word, so "cozily" is conversation. */
    function isSoftExit(text, word = SOFT_EXIT) {
        return new RegExp(`\\b${word}\\b`, 'i').test(String(text || ''));
    }

    function isHardExit(text, words = HARD_EXIT) {
        const clean = String(text || '').toLowerCase();
        return words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(clean));
    }

    class Flow {
        constructor({ bus, blackboard, profile, modes, recorder, say, onAmbiguous, now = () => Date.now() } = {}) {
            this.id = 'consent';
            this.label = 'Consent flow';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.modes = modes || null;
            this.recorder = recorder || null;
            this.now = now;
            this._say = say || null;
            this._onAmbiguous = onAmbiguous || null;

            this.profile =
                profile === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_PROFILE_ADULT) || null
                    : profile;

            this.active = false;
            this.level = 1;
            /** Null, not 0 — a level entered at timestamp zero is a real level. */
            this.levelSince = null;
            this.lastInputAt = null;
            /** `{ level, at }` while a check-in is out. A pending flow never advances. */
            this.pending = null;
            this.checkIns = 0;
            this.advances = 0;
            this.declines = 0;
            this.exits = [];
            this._unsubscribes = [];
        }

        get name() {
            return 'ConsentFlow';
        }

        get escalation() {
            return (this.profile && this.profile.escalation) || {};
        }

        get maxLevel() {
            return this.escalation.levels || 4;
        }

        get perLevelMinMs() {
            return this.escalation.perLevelMinMs || 120000;
        }

        /** Has this level been held long enough for the next to be offered? */
        earned(at = this.now()) {
            if (this.levelSince === null) return false;
            return at - this.levelSince >= this.perLevelMinMs;
        }

        // ── entering and leaving ─────────────────────────────────────────────

        /**
         * Enter the tier. Refuses unless the profile's `requires` are satisfied on the
         * blackboard — the second of the two checks, alongside the ranker's.
         */
        enter(at = this.now()) {
            if (this.active) return { ok: false, why: 'already active' };
            if (!this.profile) return { ok: false, why: 'no adult profile available' };

            const missing = (this.profile.requires || []).filter((flag) => !(this.blackboard && this.blackboard[flag]));
            if (missing.length) return { ok: false, why: `not permitted: ${missing.join(', ')}` };

            // §16.7 invariant 4. Stopped and dropped, not hidden: a hidden button leaves
            // thirty seconds of the evening in memory.
            this._tearDownRecorder('adult tier');

            this.active = true;
            this.level = this.escalation.start || 1;
            this.levelSince = at;
            this.lastInputAt = at;
            this.pending = null;
            if (this.blackboard) this.blackboard.escalationLevel = this.level;
            this._listen();
            this._emit('adult:enter', { level: this.level, at });
            return { ok: true, why: 'entered', level: this.level };
        }

        /**
         * Leave. `soft` is level 1 and a crossfade; `hard` leaves the mode entirely. Both
         * are synchronous and both work from any state — §16.7's fifth invariant.
         *
         * Neither says anything about it. Being asked why you wanted to stop is the thing
         * that makes people not say it next time.
         */
        exit(kind = 'hard', at = this.now()) {
            const from = this.level;
            this.pending = null;
            this.exits.push({ kind, from, at });

            if (kind === 'soft') {
                this.level = this.escalation.decayToLevel || 1;
                this.levelSince = at;
                if (this.blackboard) this.blackboard.escalationLevel = this.level;
                this._emit('adult:exit', { kind, from, to: this.level, at });
                return { ok: true, kind, level: this.level };
            }

            this.active = false;
            this.level = 1;
            this.levelSince = null;
            if (this.blackboard) this.blackboard.escalationLevel = 1;
            for (const stop of this._unsubscribes.splice(0)) stop();
            // Companion, neutral idle, no comment.
            if (this.modes && typeof this.modes.activate === 'function') this.modes.activate('companion');
            this._emit('adult:exit', { kind, from, to: 1, at });
            return { ok: true, kind, level: 1 };
        }

        detach() {
            if (this.active) this.exit('hard');
            for (const stop of this._unsubscribes.splice(0)) stop();
        }

        // ── the check-in ─────────────────────────────────────────────────────

        /**
         * Offer the next level. Asks, and then waits — see the header.
         *
         * Returns a refusal with a reason rather than a boolean, because "she did not ask"
         * has three very different causes and a silent no is indistinguishable from a bug.
         */
        checkIn(at = this.now()) {
            if (!this.active) return { ok: false, why: 'not in the tier' };
            if (this.pending) return { ok: false, why: 'already asked' };
            if (this.level >= this.maxLevel) return { ok: false, why: 'at the top already' };
            if (!this.earned(at)) return { ok: false, why: 'this level has not been held long enough' };

            this.pending = { level: this.level + 1, at };
            this.checkIns++;
            this._emit('adult:checkin', { from: this.level, to: this.level + 1, at });
            return { ok: true, why: 'asked', to: this.level + 1 };
        }

        /**
         * An answer, or any other user utterance. The only input this file has.
         *
         * Exits are read **before** anything else, from any state, including mid-check-in:
         * a person saying "stop" while being asked a question is not answering the question.
         */
        hear(text, at = this.now()) {
            const clean = String(text || '').trim();
            if (!clean) return null;
            this.lastInputAt = at;

            if (isHardExit(clean, this.escalation.hardExit || HARD_EXIT)) return this.exit('hard', at);
            if (isSoftExit(clean, this.escalation.softExitWord || SOFT_EXIT)) return this.exit('soft', at);
            if (!this.active) return null;

            if (this.pending) return this._answer(clean, at);
            return { action: 'heard', level: this.level };
        }

        _answer(text, at) {
            let answer = classify(text);
            if (answer === 'unclear' && typeof this._onAmbiguous === 'function') {
                // §16.4's LLM confirmation, as a hook. Anything it returns that is not a
                // clean 'yes' stays a not-now.
                const asked = this._onAmbiguous(text);
                answer = asked === 'yes' ? 'yes' : answer === 'no' ? 'no' : 'unclear';
            }

            const to = this.pending.level;
            this.pending = null;

            if (answer !== 'yes') {
                // Ambiguity is a no for now, and it is not re-asked. Yes has to be said.
                this.declines++;
                this._emit('adult:declined', { level: this.level, answer, at });
                return { action: 'declined', answer, level: this.level };
            }

            return this._advance(to, at, 'checkin');
        }

        /**
         * Unmistakable user initiation — §16.4's second route. The caller decides what
         * counts as unmistakable; this refuses everything the check-in path would refuse,
         * so the second route is never the looser one.
         */
        initiated(at = this.now()) {
            if (!this.active) return { action: 'ignored', why: 'not in the tier' };
            if (this.level >= this.maxLevel) return { action: 'ignored', why: 'at the top already' };
            if (!this.earned(at)) return { action: 'ignored', why: 'this level has not been held long enough' };
            this.lastInputAt = at;
            return this._advance(this.level + 1, at, 'initiated');
        }

        _advance(to, at, why) {
            this.level = Math.max(1, Math.min(this.maxLevel, to));
            this.levelSince = at;
            this.advances++;
            if (this.blackboard) this.blackboard.escalationLevel = this.level;
            this._emit('adult:level', { level: this.level, why, at });
            return { action: 'advanced', level: this.level, why };
        }

        // ── the tick ─────────────────────────────────────────────────────────

        /**
         * Called from the render loop. Decays the level on inactivity, and does nothing
         * else — in particular it never offers, never advances and never speaks. A tier
         * that escalated on a timer would be one that escalated without being asked.
         */
        tick(at = this.now()) {
            if (!this.active || this.lastInputAt === null) return null;
            const after = this.escalation.decayAfterMs || 300000;
            if (this.level <= (this.escalation.decayToLevel || 1)) return null;
            if (at - this.lastInputAt < after) return null;

            const from = this.level;
            this.level = this.escalation.decayToLevel || 1;
            this.levelSince = at;
            this.pending = null;
            if (this.blackboard) this.blackboard.escalationLevel = this.level;
            this._emit('adult:level', { level: this.level, why: 'decayed', at });
            return { action: 'decayed', from, level: this.level };
        }

        // ── plumbing ─────────────────────────────────────────────────────────

        _listen() {
            if (!this.bus) return;
            this._unsubscribes.push(this.bus.on('voice:final', (event) => this.hear(event && event.text)));
        }

        _tearDownRecorder(why) {
            const recorder = this.recorder;
            if (recorder && typeof recorder.stop === 'function') {
                try {
                    recorder.stop(why);
                } catch (error) {
                    console.warn('[BD] the clip recorder refused to stop', error);
                }
            }
        }

        _emit(event, payload) {
            if (this.bus) this.bus.emit(event, payload);
        }

        get stats() {
            return {
                active: this.active,
                level: this.level,
                pending: this.pending ? this.pending.level : null,
                earned: this.earned(),
                checkIns: this.checkIns,
                advances: this.advances,
                declines: this.declines,
                exits: this.exits.length,
            };
        }
    }

    function attach(deps) {
        return new Flow(deps);
    }

    return {
        attach,
        Flow,
        classify,
        isSoftExit,
        isHardExit,
        AFFIRMATIVE,
        NEGATIVE,
        ANSWERS,
        SOFT_EXIT,
        HARD_EXIT,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CONSENT_FLOW = ConsentFlow;
if (typeof module !== 'undefined' && module.exports) module.exports = ConsentFlow;
