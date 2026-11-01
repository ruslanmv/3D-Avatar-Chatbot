/**
 * SonicAgentVoiceSettings — HV6. Settings ▸ ADVANCED VOICE — SONICAGENT STREAMING.
 *
 * One section, drawn from JS before DEVELOPER (like WARDROBE FORGE), so `main.js`'s save path
 * knows nothing about it and index.html gains no frozen lines. What it offers and why:
 *
 *  - **Enable remote voice** — off for everyone until turned on here. Off, every remote choice
 *    refuses with a sentence pointing here; nothing is sent anywhere.
 *  - **Consent** — the exact sentence "Your microphone audio will be sent to OllaBridge Cloud
 *    and SonicAgent for transcription." and a box the person ticks. Turning the feature on does
 *    not tick it. Unticking it stops the next listen before the microphone opens.
 *  - **The two choices themselves stay where choices live**: this section adds "SonicAgent —
 *    Cloud streaming" to STT PROVIDER and "SonicAgent Piper — Cloud streaming" to TTS ENGINE.
 *    STT and TTS are independent; either may be remote while the other stays on the device.
 *  - **Readiness, location, latency** — "Check" asks OllaBridge (`/v1/voice/capabilities`) and
 *    shows where the service runs, whether it is ready or warming, and how long the check took.
 *  - **Test STT / Test TTS** — a real round trip each, timed, through the same recognizer and
 *    engine the app uses.
 *  - **Speak while streaming** (HV5), **automatic fallback** (HV6, off: only ever to Piper on
 *    this device), **jitter buffer** (HV4, 40–400 ms), **Clear remote session**, and a link to
 *    the advanced diagnostics page.
 *
 * Nothing here writes `stt_config` or `tts_engine` on a failure: a remote engine that cannot
 * run says so and the saved choices stay as the person left them.
 */
