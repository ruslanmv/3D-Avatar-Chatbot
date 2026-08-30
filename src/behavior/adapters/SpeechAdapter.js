/**
 * SpeechAdapter — when she is speaking, and when she stops (spec v1.1 §6.3).
 *
 * `tts:start` / `tts:end` gate the Talk behaviour and the lipsync layer, so they have to be
 * right at both edges. Rather than add a fourth emit site to a TTS path that already spans
 * `js/speech-service.js`, `PiperWasmTTSProvider` and `speechSynthesis`, this observes the
 * one signal all three already agree on — the same signal the app's existing
 * `BehaviorEngine` uses to drive its SPEAKING state.
 *
 * Polling rather than events, deliberately: `speechSynthesis` fires `end` unreliably when a
 * tab is backgrounded or an utterance is cancelled mid-word, and a missed `tts:end` leaves
 * her mouth moving after the audio has stopped. A cheap poll cannot miss an edge, only
 * arrive one tick late.
 *
 * Exposes: window.NEXUS_BD_SPEECH_ADAPTER
 */
const SpeechAdapter = (() => {
    'use strict';

    const POLL_MS = 100;

    function attach({ bus, blackboard, speech, provider, intervalMs = POLL_MS } = {}) {
        const synth = speech || (typeof window !== 'undefined' ? window.speechSynthesis : null);
        const tts = provider || (typeof window !== 'undefined' ? window.NEXUS_TTS_PROVIDER : null);

        let speaking = false;
        let timer = null;

        function isSpeaking() {
            try {
                if (tts && typeof tts.isSpeaking === 'function' && tts.isSpeaking()) return true;
                return Boolean(synth && synth.speaking);
            } catch {
                return false;
            }
        }

        /** Exported so tests can step the edge detector without a clock. */
        function poll() {
            const now = isSpeaking();
            if (now === speaking) return null;
            speaking = now;

            if (blackboard) {
                blackboard.setFlag('ttsSpeaking', now);
                blackboard.resetTimer('sinceSpeech');
            }
            const event = now ? 'tts:start' : 'tts:end';
            bus.emit(event, {});
            return event;
        }

        if (typeof setInterval === 'function') timer = setInterval(poll, intervalMs);

        return {
            name: 'SpeechAdapter',
            poll,
            detach() {
                if (timer) clearInterval(timer);
                timer = null;
                if (speaking) {
                    // Never leave the Talk layer stuck on because the engine was switched off
                    // mid-sentence.
                    speaking = false;
                    bus.emit('tts:end', {});
                }
            },
        };
    }

    return { attach, POLL_MS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SPEECH_ADAPTER = SpeechAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = SpeechAdapter;
