/**
 * NL1–NL2. The resolver: a position or an animation asked for in words, found in the live
 * catalogue and the live clip registry, one language at a time.
 *
 * The properties, not the sentences: a phrase reaches the preset it names; nothing resolves to
 * a preset the session does not offer; an adult preset is never reachable from here; English
 * is read with the English table and Italian with the Italian one.
 */
/* global describe, test, expect */
const Commands = require('../../src/xr/PoseCommands.js');
const ClipMap = require('../../src/xr/MotionClipMap.js');
const { catalogue, navigatorPresets } = require('./harness.js');

const cat = catalogue();
const en = (text, extra) => Commands.resolve(text, Object.assign({ catalogue: cat, lang: 'en' }, extra));
const it = (text, extra) => Commands.resolve(text, Object.assign({ catalogue: cat, lang: 'it' }, extra));

describe('English, read with the English table', () => {
    test.each([
        ['Sit with your legs crossed.', 'sittingCrossed'],
        ['Get on your knees.', 'kneeling'],
        ['Kneel down', 'kneeling'],
        ['Lie on your back.', 'lyingBack'],
        ['Lie on your side.', 'lyingSide'],
        ['Bend forward.', 'standingBendForward'],
        ['Sit comfortably.', 'sittingLegsUp'],
        ['Please, could you lie on your back for me?', 'lyingBack'],
        ['Please change your position to kneeling.', 'kneeling'],
        ['Can you get into the lecturer pose', 'lecturerNeutral'],
        ['switch to sitting crossed', 'sittingCrossed'],
    ])('%s → %s', (said, preset) => {
        expect(en(said)).toMatchObject({ kind: 'pose', preset });
    });

    test('a slipped key still finds the position', () => {
        expect(en('knel down')).toMatchObject({ kind: 'pose', preset: 'kneeling', via: 'typo' });
        expect(en('lie on yuor back')).toMatchObject({ kind: 'pose', preset: 'lyingBack' });
    });

    test('standing and going back are their own answers', () => {
        expect(en('Return to your normal standing position.')).toMatchObject({ kind: 'stand', explicit: true });
        expect(en('Go back to the previous position.')).toEqual({ kind: 'previous' });
        // "Stand up" is a position request only while one is held; otherwise it is the fast path's.
        expect(en('Stand up.')).toBeNull();
        expect(en('Stand up.', { held: true })).toMatchObject({ kind: 'stand' });
    });

    test('bare "sit down" and "lie down" are left to the fast path', () => {
        expect(en('Sit down.')).toBeNull();
        expect(en('Lie down.')).toBeNull();
    });

    test('a position nothing here answers to is said to be unknown, not ignored', () => {
        expect(en('Change your position to a handstand')).toMatchObject({ kind: 'unknown-position' });
        expect(en('Lean against the wall.')).toMatchObject({ kind: 'unknown-position', loose: true });
    });

    test('a one-word label two presets share is a question back, never a guess', () => {
        const found = en('get into the relaxed pose');
        expect(found.kind).toBe('ambiguous');
        expect(found.options.map((o) => o.preset).sort()).toEqual(['lyingBackRelaxed', 'standingRelaxed']);
    });

    test('talk about a position is not a request for one', () => {
        expect(en('I was lying on my back yesterday when the phone rang')).toBeNull();
        expect(en("Don't kneel down")).toBeNull();
        expect(en('What do you think about yoga?')).toBeNull();
    });

    test.each([
        ["As before, I'd like to talk about work today."],
        ['Lie to me.'],
        ['Sit tight, I will be right back.'],
        ['Kneel before Zod is my favourite line in that whole film.'],
        ['Lie on your back exercises for lower back pain, do they help?'],
        ['Stand up comedy is my favourite thing.'],
        ['Pose a question for me.'],
        ['Lean on me when you are not strong.'],
        ['Get on with it.'],
    ])('conversation that only starts like a request is left alone: %s', (said) => {
        expect(en(said, { held: true })).toBeNull();
        expect(en(said)).toBeNull();
    });

    test('a short imperative with a few more words is still the request', () => {
        expect(en('Kneel down in front of me.')).toMatchObject({ kind: 'pose', preset: 'kneeling' });
        expect(en('Lie on your back and look at me.')).toMatchObject({ kind: 'pose', preset: 'lyingBack' });
        expect(en('Stand up now, please.', { held: true })).toMatchObject({ kind: 'stand' });
        expect(en('Crouch down behind the sofa.')).toMatchObject({ kind: 'unknown-position', loose: true });
    });

    test('Italian is not read in an English session', () => {
        expect(en('Inginocchiati')).toBeNull();
        expect(en('Sdraiati sulla schiena')).toBeNull();
        expect(en('Torna alla posizione precedente')).toBeNull();
    });
});

