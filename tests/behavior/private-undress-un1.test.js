/**
 * UN1–UN2. Undressing in Private (at the top of the pace only) and poses asked for in any language.
 *
 * The pure halves: what the words mean, whether the evening allows it, which layer comes off,
 * the tag she writes, and the Japanese / Korean / Chinese poses. The bridge end-to-end lives in
 * private-actions.test.js, next to the session harness it needs.
 */
const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
const Policy = require('../../src/experiences/private/PrivateActionPolicy.js');
const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
const Bridge = require('../../src/experiences/private/PrivateActionBridge.js');
const WardrobeTool = require('../../src/wardrobe/WardrobeTool.js');
const FastPath = require('../../src/xr/IntentFastPath.js');
const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');

const look = (name, prompt) => ({
    lookId: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    prompt,
    vrmUrl: `${name}.vrm`,
});
const DRESS = look('Black Cocktail Dress', 'black satin cocktail dress');
const SET = look(
    'Black Tailored Triangle Bralette + Black Tailored Briefs',
    'black Tailored Triangle Bralette + black Tailored Briefs'
);
const GARTER = look('Black Lingerie Set', 'black Lingerie Set');
const THONG = look('Black Bralette + Black Micro Tailored Thong', 'black Tailored Thong');
const BRIEFS = look('Black Tailored Triangle Bralette + Black Tailored Cheeky Briefs', 'black Tailored Cheeky Briefs');
const CHAMPAGNE = look('Champagne Lingerie Set', 'champagne Lingerie Set');
const LOOKS = [DRESS, CHAMPAGNE, SET, GARTER, THONG, BRIEFS];

describe('UN1. their words', () => {
    test.each([
        ['spogliati', 'next'],
        ['Togliti il vestito', 'next'],
        ['togliti tutto', 'all'],
        ['undress', 'next'],
        ['take everything off', 'all'],
        ['take your dress off', 'next'],
        ['undress completely', 'all'],
        ['desnúdate', 'next'],
        ['quítate todo', 'all'],
        ['déshabille-toi', 'next'],
        ['zieh dich aus', 'next'],
        ['脱いで', 'next'],
        ['全部脱いで', 'all'],
        ['벗어', 'next'],
        ['脱掉', 'next'],
    ])('%s → wardrobe.undress (%s)', (said, step) => {
        const parsed = Intent.parse(said);
        expect(parsed && parsed.name).toBe('wardrobe.undress');
        expect(parsed.params.step).toBe(step);
    });

    test('talk about clothes is still talk', () => {
        expect(Intent.parse('Ti piace spogliarti?')).toBeNull();
        expect(Intent.parse("don't undress")).toBeNull();
    });
});

describe('UN1. the evening decides: level 4, read and never moved', () => {
    const facts = (level, more) => ({ active: true, care: false, asked: {}, autonomy: 'suggest', level, ...more });
    const undress = (source) => ({ name: 'wardrobe.undress', params: { step: 'next' }, source });

    test('the level is 4', () => {
        expect(Policy.UNDRESS_LEVEL).toBe(4);
        expect(Bridge.UNDRESS_AT).toBe(Policy.UNDRESS_LEVEL);
    });

    test('below level 4 nobody undresses her, not even the person', () => {
        for (const level of [0, 1, 2, 3, undefined]) {
            expect(Policy.decide(undress('user'), facts(level))).toEqual({ allow: false, why: 'pace' });
            expect(Policy.decide(undress('model'), facts(level, { autonomy: 'autonomous' }))).toEqual({
                allow: false,
                why: 'pace',
            });
        }
    });

    test('at level 4 the person’s words, yes or tap undress her', () => {
        for (const source of ['user', 'user-approved', 'control'])
            expect(Policy.decide(undress(source), facts(4))).toEqual({ allow: true });
    });

    test('at level 4 her own wish follows the outfit-autonomy setting', () => {
        expect(Policy.decide(undress('model'), facts(4, { autonomy: 'autonomous' }))).toEqual({ allow: true });
        expect(Policy.decide(undress('model'), facts(4, { autonomy: 'suggest' }))).toMatchObject({
            allow: false,
            suggest: true,
        });
        expect(Policy.decide(undress('model'), facts(4, { autonomy: 'off' }))).toEqual({
            allow: false,
            why: 'autonomy-off',
        });
        expect(Policy.decide(undress('model'), facts(4, { asked: { wardrobe: true } }))).toEqual({ allow: true });
    });

    test('care mode still stops it, and no other action reads the level', () => {
        expect(Policy.decide(undress('user'), facts(4, { care: true }))).toEqual({ allow: false, why: 'care' });
        const wear = { name: 'wardrobe.wear', params: { style: 'lingerie' }, source: 'user' };
        expect(Policy.decide(wear, facts(1))).toEqual({ allow: true });
        expect(Policy.decide({ name: 'avatar.dance', params: {}, source: 'user' }, facts(1))).toEqual({ allow: true });
    });

    test('parameters are validated like every other action', () => {
        expect(Policy.validate('wardrobe.undress', { step: 'all', volume: 11 }).params).toEqual({ step: 'all' });
        expect(Policy.validate('wardrobe.undress', { step: 'sideways' }).params).toEqual({});
    });
});

