/**
 * SpatialAudioManager — waves over here, her voice over there (IC3).
 *
 * The companion's voice stays on the existing speech path. This manager does
 * not synthesise speech and does not construct a second TTS engine. It owns
 * the environmental bed and a gain that ducks while she is speaking, and it
 * exposes a panner position for a future voice tap if the speech system hands
 * one over. Until it does, `companion` is a gain node with no source of its
 * own — speech intelligibility is the speech system's job, and ducking the
 * waves is this one's.
 *
 * Mute and the two levels come from the session's voice state. A VR session
 * ending suspends the bed; it does not leak oscillators past `stop`.
 *
 * Exposes: window.NEXUS_EXPERIENCE_AUDIO
 */
const SpatialAudioManager = (() => {
    'use strict';

    function create(options) {
        const options_ = options || {};
        let context = options_.context || null;
        let master = null;
        let environment = null;
        let companion = null;
        let panner = null;
        let oscillator = null;
        let speaking = false;
        let disposed = false;
        const levels = { muted: false, companion: 1, environment: 0.45 };

        function ensure() {
            if (disposed) return null;
            if (!context && options_.createContext) {
                try {
                    context = options_.createContext();
                } catch (_) {
                    context = null;
                }
            }
            if (!context) return null;
            if (master) return context;
            master = context.createGain();
            environment = context.createGain();
            companion = context.createGain();
            master.connect(context.destination);
            environment.connect(master);
            companion.connect(master);
            try {
                panner = context.createPanner();
                panner.panningModel = 'HRTF';
                panner.distanceModel = 'inverse';
                panner.refDistance = 1.2;
                panner.maxDistance = 8;
                if (panner.positionX) panner.positionX.value = 0;
                environment.disconnect();
                environment.connect(panner);
                panner.connect(master);
            } catch (_) {
                panner = null;
            }
            apply();
            return context;
        }

        function apply() {
            if (!master) return;
            const audible = levels.muted ? 0 : 1;
            master.gain.value = audible;
            environment.gain.value = levels.environment * (speaking ? 0.25 : 1);
            companion.gain.value = levels.companion;
        }

        function startAmbience() {
            const ctx = ensure();
            if (!ctx || oscillator) return { ok: Boolean(ctx), why: ctx ? 'started' : 'no-audio' };
            try {
                oscillator = ctx.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.value = 78;
                const filterGain = ctx.createGain();
                filterGain.gain.value = 0.08;
                oscillator.connect(filterGain);
                filterGain.connect(environment);
                oscillator.start();
            } catch (_) {
                oscillator = null;
                return { ok: false, why: 'ambience-failed' };
            }
            return { ok: true, why: 'started' };
        }

        function stopAmbience() {
            if (oscillator) {
                try {
                    oscillator.stop();
                } catch (_) {
                    /* already stopped */
                }
                try {
                    oscillator.disconnect();
                } catch (_) {
                    /* already disconnected */
                }
            }
            oscillator = null;
        }

        return {
            startAmbience: startAmbience,
            stopAmbience: stopAmbience,
            setSpeaking: function (value) {
                speaking = value === true;
                apply();
                return { speaking: speaking, environment: environment ? environment.gain.value : 0 };
            },
            setLevels: function (voice) {
                if (!voice) return levels;
                if (voice.muted != null) levels.muted = voice.muted === true;
                if (voice.companion != null) levels.companion = voice.companion;
                if (voice.environment != null) levels.environment = voice.environment;
                apply();
                return Object.assign({}, levels);
            },
            setCompanionPosition: function (position) {
                if (!panner || !position) return false;
                if (panner.positionX) {
                    panner.positionX.value = position.x || 0;
                    panner.positionY.value = position.y || 0;
                    panner.positionZ.value = position.z || 0;
                }
                return true;
            },
            onVrSessionStart: function () {
                if (context && typeof context.resume === 'function') {
                    try {
                        context.resume();
                    } catch (_) {
                        /* a suspended context that will not resume stays silent */
                    }
                }
            },
            onVrSessionEnd: function () {
                stopAmbience();
                if (context && typeof context.suspend === 'function') {
                    try {
                        context.suspend();
                    } catch (_) {
                        /* ending VR must not throw into the session-end handler */
                    }
                }
            },
            dispose: function () {
                stopAmbience();
                disposed = true;
                if (master) {
                    try {
                        master.disconnect();
                    } catch (_) {
                        /* already gone */
                    }
                }
                master = null;
                environment = null;
                companion = null;
                panner = null;
            },
            get speaking() {
                return speaking;
            },
            get environmentGain() {
                return environment ? environment.gain.value : 0;
            },
            get muted() {
                return levels.muted;
            },
        };
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_AUDIO = SpatialAudioManager;
if (typeof module !== 'undefined' && module.exports) module.exports = SpatialAudioManager;
