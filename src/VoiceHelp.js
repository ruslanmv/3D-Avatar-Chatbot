/**
 * VoiceHelp.js — "Get more built-in voices" help affordance.
 *
 * ARCHITECTURE TRUTH (why this exists): the Built-in engine is the browser's
 * Web Speech API, a thin bridge to the OPERATING SYSTEM's TTS. This app ships
 * no models on that path and CANNOT download any — it only enumerates whatever
 * voices the device offers and picks one. So when a language has no voice, the
 * fix is always on the device, never in the app. Every string below is written
 * to say that honestly; none of them may imply the app can install a voice.
 *
 * Piper is the opposite: we choose those models (ONNX from Hugging Face, cached
 * in-browser), so they are identical on every device. See docs/VOICES.md.
 *
 * Additive and non-destructive: this module only renders a notice, a button and
 * a help expander. It does not touch voice selection, the engines, or the
 * language cascade — it reads state, never writes it.
 */
(function () {
    'use strict';

    const INTENT_TTS_SETTINGS = 'intent:#Intent;action=com.android.settings.TTS_SETTINGS;end';
    const FALLBACK_MS = 1200; // still here after this → the intent didn't launch

    /* ------------------------------------------------------------------ */
    /* Platform detection                                                  */
    /* ------------------------------------------------------------------ */
    function platform() {
        const ua = navigator.userAgent || '';
        if (/android/i.test(ua)) return 'android';
        // iPadOS 13+ reports as Macintosh; touch points give it away.
        if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1))
            return 'ios';
        if (/windows/i.test(ua)) return 'windows';
        if (/macintosh|mac os x/i.test(ua)) return 'macos';
        if (/linux|x11/i.test(ua)) return 'linux';
        return 'other';
    }

    /**
     * Human name for a language tag. The app's own dropdown label wins so the
     * notice says the same thing the user picked ("Español", not Intl's
     * "Español de España"); Intl.DisplayNames is the fallback.
     */
    function langName(code) {
        const opt = [...(document.getElementById('speech-lang')?.options || [])].find((o) => o.value === code);
        if (opt) return opt.textContent.trim();
        try {
            const dn = new Intl.DisplayNames([code], { type: 'language' });
            const n = dn.of(code) || dn.of(code.slice(0, 2));
            if (n) return n.charAt(0).toUpperCase() + n.slice(1);
        } catch (_) {}
        return code;
    }

    /* ------------------------------------------------------------------ */
    /* State readers (read-only — never mutate app settings)               */
    /* ------------------------------------------------------------------ */
    function currentEngine() {
        const el = document.getElementById('tts-engine');
        return (el && el.value) || localStorage.getItem('tts_engine') || 'web-speech-api';
    }

    function currentLang() {
        return (
            window.AppLanguage?.code ||
            document.getElementById('speech-lang')?.value ||
            localStorage.getItem('speech_lang') ||
            navigator.language ||
            'en-US'
        );
    }

    /** Voices the device offers for a language tag (base match, e.g. "es"). */
    function voicesFor(code) {
        const base = String(code).slice(0, 2).toLowerCase();
        let list = [];
        try {
            list = window.speechSynthesis?.getVoices?.() || [];
        } catch (_) {}
        return list.filter((v) =>
            String(v.lang || '')
                .toLowerCase()
                .replace('_', '-')
                .startsWith(base)
        );
    }

    /* ------------------------------------------------------------------ */
    /* Per-platform manual steps (the honest path, always available)       */
    /* ------------------------------------------------------------------ */
    function steps(p) {
        switch (p) {
            case 'android':
                return [
                    'Open <b>Settings → System → Languages &amp; input → Text-to-speech output</b>.',
                    'Set the engine to <b>Speech Recognition &amp; Synthesis from Google</b>. ' +
                        'If your phone defaults to a vendor engine (e.g. Samsung TTS) that lacks the language, switch to Google’s here.',
                    'Tap the ⚙ next to the engine → <b>Install voice data</b>.',
                    'Choose your language and download a voice.',
                    'Come back and tap <b>↻ Re-scan voices</b> (reload the page if it still isn’t listed).',
                ];
            case 'ios':
                return [
                    'Open <b>Settings → Accessibility → Spoken Content → Voices</b>.',
                    'Pick your language, then download a voice.',
                    'Relaunch Safari — new voices only appear to web pages after a relaunch.',
                    'Come back and tap <b>↻ Re-scan voices</b>.',
                ];
            case 'windows':
                return [
                    'Open <b>Settings → Time &amp; Language → Speech</b> → <b>Add voices</b>.',
                    'Install the language you want, then restart the browser.',
                    'For the best quality use <b>Microsoft Edge</b>, which also exposes the ' +
                        '“Microsoft … Online (Natural)” neural voices.',
                    'Come back and tap <b>↻ Re-scan voices</b>.',
                ];
            case 'macos':
                return [
                    'Open <b>System Settings → Accessibility → Spoken Content → System Voice → Manage Voices</b>.',
                    'Download a voice for your language.',
                    'Restart the browser, then tap <b>↻ Re-scan voices</b>.',
                ];
            default:
                return [
                    'Built-in voices are installed in your operating system, not in this app.',
                    'Install a speech/TTS voice for your language in your system settings ' +
                        '(on Linux this is usually the <code>espeak-ng</code> or <code>speech-dispatcher</code> package).',
                    'Restart the browser, then tap <b>↻ Re-scan voices</b>.',
                ];
        }
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */
    const S = {
        wrap: 'margin-top:10px;padding:10px 12px;border-radius:10px;font-size:0.72rem;line-height:1.5;',
        warn: 'background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);color:#f6d08a;',
        calm: 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);color:rgba(255,255,255,.62);',
        btn:
            'margin-top:8px;margin-right:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.20);' +
            'color:inherit;border-radius:8px;padding:5px 10px;font-size:0.7rem;cursor:pointer;',
        link: 'color:inherit;text-decoration:underline;cursor:pointer;background:none;border:0;font-size:0.7rem;padding:0;',
        list: 'margin:8px 0 0 16px;padding:0;',
    };

    const VoiceHelp = {
        _el: null,
        _busy: false,

        mount() {
            this._el = document.getElementById('voice-help');
            if (!this._el) return;

            // React to the things that change the answer — all read-only hooks.
            document.getElementById('tts-engine')?.addEventListener('change', () => this.refresh());
            document.getElementById('speech-lang')?.addEventListener('change', () => this.refresh());
            document
                .getElementById('app-language')
                ?.addEventListener('change', () => setTimeout(() => this.refresh(), 60));
            // NOTE: main.js assigns speechSynthesis.onvoiceschanged, so use the
            // event listener form here — assigning would clobber it.
            try {
                window.speechSynthesis?.addEventListener?.('voiceschanged', () => this.refresh());
            } catch (_) {}

            this.refresh();
            // Voice lists populate asynchronously; re-check shortly after boot.
            setTimeout(() => this.refresh(), 800);
        },

        refresh() {
            const el = this._el;
            if (!el) return;

            // Only relevant for the built-in engine — Piper ships its own models.
            if (currentEngine() !== 'web-speech-api') {
                el.style.display = 'none';
                el.innerHTML = '';
                return;
            }
            el.style.display = '';

            const code = currentLang();
            const name = langName(code);
            const found = voicesFor(code);
            const p = platform();
            el.innerHTML = found.length ? this._okHtml(name, found, p) : this._missingHtml(name, p);
            this._wire(p);
        },

        _okHtml(name, found, p) {
            const names = found
                .slice(0, 3)
                .map((v) => v.name)
                .join(', ');
            return (
                '<div style="' +
                S.wrap +
                S.calm +
                '">' +
                '<b>Built-in voices come from your device</b>, not from this app — ' +
                found.length +
                ' ' +
                name +
                ' voice' +
                (found.length === 1 ? '' : 's') +
                ' available (' +
                escapeHtml(names) +
                (found.length > 3 ? ', …' : '') +
                '). ' +
                '<button type="button" style="' +
                S.link +
                '" data-vh="how">Want better ones?</button>' +
                '<div data-vh="steps" hidden>' +
                this._stepsHtml(p) +
                '</div>' +
                '</div>'
            );
        },

        _missingHtml(name, p) {
            let action = '';
            if (p === 'android') {
                action =
                    '<button type="button" style="' + S.btn + '" data-vh="android">Open device voice settings</button>';
            } else if (p === 'ios') {
                // Apple blocks web pages from deep-linking into Settings. There is
                // no URL that works, so we show the path instead of faking a link.
                action =
                    '<div style="margin-top:6px;opacity:.85">iOS doesn’t let a web page open Settings — ' +
                    'use the steps below.</div>';
            }
            return (
                '<div style="' +
                S.wrap +
                S.warn +
                '">' +
                '<b>Your device has no ' +
                escapeHtml(name) +
                ' voice installed.</b><br />' +
                'Built-in voices come from your ' +
                (p === 'android' || p === 'ios' ? 'phone’s' : 'computer’s') +
                ' operating system — this app can’t download them. ' +
                'Install the voice pack, then re-scan.' +
                '<div>' +
                action +
                '<button type="button" style="' +
                S.btn +
                '" data-vh="rescan">↻ Re-scan voices</button>' +
                '<button type="button" style="' +
                S.link +
                '" data-vh="how">How?</button></div>' +
                '<div data-vh="steps" hidden>' +
                this._stepsHtml(p) +
                '</div>' +
                '<div data-vh="msg" style="margin-top:6px" hidden></div>' +
                '<div style="margin-top:8px;opacity:.75">Prefer not to install anything? Switch <b>TTS ENGINE</b> to ' +
                '<b>Piper</b> — it downloads its own voice and sounds the same on every device.</div>' +
                '</div>'
            );
        },

        _stepsHtml(p) {
            return (
                '<ol style="' +
                S.list +
                '">' +
                steps(p)
                    .map((s) => '<li>' + s + '</li>')
                    .join('') +
                '</ol>'
            );
        },

        _wire(p) {
            const el = this._el;
            const q = (k) => el.querySelector('[data-vh="' + k + '"]');
            const stepsEl = q('steps');
            const msg = q('msg');

            q('how')?.addEventListener('click', () => {
                if (stepsEl) stepsEl.hidden = !stepsEl.hidden;
            });

            q('android')?.addEventListener('click', () => {
                // Must run inside the user gesture. If the intent is blocked (some
                // OEM skins do), we're still here afterwards — reveal the steps
                // rather than leaving the user staring at a button that did nothing.
                const t = setTimeout(() => {
                    if (document.visibilityState === 'visible' && stepsEl) {
                        stepsEl.hidden = false;
                        if (msg) {
                            msg.hidden = false;
                            msg.textContent = 'Couldn’t open the system screen on this device — use the steps above.';
                        }
                    }
                }, FALLBACK_MS);
                const cancel = () => {
                    if (document.hidden) clearTimeout(t);
                };
                document.addEventListener('visibilitychange', cancel, { once: true });
                try {
                    window.location.href = INTENT_TTS_SETTINGS;
                } catch (_) {
                    clearTimeout(t);
                    if (stepsEl) stepsEl.hidden = false;
                }
            });

            q('rescan')?.addEventListener('click', () => this.rescan());
        },

        /**
         * Re-enumerate without a reload. The voice list is owned by the browser
         * and often only refreshes on a new page load (Android especially), so
         * when nothing new appears we say so and offer the reload.
         */
        rescan() {
            if (this._busy) return;
            this._busy = true;
            const el = this._el;
            const msg = el?.querySelector('[data-vh="msg"]');
            const say = (t, showReload) => {
                if (!msg) return;
                msg.hidden = false;
                msg.innerHTML =
                    escapeHtml(t) +
                    (showReload
                        ? ' <button type="button" style="' + S.link + '" data-vh="reload">Reload the page</button>'
                        : '');
                msg.querySelector('[data-vh="reload"]')?.addEventListener('click', () => location.reload());
            };
            say('Scanning…', false);

            const code = currentLang();
            const deadline = Date.now() + 1500;
            const tick = () => {
                try {
                    window.speechSynthesis?.getVoices?.();
                } catch (_) {}
                if (voicesFor(code).length) {
                    this._busy = false;
                    this.refresh(); // notice disappears
                    return;
                }
                if (Date.now() < deadline) return void setTimeout(tick, 250);
                this._busy = false;
                say('Still no ' + langName(code) + ' voice found.', true);
            };
            setTimeout(tick, 250);
        },
    };

    function escapeHtml(s) {
        return String(s).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    window.VoiceHelp = VoiceHelp;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => VoiceHelp.mount());
    } else {
        VoiceHelp.mount();
    }
})();
