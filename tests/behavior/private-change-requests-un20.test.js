/**
 * UN20. Every change request ends in exactly one of two ways: it happens, or she says its own
 * reason. Reported (it-IT, Private, level 4): "poi togliete i vestiti" took a layer off, then
 * "Toglili tutti" parsed as nothing and the person was shown "Per ora resto come sono." — the same
 * line that had already opened the transcript with nothing asked — under "Sì, fallo / Aspetta un
 * momento" chips that offered nothing. Same harness as private-actions.test.js: the real session,
 * view, ConsentFlow, TryOnSession and bridge; only what leaves the page is a stand-in.
 *
 * Assertions are by outcome and reason, never by a sentence: the per-reason line is identified by
 * its locale key, so rewording a line cannot break these and a wrong line cannot pass them.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const MediaSession = require('../../src/features/together/MediaSession.js');
const PlayDirective = require('../../src/features/together/PlayDirective.js');
const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
const Policy = require('../../src/experiences/private/PrivateActionPolicy.js');
const Actions = require('../../src/experiences/private/PrivateActionBridge.js');
require('../../src/experiences/private/OutfitDecisionEngine.js');
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
require('../../src/wardrobe/TryOnPrivate.js');
const WardrobeTool = require('../../src/wardrobe/WardrobeTool.js');
const ReplyClean = require('../../src/features/chat/ReplyClean.js');

Capability.installPrivateRuntime(PlaygroundActivity);

const flush = async (n = 12) => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < n; i += 1) await Promise.resolve();
};

const LOOKS = [
    { lookId: 'l1', name: 'Yellow sundress', tags: ['summer', 'dress'], vrmUrl: 'sundress.vrm' },
    { lookId: 'l2', name: 'Black evening gown', tags: ['elegant', 'evening'], vrmUrl: 'gown.vrm' },
    { lookId: 'l3', name: 'Hoodie & jeans', tags: ['casual', 'cozy'], vrmUrl: 'hoodie.vrm' },
];

const STAND_INS = [
    'NEXUS_MEDIA_SESSION',
    'NEXUS_DISCOVERY',
    'NEXUS_MEDIA_INTENT',
    'NEXUS_DISCOVERY_SAMPLES',
    'NEXUS_YT_2D',
    'NEXUS_WARDROBE',
    'NEXUS_TRY_ON_SESSION',
    'NEXUS_TRY_ON_GENERATOR',
    'NEXUS_AVATAR_IDENTITY',
    'NEXUS_TRY_ON_HAUL_ACTIVITY',
    'NEXUS_OUTFIT_DICTIONARY',
    'NEXUS_SPICY',
    'NEXUS_MOTION',
    'NEXUS_INTENT_FASTPATH',
    'NEXUS_BD',
    'NEXUS_BD_SAY',
    'NEXUS_PRIVATE_TIMING_SCALE',
    'AppLanguage',
    'vrPoseSystem',
];

/** The page a Private session runs on: a search provider, a player, a wardrobe. */
function world(options) {
    const o = options || {};
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge' }));
    MediaSession.reset();
    window.NEXUS_MEDIA_SESSION = MediaSession;
    const search = jest.fn(async (query) =>
        o.results !== undefined
            ? o.results
            : [
                  {
                      id: `v-${query}-1`,
                      title: `${query} — Around the World`,
                      creator: 'Official',
                      url: 'https://example.invalid/1',
                  },
                  {
                      id: `v-${query}-2`,
                      title: `${query} — Second`,
                      creator: 'Official',
                      url: 'https://example.invalid/2',
                  },
              ]
    );
    window.NEXUS_DISCOVERY = o.noProvider
        ? { warm: async () => {}, forCapability: () => null }
        : { warm: async () => {}, forCapability: () => ({ search }) };
    // PX9. The page's own search path (MediaIntent) and its keyless song, as Together uses them.
    if (o.samples) {
        window.NEXUS_MEDIA_INTENT = require('../../src/features/together/MediaIntent.js');
        window.NEXUS_DISCOVERY_SAMPLES = require('../../src/features/discovery/samples.js');
    }
    // The embed: a card, and — when `activate` runs — the handle the IFrame API would attach.
    const handle = {
        pause: jest.fn(() => true),
        resume: jest.fn(() => true),
        stopVideo: jest.fn(() => true),
        setVolume: jest.fn(() => true),
        stop: jest.fn(),
    };
    window.NEXUS_YT_2D = {
        buildCard: (video, { doc }) => {
            const card = doc.createElement('div');
            card.className = 'nexus-yt-card';
            card.dataset.ytId = video.id;
            return card;
        },
        activate: jest.fn((card) => {
            card._nexusPlayback = handle;
        }),
    };
    // The wardrobe, as `index.html` leaves it on the window.
    let worn = { url: 'base.vrm', name: 'Base' };
    const controller = {
        original: null,
        avatarManager: { getCurrent: () => ({ ...worn }) },
        snapshot() {
            this.original = { ...worn };
            return this.original;
        },
        applyLook: jest.fn(async (look) => {
            if (o.loadFails) throw new Error('That look could not be loaded.');
            worn = { url: look.vrmUrl, name: look.name };
            return look;
        }),
        restore: jest.fn(async () => {
            worn = { url: 'base.vrm', name: 'Base' };
            return true;
        }),
    };
    const create = jest.fn(async (prompt) => ({
        lookId: `made-${prompt}`,
        name: 'Made look',
        vrmUrl: 'made.vrm',
        source: 'forge',
    }));
    class Generator {
        constructor() {
            this.library = {
                available: !o.noForge,
                library: async () => [{ slug: 'ava', depictsAdult: o.adult === true }],
            };
            this.create = create;
        }
        availability() {
            return { ok: !o.noForge, why: '' };
        }
        identity() {
            return { kind: 'library', slug: 'ava', name: 'Ava' };
        }
    }
    const entries = [
        {
            id: 'little-black-dress',
            title: 'Little black dress',
            tags: ['elegant'],
            request: { prompt: 'little black dress' },
            private: false,
        },
        { id: 'lace-set', title: 'Lace set', tags: ['sexy'], request: { prompt: 'black lace set' }, private: true },
    ];
    const dictionary = {
        load: async () => {},
        entries: ({ privateOpen }) => entries.filter((e) => privateOpen || !e.private),
        find: (id, { privateOpen }) => entries.find((e) => e.id === id && (privateOpen || !e.private)) || null,
    };
    const loadLooks = jest.fn(async () => (o.looks !== undefined ? o.looks : LOOKS).map((l) => ({ ...l })));
    Object.assign(window, {
        NEXUS_WARDROBE: { service: { controller } },
        NEXUS_TRY_ON_SESSION: { TryOnSession },
        NEXUS_TRY_ON_GENERATOR: { TryOnGenerator: Generator },
        NEXUS_AVATAR_IDENTITY: { resolve: () => ({ kind: 'library', slug: 'ava', name: 'Ava' }) },
        NEXUS_TRY_ON_HAUL_ACTIVITY: { loadLooks },
        NEXUS_OUTFIT_DICTIONARY: { forPage: () => dictionary },
        NEXUS_SPICY: { isEnabled: () => true, usable: () => true },
    });
    const execute = jest.fn();
    window.NEXUS_MOTION = { execute };
    window.NEXUS_INTENT_FASTPATH = { match: () => null };

    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0 };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = {
        active: 'intimate',
        activeActivity: 'intimate',
        stopActivity: jest.fn(),
        startActivity: jest.fn(),
        open: jest.fn(),
    };
    window.NEXUS_BD = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    Surface.configure({ addMessage: () => {}, beginStream: () => null, scroll: () => {} });
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({ bus, adult, capability: () => ({ ok: true }) });
    window.NEXUS_BD.intimate = activity;
    return { activity, adult, panel, search, handle, controller, create, loadLooks, execute };
}

