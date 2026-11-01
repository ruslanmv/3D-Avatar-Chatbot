/**
 * VoiceSelectionPolicy — HV-FIX Batch 4. Which SonicAgent voice speaks. Pure.
 *
 * What went wrong before it: the remote voice could be the browser's last ON-DEVICE Piper
 * voice (`piper_voice`, commonly `en_US-hfc_female-medium` — a neutral catalog voice), so
 * choosing Companion or Secretary changed a label and not the voice; and local Piper ids that
 * SonicAgent does not have (`en_US-lessac-high`, `en_GB-cori-high`, …) could be sent to it.
 *
 * Auto now resolves, in order:
 *   1. the person's explicit pick, if it is a SonicAgent voice, of this language, and playable;
 *   2. the documented preset for this locale and style (en-US: Kristin / Lessac);
 *   3. another playable voice of that style and language, the preferred gender first;
 *   4. a playable voice of the preferred gender in the language;
 *   5. any playable voice of the language — answered with `preferenceUnmet` and a sentence
 *      (Brazilian Portuguese has only male voices today; "Prefer Female" cannot be met there);
 *   6. nothing — never a voice of another language, never an id SonicAgent did not list.
 *
 * `PRESETS` is the documented table, used only until the server's own `presets` arrive; the
 * server's answer wins. Gender preference ranks; it never hides a voice from the full list.
 */
