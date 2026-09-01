/**
 * ContextBlackboard — what the Director knows right now (spec v1.1 §4A).
 *
 * Mood, energy, mode, timers and flags. Every tier reads it; only adapters write to it.
 * It holds no history and makes no decisions — the ranker reads `valence`/`energy` to match
 * a clip to the moment, and the profiles read the gates.
 *
 * The one rule worth stating: mood **decays toward neutral**. A companion who stays furious
 * because you said one sharp thing four minutes ago is not reading the room, so valence and
 * energy ease back to their resting values on their own, and an adapter has to keep saying
 * something for the mood to hold.
 *
 * Exposes: window.NEXUS_BD_BLACKBOARD
 */
const ContextBlackboard = (() => {
    'use strict';

    /** Seconds for a mood excursion to fall to ~37% of its distance from rest. */
    const MOOD_DECAY_TAU = 25;

    class Blackboard {
        constructor({ nsfwAllowed = false, restingEnergy = 0.2 } = {}) {
            this.valence = 0;
            this.energy = restingEnergy;
            this._restingEnergy = restingEnergy;

            this.mode = null;
            this.activity = null;
            this.scene = null;

            /** Attention: 0 = with you, 1 = wholly on the activity. Drives §6.7 etiquette. */
            this.attention = 0;

            this.nsfwAllowed = Boolean(nsfwAllowed);
            this.escalationLevel = 1; // reserved for B29; the ranker reads it from B5 on
            /**
             * §16.1's first gate, and §16.7's first invariant. Written by exactly one
             * thing: `SessionAdapter._on_adult_ack`, on a frame the server produced. There
             * is no setter, no config key and no dialog — a test enumerates every writer in
             * the engine and requires the list to be that one line.
             */
            this.adultVerified = false;

            this.flags = {
                userIdle: false,
                userSpeaking: false,
                ttsSpeaking: false,
                lookingAtAvatar: false,
                sessionUp: false,
            };

            /** Seconds since each named thing last happened. Timers only ever grow here. */
            this.timers = { sinceUserInput: 0, sinceIntent: 0, sinceSpeech: 0, session: 0 };
        }

        /** Nudge the mood. Adapters call this; nothing else should. */
        setMood(valence, energy) {
            if (Number.isFinite(valence)) this.valence = clamp(valence, -1, 1);
            if (Number.isFinite(energy)) this.energy = clamp(energy, 0, 1);
        }

        setFlag(name, value) {
            this.flags[name] = Boolean(value);
        }

        resetTimer(name) {
            this.timers[name] = 0;
        }

        /** Tier 0, every frame. Advances timers and eases the mood back toward rest. */
        tick(dt) {
            if (!Number.isFinite(dt) || dt <= 0) return;
            for (const key of Object.keys(this.timers)) this.timers[key] += dt;

            const k = Math.min(1, dt / MOOD_DECAY_TAU);
            this.valence += (0 - this.valence) * k;
            this.energy += (this._restingEnergy - this.energy) * k;
        }

        /** A plain snapshot, for the debug HUD and for logging a pick's context. */
        snapshot() {
            return {
                valence: round(this.valence),
                energy: round(this.energy),
                mode: this.mode,
                activity: this.activity,
                scene: this.scene,
                attention: round(this.attention),
                nsfwAllowed: this.nsfwAllowed,
                adultVerified: this.adultVerified,
                flags: { ...this.flags },
                timers: Object.fromEntries(Object.entries(this.timers).map(([k2, v]) => [k2, round(v)])),
            };
        }
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function round(value) {
        return Math.round(value * 1000) / 1000;
    }

    return Blackboard;
})();

if (typeof window !== 'undefined') window.NEXUS_BD_BLACKBOARD = ContextBlackboard;
if (typeof module !== 'undefined' && module.exports) module.exports = ContextBlackboard;
