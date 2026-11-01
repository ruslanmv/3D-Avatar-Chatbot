/**
 * SttSettings — ST6/ST8. The SPEECH-TO-TEXT section: applied at once, and a microphone test.
 *
 * Why "applied at once" (ST8). On a Quest the mic test page worked and the app did not: the
 * STT PROVIDER choice was only written by SAVE, and a person who picked "On-device Whisper"
 * and closed Settings with ✕ was still on the browser's recognizer — which in Meta Quest
 * Browser hears nothing. Reproduced with a Quest user agent: closed with ✕ → engine 'browser',
 * no text; with SAVE → engine 'local', the sentence. So the provider, model size, language and
 * microphone now apply the moment they change (SAVE still saves everything, as before).
 *
 * What this section adds, without redesigning the panel (the person asked for small changes in
 * the existing dark/cyan style):
 *  - one helper sentence under STT PROVIDER that says what the chosen provider does with the
 *    voice (and, on a Quest with the browser's recognizer, that it cannot work there);
 *  - under WASM MODEL SIZE, one compact row: download button, status, a progress bar while it
 *    downloads, Remove once it is on the device;
 *  - under STT LANGUAGE, a MICROPHONE TEST: start/stop, a live meter drawn from the real input
 *    level, a status, and what the chosen provider understood. It tells "the microphone hears
 *    sound" apart from "speech was recognised" — the two failures look the same from outside.
 *
 * The test uses the provider, model and language currently chosen. On-device Whisper: the
 * app's own MicrophoneSession and NEXUS_STT.transcribeSamples (same guards as a real turn).
 * The browser's recognizer: that recognizer, with the meter on a second capture. Cloud
 * providers: the meter only, and a pointer to TEST SPEECH RECOGNITION.
 *
 * Built from JS (no index.html markup above the parity harness's frozen lines). The judgements
 * — helper text, status, the test's verdict, the meter's level — are pure and tested.
 */
