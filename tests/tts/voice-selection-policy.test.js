/**
 * HV-FIX Batches 3–5. The SonicAgent voice catalogue and which voice speaks.
 *
 * The fixture is SonicAgent's own GET /v1/voices answer from the live Space (2026-11-01),
 * reduced to what OllaBridge Cloud passes to the browser — 49 entries, 8 locales.
 */
const raw = require('../fixtures/sonicagent/voices-2026-11-01.json');
const Library = require('../../src/tts/VoiceLibrary.js');
const Policy = require('../../src/tts/VoiceSelectionPolicy.js');

const lib = Library.normalize(raw);
const pick = (language, style, extra) =>
    Policy.resolve(Object.assign({ library: lib, language, style, gender: 'female' }, extra));
const voice = (id) => lib.voices.find((v) => v.id === id);
const withState = (patch) =>
    Library.normalize(Object.assign({}, raw, { voices: raw.voices.map((v) => Object.assign({}, v, patch(v) || {})) }));

describe('the catalogue', () => {
    test('all 49 entries come from the backend and none is collapsed by shared model', () => {
        expect(raw.voices).toHaveLength(49);
        expect(lib.voices).toHaveLength(49);
        expect(new Set(lib.voices.map((v) => v.id)).size).toBe(49);
        const grouped = Policy.grouped(lib, { language: 'en-US', gender: 'female', style: 'companion' });
        expect(grouped.reduce((n, g) => n + g.voices.length, 0)).toBe(49);
        expect(grouped.map((g) => g.locale).sort()).toEqual(
            ['de-DE', 'en-GB', 'en-US', 'es-ES', 'es-MX', 'fr-FR', 'it-IT', 'pt-BR'].sort()
        );
        // Shared-model presets stay separate choices.
        for (const pair of [
            ['it_IT-paola-companion', 'it_IT-paola-medium'],
            ['es_ES-sharvard-companion', 'es_ES-sharvard-secretary'],
            ['es_MX-ald-companion', 'es_MX-ald-medium'],
            ['fr_FR-upmc-medium', 'fr_FR-upmc-pierre'],
        ]) {
            expect(voice(pair[0])).toBeTruthy();
            expect(voice(pair[1])).toBeTruthy();
        }
    });

    test('the count is the backend’s, not a number in the UI', () => {
        const fewer = Library.normalize(Object.assign({}, raw, { voices: raw.voices.slice(0, 10) }));
        const grouped = Policy.grouped(fewer, { language: 'en' });
        expect(grouped.reduce((n, g) => n + g.voices.length, 0)).toBe(10);
    });

    test('speaker ids and genders are the registry’s', () => {
        expect(voice('es_ES-sharvard-companion')).toMatchObject({ speakerId: 1, gender: 'female', role: 'companion' });
        expect(voice('es_ES-sharvard-secretary')).toMatchObject({ speakerId: 1, gender: 'female', role: 'secretary' });
        expect(voice('es_ES-sharvard-male')).toMatchObject({ speakerId: 0, gender: 'male' });
        expect(voice('fr_FR-upmc-medium')).toMatchObject({ speakerId: 0, gender: 'female' });
        expect(voice('fr_FR-upmc-pierre')).toMatchObject({ speakerId: 1, gender: 'male' });
        expect(voice('pt_BR-edresson-low').gender).toBe('male');
        expect(voice('pt_BR-faber-medium').gender).toBe('male');
    });

    test('Companion and Secretary carry their documented synthesis settings', () => {
        expect(voice('en_US-kristin-medium').settings).toEqual({
            length_scale: 1.16,
            noise_scale: 0.8,
            noise_w_scale: 0.92,
        });
        expect(voice('en_US-lessac-medium').settings).toEqual({
            length_scale: 0.94,
            noise_scale: 0.48,
            noise_w_scale: 0.6,
        });
    });

    test('an unavailable voice stays listed, labelled, and unplayable', () => {
        const partial = withState((v) =>
            v.id === 'en_US-kristin-medium' ? { installed: false, state: 'missing', playable: false } : null
        );
        const listed = Policy.grouped(partial, { language: 'en-US' }).flatMap((g) => g.voices);
        expect(listed.find((v) => v.id === 'en_US-kristin-medium')).toMatchObject({
            playable: false,
            state: 'missing',
        });
        // Auto moves on to another female Companion-or-better choice rather than the missing one.
        expect(
            Policy.resolve({ library: partial, language: 'en-US', style: 'companion', gender: 'female' }).voice
        ).not.toBe('en_US-kristin-medium');
    });

    test('labels show the backend’s name, role, gender and locale', () => {
        expect(Policy.label(voice('en_US-kristin-medium'))).toBe(
            'Kristin — Companion — Female — English (US) — medium'
        );
        expect(Policy.label(voice('pt_BR-faber-medium'))).toMatch(/Male/);
    });
});

