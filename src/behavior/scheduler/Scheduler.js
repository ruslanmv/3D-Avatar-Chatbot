/**
 * Scheduler — who is playing, and who is allowed to take over (spec v1.1 §4A, §5.P4).
 *
 * Priority preemption, interruptibility, a queue, and the crossfade weights the mixer
 * animates. Reaction beats Talk beats Emote beats Idle, and a clip that has just started
 * gets its minimum play time before anything of equal rank can push it aside.
 *
 * ## The single-owner rule
 *
 * The rig must have exactly one owner. This app already has an owner —
 * `AnimationResolver` — and it routes clip-first with a procedural fallback. The engine
 * does **not** become a second one: every request the scheduler approves is handed to the
 * resolver, so `NEXUS_MOTION`, the Pose Studio and the Behavior Director all queue behind
 * the same door. Two owners is how a dance and a gesture end up fighting over the hips,
 * and it is the failure §5.P4 names.
 *
 * Exposes: window.NEXUS_BD_SCHEDULER
 */
const Scheduler = (() => {
    'use strict';

    const Rules =
        (typeof window !== 'undefined' && window.NEXUS_BD_TRANSITIONS) ||
        (typeof require === 'function' ? require('./TransitionRules.js') : null);

    class ClipScheduler {
        /**
         * @param {object} deps
         * @param {object} deps.mixer       LayerMixer, whose layer weights this animates
         * @param {object} [deps.bus]       for anim:started / anim:ended
         * @param {object} [deps.resolver]  window.NEXUS_ANIMATION_RESOLVER — the one owner
         * @param {object} [deps.antiRepeat]
         * @param {function} [deps.now]
         */
        constructor({ mixer, bus, resolver, antiRepeat, slots = ['clipA', 'clipB'], now = () => Date.now() } = {}) {
            this.mixer = mixer;
            this.bus = bus;
            this.resolver = resolver;
            this.antiRepeat = antiRepeat;
            this.now = now;

            /**
             * Two clip slots, ping-ponged on every handover.
             *
             * One slot cannot crossfade: fading a single layer from 0 to 1 blends the
             * incoming clip against the *base pose*, not against the clip it is replacing,
             * so the outgoing pose vanishes in one frame. The pop detector measured that as
             * a 2.16 rad jump. With two slots the outgoing clip stays at full weight
             * underneath while the incoming ramps up above it, and the mixer's per-bone
             * slerp is then exactly the crossfade.
             */
            this.slots = slots;
            this.activeSlot = 0;

            this.current = null; // {clip, layer, startedAt, fadeSeconds, elapsed}
            this.previous = null;
            this.queue = [];
            this.rejected = [];
        }

        /** The mixer layer the current clip should be rendered into. */
        get currentSlotName() {
            return this.slots[this.activeSlot];
        }

        get previousSlotName() {
            return this.slots[1 - this.activeSlot];
        }

        /**
         * Ask to play a clip. Returns what happened, so a caller (and a test) can tell a
         * refusal from a queueing from a takeover.
         *
         * @returns {{accepted: boolean, reason: string, queued?: boolean}}
         */
        request(clip, intent = {}) {
            if (!clip) return { accepted: false, reason: 'no clip' };

            const playedMs = this.current ? this.now() - this.current.startedAt : 0;
            const verdict = Rules.canInterrupt(this.current && this.current.clip, clip, playedMs);

            if (!verdict.allowed) {
                // Higher-priority work waits its turn rather than being dropped; equal or
                // lower work is refused outright, so the queue cannot grow without bound.
                if (clip.priority >= (this.current ? this.current.clip.priority : 0)) {
                    this.queue.push({ clip, intent });
                    return { accepted: false, queued: true, reason: verdict.why };
                }
                this.rejected.push({ id: clip.id, why: verdict.why });
                return { accepted: false, reason: verdict.why };
            }

            this._start(clip, intent);
            return { accepted: true, reason: 'playing' };
        }

        _start(clip, intent) {
            const previous = this.current;
            const fade = Rules.fadeSeconds(previous && previous.clip, clip);

            if (previous) {
                previous.fadeSeconds = fade;
                previous.fadeElapsed = 0;
                previous.slot = this.currentSlotName;
                if (this.bus) this.bus.emit('anim:ended', { id: previous.clip.id, layer: previous.clip.layer });
                // The incoming clip takes the other slot, and sits above the outgoing one.
                this.activeSlot = 1 - this.activeSlot;
            }

            this.current = {
                clip,
                intent,
                startedAt: this.now(),
                fadeSeconds: fade,
                elapsed: 0,
                weight: previous ? 0 : 1, // a first clip is already there; a takeover fades in
                slot: this.currentSlotName,
            };
            this.previous = previous || null;
            this._stack();

            // The single-owner rule: the engine never writes the rig directly.
            if (this.resolver && typeof this.resolver.play === 'function') {
                try {
                    this.resolver.play(clip.id, { fade, source: 'behavior-director', record: clip });
                } catch (error) {
                    console.warn('[BD] AnimationResolver refused the clip', error);
                }
            }

            if (this.antiRepeat) this.antiRepeat.remember(clip.id, this.now());
            if (this.bus) this.bus.emit('anim:started', { id: clip.id, layer: clip.layer });
        }

        /** Tier 0. Advances the crossfade and hands the weights to the mixer. */
        tick(dt) {
            if (!Number.isFinite(dt) || dt <= 0) return;

            if (this.current) {
                this.current.elapsed += dt;
                const fade = this.current.fadeSeconds || 0;
                this.current.weight = fade > 0 ? Math.min(1, this.current.elapsed / fade) : 1;
                this._setSlotWeight(this.current.slot, this.current.weight);
            }

            if (this.previous) {
                // The outgoing clip holds full weight underneath for the whole fade: the
                // blend is done by the incoming layer's weight, not by lowering this one.
                // Dropping both together would dip through the base pose in the middle.
                const fade = this.previous.fadeSeconds || 0;
                this.previous.fadeElapsed += dt;
                if (fade <= 0 || this.previous.fadeElapsed >= fade) {
                    this._setSlotWeight(this.previous.slot, 0);
                    this.previous = null;
                } else {
                    this._setSlotWeight(this.previous.slot, 1);
                }
            }

            // A finished clip lets the queue through.
            if (this.current && this.current.clip.loop === false) {
                const duration = (this.current.clip.stats && this.current.clip.stats.duration) || 0;
                if (duration > 0 && this.current.elapsed >= duration) this._finish();
            }
        }

        _setSlotWeight(slotName, weight) {
            if (!this.mixer || !slotName) return;
            const layer = this.mixer.getLayer(slotName);
            if (layer) layer.weight = weight;
        }

        /** Keep the incoming slot above the outgoing one, so the slerp goes the right way. */
        _stack() {
            if (!this.mixer) return;
            const incoming = this.mixer.getLayer(this.currentSlotName);
            const outgoing = this.mixer.getLayer(this.previousSlotName);
            if (incoming && outgoing) {
                const base = Math.min(incoming.order, outgoing.order);
                outgoing.order = base;
                incoming.order = base + 0.5;
                this.mixer.layers.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
            }
        }

        _finish() {
            const finished = this.current;
            this.current = null;
            if (this.bus) this.bus.emit('anim:ended', { id: finished.clip.id, layer: finished.clip.layer });

            const next = this.queue.shift();
            if (next) this._start(next.clip, next.intent);
        }

        /** Stop everything. The resolver is told, because it owns the rig. */
        stop() {
            this.queue.length = 0;
            if (this.current && this.resolver && typeof this.resolver.stop === 'function') {
                try {
                    this.resolver.stop();
                } catch (error) {
                    console.warn('[BD] AnimationResolver.stop threw', error);
                }
            }
            if (this.current && this.bus) {
                this.bus.emit('anim:ended', { id: this.current.clip.id, layer: this.current.clip.layer });
            }
            this._setSlotWeight(this.currentSlotName, 0);
            this._setSlotWeight(this.previousSlotName, 0);
            this.current = null;
            this.previous = null;
        }

        get state() {
            return {
                playing: this.current ? this.current.clip.id : null,
                weight: this.current ? Math.round(this.current.weight * 100) / 100 : 0,
                queued: this.queue.map((entry) => entry.clip.id),
            };
        }
    }

    return { ClipScheduler };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SCHEDULER = Scheduler;
if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;
