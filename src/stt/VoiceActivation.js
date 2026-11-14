/**
 * WU. One owner for the microphone.
 *
 * The page already has a tap on `#listen-btn`, Companion hands-free, Companion's
 * wake-word standby, VR push-to-talk and TTS. Each of those used to be free to
 * open a recognizer whenever it liked. Two of them on the same mic is how a
 * held Quest trigger, a wake loop and a tap ended up restarting each other:
 * a recognition `onend` from the session the person had already cancelled
 * called `start()` again.
 *
 * This module does not recognise speech. `NEXUS_STT.recognitionClass()` still
 * builds the recognizer (browser, on-device Whisper, or SonicAgent — whichever
 * Settings chose). What this module owns is the arbitration: who may open that
 * recognizer, and which generation a late callback belongs to. A callback whose
 * generation is not current is dropped, so cancelling cannot be undone by the
 * event that arrives afterwards.
 *
 * Two modes share the button and never share the microphone.
 *
 *   Tap, while idle: a hands-free conversation. Each finished sentence is sent,
 *   and after she has finished speaking the same session listens again, until
 *   Stop or a second tap. The wake phrase is not required inside that session.
 *   Hold for three seconds, while idle: toggles Wake Word and saves it. That is
 *   the same switch as Settings. It does not record a sentence. While Wake Word
 *   is on, the page waits for the name, takes the command that follows, answers,
 *   and waits for the name again.
 *
 * The name is spotted on the device. A local detector injected as
 * `NEXUS_WAKE_DETECTOR` (`local: true`) is used when one is present. Otherwise
 * on-device Whisper reads a ring buffer of the microphone and the phrase is
 * matched in that transcript. The buffer is the pre-roll: "Nexus, what is the
 * weather" is one window, and the words after the name are the request. Audio
 * is not streamed to a cloud recognizer to notice the name. Picovoice Porcupine
 * is the usual engine for this and is not shipped — its license is not
 * Apache-2.0, and "Nexus" is not a built-in keyword. With no on-device spotter
 * the tap conversation still works and wake word stays unavailable. Nothing
 * here listens with the tab hidden, the browser closed, or the phone locked.
 *
 * Exposes: window.NEXUS_VOICE_ACTIVATION
 */