(function (global) {
    'use strict';

    const SECTION_ID = 'sonicagent-voice-section';
    const NOT_PAIRED =
        'SonicAgent needs an OllaBridge Cloud connection. Connect OllaBridge in Settings → LLM to use remote voice.';
    const HINT = 'font-size: 0.68rem; color: rgba(255, 255, 255, 0.5); margin: 6px 2px 0';
    const ROW = 'display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; font-size: 0.78rem';
    const LANGS = [
        ['', 'Same as the app'],
        ['en', 'English'],
        ['it', 'Italiano'],
        ['es', 'Español'],
        ['fr', 'Français'],
        ['de', 'Deutsch'],
        ['pt', 'Português'],
    ];

    function lib(name) {
        return (global && global[name]) || null;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    function build(doc, C) {
        const section = doc.createElement('div');
        section.className = 'config-section';
        section.id = SECTION_ID;
        section.innerHTML =
            '<h3 class="config-title">ADVANCED VOICE — SONICAGENT STREAMING</h3>' +
            '<div class="input-group">' +
            `<label style="${ROW}"><input type="checkbox" id="sonic-enabled" /> Enable remote voice through OllaBridge Cloud</label>` +
            `<p style="${HINT}">Speech-to-text and her voice can run on SonicAgent (Hugging Face) through the` +
            ' OllaBridge Cloud this app is paired with — useful on a Meta Quest. Off by default; on-device' +
            ' Whisper, Piper and the browser voices stay as they are. Choose it under STT PROVIDER and TTS' +
            ' ENGINE.</p>' +
            '<div id="sonic-consent-box" style="margin-top: 10px; padding: 8px 10px; border: 1px solid' +
            ' rgba(255, 200, 120, 0.35); border-radius: 6px">' +
            `<p style="margin: 0; font-size: 0.76rem">${esc(C.CONSENT_TEXT)}</p>` +
            `<label style="${ROW}"><input type="checkbox" id="sonic-consent" /> I agree</label>` +
            `<p style="${HINT}">${esc(C.TTS_NOTICE)}</p>` +
            '</div>' +
            '<div style="display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap">' +
            '<button type="button" id="sonic-check" class="secondary-btn" style="padding: 6px 12px; font-size: 0.72rem">' +
            'Check readiness</button>' +
            '<button type="button" id="sonic-test-stt" class="secondary-btn" style="padding: 6px 12px; font-size: 0.72rem">' +
            'Test STT</button>' +
            '<button type="button" id="sonic-test-tts" class="secondary-btn" style="padding: 6px 12px; font-size: 0.72rem">' +
            'Test TTS</button>' +
            '<button type="button" id="sonic-clear" class="secondary-btn" style="padding: 6px 12px; font-size: 0.72rem">' +
            'Clear remote session</button>' +
            '<a href="stt-check.html#remote" target="_blank" rel="noopener" style="font-size: 0.72rem; color: #7fb7c9">' +
            'Advanced diagnostics ↗</a>' +
            '</div>' +
            '<p id="sonic-status" role="status" aria-live="polite" style="font-size: 0.72rem;' +
            ' color: rgba(255, 255, 255, 0.75); margin: 8px 2px 0"></p>' +
            '<label class="input-label" for="sonic-language" style="margin-top: 10px">LISTENING LANGUAGE (speech-to-text)</label>' +
            '<select id="sonic-language" class="select-input">' +
            LANGS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') +
            '</select>' +
            `<p style="${HINT}">Her SonicAgent voice and speaking style (Companion / Secretary) are chosen under` +
            ' SPEECH ▸ VOICE STYLE once TTS ENGINE is SonicAgent.</p>' +
            `<label style="${ROW}"><input type="checkbox" id="sonic-stream-speak" /> Speak while the reply is still being written</label>` +
            `<label style="${ROW}"><input type="checkbox" id="sonic-fallback" /> If the remote voice fails before speaking, use Piper on this device</label>` +
            '<label class="input-label" for="sonic-jitter" style="margin-top: 10px">PLAYBACK BUFFER (ms)</label>' +
            '<input type="number" id="sonic-jitter" class="text-input" min="40" max="400" step="10" />' +
            `<p style="${HINT}">Audio buffered before she starts speaking. Lower starts sooner; higher survives a` +
            ' patchy Wi-Fi. Measure on your headset with the diagnostics page before changing it.</p>' +
            '</div>';
        return section;
    }

    /** Add the remote choice to a select once, keeping whatever value it had. */
    function addOption(select, value, label) {
        if (!select || Array.from(select.options).some((o) => o.value === value)) return;
        const opt = select.ownerDocument.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        const C = o.config || lib('NEXUS_SONIC_VOICE');
        if (!doc || !C) return null;
        const modal = doc.getElementById('settings-modal');
        const content = modal && modal.querySelector('.modal-content');
        if (!content) return null;
        let section = doc.getElementById(SECTION_ID);
        if (!section) {
            section = build(doc, C);
            const developer = Array.from(content.querySelectorAll('.config-section')).find((n) =>
                /DEVELOPER/.test((n.querySelector('.config-title') || {}).textContent || '')
            );
            content.insertBefore(section, developer || null);
        }
        const sttSelect = doc.getElementById('stt-provider');
        const ttsSelect = doc.getElementById('tts-engine');
        addOption(sttSelect, C.ENGINE, 'SonicAgent — Cloud streaming (via OllaBridge)');
        addOption(ttsSelect, C.ENGINE, 'SonicAgent Piper — Cloud streaming (via OllaBridge)');
        // The saved choices may be the remote ones, set before these options existed.
        try {
            const TP = global.TTSProvider;
            if (ttsSelect && TP && TP.getStoredEngine && TP.getStoredEngine() === C.ENGINE) ttsSelect.value = C.ENGINE;
        } catch (_) {}
        try {
            const saved = (JSON.parse(global.localStorage.getItem('stt_config') || '{}') || {}).provider;
            if (saved === C.ENGINE && sttSelect) sttSelect.value = C.ENGINE;
        } catch (_) {}

        // HV-FIX. Choosing SonicAgent in TTS ENGINE or STT PROVIDER is the switch. Before this the
        // switch lived only in this section, so a person who picked SonicAgent above got
        // "not set up (disabled)" and the browser voice. It switches on `enabled` only; the
        // microphone permission stays a separate, explicit tick.
        function noticeUnder(select, id, text) {
            if (!select) return null;
            let note = doc.getElementById(id);
            if (!note) {
                note = doc.createElement('p');
                note.id = id;
                note.className = 'voice-status';
                note.style.cssText = 'margin-top: 6px; font-size: 0.72rem';
                select.insertAdjacentElement('afterend', note);
            }
            note.textContent = text || '';
            note.style.display = text ? '' : 'none';
            return note;
        }
        function syncNotices() {
            const c = C.get();
            const ttsRemote = ttsSelect && ttsSelect.value === C.ENGINE;
            const sttRemote = sttSelect && sttSelect.value === C.ENGINE;
            const paired = !!C.gatewayInfo();
            noticeUnder(
                ttsSelect,
                'sonic-tts-notice',
                ttsRemote ? C.TTS_NOTICE + (paired ? '' : ' ' + NOT_PAIRED) : ''
            );
            noticeUnder(
                sttSelect,
                'sonic-stt-notice',
                sttRemote
                    ? !paired
                        ? NOT_PAIRED
                        : c.consent
                          ? 'Microphone upload to SonicAgent: allowed.'
                          : 'Allow microphone upload to SonicAgent below (ADVANCED VOICE ▸ I agree) before speaking.'
                    : ''
            );
        }
        function onEngineChosen(e) {
            if (e.target.value === C.ENGINE) C.set({ enabled: true, userDisabled: false });
            syncNotices();
            render();
        }
        if (ttsSelect) ttsSelect.addEventListener('change', onEngineChosen);
        if (sttSelect) sttSelect.addEventListener('change', onEngineChosen);
        if (C.onChange) C.onChange(syncNotices);

        const $ = (id) => section.querySelector('#' + id);
        const status = $('sonic-status');
        const say = (text, tone) => {
            status.textContent = text;
            status.style.color = tone === 'ok' ? '#22c55e' : tone === 'err' ? '#f87171' : 'rgba(255, 255, 255, 0.75)';
        };
        const now = () => (global.performance ? global.performance.now() : Date.now());

        function render() {
            const c = C.get();
            $('sonic-enabled').checked = c.enabled;
            $('sonic-consent').checked = c.consent;
            $('sonic-consent-box').style.opacity = c.enabled ? '1' : '0.5';
            $('sonic-consent').disabled = !c.enabled;
            $('sonic-language').value = c.language || '';
            $('sonic-stream-speak').checked = c.speakWhileStreaming;
            $('sonic-fallback').checked = c.autoFallback;
            $('sonic-jitter').value = c.jitterMs;
            for (const id of ['sonic-check', 'sonic-test-stt', 'sonic-test-tts']) $(id).disabled = !c.enabled;
            $('sonic-test-stt').disabled = !c.enabled || !c.consent;
            if (!c.enabled) say('Remote voice is off.');
            else if (!C.gatewayInfo())
                say('Pair OllaBridge Cloud in Settings ▸ LLM first: remote voice uses that connection.', 'err');
            else if (!c.consent) say('Tick "I agree" to let remote speech-to-text listen.');
        }

        async function check() {
            if (!C.get().enabled) return render();
            say('Asking OllaBridge Cloud…');
            const t0 = now();
            try {
                const caps = await C.gateway().capabilities(true);
                const ms = Math.round(now() - t0);
                C.rememberCapabilities(caps);
                render();
                if (!caps.available) {
                    say(
                        `Not ready (${caps.backend && caps.backend.state ? caps.backend.state : 'unavailable'}): ${caps.reason || 'unknown'} · ${ms} ms`,
                        'err'
                    );
                    return caps;
                }
                const where = (caps.backend && caps.backend.location) || 'remote';
                const stt = caps.stt && caps.stt.ready ? 'STT ready' : 'STT not ready';
                const tts = caps.tts && caps.tts.ready ? 'TTS ready' : 'TTS not ready';
                say(`Ready on ${where} · ${stt} · ${tts} · answered in ${ms} ms`, 'ok');
                return caps;
            } catch (err) {
                say(`Cannot check: ${(err && err.message) || err}`, 'err');
                return null;
            }
        }

        function testStt() {
            const R = lib('NEXUS_REMOTE_STT');
            if (!R) return say('Remote speech recognition is not loaded.', 'err');
            const rec = new R.Recognition();
            rec.lang = C.language();
            rec.perfSurface = 'settings-mic-test';
            let stopAt = null;
            rec.onstart = () => say('Listening… say a short sentence.');
            rec.onaudioend = () => {
                stopAt = now();
                say('Transcribing on SonicAgent…');
            };
            rec.onresult = (e) => {
                const text = e.results[e.resultIndex][0].transcript;
                const ms = stopAt == null ? null : Math.round(now() - stopAt);
                say(`Heard: “${text}”${ms == null ? '' : ` · ${ms} ms after you stopped`}`, 'ok');
            };
            rec.onerror = (e) => say(e.message || e.error, e.error === 'no-speech' ? null : 'err');
            try {
                rec.start();
            } catch (err) {
                say(String(err && err.message), 'err');
            }
        }

        function testTts() {
            const T = lib('NEXUS_REMOTE_TTS');
            if (!T) return say('The streaming voice is not loaded.', 'err');
            const samples = {
                it: 'Ciao! Questa è la mia voce in streaming.',
                es: '¡Hola! Esta es mi voz en streaming.',
                fr: 'Bonjour ! Voici ma voix en streaming.',
                de: 'Hallo! Das ist meine Streaming-Stimme.',
                pt: 'Olá! Esta é a minha voz em streaming.',
            };
            const t0 = now();
            say('Requesting speech…');
            T.shared().speak(samples[C.language()] || 'Hello! This is my streaming voice.', {
                onStart: () => say(`Speaking · first sound after ${Math.round(now() - t0)} ms`, 'ok'),
                onEnd: () => {
                    const s = T.shared().lastStats();
                    say(
                        `Done · first sound ${s && s.startedAt ? s.startedAt - s.requestAt : '?'} ms after the request`,
                        'ok'
                    );
                },
                onError: (err) => say((err && err.message) || 'The streaming voice failed.', 'err'),
            });
        }

        function clear() {
            try {
                const T = lib('NEXUS_REMOTE_TTS');
                if (T) T.shared().stop();
                const S = lib('NEXUS_SONIC_STREAM');
                if (S) S._resetShared();
                const P = lib('NEXUS_STREAM_PLAYER');
                if (P) P.shared().dispose();
                say('Remote session closed. The next listen or reply opens a new one.');
            } catch (err) {
                say(String(err && err.message), 'err');
            }
        }

        $('sonic-enabled').addEventListener('change', (e) => {
            // Turning the feature off also withdraws consent: switching it back on asks again.
            C.set(
                e.target.checked
                    ? { enabled: true, userDisabled: false }
                    : { enabled: false, userDisabled: true, consent: false, consentAt: null }
            );
            if (!e.target.checked) clear();
            render();
            if (e.target.checked) check();
        });
        $('sonic-consent').addEventListener('change', (e) => {
            if (e.target.checked) C.grantConsent();
            else C.revokeConsent();
            render();
        });
        $('sonic-language').addEventListener('change', (e) => C.set({ language: e.target.value }));
        $('sonic-stream-speak').addEventListener('change', (e) => C.set({ speakWhileStreaming: e.target.checked }));
        $('sonic-fallback').addEventListener('change', (e) => C.set({ autoFallback: e.target.checked }));
        $('sonic-jitter').addEventListener('change', (e) => {
            C.set({ jitterMs: Number(e.target.value) });
            render();
        });
        $('sonic-check').addEventListener('click', check);
        $('sonic-test-stt').addEventListener('click', testStt);
        $('sonic-test-tts').addEventListener('click', testTts);
        $('sonic-clear').addEventListener('click', clear);
        const opener = doc.getElementById('settings-btn');
        if (opener) opener.addEventListener('click', render);
        render();
        syncNotices();
        return { render, check, clear, section, syncNotices };
    }

    const api = { SECTION_ID, attach };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SONIC_VOICE_SETTINGS = api;

    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => attach());
        } else {
            attach();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
