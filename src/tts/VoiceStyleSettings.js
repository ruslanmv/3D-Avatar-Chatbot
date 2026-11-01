/**
 * VoiceStyleSettings — HV9. Settings ▸ VOICE & SPEAKING STYLE.
 *
 *   Speech Provider   the TTS engines that exist (built-in, Piper on this device, SonicAgent)
 *   Language          her voice's language — independent of the listening language
 *   Speaking Style    Companion · Secretary / Productivity · All Voices
 *   Voice             the voices for that language and style, each with its state
 *   Status            Ready / Installed · loads on first use / Not on this server
 *   ▶ Preview Voice   Apply Voice   Test Streaming Latency
 *
 * What it promises, and how:
 *
 *  - **Nothing changes until the person acts.** Selecting a voice or a style previews nothing
 *    and saves nothing; Apply saves the voice, the style and the language, and warms that one
 *    voice on SonicAgent. Choosing a Speech Provider is the same choice as TTS ENGINE above and
 *    goes through `TTSProvider.setEngine` exactly as Save does.
 *  - **Never a voice of another language.** The list is filtered by language; a language with
 *    no playable voice says so instead of falling back to English (VoiceLibrary.choose).
 *  - **Only playable voices can be picked.** The rest are listed, disabled, with their state.
 *  - **A preview is not a message.** It plays through the same player and lip-sync as her
 *    replies, cancels whatever she was saying (never two voices at once), can be stopped, and
 *    never touches the conversation or its history.
 *  - **Quest controllers.** Every control is a native element with a large hit area (44 px),
 *    so a ray click is enough; nothing needs hover or a keyboard.
 *
 * Drawn from JS before DEVELOPER, like ADVANCED VOICE, so index.html gains no frozen lines.
 */
