/**
 * UN21. The adult directive's Italian transcript, in context, and the lifecycle around it: a
 * correction keeps the request it corrects; "poi" waits for what is under way; "aspetta" stops a
 * change, which stays stopped; the same words twice are one request; a model never cancels.
 *
 * Built on the UN20 harness below (header kept). UN20: every change request ends in exactly one of two ways: it happens, or she says its own
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

const last = () => Actions.snapshot().last || {};
const wardrobeLog = () => Actions.log().filter((a) => a.family === 'wardrobe');
const wornNames = (w) => w.controller.applyLook.mock.calls.map((c) => c[0].name);

/** Her looks list slowly, as in the page, so a change is still under way when the next words come. */
function slowLooks(ms) {
    const looks = [DRESS, LINGERIE];
    window.NEXUS_TRY_ON_HAUL_ACTIVITY.loadLooks = () =>
        new Promise((r) => setTimeout(() => r(looks.map((l) => ({ ...l }))), ms));
}
/** The lingerie file loads slowly, so "aspetta" lands while it is downloading. */
function slowApply(w, ms) {
    const real = w.controller.applyLook.getMockImplementation();
    w.controller.applyLook.mockImplementation((look) => new Promise((r) => setTimeout(() => r(real(look)), ms)));
}

describe('UN21. the reported Italian transcript, in context', () => {
    test('Togliti i vestiti → Poi togli tutto → Toglili tutti → corrections → Sì, fallo', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);

        // 1. One layer: lingerie, completed on the renderer's word (the controller's applyLook).
        await say('Togliti i vestiti.');
        await flush(30);
        expect(last()).toMatchObject({ name: 'wardrobe.undress', status: 'completed', params: { step: 'next' } });
        expect(Actions.snapshot().outfitState).toBe('lingerie');

        // 2. "Poi togli tutto": everything — no bare look exists, so refused with its reason,
        // and nothing else is put on in its place.
        await say('Poi togli tutto.');
        await flush(30);
        expect(last()).toMatchObject({ name: 'wardrobe.undress', status: 'failed', why: 'no-bare-look' });

        // 3. "Toglili tutti": the clothing is still the referent.
        await say('Toglili tutti.');
        await flush(30);
        expect(last()).toMatchObject({ name: 'wardrobe.undress', why: 'no-bare-look', params: { step: 'all' } });

        // 4–5. Corrections keep the request they correct; the prompt says she understood it.
        for (const said of ['Non intendevo un vestito più leggero.', 'Intendevo tutti i vestiti.']) {
            await say(said);
            await flush(30);
            expect(last()).toMatchObject({
                name: 'wardrobe.undress',
                status: 'failed',
                why: 'no-bare-look',
                params: { step: 'all', correction: true },
            });
            const prompt = Actions.promptLines().join('\n');
            expect(prompt).toMatch(/They corrected you: they meant taking off every piece of clothing/);
            expect(prompt).not.toMatch(/changing into something lighter right now/);
            const shown = Capability.outfitTruthful('Va bene, mi spoglio.', Actions.outfitTruth(), 'it-IT');
            expect(keyOf(shown, 'it-IT')).toBe('outfit.say.noBare');
        }

        // 6. "Sì, fallo" with nothing offered: nothing runs, and no substitute appears.
        const before = wardrobeLog().length;
        await say('Sì, fallo.');
        await flush(30);
        expect(wardrobeLog()).toHaveLength(before);
        // Lingerie was put on once, for "Togliti i vestiti", and never in place of "everything".
        expect(wornNames(w).filter((n) => n === 'Black Lingerie Set')).toHaveLength(1);
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        expect(w.adult.level).toBe(4); // nothing here moves the consent level
    });

    test('the same evening in English', async () => {
        await at(4, 'en-US');
        await say('Put on the black cocktail dress');
        await flush(30);
        await say('Take your clothes off.');
        await flush(30);
        expect(last()).toMatchObject({ name: 'wardrobe.undress', status: 'completed' });
        for (const said of [
            'Take everything off.',
            'Remove all your clothes.',
            'I mean everything.',
            'Not just a lighter outfit.',
            "Don't switch to a different outfit.",
            'All of them.',
        ]) {
            const before = wardrobeLog().length;
            await say(said);
            await flush(30);
            // Its own action, not the previous one still showing as the last.
            expect(wardrobeLog()).toHaveLength(before + 1);
            expect(last()).toMatchObject({ name: 'wardrobe.undress', why: 'no-bare-look', params: { step: 'all' } });
        }
        expect(Actions.snapshot().outfitState).toBe('lingerie');
    });

    test('a correction with nothing to correct, a negation, an observation and a question run nothing', async () => {
        await at(4, 'it-IT');
        for (const said of [
            'Intendevo tutti i vestiti.',
            'Tutti.',
            'Non toglierti i vestiti.',
            'Pensavo che ti saresti spogliata.',
            'Ti spoglieresti per me?',
        ]) {
            const before = wardrobeLog().length;
            await say(said);
            await flush(30);
            expect(wardrobeLog()).toHaveLength(before);
        }
    });

    test('Rivestiti / Torna come eri prima / Rimettiti quello di prima put her own outfit back', async () => {
        await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        await say('Togliti i vestiti.');
        await flush(30);
        await say('Torna come eri prima.');
        await flush(30);
        expect(last()).toMatchObject({ name: 'wardrobe.redress', status: 'completed' });
        expect(Actions.snapshot().outfitState).not.toBe('lingerie');
        await say('Rimettiti quello di prima.');
        await flush(30);
        expect(last().name).toBe('wardrobe.undo');
    });
});

