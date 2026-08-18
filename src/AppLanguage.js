/**
 * AppLanguage.js — One language for the whole conversation.
 *
 * Industry pattern (ChatGPT / Google Assistant): a single GENERAL ▸ Language
 * setting that cascades to every layer, applied LIVE (no reload):
 *
 *   EARS   — STT recognition language (main mic + companion 🎤 + live call +
 *            wake pass, via SpeechService.sttConfig and SpeechSettings.lang)
 *   VOICE  — TTS voice re-selection for the language (keeps gender pref;
 *            clears an exact voice pick that no longer matches)
 *   BRAIN  — an LLM directive appended to every system prompt so replies are
 *            reliably in the chosen language (models only *usually* mirror)
 *   UI     — companion status strings (Listening…, standby pill, toasts)
 *            localized via AppLanguage.t()
 *
 * The per-layer dropdowns (SPEECH ▸ LANGUAGE, STT LANGUAGE) remain as expert
 * overrides: changing one diverges that layer until the master is changed
 * again, which re-syncs everything. Divergence is surfaced under the master.
 *
 * Additive module: no existing function is modified; the LLM directive is
 * attached by wrapping _nexusLLM.sendMessage(+Structured) once at boot.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Language table: name, LLM directive, localized companion strings.  */
    /* ------------------------------------------------------------------ */
    const LANGS = {
        'en-US': {
            name: 'English (US)',
            directive: 'Always respond in English unless the user explicitly asks for another language.',
            t: {
                listening: '🎙️ Listening…',
                thinking: '💭 Thinking…',
                speaking: '🗣️ Speaking…',
                standby: '💤 Say the wake word',
                imListening: '👋 I’m listening',
                standingBy: '💤 Standing by — say the wake word to talk',
                langChanged: 'Language set to English',
            },
        },
        'en-GB': {
            name: 'English (UK)',
            directive: 'Always respond in English unless the user explicitly asks for another language.',
            t: null, // same as en-US
        },
        'es-ES': {
            name: 'Español',
            directive:
                'Responde siempre en español, sin importar el idioma en que escriba el usuario, salvo que pida explícitamente otro idioma.',
            t: {
                listening: '🎙️ Escuchando…',
                thinking: '💭 Pensando…',
                speaking: '🗣️ Hablando…',
                standby: '💤 Di la palabra de activación',
                imListening: '👋 Te escucho',
                standingBy: '💤 En espera — di la palabra de activación para hablar',
                langChanged: 'Idioma cambiado a Español',
            },
        },
        'it-IT': {
            name: 'Italiano',
            directive:
                'Rispondi sempre in italiano, indipendentemente dalla lingua dell’utente, salvo richiesta esplicita.',
            t: {
                listening: '🎙️ In ascolto…',
                thinking: '💭 Sto pensando…',
                speaking: '🗣️ Sto parlando…',
                standby: '💤 Di’ la parola di attivazione',
                imListening: '👋 Ti ascolto',
                standingBy: '💤 In attesa — di’ la parola di attivazione per parlare',
                langChanged: 'Lingua impostata su Italiano',
            },
        },
        'fr-FR': {
            name: 'Français',
            directive:
                'Réponds toujours en français, quelle que soit la langue de l’utilisateur, sauf demande explicite.',
            t: {
                listening: '🎙️ À l’écoute…',
                thinking: '💭 Réflexion…',
                speaking: '🗣️ Je parle…',
                standby: '💤 Dites le mot d’activation',
                imListening: '👋 Je vous écoute',
                standingBy: '💤 En veille — dites le mot d’activation pour parler',
                langChanged: 'Langue définie sur Français',
            },
        },
        'de-DE': {
            name: 'Deutsch',
            directive:
                'Antworte immer auf Deutsch, unabhängig von der Sprache des Nutzers, außer er bittet ausdrücklich um eine andere.',
            t: {
                listening: '🎙️ Ich höre zu…',
                thinking: '💭 Denke nach…',
                speaking: '🗣️ Ich spreche…',
                standby: '💤 Sag das Aktivierungswort',
                imListening: '👋 Ich höre',
                standingBy: '💤 Bereitschaft — sag das Aktivierungswort zum Sprechen',
                langChanged: 'Sprache auf Deutsch eingestellt',
            },
        },
        'pt-BR': {
            name: 'Português (BR)',
            directive: 'Responda sempre em português, independentemente do idioma do usuário, salvo pedido explícito.',
            t: {
                listening: '🎙️ Ouvindo…',
                thinking: '💭 Pensando…',
                speaking: '🗣️ Falando…',
                standby: '💤 Diga a palavra de ativação',
                imListening: '👋 Estou ouvindo',
                standingBy: '💤 Em espera — diga a palavra de ativação para falar',
                langChanged: 'Idioma definido para Português',
            },
        },
        'ja-JP': {
            name: '日本語',
            directive: 'ユーザーの言語に関わらず、明示的に他言語を求められない限り、常に日本語で応答してください。',
            t: {
                listening: '🎙️ 聞いています…',
                thinking: '💭 考え中…',
                speaking: '🗣️ 話しています…',
                standby: '💤 ウェイクワードを言ってください',
                imListening: '👋 聞いています',
                standingBy: '💤 待機中 — ウェイクワードで話しかけてください',
                langChanged: '言語を日本語に設定しました',
            },
        },
        'ko-KR': {
            name: '한국어',
            directive: '사용자의 언어와 관계없이, 명시적으로 다른 언어를 요청하지 않는 한 항상 한국어로 응답하세요.',
            t: {
                listening: '🎙️ 듣는 중…',
                thinking: '💭 생각 중…',
                speaking: '🗣️ 말하는 중…',
                standby: '💤 호출어를 말하세요',
                imListening: '👋 듣고 있어요',
                standingBy: '💤 대기 중 — 호출어로 말을 걸어주세요',
                langChanged: '언어가 한국어로 설정되었습니다',
            },
        },
        'zh-CN': {
            name: '中文',
            directive: '无论用户使用什么语言，除非明确要求，始终用中文回答。',
            t: {
                listening: '🎙️ 正在聆听…',
                thinking: '💭 思考中…',
                speaking: '🗣️ 正在说话…',
                standby: '💤 说出唤醒词',
                imListening: '👋 我在听',
                standingBy: '💤 待机中 — 说唤醒词即可对话',
                langChanged: '语言已设置为中文',
            },
        },
    };

    const AppLanguage = {
        get code() {
            return (
                localStorage.getItem('app_lang') ||
                localStorage.getItem('speech_lang') || // inherit a pre-existing choice
                (LANGS[navigator.language] ? navigator.language : 'en-US')
            );
        },

        /** Localized companion string; falls back to English. */
        t(key) {
            const pack = LANGS[this.code]?.t || LANGS['en-US'].t;
            return pack[key] || LANGS['en-US'].t[key] || '';
        },

        /** LLM directive for the chosen language. */
        directive() {
            return LANGS[this.code]?.directive || LANGS['en-US'].directive;
        },

        /**
         * The cascade: apply the master language to every layer, live.
         * Called on user change and once at boot (to heal divergence drift).
         */
        apply(code, { announce = false } = {}) {
            if (!LANGS[code]) return;
            try {
                localStorage.setItem('app_lang', code);
            } catch (_) {}

            // EARS — STT config (main mic) + SpeechSettings (companion resolver).
            try {
                window.SpeechService?.saveSTTConfig?.({ language: code });
                window.SpeechService?.setRecognitionOptions?.({ lang: code });
            } catch (_) {}
            try {
                localStorage.setItem('speech_lang', code);
                if (window.SpeechSettings) window.SpeechSettings.lang = code;
                // An exact voice pinned for another language wins over every
                // language rule in pickBestVoice(), so it must go unless we can
                // POSITIVELY confirm it speaks the new language. Requiring the
                // voice object to be found first was wrong twice over: the list
                // is populated asynchronously (empty on an early switch), and a
                // pin can outlive the voice it names — in both cases the stale
                // pin survived and kept reading Spanish with an English voice.
                const uri = localStorage.getItem('speech_voice_uri') || '';
                if (uri) {
                    const base = code.slice(0, 2).toLowerCase();
                    const v = window.speechSynthesis?.getVoices?.().find((x) => x.voiceURI === uri);
                    const confirmedMatch = !!v && String(v.lang).toLowerCase().startsWith(base);
                    if (!confirmedMatch) {
                        localStorage.removeItem('speech_voice_uri');
                        if (window.SpeechSettings) window.SpeechSettings.voiceURI = '';
                    }
                }
            } catch (_) {}

            // VOICE (Piper) — the engine keeps whatever voiceId was saved, so
            // it must follow the language too: pick the best catalog voice for
            // the new language honoring the female/male preference (the
            // catalog lists female voices first per language).
            try {
                const cat = window.PiperWasmTTSProvider?.getVoices?.() || [];
                if (cat.length) {
                    const base = code.slice(0, 2).toLowerCase();
                    // Read the LIVE object main.js uses (now published on window)
                    // so the cascade can't disagree with pickBestVoice(); its
                    // initialization default is 'female'.
                    const pref = String(
                        window.SpeechSettings?.voicePref || localStorage.getItem('speech_voice_pref') || 'female'
                    ).toLowerCase();
                    let pool = cat.filter((v) => v.lang.toLowerCase() === code.toLowerCase());
                    const haveExact = pool.length > 0;
                    if (!pool.length) pool = cat.filter((v) => v.lang.toLowerCase().startsWith(base));
                    if (pool.length) {
                        // Preference order, best to last resort:
                        //   1. requested gender, single-speaker (verifiable —
                        //      multi-speaker models can only play speaker 0)
                        //   2. requested gender, multi-speaker
                        //   3. the OTHER gender, single-speaker — e.g. pt-BR has
                        //      no female model at all, so "Prefer Female" takes
                        //      the male voice rather than leaving Piper silent
                        //   4. anything for the language
                        const other = pref === 'female' ? 'male' : pref === 'male' ? 'female' : null;
                        const byPref = pool.filter((v) => v.gender === pref);
                        const byOther = other ? pool.filter((v) => v.gender === other) : [];
                        const solo = (l) => l.filter((v) => !v.multi);
                        const ranked = solo(byPref)[0]
                            ? solo(byPref)
                            : byPref.length
                              ? byPref
                              : solo(byOther)[0]
                                ? solo(byOther)
                                : byOther.length
                                  ? byOther
                                  : pool;
                        const pick = ranked[0];
                        const current = localStorage.getItem('piper_voice') || '';
                        const cur = cat.find((v) => v.id === current);
                        // Override when the saved voice doesn't fit the new
                        // language (a deliberate same-language pick stays), or
                        // when it contradicts an explicit gender preference and
                        // a voice honoring that preference exists — otherwise
                        // "Prefer Female + Español" keeps replaying a male voice
                        // saved before this catalog was corrected.
                        // Region counts: an en-US voice is NOT a valid pick for
                        // "English (UK)" when en-GB models exist, or the user
                        // switches to British English and keeps a US accent.
                        const wrongLang =
                            !cur ||
                            !cur.lang.toLowerCase().startsWith(base) ||
                            (haveExact && cur.lang.toLowerCase() !== code.toLowerCase());
                        const wrongGender =
                            !!cur && (pref === 'female' || pref === 'male') && cur.gender !== pref && !!byPref.length;
                        if (wrongLang || wrongGender) {
                            localStorage.setItem('piper_voice', pick.id);
                            window.PiperWasmTTSProvider.setSelectedVoice?.(pick.id);
                            const pv = document.getElementById('piper-voice');
                            if (pv) {
                                if (![...pv.options].some((o) => o.value === pick.id)) {
                                    const o = document.createElement('option');
                                    o.value = pick.id;
                                    o.textContent = pick.name + ' — ' + pick.lang;
                                    pv.appendChild(o);
                                }
                                pv.value = pick.id;
                            }
                        }
                        // Piper's official catalog has no female voice at all for
                        // some languages (es, de, pt) and no male for others (it,
                        // zh). Say so once, with the way out, instead of letting
                        // the user wonder why "Prefer Female" sounds male.
                        if (
                            (pref === 'female' || pref === 'male') &&
                            !byPref.length &&
                            (localStorage.getItem('tts_engine') || '') === 'piper-wasm'
                        ) {
                            this._toast(
                                '⚠ Piper has no ' +
                                    pref +
                                    ' ' +
                                    (LANGS[code]?.name || code) +
                                    ' voice — using ' +
                                    pick.name +
                                    '. The built-in engine has ' +
                                    pref +
                                    ' voices for this language.'
                            );
                        }
                    }
                    // No Piper voice exists for this language (ja-JP, ko-KR):
                    // say so instead of silently reading it with a foreign
                    // voice. The engine key is 'tts_engine' (see TTSProvider.js).
                    else if ((localStorage.getItem('tts_engine') || '') === 'piper-wasm') {
                        this._toast(
                            '⚠ Piper has no ' +
                                (LANGS[code]?.name || code) +
                                ' voice — switch Settings ▸ Voice engine to the built-in engine for this language.'
                        );
                    }
                }
            } catch (_) {}

            // UI — reflect into both expert dropdowns (marks them "in sync").
            this._syncing = true;
            const speechSel = document.getElementById('speech-lang');
            const sttSel = document.getElementById('stt-language');
            if (speechSel && [...speechSel.options].some((o) => o.value === code)) speechSel.value = code;
            if (sttSel && [...sttSel.options].some((o) => o.value === code)) sttSel.value = code;
            this._syncing = false;
            this._updateStatus();

            if (announce) this._toast(this.t('langChanged'));
        },

        /** Show per-layer divergence under the master (expert overrides). */
        _updateStatus() {
            const el = document.getElementById('app-lang-status');
            if (!el) return;
            const master = this.code;
            // NOTE: SpeechSettings is a top-level `const` in main.js (classic
            // script) so it is NOT on window — read the persisted values.
            let stt = master;
            let tts = master;
            try {
                stt = window.SpeechService?.getSTTConfig?.().language || localStorage.getItem('stt_lang') || master;
            } catch (_) {}
            try {
                tts = localStorage.getItem('speech_lang') || master;
            } catch (_) {}
            if (stt === master && tts === master) {
                el.textContent = '';
                el.style.display = 'none';
            } else {
                el.style.display = 'block';
                el.textContent =
                    '⚠ Custom overrides — STT: ' +
                    (LANGS[stt]?.name || stt) +
                    ' · Voice: ' +
                    (LANGS[tts]?.name || tts);
            }
        },

        _toast(msg) {
            if (window.companionMode?._toast) return window.companionMode._toast(msg);
            const d = document.createElement('div');
            d.textContent = msg;
            d.style.cssText =
                'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483200;' +
                'background:rgba(10,16,30,.92);color:#eef1f8;padding:10px 16px;border-radius:12px;' +
                'font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)';
            document.body.appendChild(d);
            setTimeout(() => d.remove(), 3200);
        },

        /** BRAIN — wrap the LLM entry once so every reply carries the directive. */
        _patchLLM() {
            const mgr = window._nexusLLM;
            if (!mgr || mgr.__langPatched) return !!mgr;
            const wrap = (fnName) => {
                const orig = mgr[fnName]?.bind(mgr);
                if (!orig) return;
                mgr[fnName] = (msg, sys, hist) =>
                    orig(msg, ((sys || '') + '\n\n' + AppLanguage.directive()).trim(), hist);
            };
            wrap('sendMessage');
            wrap('sendMessageStructured');
            mgr.__langPatched = true;
            return true;
        },

        init() {
            // Populate the GENERAL dropdown.
            const sel = document.getElementById('app-language');
            if (sel && !sel.options.length) {
                for (const [code, def] of Object.entries(LANGS)) {
                    const o = document.createElement('option');
                    o.value = code;
                    o.textContent = def.name;
                    sel.appendChild(o);
                }
                sel.value = this.code;
                sel.addEventListener('change', () => this.apply(sel.value, { announce: true }));
            }
            // Expert overrides: manual change diverges that layer (until the
            // master is changed again); just refresh the divergence status.
            for (const id of ['speech-lang', 'stt-language']) {
                document.getElementById(id)?.addEventListener('change', () => {
                    if (!this._syncing) setTimeout(() => this._updateStatus(), 50);
                });
            }
            // Heal at boot: master is the source of truth unless diverged.
            this.apply(this.code);
            // LLM directive: the manager may initialize after us — retry briefly.
            if (!this._patchLLM()) {
                let tries = 0;
                const iv = setInterval(() => {
                    if (this._patchLLM() || ++tries > 40) clearInterval(iv);
                }, 250);
            }
        },
    };

    // en-GB shares the en-US string pack.
    LANGS['en-GB'].t = LANGS['en-US'].t;

    window.AppLanguage = AppLanguage;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLanguage.init());
    } else {
        AppLanguage.init();
    }
})();