(function (global) {
    'use strict';

    const PRESETS = Object.freeze({
        'en-US': { companion: 'en_US-kristin-medium', secretary: 'en_US-lessac-medium' },
        'en-GB': { companion: 'en_GB-cori-medium', secretary: 'en_GB-alba-medium' },
        'es-ES': { companion: 'es_ES-sharvard-companion', secretary: 'es_ES-sharvard-secretary' },
        'es-MX': { companion: 'es_MX-ald-companion', secretary: 'es_MX-ald-medium' },
        'fr-FR': { companion: 'fr_FR-upmc-medium', secretary: 'fr_FR-siwis-medium' },
        'de-DE': { companion: 'de_DE-eva_k-x_low', secretary: 'de_DE-kerstin-low' },
        'it-IT': { companion: 'it_IT-paola-companion', secretary: 'it_IT-paola-medium' },
    });

    /** Languages SonicAgent's Piper registry has voices for. Others get no remote voice. */
    const LANGUAGES = Object.freeze(['en', 'es', 'fr', 'de', 'it', 'pt']);

    const NO_LANGUAGE = 'No SonicAgent voice is available for the selected language.';

    function lang(code) {
        return String(code || '')
            .slice(0, 2)
            .toLowerCase();
    }

    /** 'en-US' / 'en_US' / 'en' → 'en-US' or '' when only a language was given. */
    function locale(code) {
        const m = /^([a-z]{2})[-_]([a-z]{2})$/i.exec(String(code || '').trim());
        return m ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : '';
    }

    function genderOf(pref) {
        const p = String(pref || '').toLowerCase();
        return p.startsWith('m') ? 'male' : p.startsWith('f') || !p ? 'female' : 'any';
    }

    function presetsOf(library) {
        const server = library && library.presets && Object.keys(library.presets).length ? library.presets : null;
        return server || PRESETS;
    }

    function byId(library, id) {
        return (library && library.voices.find((v) => v.id === id)) || null;
    }

    /** Is `id` a SonicAgent voice? With the library, only what it lists; without, a preset id. */
    function isRemoteVoice(library, id) {
        if (!id) return false;
        if (library) return !!byId(library, id);
        return Object.values(PRESETS).some((r) => r.companion === id || r.secretary === id);
    }

    function presetFor(library, loc, language, style) {
        const role = style === 'secretary' ? 'secretary' : 'companion';
        const table = presetsOf(library);
        if (loc && table[loc] && table[loc][role]) return table[loc][role];
        for (const [l, roles] of Object.entries(table)) if (lang(l) === language && roles[role]) return roles[role];
        return null;
    }

    function rank(gender, loc) {
        return (a, b) =>
            (b.locale === loc) - (a.locale === loc) ||
            (gender !== 'any' ? (b.gender === gender) - (a.gender === gender) : 0) ||
            String(a.name).localeCompare(String(b.name));
    }

    /**
     * resolve({ library, language, style, explicit, gender }) →
     *   { voice, reason, preferenceUnmet?, message? }
     * `library` is VoiceLibrary.normalize()'s shape, or null before the catalogue arrives.
     */
    function resolve(input) {
        const i = input || {};
        const library = i.library || null;
        const language = lang(i.language);
        const loc = locale(i.language);
        const style = i.style === 'secretary' ? 'secretary' : i.style === 'all' ? 'all' : 'companion';
        const gender = genderOf(i.gender);
        if (!LANGUAGES.includes(language))
            return { voice: null, reason: 'no-voice-for-language', message: NO_LANGUAGE };
        const playable = (v) => !!v && v.language === language && (v.playable || !library);

        // 1. The person's own pick.
        if (i.explicit) {
            const v = byId(library, i.explicit);
            if (library && !v) {
                // A local Piper id, or one this server does not have: never sent to SonicAgent.
                return Object.assign(resolve(Object.assign({}, i, { explicit: null })), {
                    ignoredExplicit: i.explicit,
                    ignoredReason: 'not-a-sonicagent-voice',
                });
            }
            if (!library && isRemoteVoice(null, i.explicit) && lang(i.explicit) === language) {
                return { voice: i.explicit, reason: 'chosen' };
            }
            if (v && v.language === language && v.playable) return { voice: v.id, reason: 'chosen' };
        }

        // 2. The preset for this locale and style.
        const preset = presetFor(library, loc, language, style);
        if (preset && (!library || playable(byId(library, preset)))) return { voice: preset, reason: 'preset' };
        if (!library) return { voice: null, reason: 'library-not-loaded' };

        const mine = library.voices.filter(playable).sort(rank(gender, loc));
        const role = style === 'all' ? null : style;
        // 3. Same style, preferred gender first (the sort already put it first).
        const sameRole = role ? mine.find((v) => v.role === role && (gender === 'any' || v.gender === gender)) : null;
        if (sameRole) return { voice: sameRole.id, reason: 'same-style' };
        // 4. Preferred gender.
        const sameGender = mine.find((v) => gender === 'any' || v.gender === gender);
        if (sameGender) return { voice: sameGender.id, reason: 'same-gender' };
        // 5. Any voice of the language, saying what could not be honoured.
        if (mine.length) {
            const label = gender === 'female' ? 'female' : gender === 'male' ? 'male' : '';
            return {
                voice: mine[0].id,
                reason: 'language-only',
                preferenceUnmet: true,
                message: label
                    ? `This server's catalog currently has no ${label} voice for this language; using ${mine[0].name}.`
                    : `Using ${mine[0].name}.`,
            };
        }
        // 6. Nothing playable in this language.
        const listed = library.voices.some((v) => v.language === language);
        return {
            voice: null,
            reason: listed ? 'not-playable' : 'no-voice-for-language',
            message: listed
                ? 'No SonicAgent voice for this language is available on the server right now.'
                : NO_LANGUAGE,
        };
    }

    /**
     * The whole catalogue for the VOICE list, grouped by locale: nothing is hidden. The chosen
     * language's locales come first, and within a locale the preferred gender and the style.
     */
    function grouped(library, opts) {
        const o = opts || {};
        if (!library) return [];
        const language = lang(o.language);
        const gender = genderOf(o.gender);
        const style = o.style === 'secretary' ? 'secretary' : o.style === 'all' ? null : 'companion';
        const groups = new Map();
        for (const v of library.voices) {
            const key = v.locale || v.language;
            if (!groups.has(key)) groups.set(key, { locale: key, label: v.languageLabel || key, voices: [] });
            groups.get(key).voices.push(v);
        }
        const loc = locale(o.language);
        const order = Array.from(groups.values()).sort(
            (a, b) =>
                (b.locale === loc) - (a.locale === loc) ||
                (lang(b.locale) === language) - (lang(a.locale) === language) ||
                a.label.localeCompare(b.label)
        );
        for (const g of order) {
            g.voices.sort(
                (a, b) =>
                    (style ? (b.role === style) - (a.role === style) : 0) ||
                    (gender !== 'any' ? (b.gender === gender) - (a.gender === gender) : 0) ||
                    b.playable - a.playable ||
                    a.name.localeCompare(b.name)
            );
        }
        return order;
    }

    function label(v) {
        const role = v.role === 'companion' ? 'Companion' : v.role === 'secretary' ? 'Secretary' : '';
        const gender = v.gender === 'female' ? 'Female' : v.gender === 'male' ? 'Male' : 'Unspecified';
        return [v.name, role, gender, v.languageLabel || v.locale, v.quality].filter(Boolean).join(' — ');
    }

    /** The current Settings, read: what resolve() needs, for the voice config's `voiceFor`. */
    function inputFromSettings(config, store) {
        const c = config.get();
        let appLocale = '';
        let pref = '';
        try {
            appLocale = (store && store.getItem('speech_lang')) || '';
            pref = (store && store.getItem('speech_voice_pref')) || '';
        } catch (_) {}
        const language = c.ttsLanguage || appLocale || (config.ttsLanguage ? config.ttsLanguage() : 'en');
        return {
            library: config.library ? config.library() : null,
            language: locale(language) || (lang(appLocale) === lang(language) ? appLocale : language),
            style: c.profile || 'companion',
            explicit: c.voice || null,
            gender: pref || 'female',
        };
    }

    function resolveRemote(config, store) {
        const s = store || (global && global.localStorage);
        return resolve(inputFromSettings(config, s));
    }

    const api = {
        PRESETS,
        LANGUAGES,
        NO_LANGUAGE,
        resolve,
        resolveRemote,
        inputFromSettings,
        grouped,
        label,
        isRemoteVoice,
        locale,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VOICE_POLICY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