describe('UN21. the lifecycle: wait, then, twice, and who may stop', () => {
    test('"Aspetta un momento" while the lingerie loads: cancelled, never lands, stays cancelled', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        slowApply(w, 400);
        await say('Togliti i vestiti.');
        await flush();
        const undress = last();
        expect(undress).toMatchObject({ name: 'wardrobe.undress', status: 'pending' });
        await say('Aspetta un momento.');
        await flush();
        expect(last()).toMatchObject({ name: 'wardrobe.cancel', status: 'completed' });
        expect(undress.status).toBe('cancelled');
        // The stand-in controller has no `cancel()` (the real WardrobeController aborts the
        // download), so the late file lands and the stale path takes it off again: give that
        // second, equally slow, load time to finish before reading her final state.
        await new Promise((r) => setTimeout(r, 1300));
        await flush(30);
        // The handler unwinding later cannot rewrite it as stale, failed or completed.
        expect(undress.status).toBe('cancelled');
        expect(Actions.snapshot().outfitState).not.toBe('lingerie');
        expect(wornNames(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        const shown = Capability.outfitTruthful('Va bene, me li tolgo.', Actions.outfitTruth(), 'it-IT');
        expect(keyOf(shown, 'it-IT')).toBeNull();
        expect(shown).toBe(Locale.t('outfit.say.cancelled', null, 'it-IT'));
        expect(Actions.promptLines().join('\n')).toMatch(/They asked you to wait, so the change under way was stopped/);
        expect(w.adult.level).toBe(4);
    });

    test('"Aspetta" with nothing under way is conversation; "stop" stays ConsentFlow’s exit', async () => {
        await at(4, 'en-US');
        const before = wardrobeLog().length;
        await say('Wait a moment.');
        await flush(30);
        expect(wardrobeLog()).toHaveLength(before);
        expect(Intent.parse('Stop.', { wardrobePending: true })).toBeNull();
    });

    test('"Poi togli tutto" while a change is under way waits for it instead of replacing it', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        slowApply(w, 300);
        await say('Togliti i vestiti.');
        await flush();
        const first = last();
        expect(first.status).toBe('pending');
        await say('Poi togli tutto.');
        await flush();
        expect(Actions.promptLines().join('\n')).toMatch(/next change after the one under way/);
        await new Promise((r) => setTimeout(r, 700));
        await flush(30);
        // The first change landed (it was not superseded), then "everything" was asked for.
        expect(first.status).toBe('completed');
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        expect(last()).toMatchObject({ name: 'wardrobe.undress', why: 'no-bare-look' });
    });

    test('the same words twice while the first is still running are one request', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        slowApply(w, 300);
        const before = w.controller.applyLook.mock.calls.length;
        Surface.renderUser('Togliti i vestiti.'); // the recogniser's final result
        Surface.renderUser('Togliti i vestiti'); // and the composer, a moment later
        await new Promise((r) => setTimeout(r, 600));
        await flush(30);
        expect(w.controller.applyLook.mock.calls.length - before).toBe(1);
        expect(wardrobeLog().filter((a) => a.name === 'wardrobe.undress')).toHaveLength(1);
    });

    test('her tag never stops a change the person asked for', () => {
        expect(
            Policy.decide(
                { name: 'wardrobe.cancel', source: 'model', params: {} },
                { active: true, asked: { wardrobe: true } }
            )
        ).toMatchObject({ allow: false, why: 'user-only' });
        expect(
            Policy.decide({ name: 'wardrobe.cancel', source: 'user', params: {} }, { active: true, care: true })
        ).toMatchObject({ allow: true });
    });

    test('"Sì, fallo" / "Yes, do it" / "Do it now" approve a real offer', () => {
        for (const yes of ['Sì, fallo.', 'Fallo adesso.', 'Yes, do it.', 'Do it now.', 'Sì'])
            expect(Intent.affirms(yes)).toBe(true);
        expect(Intent.affirms('Sì, ma prima dimmi una cosa')).toBe(false);
    });
});