(function (global) {
    'use strict';

    const GROUP_ID = 'stt-local-group';
    const TEST_ID = 'stt-mic-test';
    const STYLE_ID = 'stt-settings-style';
    const MAX_TEST_MS = 8000;
    const SEGMENTS = 14;

    const COPY = Object.freeze({
        wasm: 'Runs on this device — your voice is never uploaded. Works on Meta Quest.',
        webspeech: 'Uses your browser’s recognizer, which sends audio to the browser vendor.',
        webspeechQuest: 'Meta Quest Browser has no recognizer of its own — choose On-device Whisper to talk here.',
        openai: 'Sends each recording to OpenAI with your API key.',
        google: 'Sends each recording to Google Cloud with your API key.',
        italian: 'For Italian, Base is more accurate than Tiny.',
    });

    function stt() {
        return (global && global.NEXUS_STT) || null;
    }

    function isQuest() {
        return /OculusBrowser|Quest/i.test((global && global.navigator && global.navigator.userAgent) || '');
    }

    /** The sentence under STT PROVIDER. Pure. */
    function providerText(provider, quest) {
        if (provider === 'wasm') return COPY.wasm;
        if (provider === 'openai') return COPY.openai;
        if (provider === 'google') return COPY.google;
        return quest ? `${COPY.webspeech} ${COPY.webspeechQuest}` : COPY.webspeech;
    }

    /** The model row's status. Pure. */
    function statusText(s) {
        const st = s || {};
        const p = st.progress || {};
        const mb = (n) => (n / 1e6).toFixed(1);
        switch (st.model) {
            case 'downloading':
                return p.total ? `Downloading… ${mb(p.loaded)} of ${mb(p.total)} MB` : 'Downloading…';
            case 'loading':
                return 'Preparing the model…';
            case 'ready':
                return '✓ On this device';
            case 'error':
                return `Could not load: ${st.error || 'unknown error'}`;
            default:
                return `Not downloaded yet (~${(st.config && st.config.downloadMB) || 41} MB)`;
        }
    }

    /** Extra advice for the model row. Pure. */
    function advice(ctx) {
        const c = ctx || {};
        return c.provider === 'wasm' && c.size === 'tiny' && /^it/i.test(c.lang || '') ? [COPY.italian] : [];
    }

    /**
     * Meter level 0..1 from a block of samples: RMS in dBFS mapped from -60 (silence) to -10
     * (loud speech). Real input only — the meter never animates by itself.
     */
    function levelOf(samples) {
        if (!samples || !samples.length) return 0;
        let s = 0;
        for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
        const rms = Math.sqrt(s / samples.length);
        if (!(rms > 0)) return 0;
        const dbfs = 20 * Math.log10(rms);
        return Math.max(0, Math.min(1, (dbfs + 60) / 50));
    }

    const SOUND_LEVEL = 0.3; // ≈ -45 dBFS: above a quiet room, below quiet speech

    /**
     * The test's verdict. Pure. Input:
     *  { provider, error: {reason, message}|null, heardSound, analysis, result, failure, quest }
     * `result` is transcribeSamples' answer (or { accept, text } from the browser's recognizer);
     * `failure` a transcription error message. Answers { tone: ok|warn|error, status, text }.
     */
    function verdict(input) {
        const i = input || {};
        if (i.error) {
            const blocked = i.error.reason === 'denied';
            return {
                tone: 'error',
                status: blocked ? 'Microphone blocked' : 'Microphone error',
                text: blocked ? 'Allow the microphone for this site, then try again.' : i.error.message || '',
            };
        }
        const sound = i.heardSound || (i.analysis && i.analysis.peak > 0.02);
        if (!sound) {
            return {
                tone: 'error',
                status: 'No sound',
                text: 'The microphone opened but heard nothing. Check it is not muted (on Quest: Quick Settings).',
            };
        }
        if (i.provider === 'openai' || i.provider === 'google') {
            return {
                tone: 'ok',
                status: 'Mic works',
                text: 'Use TEST SPEECH RECOGNITION below to try the cloud provider.',
            };
        }
        if (i.failure) return { tone: 'error', status: 'Mic works · recognition failed', text: i.failure };
        if (i.result && i.result.accept) return { tone: 'ok', status: 'Mic works · recognized', text: i.result.text };
        const tail =
            i.provider === 'wasm'
                ? 'Speak a little louder or closer, for a second or more.'
                : i.quest
                  ? COPY.webspeechQuest
                  : 'The browser’s recognizer returned nothing; try again or choose On-device Whisper.';
        return { tone: 'warn', status: 'Sound detected · no words recognized', text: tail };
    }

    // ---- applying choices at once -----------------------------------------------------------

    function applyNow(d) {
        const svc = global && global.SpeechService;
        if (!svc || typeof svc.saveSTTConfig !== 'function') return;
        const val = (id) => {
            const el = d.getElementById(id);
            return el ? el.value : undefined;
        };
        const patch = {};
        if (val('stt-provider') !== undefined) patch.provider = val('stt-provider');
        if (val('stt-language') !== undefined) patch.language = val('stt-language');
        if (val('stt-microphone') !== undefined) patch.microphoneDeviceId = val('stt-microphone');
        const size = val('wasm-model-size');
        if (size !== undefined)
            patch.wasm = Object.assign({}, (svc.getSTTConfig && svc.getSTTConfig().wasm) || {}, { modelSize: size });
        try {
            svc.saveSTTConfig(patch);
            if (patch.language && typeof svc.setRecognitionOptions === 'function') {
                svc.setRecognitionOptions({ lang: patch.language });
            }
        } catch (err) {
            if (global.console) global.console.warn('[SttSettings] could not apply the STT choice:', err);
        }
    }

    // ---- the microphone test ----------------------------------------------------------------

    function createMicTest(d, ui) {
        let run = null;

        function show(state) {
            ui.button.textContent = state.running ? '■ Stop' : '🎤 Test microphone';
            ui.button.setAttribute('aria-pressed', state.running ? 'true' : 'false');
            ui.status.textContent = state.status || '';
            ui.status.className = `stt-chip stt-${state.tone || 'idle'}`;
            ui.text.textContent = state.text || '';
            ui.text.className = `stt-heard${state.tone === 'ok' && state.recognized ? ' stt-heard-ok' : ''}`;
        }

        function meter(level) {
            const lit = Math.round(level * SEGMENTS);
            ui.segments.forEach((seg, k) => seg.classList.toggle('on', k < lit));
        }

        async function finish(r, why) {
            if (run !== r || r.done) return;
            r.done = true;
            clearTimeout(r.timer);
            // While the result is worked out (Whisper can take seconds), a click must not start a
            // second recording whose meter the first run's result would then sit on top of.
            ui.button.disabled = true;
            try {
                if (r.lease) r.lease.close();
            } catch (_) {}
            try {
                if (r.sr) r.sr.stop();
            } catch (_) {}
            meter(0);
            const A = global.NEXUS_STT_AUDIO;
            const samples = A && r.chunks.length ? A.concat(r.chunks) : new Float32Array(0);
            const analysis = A && samples.length ? A.analyze(samples, r.rate) : null;
            const base = { provider: r.provider, heardSound: r.heard, analysis, quest: isQuest() };
            if (why === 'error') return end(r, verdict(Object.assign(base, { error: r.error })));
            if (!(r.heard || (analysis && analysis.peak > 0.02))) return end(r, verdict(base));
            if (r.provider === 'wasm') {
                const ready = stt().status().model === 'ready';
                show({
                    running: false,
                    status: ready ? 'Transcribing…' : 'Downloading the speech model (first time)…',
                    tone: 'busy',
                    text: '',
                });
                try {
                    const res = await stt().transcribeSamples(samples, r.rate, { language: r.lang });
                    return end(r, verdict(Object.assign(base, { result: res })), res.accept);
                } catch (err) {
                    return end(r, verdict(Object.assign(base, { failure: (err && err.message) || String(err) })));
                }
            }
            if (r.provider === 'webspeech') {
                // The browser's recognizer delivers its final text asynchronously after stop().
                await new Promise((res) => setTimeout(res, r.srEnded ? 0 : 1500));
                const result = r.srText ? { accept: true, text: r.srText } : { accept: false };
                return end(r, verdict(Object.assign(base, { result })), !!r.srText);
            }
            return end(r, verdict(base));
        }

        function end(r, v, recognized) {
            if (run !== r) return; // a newer test owns the display
            run = null;
            ui.button.disabled = false;
            show({ running: false, status: v.status, tone: v.tone, text: v.text, recognized });
        }

        async function start() {
            const mics = global.NEXUS_MIC_SESSION && global.NEXUS_MIC_SESSION.get();
            const provider = (d.getElementById('stt-provider') || {}).value || 'webspeech';
            const lang = (d.getElementById('stt-language') || {}).value || '';
            const deviceId = (d.getElementById('stt-microphone') || {}).value || null;
            const r = { provider, lang, chunks: [], rate: 16000, heard: false, done: false };
            run = r;
            show({ running: true, status: 'Opening microphone…', tone: 'busy', text: '' });
            if (provider === 'wasm' && stt())
                stt()
                    .preload()
                    .catch(() => {}); // download while they speak
            r.lease = mics.open({
                owner: 'stt-settings-test',
                deviceId,
                onFrames: (samples, rate) => {
                    if (run !== r || r.done) return;
                    r.rate = rate;
                    r.chunks.push(samples);
                    const level = levelOf(samples);
                    meter(level);
                    if (level >= SOUND_LEVEL && !r.heard) {
                        r.heard = true;
                        show({
                            running: true,
                            status: 'Sound detected',
                            tone: 'ok',
                            text: 'Keep talking, then press Stop.',
                        });
                    }
                },
                onEnded: (why) => {
                    if (why !== 'closed' && run === r && !r.done) finish(r);
                },
            });
            const opened = await r.lease.ready;
            if (run !== r || r.done) return;
            if (!opened.ok) {
                r.error = opened;
                return finish(r, 'error');
            }
            show({ running: true, status: 'Listening — speak now', tone: 'busy', text: '' });
            if (provider === 'webspeech') {
                const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
                if (SR) {
                    try {
                        const sr = new SR();
                        sr.lang = lang || 'en-US';
                        sr.continuous = true;
                        sr.interimResults = false;
                        sr.onresult = (e) => {
                            for (let k = e.resultIndex; k < e.results.length; k++) {
                                if (e.results[k].isFinal)
                                    r.srText = `${r.srText || ''} ${e.results[k][0].transcript}`.trim();
                            }
                        };
                        sr.onend = () => (r.srEnded = true);
                        sr.onerror = () => (r.srEnded = true);
                        sr.start();
                        r.sr = sr;
                    } catch (_) {
                        r.srEnded = true;
                    }
                }
            }
            r.timer = setTimeout(() => finish(r), MAX_TEST_MS);
        }

        ui.button.addEventListener('click', () => {
            if (run && !run.done) finish(run);
            else {
                start().catch((err) => {
                    run = null;
                    ui.button.disabled = false;
                    show({ running: false, tone: 'error', status: 'Microphone error', text: String(err) });
                });
            }
        });
        show({ running: false, status: 'Not tested', tone: 'idle', text: '' });
        return { stop: () => run && finish(run) };
    }

    // ---- DOM --------------------------------------------------------------------------------

    function injectStyle(d) {
        if (d.getElementById(STYLE_ID)) return;
        const s = d.createElement('style');
        s.id = STYLE_ID;
        // Scoped to the two blocks this module draws, in the panel's own colours. No glow, no cards.
        s.textContent = `
#${GROUP_ID}, #${TEST_ID} { margin-top: 8px; }
#${GROUP_ID} .stt-row, #${TEST_ID} .stt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
#${GROUP_ID} .stt-note, #${TEST_ID} .stt-note { font-size: 0.85rem; color: var(--text-muted); margin: 6px 0 0; }
#${GROUP_ID} .secondary-btn, #${TEST_ID} .secondary-btn { min-height: 44px; font-size: 0.8rem; }
#${GROUP_ID} .stt-linkbtn { background: none; border: 0; color: var(--text-secondary); text-decoration: underline; cursor: pointer; min-height: 44px; font: inherit; font-size: 0.85rem; }
#${GROUP_ID} .stt-track { flex: 1 1 160px; height: 6px; border-radius: 3px; background: rgba(0, 229, 255, 0.12); overflow: hidden; }
#${GROUP_ID} .stt-bar { height: 100%; width: 0; background: var(--primary); transition: width 120ms linear; }
#${TEST_ID} .stt-meter { display: flex; gap: 3px; align-items: flex-end; height: 22px; }
#${TEST_ID} .stt-meter span { width: 6px; height: 100%; border-radius: 2px; background: rgba(0, 229, 255, 0.15); }
#${TEST_ID} .stt-meter span.on { background: var(--accent-green); }
#${TEST_ID} .stt-chip { font-size: 0.8rem; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--text-secondary); }
#${TEST_ID} .stt-ok { color: var(--accent-green); border-color: rgba(0, 255, 136, 0.5); }
#${TEST_ID} .stt-warn { color: var(--accent-orange); border-color: rgba(255, 145, 0, 0.5); }
#${TEST_ID} .stt-error { color: var(--status-error); border-color: rgba(255, 82, 82, 0.5); }
#${TEST_ID} .stt-busy { color: var(--primary); }
#${TEST_ID} .stt-heard { margin-top: 8px; min-height: 1.4em; color: var(--text-primary); }
#${TEST_ID} .stt-heard:empty { margin: 0; min-height: 0; }
#${TEST_ID} .stt-heard-ok::before { content: 'Recognized: '; color: var(--text-muted); }
`;
        (d.head || d.documentElement).appendChild(s);
    }

    function el(d, tag, cls, text) {
        const e = d.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
    }

    function render(d) {
        const s = stt();
        const select = d.getElementById('stt-provider');
        const provider = select ? select.value : 'webspeech';
        const help = d.getElementById('stt-provider-help');
        if (help) help.textContent = providerText(provider, isQuest());
        const group = d.getElementById(GROUP_ID);
        if (!group || !s) return;
        const status = s.status();
        group.querySelector('[data-stt="status"]').textContent = statusText(status);
        const p = status.progress;
        const busy = status.model === 'downloading' || status.model === 'loading';
        const fraction = status.model === 'ready' ? 1 : p && p.fraction != null ? p.fraction : 0;
        group.querySelector('[data-stt="bar"]').style.width = `${Math.round(fraction * 100)}%`;
        group.querySelector('[data-stt="track"]').hidden = !busy;
        group.querySelector('[data-stt="download"]').hidden = status.model === 'ready' || busy;
        group.querySelector('[data-stt="remove"]').hidden = status.model !== 'ready';
        const sizeSel = d.getElementById('wasm-model-size');
        const langSel = d.getElementById('stt-language');
        const adv = advice({ provider, size: sizeSel && sizeSel.value, lang: langSel && langSel.value });
        const note = group.querySelector('[data-stt="advice"]');
        note.textContent = adv.join(' ');
        note.hidden = !adv.length;
    }

    function mount(doc) {
        const d = doc || (global && global.document);
        if (!d || !stt()) return false;
        if (d.getElementById(GROUP_ID)) {
            render(d);
            return true;
        }
        const select = d.getElementById('stt-provider');
        const providerGroup = select && select.closest ? select.closest('.input-group') : null;
        if (!providerGroup) return false;
        injectStyle(d);

        // 1. The helper sentence under STT PROVIDER: reuse the existing line, left-aligned.
        const help = providerGroup.querySelector('.voice-status');
        if (help) {
            help.id = 'stt-provider-help';
            help.style.textAlign = 'left';
        }

        // 2. The model row, inside the WASM block (shown only for On-device Whisper).
        const sizeSel = d.getElementById('wasm-model-size');
        const sizeGroup = sizeSel && sizeSel.closest ? sizeSel.closest('.input-group') : null;
        const group = el(d, 'div');
        group.id = GROUP_ID;
        const row = el(d, 'div', 'stt-row');
        const download = el(d, 'button', 'secondary-btn', '⬇ Download model');
        download.type = 'button';
        download.setAttribute('data-stt', 'download');
        const status = el(d, 'span', 'stt-note');
        status.setAttribute('data-stt', 'status');
        status.setAttribute('aria-live', 'polite');
        status.style.margin = '0';
        const remove = el(d, 'button', 'stt-linkbtn', 'Remove');
        remove.type = 'button';
        remove.setAttribute('data-stt', 'remove');
        const track = el(d, 'div', 'stt-track');
        track.setAttribute('data-stt', 'track');
        const bar = el(d, 'div', 'stt-bar');
        bar.setAttribute('data-stt', 'bar');
        track.appendChild(bar);
        row.appendChild(download);
        row.appendChild(status);
        row.appendChild(remove);
        row.appendChild(track);
        const note = el(d, 'p', 'stt-note');
        note.setAttribute('data-stt', 'advice');
        group.appendChild(row);
        group.appendChild(note);
        if (sizeGroup) sizeGroup.appendChild(group);
        else providerGroup.appendChild(group);

        // 3. The microphone test, right under STT LANGUAGE.
        const langSel = d.getElementById('stt-language');
        const langGroup = langSel && langSel.closest ? langSel.closest('.input-group') : null;
        if (langGroup && langGroup.parentNode && global.NEXUS_MIC_SESSION) {
            const test = el(d, 'div', 'input-group');
            test.id = TEST_ID;
            test.appendChild(el(d, 'label', 'input-label', 'MICROPHONE TEST'));
            const trow = el(d, 'div', 'stt-row');
            const button = el(d, 'button', 'secondary-btn', '🎤 Test microphone');
            button.type = 'button';
            const chip = el(d, 'span', 'stt-chip stt-idle', 'Not tested');
            chip.setAttribute('aria-live', 'polite');
            const meterEl = el(d, 'div', 'stt-meter');
            meterEl.setAttribute('aria-hidden', 'true');
            const segments = [];
            for (let k = 0; k < SEGMENTS; k++) segments.push(meterEl.appendChild(el(d, 'span')));
            trow.appendChild(button);
            trow.appendChild(chip);
            trow.appendChild(meterEl);
            const heard = el(d, 'div', 'stt-heard');
            heard.setAttribute('aria-live', 'polite');
            test.appendChild(trow);
            test.appendChild(heard);
            langGroup.parentNode.insertBefore(test, langGroup.nextSibling);
            createMicTest(d, { button, status: chip, text: heard, segments });
        }

        download.addEventListener('click', () => {
            stt()
                .preload()
                .catch(() => {})
                .then(() => render(d));
            render(d);
        });
        remove.addEventListener('click', () => {
            stt()
                .clearCache()
                .catch(() => {})
                .then(() => render(d));
        });
        const changed = () => {
            applyNow(d);
            render(d);
        };
        for (const id of ['stt-provider', 'wasm-model-size', 'stt-language', 'stt-microphone']) {
            const s = d.getElementById(id);
            if (s) s.addEventListener('change', changed);
        }
        try {
            global.addEventListener('nexus-stt', (e) => {
                const t = e.detail && e.detail.type;
                if (t === 'model-state' || t === 'model-progress' || t === 'config') render(d);
            });
        } catch (_) {}
        render(d);
        return true;
    }

    const out = {
        GROUP_ID,
        TEST_ID,
        COPY,
        providerText,
        statusText,
        advice,
        levelOf,
        verdict,
        SOUND_LEVEL,
        mount,
        render,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = out;
    if (global) {
        global.NEXUS_STT_SETTINGS = out;
        const d = global.document;
        if (d && typeof module === 'undefined') {
            if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => mount(d));
            else mount(d);
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