(function (global) {
    'use strict';

    const STATES = Object.freeze([
        'OFF',
        'STANDBY',
        'LISTENING',
        'TRANSCRIBING',
        'SENDING',
        'RESPONDING',
        'PAUSED',
        'ERROR',
    ]);

    const DEFAULTS = Object.freeze({
        holdMs: 3000,
        // A pause shorter than this keeps the sentence open. Sustained quiet
        // at endSilenceMs ends it. Both are starting points, not a measured room.
        minPauseMs: 800,
        endSilenceMs: 1200,
        // A clause with no ending punctuation waits longer. This is a pause
        // rule, not a semantic turn model — none is bundled.
        hesitationMs: 1800,
        noSpeechMs: 7000,
        maxUtteranceMs: 30000,
        echoGuardMs: 800,
        slopPx: 16,
        phraseCheckMs: 5000,
        respondFallbackMs: 1500,
        spotWindowMs: 3500,
        spotStepMs: 1200,
        ringSeconds: 8,
        commandFloor: 0.02,
    });

    const STORAGE = Object.freeze({
        enabled: 'nexus_wake_enabled',
        phrase: 'nexus_wake_phrase',
        autosend: 'nexus_wake_autosend',
        continuous: 'nexus_wake_continuous',
        paused: 'nexus_wake_paused',
        maxMs: 'nexus_wake_max_ms',
        migrated: 'nexus_wake_migrated',
    });

    /**
     * Labels follow AppLanguage's code. Kept here, not in AppLanguage, because
     * they describe this feature only — Companion's existing strings stay the
     * ones it already ships. Missing keys fall back to English.
     */
    const COPY = {
        'en-US': {
            wakeTitle: 'WAKE UP',
            wakeToggle: 'Wake word',
            wakeDisclosure:
                'Wake word stays on this device: the name is recognized here, and audio is not sent away just to notice it. Say “Nexus” and the request that follows is taken, answered, and then NEXUS waits for the name again. A tap starts a hands-free conversation that listens again after each reply, until you end it. Hold the microphone for three seconds to turn wake word on or off. Nothing listens while this tab is hidden, the browser is closed, or the phone is locked. Off until you turn it on.',
            wakePhrase: 'Activation phrase',
            wakePhraseCustom: 'Custom phrase',
            wakeAutosend: 'Auto-send completed speech',
            wakeAutosendHelp:
                'A finished sentence is sent on its own. A tap starts a conversation; a three-second hold turns wake word on or off.',
            wakeContinuous: 'Continuous conversation',
            wakeContinuousHelp:
                'After Nexus replies, a conversation you started with a tap listens for the next question. A quiet moment ends that sentence, not the conversation. Stop stays on screen until you end it. Wake word still waits for the name.',
            wakeMax: 'Longest one turn',
            wakeMic: 'Microphone',
            wakeMicGranted: 'Microphone allowed',
            wakeMicDenied: 'Microphone blocked',
            wakeMicPrompt: 'Microphone not requested yet',
            wakeMicUnknown: 'Microphone status unavailable',
            wakeMicUnsupported: 'This browser has no microphone API',
            wakeTest: 'Test wake word',
            wakeSpeak: 'Speak and send',
            wakeSpeakHelp: 'Starts the same hands-free conversation as a tap on the microphone.',
            wakePause: 'Pause listening',
            wakeResume: 'Resume listening',
            wakeStop: 'Stop listening',
            wakeStopConversation: 'Stop conversation',
            wakeTimeout: 'That turn reached the time limit. Still in the conversation.',
            wakeRecover: 'Voice input dropped. Listening again.',
            wakeHold: 'Keep holding to switch wake word…',
            wakeRelease: 'Release to switch wake word',
            wakeHint: 'Tap for a voice conversation, or hold for 3 seconds to turn wake word on.',
            wakeOnConfirm: 'Wake word on. Say Nexus.',
            wakeOffConfirm: 'Wake word off.',
            conversationOn: 'Conversation on. Listening for your next question after each reply.',
            conversationOff: 'Conversation ended.',
            wakeListening: 'Listening…',
            wakeTranscribing: 'Transcribing…',
            wakeSpeaking: 'Speaking…',
            wakeStandby: 'Say the wake phrase',
            wakePaused: 'Wake listening paused',
            wakeOff: 'Wake word is off',
            wakeDenied: 'Microphone permission denied',
            wakeBusy: 'Microphone is in use',
            wakeNoSpeech: 'No speech heard',
            wakeUnsupported: 'Wake listening needs a microphone. Use Speak and send, or type.',
            wakeHidden: 'Wake listening pauses while this tab is hidden.',
            wakeClosed: 'Wake listening does not run while the browser is closed or the phone is locked.',
            wakeTestHit: 'Wake phrase heard',
            wakeTestMiss: 'That was not the wake phrase',
            wakeCompanion:
                'Companion’s own wake word still runs only inside Companion. Leaving it on does not listen in the main chat.',
            wakeManual: 'On-device wake detection is not available here. Tap the microphone for a conversation.',
            wakeError: 'Voice input stopped',
        },
        'it-IT': {
            wakeTitle: 'SVEGLIA',
            wakeToggle: 'Parola di attivazione',
            wakeDisclosure:
                'La parola di attivazione resta sul dispositivo: il nome si riconosce qui e l’audio non viene inviato solo per accorgersene. Di’ “Nexus” e la richiesta che segue viene presa, risposta, e poi NEXUS aspetta di nuovo il nome. Un tocco avvia una conversazione a mani libere che riascolta dopo ogni risposta, finché non la chiudi. Tieni premuto il microfono per tre secondi per accendere o spegnere la parola. Non ascolta con la scheda nascosta, il browser chiuso o il telefono bloccato. Resta spento finché non lo attivi.',
            wakePhrase: 'Frase di attivazione',
            wakePhraseCustom: 'Frase personalizzata',
            wakeAutosend: 'Invia automaticamente il parlato concluso',
            wakeAutosendHelp:
                'La frase finita viene inviata da sola. Un tocco avvia la conversazione; tre secondi accendono o spengono la parola di attivazione.',
            wakeContinuous: 'Conversazione continua',
            wakeContinuousHelp:
                'Dopo la risposta, una conversazione avviata con un tocco ascolta la domanda successiva. Una pausa chiude la frase, non la conversazione. Chiudi resta visibile finché non la termini. La parola di attivazione aspetta ancora il nome.',
            wakeMax: 'Durata massima di un turno',
            wakeMic: 'Microfono',
            wakeMicGranted: 'Microfono consentito',
            wakeMicDenied: 'Microfono bloccato',
            wakeMicPrompt: 'Microfono non ancora richiesto',
            wakeMicUnknown: 'Stato del microfono non disponibile',
            wakeMicUnsupported: 'Questo browser non ha un’API microfono',
            wakeTest: 'Prova la parola di attivazione',
            wakeSpeak: 'Parla e invia',
            wakeSpeakHelp: 'Avvia la stessa conversazione a mani libere di un tocco sul microfono.',
            wakePause: 'Metti in pausa',
            wakeResume: 'Riprendi l’ascolto',
            wakeStop: 'Interrompi l’ascolto',
            wakeStopConversation: 'Chiudi la conversazione',
            wakeTimeout: 'Quel turno ha raggiunto il limite. La conversazione resta aperta.',
            wakeRecover: 'L’input vocale si è interrotto. Di nuovo in ascolto.',
            wakeHold: 'Tieni premuto per cambiare la parola di attivazione…',
            wakeRelease: 'Rilascia per cambiare la parola di attivazione',
            wakeHint: 'Tocca per una conversazione, oppure tieni premuto 3 secondi per la parola di attivazione.',
            wakeOnConfirm: 'Parola di attivazione attiva. Di’ Nexus.',
            wakeOffConfirm: 'Parola di attivazione disattivata.',
            conversationOn: 'Conversazione attiva. In ascolto della prossima domanda dopo ogni risposta.',
            conversationOff: 'Conversazione chiusa.',
            wakeListening: 'In ascolto…',
            wakeTranscribing: 'Trascrizione…',
            wakeSpeaking: 'Sta parlando…',
            wakeStandby: 'Di’ la frase di attivazione',
            wakePaused: 'Ascolto in pausa',
            wakeOff: 'Parola di attivazione disattivata',
            wakeDenied: 'Permesso del microfono negato',
            wakeBusy: 'Microfono in uso',
            wakeNoSpeech: 'Nessun parlato',
            wakeUnsupported: 'Serve un microfono. Usa Parla e invia, oppure scrivi.',
            wakeHidden: 'L’ascolto va in pausa quando questa scheda non è visibile.',
            wakeClosed: 'L’ascolto non funziona con il browser chiuso o il telefono bloccato.',
            wakeTestHit: 'Frase di attivazione riconosciuta',
            wakeTestMiss: 'Non era la frase di attivazione',
            wakeCompanion:
                'La parola di attivazione di Companion resta solo dentro Companion. Lasciarla accesa non ascolta nella chat principale.',
            wakeManual: 'Il rilevamento sul dispositivo non è disponibile. Tocca il microfono per una conversazione.',
            wakeError: 'Input vocale interrotto',
        },
    };

    COPY['en-GB'] = COPY['en-US'];

    function langBase(code) {
        const c = String(code || 'en-US');
        if (COPY[c]) return c;
        const short = c.toLowerCase().slice(0, 2);
        if (short === 'it') return 'it-IT';
        if (short === 'en') return 'en-US';
        return 'en-US';
    }

    function labelsFor(code) {
        const pack = COPY[langBase(code)] || COPY['en-US'];
        return Object.assign({}, COPY['en-US'], pack);
    }

    function norm(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Exact word-span match. CompanionMode._matchesWake is the tolerant one
     * used when that class is loaded; this is the fallback so a page without
     * Companion still rejects "hey nexus" inside a longer unrelated word only
     * by splitting on spaces ("hey nexus" does not match "heynexus").
     * Returns the length of the matched prefix in the normalized string, or -1.
     */
    function localMatch(heardNorm, phraseNorm) {
        if (!heardNorm || !phraseNorm) return -1;
        const heard = heardNorm.split(' ');
        const phrase = phraseNorm.split(' ');
        const span = phrase.length;
        for (let i = 0; i + span <= heard.length; i++) {
            let all = true;
            for (let k = 0; k < span; k++) {
                if (heard[i + k] !== phrase[k]) {
                    all = false;
                    break;
                }
            }
            if (all) return heard.slice(0, i + span).join(' ').length;
        }
        return -1;
    }

    function defaultPhrase() {
        // The name is the activation phrase in every language. "Hey Nexus" and
        // "Ehi Nexus" stay selectable; they are not assumed.
        return 'nexus';
    }

    /**
     * A fixed-capacity float buffer. The spotter transcribes the tail, and the
     * command that was already in the air when the name was noticed is still
     * in the tail — that is the pre-roll. Dropping the capture and opening a
     * new recognizer is how the start of "open my calendar" used to vanish.
     */
    function createPcmRing(capacity) {
        const size = Math.max(1, capacity | 0);
        const buf = new Float32Array(size);
        let write = 0;
        let count = 0;
        function push(samples) {
            const src = samples || [];
            for (let i = 0; i < src.length; i++) {
                buf[write] = src[i];
                write = (write + 1) % size;
                if (count < size) count++;
            }
        }
        function snapshot(maxSamples) {
            const n = Math.min(count, Math.max(0, maxSamples | 0));
            const out = new Float32Array(n);
            const start = (write - n + size) % size;
            for (let i = 0; i < n; i++) out[i] = buf[(start + i) % size];
            return out;
        }
        return {
            push: push,
            snapshot: snapshot,
            filled: function () {
                return count;
            },
        };
    }

    function rmsOf(samples) {
        if (!samples || !samples.length) return 0;
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        return Math.sqrt(sum / samples.length);
    }

    /**
     * Where a wake hit is allowed to go. Pure: the controller passes facts,
     * the tests pass the same facts without a microphone.
     *
     * `authorized` is not the opt-in checkbox. The checkbox is `enabled`.
     * `authorized` means this hit came from a monitor this module started
     * and has not since cancelled. A delayed callback from a stopped
     * generation never gets here with authorized true.
     */
    function decideWake(input) {
        const i = input || {};
        if (!i.enabled) return { action: 'ignore', reason: 'disabled' };
        if (i.paused) return { action: 'ignore', reason: 'paused' };
        if (i.hidden) return { action: 'ignore', reason: 'hidden' };
        if (i.speaking || i.echo) return { action: 'ignore', reason: 'echo' };
        if (i.companionOwnsMic) return { action: 'ignore', reason: 'companion' };
        if (!i.authorized) return { action: 'ignore', reason: 'unauthorized' };
        if (i.permission === 'denied') return { action: 'error', reason: 'denied' };
        if (!i.matched) return { action: 'ignore', reason: 'mismatch' };
        const command = String(i.command || '').trim();
        if (command) return { action: 'send-command', command: command, reason: 'command' };
        return { action: 'session', reason: 'listen' };
    }

    /**
     * Which standby implementation may run. `off` when the person has not
     * opted in — including when only Companion's overlay_wakeword is stored.
     * Never `continuous-cloud`, and never an energy meter: loudness is not the
     * name. `local-spotter` transcribes a ring buffer on the device.
     * `manual-only` means the tap conversation works and the name is not watched.
     */
    function monitorPlan(input) {
        const i = input || {};
        if (!i.enabled) return 'off';
        if (i.paused || i.hidden) return 'paused';
        if (i.speaking) return 'suspended';
        if (i.companionActive) return 'companion';
        if (i.detectorLocal) return 'local-detector';
        if (i.localTranscribe) return 'local-spotter';
        return 'manual-only';
    }

    /**
     * The three-second hold, as data. DOM listeners are a thin shell over this
     * so a test can advance time without a real pointer.
     *
     * A release before the threshold does not activate and does not swallow
     * the click that follows — that click starts or ends the conversation.
     * Reaching the threshold arms a wake-word toggle, not a recording; the
     * synthetic click is swallowed so it cannot also start that conversation.
     * pointercancel,
     * a drag past the slop, pagehide and disable never activate, and they
     * swallow a click too: a cancelled press must not turn the mic on.
     */
    function createHoldTracker(opts) {
        const holdMs = (opts && opts.holdMs) || DEFAULTS.holdMs;
        const slop = (opts && opts.slopPx) || DEFAULTS.slopPx;
        const slop2 = slop * slop;
        let pointerId = null;
        let t0 = 0;
        let x = 0;
        let y = 0;
        let phase = 'idle';
        let suppressNext = false;

        function idle() {
            pointerId = null;
            phase = 'idle';
        }

        function pointerdown(e, now) {
            if (!e || (e.button != null && e.button !== 0)) return { action: 'ignore' };
            if (pointerId != null) return { action: 'ignore' };
            pointerId = e.pointerId;
            t0 = now;
            x = e.clientX || 0;
            y = e.clientY || 0;
            phase = 'pressing';
            return { action: 'press', deadline: now + holdMs };
        }

        function tick(now) {
            if (phase !== 'pressing') return { action: 'ignore' };
            if (now - t0 < holdMs) return { action: 'ignore' };
            phase = 'armed';
            return { action: 'arm' };
        }

        function pointermove(e) {
            if (!e || e.pointerId !== pointerId || phase !== 'pressing') return { action: 'ignore' };
            const dx = (e.clientX || 0) - x;
            const dy = (e.clientY || 0) - y;
            if (dx * dx + dy * dy <= slop2) return { action: 'ignore' };
            suppressNext = true;
            idle();
            return { action: 'drag-cancel' };
        }

        function pointerup(e, now) {
            if (!e || e.pointerId !== pointerId) return { action: 'ignore' };
            const was = phase;
            if (was === 'pressing' && now - t0 >= holdMs) phase = 'armed';
            const armed = phase === 'armed';
            idle();
            if (armed) {
                suppressNext = true;
                return { action: 'activate' };
            }
            return { action: 'release' };
        }

        function pointercancel(e) {
            if (pointerId == null) return { action: 'ignore' };
            if (e && e.pointerId != null && e.pointerId !== pointerId) return { action: 'ignore' };
            const armed = phase === 'armed';
            suppressNext = true;
            idle();
            return { action: 'cancel', armed: armed };
        }

        function click() {
            if (suppressNext) {
                suppressNext = false;
                return { suppress: true };
            }
            return { suppress: false };
        }

        function keydown(e, now) {
            if (!e || e.repeat) return { action: 'ignore' };
            if (e.key !== ' ' && e.key !== 'Enter') return { action: 'ignore' };
            return pointerdown({ pointerId: 'key:' + e.key, button: 0, clientX: 0, clientY: 0 }, now);
        }

        function keyup(e, now) {
            if (!e || (e.key !== ' ' && e.key !== 'Enter')) return { action: 'ignore' };
            return pointerup({ pointerId: 'key:' + e.key }, now);
        }

        return {
            pointerdown,
            pointermove,
            pointerup,
            pointercancel,
            tick,
            click,
            keydown,
            keyup,
            pagehide: () => pointercancel(null),
            disable: () => pointercancel(null),
            phase: () => phase,
            tracking: () => pointerId != null,
        };
    }

    function createVoiceActivation(options) {
        const deps = Object.assign(
            {
                now: function () {
                    return Date.now();
                },
                defaults: DEFAULTS,
            },
            options || {}
        );

        let state = 'OFF';
        let owner = null;
        let sessionGen = 0;
        let wakeGen = 0;
        let resumeToken = 0;
        let speaking = false;
        let echoUntil = 0;
        let lastSpoken = '';
        let lastSpokenAt = 0;
        let companionActive = false;
        let hidden = false;
        let booted = false;
        let monitorOn = false;
        let manualOpen = false;
        let errorStrikes = 0;
        let sessionMode = null;
        let activeRec = null;
        let phraseRec = null;
        let sessionDone = false;
        let spotTimer = null;
        let captureLease = null;
        let vadTimer = null;
        let vadStream = null;
        let vadCtx = null;
        const streams = new Set();
        let settings = blankSettings();
        const listeners = new Set();

        function blankSettings() {
            return {
                wakeEnabled: false,
                phrase: '',
                phraseCustom: false,
                autoSend: true,
                continuous: true,
                paused: false,
                maxMs: DEFAULTS.maxUtteranceMs,
                migrated: false,
            };
        }

        function store() {
            try {
                if (deps.storage) return deps.storage;
                return global && global.localStorage ? global.localStorage : null;
            } catch (_) {
                return null;
            }
        }

        function readKey(key) {
            try {
                const s = store();
                if (!s) return null;
                const v = s.getItem(key);
                return v == null ? null : String(v);
            } catch (_) {
                return null;
            }
        }

        function writeKey(key, value) {
            try {
                const s = store();
                if (!s) return;
                if (value == null || value === '') s.removeItem(key);
                else s.setItem(key, String(value));
            } catch (_) {}
        }

        function language() {
            try {
                if (typeof deps.language === 'function') return deps.language() || 'en-US';
                if (global.AppLanguage && global.AppLanguage.code) return global.AppLanguage.code;
                if (global.SpeechSettings && global.SpeechSettings.lang) return global.SpeechSettings.lang;
            } catch (_) {}
            return 'en-US';
        }

        function label(key) {
            const pack = labelsFor(language());
            return pack[key] || COPY['en-US'][key] || '';
        }

        function log(message) {
            // Codes only. A transcript — private or not — is never an argument.
            try {
                if (global.console && global.console.info) global.console.info('[VoiceActivation]', message);
            } catch (_) {}
        }

        function isPrivate() {
            try {
                if (typeof deps.isPrivate === 'function') return !!deps.isPrivate();
                const surface = global.NEXUS_CONVERSATION_SURFACE;
                const cur = surface && surface.current ? surface.current() : null;
                return !!(cur && cur.id === 'private');
            } catch (_) {
                return false;
            }
        }

        function setState(next) {
            if (STATES.indexOf(next) === -1) next = 'ERROR';
            if (state === next) return;
            state = next;
            for (const fn of Array.from(listeners)) {
                try {
                    fn(state, owner);
                } catch (_) {}
            }
            paint();
        }

        function paint() {
            try {
                if (typeof deps.onState === 'function') deps.onState(state, owner);
            } catch (_) {}
            if (!global.document || deps.dom === false) return;
            const status = global.document.getElementById('recognition-status');
            const btn = global.document.getElementById('listen-btn');
            const feedback = global.document.getElementById('wake-feedback');
            const ours = owner === 'manual' || owner === 'hold' || owner === 'assist' || owner === 'wake';
            let line = '';
            if (state === 'LISTENING' && ours) line = label(owner === 'manual' ? 'conversationOn' : 'wakeListening');
            else if (state === 'TRANSCRIBING') line = label('wakeTranscribing');
            else if (state === 'RESPONDING' && (ours || manualOpen)) line = label('wakeSpeaking');
            else if (state === 'STANDBY' && settings.wakeEnabled) line = label('wakeStandby');
            else if (state === 'PAUSED') line = hidden ? label('wakeHidden') : label('wakePaused');
            else if (state === 'ERROR') line = label('wakeError');
            else if (state === 'OFF' && !manualOpen) line = label('wakeHint');
            if (status && line && owner !== 'tap' && owner !== 'vr' && owner !== 'companion') status.textContent = line;
            if (feedback && line) feedback.textContent = line;
            if (btn && owner !== 'tap' && owner !== 'vr' && owner !== 'companion') {
                const listening = state === 'LISTENING' && ours;
                const processing = state === 'TRANSCRIBING' || (state === 'RESPONDING' && ours);
                const standby = state === 'STANDBY' && settings.wakeEnabled && !listening;
                btn.classList.toggle('active', listening);
                btn.classList.toggle('processing', processing);
                btn.classList.toggle('wake-standby', standby);
                btn.setAttribute('aria-pressed', listening || processing || standby ? 'true' : 'false');
                btn.dataset.wakeTitle = '1';
                btn.title = label('wakeHint');
            }
            const pauseBtn = global.document.getElementById('wake-pause');
            if (pauseBtn) pauseBtn.textContent = settings.paused ? label('wakeResume') : label('wakePause');
            const endBtn = global.document.getElementById('end-conversation');
            if (endBtn) {
                endBtn.hidden = !manualOpen;
                endBtn.textContent = label('wakeStopConversation');
            }
        }

        function recognitionClass() {
            try {
                if (typeof deps.recognitionClass === 'function') return deps.recognitionClass();
                if (global.NEXUS_STT && global.NEXUS_STT.recognitionClass) return global.NEXUS_STT.recognitionClass();
            } catch (err) {
                log('recognition-class-failed');
            }
            return (global && (global.SpeechRecognition || global.webkitSpeechRecognition)) || null;
        }

        function detector() {
            try {
                const d = typeof deps.detector === 'function' ? deps.detector() : global.NEXUS_WAKE_DETECTOR;
                // `local: true` is not evidence. The host has to say the audio
                // does not leave the device. We still only hand it PCM we hold,
                // or call start/stop — we never open a cloud recognizer for it.
                if (d && d.audioLeavesDevice !== false) {
                    log('detector-refused-audio-unverified');
                    return null;
                }
                if (d && d.local === true && typeof d.start === 'function' && typeof d.stop === 'function') return d;
                if (d && d.local !== true) log('detector-refused-not-local');
            } catch (_) {}
            return null;
        }

        function canVad() {
            try {
                if (typeof deps.canVad === 'function') return !!deps.canVad();
                const md = global.navigator && global.navigator.mediaDevices;
                const AC = global.AudioContext || global.webkitAudioContext;
                return !!(md && md.getUserMedia && AC);
            } catch (_) {
                return false;
            }
        }

        function overlayWakeOn() {
            return readKey('overlay_wakeword') === 'on';
        }

        function canTranscribeLocal() {
            try {
                if (typeof deps.transcribeLocal === 'function') return true;
                const stt = global.NEXUS_STT;
                if (!stt || typeof stt.transcribeSamples !== 'function') return false;
                // SonicAgent is an app-owned recognizer and still a network.
                // Wake spotting refuses it. The tap conversation may still use it.
                if (typeof stt.isRemote === 'function' && stt.isRemote()) return false;
                if (typeof stt.isLocal === 'function') return !!stt.isLocal();
            } catch (_) {}
            return false;
        }

        function transcribeLocal(samples, rate) {
            if (typeof deps.transcribeLocal === 'function') {
                return deps.transcribeLocal(samples, rate, { language: language() });
            }
            const stt = global.NEXUS_STT;
            return stt.transcribeSamples(samples, rate, { language: language() });
        }

        function plan() {
            return monitorPlan({
                enabled: settings.wakeEnabled,
                paused: settings.paused,
                hidden: hidden,
                speaking: speaking || depsNow() < echoUntil,
                companionActive: companionActive,
                detectorLocal: !!detector(),
                localTranscribe: canTranscribeLocal(),
            });
        }

        function depsNow() {
            try {
                return deps.now();
            } catch (_) {
                return Date.now();
            }
        }

        function isEcho(heard) {
            if (speaking) return true;
            if (depsNow() < echoUntil) return true;
            try {
                if (typeof deps.isSpeaking === 'function' && deps.isSpeaking()) return true;
                const ind = global.document && global.document.getElementById('status-indicator');
                if (ind && ind.classList && ind.classList.contains('speaking')) return true;
                if (global.speechSynthesis && global.speechSynthesis.speaking) return true;
            } catch (_) {}
            const h = norm(heard);
            if (h && lastSpoken && depsNow() - lastSpokenAt < DEFAULTS.echoGuardMs && lastSpoken.indexOf(h) !== -1) {
                return true;
            }
            return false;
        }

        function busy() {
            return state === 'LISTENING' || state === 'TRANSCRIBING' || state === 'SENDING';
        }

        function matchWake(heard, phrase) {
            const h = norm(heard);
            const p = norm(phrase);
            try {
                const fn = deps.matchWake || (global.CompanionMode && global.CompanionMode._matchesWake) || localMatch;
                const end = fn(h, p);
                if (typeof end !== 'number' || end < 0) return null;
                return { command: h.slice(end).trim() };
            } catch (_) {
                return null;
            }
        }

        function activePhrase() {
            if (settings.phrase) return settings.phrase;
            return defaultPhrase(language());
        }

        function loadSettings() {
            const enabled = readKey(STORAGE.enabled) === 'on';
            const storedPhrase = readKey(STORAGE.phrase);
            const autosend = readKey(STORAGE.autosend);
            const continuousRaw = readKey(STORAGE.continuous);
            // A new install resumes a tapped conversation. An explicit "off" stays off.
            const continuous = continuousRaw == null ? true : continuousRaw === 'on';
            const paused = readKey(STORAGE.paused) === 'on';
            const maxRaw = Number(readKey(STORAGE.maxMs));
            const maxMs = maxRaw === 60000 || maxRaw === 120000 ? maxRaw : DEFAULTS.maxUtteranceMs;
            settings = {
                wakeEnabled: enabled,
                phrase: storedPhrase || '',
                phraseCustom: !!storedPhrase,
                autoSend: autosend == null ? true : autosend === 'on',
                continuous: continuous,
                paused: paused,
                maxMs: maxMs,
                migrated: readKey(STORAGE.migrated) === '1',
            };
            return currentSettings();
        }

        function currentSettings() {
            return {
                wakeEnabled: settings.wakeEnabled,
                phrase: activePhrase(),
                phraseStored: settings.phrase,
                autoSend: settings.autoSend,
                continuous: settings.continuous,
                paused: settings.paused,
                maxMs: settings.maxMs,
                migrated: settings.migrated,
                overlayWakeWord: overlayWakeOn(),
            };
        }

        /**
         * Copy a custom Companion phrase across. Never copies overlay_wakeword
         * into the page-level switch: that switch starts a listener outside
         * Companion, and the person has not asked for one.
         */
        function migrate() {
            if (readKey(STORAGE.migrated) === '1') {
                settings.migrated = true;
                return { migrated: true, copiedPhrase: false, enabledStaysOff: true };
            }
            const overlayPhrase = readKey('overlay_wakephrase');
            let copied = false;
            if (overlayPhrase && !readKey(STORAGE.phrase)) {
                writeKey(STORAGE.phrase, norm(overlayPhrase));
                copied = true;
            }
            writeKey(STORAGE.migrated, '1');
            if (readKey(STORAGE.enabled) == null) writeKey(STORAGE.enabled, 'off');
            loadSettings();
            return { migrated: true, copiedPhrase: copied, enabledStaysOff: settings.wakeEnabled === false };
        }

        function persist() {
            writeKey(STORAGE.enabled, settings.wakeEnabled ? 'on' : 'off');
            if (settings.phrase) writeKey(STORAGE.phrase, settings.phrase);
            writeKey(STORAGE.autosend, settings.autoSend ? 'on' : 'off');
            writeKey(STORAGE.continuous, settings.continuous ? 'on' : 'off');
            writeKey(STORAGE.paused, settings.paused ? 'on' : 'off');
            writeKey(STORAGE.maxMs, String(settings.maxMs || DEFAULTS.maxUtteranceMs));
        }

        function stopStream(stream) {
            if (!stream) return;
            streams.delete(stream);
            try {
                stream.getTracks().forEach(function (t) {
                    try {
                        t.stop();
                    } catch (_) {}
                });
            } catch (_) {}
        }

        function stopAllTracks() {
            Array.from(streams).forEach(stopStream);
            streams.clear();
            if (vadTimer) {
                clearInterval(vadTimer);
                vadTimer = null;
            }
            if (vadCtx) {
                try {
                    vadCtx.close();
                } catch (_) {}
                vadCtx = null;
            }
            vadStream = null;
        }

        function killRec(rec) {
            if (!rec) return;
            try {
                rec.onresult = null;
                rec.onerror = null;
                rec.onend = null;
                rec.onaudioend = null;
                rec.onstart = null;
            } catch (_) {}
            try {
                if (typeof rec.abort === 'function') rec.abort();
                else if (typeof rec.stop === 'function') rec.stop();
            } catch (_) {}
        }

        function stopOwnMonitor() {
            monitorOn = false;
            wakeGen++;
            const det = detector();
            if (det) {
                try {
                    det.stop();
                } catch (_) {}
            }
            killRec(phraseRec);
            phraseRec = null;
            if (spotTimer) {
                clearInterval(spotTimer);
                spotTimer = null;
            }
            if (captureLease) {
                try {
                    captureLease.close();
                } catch (_) {}
                captureLease = null;
            }
            stopAllTracks();
        }

        function claim(next) {
            if (!next) return false;
            if (owner === next) return true;
            if (busy() && owner && owner !== next) return false;
            const prev = owner;
            owner = next;
            stopOwnMonitor();
            if (prev === 'companion' && next !== 'companion') {
                try {
                    if (global.companionMode && typeof global.companionMode.stopStandby === 'function') {
                        global.companionMode.stopStandby();
                    }
                } catch (_) {}
            }
            return true;
        }

        function release(who) {
            if (!who || owner !== who) return false;
            owner = null;
            if (state === 'LISTENING' || state === 'TRANSCRIBING' || state === 'SENDING') {
                // The owner closed its own recognizer. Don't abort a session we
                // don't hold — tap and VR keep theirs. Our sessions are cancelled
                // by cancel() before release.
            }
            if (settings.wakeEnabled && !settings.paused && !hidden && !companionActive && !speaking && !busy()) {
                armMonitor();
            } else if (state !== 'ERROR') {
                setState(settings.paused || hidden ? 'PAUSED' : 'OFF');
            }
            return true;
        }

        function adopt(next, nextState) {
            if (owner && owner !== next && busy()) return false;
            owner = next;
            setState(nextState || 'LISTENING');
            return true;
        }

        function armMonitor() {
            const which = plan();
            if (which === 'off') {
                stopOwnMonitor();
                if (!busy()) setState('OFF');
                return which;
            }
            if (which === 'paused') {
                stopOwnMonitor();
                if (!busy()) setState('PAUSED');
                return which;
            }
            if (which === 'suspended') {
                // She just spoke. Wait out the echo guard, then watch for the
                // name again. This is not the user's Pause.
                stopOwnMonitor();
                const wait = Math.max(0, echoUntil - depsNow());
                const token = resumeToken;
                setTimeout(function () {
                    if (token !== resumeToken) return;
                    if (!settings.wakeEnabled || settings.paused || hidden || manualOpen || speaking || busy()) return;
                    armMonitor();
                }, wait);
                return which;
            }
            if (which === 'manual-only') {
                stopOwnMonitor();
                if (!busy()) setState('OFF');
                feedbackKey('wakeManual');
                return which;
            }
            if (which === 'companion') {
                stopOwnMonitor();
                try {
                    if (global.companionMode && global.companionMode.active && global.companionMode.startStandby) {
                        global.companionMode.startStandby();
                    }
                } catch (_) {}
                if (!busy()) setState('STANDBY');
                return which;
            }
            if (monitorOn && (state === 'STANDBY' || state === 'LISTENING')) return which;
            stopOwnMonitor();
            monitorOn = true;
            const gen = wakeGen;
            setState('STANDBY');
            owner = 'wake';
            if (which === 'local-detector') startDetector(gen);
            else if (which === 'local-spotter') startLocalSpotter(gen);
            else {
                monitorOn = false;
                owner = null;
                feedbackKey('wakeManual');
                setState('OFF');
            }
            return which;
        }

        function sync() {
            if (busy() && owner && owner !== 'wake') return plan();
            if (!settings.wakeEnabled) {
                if (owner === 'wake') {
                    cancel('disabled');
                } else {
                    stopOwnMonitor();
                    if (!busy() && state !== 'RESPONDING') setState(settings.paused ? 'PAUSED' : 'OFF');
                }
                return plan();
            }
            if (settings.paused || hidden) {
                stopOwnMonitor();
                if (owner === 'wake') owner = null;
                if (!busy()) setState('PAUSED');
                return plan();
            }
            return armMonitor();
        }

        function startDetector(gen) {
            const det = detector();
            if (!det || gen !== wakeGen) return;
            try {
                det.start({
                    phrase: activePhrase(),
                    lang: language(),
                    shouldPause: function () {
                        return gen !== wakeGen || speaking || depsNow() < echoUntil || hidden || !settings.wakeEnabled;
                    },
                    onWake: function (detail) {
                        onDetectorWake(gen, detail);
                    },
                    onError: function () {
                        if (gen !== wakeGen) return;
                        setState('ERROR');
                        feedbackKey('wakeError');
                    },
                });
            } catch (_) {
                monitorOn = false;
                setState('ERROR');
            }
        }

        function onDetectorWake(gen, detail) {
            if (gen !== wakeGen || !monitorOn) return;
            const heard = detail && (detail.transcript || detail.command || '');
            const hit = heard ? matchWake(heard, activePhrase()) : { command: '' };
            const decision = decideWake({
                enabled: settings.wakeEnabled,
                paused: settings.paused,
                hidden: hidden,
                speaking: speaking,
                echo: isEcho(heard),
                companionOwnsMic: companionActive && owner === 'companion' && busy(),
                authorized: true,
                matched: true,
                permission: 'granted',
                command: hit ? hit.command : '',
            });
            applyWakeDecision(decision);
        }

        function applyWakeDecision(decision) {
            if (!decision || decision.action === 'ignore') return false;
            if (decision.action === 'error') {
                setState('ERROR');
                feedbackKey('wakeDenied');
                stopOwnMonitor();
                return false;
            }
            // The spotter's recognizer, if any, has to be gone before the
            // command session opens. One owner.
            killRec(phraseRec);
            phraseRec = null;
            stopAllTracks();
            monitorOn = false;
            if (decision.action === 'send-command') {
                submitText(decision.command, 'wake');
                return true;
            }
            captureUtterance({ owner: 'wake', deliver: 'send' });
            return true;
        }

        function openCapture(hooks) {
            const h = hooks || {};
            try {
                if (typeof deps.openCapture === 'function') {
                    return deps.openCapture(h) || { close: function () {} };
                }
                const api = global.NEXUS_MIC_SESSION;
                const session = api && (typeof api.get === 'function' ? api.get() : api);
                if (session && typeof session.open === 'function') {
                    const lease = session.open({
                        owner: 'wake',
                        onFrames: function (samples, sampleRate) {
                            if (h.onFrames) h.onFrames(samples, sampleRate);
                        },
                    });
                    if (lease.ready && typeof lease.ready.then === 'function') {
                        lease.ready.then(function (r) {
                            if (r && r.ok) {
                                if (h.onReady) h.onReady(r);
                            } else if (h.onError) h.onError(r || { reason: 'unavailable' });
                        });
                    }
                    return {
                        close: function () {
                            try {
                                lease.close('closed');
                            } catch (_) {}
                        },
                    };
                }
            } catch (_) {}
            if (h.onError) h.onError({ reason: 'unsupported' });
            return { close: function () {} };
        }

        /**
         * Wake spotting on one capture. Loudness only decides whether a window
         * is worth a local transcription and, after the name, when the command
         * has finished. It never decides that the name was said, and it never
         * opens the cloud recognizer.
         */
        function startLocalSpotter(gen) {
            if (gen !== wakeGen || !canTranscribeLocal()) {
                monitorOn = false;
                owner = null;
                feedbackKey('wakeManual');
                setState('OFF');
                return;
            }
            const ring = createPcmRing(DEFAULTS.ringSeconds * 16000);
            let rate = 16000;
            let inflight = false;
            let phase = 'spot';
            let lastSpot = 0;
            let silenceMs = 0;
            let commandHeard = false;
            let commandWait = 0;
            let tickPrev = depsNow();

            function closeCapture() {
                if (spotTimer) {
                    clearInterval(spotTimer);
                    spotTimer = null;
                }
                if (captureLease) {
                    try {
                        captureLease.close();
                    } catch (_) {}
                    captureLease = null;
                }
            }

            function textOf(res) {
                if (!res) return '';
                if (typeof res === 'string') return res;
                return res.text || res.raw || '';
            }

            function acceptCommand(command) {
                phase = 'done';
                monitorOn = false;
                closeCapture();
                sessionMode = 'wake';
                manualOpen = false;
                if (!command || isEcho(command)) {
                    if (settings.wakeEnabled && !settings.paused && !hidden && !companionActive) armMonitor();
                    return;
                }
                submitText(command, 'wake');
            }

            function consider(text) {
                if (gen !== wakeGen || !monitorOn || phase === 'done') return;
                if (speaking || isEcho(text)) return;
                const hit = matchWake(text, activePhrase());
                const decision = decideWake({
                    enabled: settings.wakeEnabled,
                    paused: settings.paused,
                    hidden: hidden,
                    speaking: speaking,
                    echo: isEcho(text),
                    companionOwnsMic: companionActive && owner === 'companion' && busy(),
                    authorized: gen === wakeGen && monitorOn,
                    matched: !!hit,
                    permission: 'granted',
                    command: hit ? hit.command : '',
                });
                if (!decision || decision.action === 'ignore') return;
                if (decision.action === 'error') {
                    phase = 'done';
                    monitorOn = false;
                    closeCapture();
                    applyWakeDecision(decision);
                    return;
                }
                if (decision.action === 'send-command') {
                    acceptCommand(decision.command);
                    return;
                }
                // The name alone. Keep this same buffer so the command that
                // follows is not clipped by opening a second recognizer.
                phase = 'command';
                commandHeard = false;
                silenceMs = 0;
                commandWait = 0;
                setState('LISTENING');
                feedbackKey('wakeListening');
            }

            function finishCommand() {
                if (gen !== wakeGen || phase === 'done') return;
                phase = 'done';
                inflight = true;
                const samples = ring.snapshot(rate * DEFAULTS.ringSeconds);
                Promise.resolve(transcribeLocal(samples, rate))
                    .then(function (res) {
                        inflight = false;
                        if (gen !== wakeGen) return;
                        const text = textOf(res);
                        const hit = matchWake(text, activePhrase());
                        acceptCommand(hit && hit.command ? hit.command : '');
                    })
                    .catch(function () {
                        inflight = false;
                        if (gen !== wakeGen) return;
                        monitorOn = false;
                        closeCapture();
                        feedbackKey('wakeError');
                        setState('ERROR');
                    });
            }

            captureLease = openCapture({
                onFrames: function (samples, sampleRate) {
                    if (gen !== wakeGen || !monitorOn) return;
                    if (sampleRate) rate = sampleRate;
                    ring.push(samples);
                },
                onError: function (err) {
                    if (gen !== wakeGen) return;
                    monitorOn = false;
                    closeCapture();
                    const reason = err && err.reason;
                    if (reason === 'denied') {
                        setState('ERROR');
                        feedbackKey('wakeDenied');
                        log('mic-denied');
                        return;
                    }
                    owner = null;
                    feedbackKey('wakeManual');
                    setState('OFF');
                },
            });

            spotTimer = setInterval(function () {
                if (gen !== wakeGen || !monitorOn || phase === 'done') return;
                const now = depsNow();
                const dt = Math.max(0, now - tickPrev);
                tickPrev = now;
                if (speaking || now < echoUntil) {
                    silenceMs = 0;
                    return;
                }
                if (phase === 'command') {
                    const tail = ring.snapshot(Math.max(1, Math.round(rate * 0.2)));
                    if (rmsOf(tail) >= DEFAULTS.commandFloor) {
                        commandHeard = true;
                        silenceMs = 0;
                    } else if (commandHeard) {
                        silenceMs += dt;
                        if (silenceMs >= DEFAULTS.endSilenceMs) finishCommand();
                    } else {
                        commandWait += dt;
                        if (commandWait >= DEFAULTS.noSpeechMs) {
                            phase = 'spot';
                            commandWait = 0;
                            setState('STANDBY');
                            feedbackKey('wakeStandby');
                        }
                    }
                    return;
                }
                if (inflight || now - lastSpot < DEFAULTS.spotStepMs) return;
                lastSpot = now;
                const windowSamples = ring.snapshot(Math.round(rate * (DEFAULTS.spotWindowMs / 1000)));
                if (!windowSamples.length || rmsOf(windowSamples) < DEFAULTS.commandFloor) return;
                inflight = true;
                Promise.resolve(transcribeLocal(windowSamples, rate))
                    .then(function (res) {
                        inflight = false;
                        if (gen !== wakeGen || phase !== 'spot') return;
                        consider(textOf(res));
                    })
                    .catch(function () {
                        inflight = false;
                    });
            }, 200);
        }

        function readResults(event) {
            const results = (event && event.results) || [];
            let finalText = '';
            let interim = '';
            let anyFinal = false;
            let anyInterim = false;
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const t = (r && r[0] && r[0].transcript) || '';
                if (r && r.isFinal) {
                    anyFinal = true;
                    finalText = mergeTranscripts(finalText, t);
                } else {
                    anyInterim = true;
                    interim = t;
                }
            }
            return {
                finalText: String(finalText || '').trim(),
                interim: String(interim || '').trim(),
                anyFinal: anyFinal,
                anyInterim: anyInterim,
            };
        }

        function mergeTranscripts(base, add) {
            try {
                if (global.CompanionMode && typeof global.CompanionMode._mergeTranscripts === 'function') {
                    return global.CompanionMode._mergeTranscripts(base, add);
                }
            } catch (_) {}
            const b = String(base || '').trim();
            const a = String(add || '').trim();
            if (!b) return a;
            if (!a) return b;
            if (a.toLowerCase().indexOf(b.toLowerCase()) === 0) return a;
            if (b.toLowerCase().indexOf(a.toLowerCase()) === 0) return b;
            return (b + ' ' + a).trim();
        }

        function autoSend() {
            return settings.autoSend !== false;
        }

        function fillInput(text) {
            try {
                if (typeof deps.fillInput === 'function') {
                    deps.fillInput(text);
                    return;
                }
                const input = global.document && global.document.getElementById('speech-text');
                if (input) {
                    input.value = text;
                    input.style.fontStyle = 'normal';
                    input.style.opacity = '1';
                }
            } catch (_) {}
        }

        function showInterim(text) {
            try {
                if (typeof deps.showInterim === 'function') {
                    deps.showInterim(text);
                    return;
                }
                const input = global.document && global.document.getElementById('speech-text');
                if (!input) return;
                input.value = text;
                input.style.fontStyle = 'italic';
                input.style.opacity = '0.7';
            } catch (_) {}
        }

        function feedbackKey(key) {
            const text = label(key);
            try {
                if (typeof deps.feedback === 'function') deps.feedback(text, key);
            } catch (_) {}
            if (!global.document || deps.dom === false) return;
            const el = global.document.getElementById('wake-feedback');
            if (el) el.textContent = text;
            const status = global.document.getElementById('recognition-status');
            if (status && owner !== 'tap') status.textContent = text;
        }

        /**
         * One utterance. Interim text may be shown in the field; it is never
         * submitted. A finalized empty string is not submitted. The generation
         * captured here is the only one allowed to send.
         */
        function captureUtterance(opts) {
            const o = opts || {};
            const who = o.owner || 'hold';
            // A second press, a second wake hit, or a late callback must not
            // open another recognizer on top of one that is already sending.
            if (busy()) return false;
            if (!claim(who)) return false;
            const SR = recognitionClass();
            if (!SR) {
                setState('ERROR');
                feedbackKey('wakeUnsupported');
                release(who);
                return false;
            }
            sessionGen++;
            const gen = sessionGen;
            sessionDone = false;
            resumeToken++;
            let rec;
            try {
                rec = new SR();
            } catch (_) {
                setState('ERROR');
                release(who);
                return false;
            }
            activeRec = rec;
            rec.lang = language();
            rec.interimResults = true;
            rec.perfSurface = who === 'wake' ? 'wake-command' : 'mic-hold';
            const local = !!(rec.isLocalWhisper || rec.isRemoteSonic);
            // On-device and SonicAgent already end a sentence on ~900 ms of
            // silence inside their endpointer. Leaving `continuous` false keeps
            // that path. The browser's own endpoint is not that pause, so the
            // browser recognizer stays open and this module closes it.
            rec.continuous = local ? false : true;
            let finalText = '';
            let interimText = '';
            let silenceTimer = null;
            let noSpeechTimer = null;
            let maxTimer = null;
            let awaitingFinal = false;

            function clearTimers() {
                clearTimeout(silenceTimer);
                clearTimeout(noSpeechTimer);
                clearTimeout(maxTimer);
                silenceTimer = noSpeechTimer = maxTimer = null;
            }

            function stale() {
                return gen !== sessionGen || sessionDone;
            }

            function giveUp(reason) {
                if (stale()) return;
                sessionDone = true;
                clearTimers();
                if (activeRec === rec) activeRec = null;
                killRec(rec);
                if (reason === 'not-allowed') {
                    manualOpen = false;
                    setState('ERROR');
                    feedbackKey('wakeDenied');
                    log('mic-denied');
                    owner = null;
                    stopOwnMonitor();
                    return;
                }
                if (
                    reason === 'error' &&
                    manualOpen &&
                    settings.continuous &&
                    errorStrikes < 1 &&
                    !hidden &&
                    !settings.paused
                ) {
                    errorStrikes++;
                    owner = null;
                    setState('OFF');
                    feedbackKey('wakeRecover');
                    const token = ++resumeToken;
                    setTimeout(function () {
                        if (token !== resumeToken || !manualOpen) return;
                        captureUtterance({ owner: 'manual', deliver: 'send' });
                    }, 400);
                    return;
                }
                if (
                    manualOpen &&
                    settings.continuous &&
                    (reason === 'echo' || reason === 'no-speech' || reason === 'empty') &&
                    !hidden &&
                    !settings.paused
                ) {
                    owner = null;
                    setState('OFF');
                    const token = ++resumeToken;
                    const wait = reason === 'echo' ? Math.max(300, echoUntil - depsNow()) : 400;
                    setTimeout(function () {
                        if (token !== resumeToken || !manualOpen) return;
                        if (speaking || depsNow() < echoUntil) return;
                        captureUtterance({ owner: 'manual', deliver: 'send' });
                    }, wait);
                    return;
                }
                if (reason === 'echo') {
                    /* not a failure and not a turn */
                } else if (reason === 'no-speech' || reason === 'empty') feedbackKey('wakeNoSpeech');
                else feedbackKey('wakeError');
                owner = null;
                if (reason === 'echo' || reason === 'no-speech' || reason === 'empty' || reason === 'error') {
                    manualOpen = false;
                }
                if (settings.wakeEnabled && !settings.paused && !hidden && !companionActive && reason !== 'error') {
                    setState('OFF');
                    armMonitor();
                } else if (reason === 'error') setState('ERROR');
                else setState(settings.paused || hidden ? 'PAUSED' : 'OFF');
            }

            function finishWith(text) {
                if (stale()) return;
                const clean = String(text || '').trim();
                // Her voice is not a turn. A final that arrives while she is
                // speaking, or inside the echo guard, is dropped whole.
                if (speaking || isEcho(clean)) {
                    giveUp('echo');
                    return;
                }
                if (!clean) {
                    giveUp('empty');
                    return;
                }
                sessionDone = true;
                clearTimers();
                if (activeRec === rec) activeRec = null;
                killRec(rec);
                const deliver = o.deliver || 'send';
                if (deliver === 'return') {
                    owner = null;
                    setState('OFF');
                    if (typeof o.onText === 'function') o.onText(clean);
                    return;
                }
                if (!autoSend()) {
                    fillInput(clean);
                    owner = null;
                    setState(settings.wakeEnabled && !settings.paused && !hidden ? 'STANDBY' : 'OFF');
                    if (settings.wakeEnabled && !settings.paused && !hidden) armMonitor();
                    return;
                }
                submitText(clean, who);
            }

            function silenceFor(text) {
                const t = String(text || '').trim();
                // A finished sentence can close. A pause in the middle — no
                // period, or a trailing "and" — is not the end of the request.
                if (t && /[.?!]["']?$/.test(t)) return DEFAULTS.endSilenceMs;
                return DEFAULTS.hesitationMs;
            }

            function armSilence() {
                clearTimeout(silenceTimer);
                if (!finalText && !interimText) return;
                silenceTimer = setTimeout(
                    function () {
                        if (stale()) return;
                        if (finalText) finishWith(finalText);
                        else {
                            awaitingFinal = true;
                            try {
                                rec.stop();
                            } catch (_) {}
                        }
                    },
                    silenceFor(finalText || interimText)
                );
            }

            rec.onstart = function () {
                if (stale()) return;
                setState('LISTENING');
                feedbackKey('wakeListening');
            };
            rec.onaudioend = function () {
                if (stale()) return;
                if (local) setState('TRANSCRIBING');
            };
            rec.onresult = function (event) {
                if (stale()) return;
                if (isEcho('')) {
                    // Avatar started speaking mid-utterance: drop what we heard
                    // rather than send her voice back as the person's turn.
                    return;
                }
                const read = readResults(event);
                if (read.anyInterim && read.interim) {
                    interimText = read.interim;
                    showInterim(read.interim);
                    // Heard something: the no-speech timer is only for silence.
                    // Interim text is still not a submission.
                    clearTimeout(noSpeechTimer);
                }
                if (read.anyFinal && read.finalText) {
                    finalText = read.finalText;
                    clearTimeout(noSpeechTimer);
                    if (local) {
                        finishWith(finalText);
                        return;
                    }
                }
                if (!local) armSilence();
            };
            rec.onerror = function (event) {
                if (stale()) return;
                const code = event && event.error;
                if (code === 'aborted') return;
                if (code === 'no-speech') {
                    giveUp('no-speech');
                    return;
                }
                if (code === 'not-allowed' || code === 'service-not-allowed') {
                    giveUp('not-allowed');
                    return;
                }
                giveUp('error');
            };
            rec.onend = function () {
                if (stale()) return;
                if (awaitingFinal && finalText) {
                    finishWith(finalText);
                    return;
                }
                if (finalText && local) {
                    finishWith(finalText);
                    return;
                }
                // The engine closed itself. A hands-free session listens again.
                // A one-shot turn with text still in hand is sent; an empty
                // close is silence, not a crash.
                if (finalText) {
                    finishWith(finalText);
                    return;
                }
                if (!finalText) giveUp(awaitingFinal ? 'empty' : 'no-speech');
            };

            noSpeechTimer = setTimeout(function () {
                if (stale()) return;
                if (!finalText && !interimText) giveUp('no-speech');
            }, DEFAULTS.noSpeechMs);
            maxTimer = setTimeout(function () {
                if (stale()) return;
                feedbackKey('wakeTimeout');
                if (finalText) finishWith(finalText);
                else if (manualOpen) giveUp('no-speech');
                else {
                    awaitingFinal = true;
                    try {
                        rec.stop();
                    } catch (_) {
                        giveUp('empty');
                    }
                }
            }, settings.maxMs || DEFAULTS.maxUtteranceMs);

            setState('LISTENING');
            try {
                rec.start();
            } catch (err) {
                try {
                    rec.continuous = false;
                    rec.start();
                } catch (_) {
                    giveUp('error');
                    return false;
                }
            }
            return true;
        }

        function submitText(text, who) {
            const clean = String(text || '').trim();
            if (!clean) return false;
            errorStrikes = 0;
            stopOwnMonitor();
            setState('SENDING');
            log(isPrivate() ? 'submit-private' : 'submit');
            fillInput('');
            setState('RESPONDING');
            const token = ++resumeToken;
            const sentOwner = who || owner;
            try {
                if (typeof deps.send === 'function') {
                    const ret = deps.send(clean);
                    if (ret && typeof ret.then === 'function') {
                        ret.catch(function () {
                            if (token === resumeToken) setState('ERROR');
                        });
                    }
                }
            } catch (_) {
                setState('ERROR');
                log('submit-failed');
                return false;
            }
            setTimeout(function () {
                if (token !== resumeToken) return;
                if (state !== 'RESPONDING') return;
                if (speaking) return;
                finishResponse(sentOwner);
            }, DEFAULTS.respondFallbackMs);
            return true;
        }

        function finishResponse(sentOwner) {
            if (state !== 'RESPONDING' && state !== 'SENDING') return;
            resumeToken++;
            const who = sentOwner || owner || (manualOpen ? 'manual' : null);
            // Wake word always returns to the name. A tapped conversation is the
            // one that listens again, and only while that session is still open.
            const manualContinues =
                manualOpen && settings.continuous && who === 'manual' && !hidden && !settings.paused;
            if (manualContinues) {
                const wait = Math.max(0, echoUntil - depsNow());
                const token = resumeToken;
                setTimeout(function () {
                    if (token !== resumeToken || !manualOpen) return;
                    if (speaking || depsNow() < echoUntil) return;
                    captureUtterance({ owner: 'manual', deliver: 'send' });
                }, wait);
                return;
            }
            if (who === 'manual') manualOpen = false;
            sessionMode = null;
            owner = null;
            if (settings.wakeEnabled && !manualOpen && !settings.paused && !hidden && !companionActive) {
                setState('OFF');
                armMonitor();
            } else {
                setState(settings.paused || hidden ? 'PAUSED' : 'OFF');
            }
        }

        function cancel(reason) {
            resumeToken++;
            sessionGen++;
            sessionDone = true;
            manualOpen = false;
            sessionMode = null;
            const rec = activeRec;
            activeRec = null;
            killRec(rec);
            stopOwnMonitor();
            const who = owner;
            owner = null;
            if (reason === 'user-stop' || reason === 'disabled' || reason === 'conversation-end') {
                setState('OFF');
                return who;
            }
            if (reason === 'pause' || reason === 'hidden') {
                setState('PAUSED');
                return who;
            }
            setState(settings.paused ? 'PAUSED' : 'OFF');
            return who;
        }

        function noteSpeaking(on) {
            const was = speaking;
            speaking = !!on;
            if (speaking) {
                echoUntil = depsNow() + DEFAULTS.echoGuardMs;
                if (owner === 'wake' || monitorOn) stopOwnMonitor();
                // Her voice is not the next question. Drop the open mic and
                // keep a tapped conversation so it can listen when she stops.
                if (manualOpen && (state === 'LISTENING' || state === 'TRANSCRIBING' || owner === 'manual')) {
                    sessionGen++;
                    sessionDone = true;
                    const rec = activeRec;
                    activeRec = null;
                    killRec(rec);
                    owner = 'manual';
                }
                if (state === 'SENDING' || state === 'RESPONDING' || manualOpen) setState('RESPONDING');
                return;
            }
            if (!was) return;
            echoUntil = depsNow() + DEFAULTS.echoGuardMs;
            if (state === 'RESPONDING') finishResponse(owner || (manualOpen ? 'manual' : null));
            else if (settings.wakeEnabled && !settings.paused && !hidden && !busy() && !manualOpen) armMonitor();
        }

        function noteSpoken(text) {
            const n = norm(text);
            if (!n) return;
            lastSpoken = n;
            lastSpokenAt = depsNow();
            echoUntil = depsNow() + DEFAULTS.echoGuardMs;
        }

        function setWakeEnabled(on) {
            settings.wakeEnabled = !!on;
            if (!settings.wakeEnabled) settings.paused = false;
            persist();
            sync();
            syncPanel();
        }

        function setPhrase(phrase) {
            const n = norm(phrase);
            settings.phrase = n;
            settings.phraseCustom = true;
            persist();
            if (monitorOn) {
                stopOwnMonitor();
                armMonitor();
            }
            syncPanel();
        }

        function setAutoSend(on) {
            settings.autoSend = !!on;
            persist();
            syncPanel();
        }

        function setContinuous(on) {
            settings.continuous = !!on;
            persist();
            syncPanel();
        }

        function setMaxMs(ms) {
            const n = Number(ms);
            settings.maxMs = n === 60000 || n === 120000 ? n : DEFAULTS.maxUtteranceMs;
            persist();
            syncPanel();
        }

        function pause() {
            settings.paused = true;
            persist();
            cancel('pause');
            syncPanel();
        }

        function resume() {
            settings.paused = false;
            persist();
            sync();
            syncPanel();
        }

        function idleForWakeToggle() {
            if (manualOpen) return false;
            if (busy() && owner && owner !== 'wake') return false;
            return true;
        }

        function toggleWakeFromHold() {
            if (!idleForWakeToggle()) {
                feedbackKey('wakeBusy');
                return false;
            }
            const next = !settings.wakeEnabled;
            setWakeEnabled(next);
            // "Say Nexus" is only honest when a local spotter is actually running.
            if (next && plan() === 'manual-only') feedbackKey('wakeManual');
            else feedbackKey(next ? 'wakeOnConfirm' : 'wakeOffConfirm');
            return next;
        }

        function startConversation() {
            if (busy() && owner && owner !== 'manual' && owner !== 'wake') {
                feedbackKey('wakeBusy');
                return false;
            }
            stopOwnMonitor();
            if (owner === 'wake') owner = null;
            manualOpen = true;
            sessionMode = 'manual';
            try {
                if (typeof deps.stopTap === 'function') deps.stopTap();
            } catch (_) {}
            const ok = captureUtterance({ owner: 'manual', deliver: 'send' });
            if (!ok) {
                manualOpen = false;
                sessionMode = null;
                return false;
            }
            feedbackKey('conversationOn');
            return true;
        }

        function stopSpeechPlayback() {
            speaking = false;
            try {
                if (typeof deps.stopSpeech === 'function') deps.stopSpeech();
                else if (global.speechSynthesis && typeof global.speechSynthesis.cancel === 'function') {
                    global.speechSynthesis.cancel();
                }
            } catch (_) {}
        }

        function endConversation() {
            const keepWake = settings.wakeEnabled && !settings.paused && !hidden && !companionActive;
            // Clear the session before stopping speech, so her onend cannot
            // open another listen.
            manualOpen = false;
            sessionMode = null;
            stopSpeechPlayback();
            cancel(keepWake ? 'conversation-end' : 'user-stop');
            if (keepWake) armMonitor();
            feedbackKey(keepWake ? 'wakeStandby' : 'conversationOff');
            return true;
        }

        function micTap() {
            if (manualOpen) return endConversation();
            return startConversation();
        }

        function stopListening() {
            // Stop closes the conversation. It does not forget a saved wake word:
            // the hold and the checkbox are that switch. With the conversation
            // closed and wake word saved, standby starts again.
            if (manualOpen) return endConversation();
            if (settings.wakeEnabled && !settings.paused) return pause();
            cancel('user-stop');
            syncPanel();
            return true;
        }

        function onCompanionActive(active) {
            companionActive = !!active;
            if (companionActive) {
                // Companion takes the microphone. A page conversation does not
                // stay busy underneath it.
                manualOpen = false;
                sessionMode = null;
                sessionGen++;
                sessionDone = true;
                const rec = activeRec;
                activeRec = null;
                killRec(rec);
                stopOwnMonitor();
                if (owner === 'wake' || owner === 'manual' || owner === 'hold' || owner === 'assist') owner = null;
                if (
                    state === 'LISTENING' ||
                    state === 'TRANSCRIBING' ||
                    state === 'SENDING' ||
                    state === 'RESPONDING'
                ) {
                    setState('OFF');
                }
                if (settings.wakeEnabled || overlayWakeOn()) {
                    try {
                        if (global.companionMode && global.companionMode.startStandby) {
                            global.companionMode.startStandby();
                        }
                    } catch (_) {}
                }
            } else if (!busy()) {
                sync();
            }
        }

        function testWake() {
            if (busy()) {
                feedbackKey('wakeBusy');
                return false;
            }
            feedbackKey('wakeListening');
            return captureUtterance({
                owner: 'wake',
                deliver: 'return',
                onText: function (text) {
                    const hit = matchWake(text, activePhrase());
                    feedbackKey(hit ? 'wakeTestHit' : 'wakeTestMiss');
                    if (settings.wakeEnabled && !settings.paused && !hidden) armMonitor();
                },
            });
        }

        function speakAndSend() {
            if (manualOpen) return true;
            return startConversation();
        }

        function holdCapture() {
            try {
                if (typeof deps.stopTap === 'function') deps.stopTap();
            } catch (_) {}
            return captureUtterance({ owner: 'hold', deliver: 'send' });
        }

        function attachHold(button, hooks) {
            if (!button || button.dataset.nexusHold === '1') return false;
            button.dataset.nexusHold = '1';
            const h = hooks || {};
            const tracker = createHoldTracker({ holdMs: DEFAULTS.holdMs, slopPx: DEFAULTS.slopPx });
            let timer = null;

            function clearTimer() {
                if (timer) clearTimeout(timer);
                timer = null;
            }

            function visuals(action) {
                button.classList.remove('hold-arming', 'hold-armed');
                if (action === 'press') button.classList.add('hold-arming');
                if (action === 'arm') button.classList.add('hold-armed');
            }

            function apply(result) {
                if (!result || result.action === 'ignore') return;
                if (result.action === 'press') {
                    visuals('press');
                    const status = global.document && global.document.getElementById('recognition-status');
                    if (status) status.textContent = label('wakeHold');
                    if (typeof h.onPress === 'function') h.onPress();
                    return;
                }
                if (result.action === 'arm') {
                    visuals('arm');
                    const status = global.document && global.document.getElementById('recognition-status');
                    if (status) status.textContent = label('wakeRelease');
                    if (typeof h.onArm === 'function') h.onArm();
                    return;
                }
                clearTimer();
                visuals('clear');
                if (result.action === 'activate') {
                    if (typeof h.onActivate === 'function') h.onActivate();
                    else toggleWakeFromHold();
                    return;
                }
                if (result.action === 'cancel' || result.action === 'drag-cancel') {
                    if (typeof h.onCancel === 'function') h.onCancel(result.action);
                }
            }

            button.addEventListener('pointerdown', function (e) {
                if (button.disabled) return;
                const result = tracker.pointerdown(e, depsNow());
                if (result.action !== 'press') return;
                try {
                    button.setPointerCapture(e.pointerId);
                } catch (_) {}
                clearTimer();
                const started = depsNow();
                timer = setTimeout(function () {
                    timer = null;
                    apply(tracker.tick(started + DEFAULTS.holdMs));
                }, DEFAULTS.holdMs);
                apply(result);
            });
            button.addEventListener('pointermove', function (e) {
                const result = tracker.pointermove(e);
                if (result.action === 'drag-cancel') {
                    clearTimer();
                    apply(result);
                }
            });
            button.addEventListener('pointerup', function (e) {
                clearTimer();
                apply(tracker.pointerup(e, depsNow()));
                try {
                    button.releasePointerCapture(e.pointerId);
                } catch (_) {}
            });
            button.addEventListener('pointercancel', function (e) {
                clearTimer();
                apply(tracker.pointercancel(e));
            });
            button.addEventListener('contextmenu', function (e) {
                if (tracker.tracking() || button.classList.contains('hold-armed')) e.preventDefault();
            });
            button.addEventListener('keydown', function (e) {
                const result = tracker.keydown(e, depsNow());
                if (result.action !== 'press') return;
                clearTimer();
                const started = depsNow();
                timer = setTimeout(function () {
                    timer = null;
                    apply(tracker.tick(started + DEFAULTS.holdMs));
                }, DEFAULTS.holdMs);
                apply(result);
            });
            button.addEventListener('keyup', function (e) {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                clearTimer();
                apply(tracker.keyup(e, depsNow()));
            });
            // Capture so a successful hold runs before the button's synthetic
            // click, and so a second listener cannot also toggle the tap.
            button.addEventListener(
                'click',
                function (e) {
                    const gate = tracker.click();
                    if (gate.suppress) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        return;
                    }
                    if (typeof h.onTap === 'function') h.onTap(e);
                    else micTap();
                },
                true
            );
            const onHide = function () {
                if (!tracker.tracking()) return;
                clearTimer();
                apply(tracker.pagehide());
            };
            global.addEventListener('pagehide', onHide);
            return true;
        }

        function syncPanel() {
            if (!global.document || deps.dom === false) return;
            const enabled = global.document.getElementById('wake-enabled');
            const phrase = global.document.getElementById('wake-phrase');
            const custom = global.document.getElementById('wake-phrase-custom');
            const autosend = global.document.getElementById('wake-autosend');
            const continuous = global.document.getElementById('wake-continuous');
            const maxSel = global.document.getElementById('wake-max');
            if (enabled) enabled.checked = settings.wakeEnabled;
            if (autosend) autosend.checked = settings.autoSend;
            if (continuous) continuous.checked = settings.continuous;
            if (maxSel) maxSel.value = String(settings.maxMs || DEFAULTS.maxUtteranceMs);
            const phraseValue = activePhrase();
            if (phrase) {
                const known = Array.from(phrase.options || []).some(function (o) {
                    return o.value === phraseValue;
                });
                if (settings.phrase && !known) phrase.value = 'custom';
                else if (known) phrase.value = phraseValue;
                else phrase.value = defaultPhrase(language());
            }
            if (custom) {
                const show = phrase && phrase.value === 'custom';
                custom.hidden = !show;
                if (show) custom.value = settings.phrase || '';
            }
            applyCopy();
            paint();
            refreshMic();
        }

        function applyCopy() {
            if (!global.document) return;
            const pack = labelsFor(language());
            const nodes = global.document.querySelectorAll('[data-wake-key]');
            nodes.forEach(function (node) {
                const key = node.getAttribute('data-wake-key');
                if (pack[key]) node.textContent = pack[key];
            });
        }

        function refreshMic() {
            const el = global.document && global.document.getElementById('wake-mic-status');
            if (!el) return;
            const md = global.navigator && global.navigator.mediaDevices;
            if (!md || !md.getUserMedia) {
                el.textContent = label('wakeMicUnsupported');
                return;
            }
            const perms = global.navigator.permissions;
            if (!perms || !perms.query) {
                el.textContent = label('wakeMicUnknown');
                return;
            }
            perms
                .query({ name: 'microphone' })
                .then(function (status) {
                    const map = {
                        granted: 'wakeMicGranted',
                        denied: 'wakeMicDenied',
                        prompt: 'wakeMicPrompt',
                    };
                    el.textContent = label(map[status.state] || 'wakeMicUnknown');
                    if (status.onchange == null) {
                        status.onchange = function () {
                            refreshMic();
                            if (status.state === 'denied') {
                                settings.wakeEnabled = false;
                                persist();
                                cancel('disabled');
                                syncPanel();
                            }
                        };
                    }
                })
                .catch(function () {
                    el.textContent = label('wakeMicUnknown');
                });
        }

        function mountPanel() {
            if (!global.document || deps.dom === false) return false;
            const root = global.document.getElementById('wake-up-section');
            if (!root || root.dataset.wired === '1') return false;
            root.dataset.wired = '1';
            const enabled = global.document.getElementById('wake-enabled');
            const phrase = global.document.getElementById('wake-phrase');
            const custom = global.document.getElementById('wake-phrase-custom');
            const autosend = global.document.getElementById('wake-autosend');
            const continuous = global.document.getElementById('wake-continuous');
            if (enabled) {
                enabled.addEventListener('change', function () {
                    setWakeEnabled(enabled.checked);
                });
            }
            if (phrase) {
                phrase.addEventListener('change', function () {
                    if (phrase.value === 'custom') {
                        if (custom) custom.hidden = false;
                        return;
                    }
                    if (custom) custom.hidden = true;
                    setPhrase(phrase.value);
                });
            }
            if (custom) {
                custom.addEventListener('change', function () {
                    setPhrase(custom.value);
                });
            }
            if (autosend) {
                autosend.addEventListener('change', function () {
                    setAutoSend(autosend.checked);
                });
            }
            if (continuous) {
                continuous.addEventListener('change', function () {
                    setContinuous(continuous.checked);
                });
            }
            const maxSel = global.document.getElementById('wake-max');
            if (maxSel) {
                maxSel.addEventListener('change', function () {
                    setMaxMs(maxSel.value);
                });
            }
            const speak = global.document.getElementById('wake-speak');
            const test = global.document.getElementById('wake-test');
            const pauseBtn = global.document.getElementById('wake-pause');
            const stopBtn = global.document.getElementById('wake-stop');
            if (speak)
                speak.addEventListener('click', function () {
                    speakAndSend();
                });
            if (test)
                test.addEventListener('click', function () {
                    testWake();
                });
            if (pauseBtn) {
                pauseBtn.addEventListener('click', function () {
                    if (settings.paused) resume();
                    else pause();
                });
            }
            if (stopBtn)
                stopBtn.addEventListener('click', function () {
                    stopListening();
                });
            const lang = global.document.getElementById('app-language');
            if (lang)
                lang.addEventListener('change', function () {
                    syncPanel();
                });
            syncPanel();
            return true;
        }

        function onVisibility() {
            if (!global.document) return;
            hidden = global.document.visibilityState === 'hidden';
            if (hidden) {
                cancel('hidden');
                stopAllTracks();
            } else if (!settings.paused) {
                sync();
            }
        }

        function onPageHide() {
            hidden = true;
            cancel('hidden');
            stopAllTracks();
        }

        function boot() {
            if (booted) return;
            booted = true;
            migrate();
            loadSettings();
            if (global.document) {
                global.document.addEventListener('visibilitychange', onVisibility);
                global.addEventListener('pagehide', onPageHide);
                mountPanel();
                const endBtn = global.document.getElementById('end-conversation');
                if (endBtn && endBtn.dataset.nexusStop !== '1') {
                    endBtn.dataset.nexusStop = '1';
                    endBtn.addEventListener('click', function () {
                        endConversation();
                    });
                }
            }
            sync();
        }

        function configure(extra) {
            if (extra) Object.assign(deps, extra);
        }

        loadSettings();

        return {
            STATES: STATES,
            DEFAULTS: DEFAULTS,
            COPY: COPY,
            configure: configure,
            boot: boot,
            state: function () {
                return state;
            },
            owner: function () {
                return owner;
            },
            busy: busy,
            claim: claim,
            release: release,
            adopt: adopt,
            settings: currentSettings,
            loadSettings: loadSettings,
            migrate: migrate,
            labels: function (code) {
                return labelsFor(code || language());
            },
            label: label,
            language: language,
            wakeEnabled: function () {
                return settings.wakeEnabled;
            },
            setWakeEnabled: setWakeEnabled,
            setPhrase: setPhrase,
            setAutoSend: setAutoSend,
            setContinuous: setContinuous,
            setMaxMs: setMaxMs,
            pause: pause,
            resume: resume,
            stopListening: stopListening,
            micTap: micTap,
            startConversation: startConversation,
            endConversation: endConversation,
            toggleWakeFromHold: toggleWakeFromHold,
            mode: function () {
                if (manualOpen) return 'manual';
                if (settings.wakeEnabled && !settings.paused && !hidden) return 'wake';
                return 'idle';
            },
            sync: sync,
            plan: plan,
            captureUtterance: captureUtterance,
            holdCapture: holdCapture,
            speakAndSend: speakAndSend,
            testWake: testWake,
            cancel: cancel,
            noteSpeaking: noteSpeaking,
            noteSpoken: noteSpoken,
            isEcho: isEcho,
            onCompanionActive: onCompanionActive,
            attachHold: attachHold,
            mountPanel: mountPanel,
            refreshPanel: syncPanel,
            refreshMic: refreshMic,
            decideWake: decideWake,
            monitorPlan: monitorPlan,
            matchWake: matchWake,
            readResults: readResults,
            stopAllTracks: stopAllTracks,
            onState: function (fn) {
                if (typeof fn === 'function') listeners.add(fn);
                return function () {
                    listeners.delete(fn);
                };
            },
        };
    }

    const singleton = createVoiceActivation({});
    singleton.createVoiceActivation = createVoiceActivation;
    singleton.createHoldTracker = createHoldTracker;
    singleton.decideWake = decideWake;
    singleton.monitorPlan = monitorPlan;
    singleton.localMatch = localMatch;
    singleton.norm = norm;
    singleton.labelsFor = labelsFor;
    singleton.defaultPhrase = defaultPhrase;
    singleton.createPcmRing = createPcmRing;
    singleton.rmsOf = rmsOf;
    singleton.STORAGE = STORAGE;

    if (typeof module !== 'undefined' && module.exports) module.exports = singleton;
    if (global) global.NEXUS_VOICE_ACTIVATION = singleton;

    // Jest provides `module`, so requiring the file does not open a mic or
    // write migration keys. The browser classic script has no `module`.
    if (typeof module === 'undefined' && global && global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', function () {
                singleton.boot();
            });
        } else {
            singleton.boot();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
