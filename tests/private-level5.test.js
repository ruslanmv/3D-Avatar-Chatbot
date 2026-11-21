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
            for (const id of [
                'full-service',
                'like-last-time',
                'fist-then-inside',
                'worse-than-last-time',
                'fist-then-ass',
                'two-hands',
            ]) {
                const say = Locale.t(`routine.${id}.say`, null, lang);
                expect([say, show(say)]).toEqual([say, id]);
            }
    });
});

describe('BD35. two hands in her ass, asked in words', () => {
    test.each([
        'mettimi le due mani',
        'mettimi le due mani nel culo',
        'put both hands in me',
        'mets-moi les deux mains',
        'méteme las dos manos',
        'steck beide Hände rein',
        'enfia as duas mãos em mim',
        '両手を入れて',
    ])('"%s" asks for both hands in her ass', (line) => {
        expect(Intent.fistFrom(line)).toMatchObject({
            name: 'body.fist',
            params: { where: 'anal', with: 'hands' },
        });
    });
    test.each([
        'mettimi le due mani addosso',
        'mettimi le due mani sui fianchi',
        'put both hands on my hips',
        'non mettermi le due mani dentro',
        'mi metti le due mani dentro?',
    ])('"%s" is not a request for them inside her', (line) => {
        const out = Intent.fistFrom(line);
        expect(out && out.params && out.params.with).not.toBe('hands');
    });
    test('a valid action, theirs to ask and never the model', () => {
        const params = { where: 'anal', with: 'hands' };
        expect(Policy.validate('body.fist', params).ok).toBe(true);
        expect(Policy.decide({ name: 'body.fist', params, source: 'model' }, base)).toMatchObject({ allow: false });
        expect(Policy.decide({ name: 'body.fist', params, source: 'user' }, base)).toMatchObject({ allow: true });
    });
});