describe('Italian, read with the Italian table', () => {
    test.each([
        ['Inginocchiati.', 'kneeling'],
        ['Sdraiati sulla schiena.', 'lyingBack'],
        ['Sdraiati sul fianco', 'lyingSide'],
        ['Siediti a gambe incrociate', 'sittingCrossed'],
        ['Piegati in avanti', 'standingBendForward'],
        ['Per favore, puoi metterti in ginocchio?', 'kneeling'],
        ['Per favore mettiti in ginocchio', 'kneeling'],
        ['Cambia posizione, inginocchiati', 'kneeling'],
    ])('%s → %s', (said, preset) => {
        expect(it(said)).toMatchObject({ kind: 'pose', preset });
    });

    test('standing and going back', () => {
        expect(it('Torna alla posizione precedente.')).toEqual({ kind: 'previous' });
        expect(it('Alzati.', { held: true })).toMatchObject({ kind: 'stand' });
        expect(it('Alzati.')).toBeNull();
        expect(it('Torna in piedi')).toMatchObject({ kind: 'stand', explicit: true });
    });

    test.each([
        ['Come prima, vorrei parlare del lavoro.'],
        ['Posa quel libro sul tavolo.'],
        ['Posizione aperta in azienda, che ne pensi?'],
        ['Mettiti in contatto con loro domani.'],
        ['Mettiti a ridere, dai.'],
        ['Piegati al volere degli altri non è da te.'],
        ['In piedi si sta meglio, dicono.'],
    ])('conversazione che comincia come una richiesta: %s', (said) => {
        expect(it(said, { held: true })).toBeNull();
        expect(it(said)).toBeNull();
    });

    test('bare "siediti" is left to the fast path', () => {
        expect(it('Siediti.')).toBeNull();
    });

    test('English is not read in an Italian session', () => {
        expect(it('Kneel down')).toBeNull();
        expect(it('Lie on your back')).toBeNull();
        expect(it('Go back to the previous position')).toBeNull();
    });
});

describe('the catalogue is the vocabulary', () => {
    test('every phrase in both tables names a preset the navigator has, and none of them is adult', () => {
        const all = navigatorPresets();
        for (const lang of ['en', 'it']) {
            for (const name of Object.keys(Commands.LANG[lang].phrases)) {
                const entry = all.find((p) => p.name === name);
                expect(entry).toBeTruthy();
                expect(entry.adult).toBe(false);
            }
        }
    });

    test('a phrase whose preset this session does not offer resolves to nothing', () => {
        const without = cat.filter((p) => p.name !== 'kneeling');
        const found = Commands.resolve('Kneel down', { catalogue: without, lang: 'en' });
        expect(found === null || found.kind !== 'pose' || found.preset !== 'kneeling').toBe(true);
    });

    test('an adult preset is never matched, by label or by name, even when the catalogue lists it', () => {
        const withAdult = navigatorPresets();
        for (const entry of withAdult.filter((p) => p.adult)) {
            for (const said of [
                entry.label,
                `get into the ${entry.label} pose`,
                `change your position to ${entry.label}`,
            ]) {
                const found = Commands.resolve(said, { catalogue: withAdult, lang: 'en' });
                expect(found && found.kind === 'pose' ? found.preset : null).not.toBe(entry.name);
            }
        }
    });

    test('a preset added to the catalogue can be asked for by its label with no change here', () => {
        const more = cat.concat([{ name: 'tPoseWide', label: 'Star Jump', category: 'Standing', adult: false }]);
        expect(Commands.resolve('get into the star jump pose', { catalogue: more, lang: 'en' })).toMatchObject({
            kind: 'pose',
            preset: 'tPoseWide',
        });
    });

    test('a one-word label is spoken with its category', () => {
        expect(en('Lie on your back').label).toBe('Lying Back');
        expect(en('Kneel down').label).toBe('Kneeling');
    });

    test('catalogueFrom keeps to what the pose system can apply now', () => {
        const win = {
            NEXUS_POSE_STUDIO_PANEL: { catalogue: () => cat },
            vrPoseSystem: { getPresetList: () => [{ name: 'kneeling' }, { name: 'lyingBack' }] },
        };
        expect(
            Commands.catalogueFrom(win)
                .map((p) => p.name)
                .sort()
        ).toEqual(['kneeling', 'lyingBack']);
    });

    test('the language is the app’s, and an unknown one falls back to English', () => {
        expect(Commands.langOf({ AppLanguage: { code: 'it-IT' } })).toBe('it');
        expect(Commands.langOf({ AppLanguage: { code: 'en-US' } })).toBe('en');
        expect(Commands.langKey('ja-JP')).toBe('en');
    });
});

