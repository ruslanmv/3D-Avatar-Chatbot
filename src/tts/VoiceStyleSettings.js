/**
 * VoiceStyleSettings — HV9 / HV-FIX Batches 3–5. The SonicAgent voice, chosen where voices are.
 *
 * Drawn inside Settings ▸ SPEECH, right under TTS ENGINE, and shown only while TTS ENGINE is
 * "SonicAgent Piper — Cloud streaming". Before this the remote voice was a separate REMOTE VOICE
 * list in ADVANCED VOICE that only ever held the voice ids already installed, while the VOICE
 * list people actually used listed the browser's voices — so choosing a voice for SonicAgent
 * was not possible where anyone would look.
 *
 *   VOICE STYLE   Companion · Secretary / Productivity · All Voices
 *   LANGUAGE      her voice's language (default: the app's)
 *   VOICE         Auto — <what Auto resolves to>, then the catalogue's voices FOR THAT
 *                 LANGUAGE (HV-FIX 7: VOICE LANGUAGE filters the list; English (US) offers the
 *                 en_US voices, not all 49): name — role — gender — locale — quality,
 *                 unavailable ones disabled with the reason. "Prefer Female" only orders it.
 *   Status, a note on rate and pitch, ▶ Preview, Test streaming latency.
 *
 * Rules: the catalogue is SonicAgent's (`GET /v1/voice/voices` through OllaBridge), never the
 * installed-ids list; an explicit pick is kept across catalogue refreshes; a pick that is not
 * a SonicAgent voice, or not of this language, is never sent; nothing changes STT or the
 * conversation; a preview never enters the history and cancels whatever was speaking.
 */