async function begin(options) {
    const w = world(options);
    await w.activity.start({ input: { id: 'sensual' } });
    w.session = w.activity._privateExperience;
    return w;
}

/** The person says something, the way the composer delivers it. */
async function say(text) {
    Surface.renderUser(text);
    await flush();
}

const row = () => document.getElementById('nexus-private-conversation-row');
const strip = () => document.querySelector('[data-private-soundtrack]');
const chip = () => document.querySelector('.nexus-private-outfit');

beforeEach(() => {
    jest.useRealTimers();
    localStorage.clear();
    Surface.reset();
});

afterEach(() => {
    const live = window.NEXUS_BD && window.NEXUS_BD.intimate;
    try {
        if (live && live.active) live.stop('user');
    } catch (_) {
        /* a session that would not stop is the test's own failure */
    }
    Actions.end();
    Surface.reset();
    // Only what `world()` put there: the modules under test define their own globals when they
    // load, and the session finds the conversation surface through one of them.
    for (const k of STAND_INS) delete window[k];
    document.body.innerHTML = '';
});

const fs = require('fs');
const Locale = require('../../src/features/together/PrivateLocale.js');
const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');

const DRESS = { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' };
const LINGERIE = {
    lookId: 'g',
    name: 'Black Lingerie Set',
    prompt: 'black Lingerie Set',
    vrmUrl: 'garter.vrm',
    private: true,
};
const PLACES = [
    { id: 'neon-discoteca', world: 'neon-discoteca', title: 'Neon discoteca', rating: 'general' },
    { id: 'hotel-suite', world: 'hotel-suite', title: 'Hotel suite', rating: 'romantic' },
    { id: 'meadow-sunset', world: 'meadow-sunset', title: 'Meadow at sunset', rating: 'general' },
];

function poseSystem() {
    const presets = ['kneeling', 'lyingBack', 'lyingFront', 'lyingSide', 'standingBendForward'];
    let current = 'standing';
    return {
        claimBones: () => true,
        releaseBones: () => true,
        applyPreset: (name) => {
            if (presets.includes(name)) current = name;
        },
        getCurrentPreset: () => current,
        getPresetList: () => presets.map((name) => ({ name })),
    };
}

/** A real session at `level`, in `lang`, wearing the dress — the reported starting point. */
async function at(level, lang, extra) {
    window.vrPoseSystem = poseSystem();
    const w = await begin({ adult: true, looks: [DRESS, LINGERIE], ...(extra || {}) });
    window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
    window.AppLanguage = { code: lang };
    // Places this device can show, so a trip is a real request and not "no renderer".
    Actions.end();
    Actions.begin(w.session, {
        win: window,
        deps: { story: { places: PLACES, current: 'neon-discoteca', canTravel: true } },
    });
    w.adult.level = level;
    return w;
}

/** The line for a locale key, as `outfitTruthful` would show it, so a shown line names its reason. */
function keyOf(text, lang) {
    if (!text) return null;
    const control = String(Locale.t('controls.closer', null, lang) || '')
        .replace(/\s*[→>]+\s*$/u, '')
        .trim();
    for (const key of [
        'outfit.say.noBare',
        'outfit.say.lastLayer',
        'outfit.say.pace',
        'outfit.say.alreadyDressed',
        'outfit.say.nothingToUndo',
        'outfit.say.failed',
        'outfit.say.offer',
        'outfit.say.none',
    ]) {
        const line = Locale.t(key, { control }, lang);
        if (line && text.includes(line)) return key;
    }
    return null;
}

/**
 * What the person sees after asking: the bridge's verdict, and the reply check applied to the
 * worst plausible draft — one that claims the change happened ("Fatto." + a claim).
 */
function shown(lang) {
    const draft = lang.startsWith('it') ? 'Va bene, me li tolgo tutti per te.' : "Okay, I'm taking it all off for you.";
    const text = Capability.outfitTruthful(draft, Actions.outfitTruth(), lang);
    return { text, key: keyOf(text, lang) };
}

const REQUESTS = {
    'it-IT': {
        dress: 'Mettiti il vestito da cocktail nero',
        undressOne: 'poi togliete i vestiti',
        undressAll: 'Toglili tutti',
        redress: 'Rivestiti',
        pose: 'Inginocchiati',
        place: 'Andiamo alla Hotel suite',
        music: 'Metti un po’ di musica jazz',
    },
    'en-US': {
        dress: 'Put on the black cocktail dress',
        undressOne: 'Take off your dress',
        undressAll: 'Take them all off',
        redress: 'Get dressed again',
        pose: 'Kneel down',
        place: "Let's go to the Hotel suite",
        music: 'Play some jazz music',
    },
};

/** One evening at `level` in `lang`, every request in order: a row per request. */
async function evening(level, lang) {
    const w = await at(level, lang);
    const rows = [];
    const ask = async (kind) => {
        const said = REQUESTS[lang][kind];
        await say(said);
        await flush(30);
        const last = Actions.snapshot().last || {};
        const truth = Actions.outfitTruth();
        const view = last.family === 'wardrobe' ? shown(lang) : { text: '', key: null };
        rows.push({
            level,
            lang,
            kind,
            said,
            action: last.name || null,
            status: last.status || null,
            why: last.why || null,
            outfit: Actions.snapshot().outfitState,
            truth: truth.state,
            key: view.key,
            text: view.text,
        });
    };
    await say('Ciao'); // the reported transcript opened with an unrelated turn
    await flush();
    await ask('dress');
    await ask('undressOne');
    await ask('undressAll');
    await ask('redress');
    await ask('pose');
    await ask('place');
    await ask('music');
    return { w, rows };
}

describe('UN20. the reported transcript, as the person sees it', () => {
    test('it-IT level 4: one layer comes off; "Toglili tutti" says why, never "Per ora resto come sono."', async () => {
        await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        await say('poi togliete i vestiti');
        await flush(30);
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.undress', status: 'completed' });
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        await say('Toglili tutti');
        await flush(30);
        // It is a request (it used to parse as nothing), for everything, and it is refused for
        // its real reason: no bare look. Nothing else is put on in its place (UN19).
        expect(Actions.snapshot().last).toMatchObject({
            name: 'wardrobe.undress',
            status: 'failed',
            why: 'no-bare-look',
            params: { step: 'all' },
        });
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        const none = Locale.t('outfit.say.none', null, 'it-IT');
        for (const draft of ['Le tolgo tutte per te.', 'Va bene. Ti piace?', 'Indosso ancora il mio intimo.']) {
            const text = Capability.outfitTruthful(draft, Actions.outfitTruth(), 'it-IT');
            expect(keyOf(text, 'it-IT')).toBe('outfit.say.noBare');
            expect(text).not.toContain(none);
            expect(text).not.toMatch(/\bnuda\b(?![^.]*non)/i.test(text) ? /$^/ : /$^/);
        }
        // Her own words already giving the reason stand alone: never two answers.
        const own = 'Mi piacerebbe, ma con questo corpo non posso ancora. Resto così con te?';
        expect(Capability.outfitTruthful(own, Actions.outfitTruth(), 'it-IT')).toBe(own);
        // And the prompt tells her the reason and what she can offer instead.
        const prompt = Actions.promptLines().join('\n');
        expect(prompt).toMatch(/fully bare is not available for this body/);
        expect(prompt).toMatch(/what you can do instead/);
        expect(prompt).not.toMatch(/your lingerie or another/); // she is already in it
    });

    test('a reply to a turn that was not about clothes gets no outfit line (the stray opener)', async () => {
        await at(4, 'it-IT');
        await say('Ciao, come stai?');
        await flush();
        const truth = Actions.outfitTruth();
        expect(truth).toMatchObject({ state: 'none', asked: false });
        // A true description stays only if it is not a claim; a claim is taken out — and nothing
        // about an outfit action is put in its place.
        const text = Capability.outfitTruthful('Bene! Stasera indosso il mio vestito preferito.', truth, 'it-IT');
        expect(keyOf(text, 'it-IT')).toBeNull();
        expect(text).toBe('Bene!');
        // The whole reply a false claim: empty, so privateRevise asks once more instead.
        expect(Capability.outfitTruthful('Mi tolgo il vestito.', truth, 'it-IT')).toBe('');
    });

    test('they talked about clothes and nothing ran: the "nothing changed yet" line, and only then', async () => {
        await at(4, 'en-US');
        await say('I love your clothes tonight');
        await flush();
        const truth = Actions.outfitTruth();
        expect(truth).toMatchObject({ state: 'none', asked: true });
        expect(keyOf(Capability.outfitTruthful("I'm wearing my red dress now.", truth, 'en-US'), 'en-US')).toBe(
            'outfit.say.none'
        );
    });
});

describe('UN20. one line per outcome, in every language', () => {
    const LANGS = Locale.supported
        ? Locale.supported()
        : ['en-US', 'it-IT', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];
    const OUTCOMES = {
        'no-bare-look': 'outfit.say.noBare',
        'last-layer': 'outfit.say.lastLayer',
        pace: 'outfit.say.pace',
        'already-dressed': 'outfit.say.alreadyDressed',
        'nothing-to-undo': 'outfit.say.nothingToUndo',
        'no-match': 'outfit.say.failed',
    };
    test.each(Object.entries(OUTCOMES))('%s → %s', (why, key) => {
        for (const lang of LANGS) {
            const text = Capability.outfitTruthful('Fatto, me lo tolgo.', { state: 'failed', why, asked: true }, lang);
            expect(keyOf(text, lang)).toBe(key);
        }
    });
    test('every outcome line is distinct within each language, and the pace line names the control', () => {
        for (const lang of LANGS) {
            const lines = Object.values(OUTCOMES).map((k) => Locale.t(k, { control: 'X' }, lang));
            expect(new Set(lines).size).toBe(lines.length);
            for (const line of lines) expect(line).not.toMatch(/^outfit\./);
            const control = String(Locale.t('controls.closer', null, lang)).replace(/\s*[→>]+\s*$/u, '');
            const pace = Capability.outfitTruthful('', { state: 'failed', why: 'pace', asked: true }, lang);
            expect(pace).toContain(control);
        }
    });
    test('a tag of hers that was refused is not answered with a reason nobody asked for', () => {
        const draft = 'Ti guardo e sorrido.';
        expect(Capability.outfitTruthful(draft, { state: 'failed', why: 'pace', asked: false }, 'it-IT')).toBe(draft);
    });
});

describe('UN20. chips only under a real offer', () => {
    test('a refused request keeps none of the draft’s choices; a pending offer keeps the yes / not now', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        await say('Toglili tutti');
        await flush(30);
        w.session._stashChoices(['Sì, fallo', 'Aspetta un momento']);
        window.AppLanguage = { code: 'it-IT' };
        await Capability.privateRevise('Va bene, li tolgo tutti.', { win: window, userText: 'Toglili tutti' });
        expect(w.session._pendingChoices).toEqual([]);
        // A reply nobody needed to change keeps its choices.
        await say('Ciao');
        await flush();
        w.session._stashChoices(['Mm.', 'Raccontami']);
        await Capability.privateRevise('Ciao, sono qui.', { win: window, userText: 'Ciao' });
        expect(w.session._pendingChoices).toEqual(['Mm.', 'Raccontami']);
    });
});