describe('UN21. no scripted line while their command is still executing', () => {
    test('a slow change keeps the guided beats and the idle clock quiet, then quiet counts from its end', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        slowApply(w, 400);
        await say('Togliti i vestiti.');
        await flush();
        expect(Actions.busy()).toBe(true);
        const session = w.session;
        // Long past the lull the script waits for: still not quiet, and the idle clock is busy.
        const realNow = session.now.bind(session);
        session.now = () => realNow() + 10 * 60 * 1000;
        expect(session._quietEnough()).toBe(false);
        expect(session._idleBusy()).toBe(true);
        session.now = realNow;
        await new Promise((r) => setTimeout(r, 600));
        await flush(30);
        expect(Actions.busy()).toBe(false);
        // Quiet is counted from the last moment their command was still running, not from her reply.
        const seen = session._actionBusyAt;
        expect(seen).toBeGreaterThan(0);
        expect(session._lastActivityAt()).toBeGreaterThanOrEqual(seen);
    });
});

describe('UN21. the level the person chose does not decay while they are typing', () => {
    test('typed turns are activity for ConsentFlow’s cool-down; real silence still cools it', async () => {
        const w = await at(4, 'it-IT');
        const flow = w.adult;
        const start = flow.lastInputAt === null ? Date.now() : flow.lastInputAt;
        // Six minutes of typed conversation, one line a minute: no decay.
        for (let i = 1; i <= 6; i += 1) {
            const t = start + i * 60000;
            flow.now = () => t;
            await say(`Ti racconto una cosa, parte ${i}.`);
            await flush();
            expect(flow.tick(t)).toBeNull();
            expect(flow.level).toBe(4);
        }
        // Then five minutes and more of nothing: the cool-down applies exactly as before.
        const later = start + 6 * 60000 + 300001;
        expect(flow.tick(later)).toMatchObject({ action: 'decayed', from: 4 });
        expect(flow.level).toBe(1);
    });

    test('noteActivity moves no level and reads no words — exits stay hear()’s', () => {
        const flow = ConsentFlow.attach({
            bus: null,
            blackboard: {},
            modes: { activate: () => true, deactivate: () => true },
            profile: AdultProfile,
            recorder: null,
            say: null,
        });
        expect(flow.noteActivity()).toBe(false); // not active: nothing to keep alive
    });
});

describe('UN21. yes / wait chips only under a real offer', () => {
    test('with nothing offered, "Sì, fallo" and "Aspetta un momento" leave her choices', async () => {
        const w = await at(4, 'it-IT');
        await say('Ciao, come stai?');
        await flush();
        w.session._stashChoices(['Sì, fallo', 'Aspetta un momento', 'Raccontami di più', 'Mi piace']);
        await Capability.privateRevise('Bene, sono qui con te.', { win: window, userText: 'Ciao, come stai?' });
        expect(w.session._pendingChoices).toEqual(['Raccontami di più', 'Mi piace']);
        // Only yes / wait left: the local set stands in rather than a lone button.
        w.session._stashChoices(['Yes, do it', 'Wait a moment']);
        await Capability.privateRevise('Mm.', { win: window, userText: 'Ciao, come stai?' });
        expect(w.session._pendingChoices).toEqual([]);
    });
});

describe('UN21. a reply that was only a false outfit sentence is never shown (found on the phone)', () => {
    test('nothing true left, asking again gives the same: she says what she really has on', async () => {
        const w = await at(4, 'it-IT');
        await say('Mettiti il vestito da cocktail nero');
        await flush(30);
        await say('Aspetta un momento.'); // nothing under way: conversation, not a cancel
        await flush();
        expect(Actions.outfitTruth()).toMatchObject({ state: 'none', asked: false });
        const draft = 'Va bene, me li tolgo lo stesso.';
        window._nexusLLM = { sendMessage: async () => draft }; // the model insists
        const shown = await Capability.privateRevise(draft, { win: window, userText: 'Aspetta un momento.' });
        expect(shown).not.toBe('');
        expect(shown).not.toMatch(/tolgo/);
        expect(shown).toBe(Locale.t('outfit.say.current', { name: 'Black Cocktail Dress' }, 'it-IT'));
        delete window._nexusLLM;
        expect(w.adult.level).toBe(4);
    });
});
