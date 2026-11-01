/**
 * VoiceLibrary — HV9. SonicAgent's voices by language and speaking style. Pure, except `load`.
 *
 * The library comes from SonicAgent's `model_registry/voices.json` through OllaBridge Cloud
 * (`GET /v1/voice/voices`): every Piper voice with its language, locale, gender, quality,
 * speaker id and the synthesis settings of its role, plus what the server can play right now
 * (`state`, `playable`) and the documented Companion/Secretary preset per locale.
 *
 * Rules this module keeps, because each is a way a person ends up hearing the wrong voice:
 *
 *  - **Never a voice of another language.** `choose()` answers a voice whose language is the
 *    one asked for, or null with a reason. An Italian reply in an English voice is worse than
 *    a sentence saying no Italian voice is installed.
 *  - **Only what the server confirmed is playable is offered as playable.** Everything else is
 *    listed with its state, so a person can see what exists without picking what cannot play.
 *  - **No invented presets.** A locale without a documented Companion or Secretary voice (pt-BR
 *    today: two male catalog voices) gets none; its voices are under All Voices.
 *  - **Shared models are said out loud.** Voices with `shares_model_with` are one model with
 *    other settings: switching between them costs no download and no second load.
 */
(function (global) {
    'use strict';

    const PROFILES = Object.freeze(['companion', 'secretary', 'all']);

    const LANGUAGE_LABELS = Object.freeze({
        en: 'English',
        it: 'Italiano',
        es: 'Español',
        fr: 'Français',
        de: 'Deutsch',
        pt: 'Português',
    });

    /** Short preview sentences, per language and profile. Never sent to the conversation. */
    const PREVIEWS = Object.freeze({
        en: {
            companion: "Hello, I'm here. How can I help you today?",
            secretary: "Good morning. Let's review your schedule.",
        },
        it: {
            companion: 'Ciao, sono qui con te. Come stai oggi?',
            secretary: 'Buongiorno. Vediamo insieme gli impegni di oggi.',
        },
        es: {
            companion: 'Hola, estoy aquí contigo. ¿Cómo estás hoy?',
            secretary: 'Buenos días. Revisemos tu agenda de hoy.',
        },
        fr: {
            companion: "Bonjour, je suis là. Comment puis-je t'aider aujourd'hui ?",
            secretary: 'Bonjour. Passons en revue votre agenda.',
        },
        de: {
            companion: 'Hallo, ich bin da. Wie geht es dir heute?',
            secretary: 'Guten Morgen. Gehen wir Ihren Terminplan durch.',
        },
        pt: {
            companion: 'Olá, estou aqui. Como posso ajudar você hoje?',
            secretary: 'Bom dia. Vamos revisar a sua agenda.',
        },
    });

    function langOf(voice) {
        const v = voice || {};
        return String(v.language || String(v.id || '').slice(0, 2)).toLowerCase();
    }

    /** The library from the gateway, made safe to read: missing fields get honest defaults. */
    function normalize(raw) {
        const r = raw || {};
        const voices = (Array.isArray(r.voices) ? r.voices : [])
            .filter((v) => v && typeof v.id === 'string')
            .map((v) => ({
                id: v.id,
                name: v.display_name || v.id,
                role: v.role || 'catalog',
                gender: v.gender || 'unknown',
                language: langOf(v),
                locale: v.locale || '',
                languageLabel: v.language_label || LANGUAGE_LABELS[langOf(v)] || langOf(v),
                quality: v.quality || '',
                speakerId: v.speaker_id == null ? null : v.speaker_id,
                settings: {
                    length_scale: v.length_scale,
                    noise_scale: v.noise_scale,
                    noise_w_scale: v.noise_w_scale,
                },
                state: v.state || (v.installed ? 'installed' : 'missing'),
                playable: v.playable === true,
                sharesModelWith: Array.isArray(v.shares_model_with) ? v.shares_model_with.slice() : [],
            }));
        const ids = new Set(voices.map((v) => v.id));
        const presets = {};
        for (const [locale, roles] of Object.entries(r.presets || {})) {
            const kept = {};
            for (const [role, id] of Object.entries(roles || {})) if (ids.has(id)) kept[role] = id;
            if (Object.keys(kept).length) presets[locale] = kept;
        }
        return { voices, presets, styles: r.styles || {}, ttsReady: r.tts_ready !== false };
    }

    /** Languages present, each with its locales, in a stable order. */
    function languages(lib) {
        const by = new Map();
        for (const v of lib.voices) {
            if (!by.has(v.language))
                by.set(v.language, {
                    language: v.language,
                    label: LANGUAGE_LABELS[v.language] || v.language,
                    locales: new Set(),
                    voices: 0,
                });
            const entry = by.get(v.language);
            if (v.locale) entry.locales.add(v.locale);
            entry.voices++;
        }
        return Array.from(by.values())
            .map((e) => Object.assign(e, { locales: Array.from(e.locales).sort() }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * The voices to show for a language and profile. Companion / Secretary: the presets for that
     * language's locales first, then other voices of that role. All: every voice of the language.
     */
    function filter(lib, opts) {
        const o = opts || {};
        const lang = String(o.language || '')
            .slice(0, 2)
            .toLowerCase();
        const profile = PROFILES.includes(o.profile) ? o.profile : 'companion';
        const mine = lib.voices.filter((v) => v.language === lang && (!o.locale || v.locale === o.locale));
        if (profile === 'all')
            return mine.slice().sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
        const presetIds = Object.entries(lib.presets)
            .filter(([locale]) => locale.slice(0, 2).toLowerCase() === lang && (!o.locale || locale === o.locale))
            .map(([, roles]) => roles[profile])
            .filter(Boolean);
        const presets = presetIds.map((id) => mine.find((v) => v.id === id)).filter(Boolean);
        const others = mine.filter((v) => v.role === profile && !presetIds.includes(v.id));
        return presets.concat(others);
    }

    function presetFor(lib, language, profile, locale) {
        const lang = String(language || '')
            .slice(0, 2)
            .toLowerCase();
        for (const [loc, roles] of Object.entries(lib.presets)) {
            if (loc.slice(0, 2).toLowerCase() !== lang) continue;
            if (locale && loc !== locale) continue;
            if (roles[profile]) return roles[profile];
        }
        return null;
    }

    /**
     * Which voice to use. { voice, reason }:
     *   'chosen'      the person's own pick (same language, playable)
     *   'preset'      the documented preset for this language and profile
     *   'first'       the first playable voice of the language and profile
     * or { voice: null, reason } — 'no-voice-for-language' | 'not-playable' — never a voice of
     * another language.
     */
    function choose(lib, opts) {
        const o = opts || {};
        const lang = String(o.language || '')
            .slice(0, 2)
            .toLowerCase();
        const profile = PROFILES.includes(o.profile) ? o.profile : 'companion';
        const byId = (id) => lib.voices.find((v) => v.id === id) || null;
        const chosen = o.current ? byId(o.current) : null;
        if (chosen && chosen.language === lang && chosen.playable) return { voice: chosen.id, reason: 'chosen' };
        const role = profile === 'all' ? 'companion' : profile;
        const preset = byId(presetFor(lib, lang, role, o.locale));
        if (preset && preset.playable) return { voice: preset.id, reason: 'preset' };
        const first = filter(lib, { language: lang, profile, locale: o.locale }).find((v) => v.playable);
        if (first) return { voice: first.id, reason: 'first' };
        const any = lib.voices.some((v) => v.language === lang);
        return { voice: null, reason: any ? 'not-playable' : 'no-voice-for-language' };
    }

    function previewText(language, profile) {
        const p =
            PREVIEWS[
                String(language || '')
                    .slice(0, 2)
                    .toLowerCase()
            ];
        if (!p) return null;
        return profile === 'secretary' ? p.secretary : p.companion;
    }

    const STATE_LABELS = Object.freeze({
        loaded: 'Ready',
        installed: 'Installed · loads on first use',
        missing: 'Not on this server',
        unknown: 'Unknown',
    });

    /** "Paola — Italiano · Female · Companion · Ready" */
    function describe(v) {
        const gender = v.gender === 'female' ? 'Female' : v.gender === 'male' ? 'Male' : '';
        const role = v.role === 'companion' ? 'Companion' : v.role === 'secretary' ? 'Secretary' : '';
        const parts = [v.locale || v.languageLabel, gender, role, v.quality].filter(Boolean).join(' · ');
        return `${v.name} — ${parts}`;
    }

    /** Fetch through the voice config's gateway client and normalize. Throws the gateway error. */
    async function load(gateway, fresh) {
        return normalize(await gateway.voices(!!fresh));
    }

    const api = {
        PROFILES,
        PREVIEWS,
        LANGUAGE_LABELS,
        STATE_LABELS,
        normalize,
        languages,
        filter,
        presetFor,
        choose,
        previewText,
        describe,
        load,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VOICE_LIBRARY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
