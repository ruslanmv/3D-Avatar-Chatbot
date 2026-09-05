/**
 * ExcitementDetector — guessing when something happened, from a number (batch B23, §6.7/UC-13).
 *
 * There is no game API. There will not be one for most games, ever. So the co-host infers
 * moments from what it can already legitimately see: how loud the last second was, and how
 * much the picture just changed. Both come in as *scalars* — this file never touches a pixel
 * and never touches an audio buffer.
 *
 * ## It reads numbers because that is what makes it safe
 *
 * `MediaAdapter.sample()` already produces `{luma, rms, lumaJump, rmsJump}` from a 32×18
 * draw, and it is already gated on B11's consent for a shared source. Feeding this detector
 * from those samples means:
 *
 *   * there is no second pixel reader to gate, and no second place a frame could be
 *     retained. A test greps this file for `drawImage`, `getImageData`, `toDataURL`,
 *     `getByteFrequencyData` and the rest, because "it cannot capture" is worth more as a
 *     property of the source than as a promise in a comment;
 *   * a real game hook can replace the heuristic later without touching the co-host: it
 *     calls `mark('win')` and the same events come out the same door.
 *
 * ## What it can and cannot claim
 *
 * A spike in loudness with a flash of light means *something big happened*. It does not mean
 * you won. A win and a total defeat look and sound almost identical to a detector this
 * cheap, so the top tier it will ever infer is `surge`, and `surge` is deliberately not a
 * macro *event* — see `play.profile.js`. She does not do a victory dance because the screen
 * went white.
 *
 * `win` and `loss` come only from `mark()`, which is what a real hook calls.
 *
 * ## Pacing is a property of the detector, not of its consumer
 *
 * "Never more than one macro per thirty seconds" is enforced here, at the point moments are
 * produced, rather than in the co-host. A second consumer — the clip engine in B24 wants the
 * same moments — must not be able to see a macro storm the reaction path was shielded from,
 * or the two would disagree about what happened.
 *
 * Exposes: window.NEXUS_BD_EXCITEMENT
 */