(function (global) {
    'use strict';

    const GROUP_ID = 'sonic-voice-group';
    const ENGINE = 'sonicagent-stream';
    const HIT = 'min-height: 44px; font-size: 0.8rem';
    const RATE_NOTE =
        'Rate and pitch do not apply to SonicAgent: each voice’s speaking style sets its pace ' +
        '(Companion slower and softer, Secretary quicker and clearer).';

    function lib(name) {
        return (global && global[name]) || null;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    function build(doc) {
        const g = doc.createElement('div');
        g.id = GROUP_ID;
        g.className = 'input-group';
        const radio = (value, text) =>
            `<label style="display: inline-flex; align-items: center; gap: 8px; ${HIT}; margin-right: 14px; cursor: pointer">` +
            `<input type="radio" name="sonic-voice-style" value="${value}" style="width: 20px; height: 20px" /> ${esc(text)}</label>`;
        g.innerHTML =
            '<label class="input-label">VOICE STYLE</label>' +
            '<div role="radiogroup" aria-label="Voice style">' +
            radio('companion', 'Companion') +
            radio('secretary', 'Secretary / Productivity') +
            radio('all', 'All Voices') +
            '</div>' +
            '<label class="input-label" for="sonic-voice-language" style="margin-top: 8px">VOICE LANGUAGE</label>' +
            `<select id="sonic-voice-language" class="select-input" style="${HIT}"></select>` +
            '<label class="input-label" for="sonic-voice-select" style="margin-top: 8px">VOICE</label>' +
            `<select id="sonic-voice-select" class="select-input" style="${HIT}"></select>` +
            '<p id="sonic-voice-status" class="voice-status" role="status" aria-live="polite"' +
            ' style="margin-top: 8px; font-size: 0.74rem"></p>' +
            `<p class="voice-status" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75">${esc(RATE_NOTE)}</p>` +
            '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px">' +
            `<button type="button" id="sonic-voice-preview" class="secondary-btn" style="${HIT}; padding: 6px 14px">▶ Preview</button>` +
            `<button type="button" id="sonic-voice-latency" class="secondary-btn" style="${HIT}; padding: 6px 14px">Test streaming latency</button>` +
            `<button type="button" id="sonic-voice-other-engine" class="secondary-btn" style="${HIT}; padding: 6px 14px; display: none">Use the browser voice for this language</button>` +
            '</div>';
        return g;
    }

    const LANGS = [
        ['', 'Same as the app'],
        ['en-US', 'English (US)'],
        ['en-GB', 'English (UK)'],
        ['it-IT', 'Italiano'],
        ['es-ES', 'Español (España)'],
        ['es-MX', 'Español (México)'],
        ['fr-FR', 'Français'],
        ['de-DE', 'Deutsch'],
        ['pt-BR', 'Português (Brasil)'],
    ];

    function roleName(role) {
        return role === 'secretary' ? 'Secretary' : role === 'companion' ? 'Companion' : 'Catalog';
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        const C = o.config || lib('NEXUS_SONIC_VOICE');
        const P = o.policy || lib('NEXUS_VOICE_POLICY');
        const L = o.library || lib('NEXUS_VOICE_LIBRARY');
        const tts = () => o.tts || (lib('NEXUS_REMOTE_TTS') && lib('NEXUS_REMOTE_TTS').shared());
        const store = o.store || global.localStorage;
        if (!doc || !C || !P) return null;
        const engineEl = doc.getElementById('tts-engine');
        if (!engineEl) return null;
        let group = doc.getElementById(GROUP_ID);
        if (!group) {
            group = build(doc);
            const anchor = engineEl.closest('.input-group') || engineEl;
            anchor.insertAdjacentElement('afterend', group);
        }
        const $ = (id) => group.querySelector('#' + id);
        const now = () => (global.performance ? global.performance.now() : Date.now());
        let previewing = false;
        let loading = false;

        function status(text, tone) {
            const el = $('sonic-voice-status');
            el.textContent = text || '';
            el.style.color = tone === 'ok' ? '#22c55e' : tone === 'err' ? '#f87171' : tone === 'warn' ? '#fbbf24' : '';
        }

        const library = () => (C.library ? C.library() : null);
        const remoteSelected = () => engineEl.value === ENGINE;

        function setRateEnabled(on) {
            for (const id of ['speech-rate', 'speech-pitch']) {
                const el = doc.getElementById(id);
                if (!el) continue;
                el.disabled = !on;
                el.title = on ? '' : RATE_NOTE;
            }
        }

        /** The static note under TTS ENGINE is about Piper WASM's ~60 MB download — not SonicAgent. */
        function setPiperNoteVisible(on) {
            const box = engineEl.closest('.input-group');
            if (!box) return;
            for (const p of box.querySelectorAll('p.voice-status')) {
                if (/WebAssembly|60 MB/.test(p.textContent || '')) p.style.display = on ? '' : 'none';
            }
        }

        function render() {
            const visible = remoteSelected();
            group.style.display = visible ? '' : 'none';
            setRateEnabled(!visible);
            setPiperNoteVisible(!visible);
            if (!visible) return;
            const c = C.get();
            for (const r of group.querySelectorAll('input[name="sonic-voice-style"]'))
                r.checked = r.value === (c.profile || 'companion');
            const langSel = $('sonic-voice-language');
            if (!langSel.options.length)
                langSel.innerHTML = LANGS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
            langSel.value = LANGS.some(([v]) => v === (c.ttsLanguage || '')) ? c.ttsLanguage || '' : '';

            const input = P.inputFromSettings(C, store);
            const auto = P.resolve(Object.assign({}, input, { explicit: null }));
            const chosen = P.resolve(input);
            const lib_ = library();
            const sel = $('sonic-voice-select');
            const byId = (id) => (lib_ && lib_.voices.find((v) => v.id === id)) || null;
            const autoV = byId(auto.voice);
            const autoText = auto.voice
                ? autoV
                    ? `${autoV.name} (${roleName(autoV.role)}, ${autoV.languageLabel})`
                    : auto.voice
                : 'no voice for this language';
            let html = `<option value="">Auto — ${esc(autoText)}</option>`;
            const shown = P.grouped(lib_, {
                language: input.language,
                gender: input.gender,
                style: input.style,
                onlyLanguage: true,
            });
            for (const grp of shown) {
                html += `<optgroup label="${esc(grp.label)}">`;
                for (const v of grp.voices) {
                    const why = v.playable
                        ? ''
                        : ` (${v.state === 'missing' ? 'not on this server' : 'not available'})`;
                    html += `<option value="${esc(v.id)}"${v.playable ? '' : ' disabled'}>${esc(P.label(v) + why)}</option>`;
                }
                html += '</optgroup>';
            }
            sel.innerHTML = html;
            // An explicit pick survives a catalogue refresh; one that is not a SonicAgent voice
            // (a local Piper id) shows as Auto and is not sent.
            sel.value = c.voice && byId(c.voice) ? c.voice : '';

            const unsupported = !auto.voice && auto.reason === 'no-voice-for-language';
            $('sonic-voice-other-engine').style.display = unsupported ? '' : 'none';
            const inLanguage = shown.reduce((n, g) => n + g.voices.length, 0);
            const langLabel = shown.length === 1 ? shown[0].label : 'this language';
            const count = lib_
                ? ` · ${inLanguage} ${inLanguage === 1 ? 'voice' : 'voices'} in ${langLabel}, ` +
                  `${lib_.voices.length} in the catalog (${lib_.voices.filter((v) => v.playable).length} playable)`
                : '';
            if (chosen.ignoredExplicit) {
                status(`“${chosen.ignoredExplicit}” is not a SonicAgent voice; using Auto.${count}`, 'warn');
            } else if (!chosen.voice) {
                status((chosen.message || P.NO_LANGUAGE) + count, 'err');
            } else if (chosen.preferenceUnmet) {
                status(chosen.message + count, 'warn');
            } else if (!lib_) {
                status(
                    loading
                        ? 'Loading the SonicAgent voice catalog…'
                        : `Using ${chosen.voice}. The catalog is not loaded.`
                );
            } else {
                const v = byId(chosen.voice);
                const state = v ? (v.state === 'loaded' ? 'Ready' : 'Installed · loads on first use') : '';
                status(
                    `${P.label(v || { name: chosen.voice })} · ${state}${count}`,
                    v && v.state === 'loaded' ? 'ok' : null
                );
            }
        }

        async function load(fresh) {
            if (!remoteSelected()) return render();
            const T = tts();
            if (!T || !T.refreshLibrary) return render();
            loading = true;
            render();
            const got = await T.refreshLibrary(fresh).catch(() => null);
            loading = false;
            render();
            if (!got) {
                const ready = T.readiness ? T.readiness() : null;
                status(
                    ready && ready.available === false && ready.reason
                        ? `The voice catalog is not available: ${ready.reason}.`
                        : 'The SonicAgent voice catalog is not available from OllaBridge Cloud right now.',
                    'err'
                );
            }
        }

        function warmChosen() {
            const T = tts();
            const v = P.resolveRemote(C, store).voice;
            if (T && T.warm && v) Promise.resolve(T.warm(v)).catch(() => {});
        }

        function stopPreview() {
            const T = tts();
            if (T) T.stop();
            previewing = false;
            $('sonic-voice-preview').textContent = '▶ Preview';
        }

        function previewOnce(handlers) {
            const T = tts();
            const r = P.resolveRemote(C, store);
            if (!T || !r.voice) {
                status(r.message || P.NO_LANGUAGE, 'err');
                return null;
            }
            const style = C.get().profile === 'secretary' ? 'secretary' : 'companion';
            const v = (library() && library().voices.find((x) => x.id === r.voice)) || null;
            const language = (v && v.language) || String(P.inputFromSettings(C, store).language).slice(0, 2);
            const role = v && v.role === 'secretary' ? 'secretary' : v && v.role === 'companion' ? 'companion' : style;
            const text = (L && L.previewText(language, role)) || 'Hello.';
            return T.preview(r.voice, text, handlers) || true;
        }

        $('sonic-voice-preview').addEventListener('click', () => {
            if (previewing) return stopPreview();
            const t0 = now();
            previewing = true;
            $('sonic-voice-preview').textContent = '■ Stop';
            const started = previewOnce({
                onStart: () => status(`Previewing · first sound after ${Math.round(now() - t0)} ms`, 'ok'),
                onEnd: () => {
                    stopPreview();
                    render();
                },
                onError: (e) => {
                    stopPreview();
                    status(`SonicAgent could not start: ${(e && e.message) || 'unknown reason'}.`, 'err');
                },
            });
            if (!started) stopPreview();
        });

        $('sonic-voice-latency').addEventListener('click', async () => {
            const firsts = [];
            let cold = false;
            let rtfs = [];
            let underruns = 0;
            for (let k = 0; k < 3; k++) {
                const t0 = now();
                const r = await new Promise((resolve) => {
                    let first = null;
                    const p = previewOnce({
                        onStart: () => (first = Math.round(now() - t0)),
                        onEnd: () => resolve({ ok: true, first }),
                        onError: (e) => resolve({ ok: false, message: e && e.message }),
                    });
                    if (!p) resolve({ ok: false, message: 'no voice' });
                });
                if (!r.ok) return status(`SonicAgent could not start: ${r.message || 'unknown reason'}.`, 'err');
                const s = (tts().lastStats && tts().lastStats()) || {};
                if (r.first != null) firsts.push(r.first);
                cold = cold || !!(s.server && s.server[0] && s.server[0].cold);
                rtfs = rtfs.concat((s.server || []).map((x) => x.rtf).filter((x) => x != null));
                underruns += s.underruns || 0;
            }
            status(
                `First sound ${firsts.join(' / ')} ms${cold ? ' (the first run loaded the model)' : ''}` +
                    (rtfs.length ? ` · synthesis RTF ${Math.min(...rtfs)}–${Math.max(...rtfs)}` : '') +
                    ` · underruns ${underruns}`,
                'ok'
            );
        });

        $('sonic-voice-other-engine').addEventListener('click', async () => {
            // An explicit choice, for a language SonicAgent has no voice for.
            engineEl.value = 'web-speech-api';
            const TP = global.TTSProvider;
            if (TP && TP.setEngine) await TP.setEngine('web-speech-api');
            engineEl.dispatchEvent(new global.Event('change'));
            render();
        });

        for (const r of group.querySelectorAll('input[name="sonic-voice-style"]')) {
            r.addEventListener('change', () => {
                // A style change resets to that style's Auto: keeping Kristin under Secretary
                // would change the label and not the voice.
                C.set({ profile: r.value, voice: '' });
                render();
                warmChosen();
            });
        }
        $('sonic-voice-language').addEventListener('change', (e) => {
            C.set({ ttsLanguage: e.target.value, voice: '' }); // never carry a voice into another language
            render();
            warmChosen();
        });
        $('sonic-voice-select').addEventListener('change', (e) => {
            C.set({ voice: e.target.value || '' });
            render();
            warmChosen();
        });
        engineEl.addEventListener('change', () => {
            render();
            if (remoteSelected()) load(false);
        });
        if (global.addEventListener) global.addEventListener('nexus-tts-engine', () => render());
        const prefEl = doc.getElementById('speech-voice-pref');
        if (prefEl) prefEl.addEventListener('change', () => render());
        const opener = doc.getElementById('settings-btn');
        if (opener) opener.addEventListener('click', () => load(false));
        if (C.onChange) C.onChange(() => render());
        render();
        if (remoteSelected()) load(false);
        return { render, load, group };
    }

    const api = { GROUP_ID, RATE_NOTE, attach };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VOICE_STYLE_SETTINGS = api;

    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) {
        // After ADVANCED VOICE has added the SonicAgent option to TTS ENGINE (DOMContentLoaded).
        if (global.document.readyState === 'complete') attach();
        else global.document.addEventListener('DOMContentLoaded', () => setTimeout(() => attach(), 0));
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
