/**
 * PS1–PS2. Who she is tonight: every persona is an adult who chose this, her lines exist in every
 * language, nothing young-coded ever appears, and her character never touches the rules.
 */
const Personas = require('../src/experiences/private/PrivatePersonas.js');
const Routines = require('../src/experiences/private/PrivateRoutines.js');
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');
const Intent = require('../src/experiences/private/PrivateActionIntent.js');
const Locale = require('../src/features/together/PrivateLocale.js');
const worlds = require('../assets/vr-worlds/worlds.json').worlds;

const all = Object.values(Personas.PERSONAS);
const YOUNG =
    /\b(school ?girls?|school|schools|uniforms?|students?|pupils?|teen(age|ager|s)?|minors?|underage|child(ren)?|kids?|loli|scuola|studentess[ae]|liceal[ei]|ragazzin[ae]|colegiala|escuela|estudiante|adolescente|niñ[ao]s?|écolière|lycéenne|schülerin|schulmädchen|colegial|escola)\b|学校|女子高生|学生|학생|교복|学生妹/iu;

describe('PS1 personas: the data', () => {
    test('each is an adult (21+), reachable at her own step, in a private room, offering shows she knows', () => {
        expect(all.map((p) => p.id).sort()).toEqual(['gina', 'isabelle', 'yuki']);
        for (const p of all) {
            expect(p.age).toBeGreaterThanOrEqual(21);
            expect(p.brief).toMatch(new RegExp(`\\b${p.age}\\b`));
            expect(p.brief).toMatch(/by your own choice|loves her job/);
            const room = worlds.find((w) => w.id === p.room);
            expect(room && room.place && room.rating).toBe('private');
            for (const show of p.shows) expect(Routines.ROUTINES[show]).toBeTruthy();
            for (const deal of p.deals) expect(p.shows).toContain(deal);
        }
        // Gina is Intense only; the others open with a Sensual evening.
        expect(Personas.forLevel(3).map((p) => p.id)).toEqual(['isabelle', 'yuki']);
        expect(Personas.forLevel(4).map((p) => p.id)).toEqual(['gina', 'isabelle', 'yuki']);
        expect(Personas.forLevel(2)).toEqual([]);
    });

    test('nothing young-coded anywhere: her brief, her voice, her lines in every language', () => {
        for (const p of all) {
            expect(p.brief).not.toMatch(YOUNG);
            for (const v of Object.values(p.voice)) expect(v).not.toMatch(YOUNG);
            for (const lang of Locale.languages())
                for (const k of ['tagline', 'opening', 'deal-ok'])
                    expect(Locale.t(`persona.${p.id}.${k}`, null, lang)).not.toMatch(YOUNG);
        }
    });

    test('her lines exist in every language: the picker, her card, the door, the deal, the invitation', () => {
        const keys = ['setup.who', 'setup.who.none'];
        for (const p of all) {
            keys.push(`persona.${p.id}.tagline`, `persona.${p.id}.opening`, `persona.${p.id}.deal-ok`);
            for (const deal of p.deals) keys.push(`place.deal.${deal}`);
            for (const show of p.shows) keys.push(`place.invite.${show}`);
        }
        for (const lang of Locale.languages()) for (const key of keys) expect(Locale.t(key, null, lang)).not.toBe(key);
    });

    test('her voice follows the evening language, and her character never outranks the person', () => {
        const it = Personas.promptLines('gina', 'it-IT').join('\n');
        expect(it).toMatch(/WHO YOU ARE TONIGHT: You are Gina, 32/);
        expect(it).toMatch(/HOW YOU TALK: Parla/);
        expect(Personas.promptLines('isabelle', 'es-ES').join('\n')).toMatch(/HOW YOU TALK: Español refinado/);
        expect(Personas.promptLines('yuki', 'ja-JP').join('\n')).toMatch(/HOW YOU TALK: Speak this language playfully/);
        for (const p of all)
            expect(Personas.promptLines(p.id, 'en').join('\n')).toMatch(/"stop" and their safety words come first/);
        expect(Personas.promptLines('nobody', 'en')).toEqual([]);
    });
});

describe('PS2 fisting: their words only, at the top of the pace', () => {
    const parse = (said) => Intent.parse(said, {});
    test.each([
        ['fist me', 'choose'],
        ['Fammi il pugno nel culo', 'anal'],
        ['voglio il pugno dentro', 'choose'],
        ['quiero meterte el puño en los dos', 'both'],
        ['拳交したい', 'choose'],
    ])('%s → body.fist (%s)', (said, where) => {
        const a = parse(said);
        expect(a && a.name).toBe('body.fist');
        expect(a.params.where).toBe(where);
    });

    test('a punch is not fisting, and a negation is not a yes', () => {
        for (const said of ['ti do un pugno', 'un puño en la mesa', 'don’t fist me']) {
            const a = parse(said);
            expect(a && a.name).not.toBe('body.fist');
        }
    });

    test('only theirs, only at step 4', () => {
        const facts = (level) => ({ active: true, care: false, asked: {}, autonomy: 'autonomous', level });
        const fist = (source) => ({ name: 'body.fist', params: { where: 'choose' }, source });
        expect(Policy.decide(fist('user'), facts(4)).allow).toBe(true);
        expect(Policy.decide(fist('user'), facts(3))).toMatchObject({ allow: false, why: 'pace' });
        expect(Policy.decide(fist('model'), facts(4))).toMatchObject({ allow: false, why: 'user-only' });
    });
});