describe('animations, against the clip map’s own registry', () => {
    const manifest = JSON.parse(
        require('fs').readFileSync(require('path').join(__dirname, '../../vendor/animations/manifest.json'), 'utf8')
    );
    let registry;
    let gestures;
    beforeAll(() => {
        ClipMap._setManifest(manifest);
        registry = ClipMap.registry();
        gestures = ClipMap.availableNames();
    });
    afterAll(() => ClipMap._setManifest(null));
    const clip = (text, lang) => Commands.resolveClip(text, { registry, gestures, lang: lang || 'en' });

    test('the registry is the manifest and the addon packs, each file once', () => {
        const paths = registry.map((c) => c.path);
        expect(new Set(paths).size).toBe(paths.length);
        const listed = Object.values(manifest.categories).reduce((n, c) => n + (c.files || []).length, 0);
        expect(registry.length).toBeGreaterThanOrEqual(listed);
        expect(paths).toContain('vendor/animations/dance/dance_rumba.bvh');
    });

    test('a clip is asked for by its name', () => {
        expect(clip('Play the Rumba animation.')).toMatchObject({ kind: 'clip', allowed: true, explicit: true });
        expect(clip('Play the Rumba animation.').path).toMatch(/dance_rumba\.(bvh|vrma)$/);
        expect(clip('Start the relaxing animation.')).toMatchObject({ path: 'vendor/animations/vrma/Relax.vrma' });
    });

    test('a mood the manifest maps is found without a second list', () => {
        const found = clip('Show me your happy animation.');
        expect(found.kind).toBe('clip');
        expect(manifest.emotionMapping.happy.map((f) => 'vendor/animations/' + f)).toContain(found.path);
    });

    test('an animation that is not installed is unknown, and a switched-off one says so', () => {
        expect(clip('Play the unicorn animation')).toEqual({ kind: 'unknown-clip', said: 'unicorn' });
        const off = registry.find((c) => !c.allowed);
        expect(off).toBeTruthy();
        const only = Commands.resolveClip(`play the ${off.name} animation`, { registry: [off], lang: 'en' });
        expect(only).toMatchObject({ kind: 'clip', allowed: false, why: off.why });
    });

    test('one that may play is preferred over one that is switched off under the same name', () => {
        const twins = [
            { path: 'a/dance_test.vrma', category: 'dance', allowed: false, why: 'quarantined' },
            { path: 'b/dance_test.bvh', category: 'dance', allowed: true, why: null },
        ];
        expect(Commands.resolveClip('play the test animation', { registry: twins, lang: 'en' }).path).toBe(
            'b/dance_test.bvh'
        );
    });

    test('repeat, next and idle', () => {
        expect(clip('Repeat that animation.')).toEqual({ kind: 'clip-repeat' });
        expect(clip('Play the next animation.')).toEqual({ kind: 'clip-next' });
        expect(clip('Go back to idle.')).toEqual({ kind: 'idle' });
    });

    test('a gesture the clip map offers is asked for in everyday words; one it does not offer is not', () => {
        expect(clip('Clap your hands.')).toEqual({ kind: 'gesture', name: 'clap' });
        expect(Commands.resolveClip('Clap your hands.', { registry, gestures: [], lang: 'en' })).toBeNull();
        expect(clip('Batti le mani', 'it')).toEqual({ kind: 'gesture', name: 'clap' });
        expect(clip('Batti le mani', 'en')).toBeNull();
    });

    test('ordinary talk names no clip', () => {
        expect(clip('I love to dance at weddings')).toBeNull();
        expect(clip('do you like rumba?')).toBeNull();
    });

    test('a named clip resolves through the clip map only if it is in the registry and may play', () => {
        expect(ClipMap.resolve('clip:vendor/animations/dance/dance_rumba.bvh')).toMatchObject({
            candidates: ['vendor/animations/dance/dance_rumba.bvh'],
            source: 'named',
        });
        expect(ClipMap.resolve('clip:vendor/animations/dance/not_there.bvh')).toBeNull();
        const off = registry.find((c) => c.why === 'quarantined');
        expect(ClipMap.resolve('clip:' + off.path)).toBeNull();
        return ClipMap.play('clip:' + off.path).then((res) => {
            expect(res.ok).toBe(false);
            expect(res.reason).toBe('clip_disabled:quarantined');
        });
    });
});

describe('MO14. a gesture asked for with the word "pose" is not a position', () => {
    test.each(['strike a pose', 'Strike a pose!', 'please strike a pose', 'pose for me', 'model pose', 'do a pose'])(
        '"%s" is left to the fast path (model_pose), not refused as an unknown position',
        (said) => {
            expect(en(said)).toBeNull();
        }
    );

    test.each(['fai una posa', 'posa da modella'])('Italian "%s" too, read with the Italian table', (said) => {
        expect(it(said)).toBeNull();
    });

    test('positions framed with "pose" still resolve, and unknown ones are still said so', () => {
        expect(en('Can you get into the lecturer pose')).toMatchObject({ kind: 'pose', preset: 'lecturerNeutral' });
        expect(en('do the flying squirrel pose')).toMatchObject({ kind: 'unknown-position' });
    });

    test('each table only knows its own language', () => {
        expect(it('strike a pose')).not.toEqual(expect.objectContaining({ kind: 'pose' }));
        expect(en('fai una posa')).not.toEqual(expect.objectContaining({ kind: 'pose' }));
    });
});