describe('UN20. every change request at levels 1 to 4, in Italian and in English', () => {
    const all = [];
    afterAll(() => {
        if (process.env.UN20_MATRIX_OUT) fs.writeFileSync(process.env.UN20_MATRIX_OUT, JSON.stringify(all, null, 1));
    });
    for (const lang of ['it-IT', 'en-US'])
        for (const level of [1, 2, 3, 4])
            test(`${lang} level ${level}`, async () => {
                const { rows } = await evening(level, lang);
                all.push(...rows);
                const row = (kind) => rows.find((r) => r.kind === kind);
                // Every request is understood as the action it names.
                expect(row('dress').action).toBe('wardrobe.wear');
                expect(row('undressOne').action).toBe('wardrobe.undress');
                expect(row('undressAll').action).toBe('wardrobe.undress');
                expect(row('redress').action).toBe('wardrobe.redress');
                expect(row('pose').action).toBe('avatar.pose');
                expect(row('place').action).toBe('world.travel');
                expect(row('music').action).toBe('music.play');
                // Available and permitted at every level: it happens.
                expect(row('dress').status).toBe('completed');
                expect(row('pose').status).toBe('completed');
                expect(['pending', 'completed']).toContain(row('place').status);
                expect(['pending', 'completed']).toContain(row('music').status);
                if (level >= 4) {
                    expect(row('undressOne')).toMatchObject({ status: 'completed', outfit: 'lingerie' });
                    // No bare look exists: refused, with its own reason, lingerie kept.
                    expect(row('undressAll')).toMatchObject({
                        status: 'failed',
                        why: 'no-bare-look',
                        outfit: 'lingerie',
                    });
                    expect(row('undressAll').key).toBe('outfit.say.noBare');
                    expect(row('redress').status).toBe('completed');
                } else {
                    // Below the top of the pace: refused for the pace, said as such, never moved.
                    for (const kind of ['undressOne', 'undressAll']) {
                        expect(row(kind)).toMatchObject({ status: 'blocked', why: 'pace' });
                        expect(row(kind).key).toBe('outfit.say.pace');
                    }
                    expect(row('redress')).toMatchObject({ status: 'failed', why: 'already-dressed' });
                    expect(row('redress').key).toBe('outfit.say.alreadyDressed');
                }
                // Never the catch-all line for an outcome that has its own.
                for (const r of rows) expect(r.key).not.toBe('outfit.say.none');
            });
});

