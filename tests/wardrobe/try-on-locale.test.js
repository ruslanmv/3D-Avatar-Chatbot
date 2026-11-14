/**
 * LT7. The try-on haul speaks every language AppLanguage already speaks.
 *
 * English stays the fallback: a suite that never loads this pack still sees the
 * sentence it was written against. A language that is present has to cover every
 * key, not fall through to English in silence.
 */
const fs = require('fs');
const path = require('path');

const locale = require('../../src/wardrobe/TryOnLocale.js');
require('../../src/wardrobe/TryOnLocalePacks.js');
const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');

const TRANSLATED = ['es-ES', 'it-IT', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];

function placeholders(text) {
    return (String(text).match(/\{[a-zA-Z0-9]+\}/g) || []).sort().join(',');
}

describe('try-on haul languages', () => {
    const keys = locale.keys();

    test('covers the languages AppLanguage offers, with British English on the same pack', () => {
        expect(locale.CODES).toEqual([
            'en-US',
            'en-GB',
            'es-ES',
            'it-IT',
            'fr-FR',
            'de-DE',
            'pt-BR',
            'ja-JP',
            'ko-KR',
            'zh-CN',
        ]);
        expect(locale.overlay('en-GB')).toBeNull();
        expect(locale.t('stage.badge', null, 'en-GB')).toBe(locale.t('stage.badge', null, 'en-US'));
        expect(locale.t('stage.badge', null, 'en-US')).toBe('AI · LIVE TRY-ON');
    });

    test('every other language translates every key, and the placeholders still match', () => {
        const outfits = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/wardrobe/outfits.json'), 'utf8'));
        outfits.outfits.forEach((entry) => {
            expect(keys).toContain('outfit.' + entry.id);
        });
        TRANSLATED.forEach((code) => {
            const extra = locale.overlay(code);
            expect(extra).toBeTruthy();
            const missing = keys.filter((key) => !extra[key]);
            expect(missing).toEqual([]);
            const drifted = keys.filter(
                (key) => placeholders(extra[key]) !== placeholders(locale.t(key, null, 'en-US'))
            );
            expect(drifted).toEqual([]);
            const same = keys.filter((key) => extra[key] === locale.t(key, null, 'en-US'));
            expect(same.length).toBeLessThan(keys.length * 0.15);
        });
    });

    test('Spanish is the haul a person reads, not the English sentence with a new label', () => {
        expect(locale.t('stage.badge', null, 'es-ES')).toBe('IA · PRUEBA EN VIVO');
        expect(locale.t('catalog.apply', null, 'es-ES')).toBe('Aplicar prenda');
        expect(locale.t('haul.lookOf', { n: 1, total: 2, name: 'Burgundy' }, 'es-ES')).toBe('Look 1 de 2 · Burgundy');
        expect(locale.t('reason.step.fitting', null, 'es-ES')).not.toBe(locale.t('reason.step.fitting', null, 'en-US'));
        expect(locale.t('react.fresh.0', null, 'es-ES')).not.toBe(locale.t('react.fresh.0', null, 'en-US'));
        expect(locale.t('stage.wearing', { name: 'Vestido', detail: '.' }, 'ja-JP')).toContain('Vestido');
    });

    test('tx uses the pack when it has the key, and the English sentence when it does not', () => {
        const previous = global.AppLanguage;
        global.AppLanguage = { code: 'en-US' };
        expect(locale.tx('not.a.key', 'Close ×')).toBe('Close ×');
        expect(locale.tx('stage.try', 'Try {name}', { name: 'Red' })).toBe('Try Red');
        global.AppLanguage = { code: 'fr-FR' };
        expect(locale.tx('stage.badge', 'AI · LIVE TRY-ON')).toBe('IA · ESSAYAGE EN DIRECT');
        expect(locale.tx('not.a.key', 'Close ×')).toBe('Close ×');
        if (previous) global.AppLanguage = previous;
        else delete global.AppLanguage;
    });

    test('the live stage badge follows AppLanguage', () => {
        const previous = global.AppLanguage;
        global.AppLanguage = { code: 'es-ES' };
        document.body.innerHTML =
            '<div class="avatar-preview-wrap"><div id="avatar-viewport"></div></div><div id="nexus-try-on-view"></div>';
        const stage = new TryOnStageExperience({
            doc: document,
            view: { root: document.getElementById('nexus-try-on-view'), collapsed: true },
            session: { state: () => ({ looks: [], look: null, favorite: false, busy: false }) },
        });
        try {
            stage.mount();
            expect(document.querySelector('.nexus-stage-label').textContent).toBe('IA · PRUEBA EN VIVO');
            expect(document.querySelector('.nexus-try-on-look-rail').getAttribute('aria-label')).toBe(
                'Conjuntos disponibles'
            );
            stage.render({ looks: [], look: null, favorite: false, busy: false, total: 0 });
            expect(document.querySelector('.nexus-stage-action.is-primary').textContent).toMatch(/Siguiente/);
        } finally {
            stage.unmount();
            document.body.innerHTML = '';
            if (previous) global.AppLanguage = previous;
            else delete global.AppLanguage;
        }
    });

    test('the two locale scripts sit with the other wardrobe tags, after the frozen boot lines', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
        const block = html.slice(html.indexOf('Wardrobe Forge loads last'), html.indexOf('On-device speech-to-text'));
        const scripts = block.match(/src="src\/wardrobe\/[^"]+"/g) || [];
        expect(scripts).toContain('src="src/wardrobe/TryOnLocale.js"');
        expect(scripts).toContain('src="src/wardrobe/TryOnLocalePacks.js"');
        const localeAt = scripts.indexOf('src="src/wardrobe/TryOnLocale.js"');
        const packsAt = scripts.indexOf('src="src/wardrobe/TryOnLocalePacks.js"');
        const reasonsAt = scripts.indexOf('src="src/wardrobe/TryOnReasons.js"');
        expect(localeAt).toBeGreaterThan(-1);
        expect(packsAt).toBe(localeAt + 1);
        expect(reasonsAt).toBe(packsAt + 1);
        expect(scripts.length).toBe(32);
    });
});
