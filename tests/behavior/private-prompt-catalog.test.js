/* global describe, test, expect, jest, beforeEach, afterEach */
'use strict';

/**
 * The master AppLanguage must control every authored Private story field.
 * Generated models can still ignore a language request; real-provider QA is separate.
 */
const Catalog = require('../../src/features/together/PrivatePromptCatalog.js');
const Beats = require('../../src/features/together/PrivateBeats.js');
const PrivateLocale = require('../../src/features/together/PrivateLocale.js');

const STYLES = ['affectionate', 'romantic', 'sensual', 'mature'];
const REQUIRED_UI = [
    'setup.last',
    'setup.continue',
    'setup.or',
    'setup.question',
    'setup.privacy',
    'setup.back',
    'setup.atmosphere',
    'setup.where',
    'setup.keep',
    'setup.more',
    'setup.room',
    'setup.music',
    'setup.musicAuto',
    'setup.musicKeep',
    'setup.musicOff',
    'setup.cancel',
    'setup.edit',
    'setup.preparing',
    'setup.unavailable',
    'setup.private',
    'setup.musicNo',
    'setup.musicChosen',
    ...STYLES.map((id) => 'preset.name.' + id),
    ...STYLES.map((id) => 'preset.note.' + id),
];

describe('a complete native-language Private authoring catalog', () => {
    test('covers each master AppLanguage locale without empty or English fallback story fields', () => {
        const supported = ['en-US', 'en-GB', 'es-ES', 'it-IT', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];
        expect(new Set(Catalog.SUPPORTED)).toEqual(new Set(supported));
        for (const locale of supported) {
            for (const id of STYLES) {
                const plan = Beats.fallbackPlan({ id, maxLevel: 4 }, { locale, rng: () => 0 });
                expect(plan.locale).toBe(locale);
                const fields = [
                    plan.opening,
                    plan.moodPrompt,
                    ...Object.values(plan.moods),
                    ...Object.values(plan.middle),
                    ...Object.values(plan.closing),
                    ...Object.values(plan.texture),
                    ...Object.values(plan.levelLines),
                    ...Object.values(plan.easeLines),
                ];
                fields.forEach((line) => {
                    expect(typeof line).toBe('string');
                    expect(line.length).toBeGreaterThan(0);
                    expect(line.length).toBeLessThanOrEqual(Beats.MAX_LINE);
                });
                const prompt = Beats.plannerSystemPrompt({ id, maxLevel: 4 }, locale);
                expect(prompt).toContain('JSON');
                expect(prompt.length).toBeGreaterThan(100);
            }
        }
    });

    test('Italian is authored in Italian, including the level and easing lines', () => {
        const plan = Beats.fallbackPlan({ id: 'sensual', maxLevel: 3 }, { locale: 'it-IT', rng: () => 0 });
        // AX20: the property, not particular words — the lines were rewritten and will be again.
        const Scorer = require('../../tools/qa/CharacterQualityScorer.js');
        for (const line of [plan.opening, plan.middle.tender, plan.middle.playful, plan.closing.tender])
            expect(Scorer.languageOf(line)).toBe('it');
        expect(plan.easeLines[1]).toMatch(/Certo|tranquillo/);
        expect(plan.opening).not.toMatch(/I want this|Let's|You decide/);
        expect(Beats.plannerSystemPrompt({ id: 'romantic', maxLevel: 2 }, 'it-IT')).toMatch(/Scrivi battute/);
    });

    test('every visible wizard key is translated in each supported pack', () => {
        for (const locale of Catalog.SUPPORTED) {
            for (const key of REQUIRED_UI) {
                const translated = PrivateLocale.t(key, null, locale);
                expect(translated).toBeTruthy();
                expect(translated).not.toBe(key);
            }
        }
    });

    test('one AppLanguage setting changes subsequent authored fallback lines', () => {
        const prev = window.AppLanguage;
        try {
            window.AppLanguage = { code: 'it-IT' };
            const it = Beats.fallbackPlan({ id: 'romantic' }, { rng: () => 0 });
            window.AppLanguage.code = 'es-ES';
            const es = Beats.fallbackPlan({ id: 'romantic' }, { rng: () => 0 });
            expect(it.locale).toBe('it-IT');
            expect(es.locale).toBe('es-ES');
            expect(it.opening).not.toBe(es.opening);
        } finally {
            window.AppLanguage = prev;
        }
    });

    test('provider planner is requested in the selected language and the fallback remains localized', async () => {
        const sendMessage = jest.fn(() => Promise.reject(new Error('offline')));
        const plan = await Beats.plan({
            preset: { id: 'romantic', maxLevel: 2 },
            scene: 'a suite',
            win: {
                AppLanguage: { code: 'it-IT' },
                _nexusLLM: {
                    getSettings: () => ({ provider: 'openai' }),
                    sendMessage,
                },
            },
        });
        expect(plan.locale).toBe('it-IT');
        expect(plan.source).toBe('written');
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0]).toMatch(/Ambiente:/);
        expect(sendMessage.mock.calls[0][1]).toMatch(/Scrivi battute/);
    });
});