describe('UN20. the reply is checked against the outcome, not against "in progress" (found in the real page)', () => {
    async function slowCloset(level) {
        const w = await at(level, 'it-IT');
        // Her looks take a moment to list, as in the page: the request is pending when her reply
        // is written.
        const looks = [DRESS, LINGERIE];
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.loadLooks = () =>
            new Promise((r) => setTimeout(() => r(looks.map((l) => ({ ...l }))), 300));
        const spoken = [];
        const speak = w.session._speak.bind(w.session);
        w.session._speak = (line, o) => {
            spoken.push(line);
            return speak(line, o);
        };
        return { w, spoken };
    }

    test('"Toglili tutti" pending: never "something lighter"; the reason is shown once, by the reply', async () => {
        const { spoken } = await slowCloset(4);
        await say('Toglili tutti');
        expect(Actions.outfitTruth().state).toBe('pending');
        const prompt = Actions.promptLines().join('\n');
        expect(prompt).not.toMatch(/changing into something lighter/);
        expect(prompt).toMatch(/never offer something lighter instead/);
        const shownLine = await Capability.privateRevise('Le tolgo tutte per te.', {
            win: window,
            userText: 'Toglili tutti',
        });
        expect(Actions.snapshot().last).toMatchObject({ status: 'failed', why: 'no-bare-look' });
        expect(keyOf(shownLine, 'it-IT')).toBe('outfit.say.noBare');
        await flush(30);
        // The generic follow-up ("Mm, non è andata. Per ora resto così.") is not said, and the
        // reason is not said a second time.
        const followup = Locale.t('followup.outfit', null, 'it-IT');
        expect(spoken.filter((l) => l === followup)).toEqual([]);
        expect(spoken.filter((l) => keyOf(l, 'it-IT') === 'outfit.say.noBare')).toEqual([]);
    });

    test('when the reply check never runs, the follow-up still says the reason — its own, once', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
        const { spoken } = await slowCloset(4);
        await Surface.renderUser('Toglili tutti');
        Actions.promptLines();
        await jest.advanceTimersByTimeAsync(1000);
        expect(Actions.snapshot().last).toMatchObject({ status: 'failed', why: 'no-bare-look' });
        expect(spoken.filter((l) => keyOf(l, 'it-IT') === 'outfit.say.noBare')).toEqual([]); // still held
        await jest.advanceTimersByTimeAsync(15000);
        expect(spoken.filter((l) => keyOf(l, 'it-IT') === 'outfit.say.noBare')).toHaveLength(1);
        expect(spoken).not.toContain(Locale.t('followup.outfit', null, 'it-IT'));
        jest.useRealTimers();
    });
});
