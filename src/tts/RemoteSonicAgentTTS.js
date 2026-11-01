/**
 * RemoteSonicAgentTTS — HV4/HV5. SonicAgent's Piper, streamed through OllaBridge Cloud.
 *
 * A provider in the existing TTSProvider registry, id `sonicagent-stream`, with the contract
 * every engine there has — `init`, `speak(text, { onStart, onEnd, onError })`, `stop`,
 * `isAvailable`, `getVoices` — so Settings ▸ TTS ENGINE lists it beside Piper WASM and the
 * built-in voice, and choosing it is stored where every engine choice is (`tts_engine`). It
 * replaces nothing: Piper WASM and the built-in voice are untouched, and a failure here never
 * changes the stored engine (TTSProvider falls back for the session only).
 *
 * How a reply is spoken:
 *
 *   text → phrases (PhraseSpeechScheduler)
 *        → `tts.speak` per phrase on the shared voice link (queued server-side when SonicAgent
 *          granted `tts_queue`; otherwise one at a time, each after the last one's
 *          `tts.audio.done` — HV5's compatibility rule, never concurrent speaks)
 *        → PCM16 frames → a jitter buffer per phrase (order, duplicates, gaps)
 *        → StreamingAudioPlayer, phrase after phrase, gap-free
 *        → `onStart` at the first audible sample, `onEnd` after the last
 *
 * `streamReply()` is HV5: phrases are added while the LLM is still writing, so her first
 * sentence plays while the rest is generated. Each reply is one turn of VoiceTurnController:
 * a newer reply, `stop()`, or a CLEAR cancels the old one everywhere — pending phrases, the
 * server's queue (`turn.cancel` target tts), buffered frames and playing audio.
 *
 * Her mouth follows the audio: LipSyncEngine is driven by the player's level while the turn
 * plays (the text-timed sequence speakText starts cannot know when a network voice is audible).
 */