const ExcitementDetector = (() => {
    'use strict';

    /** ~4 s of history at MediaAdapter's 4 Hz sampling. The "louder than usual" window. */
    const HISTORY = 16;

    /** Samples before the baseline means anything. Below this nothing fires. */
    const WARMUP = 8;

    /** How many standard deviations above the mean counts as a spike. */
    const SENSITIVITY = 2.0;

    /** Below this the room is quiet and the arithmetic above is measuring noise. */
    const RMS_FLOOR = 0.05;

    /** A picture change this big is a flash: an explosion, a hit marker, a screen wipe. */
    const FLASH_DELTA = 0.18;

    /** Consecutive loud-and-bright samples that add up to something big. */
    const SURGE_RUN = 3;

    /** §UC-13's pacing rule, and the acceptance criterion. One macro per thirty seconds. */
    const MACRO_COOLDOWN_MS = 30000;

    /** Micro moments are cheap but not free; two a second would be a twitch. */
    const MICRO_COOLDOWN_MS = 2000;

    /** And the middle tier sits between the two. */
    const MEDIUM_COOLDOWN_MS = 8000;

    const COOLDOWNS = { micro: MICRO_COOLDOWN_MS, medium: MEDIUM_COOLDOWN_MS, macro: MACRO_COOLDOWN_MS };

    /** Everything this detector will ever infer on its own. `win`/`loss` are not here. */
    const INFERRED = ['hit', 'near_death', 'surge'];

    class Detector {
        constructor({ bus, profile, now = () => Date.now() } = {}) {
            this.bus = bus || null;
            // `undefined` means "find it yourself"; an explicit `null` means "there isn't
            // one", and without the tier table nothing can be classified at all.
            this.profile =
                profile === undefined
                    ? (typeof window !== 'undefined' && window.NEXUS_BD_PROFILE_PLAY) || null
                    : profile;
            this.now = now;

            this.loudness = [];
            this.flashes = [];
            this.run = 0;
            this.samples = 0;
            this.emitted = 0;
            /** Null, not 0 — a moment at timestamp zero is a real moment, and `0` is falsy.
             *  Fifth time in this engine; it is written down in `focus.js` too. */
            this.lastAt = { micro: null, medium: null, macro: null };
            this.counts = { hit: 0, near_death: 0, surge: 0, win: 0, loss: 0 };
            this.suppressed = { micro: 0, medium: 0, macro: 0 };
        }

        get name() {
            return 'ExcitementDetector';
        }

        // ── the heuristic ────────────────────────────────────────────────────

        /**
         * One scalar sample from `MediaAdapter`. Returns the moment it produced, or null.
         *
         * @param {{rms:number, lumaJump:number}} sample
         */
        feed(sample, at = this.now()) {
            if (!sample) return null;
            const rms = Number.isFinite(sample.rms) ? sample.rms : null;
            const flash = Number.isFinite(sample.lumaJump) ? sample.lumaJump : 0;
            if (rms === null) return null;

            this.samples++;
            // Both baselines are read *before* this sample joins them, so a sample is
            // compared against what came before rather than against itself.
            const loud = this._baseline(this.loudness);
            const flashy = this._baseline(this.flashes);
            this._remember(this.loudness, rms);
            this._remember(this.flashes, flash);

            if (this.samples < WARMUP) return null;

            // The same shape twice: a floor, so the arithmetic is not measuring noise, and
            // a statistical test, so "notable" means notable *for this game*. Without the
            // second half a permanently strobing shooter is a permanent nod — the floor
            // alone cannot tell a flash from a game that is nothing but flashes.
            const spike = rms > RMS_FLOOR && rms > loud.mean + SENSITIVITY * loud.deviation;
            const bright = flash >= FLASH_DELTA && flash > flashy.mean + SENSITIVITY * flashy.deviation;

            // A run of loud *and* bright samples is the only thing that adds up to a surge.
            // Either alone is a noise gate away from firing on a loud menu.
            this.run = spike && bright ? this.run + 1 : 0;

            if (this.run >= SURGE_RUN) {
                const moment = this._emit('surge', at, { rms, flash, run: this.run });
                // Reset regardless of whether the cooldown let it through: the run has been
                // spent either way, and leaving it high would fire again on the next sample
                // the moment the cooldown expires.
                this.run = 0;
                return moment;
            }
            if (this.run > 0) {
                // She gasps once as it starts and then either celebrates or does not. The
                // middle of a run stays quiet: emitting on every sample of a building surge
                // would be three gasps and a dance, which is a person having a fit.
                return this.run === 1 ? this._emit('near_death', at, { rms, flash }) : null;
            }
            if (bright || spike) return this._emit('hit', at, { rms, flash });
            return null;
        }

        _baseline(history) {
            // Infinity with no history, so nothing can clear a bar that does not exist yet.
            if (!history.length) return { mean: Infinity, deviation: 0 };
            const mean = history.reduce((a, b) => a + b, 0) / history.length;
            const variance = history.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / history.length;
            return { mean, deviation: Math.sqrt(variance) };
        }

        _remember(history, value) {
            history.push(value);
            if (history.length > HISTORY) history.shift();
        }

        // ── the real hook's door ─────────────────────────────────────────────

        /**
         * A moment a real game integration knows about. The same door the heuristic uses, so
         * a consumer cannot tell which produced it — and the same cooldowns apply, because a
         * game that reports a win twice is still one win as far as pacing is concerned.
         */
        mark(kind, at = this.now(), detail = {}) {
            return this._emit(kind, at, { ...detail, source: 'hook' });
        }

        // ── the one door ─────────────────────────────────────────────────────

        /**
         * Every moment leaves through here, so the cooldown cannot be bypassed by adding a
         * caller. Returns the moment, or null when its tier is still cooling down.
         */
        _emit(kind, at, detail = {}) {
            const reaction = this.profile && this.profile.REACTIONS && this.profile.REACTIONS[kind];
            if (!reaction) return null;
            const tier = reaction.tier;

            const since = this.lastAt[tier] === null ? Infinity : at - this.lastAt[tier];
            if (since < COOLDOWNS[tier]) {
                this.suppressed[tier]++;
                return null;
            }

            this.lastAt[tier] = at;
            this.counts[kind] = (this.counts[kind] || 0) + 1;
            this.emitted++;

            const moment = {
                kind,
                tier,
                macroEvent: Boolean(reaction.macroEvent),
                at,
                ...detail,
            };
            // One typed event carrying the kind, the way `scene:anchor` carries a name: five
            // `game:*` entries would be six the day somebody adds a revive.
            if (this.bus) this.bus.emit('game:moment', moment);
            return moment;
        }

        reset() {
            this.loudness = [];
            this.flashes = [];
            this.run = 0;
            this.samples = 0;
            return this;
        }

        get stats() {
            return {
                samples: this.samples,
                emitted: this.emitted,
                counts: { ...this.counts },
                suppressed: { ...this.suppressed },
                warm: this.samples >= WARMUP,
            };
        }
    }

    function attach(deps) {
        return new Detector(deps);
    }

    return {
        attach,
        Detector,
        HISTORY,
        WARMUP,
        SENSITIVITY,
        RMS_FLOOR,
        FLASH_DELTA,
        SURGE_RUN,
        MACRO_COOLDOWN_MS,
        MEDIUM_COOLDOWN_MS,
        MICRO_COOLDOWN_MS,
        COOLDOWNS,
        INFERRED,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_EXCITEMENT = ExcitementDetector;
if (typeof module !== 'undefined' && module.exports) module.exports = ExcitementDetector;
