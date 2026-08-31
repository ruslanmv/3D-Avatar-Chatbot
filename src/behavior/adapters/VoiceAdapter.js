/**
 * VoiceAdapter — the microphone, as a sense (spec v1.1 §6.10, batch B10).
 *
 * ## It builds no recogniser
 *
 * The app already has one. `js/speech-service.js` wires Web Speech recognition, a
 * MediaRecorder fallback for Quest, permission handling and device selection, and it has
 * been carrying the app's voice input for a long time. This adapter *observes* it — the
 * same decorate-and-restore pattern B4 used on `window.NEXUS_MOTION`, for the same reason:
 * a second recogniser would be a second set of bugs, a second permission prompt, and two
 * transcripts to reconcile.
 *
 * What it adds is the two things the engine needs and the recogniser does not publish:
 *
 * 1. **VAD on the bus.** `onspeechstart` / `onspeechend` already fire on the recognition
 *    object; SpeechService only logs them. Chained here, they become `user:speaking` and
 *    `user:silent`, which is what §6.7's etiquette and B16's curiosity openings read. This
 *    is the browser's own voice activity detection, from the same engine doing the ASR —
 *    not an audio analyser of this adapter's own.
 * 2. **Final transcripts to the session.** When B9's socket is up and the uplink has been
 *    offered, a final transcript goes up as `voice_transcript`; the reply comes back as
 *    `say` + `intent` through handlers that already exist. Speech in, gesture out, with no
 *    new path from here to the rig.
 *
 * ## Declining the microphone
 *
 * A no is a complete answer. `unavailable` is a state, not an error: the adapter attaches,
 * finds no permission or no recogniser, emits nothing, and every other channel — typed
 * chat, the tag parser, idle, gaze, the whole mixer — is untouched. Nothing here throws
 * during boot, because boot catches an adapter's failure and continues without it, and
 * "continues without it" should not be how a normal, expected refusal is handled.
 *
 * Exposes: window.NEXUS_BD_VOICE_ADAPTER
 */