(function (global) {
    'use strict';

    const ENGINE = 'sonicagent-stream';
    const ACK_EVERY_MS = 200;
    const MAX_IN_FLIGHT = 12;

    function lib(name) {
        return (global && global[name]) || null;
    }

    function err(code, message) {
        const e = new Error(message);
        e.code = code;
        return e;
    }

    const NOT_PAIRED =
        'SonicAgent needs an OllaBridge Cloud connection. Connect OllaBridge in Settings → LLM to use remote voice.';
    const CAPS_TIMEOUT_MS = 8000;

    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
            Promise.resolve(promise).then(
                (v) => {
                    clearTimeout(timer);
                    resolve(v);
                },
                (e) => {
                    clearTimeout(timer);
                    reject(e);
                }
            );
        });
    }

    function create(deps) {
        const d = deps || {};
        const turns = (d.turns || lib('NEXUS_VOICE_TURNS')).create();
        const cfg = () => d.config || lib('NEXUS_SONIC_VOICE');
        const stream = () => d.stream || lib('NEXUS_SONIC_STREAM');
        const player = () => d.player || lib('NEXUS_STREAM_PLAYER').shared();
        const link = () => d.link || stream().shared();
        const Jitter = () => d.jitter || lib('NEXUS_JITTER_BUFFER');
        const Phrases = () => d.phrases || lib('NEXUS_PHRASE_SCHEDULER');
        const lipSync = () => (d.lipSync !== undefined ? d.lipSync : lib('NEXUS_LIP_SYNC'));
        const later = d.setInterval || setInterval;
        const stopLater = d.clearInterval || clearInterval;
        let lastStats = null;
        let lastReadiness = null;
        let perPhraseVoice = true; // HV9: false once a server shows it ignores a phrase's voice

        /** Open a turn: link, player, listeners. Resolves the turn or throws { code, message }. */
        async function openTurn(handlers) {
            const id = turns.begin();
            const h = handlers || {};
            const t = {
                id,
                phrases: [],
                nextPhrase: 0,
                endRequested: false,
                started: false,
                finished: false,
                failed: false,
                serverPhrase: null,
                buffers: new Map(),
                playingIdx: 0,
                h,
                t0: Date.now(),
                stats: {
                    requestAt: Date.now(),
                    firstAudioAt: null,
                    startedAt: null,
                    endedAt: null,
                    cancelledAt: null,
                    phrases: 0,
                    underruns: 0,
                    cold: false,
                    voice: null,
                    server: [],
                },
            };
            const c = cfg();
            const gate = c ? c.allowed('tts') : { ok: false, code: 'disabled' };
            if (!gate.ok) throw err(gate.code, 'Streaming voice is not available: ' + gate.code);
            const language = c.ttsLanguage ? c.ttsLanguage() : c.language();
            // HV9. A preview names its voice; a reply uses the chosen voice for her language and
            // speaking style. Never a voice of another language: none → say so, do not substitute.
            const voiceId = h.voiceId || c.voiceFor(language);
            if (!voiceId) {
                // HV-FIX: no SonicAgent voice for this language (Japanese, Korean, Chinese…), or
                // none playable. Say so; never send another language's voice or a local Piper id.
                const P = lib('NEXUS_VOICE_POLICY');
                const why = P ? P.resolveRemote(c) : null;
                throw err(
                    'voice_unavailable',
                    (why && why.message) || 'No SonicAgent voice is available for the selected language.'
                );
            }
            t.voiceId = voiceId || null;
            const l = link();
            // The voice travels with each phrase (HV9), so an open link is reused as it is. Only a
            // server that ignored a phrase's voice (pre-HV9) makes the link carry the voice.
            const res =
                l.isOpen && l.isOpen() && perPhraseVoice
                    ? await l.ensure({})
                    : await l.ensure(perPhraseVoice ? {} : { voiceId: voiceId || undefined });
            if (!turns.isCurrent(id)) throw err('cancelled', 'superseded');
            if (!res.ok)
                throw err(res.code || 'backend_unavailable', res.message || 'The speech service is unavailable.');
            const session = l.session() || {};
            if (!session.options) {
                // A SonicAgent from before HV3: it would cut every reply longer than two seconds
                // (its queue counted frames sent, not frames waiting). Say so; do not half-speak.
                throw err('requires_hv3', 'The speech service on OllaBridge is too old for streamed speech.');
            }
            if (res.mismatch) throw err('voice_busy', 'The voice link is busy with another language; try again.');
            t.options = res.options;
            t.release = l.retain();
            const p = player();
            await p.beginTurn(id);
            if (!turns.isCurrent(id)) {
                t.release();
                throw err('cancelled', 'superseded');
            }
            p.on('start', (key) => {
                if (key !== id || t.started) return;
                t.started = true;
                t.stats.startedAt = Date.now();
                if (typeof h.onStart === 'function') h.onStart();
            });
            p.on('end', (key) => {
                if (key === id) finish(t);
            });
            p.on('underrun', (key) => {
                if (key === id) t.stats.underruns++;
            });
            t.stats.voice = t.voiceId;
            t.offs = [l.on('event', (ev) => onEvent(t, ev)), l.on('audio', (frame) => onAudio(t, frame))];
            t.offs.push(
                l.on('close', () => {
                    if (!t.finished) fail(t, 'link_closed', 'The voice connection closed.');
                })
            );
            if (t.options.flow_control === 'ack') {
                t.ackTimer = later(() => ack(t), ACK_EVERY_MS);
            }
            const ls = lipSync();
            if (ls && typeof ls.drive === 'function') ls.drive(() => p.level());
            turns.onCancel(id, () => {
                t.stats.cancelledAt = Date.now();
                try {
                    l.sendControl({ type: 'turn.cancel', target: 'tts', turn_id: id });
                } catch (_) {}
                p.stop();
                teardown(t);
            });
            return t;
        }

        function teardown(t) {
            t.finished = true;
            if (t.ackTimer) stopLater(t.ackTimer);
            for (const off of t.offs || []) {
                try {
                    off();
                } catch (_) {}
            }
            t.offs = [];
            for (const b of t.buffers.values()) b.clear();
            if (t.release) {
                t.release();
                t.release = null;
            }
            const ls = lipSync();
            if (ls && typeof ls.undrive === 'function') ls.undrive();
            lastStats = Object.assign({}, t.stats, { failed: t.failed });
        }

        function finish(t) {
            if (t.finished) return;
            t.stats.endedAt = Date.now();
            turns.end(t.id);
            teardown(t);
            if (typeof t.h.onEnd === 'function') t.h.onEnd();
        }

        function fail(t, code, message) {
            if (t.finished) return;
            t.failed = true;
            const wasAudible = t.started;
            turns.cancel(t.id); // runs the turn's cancel: server, player, buffers
            if (!wasAudible && typeof t.h.onError === 'function') t.h.onError(err(code, message));
            else if (typeof t.h.onEnd === 'function') t.h.onEnd(); // she was speaking: end, do not retry
        }

        function addPhrase(t, text) {
            if (t.finished) return;
            t.phrases.push({ id: `${t.id}.${t.phrases.length}`, text, sent: false, done: false });
            t.stats.phrases = t.phrases.length;
            pumpSend(t);
        }

        function inFlight(t) {
            return t.phrases.filter((p) => p.sent && !p.done).length;
        }

        function pumpSend(t) {
            if (t.finished || !t.options) return;
            const l = link();
            while (t.nextPhrase < t.phrases.length) {
                const cap = t.options.tts_queue ? MAX_IN_FLIGHT : 1;
                if (inFlight(t) >= cap) break;
                const ph = t.phrases[t.nextPhrase++];
                ph.sent = true;
                const speak = { type: 'tts.speak', text: ph.text, turn_id: ph.id };
                if (t.voiceId) speak.voice_id = t.voiceId;
                l.sendControl(speak);
            }
            maybeEnd(t);
        }

        function phraseOf(t, turnId) {
            return t.phrases.find((p) => p.id === turnId) || null;
        }

        function onEvent(t, ev) {
            if (t.finished || !turns.isCurrent(t.id) || !ev) return;
            const ph = ev.turn_id ? phraseOf(t, ev.turn_id) : null;
            if (ev.type === 'tts.started' && ph) {
                if (t.voiceId && ev.voice_id && ev.voice_id !== t.voiceId) {
                    // A server from before HV9 spoke in the session's voice, not the phrase's:
                    // stop rather than speak in the wrong voice; the next turn carries it in the link.
                    perPhraseVoice = false;
                    return fail(t, 'voice_unavailable', 'The speech service could not switch to the chosen voice.');
                }
                t.serverPhrase = ph.id;
                if (ev.cold != null) t.stats.cold = t.stats.cold || ev.cold === true;
                const first = t.phrases.indexOf(ph) === 0;
                t.buffers.set(ph.id, Jitter().create({ startMs: first ? cfg().get().jitterMs : 0, maxMs: 30000 }));
            } else if (ev.type === 'tts.audio.done' && ph) {
                ph.done = true;
                let b = t.buffers.get(ph.id);
                if (!b) {
                    // A phrase that produced no audio at all (only punctuation reached Piper).
                    b = Jitter().create({ startMs: 0 });
                    t.buffers.set(ph.id, b);
                }
                b.end();
                pumpPlay(t);
                pumpSend(t);
            } else if (ev.type === 'metrics.turn' && ph) {
                // HV9: per voice and profile, as SonicAgent measured it.
                t.stats.server.push({
                    voice: ev.voice_id || t.voiceId,
                    role: ev.role || null,
                    cold: ev.cold == null ? null : ev.cold,
                    firstMs: ev.tts_first_ms == null ? null : ev.tts_first_ms,
                    synthMs: ev.synth_ms == null ? null : ev.synth_ms,
                    rtf: ev.rtf == null ? null : ev.rtf,
                    audioMs: ev.audio_ms == null ? null : ev.audio_ms,
                });
            } else if (ev.type === 'session.error' && ph) {
                fail(t, ev.code || 'backend_error', ev.message || 'Speech synthesis failed.');
            } else if (ev.type === 'session.error' && !ev.turn_id && ev.code === 'backpressure') {
                fail(t, 'backpressure', ev.message);
            }
        }

        function onAudio(t, frame) {
            if (t.finished || !t.serverPhrase || !turns.isCurrent(t.id)) return;
            const b = t.buffers.get(t.serverPhrase);
            if (!b) return;
            if (t.stats.firstAudioAt == null) t.stats.firstAudioAt = Date.now();
            b.push({
                sequence: frame.sequence,
                samples: stream().pcm16ToFloat(frame.payload),
                sampleRate: frame.sampleRate,
            });
            pumpPlay(t);
        }

        /** Hand released audio to the player, phrase by phrase, never out of order. */
        function pumpPlay(t) {
            const p = player();
            while (t.playingIdx < t.phrases.length) {
                const ph = t.phrases[t.playingIdx];
                const b = t.buffers.get(ph.id);
                if (!b) break;
                for (const piece of b.drain()) {
                    p.push(t.id, ph.id, piece.samples, piece.sampleRate);
                    ph.audioMs = (ph.audioMs || 0) + (piece.samples.length / piece.sampleRate) * 1000;
                }
                if (ph.done && b.finished()) {
                    t.playingIdx++;
                    continue;
                }
                break;
            }
            maybeEnd(t);
        }

        function maybeEnd(t) {
            if (t.finished || !t.endRequested || t.endSent) return;
            if (t.playingIdx < t.phrases.length) return;
            t.endSent = true;
            player().endTurn(t.id);
        }

        /**
         * HV3 flow control: report what has actually played, for every phrase still holding audio
         * on this side — not only the one being received. SonicAgent's budget is the session's
         * unplayed audio across phrases, so an earlier phrase's tail must be acknowledged too.
         */
        function ack(t) {
            if (t.finished) return;
            const p = player();
            for (const ph of t.phrases) {
                if (!ph.sent || ph.acked) continue;
                if (!t.buffers.has(ph.id)) break; // not started on the server yet
                const played = Math.round(p.phrasePlayedMs(ph.id));
                if (played === ph.lastAck) continue;
                ph.lastAck = played;
                link().sendControl({ type: 'playback.ack', turn_id: ph.id, played_ms: played });
                if (ph.done && t.buffers.get(ph.id).finished() && played >= (ph.audioMs || 0) - 1) ph.acked = true;
            }
        }

        function cleanText(text) {
            try {
                const S = lib('NEXUS_SPEECH_TEXT');
                const lang = (cfg() && cfg().language()) || 'en';
                return S ? S.forSpeech(text, { lang }) || '' : text;
            } catch (_) {
                return text;
            }
        }

        const provider = {
            displayName: 'SonicAgent Piper — Cloud streaming',
            id: ENGINE,
            /**
             * HV-FIX. The person chose this engine (TTS ENGINE, Save or TEST VOICE). Choosing it is
             * the switch: before this, the choice failed with "not set up (disabled)" because the
             * real switch sat in ADVANCED VOICE, and the person heard the browser voice instead.
             * Only `enabled` — never microphone consent, which speaking her replies does not need.
             */
            onSelected() {
                const c = cfg();
                if (c && !c.get().enabled) c.set({ enabled: true });
            },
            /**
             * Can SonicAgent speak now? Throws { code, message } with the real reason, which
             * TTSProvider keeps as `lastFailureDetail()` (the stored choice is left alone).
             */
            async init() {
                const c = cfg();
                const gate = c ? c.allowed('tts') : { ok: false, code: 'disabled' };
                if (!gate.ok) {
                    if (gate.code === 'not_configured') throw err('not_configured', NOT_PAIRED);
                    throw err(gate.code, 'SonicAgent voice is switched off in Settings ▸ ADVANCED VOICE.');
                }
                const caps = await withTimeout(c.gateway().capabilities(), CAPS_TIMEOUT_MS).catch((e) => {
                    if (e && e.code === 'unauthenticated') {
                        throw err(
                            'unauthenticated',
                            'OllaBridge Cloud did not accept this device. Pair it again in Settings ▸ LLM.'
                        );
                    }
                    if (e && e.code === 'timeout')
                        throw err('backend_timeout', 'OllaBridge Cloud did not answer in time.');
                    if (e && e.code === 'voice_routes_missing') throw err(e.code, e.message);
                    throw err((e && e.code) || 'backend_unavailable', 'OllaBridge Cloud cannot be reached right now.');
                });
                if (caps && caps.mode && caps.mode !== 'huggingface' && caps.available === false) {
                    // The gateway is up but its operator has not switched voice on (or chose a
                    // mode with no streaming). Nothing on this device can fix that; say so.
                    throw err(
                        'voice_unavailable',
                        `OllaBridge Cloud has remote voice switched off (${caps.reason || caps.mode}). Its operator must enable it.`
                    );
                }
                lastReadiness = caps || null;
                // Learn the voice library and warm the ONE chosen voice, without holding up the
                // choice; a sleeping Space is not a reason to give up on the engine.
                Promise.resolve()
                    .then(() => provider.refreshLibrary())
                    .then(() => provider.warm())
                    .catch(() => {});
            },
            /** What the gateway said at the last init: `available`, `backend.state`, `reason`. */
            readiness: () => (lastReadiness ? Object.assign({}, lastReadiness) : null),
            /** HV9. Read the library through OllaBridge and remember it. Resolves it, or null. */
            async refreshLibrary(fresh) {
                const c = cfg();
                const L = lib('NEXUS_VOICE_LIBRARY');
                const g = c && c.gateway();
                if (!L || !g || typeof g.voices !== 'function') return null;
                try {
                    return c.rememberLibrary(await L.load(g, fresh));
                } catch (e) {
                    // A gateway without HV9 has no /v1/voice/voices: fall back to capabilities.
                    try {
                        c.rememberCapabilities(await g.capabilities());
                    } catch (_) {}
                    return null;
                }
            },
            /** HV9. Load the chosen voice's model on SonicAgent before her first sentence needs it. */
            async warm(voiceId) {
                const c = cfg();
                const g = c && c.gateway();
                const v = voiceId || (c && c.voiceFor(c.ttsLanguage ? c.ttsLanguage() : c.language()));
                if (!v || !g || typeof g.warmVoice !== 'function') return null;
                return g.warmVoice(v);
            },
            /**
             * HV9. Say a short sample in `voiceId` through the same player and lip-sync as her
             * replies. Starting it cancels whatever she was saying (never two voices at once);
             * `stop()` cancels it. Nothing here touches the conversation or its history.
             */
            preview(voiceId, text, handlers) {
                return provider.speak(text, Object.assign({}, handlers || {}, { voiceId }));
            },
            isAvailable() {
                const c = cfg();
                return !!c && c.allowed('tts').ok;
            },
            getVoices() {
                const c = cfg();
                const list = (c && c.installedVoices()) || [];
                return list.map((id) => {
                    const m = /^([a-z]{2})_([A-Z]{2})-([^-]+)/.exec(id);
                    return { id, name: m ? `${m[3]} (${m[1]}-${m[2]})` : id, lang: m ? `${m[1]}-${m[2]}` : '' };
                });
            },
            /** A whole reply. Resolves when she has finished or failed; never rejects. */
            async speak(text, opts) {
                const o = opts || {};
                let t;
                try {
                    t = await openTurn({ onStart: o.onStart, onEnd: o.onEnd, onError: o.onError, voiceId: o.voiceId });
                } catch (e) {
                    if (e.code === 'cancelled') return;
                    if (cfg() && cfg().get().autoFallback && global.TTSProvider && fallbackEngine()) {
                        // HV6, opt-in: an engine on this device, never another remote one.
                        return global.TTSProvider.speak(text, Object.assign({}, o, { engine: fallbackEngine() }));
                    }
                    if (typeof o.onError === 'function') o.onError(e);
                    return;
                }
                const split = Phrases().split(String(text || ''));
                for (const phrase of split) addPhrase(t, phrase);
                t.endRequested = true;
                if (!split.length) return finish(t);
                maybeEnd(t);
            },
            /**
             * HV5. A reply that is still being written. `push(delta)` as tokens arrive;
             * `finish(finalText)` → true when what was spoken is still in the final text (the
             * rest is spoken), false when it is not (everything is cancelled; speak `finalText`
             * the usual way). `cancel()` at any time.
             */
            streamReply(opts) {
                const o = opts || {};
                let t = null;
                let failed = null;
                const early = [];
                const scheduler = Phrases().create({
                    clean: o.clean || cleanText,
                    onPhrase: (phrase) => (t ? addPhrase(t, phrase) : early.push(phrase)),
                });
                const opening = openTurn({ onStart: o.onStart, onEnd: o.onEnd, onError: o.onError })
                    .then((turn) => {
                        t = turn;
                        for (const phrase of early.splice(0)) addPhrase(t, phrase);
                        return t;
                    })
                    .catch((e) => {
                        failed = e;
                        scheduler.cancel();
                        if (e.code !== 'cancelled' && typeof o.onError === 'function') o.onError(e);
                        return null;
                    });
                return {
                    ready: opening.then((x) => !!x),
                    push(delta) {
                        if (!failed) scheduler.push(delta);
                    },
                    async finish(finalText) {
                        const turn = await opening;
                        if (!turn || failed || turn.finished) return false;
                        if (!scheduler.finish(finalText)) {
                            turns.cancel(turn.id);
                            return false;
                        }
                        turn.endRequested = true;
                        if (!turn.phrases.length) finish(turn);
                        else maybeEnd(turn);
                        return true;
                    },
                    cancel() {
                        scheduler.cancel();
                        if (t) turns.cancel(t.id);
                        else opening.then((turn) => turn && turns.cancel(turn.id));
                    },
                    spoken: () => scheduler.spoken(),
                };
            },
            stop() {
                turns.cancel();
            },
            /** HV7: what the last turn measured (ms timestamps), for diagnostics. */
            lastStats: () => (lastStats ? Object.assign({}, lastStats) : null),
            _turns: turns,
        };

        function fallbackEngine() {
            const list =
                (global.TTSProvider && global.TTSProvider.listEngines && global.TTSProvider.listEngines()) || [];
            return list.some((e) => e.id === 'piper-wasm') ? 'piper-wasm' : null;
        }

        return provider;
    }

    let shared = null;

    const api = {
        ENGINE,
        create,
        shared() {
            if (!shared) shared = create();
            return shared;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_REMOTE_TTS = api;

    // Register with the engine registry when it is on the page (it is loaded before this
    // script, both deferred, so TTSProvider's boot at DOMContentLoaded sees this engine).
    try {
        if (global && global.TTSProvider && typeof global.TTSProvider.registerProvider === 'function') {
            global.TTSProvider.registerProvider(ENGINE, api.shared());
        }
    } catch (e) {
        if (global && global.console) global.console.warn('[RemoteSonicAgentTTS] not registered:', e);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
