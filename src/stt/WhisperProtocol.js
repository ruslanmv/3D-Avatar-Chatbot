/**
 * WhisperProtocol — ST1. The messages between the page and the Whisper worker, in one place.
 *
 * The worker runs the model off the page's thread (Q7's lesson: on a Quest, ONNX Runtime on
 * the main thread stops the XR frame loop for as long as inference takes). The page and the
 * worker agree on these names and shapes; both import this file, so a renamed message cannot
 * leave one side listening for something the other no longer sends.
 *
 * Every request carries an `id`. A result answers the id it was asked with, so a transcription
 * that finishes after the person cancelled — or after a newer one was asked — is recognised as
 * stale and dropped instead of being typed into the chat.
 */
(function (global) {
    'use strict';

    const TO_WORKER = Object.freeze({
        LOAD: 'load', // { id, config } — import the runtime, create the pipeline, warm it up
        TRANSCRIBE: 'transcribe', // { id, samples: Float32Array, sampleRate, language }
        CANCEL: 'cancel', // { id }
    });

    const FROM_WORKER = Object.freeze({
        PROGRESS: 'model-progress', // { id, file, loaded, total, status }
        READY: 'model-ready', // { id, ms, backend, model }
        LOAD_ERROR: 'model-error', // { id, message }
        STARTED: 'transcription-started', // { id }
        DONE: 'transcription-complete', // { id, text, ms, audioMs, language }
        ERROR: 'transcription-error', // { id, message }
        CANCELLED: 'transcription-cancelled', // { id }
    });

    let counter = 0;

    /** A request id unique within this page (and readable in a log). */
    function nextId(prefix) {
        counter += 1;
        return `${prefix || 'r'}${counter}-${Date.now().toString(36)}`;
    }

    const KNOWN = new Set([...Object.values(TO_WORKER), ...Object.values(FROM_WORKER)]);

    /** Is this a message of the protocol, with an id? Anything else is ignored, never trusted. */
    function isMessage(data) {
        return !!data && typeof data === 'object' && KNOWN.has(data.type) && typeof data.id === 'string';
    }

    /** A transcription request, validated: samples must be a non-empty Float32Array. */
    function transcribeRequest(id, samples, sampleRate, language) {
        if (!(samples instanceof Float32Array) || !samples.length) throw new Error('samples must be a Float32Array');
        if (!(sampleRate > 0)) throw new Error('sampleRate must be positive');
        return { type: TO_WORKER.TRANSCRIBE, id, samples, sampleRate, language: language || null };
    }

    const api = { TO_WORKER, FROM_WORKER, nextId, isMessage, transcribeRequest };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WHISPER_PROTOCOL = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