const VoiceAdapter = (() => {
    'use strict';

    /** How long after the last final transcript we still count as speaking, if the
     *  recogniser never fires `onspeechend` — it is unreliable on some builds. */
    const SPEECH_TAIL_MS = 1200;

    /** Handlers on the recognition object that this adapter chains onto. */
    const OBSERVED = ['onspeechstart', 'onspeechend', 'onerror', 'onend'];

    class Adapter {
        /**
         * @param {object} deps
         * @param {object} deps.bus
         * @param {object} [deps.blackboard]
         * @param {object} [deps.speech]   the SpeechService singleton; defaults to the global
         * @param {object} [deps.session]  B9's SessionAdapter, if one is running
         * @param {object} [deps.config]
         */
        constructor({ bus, blackboard, speech, session, config = {}, now = () => Date.now() } = {}) {
            this.bus = bus;
            this.blackboard = blackboard;
            this.session = session || null;
            this.config = config;
            this.now = now;

            this.speech = speech || (typeof window !== 'undefined' ? window.SpeechService : null);
            this.speaking = false;
            /** Null, not 0: "no final transcript yet" is a different fact from "one at
             *  timestamp zero", and only a sentinel keeps them apart. */
            this.lastFinalAt = null;
            this.transcripts = 0;
            this.sent = 0;

            /** 'off' until asked, then 'listening' or 'unavailable'. Never throws to get here. */
            this.status = 'off';
            this.reason = '';
            this._restore = [];
        }

        get name() {
            return 'VoiceAdapter';
        }

        /**
         * Ask for the microphone and start observing. Returns the resulting status rather
         * than a boolean: "declined" and "this browser has no recogniser" are different
         * facts and a caller that wants to explain itself needs both.
         */
        async enable() {
            if (!this.speech) return this._unavailable('no speech service');
            if (this.speech.isRecognitionSupported === false) {
                return this._unavailable('this browser has no speech recognition');
            }

            let granted = true;
            if (typeof this.speech.requestMicrophonePermission === 'function') {
                try {
                    granted = await this.speech.requestMicrophonePermission();
                } catch (error) {
                    return this._unavailable(`microphone request failed: ${error && error.message}`);
                }
            }
            if (!granted) return this._unavailable('microphone declined');

            this._observe();
            this.status = 'listening';
            this.reason = '';
            // Offer the uplink only once we actually have a microphone. Offering first and
            // asking after would leave a server holding a negotiation for audio that never
            // arrives.
            if (this.session && this.session.connected) this.session.offerVoice('transcript');
            return this.status;
        }

        _unavailable(reason) {
            this.status = 'unavailable';
            this.reason = reason;
            console.info(`[BD] voice uplink off — ${reason}`);
            return this.status;
        }

        // ── observing the existing recogniser ────────────────────────────────

        /**
         * Chain onto the recognition object's handlers rather than replace them. Whatever
         * SpeechService does on these events keeps happening; this runs after it, and
         * `detach` puts the originals back exactly as they were.
         */
        _observe() {
            const recognition = this.speech.recognition;
            if (!recognition) return;

            for (const key of OBSERVED) {
                const original = recognition[key];
                this._restore.push([recognition, key, original]);
                recognition[key] = (event) => {
                    if (typeof original === 'function') {
                        try {
                            original.call(recognition, event);
                        } catch (error) {
                            console.warn(`[BD] the app's ${key} handler threw`, error);
                        }
                    }
                    this._observed(key, event);
                };
            }
        }

        _observed(key, event) {
            if (key === 'onspeechstart') return this.setSpeaking(true);
            if (key === 'onspeechend') return this.setSpeaking(false);
            // A recogniser that errored or ended is not listening, whatever it last said
            // about speech. Leaving `user:speaking` latched here is how she ends up waiting
            // politely for a sentence that finished two minutes ago.
            if (key === 'onerror' || key === 'onend') return this.setSpeaking(false);
            return null;
        }

        /** The VAD edge. Idempotent: only a change reaches the bus. */
        setSpeaking(value) {
            if (value === this.speaking) return null;
            this.speaking = value;
            if (this.blackboard) {
                this.blackboard.setFlag('userSpeaking', value);
                if (!value) this.blackboard.resetTimer('sinceUserInput');
            }
            const event = value ? 'user:speaking' : 'user:silent';
            this.bus.emit(event, {});
            return event;
        }

        /**
         * A transcript from the recogniser. Interim text moves the VAD edge and nothing
         * else; a final one goes up the session socket if there is one.
         *
         * Called by whatever is driving recognition — the app's own callbacks, or a test.
         * It is deliberately not wired to `onresult`: SpeechService's `onresult` handler
         * owns the app's transcript, and reading the raw event a second time here is how
         * the two would eventually disagree about what the user said.
         */
        transcript(text, { final = false, lang = 'en' } = {}) {
            const clean = (text || '').trim();
            if (!clean) return { action: 'ignored', why: 'empty' };

            this.transcripts++;
            if (!final) {
                this.setSpeaking(true);
                return { action: 'interim' };
            }

            this.lastFinalAt = this.now();
            this.setSpeaking(false);

            if (!this.session || !this.session.connected) {
                // No server: the app's own chat path handles this transcript exactly as it
                // did before B10. There is nothing to fall back to because nothing was
                // taken away.
                return { action: 'local', why: 'no session' };
            }
            if (!this.session.sendVoiceTranscript(clean, { final: true, lang })) {
                return { action: 'local', why: 'uplink not negotiated' };
            }
            this.sent++;
            return { action: 'sent' };
        }

        /** Polled from the render loop, like the other timing-sensitive adapters. */
        tick() {
            if (!this.speaking || this.lastFinalAt === null) return;
            if (this.now() - this.lastFinalAt > SPEECH_TAIL_MS) this.setSpeaking(false);
        }

        detach() {
            for (const [target, key, original] of this._restore.splice(0)) {
                target[key] = original;
            }
            if (this.session && this.session.connected && this.session.voice) this.session.endVoice('detached');
            this.setSpeaking(false);
            this.status = 'off';
        }

        get stats() {
            return {
                status: this.status,
                reason: this.reason,
                speaking: this.speaking,
                transcripts: this.transcripts,
                sent: this.sent,
            };
        }
    }

    /**
     * Attach, but do **not** ask for the microphone. Consent is a user action, so the
     * adapter is inert until something calls `enable()` — which is also why an install that
     * never grants the mic costs exactly one object.
     */
    function attach(deps) {
        return new Adapter(deps);
    }

    return { attach, Adapter, SPEECH_TAIL_MS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_VOICE_ADAPTER = VoiceAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = VoiceAdapter;