(function (global) {
    'use strict';

    const SECTION_ID = 'voice-style-section';
    const ENGINE = 'sonicagent-stream';
    const HIT = 'min-height: 44px; padding: 8px 14px; font-size: 0.8rem';
    const HINT = 'font-size: 0.68rem; color: rgba(255, 255, 255, 0.5); margin: 6px 2px 0';

    function lib(name) {
        return (global && global[name]) || null;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    function build(doc) {
        const section = doc.createElement('div');
        section.className = 'config-section';
        section.id = SECTION_ID;
        const radio = (value, label) =>
            `<label style="display: flex; align-items: center; gap: 10px; ${HIT}; cursor: pointer">` +
            `<input type="radio" name="voice-style-profile" value="${value}" style="width: 22px; height: 22px" /> ${esc(label)}</label>`;
        section.innerHTML =
            '<h3 class="config-title">VOICE &amp; SPEAKING STYLE</h3>' +
            '<div class="input-group">' +
            '<label class="input-label" for="voice-style-provider">SPEECH PROVIDER</label>' +
            `<select id="voice-style-provider" class="select-input" style="${HIT}"></select>` +
            '<label class="input-label" for="voice-style-language" style="margin-top: 10px">LANGUAGE</label>' +
            `<select id="voice-style-language" class="select-input" style="${HIT}"></select>` +
            '<div class="input-label" style="margin-top: 10px">SPEAKING STYLE</div>' +
            '<div role="radiogroup" aria-label="Speaking style">' +
            radio('companion', 'Companion — warm, natural conversation') +
            radio('secretary', 'Secretary / Productivity — clear, efficient') +
            radio('all', 'All Voices') +
            '</div>' +
            '<label class="input-label" for="voice-style-voice" style="margin-top: 10px">VOICE</label>' +
            `<select id="voice-style-voice" class="select-input" style="${HIT}"></select>` +
            '<p id="voice-style-status" role="status" aria-live="polite" style="font-size: 0.74rem;' +
            ' color: rgba(255, 255, 255, 0.8); margin: 8px 2px 0">Status: —</p>' +
            '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px">' +
            `<button type="button" id="voice-style-preview" class="secondary-btn" style="${HIT}">▶ Preview Voice</button>` +
            `<button type="button" id="voice-style-apply" class="secondary-btn" style="${HIT}">Apply Voice</button>` +
            `<button type="button" id="voice-style-latency" class="secondary-btn" style="${HIT}">Test Streaming Latency</button>` +
            '</div>' +
            `<p id="voice-style-note" style="${HINT}">Voices, styles and previews here are SonicAgent's, through` +
            ' OllaBridge Cloud. Piper on this device and the browser voices keep their own settings above.' +
            ' Turn on remote voice in ADVANCED VOICE first.</p>' +
            '</div>';
        return section;
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        const C = o.config || lib('NEXUS_SONIC_VOICE');
        const L = o.library || lib('NEXUS_VOICE_LIBRARY');
        const tts = () => o.tts || (lib('NEXUS_REMOTE_TTS') && lib('NEXUS_REMOTE_TTS').shared());
        const engines = () => o.engines || lib('TTSProvider');
        if (!doc || !C || !L) return null;
        const modal = doc.getElementById('settings-modal');
        const content = modal && modal.querySelector('.modal-content');
        if (!content) return null;
        let section = doc.getElementById(SECTION_ID);
        if (!section) {
            section = build(doc);
            // Right after ADVANCED VOICE (which turns remote voice on), else before DEVELOPER.
            const advanced = doc.getElementById('sonicagent-voice-section');
            const developer = Array.from(content.querySelectorAll('.config-section')).find((n) =>
                /DEVELOPER/.test((n.querySelector('.config-title') || {}).textContent || '')
            );
            content.insertBefore(section, advanced ? advanced.nextSibling : developer || null);
        }
        const $ = (id) => section.querySelector('#' + id);
        const now = () => (global.performance ? global.performance.now() : Date.now());
        // What is on screen, not yet applied.
        const draft = { language: null, profile: null, voice: null };
        let previewing = false;

        function status(text, tone) {
            const el = $('voice-style-status');
            el.textContent = 'Status: ' + text;
            el.style.color = tone === 'ok' ? '#22c55e' : tone === 'err' ? '#f87171' : 'rgba(255, 255, 255, 0.8)';
        }

        function library() {
            return (C.library && C.library()) || null;
        }

        function renderProviders() {
            const sel = $('voice-style-provider');
            const T = engines();
            const list = (T && T.listEngines && T.listEngines()) || [
                { id: 'web-speech-api', name: 'Web Speech API (built-in)' },
            ];
            sel.innerHTML = list.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
            const stored = T && T.getStoredEngine ? T.getStoredEngine() : 'web-speech-api';
            if (list.some((e) => e.id === stored)) sel.value = stored;
        }

        function render() {
            const c = C.get();
            const lib_ = library();
            draft.language = draft.language || c.ttsLanguage || c.language || C.ttsLanguage();
            draft.profile = draft.profile || c.profile || 'companion';
            renderProviders();
            for (const r of section.querySelectorAll('input[name="voice-style-profile"]'))
                r.checked = r.value === draft.profile;
            const langSel = $('voice-style-language');
            const langs = lib_
                ? L.languages(lib_)
                : Object.keys(L.LANGUAGE_LABELS).map((k) => ({ language: k, label: L.LANGUAGE_LABELS[k] }));
            langSel.innerHTML = langs
                .map((l) => `<option value="${esc(l.language)}">${esc(l.label)}</option>`)
                .join('');
            langSel.value = draft.language;
            const voiceSel = $('voice-style-voice');
            const enabled = c.enabled;
            for (const id of ['voice-style-preview', 'voice-style-apply', 'voice-style-latency'])
                $(id).disabled = !enabled || !lib_;
            if (!enabled) {
                voiceSel.innerHTML = '<option value="">Remote voice is off</option>';
                return status('Turn on remote voice in ADVANCED VOICE — SONICAGENT STREAMING.');
            }
            if (!lib_) {
                voiceSel.innerHTML = '<option value="">Loading the voice library…</option>';
                return status('Loading…');
            }
            const list = L.filter(lib_, { language: draft.language, profile: draft.profile });
            voiceSel.innerHTML =
                list
                    .map(
                        (v) =>
                            `<option value="${esc(v.id)}"${v.playable ? '' : ' disabled'}>${esc(L.describe(v))}` +
                            `${v.playable ? '' : ' — ' + esc(L.STATE_LABELS[v.state] || v.state)}</option>`
                    )
                    .join('') || '<option value="">No voices for this language and style</option>';
            const pick =
                draft.voice && list.some((v) => v.id === draft.voice && v.playable)
                    ? { voice: draft.voice }
                    : L.choose(lib_, {
                          language: draft.language,
                          profile: draft.profile,
                          current: c.voice || null,
                      });
            draft.voice = pick.voice;
            if (pick.voice) voiceSel.value = pick.voice;
            describeStatus();
        }

        function describeStatus() {
            const lib_ = library();
            if (!lib_) return;
            if (!draft.voice) {
                const label = L.LANGUAGE_LABELS[draft.language] || draft.language;
                return status(`No playable voice for ${label} on this server.`, 'err');
            }
            const v = lib_.voices.find((x) => x.id === draft.voice);
            const shared = v.sharesModelWith.length
                ? ` · same model as ${v.sharesModelWith.join(', ')} — switching style loads nothing`
                : '';
            status(`${L.STATE_LABELS[v.state] || v.state}${shared}`, v.state === 'loaded' ? 'ok' : null);
        }

        async function load(fresh) {
            const T = tts();
            if (!C.get().enabled || !T || !T.refreshLibrary) return render();
            status('Loading the voice library…');
            const got = await T.refreshLibrary(fresh);
            if (!got) status('The voice library is not available from OllaBridge Cloud right now.', 'err');
            render();
        }

        function stopPreview() {
            const T = tts();
            if (T) T.stop();
            previewing = false;
            $('voice-style-preview').textContent = '▶ Preview Voice';
        }

        function preview() {
            const T = tts();
            if (!T || !draft.voice) return;
            if (previewing) return stopPreview();
            const v = library().voices.find((x) => x.id === draft.voice);
            const text = L.previewText(v.language, v.role === 'secretary' ? 'secretary' : 'companion');
            if (!text) return status('No preview sentence for this language.', 'err');
            previewing = true;
            $('voice-style-preview').textContent = '■ Stop Preview';
            const t0 = now();
            T.preview(draft.voice, text, {
                onStart: () => status(`Previewing · first sound after ${Math.round(now() - t0)} ms`, 'ok'),
                onEnd: () => {
                    stopPreview();
                    describeStatus();
                },
                onError: (e) => {
                    stopPreview();
                    status((e && e.message) || 'The preview could not play.', 'err');
                },
            });
        }

        async function apply() {
            if (!draft.voice) return;
            C.set({ voice: draft.voice, profile: draft.profile, ttsLanguage: draft.language });
            status('Applied · warming the voice on SonicAgent…');
            try {
                const r = await tts().warm(draft.voice);
                status(
                    r && r.cold ? `Applied · ready (loaded in ${Math.round(r.load_ms || r.ms)} ms)` : 'Applied · ready',
                    'ok'
                );
            } catch (e) {
                status(`Applied · it will load on first use (${(e && e.message) || 'warm failed'})`);
            }
            load(true);
        }

        async function latency() {
            const T = tts();
            if (!T || !draft.voice) return;
            const v = library().voices.find((x) => x.id === draft.voice);
            const text = L.previewText(v.language, v.role === 'secretary' ? 'secretary' : 'companion');
            const runs = [];
            for (let i = 0; i < 3; i++) {
                const t0 = now();
                const r = await new Promise((resolve) => {
                    let first = null;
                    T.preview(draft.voice, text, {
                        onStart: () => (first = Math.round(now() - t0)),
                        onEnd: () => resolve({ ok: true, first }),
                        onError: (e) => resolve({ ok: false, message: e && e.message }),
                    });
                });
                if (!r.ok) return status(r.message || 'The test could not play.', 'err');
                const s = T.lastStats() || {};
                const srv = (s.server || [])[0] || {};
                runs.push({ first: r.first, cold: srv.cold, rtf: srv.rtf, underruns: s.underruns || 0 });
            }
            const firsts = runs.map((r) => r.first).filter((x) => x != null);
            const rtfs = runs.map((r) => r.rtf).filter((x) => x != null);
            status(
                `First sound ${firsts.join(' / ')} ms` +
                    (runs[0].cold ? ' (first run loaded the model)' : '') +
                    (rtfs.length ? ` · synthesis RTF ${Math.min(...rtfs)}–${Math.max(...rtfs)}` : '') +
                    ` · underruns ${runs.reduce((a, r) => a + r.underruns, 0)}`,
                'ok'
            );
        }

        $('voice-style-provider').addEventListener('change', async (e) => {
            const T = engines();
            const next = e.target.value;
            // The same choice as TTS ENGINE: keep the two in step and store it the way Save does.
            const main = doc.getElementById('tts-engine');
            if (main && Array.from(main.options).some((op) => op.value === next)) main.value = next;
            if (T && T.setEngine) {
                const ok = await T.setEngine(next);
                if (!ok && next === ENGINE)
                    status('SonicAgent voice could not start; the built-in voice speaks for now.', 'err');
            }
        });
        $('voice-style-language').addEventListener('change', (e) => {
            draft.language = e.target.value;
            draft.voice = null; // never carry a voice into another language
            render();
        });
        for (const r of section.querySelectorAll('input[name="voice-style-profile"]')) {
            r.addEventListener('change', () => {
                draft.profile = r.value;
                draft.voice = null;
                render();
            });
        }
        $('voice-style-voice').addEventListener('change', (e) => {
            draft.voice = e.target.value || null;
            describeStatus();
        });
        $('voice-style-preview').addEventListener('click', preview);
        $('voice-style-apply').addEventListener('click', apply);
        $('voice-style-latency').addEventListener('click', latency);
        const opener = doc.getElementById('settings-btn');
        if (opener) opener.addEventListener('click', () => load(false));
        if (C.onChange) C.onChange(() => render());
        render();
        load(false);
        return { render, load, preview, apply, latency, draft, section };
    }

    const api = { SECTION_ID, attach };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VOICE_STYLE_SETTINGS = api;

    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) {
        // Deferred scripts run before DOMContentLoaded; waiting for it lets ADVANCED VOICE (a
        // plain script that attaches on DOMContentLoaded) draw first, so this lands after it.
        if (global.document.readyState === 'complete') attach();
        else global.document.addEventListener('DOMContentLoaded', () => attach());
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
