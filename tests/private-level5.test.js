/**
 * L5. No limits: the fifth step. It is the Unrestrained step reached by the person's Closer at 4
 * (TogetherCapability), named in every language, and bare only.
 */
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');
const Locale = require('../src/features/together/PrivateLocale.js');
const Intent = require('../src/experiences/private/PrivateActionIntent.js');

const base = { active: true, level: 4, asked: { wardrobe: true }, autonomy: 'autonomous' };

describe('L5 No limits', () => {
    test('has a name in every language, distinct from Intimate', () => {
        for (const lang of Locale.languages()) {
            expect(Locale.pace(5, lang)).not.toBe(Locale.pace(4, lang));
            expect(Locale.pace(5, lang)).not.toMatch(/^pace\./);
        }
    });

    test('is bare only: the model never dresses her there; the person still can', () => {
        for (const name of ['wardrobe.wear', 'wardrobe.change', 'wardrobe.redress']) {
            const params = name === 'wardrobe.redress' ? {} : { look: 'red-dress', style: 'elegant' };
            const model = Policy.decide({ name, params, source: 'model' }, { ...base, unrestrained: true });
            expect(model).toMatchObject({ allow: false, why: 'bare-only' });
        }
        const theirs = Policy.decide(
            { name: 'wardrobe.redress', params: {}, source: 'user' },
            { ...base, unrestrained: true }
        );
        expect(theirs.why).not.toBe('bare-only');
    });

    test("Valentina's and Chiara's shows are asked for by name, in each language", () => {
        const show = (said) => {
            const r = Intent.parse(said, {});
            return r && r.name === 'avatar.routine' ? r.params.routine || r.params.id : null;
        };
        for (const lang of Locale.languages())
            for (const id of ['full-service', 'like-last-time']) {
                const say = Locale.t(`routine.${id}.say`, null, lang);
                expect([say, show(say)]).toEqual([say, id]);
            }
    });
});
