'use strict';

/**
 * VoicePriority — "Auto (best match)" voice selection.
 * ====================================================
 *
 * `speechSynthesis.getVoices()` returns whatever the platform feels like, in
 * no useful order, with wildly varying quality. Picking `voices[0]` — which is
 * what the old code did once language and gender were filtered — lands on a
 * robotic eSpeak voice as easily as on a good one.
 *
 * Selection is scored rather than a chain of ifs, so the tiers compose instead
 * of shadowing each other:
 *
 *   locale    exact ("en-US" === "en-US")   +1000
 *             base  ("en-GB" for "en-US")    +500
 *   gender    matches the user's preference  +100   (only when one is set)
 *   vendor    Google                          +50
 *             Microsoft                       +40
 *             Apple / other named             +30/0
 *   quality   a "compact"/"eSpeak" voice       -60
 *
 * The weights encode a deliberate order: speaking the right LANGUAGE beats
 * everything, the requested GENDER beats vendor preference, and vendor only
 * breaks ties among otherwise equal voices. So for English + female the result
 * is Google US English, then Microsoft Zira, then any other en-US voice —
 * and if none of those exist, the best remaining match rather than nothing.
 *
 * Piper (offline) is not scored here. It is a separate engine selected by
 * TTSProvider, and is what runs when Web Speech offers no usable voice at all.
 *
 * Pure module: takes an array of voice-like objects ({ name, lang, voiceURI,
 * localService }) and returns one. No DOM, no globals, fully testable.
 *
 * Additive module: does not modify any existing code.
 *
 * @module VoicePriority
 */

