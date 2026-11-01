/**
 * RemoteSonicAgentSTT — HV1. SonicAgent's faster-whisper, through OllaBridge Cloud, shaped like
 * the browser's SpeechRecognition.
 *
 * Same reason as LocalWhisperSTT (ST2): the mic button (src/main.js), the VR panel and VR
 * push-to-talk (js/speech-service.js) and the companion's hands-free call (src/CompanionMode.js)
 * are each written against `webkitSpeechRecognition`, and all three already construct whatever
 * `NEXUS_STT.recognitionClass()` answers. A recognizer with the same surface is the one place a
 * remote engine plugs in — not three new microphone paths.
 *
 * How a turn runs:
 *
 *   start()  → the gate (enabled + consent + a paired OllaBridge — checked NOW, not at save)
 *            → microphone lease and the voice link open *at the same time*; audio captured
 *              before the link is ready is held (bounded) and sent the moment it is
 *   speaking → PCM16 frames stream to the server as they are captured (hold and auto-stop)
 *   stop()   → the rest is sent with the end-of-utterance flag ("commit")
 *            → exactly one `transcript.final` per commit (SonicAgent HV3 client endpointing),
 *              matched by `commit_seq`; anything else is stale and ignored
 *
 * The rules, each a failure it prevents:
 *
 *  - **No audio leaves without consent.** The gate runs before the microphone opens; a refusal
 *    ends with 'not-allowed' and a sentence, and nothing was recorded.
 *  - **No silent fallback.** A remote failure ends the run with the browser's error names
 *    ('network', 'service-not-allowed', …) and a reason. It never hands the audio to the
 *    browser's recognizer (which on Chrome is Google's service) or changes a saved setting.
 *  - **Exactly once.** A final is delivered only for a commit this run sent and is still
 *    waiting for; a repeat, or one arriving after abort(), is dropped. No duplicate chat message.
 *  - **A release before the microphone opened records nothing** (MicrophoneSession's lease).
 *  - **No invented partials, no confidence** — like LocalWhisperSTT. "Transcribing…" is shown at
 *    `onaudioend`.
 *  - **Half-duplex** in the hands-free and auto-stop modes while she is speaking, as on-device.
 *
 * Against a SonicAgent from before HV3 (which ignores the options and endpoints on the server),
 * the run still works: finals carry no `commit_seq`, so after the commit it waits until every
 * transcription the server started has answered and the line has been quiet for a moment.
 */
