/**
 * RemoteSttEvents — HV1. What a SonicAgent event means to her listener. Pure.
 *
 * The remote recognizer reports the same states on every surface (mic button, VR panel,
 * companion), so the words a person sees are decided once, here, and tested:
 *
 *   connecting → ready → mic-opening → listening → speech-detected → waiting-transcript
 *     → final | cancelled | failed
 *
 * Two rules this module keeps:
 *
 *  - **Nothing partial is ever invented.** SonicAgent's faster-whisper is endpointed and sends
 *    no `transcript.partial`; there is no state that shows text before the final.
 *  - **Every failure names its cause in the browser's own error vocabulary** (`network`,
 *    `not-allowed`, `no-speech`, `aborted`, `service-not-allowed`, `audio-capture`) so the three
 *    surfaces' existing error handling applies unchanged — plus a sentence a person can read,
 *    because "network" alone does not tell a Quest user that the Space is waking up.
 */
(function (global) {
    'use strict';

    const STATES = Object.freeze([
        'connecting',
        'ready',
        'mic-opening',
        'listening',
        'speech-detected',
        'waiting-transcript',
        'final',
        'cancelled',
        'failed',
    ]);

    const LABELS = Object.freeze({
        connecting: 'Connecting to the speech service…',
        ready: 'Speech service ready',
        'mic-opening': 'Opening the microphone…',
        listening: 'Listening…',
        'speech-detected': 'Hearing you…',
        'waiting-transcript': 'Transcribing…',
        final: 'Done',
        cancelled: 'Cancelled',
        failed: 'Speech recognition failed',
    });

    /**
     * Gateway or SonicAgent error code → { error, message }. `error` is the browser
     * SpeechRecognition name the surfaces already handle.
     */
    function errorFor(code, message, extra) {
        const x = extra || {};
        const retry = x.retryAfter ? ` Try again in about ${x.retryAfter} s.` : ' Try again shortly.';
        switch (code) {
            case 'backend_warming':
                return { error: 'network', message: 'The speech service is starting up.' + retry };
            case 'backend_unavailable':
            case 'backend_timeout':
                return { error: 'network', message: 'The speech service cannot be reached right now.' + retry };
            case 'backend_misconfigured':
                return {
                    error: 'service-not-allowed',
                    message: 'OllaBridge Cloud could not sign in to the speech service. This needs the site operator.',
                };
            case 'voice_unavailable':
                return {
                    error: 'service-not-allowed',
                    message: message || 'Remote speech is not available on this OllaBridge Cloud.',
                };
            case 'unauthenticated':
                return {
                    error: 'not-allowed',
                    message: 'OllaBridge Cloud did not accept this device. Pair it again in Settings ▸ LLM.',
                };
            case 'origin_denied':
                return { error: 'not-allowed', message: 'This site is not allowed to use OllaBridge voice.' };
            case 'no_consent':
                return {
                    error: 'not-allowed',
                    message:
                        'Remote speech needs your permission first: Settings ▸ STT PROVIDER ▸ Allow microphone upload to SonicAgent.',
                };
            case 'not_configured':
                return {
                    error: 'service-not-allowed',
                    message:
                        'SonicAgent needs an OllaBridge Cloud connection. Connect OllaBridge in Settings → LLM to use remote voice.',
                };
            case 'disabled':
                return {
                    error: 'service-not-allowed',
                    message: 'Remote speech is turned off: Settings ▸ Advanced Voice — SonicAgent Streaming.',
                };
            case 'too_many_sessions':
            case 'rate_limited':
                return { error: 'network', message: 'Too many voice sessions are open.' + retry };
            case 'backpressure':
                return { error: 'network', message: 'The connection could not keep up with your microphone.' };
            case 'session_expired':
                return { error: 'network', message: 'The voice session reached its time limit.' };
            case 'invalid_audio':
            case 'audio_too_long':
            case 'audio_too_large':
                return { error: 'audio-capture', message: message || 'The recording could not be used.' };
            case 'unsupported_language':
                return { error: 'language-not-supported', message: message || 'That language is not supported.' };
            case 'cancelled':
                return { error: 'aborted', message: 'Speech recognition was stopped.' };
            case 'no_speech':
                return { error: 'no-speech', message: 'No speech was heard.' };
            case 'link_closed':
                return { error: 'network', message: 'The voice connection closed before the transcript arrived.' };
            case 'timeout':
                return { error: 'network', message: 'The transcript did not arrive in time.' };
            default:
                return { error: 'network', message: message || 'Remote speech recognition failed.' };
        }
    }

    /**
     * A server event → the recognizer state it moves to, or null when it changes nothing.
     * `pending` is the set of commit sequence numbers still waiting for a final (client
     * endpointing). An event about a commit this run did not send is stale: ignored.
     */
    function reduce(event, ctx) {
        const e = event || {};
        const c = ctx || {};
        switch (e.type) {
            case 'speech.started':
                return { state: 'speech-detected' };
            case 'audio.input.committed':
                return { state: 'waiting-transcript', commitSeq: e.commit_seq == null ? null : e.commit_seq };
            case 'speech.stopped':
                return { transcribing: true, commitSeq: e.commit_seq == null ? null : e.commit_seq };
            case 'transcript.final': {
                if (e.commit_seq != null && c.pending && !c.pending.has(e.commit_seq)) return { stale: true };
                const text = typeof e.text === 'string' ? e.text.trim() : '';
                return {
                    state: 'final',
                    final: {
                        text,
                        language: e.language || null,
                        commitSeq: e.commit_seq == null ? null : e.commit_seq,
                    },
                };
            }
            case 'session.error': {
                if (e.commit_seq != null && c.pending && !c.pending.has(e.commit_seq)) return { stale: true };
                // A refusal of a turn this run never asked about (e.g. a tts.speak) is not ours.
                if (e.turn_id && !e.commit_seq && c.ignoreTurnErrors) return null;
                return {
                    state: 'failed',
                    failure: Object.assign({ code: e.code || 'backend_error' }, errorFor(e.code, e.message)),
                    commitSeq: e.commit_seq == null ? null : e.commit_seq,
                };
            }
            case 'turn.cancelled':
                return e.target === 'tts' ? null : { state: 'cancelled' };
            case 'metrics.turn':
                return e.stt_ms != null
                    ? { serverSttMs: e.stt_ms, commitSeq: e.commit_seq == null ? null : e.commit_seq }
                    : null;
            default:
                return null;
        }
    }

    const api = { STATES, LABELS, errorFor, reduce };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_REMOTE_STT_EVENTS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