describe('UN1. which layer comes off, from her own looks', () => {
    const step = (current, s) => Engine.undressStep({ looks: LOOKS, current, step: s, allureOf });

    test('dressed → her richest lingerie in the colour she has on', () => {
        const next = step(DRESS, 'next');
        expect([SET.name, GARTER.name]).toContain(next.name);
        expect(Engine.colourOf(next)).toBe('black');
    });

    // UN7. Each step leaves less fabric on her — never more. (These pinned an allure-only order,
    // garter → thong → briefs, in which "taking a layer off" put more on.)
    test('in lingerie → each next layer covers less, down to the least there is, then nothing more', () => {
        const seen = [GARTER];
        let at = GARTER;
        for (let next = step(at, 'next'); next; next = step(at, 'next')) {
            expect(Engine.coverageOf(next)).toBeLessThanOrEqual(Engine.coverageOf(at));
            expect(seen).not.toContain(next);
            seen.push(next);
            at = next;
        }
        expect(at.name).toBe(THONG.name);
        expect(Engine.coverageOf(THONG)).toBeLessThan(Engine.coverageOf(BRIEFS));
    });

    test('"all of it" goes straight to the least she has', () => {
        expect(step(DRESS, 'all').name).toBe(THONG.name);
        expect(step(SET, 'all').name).toBe(THONG.name);
        expect(step(THONG, 'all')).toBeNull();
    });

    test('a colour she has no lower layer in falls back to any lower layer', () => {
        const next = step(CHAMPAGNE, 'next');
        expect(Engine.colourOf(next)).toBe('black');
        expect(Engine.coverageOf(next)).toBeLessThan(Engine.coverageOf(CHAMPAGNE));
    });

    // UN7. Forge replaces only what a garment covers: string briefs alone kept her own cardigan on
    // in the real run. A single piece is never a step towards undressed.
    test('a single piece that leaves her own clothes on is never an undress step', () => {
        const STRING = look('Black Tailored String Briefs', 'black Tailored String Briefs');
        const BRA = look('Black Tailored Plunge Bra', 'black Tailored Plunge Bra');
        expect(Engine.isComplete(STRING)).toBe(false);
        expect(Engine.isComplete(BRA)).toBe(false);
        expect(Engine.isComplete(SET)).toBe(true);
        const only = Engine.undressStep({ looks: [DRESS, STRING, BRA], current: DRESS, step: 'all', allureOf });
        expect(only).toBeNull();
        const with_ = Engine.undressStep({ looks: [DRESS, STRING, SET], current: DRESS, step: 'all', allureOf });
        expect(with_.name).toBe(SET.name);
    });

    test('with no lingerie looks there is nothing to change into', () => {
        expect(Engine.undressStep({ looks: [DRESS], current: DRESS, allureOf })).toBeNull();
        expect(Engine.undressStep({ looks: LOOKS, current: DRESS })).toBeNull();
    });
});

describe('UN1. the tag she writes', () => {
    test('<wardrobe action="undress"/> is one undress call, step next by default', () => {
        const out = WardrobeTool.extract('Vieni qui. <wardrobe action="undress"/>');
        expect(out.call).toEqual({ name: 'wardrobe_undress', args: { step: 'next' } });
        expect(out.clean).toBe('Vieni qui.');
        expect(WardrobeTool.extract('<wardrobe action="undress" step="all"/>').call.args).toEqual({ step: 'all' });
        expect(WardrobeTool.extract('<wardrobe action="undress" step="sideways"/>').call).toBeNull();
    });

    test('outside Private it never runs', async () => {
        await expect(WardrobeTool.call('wardrobe_undress', { step: 'next' })).resolves.toMatchObject({ ok: false });
    });
});

describe('UN2. poses asked for in Japanese, Korean and Chinese', () => {
    test.each([
        ['座って', 'sit'],
        ['앉아', 'sit'],
        ['坐下', 'sit'],
        ['横になって', 'lay'],
        ['누워', 'lay'],
        ['躺下', 'lay'],
        ['立って', 'stand'],
        ['일어나', 'stand'],
        ['站起来', 'stand'],
        ['くるっと回って', 'spin'],
        ['한 바퀴 돌아', 'spin'],
        ['转个圈', 'spin'],
        ['振り向いて', 'turn_around'],
        ['转身', 'turn_around'],
        ['踊って', 'dance'],
        ['춤춰', 'dance'],
        ['跳舞', 'dance'],
        ['ポーズして', 'model_pose'],
        ['摆个姿势', 'model_pose'],
        ['服を見せて', 'show_outfit'],
    ])('%s → %s', (said, label) => {
        const hit = FastPath.match(said);
        expect(hit && hit.label).toBe(label);
        expect(hit.plan.commands.length).toBeGreaterThan(0);
    });

    test('every CJK entry points at a motion that exists', () => {
        const labels = new Set(FastPath.RULES.map((r) => r.label));
        FastPath.CJK_RULES.forEach((entry) => expect(labels.has(entry.label)).toBe(true));
    });

    test('a long sentence is left to her, and the existing languages are unchanged', () => {
        expect(FastPath.match('昨日は友達と一緒に座っていろいろ話をしました')).toBeNull();
        expect(FastPath.match('sit down').label).toBe('sit');
        expect(FastPath.match('siediti').label).toBe('sit');
        expect(FastPath.match('sdraiati').label).toBe('lay');
    });
});
