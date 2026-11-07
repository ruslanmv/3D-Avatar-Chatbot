/**
 * HV-FIX 10. Serena (Italian, medium + high) and Daniela (Spanish, Argentina) reach Settings.
 * Fixture: the 49-voice live capture plus the three entries SonicAgent's registry adds (see its
 * `_provenance`), so 52 voices.
 */
const raw = require('../fixtures/sonicagent/voices-2026-11-02.json');
const Config = require('../../src/stt/SonicAgentVoiceConfig.js');
const Library = require('../../src/tts/VoiceLibrary.js');
const Policy = require('../../src/tts/VoiceSelectionPolicy.js');
const Style = require('../../src/tts/VoiceStyleSettings.js');

const lib = Library.normalize(raw);
const pick = (language, style, extra) =>
    Policy.resolve(Object.assign({ library: lib, language, style, gender: 'female' }, extra));

test('52 voices; Serena under Italiano, Daniela under Español (Argentina)', () => {
    expect(lib.voices).toHaveLength(52);
    expect(Policy.forLanguage(lib, 'it-IT').map((v) => v.id)).toEqual(
        expect.arrayContaining(['it_IT-serena-medium', 'it_IT-serena-high', 'it_IT-paola-companion'])
    );
    expect(Policy.forLanguage(lib, 'es-AR').map((v) => v.id)).toEqual(['es_AR-daniela-high']);
    // Argentina does not leak into Spain's or Mexico's lists.
    expect(Policy.forLanguage(lib, 'es-ES').some((v) => v.locale === 'es-AR')).toBe(false);
});

test('Paola stays Auto for Italian; Serena is chosen only when picked', () => {
    expect(pick('it-IT', 'companion').voice).toBe('it_IT-paola-companion');
    expect(pick('it-IT', 'secretary').voice).toBe('it_IT-paola-medium');
    expect(pick('it-IT', 'companion', { explicit: 'it_IT-serena-high' })).toEqual({
        voice: 'it_IT-serena-high',
        reason: 'chosen',
    });
});

test('Auto for Español (Argentina) is Daniela, not a voice from Spain', () => {
    expect(pick('es-AR', 'companion')).toEqual({ voice: 'es_AR-daniela-high', reason: 'same-locale' });
    expect(pick('es-AR', 'secretary').voice).toBe('es_AR-daniela-high');
    // Locales that have presets are untouched.
    expect(pick('es-ES', 'companion').voice).toBe('es_ES-sharvard-companion');
    expect(pick('es-MX', 'secretary').voice).toBe('es_MX-ald-medium');
    // Brazilian Portuguese still has no female voice and still says so.
    expect(pick('pt-BR', 'companion').preferenceUnmet).toBe(true);
});

test('Settings ▸ VOICE LANGUAGE offers Español (Argentina) and lists Daniela there', () => {
    localStorage.clear();
    localStorage.setItem('speech_lang', 'en-US');
    window.NEXUS_VOICE_POLICY = Policy;
    Config.rememberLibrary(lib);
    document.body.innerHTML =
        '<div class="input-group"><select id="tts-engine"><option value="sonicagent-stream">S</option></select></div>';
    document.getElementById('tts-engine').value = 'sonicagent-stream';
    Style.attach({ doc: document, config: Config, policy: Policy, library: Library, tts: null, store: localStorage });
    const language = document.getElementById('sonic-voice-language');
    expect(Array.from(language.options).map((o) => o.value)).toContain('es-AR');
    language.value = 'es-AR';
    language.dispatchEvent(new Event('change'));
    const sel = document.getElementById('sonic-voice-select');
    expect(Array.from(sel.querySelectorAll('optgroup option')).map((o) => o.value)).toEqual(['es_AR-daniela-high']);
    expect(sel.options[0].textContent).toBe('Auto — Daniela (Catalog, Español (Argentina))');
    Config.rememberLibrary(null);
    delete window.NEXUS_VOICE_POLICY;
});
