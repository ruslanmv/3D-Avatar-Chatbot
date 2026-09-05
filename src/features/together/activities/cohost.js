/**
 * cohost — playing together (spec v1.1 UC-13, batch B23).
 *
 * You play; she watches through the pipeline that already exists and reacts. The whole batch
 * is three files and almost no logic, because everything it needs was built by B7, B11 and
 * B12 — the profile system, the consent-gated media samples, and the mixer that can run a
 * head-only clip without disturbing the body.
 *
 * ## The one rule, and where it lives
 *
 * No full-body reaction while the game has them, except for a macro event. That rule is in
 * `play.profile.mayReact()` and nowhere else. This file asks; it does not decide. The
 * detector asks nothing and only paces itself.
 *
 * The reason to put it there rather than here is that B24's clip engine wants the same
 * moments, and a second consumer with its own copy of the etiquette is how a companion ends
 * up doing a victory dance in one code path and not the other.
 *
 * ## She reacts with intents, not with speech
 *
 * A reaction is a gesture: an intent name from the §6.8 whitelist, ranked and picked by
 * Tier 1 like any other. This file names no clip and speaks no line. Whether a *remark* is
 * worth making at a moment is `CommentaryGate`'s question, and `game:moment` is an opening
 * in the play profile so the ordinary machinery answers it.
 *
 * ## Everything it changes, it puts back
 *
 * The profile overlay is B14's `derive` and B22's snapshot discipline, unchanged: snapshot
 * on start, restore the original object *by reference* on stop.
 *
 * Exposes: window.NEXUS_BD_COHOST
 */
const CoHostActivity = (() => {
    'use strict';

    /** Fields the play profile contributes to whatever mode was active. */
    const OVERLAY_FIELDS = ['idleProfile', 'commentaryOpenings', 'initiative', 'attention', 'allows'];

    class CoHost {
        constructor({ bus, blackboard, gate, media, detector, profile, derive, now = () => Date.now() } = {}) {
            this.id = 'cohost';
            this.label = 'Play together';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.gate = gate || null;
            this.media = media || null;
            this.now = now;

            // `undefined` means "find it yourself"; an explicit `null` means "there isn't
            // one", which `start()` refuses. Same idiom as the renderer's `three`.
            this.profile =
                profile === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_PROFILE_PLAY) || null
                    : profile;

            // `undefined` means "find it yourself"; an explicit `null` means "there isn't
            // one", which `start()` refuses. Same idiom as the renderer's `three`.
            this._derive =
                derive === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_JOURNEY && window.NEXUS_BD_JOURNEY.derive) ||
                      null
                    : derive;

            this.detector =
                detector === undefined
                    ? (typeof window !== 'undefined' &&
                          window.NEXUS_BD_EXCITEMENT &&
                          window.NEXUS_BD_EXCITEMENT.attach({ bus, profile: this.profile, now })) ||
                      null
                    : detector;

            this.running = false;
            this.snapshot = null;
            this.reactions = 0;
            this.refused = 0;
            this.lastReaction = null;
            this._unsubscribes = [];
        }

        get name() {
            return 'CoHost';
        }

        // ── the session ──────────────────────────────────────────────────────

        start(at = this.now()) {
            if (this.running) return { ok: false, why: 'already running' };
            if (typeof this._derive !== 'function') {
                return { ok: false, why: 'no profile overlay available — refusing to start' };
            }
            if (!this.profile || typeof this.profile.mayReact !== 'function') {
                // Without the tier table she has no idea which reactions are rude, and the
                // failure mode is a full-body dance mid-boss. Refuse rather than guess.
                return { ok: false, why: 'no play profile — refusing to start' };
            }

            this._applyOverlay();
            this.running = true;
            if (this.bus) {
                this._unsubscribes.push(this.bus.on('game:moment', (moment) => this.react(moment)));
            }
            return { ok: true, why: 'cohost', at };
        }

        stop(why = 'user') {
            if (!this.running) return false;
            for (const stop of this._unsubscribes.splice(0)) stop();
            this._restoreSnapshot();
            this.running = false;
            return true;
        }

        /**
         * Called from the render loop. Pulls one scalar sample from the media adapter and
         * hands it to the detector — the adapter rate-limits itself, so this is a
         * subtraction on all but four frames a second.
         */
        update(at = this.now()) {
            if (!this.running || !this.detector) return null;
            const sample = this.media && typeof this.media.tick === 'function' ? this.media.tick() : null;
            return sample ? this.detector.feed(sample, at) : null;
        }

        // ── the reaction ─────────────────────────────────────────────────────

        /**
         * One moment. Asks the profile whether it may react, and emits an intent if so.
         *
         * @returns {{allowed: boolean, why: string, intent?: string}}
         */
        react(moment) {
            const kind = moment && moment.kind;
            const attention = (this.blackboard && this.blackboard.attention) || 0;
            const verdict = this.profile.mayReact(kind, attention);

            if (!verdict.allowed) {
                this.refused++;
                return { ...verdict, kind };
            }

            const reaction = this.profile.REACTIONS[kind];
            const tier = this.profile.TIERS[reaction.tier];
            this.reactions++;
            this.lastReaction = { kind, tier: reaction.tier, intent: reaction.intent, at: this.now() };
            if (this.bus) {
                this.bus.emit('intent', {
                    name: reaction.intent,
                    intensity: tier.intensity,
                    source: 'cohost',
                });
            }
            return { ...verdict, kind, intent: reaction.intent, tier: reaction.tier };
        }

        // ── the overlay ──────────────────────────────────────────────────────

        _applyOverlay() {
            if (this.snapshot) return null;
            const base = this.blackboard ? this.blackboard.mode : null;
            this.snapshot = { mode: base, gateProfile: this.gate ? this.gate.profile : undefined };
            const overlay = {};
            for (const field of OVERLAY_FIELDS) {
                if (field in this.profile) overlay[field] = this.profile[field];
            }
            const derived = this._derive(base, overlay);
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

        detach() {
            this.stop('detached');
        }

        get stats() {
            return {
                running: this.running,
                reactions: this.reactions,
                refused: this.refused,
                last: this.lastReaction && this.lastReaction.kind,
                detector: this.detector && this.detector.stats,
            };
        }
    }

    function attach(deps) {
        return new CoHost(deps);
    }

    return { attach, CoHost, OVERLAY_FIELDS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_COHOST = CoHostActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = CoHostActivity;