const VoicePriority = (() => {
    'use strict';

    /** Vendor scores. Google and Microsoft first, by request. @private */
    const VENDORS = [
        { re: /\bgoogle\b/i, score: 50, id: 'google' },
        { re: /\bmicrosoft\b/i, score: 40, id: 'microsoft' },
        { re: /\b(apple|siri)\b/i, score: 30, id: 'apple' },
        { re: /\b(amazon|polly|neural|natural|premium|enhanced)\b/i, score: 25, id: 'premium' },
    ];

    /** Voices that are demonstrably worse; never a good "best match". @private */
    const LOW_QUALITY = /\b(compact|espeak|pico|festival|robosoft|novelty|whisper|bells|bubbles|zarvox|trinoids)\b/i;

    /**
     * Well-known voices whose NAME carries no gender word.
     *
     * "Google US English" is female on Chrome but says so nowhere, so a
     * keyword-based guess returns "unknown" and the gender preference silently
     * fails to apply — which is exactly why the requested Google-female voice
     * was not being chosen. Keys are lowercased names.
     *
     * @private
     */
    const KNOWN_GENDER = {
        'google us english': 'female',
        'google uk english female': 'female',
        'google uk english male': 'male',
        'google español': 'female',
        'google italiano': 'female',
        'google français': 'female',
        'google deutsch': 'female',
        'google nederlands': 'female',
        'google polski': 'female',
        'google português do brasil': 'female',
        'google русский': 'female',
        'google 日本語': 'female',
        'google 한국의': 'female',
        'google 普通话（中国大陆）': 'female',
    };

    const FEMALE_TOKENS =
        /(female|woman|mujer|donna|femme|frau|zira|aria|jenny|michelle|ana|samantha|victoria|karen|moira|tessa|fiona|serena|allison|ava|susan|kate|catherine|linda|heather|hazel|sonia|libby|natasha|clara|elsa|isabella|paulina|helena|laura|monica|mónica|alice|elsa|amelie|amélie|marie|anna|katja|yuna|kyoko|o-ren|mei-jia|ting-ting|sin-ji|nicky|zosia|milena|alva|nora|satu|ellen|xiaoxiao|yaoyao|huihui|hanhan|yating|hiujin|sara|siri female)/i;

    const MALE_TOKENS =
        /(\bmale\b|\bman\b|hombre|uomo|homme|mann|masculin|david|mark|guy|ryan|christopher|eric|roger|steffan|daniel|george|alex|fred|tom|joel|ravi|james|jorge|pablo|diego|carlos|juan|miguel|raul|raúl|luca|cosimo|paolo|thomas|paul|nicolas|mathieu|henri|stefan|hans|klaus|conrad|yannick|felipe|ricardo|otoya|ichiro|hattori|minsu|injoon|kangkang|yunyang|yun-yang|liang|danny|rishi|oliver|arthur|william|liam|aaron|siri male)/i;

    /**
     * Best-effort gender for a voice.
     *
     * @param {{name?: string}} voice
     * @returns {'female'|'male'|'unknown'}
     */
    function guessGender(voice) {
        const name = String((voice && voice.name) || '').trim();
        if (!name) return 'unknown';

        const known = KNOWN_GENDER[name.toLowerCase()];
        if (known) return known;

        // Male first: "Google UK English Male" also contains no female token,
        // but several male names are substrings of longer female ones.
        if (MALE_TOKENS.test(name)) return 'male';
        if (FEMALE_TOKENS.test(name)) return 'female';
        return 'unknown';
    }

    /**
     * Which vendor tier a voice belongs to, or null.
     *
     * @param {{name?: string}} voice
     * @returns {string|null} 'google' | 'microsoft' | 'apple' | 'premium' | null
     */
    function vendorOf(voice) {
        const name = String((voice && voice.name) || '');
        for (const v of VENDORS) if (v.re.test(name)) return v.id;
        return null;
    }

    /**
     * Score one voice against the target. Higher is better; -Infinity means
     * unusable.
     *
     * @param {object} voice
     * @param {{lang?: string, gender?: string}} [target]
     * @returns {number}
     */
    function score(voice, target) {
        if (!voice || !voice.name) return -Infinity;
        const t = target || {};
        const want = String(t.lang || 'en-US').toLowerCase();
        const wantBase = want.split('-')[0];
        const have = String(voice.lang || '').toLowerCase();
        const haveBase = have.split('-')[0];

        let s = 0;
        if (have === want) s += 1000;
        else if (haveBase && haveBase === wantBase) s += 500;

        const gender = String(t.gender || 'any').toLowerCase();
        if (gender === 'female' || gender === 'male') {
            if (guessGender(voice) === gender) s += 100;
        }

        const name = String(voice.name);
        for (const v of VENDORS) {
            if (v.re.test(name)) {
                s += v.score;
                break;
            }
        }
        if (LOW_QUALITY.test(name)) s -= 60;
        return s;
    }

    /**
     * Pick the best available voice.
     *
     * Never returns null when any voice exists: speaking in a slightly wrong
     * accent beats not speaking. Ties are broken by the platform's own order,
     * which is usually its notion of a default.
     *
     * @param {Array} voices - From speechSynthesis.getVoices()
     * @param {{lang?: string, gender?: string}} [target]
     * @returns {object|null}
     */
    function pickBest(voices, target) {
        const list = Array.isArray(voices) ? voices.filter((v) => v && v.name) : [];
        if (!list.length) return null;

        let best = null;
        let bestScore = -Infinity;
        for (const v of list) {
            const s = score(v, target);
            if (s > bestScore) {
                bestScore = s;
                best = v;
            }
        }
        return best;
    }

    /**
     * The ranked shortlist, for diagnostics and for the Settings dropdown.
     *
     * @param {Array} voices
     * @param {{lang?: string, gender?: string}} [target]
     * @param {number} [limit=5]
     * @returns {Array<{name: string, lang: string, score: number, vendor: string|null, gender: string}>}
     */
    function explain(voices, target, limit) {
        const list = Array.isArray(voices) ? voices.filter((v) => v && v.name) : [];
        return list
            .map((v) => ({
                name: v.name,
                lang: v.lang || '',
                score: score(v, target),
                vendor: vendorOf(v),
                gender: guessGender(v),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit == null ? 5 : limit);
    }

    return { pickBest, score, explain, guessGender, vendorOf, KNOWN_GENDER, VENDORS };
})();

if (typeof window !== 'undefined') window.NEXUS_VOICE_PRIORITY = VoicePriority;
if (typeof module !== 'undefined' && module.exports) module.exports = VoicePriority;