describe('Auto', () => {
    test.each([
        ['en-US', 'companion', 'en_US-kristin-medium'],
        ['en-US', 'secretary', 'en_US-lessac-medium'],
        ['en-GB', 'companion', 'en_GB-cori-medium'],
        ['en-GB', 'secretary', 'en_GB-alba-medium'],
        ['it-IT', 'companion', 'it_IT-paola-companion'],
        ['it-IT', 'secretary', 'it_IT-paola-medium'],
        ['es-ES', 'companion', 'es_ES-sharvard-companion'],
        ['es-ES', 'secretary', 'es_ES-sharvard-secretary'],
        ['es-MX', 'companion', 'es_MX-ald-companion'],
        ['fr-FR', 'companion', 'fr_FR-upmc-medium'],
        ['fr-FR', 'secretary', 'fr_FR-siwis-medium'],
        ['de-DE', 'companion', 'de_DE-eva_k-x_low'],
        ['de-DE', 'secretary', 'de_DE-kerstin-low'],
    ])('%s %s → %s', (language, style, expected) => {
        expect(pick(language, style).voice).toBe(expected);
    });

    test('works before the catalogue arrives, from the documented presets', () => {
        expect(Policy.resolve({ library: null, language: 'en-US', style: 'companion' }).voice).toBe(
            'en_US-kristin-medium'
        );
        expect(Policy.resolve({ library: null, language: 'it', style: 'secretary' }).voice).toBe('it_IT-paola-medium');
    });

    test('a female Spanish request never lands on the male Sharvard speaker', () => {
        for (const style of ['companion', 'secretary', 'all'])
            expect(pick('es-ES', style).voice).not.toBe('es_ES-sharvard-male');
    });
});

describe('explicit choices and preferences', () => {
    test('an explicit playable voice wins over Auto', () => {
        expect(pick('en-US', 'companion', { explicit: 'en_US-amy-medium' })).toEqual({
            voice: 'en_US-amy-medium',
            reason: 'chosen',
        });
    });

    test.each([
        'en_US-lessac-high',
        'en_US-ljspeech-high',
        'en_GB-cori-high',
        'de_DE-thorsten-high',
        'zh_CN-huayan-medium',
        'es_ES-sharvard-medium',
    ])('the local-Piper-only id %s is never sent to SonicAgent', (id) => {
        const r = pick(id.slice(0, 5).replace('_', '-'), 'companion', { explicit: id });
        expect(r.voice).not.toBe(id);
        if (r.voice) expect(lib.voices.some((v) => v.id === r.voice)).toBe(true);
        expect(r.ignoredReason || r.reason).toBeTruthy();
    });

    test('an explicit voice of another language is not used', () => {
        expect(pick('it-IT', 'companion', { explicit: 'en_US-kristin-medium' }).voice).toBe('it_IT-paola-companion');
    });

    test('Prefer Female ranks first but hides nothing', () => {
        const us = Policy.grouped(lib, { language: 'en-US', gender: 'female', style: 'all' }).find(
            (g) => g.locale === 'en-US'
        );
        const genders = us.voices.map((v) => v.gender);
        expect(genders).toContain('male');
        expect(genders.indexOf('male')).toBeGreaterThan(genders.lastIndexOf('female'));
    });

    test('Portuguese: no invented female preset — the male voice, with a sentence saying so', () => {
        const r = pick('pt-BR', 'companion');
        expect(['pt_BR-edresson-low', 'pt_BR-faber-medium']).toContain(r.voice);
        expect(r.preferenceUnmet).toBe(true);
        expect(r.message).toMatch(/no female voice for this language/);
    });

    test.each(['ja-JP', 'ko-KR', 'zh-CN'])('%s gets no SonicAgent voice, never an English one', (language) => {
        const r = pick(language, 'companion');
        expect(r.voice).toBeNull();
        expect(r.message).toBe('No SonicAgent voice is available for the selected language.');
    });

    test('nothing playable in the language: said, not substituted', () => {
        const down = withState((v) => (v.language === 'it' ? { playable: false, state: 'missing' } : null));
        const r = Policy.resolve({ library: down, language: 'it-IT', style: 'companion', gender: 'female' });
        expect(r.voice).toBeNull();
        expect(r.reason).toBe('not-playable');
    });
});