(function (global) {
    'use strict';

    const NO_SPEECH_MS = 8000;
    const EARLY_MAX_SECONDS = 15; // audio held while the link opens
    const FINAL_TIMEOUT_MS = 25000;
    const V1_QUIET_MS = 700;

    function lib(name) {
        return (global && global[name]) || null;
    }

    function emitStatus(detail) {
        try {
            if (global && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
                global.dispatchEvent(
                    new global.CustomEvent('nexus-stt', { detail: Object.assign({ remote: true }, detail) })
                );
            }
        } catch (_) {}
    }

    function appSpeaking() {
        try {
            const ind = global.document && global.document.getElementById('status-indicator');
            return !!(ind && ind.classList && ind.classList.contains('speaking'));
        } catch (_) {
            return false;
        }
    }

    function nowMs() {
        return global && global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
    }

    function makeResult(text) {
        const r = [{ transcript: text, confidence: undefined }];
        r.isFinal = true;
        r.item = (i) => r[i];
        return r;
    }

    function resultList(items) {
        const list = items.slice();
        list.item = (i) => list[i];
        return list;
    }

    class RemoteSonicAgentRecognition {
        constructor(deps) {
            this.lang = '';
            this.continuous = false;
            this.interimResults = false;
            this.maxAlternatives = 1;
            this.endOnSilence = null;
            this.holdToTalk = false;
            this.deviceId = null;
            this.isRemoteSonic = true;
            // The surfaces read `isLocalWhisper` as "an app-owned recognizer, not the browser's":
            // it opens the microphone itself (so no second permission stream competes with it on
            // a Quest), takes `holdToTalk`, says "Transcribing…" at `onaudioend` and carries a
            // readable `message` on errors. All of that is true here too.
            this.isLocalWhisper = true;
            for (const h of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend']) {
                this['on' + h] = null;
            }
            this.onresult = null;
            this.onnomatch = null;
            this.onerror = null;
            this.onend = null;
            this.onstatechange = null;
            this._deps = deps || {};
            this._listeners = {};
            this._state = 'idle'; // idle | opening | capturing | finishing
            this._gen = 0;
            this.remoteState = null;
        }

        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || new Set()).add(fn);
        }

        removeEventListener(type, fn) {
            if (this._listeners[type]) this._listeners[type].delete(fn);
        }

        _fire(type, extra) {
            const event = Object.assign({ type, target: this }, extra || {});
            const handler = this['on' + type];
            try {
                if (typeof handler === 'function') handler.call(this, event);
            } catch (err) {
                if (global && global.console) global.console.error(`[RemoteSonicAgentSTT] on${type} threw:`, err);
            }
            for (const fn of Array.from(this._listeners[type] || [])) {
                try {
                    fn.call(this, event);
                } catch (_) {}
            }
        }

        _setRemote(gen, state, extra) {
            if (gen !== this._gen) return;
            this.remoteState = state;
            const E = lib('NEXUS_REMOTE_STT_EVENTS');
            const label = E ? E.LABELS[state] : state;
            emitStatus(Object.assign({ type: 'remote-state', state, label }, extra || {}));
            this._fire('statechange', { state, label });
        }

        _mode() {
            if (this.holdToTalk || this.endOnSilence === false) return 'hold';
            if (this.continuous) return 'continuous';
            return 'auto-stop';
        }

        _config() {
            return this._deps.config || lib('NEXUS_SONIC_VOICE');
        }

        _stream() {
            return this._deps.stream || lib('NEXUS_SONIC_STREAM');
        }

        start() {
            if (this._state !== 'idle') {
                const Err = global && global.DOMException;
                throw Err
                    ? new Err('recognition has already started', 'InvalidStateError')
                    : new Error('already started');
            }
            const gen = ++this._gen;
            this._state = 'opening';
            this._results = [];
            this._pending = new Set();
            this._v1 = { outstanding: 0, committed: false, quietTimer: null };
            this._early = [];
            this._earlySamples = 0;
            this._framer = null;
            this._link = null;
            this._release = null;
            this._unsubs = [];
            this._stopAsked = false;
            this._captureDone = false;
            this._heardSound = false;
            this._heardSpeech = false;
            this._endpointer = null;
            this._error = null;
            this._finalTimer = null;
            this._perfRun = { requestAt: nowMs() };

            const E = lib('NEXUS_REMOTE_STT_EVENTS');
            const cfg = this._config();
            const gate = cfg ? cfg.allowed('stt') : { ok: false, code: 'disabled' };
            if (!gate.ok) {
                // Nothing has been opened and nothing will be sent.
                const f = E ? E.errorFor(gate.code) : { error: 'service-not-allowed', message: gate.code };
                Promise.resolve().then(() => this._failAndEnd(gen, f.error, f.message, gate.code));
                return;
            }
            const S = this._stream();
            const mics = this._deps.mic || (lib('NEXUS_MIC_SESSION') && lib('NEXUS_MIC_SESSION').get());
            if (!S || !mics) {
                Promise.resolve().then(() =>
                    this._failAndEnd(gen, 'service-not-allowed', 'Remote speech recognition is not loaded.')
                );
                return;
            }
            const link = this._deps.link || S.shared();
            this._link = link;
            this._setRemote(gen, 'connecting');
            this._perfRun.connectAt = nowMs();
            const language = (this.lang || (cfg && cfg.language()) || 'en').slice(0, 2).toLowerCase();
            this._language = language;

            // Both at once: the person can start talking while the socket opens.
            // The session's language is the transcription language. Her voice is chosen per phrase
            // (HV9), so listening never needs to reopen the link for a voice.
            const connected = link.ensure({ language });
            this._setRemote(gen, 'mic-opening');
            const mode = this._mode();
            const A = lib('NEXUS_STT_AUDIO');
            this._lease = mics.open({
                owner: 'sonicagent-recognition',
                deviceId: this.deviceId || null,
                onFrames: (samples, rate) => this._onFrames(gen, samples, rate),
                onEnded: (why) => {
                    if (gen !== this._gen || this._state === 'idle') return;
                    if (why === 'device-ended') {
                        this._error = this._error || { error: 'audio-capture', message: 'The microphone stopped.' };
                    }
                    this._finishCapture(gen);
                },
            });
            this._lease.ready.then((r) => {
                if (gen !== this._gen) return;
                if (!r.ok) {
                    if (r.reason === 'cancelled') return this._end(gen);
                    const error =
                        r.reason === 'denied'
                            ? 'not-allowed'
                            : r.reason === 'unsupported'
                              ? 'service-not-allowed'
                              : 'audio-capture';
                    return this._failAndEnd(gen, error, r.message);
                }
                this._rate = r.sampleRate;
                this._state = 'capturing';
                this._perfRun.captureAt = nowMs();
                if (mode !== 'hold' && A) this._endpointer = A.createEndpointer(r.sampleRate);
                this._fire('start');
                this._fire('audiostart');
                this._setRemote(gen, 'listening');
                if (mode === 'auto-stop') {
                    this._noSpeechTimer = setTimeout(() => {
                        if (gen === this._gen && this._state === 'capturing' && !this._heardSpeech)
                            this._finishCapture(gen);
                    }, NO_SPEECH_MS);
                }
                if (this._stopAsked) this._finishCapture(gen);
            });

            connected.then((res) => {
                if (gen !== this._gen) return;
                if (!res.ok) {
                    const f = E ? E.errorFor(res.code, res.message, res) : { error: 'network', message: res.message };
                    if (this._lease) this._lease.close();
                    return this._failAndEnd(gen, f.error, f.message, res.code);
                }
                this._release = link.retain();
                this._perfRun.readyAt = nowMs();
                this._perfRun.connect = res.connect || null;
                this._perfRun.reused = !!res.reused;
                this._options = res.options || S.V1_OPTIONS;
                this._framer = S.createFramer({ frameMs: 20, firstSequence: link.nextSequence() });
                this._unsubs.push(link.on('event', (ev) => this._onEvent(gen, ev)));
                this._unsubs.push(
                    link.on('close', () => {
                        if (gen !== this._gen || this._state === 'idle') return;
                        const f = E ? E.errorFor('link_closed') : { error: 'network', message: 'closed' };
                        this._failAndEnd(gen, f.error, f.message, 'link_closed');
                    })
                );
                if (this._state === 'capturing' || this._state === 'opening') this._setRemote(gen, 'ready');
                for (const block of this._early) this._send(gen, block.samples, block.rate);
                this._early = [];
                if (this._captureDone) this._commit(gen);
            });
        }

        stop() {
            if (this._state === 'idle' || this._state === 'finishing') return;
            this._stopAsked = true;
            if (this._state === 'opening' && !(this._lease && this._lease.isOpen())) {
                // Released before the microphone opened: close the lease; nothing was recorded.
                if (this._lease) this._lease.close();
                return;
            }
            this._finishCapture(this._gen);
        }

        abort() {
            if (this._state === 'idle') return;
            const gen = this._gen;
            this._gen++; // every pending callback and every late final of this run is now stale
            if (this._lease) this._lease.close();
            clearTimeout(this._noSpeechTimer);
            clearTimeout(this._finalTimer);
            if (this._framer) this._framer.discard();
            if (this._link && this._pending.size) {
                try {
                    this._link.sendControl({ type: 'turn.cancel', target: 'stt' });
                } catch (_) {}
            }
            this._cleanup();
            this._state = 'idle';
            this.remoteState = 'cancelled';
            emitStatus({ type: 'remote-state', state: 'cancelled' });
            this._fire('error', { error: 'aborted', message: 'Speech recognition was stopped.', detail: null });
            this._fire('end');
            emitStatus({ type: 'end', error: 'aborted' });
            void gen;
        }

        _onFrames(gen, samples, rate) {
            if (gen !== this._gen || this._state !== 'capturing') return;
            if (typeof this.onlevel === 'function') {
                // The Settings test's meter reads the level from THIS capture: on a Quest a second
                // capture just for a meter takes the microphone from the recognizer (ST9).
                let sum = 0;
                for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
                try {
                    this.onlevel(Math.min(1, Math.sqrt(sum / (samples.length || 1)) * 4));
                } catch (_) {}
            }
            if (this._perfRun.firstFrameAt == null) this._perfRun.firstFrameAt = nowMs();
            const mode = this._mode();
            if (mode === 'hold') {
                if (!this._heardSound) {
                    this._heardSound = true;
                    this._fire('soundstart');
                }
                this._send(gen, samples, rate);
                return;
            }
            const suppress = this._deps.suppressWhile || appSpeaking;
            if (suppress()) {
                // Her own voice is playing: neither listen to it nor send it.
                if (this._endpointer) this._endpointer.reset();
                return;
            }
            if (mode === 'auto-stop') this._send(gen, samples, rate);
            for (const ev of this._endpointer.push(samples)) {
                if (ev.type === 'speech-start') {
                    this._heardSpeech = true;
                    clearTimeout(this._noSpeechTimer);
                    this._fire('soundstart');
                    this._fire('speechstart');
                    this._setRemote(gen, 'speech-detected');
                } else if (ev.type === 'speech-end') {
                    this._fire('speechend');
                    if (mode === 'auto-stop') {
                        this._finishCapture(gen);
                    } else {
                        // Hands-free: the endpointed sentence goes up whole and is committed; the
                        // call stays open for the next one.
                        this._send(gen, ev.samples, rate);
                        this._commitWhenReady(gen);
                    }
                }
            }
        }

        _send(gen, samples, rate) {
            if (gen !== this._gen) return;
            if (!this._framer) {
                this._earlySamples += samples.length;
                if (this._earlySamples > EARLY_MAX_SECONDS * rate) {
                    const E = lib('NEXUS_REMOTE_STT_EVENTS');
                    const f = E ? E.errorFor('timeout') : { error: 'network', message: 'timeout' };
                    if (this._lease) this._lease.close();
                    return this._failAndEnd(gen, f.error, 'The speech service took too long to connect.', 'timeout');
                }
                this._early.push({ samples: Float32Array.from(samples), rate });
                return;
            }
            for (const frame of this._framer.push(samples, rate)) {
                if (this._perfRun.firstSentAt == null) this._perfRun.firstSentAt = nowMs();
                this._link.sendBinary(frame);
            }
            this._link.setNextSequence(this._framer.nextSequence());
        }

        _commitWhenReady(gen) {
            if (this._framer) this._commit(gen);
            else this._captureDone = true;
        }

        _finishCapture(gen) {
            if (gen !== this._gen || (this._state !== 'capturing' && this._state !== 'opening')) return;
            const wasCapturing = this._state === 'capturing';
            this._state = 'finishing';
            clearTimeout(this._noSpeechTimer);
            if (this._lease) this._lease.close();
            this._perfRun.stopAt = nowMs();
            if (wasCapturing) {
                if (this._heardSound || this._heardSpeech) this._fire('soundend');
                this._fire('audioend');
            }
            if (this._mode() === 'continuous') {
                // Sentences were committed as they ended; anything mid-sentence is dropped, as the
                // on-device recognizer does when a call is hung up.
                if (!this._pending.size && !this._v1.outstanding) return this._settle(gen);
                this._setRemote(gen, 'waiting-transcript');
                this._armFinalTimeout(gen);
                return;
            }
            this._setRemote(gen, 'waiting-transcript');
            emitStatus({ type: 'transcribing' });
            if (this._framer) this._commit(gen);
            else this._captureDone = true; // the link is still opening: commit as soon as it is
        }

        _commit(gen) {
            if (gen !== this._gen || !this._framer) return;
            const { frames, commitSeq } = this._framer.commit();
            for (const f of frames) this._link.sendBinary(f);
            this._link.setNextSequence(this._framer.nextSequence());
            this._perfRun.commitAt = nowMs();
            if (this._options && this._options.endpointing === 'client') {
                this._pending.add(commitSeq);
            } else {
                this._v1.committed = true;
                this._armV1Quiet(gen);
            }
            this._armFinalTimeout(gen);
        }

        _armFinalTimeout(gen) {
            clearTimeout(this._finalTimer);
            this._finalTimer = setTimeout(() => {
                if (gen !== this._gen || this._state === 'idle') return;
                const E = lib('NEXUS_REMOTE_STT_EVENTS');
                const f = E ? E.errorFor('timeout') : { error: 'network', message: 'timeout' };
                this._failAndEnd(gen, f.error, f.message, 'timeout');
            }, FINAL_TIMEOUT_MS);
        }

        _armV1Quiet(gen) {
            clearTimeout(this._v1.quietTimer);
            this._v1.quietTimer = setTimeout(() => {
                if (gen !== this._gen) return;
                if (this._v1.committed && this._v1.outstanding <= 0 && this._state === 'finishing') this._settle(gen);
            }, V1_QUIET_MS);
        }

        _onEvent(gen, ev) {
            if (gen !== this._gen || this._state === 'idle') return;
            const E = lib('NEXUS_REMOTE_STT_EVENTS');
            if (!E) return;
            const clientMode = this._options && this._options.endpointing === 'client';
            const r = E.reduce(ev, { pending: clientMode ? this._pending : null, ignoreTurnErrors: true });
            if (!r || r.stale) return;
            if (r.serverSttMs != null) this._serverSttMs = r.serverSttMs;
            if (r.transcribing && !clientMode) {
                this._v1.outstanding++;
                return;
            }
            if (r.state === 'speech-detected') {
                if (this._mode() === 'hold' && !this._heardSpeech) {
                    this._heardSpeech = true;
                    this._fire('speechstart');
                }
                this._setRemote(gen, 'speech-detected');
                return;
            }
            if (r.state === 'final') {
                if (clientMode) {
                    if (r.final.commitSeq == null || !this._pending.has(r.final.commitSeq)) return;
                    this._pending.delete(r.final.commitSeq);
                } else {
                    this._v1.outstanding = Math.max(0, this._v1.outstanding - 1);
                }
                this._perfRun.finalAt = nowMs();
                if (r.final.text) this._deliver(gen, r.final.text);
                if (this._state === 'finishing') {
                    if (clientMode && !this._pending.size) this._settle(gen);
                    else if (!clientMode) this._armV1Quiet(gen);
                }
                return;
            }
            if (r.state === 'failed') {
                if (clientMode && r.commitSeq != null) this._pending.delete(r.commitSeq);
                this._failAndEnd(gen, r.failure.error, r.failure.message, r.failure.code);
            }
        }

        _deliver(gen, text) {
            this._results.push(makeResult(text));
            this._setRemote(gen, 'final', { text });
            emitStatus({ type: 'result', text });
            this._fire('result', { results: resultList(this._results), resultIndex: this._results.length - 1 });
            this._trace(text);
        }

        /** HV7. One trace per delivered utterance, on SttPerformance, with the remote stages. */
        _trace(text) {
            const P = lib('NEXUS_STT_PERF');
            if (!P) return;
            try {
                const run = this._perfRun;
                const first = !run.used;
                run.used = true;
                const t = P.createTrace({
                    surface: this.perfSurface || 'app',
                    startAt: first ? run.requestAt : run.stopAt || nowMs(),
                });
                if (first) {
                    t.mark('microphone_request_started', run.requestAt);
                    if (run.captureAt != null) {
                        t.mark('microphone_permission_completed', run.captureAt);
                        t.mark('microphone_capture_started', run.captureAt);
                    }
                    if (run.firstFrameAt != null) t.mark('first_audio_frame', run.firstFrameAt);
                    if (run.connectAt != null) t.mark('remote_connection_started', run.connectAt);
                    if (run.readyAt != null) t.mark('remote_connection_ready', run.readyAt);
                    if (run.firstSentAt != null) t.mark('remote_first_frame_sent', run.firstSentAt);
                }
                if (run.stopAt != null) t.mark('recording_stopped', run.stopAt);
                if (run.commitAt != null) t.mark('remote_commit_sent', run.commitAt);
                if (run.finalAt != null) t.mark('remote_transcript_received', run.finalAt);
                t.mark('transcript_displayed');
                t.merge({
                    provider: 'sonicagent-stream',
                    model: 'faster-whisper',
                    language: this._language || null,
                    mode: this._mode(),
                    remoteServerSttMs: this._serverSttMs == null ? null : this._serverSttMs,
                    remoteLinkReused: run.reused == null ? null : !!run.reused,
                    remoteSessionMs: run.connect ? run.connect.sessionMs : null,
                    remoteConnectMs: run.connect ? run.connect.totalMs : null,
                    remoteOptions: this._options ? Object.assign({}, this._options) : null,
                    xrMode: P.xrMode ? P.xrMode(global) : null,
                    accepted: !!text,
                });
                t.end();
                if (this.perfSurface !== 'settings-mic-test' && P.watchConversation) P.watchConversation(t);
            } catch (err) {
                if (global && global.console) global.console.warn('[RemoteSonicAgentSTT] trace skipped:', err);
            }
        }

        _settle(gen) {
            if (gen !== this._gen) return;
            clearTimeout(this._finalTimer);
            if (this._error) return this._failAndEnd(gen, this._error.error, this._error.message);
            if (!this._results.length) {
                return this._failAndEnd(gen, 'no-speech', 'No speech was heard.', 'no_speech');
            }
            this._end(gen);
        }

        _cleanup() {
            clearTimeout(this._finalTimer);
            clearTimeout(this._noSpeechTimer);
            if (this._v1) clearTimeout(this._v1.quietTimer);
            for (const off of this._unsubs || []) {
                try {
                    off();
                } catch (_) {}
            }
            this._unsubs = [];
            if (this._release) {
                this._release();
                this._release = null;
            }
        }

        _failAndEnd(gen, error, message, detail) {
            if (gen !== this._gen || this._state === 'idle') return;
            this._gen++; // nothing of this run may arrive after its error
            if (this._lease) this._lease.close();
            this._cleanup();
            this._state = 'idle';
            this.remoteState = 'failed';
            emitStatus({ type: 'remote-state', state: 'failed', message });
            this._fire('error', { error, message, detail: detail || null });
            this._fire('end');
            emitStatus({ type: 'end', error });
        }

        _end(gen) {
            if (gen !== this._gen || this._state === 'idle') return;
            this._gen++;
            this._cleanup();
            this._state = 'idle';
            this._fire('end');
            emitStatus({ type: 'end' });
        }
    }

    const api = { Recognition: RemoteSonicAgentRecognition, NO_SPEECH_MS, FINAL_TIMEOUT_MS };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_REMOTE_STT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
