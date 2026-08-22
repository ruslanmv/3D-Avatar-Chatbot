'use strict';

/**
 * "Auto (best match)" voice selection.
 *
 * speechSynthesis.getVoices() returns voices in no useful order and of wildly
 * varying quality, so taking the first language match — which is what the old
 * code did — lands on eSpeak as readily as on a good voice. Selection is now
 * scored: locale, then the requested gender, then vendor.
 *
 * The requested order for English + female is Google US English, then
 * Microsoft Zira, then any other en-US voice, then whatever remains.
 */

/* global describe, test, expect */

const VP = require('../src/VoicePriority');

const v = (name, lang, localService = true) => ({ name, lang, voiceURI: name, localService });

/** A realistic desktop Chrome-on-Windows voice list, deliberately unordered. */
const DESKTOP = [
    v('Microsoft David - English (United States)', 'en-US'),
    v('Microsoft Zira - English (United States)', 'en-US'),
    v('Google US English', 'en-US', false),
    v('Google UK English Female', 'en-GB', false),
    v('Google UK English Male', 'en-GB', false),
    v('Microsoft Hazel - English (Great Britain)', 'en-GB'),
    v('Google español', 'es-ES', false),
    v('Microsoft Helena - Spanish (Spain)', 'es-ES'),
    v('eSpeak English', 'en-US'),
];

describe('the requested priority chain, English + female', () => {
    test('Priority 1: Google US English wins', () => {
        expect(VP.pickBest(DESKTOP, { lang: 'en-US', gender: 'female' }).name).toBe('Google US English');
    });

    test('Priority 2: Microsoft Zira when no Google voice exists', () => {
        const noGoogle = DESKTOP.filter((x) => !/google/i.test(x.name));
        expect(VP.pickBest(noGoogle, { lang: 'en-US', gender: 'female' }).name).toBe(
            'Microsoft Zira - English (United States)'
        );
    });

    test('Priority 3: any remaining en-US voice when neither vendor is present', () => {
        const neither = [v('Samantha', 'en-US'), v('Daniel', 'en-GB')];
        expect(VP.pickBest(neither, { lang: 'en-US', gender: 'female' }).name).toBe('Samantha');
    });

    test('an empty list returns null — that is when Piper takes over', () => {
        expect(VP.pickBest([], { lang: 'en-US' })).toBeNull();
        expect(VP.pickBest(null, { lang: 'en-US' })).toBeNull();
    });
});

describe('"Google US English" is recognised as female', () => {
    test('its name carries no gender word, so it needs the known-voice table', () => {
        // A keyword guess returns "unknown" here, which is why the gender
        // preference silently failed to apply to exactly the voice requested.
        expect(VP.guessGender({ name: 'Google US English' })).toBe('female');
    });

    test('the UK voices state their gender and are read correctly', () => {
        expect(VP.guessGender({ name: 'Google UK English Female' })).toBe('female');
        expect(VP.guessGender({ name: 'Google UK English Male' })).toBe('male');
    });

    test('common platform voices are classified', () => {
        expect(VP.guessGender({ name: 'Microsoft Zira - English (United States)' })).toBe('female');
        expect(VP.guessGender({ name: 'Microsoft David - English (United States)' })).toBe('male');
        expect(VP.guessGender({ name: 'Samantha' })).toBe('female');
        expect(VP.guessGender({ name: 'Alex' })).toBe('male');
        expect(VP.guessGender({ name: 'Whatever 42' })).toBe('unknown');
    });
});

describe('language outranks gender, gender outranks vendor', () => {
    test('a right-language voice beats a wrong-language one of the right gender', () => {
        const list = [v('Google UK English Female', 'en-GB', false), v('Microsoft Helena - Spanish (Spain)', 'es-ES')];
        expect(VP.pickBest(list, { lang: 'es-ES', gender: 'female' }).name).toContain('Helena');
    });

    test('the requested gender beats a higher-ranked vendor of the wrong gender', () => {
        const list = [
            v('Google UK English Male', 'en-GB', false),
            v('Microsoft Hazel - English (Great Britain)', 'en-GB'),
        ];
        expect(VP.pickBest(list, { lang: 'en-GB', gender: 'female' }).name).toContain('Hazel');
    });

    test('male preference is honoured just as well', () => {
        expect(VP.pickBest(DESKTOP, { lang: 'en-US', gender: 'male' }).name).toBe(
            'Microsoft David - English (United States)'
        );
    });

    test('with no gender preference, vendor decides among locale matches', () => {
        expect(VP.pickBest(DESKTOP, { lang: 'en-US', gender: 'any' }).name).toBe('Google US English');
    });
});

describe('degrading gracefully', () => {
    test('an exact locale beats the same language in another region', () => {
        const list = [
            v('Google UK English Female', 'en-GB', false),
            v('Microsoft Zira - English (United States)', 'en-US'),
        ];
        expect(VP.pickBest(list, { lang: 'en-US', gender: 'female' }).name).toContain('Zira');
    });

    test('a base-language match is used when no exact locale exists', () => {
        const list = [v('Google UK English Female', 'en-GB', false), v('Google español', 'es-ES', false)];
        expect(VP.pickBest(list, { lang: 'en-US', gender: 'female' }).name).toBe('Google UK English Female');
    });

    test('a wrong-language voice is still returned rather than silence', () => {
        const list = [v('Google español', 'es-ES', false)];
        expect(VP.pickBest(list, { lang: 'ja-JP' }).name).toBe('Google español');
    });

    test('low-quality voices lose to a real one at the same locale', () => {
        const list = [v('eSpeak English', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US')];
        expect(VP.pickBest(list, { lang: 'en-US' }).name).toContain('Zira');
    });

    test('but a low-quality voice is chosen over nothing', () => {
        expect(VP.pickBest([v('eSpeak English', 'en-US')], { lang: 'en-US' }).name).toBe('eSpeak English');
    });
});

describe('other locales', () => {
    test('Spanish female prefers Google español', () => {
        expect(VP.pickBest(DESKTOP, { lang: 'es-ES', gender: 'female' }).name).toBe('Google español');
    });

    test('Italian falls back to the best available when nothing matches', () => {
        expect(VP.pickBest(DESKTOP, { lang: 'it-IT', gender: 'female' })).not.toBeNull();
    });
});

describe('robustness', () => {
    test('malformed entries are skipped, not thrown on', () => {
        const list = [null, {}, { name: '' }, v('Google US English', 'en-US', false)];
        expect(VP.pickBest(list, { lang: 'en-US' }).name).toBe('Google US English');
    });

    test('a voice with no lang still scores and can be returned', () => {
        expect(VP.pickBest([{ name: 'Mystery' }], { lang: 'en-US' }).name).toBe('Mystery');
    });

    test('no target defaults to en-US', () => {
        expect(VP.pickBest(DESKTOP).name).toBe('Google US English');
    });
});

describe('explain() ranks the shortlist for diagnostics', () => {
    test('returns the top matches in order with their reasoning', () => {
        const top = VP.explain(DESKTOP, { lang: 'en-US', gender: 'female' }, 3);
        expect(top[0].name).toBe('Google US English');
        expect(top[0].vendor).toBe('google');
        expect(top[0].gender).toBe('female');
        expect(top[0].score).toBeGreaterThan(top[1].score);
        expect(top).toHaveLength(3);
    });
});
