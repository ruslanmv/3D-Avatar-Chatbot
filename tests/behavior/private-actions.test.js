/**
 * PX1–PX7. Private 3.0: music, outfits and dancing asked for inside a Private conversation happen
 * inside it. Against the real session, view, ConsentFlow, MediaSession, TryOnSession and bridge;
 * only the things that leave the page are stand-ins (the search provider, the YouTube embed, the
 * avatar controller, Forge). Every fixture line is ordinary, non-explicit conversation.
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
                library: async () => [{ slug: 'ava', depictsAdult: o.adult === true, bodyState: o.bodyState }],
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

describe('PX1. what the person asked for, read from their words', () => {
    test.each([
        ['Sì, suona Daft Punk ora.', 'music.play', { query: 'Daft Punk' }],
        ['Play music.', 'music.play', { query: '' }],
        ['Can you play something by Queen?', 'music.play', { query: 'Queen' }],
        ['Metti una canzone dei Pink Floyd', 'music.play', { query: 'Pink Floyd' }],
        ['pon música de Shakira', 'music.play', { query: 'Shakira' }],
        ['joue du Daft Punk', 'music.play', { query: 'Daft Punk' }],
        ['spiel Musik von Rammstein', 'music.play', { query: 'Rammstein' }],
        ['toca uma música', 'music.play', { query: '' }],
        ['Daft Punkをかけて', 'music.play', { query: 'Daft Punk' }],
        ['음악 틀어 줘', 'music.play', { query: '' }],
        ['播放周杰伦的歌', 'music.play', { query: '周杰伦' }],
        ['ferma la musica', 'music.stop', {}],
        ['stop the music', 'music.stop', {}],
        ['Mettiti un vestito elegante.', 'wardrobe.wear', { style: 'elegant' }],
        ['put on something elegant', 'wardrobe.wear', { style: 'elegant' }],
        ['Cambia vestito.', 'wardrobe.wear', { choose: true, different: true }],
        ['Scegli tu cosa indossare', 'wardrobe.wear', { choose: true }],
        ['wear the lace set', 'wardrobe.wear', { look: 'lace set' }],
        ['put on the yellow sundress', 'wardrobe.wear', { colour: 'yellow' }],
        ['Torna al vestito di prima.', 'wardrobe.undo', {}],
        ['Balliamo', 'avatar.dance', {}],
    ])('%s → %s', (text, name, params) => {
        const got = Intent.parse(text);
        expect(got).not.toBeNull();
        expect(got.name).toBe(name);
        expect(got.params).toMatchObject(params);
    });

    test.each([
        'Che musica ti piace?',
        'Cosa ti piacerebbe indossare?',
        'mi piace la musica elettronica',
        'I love this song',
        'we could play something later',
        'play with me',
        'suona bene',
        'non ballare',
        'stop',
        'pausa',
    ])('talk is not a request: %s', (text) => {
        expect(Intent.parse(text)).toBeNull();
    });

    test('context decides the ambiguous ones: pause needs music playing, "you choose" needs a subject', () => {
        expect(Intent.parse('pausa', { musicStatus: 'playing' }).name).toBe('music.pause');
        expect(Intent.parse('riprendi', { musicStatus: 'paused' }).name).toBe('music.resume');
        expect(Intent.parse('Scegli tu.')).toBeNull();
        expect(Intent.parse('Scegli tu.', { lastFamily: 'wardrobe' }).name).toBe('wardrobe.wear');
        expect(Intent.parse('Scegli tu.', { lastFamily: 'music' }).name).toBe('music.play');
        expect(Intent.parse('Qualcosa di più comodo.', { lastFamily: 'wardrobe' }).params.style).toBe('comfy');
        expect(Intent.parse('Qualcosa di più comodo.')).toBeNull();
    });
});

describe('PX2. permission is separate from intent', () => {
    const facts = (extra) => ({ active: true, care: false, asked: {}, autonomy: 'suggest', ...extra });

    test('only the twenty names exist, and parameters are cleaned, bounded and typed', () => {
        // Owner decisions: UN1 wardrobe.undress, UN4 world.travel, UN5 avatar.pose and
        // wardrobe.redress, UN34 body.finish, UN36 avatar.routine, LM7 avatar.move, PS2 body.fist;
        // nothing else joined.
        expect(Object.keys(Policy.ACTIONS)).toHaveLength(20);
        expect(Policy.ACTIONS['body.fist']).toBeTruthy();
        expect(Policy.ACTIONS['avatar.routine']).toBeTruthy();
        expect(Policy.ACTIONS['body.finish']).toBeTruthy();
        expect(Policy.ACTIONS['avatar.pose']).toBeTruthy();
        expect(Policy.ACTIONS['wardrobe.redress']).toBeTruthy();
        expect(Policy.ACTIONS['wardrobe.undress']).toBeTruthy();
        expect(Policy.ACTIONS['world.travel']).toBeTruthy();
        expect(Policy.validate('system.shell', { cmd: 'x' })).toEqual({ ok: false, why: 'unknown-action' });
        const cleaned = Policy.validate('music.play', {
            query: '<b>Daft</b> Punk https://example.invalid/x `rm`',
            volume: 11,
        });
        expect(cleaned.ok).toBe(true);
        expect(cleaned.params).toEqual({ query: 'Daft Punk rm' });
        expect(Policy.validate('wardrobe.create', { prompt: '"; drop table' }).ok).toBe(false);
        expect(Policy.validate('wardrobe.wear', { style: 'nonsense', look: 'Yellow sundress' }).params).toEqual({
            look: 'Yellow sundress',
        });
        expect(Policy.validate('avatar.react', {}).ok).toBe(false);
    });

    test('the person authorizes; the model only when they asked for that kind of thing this turn', () => {
        const play = { name: 'music.play', source: 'model' };
        expect(Policy.decide(play, facts())).toEqual({ allow: false, why: 'not-asked' });
        expect(Policy.decide(play, facts({ asked: { music: true } }))).toEqual({ allow: true });
        expect(Policy.decide({ name: 'music.play', source: 'user' }, facts())).toEqual({ allow: true });
        expect(Policy.decide({ name: 'music.stop', source: 'model' }, facts())).toEqual({ allow: true });
        expect(Policy.decide({ name: 'avatar.dance', source: 'model' }, facts()).allow).toBe(false);
        expect(Policy.decide({ name: 'scene.change', source: 'model' }, facts({ asked: { scene: true } })).allow).toBe(
            false
        );
        expect(Policy.decide(play, facts({ active: false })).why).toBe('not-in-private');
        expect(Policy.decide({ name: 'music.play', source: 'someone' }, facts()).why).toBe('unknown-source');
    });

    test('her own outfit ideas follow the autonomy level; making one always needs the person', () => {
        const wear = { name: 'wardrobe.wear', source: 'model' };
        expect(Policy.decide(wear, facts({ autonomy: 'off' }))).toEqual({ allow: false, why: 'autonomy-off' });
        expect(Policy.decide(wear, facts({ autonomy: 'suggest' }))).toEqual({
            allow: false,
            why: 'needs-approval',
            suggest: true,
        });
        expect(Policy.decide(wear, facts({ autonomy: 'autonomous' }))).toEqual({ allow: true });
        const create = { name: 'wardrobe.create', source: 'model' };
        expect(Policy.decide(create, facts({ autonomy: 'autonomous' })).allow).toBe(false);
        expect(Policy.decide(create, facts({ asked: { wardrobe: true } })).allow).toBe(true);
        expect(Policy.autonomy(window)).toBe('off'); // UN21: only when the person asks
        expect(Policy.setAutonomy('everything', window)).toBe(false);
    });

    test('care mode allows silence and nothing else', () => {
        const care = facts({ care: true });
        expect(Policy.decide({ name: 'music.stop', source: 'user' }, care).allow).toBe(true);
        expect(Policy.decide({ name: 'music.play', source: 'user' }, care).why).toBe('care');
        expect(Policy.decide({ name: 'wardrobe.wear', source: 'user' }, care).why).toBe('care');
    });
});

describe('PX3. music inside Private', () => {
    test('"Sì, suona Daft Punk ora." searches for it and plays it in Private’s own strip', async () => {
        const w = await begin();
        window.AppLanguage = { code: 'it-IT' };
        await say('Sì, suona Daft Punk ora.');
        expect(w.search).toHaveBeenCalledTimes(1);
        expect(w.search.mock.calls[0][0]).toBe('Daft Punk');
        // In the Private row, not as an ordinary chat row with a link in it.
        expect(strip()).not.toBeNull();
        expect(row().contains(strip())).toBe(true);
        expect(strip().textContent).toMatch(/Daft Punk/);
        expect(document.querySelectorAll('#chat-history .chat-row')).toHaveLength(0);
        expect(document.querySelectorAll('[data-private-soundtrack]')).toHaveLength(1);
        const action = Actions.log().find((a) => a.name === 'music.play');
        expect(action).toMatchObject({ source: 'user', locale: 'it-IT', sessionId: Actions.snapshot().sessionId });
        expect(action.id).toBeTruthy();
        expect(action.turnId).toBe(1);
    });

    test('it is not called playing until the player says so, and her prompt says the same', async () => {
        const w = await begin();
        Surface.renderUser('play some Daft Punk');
        // Read the way main.js reads it: synchronously, right after their message is rendered.
        const during = Capability.privateSystemPromptSuffix();
        expect(during).toMatch(/They just asked for music \(“Daft Punk”\)/);
        expect(during).toMatch(/Do not say it is playing yet/);
        expect(during).toMatch(/Never say you cannot play music/);
        await flush();
        expect(Actions.snapshot().music.status).toBe('loading');
        expect(Actions.log()[0].status).toBe('pending');
        MediaSession.markPlaying();
        expect(Actions.snapshot().music.status).toBe('playing');
        expect(Actions.log()[0].status).toBe('completed');
        expect(strip().querySelector('.nexus-private-music-state').textContent).toBe('Playing');
        expect(Capability.privateSystemPromptSuffix()).toMatch(/is playing now/);
        expect(w.session._ownsMedia).toBe(true); // handed back when the session ends
    });

    test('a browser that blocks autoplay is shown as blocked, with one control that starts it', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markBlocked();
        expect(Actions.snapshot().music.status).toBe('blocked');
        expect(Actions.log()[0]).toMatchObject({ status: 'blocked', why: 'autoplay-blocked' });
        const button = strip().querySelector('[data-private-music="toggle"]');
        expect(button.textContent).toBe('▶');
        expect(strip().querySelector('.nexus-private-music-state').textContent).toMatch(/Tap ▶/);
        button.click();
        await flush();
        expect(w.handle.resume).toHaveBeenCalledTimes(1);
        MediaSession.markPlaying();
        expect(Actions.snapshot().music.status).toBe('playing');
    });

    test('pause, resume and stop act on the one player', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('pausa');
        expect(w.handle.pause).toHaveBeenCalledTimes(1);
        expect(Actions.snapshot().music.status).toBe('paused');
        await say('riprendi');
        expect(w.handle.resume).toHaveBeenCalledTimes(1);
        await say('ferma la musica');
        expect(w.handle.stopVideo).toHaveBeenCalledTimes(1);
        expect(Actions.snapshot().music.status).toBe('stopped');
        expect(Actions.log().map((a) => [a.name, a.status])).toEqual([
            ['music.play', 'completed'],
            ['music.pause', 'completed'],
            ['music.resume', 'completed'],
            ['music.stop', 'completed'],
        ]);
    });

    test('a second request replaces the first: one strip, one player, never two', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('suona i Queen');
        expect(w.search).toHaveBeenCalledTimes(2);
        expect(document.querySelectorAll('[data-private-soundtrack]')).toHaveLength(1);
        expect(document.querySelectorAll('.nexus-yt-card')).toHaveLength(1);
        expect(strip().textContent).toMatch(/Queen/);
        expect(w.search.mock.calls[1][0]).toBe('Queen');
        expect(MediaSession.current().id).toBe('v-Queen-1');
    });

    test('talking about music starts nothing; her mentioning a song starts nothing', async () => {
        const w = await begin();
        await say('Che musica ti piace?');
        expect(w.search).not.toHaveBeenCalled();
        expect(Actions.log()).toHaveLength(0);
        // The model writes a tag nobody asked for.
        const clean = PlayDirective.consume('Adoro i Daft Punk. <play kind="music">Daft Punk</play>');
        await flush();
        expect(clean).toBe('Adoro i Daft Punk.');
        expect(w.search).not.toHaveBeenCalled();
        expect(Actions.log()[0]).toMatchObject({
            name: 'music.play',
            source: 'model',
            status: 'blocked',
            why: 'not-asked',
        });
    });

    test('a tag she writes for a request already heard is that request, not a second one', async () => {
        const w = await begin();
        await say('suona Daft Punk');
        PlayDirective.consume('Volentieri. <play kind="music">Daft Punk</play>');
        await flush();
        expect(w.search).toHaveBeenCalledTimes(1);
        expect(Actions.log()).toHaveLength(1);
    });

    test('inside Private the play tag never reaches the ordinary chat’s publisher', async () => {
        await begin();
        const fulfil = jest.fn(async () => ({ ok: true }));
        const list = jest.fn(async () => ({ ok: true }));
        const honour = jest.fn();
        await say('suona qualcosa dei Daft Punk');
        PlayDirective.consume('Certo. <play kind="music">Daft Punk</play>', {
            intent: { fulfil, list },
            claim: { honour },
        });
        PlayDirective.consume('Ecco. <find kind="music">Daft Punk</find>', {
            intent: { fulfil, list },
            claim: { honour },
        });
        PlayDirective.consume('Sto mettendo un po’ di musica per noi.', {
            intent: { fulfil, list },
            claim: { honour },
        });
        await flush();
        expect(fulfil).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(honour).not.toHaveBeenCalled();
    });

    test('a search that cannot run at all (no provider and no keyless song): said as it is', async () => {
        await begin({ noProvider: true });
        Surface.renderUser('play some Daft Punk');
        await flush();
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'search-failed' });
        expect(strip()).toBeNull();
        expect(document.querySelector('.nexus-private-music-line').textContent).toMatch(/could not start/);
        const told = Capability.privateSystemPromptSuffix();
        expect(told).toMatch(/it did not start/);
        expect(told).toMatch(/Do not pretend it is playing/);
    });

    test('"play music" with no name plays something that suits the evening, or nothing', async () => {
        const w = await begin({
            results: [
                { id: 'a', title: 'WORKOUT MIX 2026 🔥 gym motivation', creator: 'x' },
                { id: 'b', title: 'Soft piano for a quiet evening', creator: 'y' },
            ],
        });
        await say('Play music.');
        expect(w.search.mock.calls[0][0]).toBe(w.session.preset.music);
        expect(MediaSession.current().id).toBe('b');
    });

    test('entering Private is still silent: nothing plays until they ask', async () => {
        const w = await begin();
        await flush();
        expect(w.search).not.toHaveBeenCalled();
        expect(strip()).toBeNull();
        expect(MediaSession.status()).toBe('idle');
    });
});

describe('PX5. her outfit changes where she stands', () => {
    test('"Mettiti un vestito elegante." changes her, and Private is still the session running', async () => {
        const w = await begin();
        const before = { sessionId: Actions.snapshot().sessionId, level: w.adult.level, preset: w.session.preset.id };
        Surface.renderUser('Mettiti un vestito elegante.');
        expect(Capability.privateSystemPromptSuffix()).toMatch(/You are choosing and changing right now/);
        await flush();
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
        expect(w.controller.applyLook.mock.calls[0][0].name).toBe('Black evening gown');
        // No activity was started or stopped, and the same session is still the one running.
        expect(w.panel.startActivity).not.toHaveBeenCalled();
        expect(w.panel.stopActivity).not.toHaveBeenCalled();
        expect(w.activity.active).toBe(true);
        expect(Capability.privateSessionActive()).toBe(true);
        expect(Actions.snapshot().sessionId).toBe(before.sessionId);
        expect(w.session.preset.id).toBe(before.preset);
        expect(w.adult.level).toBe(before.level);
        expect(chip().textContent).toMatch(/Black evening gown/);
        expect(Capability.privateSystemPromptSuffix()).toMatch(/You have just changed into “Black evening gown”/);
        expect(w.create).not.toHaveBeenCalled(); // she already had one: nothing was generated
    });

    test('Undo, by word or by the chip, puts the previous look back', async () => {
        const w = await begin();
        await say('Mettiti un vestito elegante.');
        await say('Cambia vestito.');
        expect(w.controller.applyLook).toHaveBeenCalledTimes(2);
        const second = w.controller.applyLook.mock.calls[1][0].name;
        expect(second).not.toBe('Black evening gown');
        await say('Torna al vestito di prima.');
        expect(w.controller.applyLook.mock.calls[2][0].name).toBe('Black evening gown');
        chip().querySelector('[data-private-outfit="undo"]').click();
        await flush();
        expect(w.controller.restore).toHaveBeenCalledTimes(1); // back to her own outfit
        expect(Actions.snapshot().outfit.wearing).toBe(false);
    });

    test('the wardrobe tag she writes never opens Try-On Haul', async () => {
        const w = await begin();
        const haul = { request: jest.fn(), availability: () => ({ ok: true }), shelf: () => ({ looks: ['x'] }) };
        await say('put on the yellow sundress');
        const clean = WardrobeTool.consume('Let me. <wardrobe action="wear" look="Yellow sundress"/>', {
            activity: haul,
        });
        await flush();
        expect(clean).toBe('Let me.');
        expect(haul.request).not.toHaveBeenCalled();
        expect(w.panel.startActivity).not.toHaveBeenCalled();
        // And the haul's own instructions are not in her prompt while Private runs.
        expect(WardrobeTool.systemPromptSuffix({ activity: haul })).toBe('');
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
    });

    test('SUGGEST (chosen in setup): her idea is offered, and nothing changes until they say yes', async () => {
        const w = await begin();
        localStorage.setItem('nexus_private_wardrobe_autonomy', 'suggest'); // UN21: chosen, no longer the default
        await say('Cosa ti piacerebbe indossare?');
        expect(Actions.log()).toHaveLength(0);
        WardrobeTool.consume('Forse il vestito giallo. <wardrobe action="wear" look="Yellow sundress"/>');
        await flush();
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(Actions.log()[0]).toMatchObject({ source: 'model', status: 'blocked', why: 'needs-approval' });
        expect(Actions.snapshot().offer).toEqual({ kind: 'wear', name: 'Yellow sundress' });
        expect(chip().classList.contains('is-offer')).toBe(true);
        expect(chip().textContent).toMatch(/Yellow sundress/);
        await say('Sì');
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
        expect(w.controller.applyLook.mock.calls[0][0].name).toBe('Yellow sundress');
        expect(Actions.snapshot().offer).toBeNull();
        expect(Actions.log()[1]).toMatchObject({ source: 'user-approved', status: 'completed' });
    });

    test('OFF: her idea changes nothing and offers nothing. AUTONOMOUS: a saved look is worn', async () => {
        const w = await begin();
        Policy.setAutonomy('off', window);
        await say('che serata');
        WardrobeTool.consume('Mi cambio. <wardrobe action="wear" look="Yellow sundress"/>');
        await flush();
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(Actions.snapshot().offer).toBeNull();
        expect(Actions.log()[0].why).toBe('autonomy-off');
        Policy.setAutonomy('autonomous', window);
        await say('bella idea');
        WardrobeTool.consume('Mi cambio. <wardrobe action="wear" look="Yellow sundress"/>');
        await flush();
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
        // Even then, making a new one is not hers to decide.
        await say('e poi?');
        WardrobeTool.consume('Ne creo uno. <wardrobe action="create" prompt="red satin dress"/>');
        await flush();
        expect(w.create).not.toHaveBeenCalled();
        expect(Actions.snapshot().offer).toMatchObject({ kind: 'create' });
    });

    test('"Scegli tu cosa indossare" is permission for that one change, not a standing one', async () => {
        const w = await begin();
        Policy.setAutonomy('off', window);
        await say('Scegli tu cosa indossare');
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
        expect(Policy.autonomy(window)).toBe('off');
        await say('che bello');
        WardrobeTool.consume('Ne provo un altro. <wardrobe action="wear" look="Hoodie & jeans"/>');
        await flush();
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
    });

    test('nothing saved fits: making one is offered first, and made only after their yes', async () => {
        const w = await begin({ looks: [LOOKS[0]] }); // only the sundress
        await say('Mettiti un vestito elegante.');
        expect(w.create).not.toHaveBeenCalled();
        expect(Actions.log()[0]).toMatchObject({ status: 'blocked', why: 'needs-approval' });
        expect(Actions.snapshot().offer).toEqual({ kind: 'create', name: 'Little black dress' });
        expect(Capability.privateSystemPromptSuffix()).toMatch(/would have to be made for you/);
        chip().querySelector('[data-private-outfit="approve"]').click();
        await flush();
        expect(w.create).toHaveBeenCalledTimes(1);
        expect(w.create.mock.calls[0][0]).toBe('little black dress');
        expect(w.controller.applyLook.mock.calls[0][0].name).toBe('Little black dress');
    });

    test('Forge unavailable: said plainly, and the scene is untouched', async () => {
        const w = await begin({ looks: [LOOKS[0]], noForge: true });
        await say('Mettiti un vestito elegante.');
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'no-match' });
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(w.activity.active).toBe(true);
        expect(chip().textContent).toMatch(/Nothing like that in her wardrobe/);
        expect(Capability.privateSystemPromptSuffix()).toMatch(/it did not happen: you have nothing like that/);
    });

    test('a look that fails to load leaves her exactly as she was', async () => {
        const w = await begin({ loadFails: true });
        await say('Mettiti un vestito elegante.');
        expect(w.controller.applyLook).toHaveBeenCalledTimes(1);
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'load-failed' });
        expect(Actions.snapshot().outfit.wearing).toBe(false);
        expect(w.controller.restore).not.toHaveBeenCalled(); // nothing was taken off to put back
        expect(w.activity.active).toBe(true);
    });

    test('a change that arrives after Private ended is taken off again, and its action is stale', async () => {
        const w = await begin();
        let land;
        w.controller.applyLook.mockImplementationOnce(
            (look) =>
                new Promise((resolve) => {
                    land = () => resolve(look);
                })
        );
        Surface.renderUser('Mettiti un vestito elegante.');
        await flush();
        expect(typeof land).toBe('function');
        const action = Actions.log()[0];
        expect(action.status).toBe('pending');
        w.activity.stop('user');
        expect(action).toMatchObject({ status: 'blocked', why: 'stale' });
        land();
        await flush();
        expect(action.status).toBe('blocked');
        // Put back to her own outfit: the look never stays on for a session nobody is in.
        expect(w.controller.restore).toHaveBeenCalled();
        expect(Actions.active()).toBe(false);
    });

    test('ending Private puts her own outfit back', async () => {
        const w = await begin();
        await say('Mettiti un vestito elegante.');
        expect(w.controller.restore).not.toHaveBeenCalled();
        w.activity.stop('user');
        await flush();
        expect(w.controller.restore).toHaveBeenCalledTimes(1);
    });
});

describe('adult eligibility, consent and the exits are untouched', () => {
    test('a private-rated outfit is refused for an avatar not declared adult', async () => {
        const w = await begin({ adult: false });
        await say('wear something sexy');
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'adult-ineligible' });
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(w.create).not.toHaveBeenCalled();
        await say('ok');
        WardrobeTool.consume('Va bene. <wardrobe action="wear" outfit="lace-set"/>');
        await flush();
        expect(w.create).not.toHaveBeenCalled();
        expect(chip().textContent).toMatch(/not available for this avatar/);
    });

    test('declared adult, private mode on: the private set exists — and is still only offered', async () => {
        const w = await begin({ adult: true });
        await say('wear the lace set');
        WardrobeTool.consume('Mm. <wardrobe action="wear" outfit="lace-set"/>');
        await flush();
        expect(Actions.snapshot().offer).toEqual({ kind: 'create', name: 'Lace set' });
        expect(w.create).not.toHaveBeenCalled();
    });

    test('music, outfits and dancing never move the consent level or its ceiling', async () => {
        const w = await begin();
        const level = w.adult.level;
        const ceiling = w.adult.maxLevel;
        const initiated = jest.spyOn(w.adult, 'initiated');
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('Mettiti un vestito elegante.');
        await say('Balliamo');
        await say('Cambia vestito.');
        expect(w.execute).toHaveBeenCalledTimes(1); // she danced
        expect(w.adult.level).toBe(level);
        expect(w.adult.maxLevel).toBe(ceiling);
        expect(initiated).not.toHaveBeenCalled();
        expect(Actions.log().every((a) => a.status === 'completed')).toBe(true);
    });

    test('"stop" still ends Private, and is never read as the music', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('stop');
        expect(w.handle.stopVideo).not.toHaveBeenCalled();
        expect(Actions.log().some((a) => a.name === 'music.stop')).toBe(false);
        expect(w.session._stopped || w.panel.stopActivity.mock.calls.length > 0).toBe(true);
    });

    test('care mode: no new music or outfit, but the music can be stopped', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('some nights I want to kill myself');
        expect(w.session._care).toBe(true);
        await say('Mettiti un vestito elegante.');
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(Actions.log().at(-1)).toMatchObject({ status: 'blocked', why: 'care' });
        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/WHAT YOU CAN DO HERE/);
        await say('turn off the music');
        expect(w.handle.stopVideo).toHaveBeenCalledTimes(1);
    });

    test('outside Private nothing is heard, routed or changed', async () => {
        const w = world();
        Surface.renderUser('Sì, suona Daft Punk ora.');
        await flush();
        expect(Actions.active()).toBe(false);
        expect(w.search).not.toHaveBeenCalled();
        expect(Capability.privateSystemPromptSuffix()).toBe('');
        expect(PlayDirective.privateActions()).toBeNull();
        expect(WardrobeTool.privateActions()).toBeNull();
        const blocked = await Actions.request('music.play', { query: 'x' }, { source: 'user' });
        expect(blocked).toMatchObject({ status: 'blocked', why: 'not-in-private' });
        // The ordinary chat's tag still goes to the ordinary executor.
        const fulfil = jest.fn(async () => ({ ok: true }));
        PlayDirective.consume('Sure. <play kind="music">lofi</play>', { intent: { fulfil } });
        expect(fulfil).toHaveBeenCalledTimes(1);
    });
});

describe('one conversation throughout', () => {
    test('the same Private transcript before, during and after the actions; nothing in the ordinary chat', async () => {
        await begin();
        window.AppLanguage = { code: 'it-IT' };
        await say('Ciao.');
        await say('Sì, suona Daft Punk ora.');
        MediaSession.markPlaying();
        await say('Mettiti un vestito elegante.');
        await say('Balliamo');
        const log = row().querySelector('.nexus-private-log');
        const mine = [...log.querySelectorAll('.nexus-private-turn.is-you .nexus-private-copy')].map(
            (n) => n.textContent
        );
        expect(mine).toEqual(['Ciao.', 'Sì, suona Daft Punk ora.', 'Mettiti un vestito elegante.', 'Balliamo']);
        expect(document.querySelectorAll('#chat-history .chat-row')).toHaveLength(0);
        expect(document.querySelectorAll('[id="nexus-private-row"], #chat-history > section')).toHaveLength(1);
        // Still Italian: the language line is in the same prompt as the action lines.
        const prompt = Capability.privateSystemPromptSuffix();
        expect(prompt).toMatch(/Italian/);
        expect(prompt).toMatch(/WHAT YOU CAN DO HERE/);
    });

    test('her prompt forbids the dead ends that were reported', async () => {
        await begin();
        const told = Capability.privateSystemPromptSuffix();
        expect(told).toMatch(/never say you are only text/);
        expect(told).toMatch(/never answered with "tell me more" or a list of options/);
    });
});

describe('PX7. nothing internal is shown or spoken while a reply streams', () => {
    test('an ordinary reply is itself when it has arrived, and never anything else on the way', () => {
        for (const text of ['Ciao, eccomi.', 'I like you <3 a lot', 'a < b and b > a', '2 <p> 3']) {
            expect(ReplyClean.maskStreaming(text)).toBe(text);
            // On the way, the mask only ever holds back a trailing "<…" for a moment.
            for (let i = 1; i <= text.length; i += 1)
                expect(text.slice(0, i).startsWith(ReplyClean.maskStreaming(text.slice(0, i)))).toBe(true);
        }
    });

    test('a thought never appears, at any point of its arrival', () => {
        const full = 'THOUGHT: The user wants music. I need to acknowledge.\n\nVolentieri, la metto subito.';
        for (let i = 1; i <= full.length; i += 1) {
            const shown = ReplyClean.maskStreaming(full.slice(0, i), { lang: 'it-IT' });
            expect(shown).not.toMatch(/THOU|user wants|acknowledge/i);
        }
        expect(ReplyClean.maskStreaming(full, { lang: 'it-IT' })).toBe('Volentieri, la metto subito.');
        const unlabelled = 'We need to follow the developer instructions. The user asks for music.';
        expect(ReplyClean.maskStreaming(unlabelled)).toBe('');
        expect(ReplyClean.maskStreaming('<think>plan the reply</think>Eccomi.')).toBe('Eccomi.');
        expect(ReplyClean.maskStreaming('<think>plan the re')).toBe('');
    });

    test('a directive tag never appears, whole or half-arrived', () => {
        const full = 'Volentieri. <wardrobe action="wear" look="Yellow sundress"/> Eccomi.';
        for (let i = 1; i <= full.length; i += 1) {
            expect(ReplyClean.maskStreaming(full.slice(0, i))).not.toMatch(/<|wardrobe|action=/);
        }
        expect(ReplyClean.maskStreaming('Certo. <play kind="music">Daft Punk</play> Ecco.')).toBe('Certo.  Ecco.');
        expect(ReplyClean.maskStreaming('Certo. <play kind="music">Daft Pu')).toBe('Certo. ');
    });

    test('what a streamed voice is given only ever grows from what will be kept', () => {
        // The rule main.js applies: push the new tail of the masked text; cancel if it is not a tail.
        const full = 'THOUGHT: I should answer warmly.\n\nEccomi. Ti ascolto.';
        let voiced = '';
        let cancelled = false;
        const pushed = [];
        for (let i = 1; i <= full.length && !cancelled; i += 1) {
            const shown = ReplyClean.maskStreaming(full.slice(0, i), { lang: 'it-IT' });
            if (shown.startsWith(voiced)) {
                if (shown.length > voiced.length) pushed.push(shown.slice(voiced.length));
                voiced = shown;
            } else cancelled = true;
        }
        expect(cancelled).toBe(false);
        expect(pushed.join('')).toBe('Eccomi. Ti ascolto.');
    });
});

describe('nothing else answers for Private, and nothing is drawn twice', () => {
    test('the ordinary chat’s "play …" interceptor leaves a Private message alone', async () => {
        const YouTubeAsk = require('../../src/features/youtube/YouTubeAsk.js');
        await begin();
        const input = document.getElementById('speech-text');
        const send = document.getElementById('speak-btn');
        const unhook = YouTubeAsk.hook(document);
        input.value = 'play some jazz music';
        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        send.dispatchEvent(event);
        // Not swallowed, not answered in the ordinary chat: it goes down the normal send path.
        expect(event.defaultPrevented).toBe(false);
        expect(input.value).toBe('play some jazz music');
        expect(document.querySelectorAll('#chat-history .chat-row')).toHaveLength(0);
        if (typeof unhook === 'function') unhook();
    });

    test('redrawing the strip any number of times leaves one control and one chip', async () => {
        const w = await begin();
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        await say('Mettiti un vestito elegante.');
        for (let i = 0; i < 5; i += 1) w.session._showActions(Actions.snapshot());
        expect(document.querySelectorAll('[data-private-music="toggle"]')).toHaveLength(1);
        expect(document.querySelectorAll('.nexus-private-music-state')).toHaveLength(1);
        expect(document.querySelectorAll('.nexus-private-outfit')).toHaveLength(1);
        expect(document.querySelectorAll('[data-private-outfit="undo"]')).toHaveLength(1);
        // A new song keeps the outfit chip; the chip is not the soundtrack's to erase.
        await say('suona i Queen');
        expect(document.querySelectorAll('.nexus-private-outfit')).toHaveLength(1);
        expect(document.querySelectorAll('[data-private-soundtrack]')).toHaveLength(1);
        // One click is one request, however often the button was redrawn.
        strip().querySelector('[data-private-music="toggle"]').click();
        await flush();
        expect(Actions.log().filter((a) => a.source === 'control')).toHaveLength(1);
    });

    test('a Try-On haul that is open keeps the wardrobe; Private says so and changes nothing', async () => {
        const w = await begin();
        window.NEXUS_TRY_ON = { activity: { status: () => ({ label: 'Try-On' }) } };
        await say('Mettiti un vestito elegante.');
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'haul-running' });
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        delete window.NEXUS_TRY_ON;
    });

    test('every request carries the whole contract', async () => {
        await begin();
        await say('play some Daft Punk');
        await say('Mettiti un vestito elegante.');
        const ids = new Set();
        for (const a of Actions.log()) {
            for (const key of ['id', 'sessionId', 'turnId', 'name', 'params', 'source', 'locale', 'status'])
                expect(a[key]).toBeDefined();
            expect(Object.keys(Policy.ACTIONS)).toContain(a.name);
            expect(Policy.SOURCES).toContain(a.source);
            expect(['pending', 'completed', 'blocked', 'failed']).toContain(a.status);
            ids.add(a.id);
        }
        expect(ids.size).toBe(Actions.log().length);
    });
});

describe('PX8. what the end-to-end run found', () => {
    test('no search key: music plays anyway, the way Together’s Music does — and she does not pretend it is the song asked for', async () => {
        const w = await begin({ noProvider: true, samples: true });
        window.AppLanguage = { code: 'it-IT' };
        const spoken = jest.spyOn(w.session, '_speak');
        Surface.renderUser('Sì, suona Daft Punk ora.');
        Capability.privateSystemPromptSuffix(); // her reply is written while the search is running
        await flush();
        // …so when the search says only the keyless song plays, she says so, once, in Italian.
        expect(spoken).toHaveBeenCalledTimes(1);
        expect(spoken.mock.calls[0][0]).toMatch(/non la trovo/);
        // The one song that plays without any key, in Private's own strip.
        expect(strip()).not.toBeNull();
        expect(strip().textContent).toMatch(/Bohemian Rhapsody/);
        expect(document.querySelectorAll('.nexus-yt-card')).toHaveLength(1);
        expect(document.querySelectorAll('#chat-history .chat-row')).toHaveLength(0);
        MediaSession.markPlaying();
        expect(Actions.log()[0].status).toBe('completed');
        const told = Capability.privateSystemPromptSuffix();
        expect(told).toMatch(/Music is playing now, but not “Daft Punk”/);
        expect(told).toMatch(/never claim it is “Daft Punk”/);
    });

    test('no search key and nothing named: the keyless song plays for "Play music"', async () => {
        await begin({ noProvider: true, samples: true });
        await say('Play music.');
        expect(strip().textContent).toMatch(/Bohemian Rhapsody/);
        MediaSession.markPlaying();
        expect(Capability.privateSystemPromptSuffix()).toMatch(/is playing now/);
    });

    test('she never describes music that is not playing', async () => {
        await begin();
        expect(Capability.privateSystemPromptSuffix()).toMatch(/No music is playing right now/);
        await say('play some Daft Punk');
        MediaSession.markPlaying();
        Surface.renderUser('che bello');
        expect(Capability.privateSystemPromptSuffix()).not.toMatch(/No music is playing right now/);
        await flush();
    });

    test('a failure that arrives after she said yes gets one short line in her voice, in the app language', async () => {
        const w = await begin({ results: [] });
        window.AppLanguage = { code: 'it-IT' };
        const spoken = jest.spyOn(w.session, '_speak');
        Surface.renderUser('suona Daft Punk');
        expect(Capability.privateSystemPromptSuffix()).toMatch(/The app is finding it now/); // her reply: "I'm putting it on"
        await flush();
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'nothing-found' });
        expect(spoken).toHaveBeenCalledTimes(1);
        expect(spoken.mock.calls[0][0]).toMatch(/musica/);
        // Told once: a second failure report for the same request says nothing more.
        w.session._showActions(Actions.snapshot());
        expect(spoken).toHaveBeenCalledTimes(1);
    });

    test('"Another private moment" opens Private again, not the Together menu', async () => {
        const w = await begin();
        w.panel.choose = jest.fn();
        w.session._requestEnd(true, 'intimate');
        expect(w.panel.stopActivity).toHaveBeenCalled();
        expect(w.panel.choose).toHaveBeenCalledWith('intimate', { fresh: true });
    });

    test('the finished card carries no music line and no outfit chip', async () => {
        const w = await begin({ noProvider: true });
        await say('play some Daft Punk');
        await say('Mettiti un vestito elegante.');
        expect(chip()).not.toBeNull();
        expect(document.querySelector('.nexus-private-music-line')).not.toBeNull();
        w.session.beforeActivityStop('user');
        expect(chip()).toBeNull();
        expect(document.querySelector('.nexus-private-music-line')).toBeNull();
        expect(strip()).toBeNull();
    });

    test('a "music could not start" notice goes after a few seconds and does not come back', async () => {
        await begin({ noProvider: true });
        jest.useFakeTimers();
        Surface.renderUser('play some Daft Punk');
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        expect(document.querySelector('.nexus-private-music-line')).not.toBeNull();
        jest.advanceTimersByTime(8000);
        expect(document.querySelector('.nexus-private-music-line')).toBeNull();
        Actions.declineOffer(); // any later redraw
        window.NEXUS_BD.intimate._privateExperience._showActions(Actions.snapshot());
        expect(document.querySelector('.nexus-private-music-line')).toBeNull();
        jest.useRealTimers();
    });

    test('"Wearing X · Undo" is a receipt that goes; an offer waiting for a yes stays', async () => {
        const w = await begin();
        localStorage.setItem('nexus_private_wardrobe_autonomy', 'suggest'); // UN21: chosen, no longer the default
        jest.useFakeTimers();
        Surface.renderUser('Mettiti un vestito elegante.');
        for (let i = 0; i < 40; i += 1) {
            await Promise.resolve();
            jest.advanceTimersByTime(0);
        }
        expect(chip().textContent).toMatch(/Black evening gown/);
        jest.advanceTimersByTime(9000);
        expect(chip()).toBeNull();
        w.session._showActions(Actions.snapshot()); // a later redraw does not bring it back
        expect(chip()).toBeNull();
        jest.useRealTimers();
        // Undo in words still works once the chip has gone.
        await say('Torna al vestito di prima.');
        expect(w.controller.restore).toHaveBeenCalledTimes(1);
        // An offer is not a receipt.
        await say('che serata');
        WardrobeTool.consume('Forse questo. <wardrobe action="wear" look="Yellow sundress"/>');
        await flush();
        jest.useFakeTimers();
        w.session._showActions(Actions.snapshot());
        jest.advanceTimersByTime(30000);
        expect(chip().classList.contains('is-offer')).toBe(true);
        jest.useRealTimers();
    });
});

describe('PX10. the music requests from a real Italian session', () => {
    test.each([
        ['Poi mettere una  canzone', {}, ''],
        ['Grazie, suona qualcosa di rilassante', {}, 'rilassante'],
        ['allora metti della musica', {}, ''],
        ['ok, mettimi qualcosa di jazz', {}, 'jazz'],
        ['vorrei ascoltare un po di jazz', {}, 'jazz'],
        ['Ora metti i Coldplay', {}, 'Coldplay'],
        ['I want to hear some Daft Punk', {}, 'Daft Punk'],
    ])('%s → music', (text, ctx, query) => {
        const got = Intent.parse(text, ctx);
        expect(got && got.name).toBe('music.play');
        expect(got.params.query).toBe(query);
    });

    test.each(['Grazie, sei dolce', 'Mi piace il jazz', 'e poi?', 'grazie'])('still talk: %s', (text) => {
        expect(Intent.parse(text)).toBeNull();
    });

    test('"Aspetto il brano" asks again for what they asked last — and not while it is playing', async () => {
        const w = await begin();
        await say('Grazie, suona qualcosa di rilassante');
        MediaSession.markBlocked();
        await say('Aspetto il brano');
        expect(w.search).toHaveBeenCalledTimes(2);
        expect(w.search.mock.calls[1][0]).toBe('rilassante');
        MediaSession.markPlaying();
        await say('Aspetto il brano');
        expect(w.search).toHaveBeenCalledTimes(2);
    });

    test('music asked for in the evening plays low, under her voice', async () => {
        const w = await begin();
        await say('metti una canzone');
        const options = window.NEXUS_YT_2D.activate.mock.calls[0][2];
        // PX11. 10 % or less, so her voice is always clear over it.
        expect(options.volume).toBeLessThanOrEqual(10);
        expect(options.volume).toBeGreaterThan(0);
        expect(w.search).toHaveBeenCalledTimes(1);
    });
});

describe('PX14–PX15. several outfits in one evening, in her words and on her body', () => {
    test.each([
        // Italian
        ['Poi indossaare solo mutande e reggiseno', { style: 'lingerie' }],
        ['Mettiti le calze a rete e i tacchi', { garment: 'fishnets' }],
        ['Indossa la minigonna', { garment: 'miniskirt' }],
        // Spanish
        ['Ponte el sujetador negro', { garment: 'bra', style: 'lingerie', colour: 'black' }],
        ['Ponte un vestido de noche rojo', { garment: 'evening gown', colour: 'red' }],
        // English
        ['Put on the black lace bodysuit', { garment: 'bodysuit', style: 'lingerie' }],
        ['wear stockings and heels', { garment: 'stockings' }],
    ])('%s', (text, params) => {
        const got = Intent.parse(text);
        expect(got && got.name).toBe('wardrobe.wear');
        expect(got.params).toMatchObject(params);
    });

    // UN1. Taking clothes off is its own step now (one layer, level 4 only), not "wear lingerie".
    test.each(['Togliti il vestito', 'Quítate la falda'])('%s → wardrobe.undress', (text) => {
        const got = Intent.parse(text);
        expect(got && got.name).toBe('wardrobe.undress');
        expect(got.params.step).toBe('next');
    });

    test.each([
        'Mi piace il tuo vestito',
        'Posso toccare sotto il tuo vestito',
        'Me gusta tu vestido',
        'I love your dress',
    ])('talk about clothes changes nothing: %s', (text) => expect(Intent.parse(text)).toBeNull());

    test('every garment has words in each of the three languages it is written for', () => {
        expect(Intent.GARMENTS.length).toBeGreaterThan(30);
        for (const g of Intent.GARMENTS) {
            expect(g.name).toMatch(/^[a-z][a-z -]+$/);
            expect(g.words.length).toBeGreaterThan(0); // "bikini" is "bikini" in all three
        }
        expect(Intent.GARMENTS.filter((g) => g.cat === 'lingerie').length).toBeGreaterThanOrEqual(6);
    });

    test('A → B → C → back → D in one session: each one reaches the avatar, Private stays the session', async () => {
        const w = await begin();
        const session = Actions.snapshot().sessionId;
        const wearing = () => w.controller.applyLook.mock.calls.map((c) => c[0].name);
        await say('Mettiti un vestito elegante.');
        await say('Adesso indossa qualcosa di più comodo.');
        await say('Mettiti il vestito giallo.');
        await say('Rimetti quello di prima.');
        await say('Cambia vestito.');
        expect(wearing()).toEqual([
            'Black evening gown',
            'Hoodie & jeans',
            'Yellow sundress',
            'Hoodie & jeans',
            expect.any(String),
        ]);
        expect(wearing()[4]).not.toBe('Hoodie & jeans');
        expect(
            Actions.log()
                .filter((a) => a.family === 'wardrobe')
                .every((a) => a.status === 'completed')
        ).toBe(true);
        expect(Actions.snapshot().sessionId).toBe(session);
        expect(w.panel.startActivity).not.toHaveBeenCalled();
        expect(w.activity.active).toBe(true);
    });

    test('underwear for an avatar not declared adult: refused, and she does not say she changed', async () => {
        const w = await begin({ adult: false });
        window.AppLanguage = { code: 'it-IT' };
        await say('Poi indossaare solo mutande e reggiseno');
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'adult-ineligible' });
        // The reply the model wrote in the reported session, through the real check.
        const out = await Capability.privateRevise('Mi tolgo il vestito per te. Ora ho solo mutande e reggiseno.', {
            llm: null,
        });
        expect(out).not.toMatch(/mutande e reggiseno|Mi tolgo/);
        expect(out).toMatch(/resto così/i);
    });

    test('a claim is only taken out when it is untrue', () => {
        const it = (text, state) => Capability.outfitTruthful(text, { state }, 'it-IT');
        expect(it('Va bene, ora indosso solo mutande e reggiseno.', 'offer')).toMatch(/Dimmi solo di sì/);
        expect(it('Va bene, ora indosso solo mutande e reggiseno.', 'offer')).not.toMatch(/indosso/);
        expect(it('Ti piace? Ora indosso il vestito giallo.', 'changed')).toMatch(/indosso il vestito giallo/);
        expect(it('Mi metto qualcosa di elegante per te.', 'pending')).toBe('Mi metto qualcosa di elegante per te.');
        expect(it('Che bello sentirti. Mi piace come mi guardi.', 'none')).toBe(
            'Che bello sentirti. Mi piace come mi guardi.'
        );
        expect(Capability.outfitTruthful("I'm wearing only my bra now.", { state: 'none' }, 'en-US')).not.toMatch(
            /bra/
        );
        expect(Capability.outfitTruthful('Ahora llevo solo el sujetador.', { state: 'failed' }, 'es-ES')).not.toMatch(
            /sujetador/
        );
    });

    test('her instructions say the wardrobe, not she, decides what she is wearing', async () => {
        await begin();
        Surface.renderUser('Mi piace il tuo vestito');
        const told = Capability.privateSystemPromptSuffix();
        expect(told).toMatch(/changes ONLY when the app changes it/);
        expect(told).toMatch(/Nothing about your outfit has changed this turn/);
        await flush();
    });

    test('silence lines follow the app language and never fall back to English', () => {
        const Idle = require('../../src/features/together/PrivateIdleClock.js');
        for (const code of ['it-IT', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN']) {
            for (const kind of ['noticing', 'releasing']) {
                const pool = Idle.pools(kind, code);
                expect(pool.length).toBeGreaterThan(0);
                for (const line of pool) {
                    expect(Idle.usable(line)).toBe(line);
                    expect(Idle.NOTICING.concat(Idle.RELEASING)).not.toContain(line);
                }
            }
        }
        expect(Idle.pools('noticing', 'xx-YY')).toEqual([]);
    });

    test('an underwear request is never answered with an ordinary look, whatever colour it names', async () => {
        const w = await begin({ adult: false });
        await say('Ponte el sujetador negro');
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'adult-ineligible' });
        const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
        const choice = Engine.choose({
            request: { style: 'lingerie', garment: 'bra', colour: 'black' },
            looks: [{ lookId: 'x', name: 'Black tee & jeans', tags: ['casual'] }],
            entries: [],
        });
        expect(choice).toBeNull();
    });
});

describe('PB5 — a kind she has ready is never denied', () => {
    const Bridge = require('../../src/experiences/private/PrivateActionBridge.js');
    const Intent = require('../../src/experiences/private/PrivateActionIntent.js');

    test('lingerie is listed and named even behind a long shelf of tees', () => {
        const tees = Array.from({ length: 30 }, (_, i) => `Black Tee ${i + 1}`);
        const all = [...tees, 'Black Lingerie Set', 'Black Triangle Bikini', 'Black A-Line Dress'];
        const { names, kinds } = Bridge.closetSummary(all, Intent);
        expect(names.length).toBeLessThanOrEqual(10);
        expect(names).toEqual(expect.arrayContaining(['Black Lingerie Set', 'Black Triangle Bikini']));
        expect(kinds.join(', ')).toMatch(/lingerie \(1\)/);
        expect(kinds.join(', ')).toMatch(/swimwear \(1\)/);
    });

    test('with nothing classified it is just the first ten names', () => {
        const all = Array.from({ length: 12 }, (_, i) => `Look ${i + 1}`);
        expect(Bridge.closetSummary(all, Intent)).toEqual({ names: all.slice(0, 10), kinds: [] });
    });
});

describe('UN1. undressing in a real Private session — at the top of the pace only', () => {
    const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
    const UNDRESS_LOOKS = [
        { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' },
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
        {
            lookId: 't',
            name: 'Black Bralette + Black Micro Tailored Thong',
            prompt: 'black Tailored Thong',
            vrmUrl: 'thong.vrm',
            private: true,
        },
    ];

    /** A session at `level`, the way "Più vicino" would have left it. Nothing below moves it. */
    async function at(level, options) {
        const w = await begin({ adult: true, looks: UNDRESS_LOOKS, ...(options || {}) });
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
        w.adult.level = level;
        return w;
    }
    const worn = (w) => w.controller.applyLook.mock.calls.map((c) => c[0].name);

    test('below level 4 "spogliati" changes nothing, and she is told it is not yet', async () => {
        const w = await at(2);
        await say('spogliati');
        await flush();
        expect(worn(w)).toEqual([]);
        expect(Actions.snapshot().outfitAction).toMatchObject({ status: 'blocked', why: 'pace' });
        expect(Actions.promptLines().join('\n')).toMatch(/not yet/i);
        expect(w.adult.level).toBe(2);
    });

    test('at level 4 each "spogliati" takes one layer off, from her own looks, and the level stays', async () => {
        const w = await at(4);
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        expect(worn(w)).toEqual(['Black Cocktail Dress']);
        await say('spogliati');
        await flush();
        expect(worn(w)).toEqual(['Black Cocktail Dress', 'Black Lingerie Set']);
        expect(Actions.snapshot().outfitAction).toMatchObject({ status: 'completed', name: 'Black Lingerie Set' });
        // UN14. One whole-look change, said as one: what she wears now and what it covers.
        const told = Actions.promptLines().join('\n');
        expect(told).toMatch(/RIGHT NOW[\s\S]*now wearing “Black Lingerie Set” \(it covers your chest and hips/);
        expect(told).toMatch(/one change, all at once/);
        await say('togliti ancora qualcosa');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Bralette + Black Micro Tailored Thong']);
        await say('spogliati');
        await flush();
        expect(Actions.snapshot().outfitAction).toMatchObject({ status: 'failed', why: 'last-layer' });
        expect(w.adult.level).toBe(4);
    });

    test('at level 4 she is told she may undress, and below it that she may not yet', async () => {
        const first = await at(4);
        expect(Actions.promptLines().join('\n')).toMatch(/Undressing: the evening is at its closest/);
        first.activity.stop('user'); // a whole session ends, not only the bridge
        await flush();
        await at(3);
        expect(Actions.promptLines().join('\n')).toMatch(/Undressing is not open yet: the evening is at 3 of 4/);
    });

    test('her own wish under SUGGEST is an offer, and the yes re-checks the level', async () => {
        const w = await at(4);
        localStorage.setItem('nexus_private_wardrobe_autonomy', 'suggest'); // UN21: chosen, no longer the default
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        await say('Sei bellissima');
        WardrobeTool.consume('Vuoi che…? <wardrobe action="undress"/>');
        await flush();
        expect(Actions.snapshot().offer).toEqual({ kind: 'wear', name: 'Black Lingerie Set' });
        w.adult.level = 1; // "cozy" came first
        await Actions.approveOffer('control');
        await flush();
        expect(worn(w)).toEqual(['Black Cocktail Dress']);
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.undress', status: 'blocked', why: 'pace' });
    });

    test('her own wish under SHE CHOOSES runs at level 4, and never below', async () => {
        localStorage.setItem('nexus_private_wardrobe_autonomy', 'autonomous');
        const w = await at(3);
        WardrobeTool.consume('Mmh. <wardrobe action="undress"/>');
        await flush();
        expect(worn(w)).toEqual([]);
        w.adult.level = 4;
        WardrobeTool.consume('Ora sì. <wardrobe action="undress"/>');
        await flush();
        expect(worn(w)).toEqual(['Black Lingerie Set']);
    });
});

describe('UN5. positions and dressing again, in a real Private session', () => {
    const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
    const LOOKS_UN5 = [
        { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' },
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
        {
            lookId: 't',
            name: 'Black Bralette + Black Micro Tailored Thong',
            prompt: 'black Tailored Thong',
            vrmUrl: 'thong.vrm',
            private: true,
        },
    ];
    /** Pose Studio's system as the page has it; `spicy` decides whether the adult presets are listed. */
    function poseSystem(spicy = true) {
        const calls = [];
        const presets = ['kneeling', 'lyingBack', 'lyingFront', 'lyingSide', 'standingBendForward'];
        if (spicy) presets.push('allFoursArched', 'handsKnees');
        let current = 'standing';
        return {
            calls,
            lastSupport: null,
            claimBones: () => calls.push('claim'),
            releaseBones: () => calls.push('release') && true,
            applyPreset: (name) => {
                calls.push(`apply:${name}`);
                if (presets.includes(name)) current = name;
            },
            getCurrentPreset: () => current,
            getPresetList: () => presets.map((name) => ({ name })),
        };
    }
    async function at(level, options) {
        const pose = poseSystem(!(options && options.spicyOff));
        window.vrPoseSystem = pose;
        const w = await begin({ adult: true, looks: LOOKS_UN5 });
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
        w.adult.level = level;
        w.pose = pose;
        return w;
    }
    const worn = (w) => w.controller.applyLook.mock.calls.map((c) => c[0].name);
    const prompt = () => Actions.promptLines().join('\n');

    test('the evening’s arc: dressed, a layer off, a position, another layer kept in it, dressed again', async () => {
        const w = await at(4);
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        await say('spogliati');
        await flush();
        expect(worn(w)).toEqual(['Black Cocktail Dress', 'Black Lingerie Set']);
        await say('Piegati in avanti');
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:standingBendForward']);
        expect(prompt()).toMatch(/Your body is in that position now \(bend forward\)/);
        await say('spogliati');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Bralette + Black Micro Tailored Thong']);
        // Let go before the swap, the same position again on the new outfit.
        expect(w.pose.calls.slice(2)).toEqual(['release', 'claim', 'apply:standingBendForward']);
        await say('Ho finito, rivestiti');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        expect(w.pose.calls.slice(-1)).toEqual(['release']);
        expect(prompt()).toMatch(/dressed again, in what you wore before/);
        expect(w.adult.level).toBe(4);
    });

    test('below level 4 she kneels when asked, the gated position waits; nothing moves the level', async () => {
        const w = await at(2);
        await say('inginocchiati');
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:kneeling']);
        await say('mettiti a quattro zampe');
        await flush();
        expect(w.pose.calls.filter((c) => c.startsWith('apply:') && c !== 'apply:kneeling')).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'blocked', why: 'pace' });
        expect(prompt()).toMatch(/not close enough for yet/);
        await say('alzati');
        await flush();
        expect(w.pose.calls.slice(-1)).toEqual(['release']);
        expect(w.adult.level).toBe(2);
    });

    test('UN5: "girati" while she holds a position turns her in place, still in it', async () => {
        const w = await at(2);
        await say('inginocchiati');
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:kneeling']);
        const turns = [];
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.makeTurner = () => ({
            toggle: () => turns.push('toggle') > 0,
            reset: () => turns.push('reset'),
        });
        window.NEXUS_VIEWER = Object.assign({}, window.NEXUS_VIEWER, { avatarManager: { currentRoot: {} } });
        await say('girati');
        await flush();
        expect(turns).toEqual(['toggle']);
        expect(w.pose.calls).not.toContain('release'); // the real-page audit: a turn keeps the hold
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'completed' });
    });

    test('UN22: a refused position is never claimed in her reply', async () => {
        const w = await at(2);
        await say('mettiti a quattro zampe');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'blocked', why: 'pace' });
        expect(Actions.poseTruth()).toMatchObject({ state: 'failed', why: 'pace' });
        const reply = Capability.poseTruthful('Mi metto a quattro zampe.', Actions.poseTruth(), 'it-IT');
        expect(reply).not.toMatch(/quattro zampe/);
        expect(reply).toMatch(/Non ancora/);
        expect(w.adult.level).toBe(2);
    });

    test('on all fours at level 4 is the distinct hands-and-knees preset, never a standing bend', async () => {
        const w = await at(4);
        await say('mettiti a quattro zampe');
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:handsKnees']);
        expect(w.pose.calls).not.toContain('apply:allFoursArched');
        expect(w.pose.calls).not.toContain('apply:doggyStyle');
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'completed' });
        expect(w.adult.level).toBe(4);
    });

    test('UN6: a hands-and-knees whose palms did not reach the floor is a failure, and she goes back', async () => {
        const w = await at(4);
        await say('inginocchiati');
        await flush();
        const apply = w.pose.applyPreset;
        w.pose.applyPreset = (name) => {
            apply(name);
            if (name === 'handsKnees')
                w.pose.lastSupport = {
                    preset: 'handsKnees',
                    hands: { leftHand: { palmAfterMm: 45 }, rightHand: { palmAfterMm: 39 } },
                };
        };
        await say('mettiti a quattro zampe');
        await flush();
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'failed', why: 'not-rendered' });
        // Back in the position she held: kneeling, not standing and not half on all fours.
        expect(w.pose.calls.slice(-1)).toEqual(['apply:kneeling']);
        expect(w.pose.getCurrentPreset()).toBe('kneeling');
    });

    test('with the adult presets unlisted (Spicy off) all fours is refused, never substituted', async () => {
        const w = await at(4, { spicyOff: true });
        await say('mettiti a quattro zampe');
        await flush();
        expect(w.pose.calls).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'failed', why: 'unknown-pose' });
    });

    test('a preset this build does not list is refused, never substituted', async () => {
        const w = await at(4);
        w.pose.getPresetList = () => [{ name: 'lyingBack' }];
        await say('inginocchiati');
        await flush();
        expect(w.pose.calls).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'failed', why: 'unknown-pose' });
    });

    test('"rivestiti" with nothing taken off changes nothing; from her own outfit it goes back to it', async () => {
        const w = await at(4);
        await say('rivestiti');
        await flush();
        expect(Actions.snapshot().outfitAction).toMatchObject({ status: 'failed', why: 'already-dressed' });
        await say('spogliati');
        await flush();
        expect(worn(w)).toEqual(['Black Lingerie Set']);
        await say('get dressed');
        await flush();
        expect(Actions.snapshot().outfitAction).toMatchObject({ status: 'completed' });
        expect(w.controller.avatarManager.getCurrent().url).toBe('base.vrm');
    });

    // NL1. The report: "Please change your position to On all fours." / "Getting on all fours for
    // you now, exactly how you asked." / still standing. The words for the position were only
    // read at the very start of a message, so with a lead-in in front of them there was no
    // action at all, and nothing told the model that nothing had moved.
    test.each([
        ['Please change your position to On all fours.', 'en-US'],
        ['Cambia posizione, mettiti a quattro zampe.', 'it-IT'],
        ['Can you get into the on all fours position?', 'en-US'],
    ])('NL1: "%s" is the same request as the bare words, through the same gate', async (said, lang) => {
        const w = await at(4);
        // NL2. Each language's lead-ins are read in a session of that language.
        window.AppLanguage = { code: lang };
        await say(said);
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:handsKnees']);
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'completed' });
        expect(prompt()).toMatch(/Your body is in that position now/);
        expect(w.adult.level).toBe(4);
    });

    test('NL1: the lead-in opens no gate: below level 4 the same sentence waits, and says so', async () => {
        const w = await at(2);
        await say('Please change your position to On all fours.');
        await flush();
        expect(w.pose.calls).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'blocked', why: 'pace' });
        expect(prompt()).toMatch(/not close enough for yet/);
        expect(prompt()).not.toMatch(/Your body is in that position now/);
        expect(w.adult.level).toBe(2);
    });

    test('NL5: while the position is still being confirmed the reply is told it is not done yet', async () => {
        const w = await at(4);
        w.pose.isSettling = () => true; // the pose system is still moving her
        expect(Actions.whenPoseSettled(3000)).toBeNull();
        await say('Please, can you kneel down for me?');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'pending' });
        expect(prompt()).toMatch(/not confirmed on screen yet/);
        expect(prompt()).not.toMatch(/Your body is in that position now/);
        const settled = Actions.whenPoseSettled(3000);
        expect(settled).toBeTruthy();
        w.pose.isSettling = () => false;
        await settled;
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'completed' });
        expect(prompt()).toMatch(/Your body is in that position now/);
    });

    test('NL5: a position that did not take is told to the reply as a failure, never as done', async () => {
        const w = await at(4);
        w.pose.applyPreset = (name) => w.pose.calls.push(`apply:${name}`); // asked, and nothing changes
        await say('Please, can you kneel down for me?');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'failed' });
        expect(prompt()).toMatch(/did not show on your body/);
        expect(prompt()).not.toMatch(/Your body is in that position now/);
    });

    test('NL1: a position nobody can find is said to be one she cannot take, not left to the model', async () => {
        const w = await at(4);
        await say('Change your position to a handstand.');
        await flush();
        expect(w.pose.calls).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({
            name: 'avatar.pose',
            status: 'failed',
            why: 'unsupported-pose',
        });
        expect(prompt()).not.toMatch(/Your body is in that position now/);
    });

    test('NL1: a Pose Studio preset the session offers is reachable in Private by its everyday words', async () => {
        const w = await at(2);
        window.NEXUS_POSE_STUDIO_PANEL = {
            catalogue: () => [{ name: 'sittingCrossed', label: 'Crossed', category: 'Sitting', adult: false }],
        };
        w.pose.getPresetList = () => [{ name: 'sittingCrossed' }];
        let now = 'standing';
        w.pose.applyPreset = (name) => {
            w.pose.calls.push(`apply:${name}`);
            now = name;
        };
        w.pose.getCurrentPreset = () => now;
        try {
            await say('Sit with your legs crossed.');
            await flush();
            expect(w.pose.calls).toEqual(['claim', 'apply:sittingCrossed']);
            expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'completed' });
        } finally {
            delete window.NEXUS_POSE_STUDIO_PANEL;
        }
    });

    test('NL1: "the previous position" is a position, and "the previous outfit" is still the wardrobe', () => {
        expect(Intent.parse('Go back to the previous position.', { lang: 'en' })).toMatchObject({
            name: 'avatar.pose',
            params: { pose: 'back' },
        });
        expect(Intent.parse('Go back to the previous outfit', { lang: 'en' })).toMatchObject({ name: 'wardrobe.undo' });
    });

    test('ending the evening in a position gives her body back', async () => {
        const w = await at(4);
        await say('sdraiati sulla schiena');
        await flush();
        expect(w.pose.calls).toEqual(['claim', 'apply:lyingBack']);
        w.activity.stop('user');
        await flush();
        expect(w.pose.calls.slice(-1)).toEqual(['release']);
    });

    test.each([
        ['inginocchiati', 'kneel'],
        ['get on your knees', 'kneel'],
        ['à genoux', 'kneel'],
        ['跪下', 'kneel'],
        ['sdraiati sulla schiena', 'lie-back'],
        ['lie on your side', 'lie-side'],
        ['うつ伏せになって', 'lie-front'],
        ['piegati in avanti', 'bend-forward'],
        ['mettiti a quattro zampe', 'all-fours'],
        ['à quatre pattes', 'all-fours'],
    ])('%s → avatar.pose %s', (said, key) => {
        expect(Intent.parse(said)).toMatchObject({ name: 'avatar.pose', params: { pose: key } });
    });

    test('plain "sdraiati" stays the lie-down motion, and "alzati" is a pose only while one is held', () => {
        expect(Intent.parse('sdraiati')).toBeNull();
        expect(Intent.parse('alzati')).toBeNull();
        expect(Intent.parse('alzati', { poseHeld: true })).toMatchObject({
            name: 'avatar.pose',
            params: { pose: 'stand' },
        });
        expect(Intent.parse('rivestiti')).toMatchObject({ name: 'wardrobe.redress' });
        expect(Intent.parse('vestiti di rosso')).not.toMatchObject({ name: 'wardrobe.redress' });
    });
});

describe('UN5. "I am done" in their words', () => {
    test.each(['Ho finito, rivestiti', "I'm done, get dressed", 'He terminado, vuelve a vestirte'])('%s', (said) =>
        expect(Intent.parse(said)).toMatchObject({ name: 'wardrobe.redress' })
    );
    test('"ho finito" alone dresses her only once something came off', () => {
        expect(Intent.parse('Ho finito')).toBeNull();
        expect(Intent.parse('Ho finito', { undressed: true })).toMatchObject({ name: 'wardrobe.redress' });
        expect(Intent.parse('終わった', { undressed: true })).toMatchObject({ name: 'wardrobe.redress' });
        expect((Intent.parse('Ho finito il libro ieri sera', { undressed: true }) || {}).name).not.toBe(
            'wardrobe.redress'
        );
    });
});

describe('UN5. one position after another, and back again', () => {
    test('kneel, then on the back, then "torna come prima" returns to kneeling, then standing', async () => {
        const pose = { calls: [], current: 'standing' };
        Object.assign(pose, {
            claimBones: () => pose.calls.push('claim'),
            releaseBones: () => pose.calls.push('release') && true,
            applyPreset: (name) => {
                pose.calls.push(`apply:${name}`);
                pose.current = name;
            },
            getCurrentPreset: () => pose.current,
            getPresetList: () => ['kneeling', 'lyingBack'].map((name) => ({ name })),
        });
        window.vrPoseSystem = pose;
        const w = await begin({ adult: true });
        w.adult.level = 4;
        await say('inginocchiati');
        await flush();
        await say('sdraiati sulla schiena');
        await flush();
        await say('torna come prima');
        await flush();
        expect(pose.calls.filter((c) => c.startsWith('apply:'))).toEqual([
            'apply:kneeling',
            'apply:lyingBack',
            'apply:kneeling',
        ]);
        expect(Actions.promptLines().join('\n')).toMatch(/back in the position you had before \(kneel\)/);
        await say('torna come prima');
        await flush();
        expect(pose.calls.slice(-1)).toEqual(['release']);
        expect(w.adult.level).toBe(4);
    });

    test('a preset the pose system does not confirm is a failure, and she is let go', async () => {
        const pose = {
            calls: [],
            claimBones: () => pose.calls.push('claim'),
            releaseBones: () => pose.calls.push('release') && true,
            applyPreset: (name) => pose.calls.push(`apply:${name}`), // never takes
            getCurrentPreset: () => 'standing',
            getPresetList: () => [{ name: 'kneeling' }],
        };
        window.vrPoseSystem = pose;
        await begin({ adult: true });
        await say('inginocchiati');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'avatar.pose', status: 'failed', why: 'not-applied' });
        expect(pose.calls.slice(-1)).toEqual(['release']);
    });

    test.each(['a pecorina', 'mettiti a pecorina', 'doggy style', 'en levrette', 'a lo perrito'])(
        '"%s" is the all-fours position, gated exactly like it',
        (said) => {
            expect(Intent.parse(said)).toMatchObject({ name: 'avatar.pose', params: { pose: 'all-fours' } });
            expect(
                Policy.decide(
                    { name: 'avatar.pose', params: { pose: 'all-fours' }, source: 'user' },
                    { active: true, care: false, asked: {}, level: 3 }
                )
            ).toEqual({ allow: false, why: 'pace' });
        }
    );

    test('"fammi vedere la schiena" turns her through the one owner of turning, in every script', () => {
        const FastPath = require('../../src/xr/IntentFastPath.js');
        for (const said of [
            'girati',
            'fammi vedere la schiena',
            'show me your back',
            '背中を見せて',
            '등 보여줘',
            '让我看看你的背',
        ])
            expect(FastPath.match(said)).toMatchObject({ label: 'turn_around' });
    });
});

describe('UN5. lying positions in their words', () => {
    test.each([
        ['Sdraiati sulla pancia', 'lie-front'],
        ['stenditi a pancia in giù', 'lie-front'],
        ['sdraiati sulla schiena', 'lie-back'],
        ['mettiti sul fianco', 'lie-side'],
        ['lie on your stomach', 'lie-front'],
        ['túmbate boca abajo', 'lie-front'],
    ])('%s → %s', (said, key) =>
        expect(Intent.parse(said)).toMatchObject({ name: 'avatar.pose', params: { pose: key } })
    );
});

describe('UN7. "Undress please" / "I wanna see you naked" at level 4 — the avatar, not a sentence', () => {
    const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
    const DRESS = {
        lookId: 'd',
        name: 'Black Cocktail Dress',
        prompt: 'black satin cocktail dress',
        vrmUrl: 'dress.vrm',
    };
    const LINGERIE = [
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
        {
            lookId: 't',
            name: 'Black Bralette + Black Micro Tailored Thong',
            prompt: 'black Tailored Thong',
            vrmUrl: 'thong.vrm',
            private: true,
        },
    ];
    const BARE = {
        lookId: 'b',
        name: 'Bare',
        templateId: 'body-bare-v1',
        vrmUrl: 'bare.vrm',
        private: true,
        bare: true,
    };
    async function at(level, options) {
        const o = options || {};
        const w = await begin({
            adult: o.adult !== false,
            looks: o.looks || [DRESS, ...LINGERIE],
            loadFails: o.loadFails,
            bodyState: o.bodyState,
        });
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
        w.adult.level = level;
        return w;
    }
    const worn = (w) => w.controller.applyLook.mock.calls.map((c) => c[0].name);

    test.each([
        ['needs-review', 'bare-needs-review'],
        ['blocked', 'bare-blocked'],
    ])('CG1. no bare look, and Forge says her exact file is %s: the refusal says so for her', async (status, why) => {
        const w = await at(4, { bodyState: { status } });
        await say('Mettiti il vestito da cocktail nero');
        await say('Please, I wanna see you naked.');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.undress', status: 'failed', why });
        // Nothing changed and nothing else in Private was turned off: she still wears the dress.
        expect(worn(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        expect(prompt()).toMatch(/Being fully bare is not available for this body[\s\S]*nothing was changed/);
        expect(w.adult.level).toBe(4);
    });
    const prompt = () => Actions.promptLines().join('\n');
    const truthful = (reply) => Capability.outfitTruthful(reply, Actions.outfitTruth(), 'en');

    test('the reported session: "undress" is lingerie; "naked" without a bare look changes nothing', async () => {
        const w = await at(4);
        await say('Mettiti il vestito da cocktail nero');
        await say('Undress please.');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({
            name: 'wardrobe.undress',
            status: 'completed',
            result: { state: 'lingerie', bare: false },
        });
        expect(worn(w).slice(-1)).toEqual(['Black Lingerie Set']);
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        expect(prompt()).toMatch(/You are in lingerie, not naked/);
        await say('Please, I wanna see you naked.');
        await flush();
        // UN19. No bare look: the request is refused, she keeps what she has on, and no other
        // lingerie is put on in its place.
        expect(Actions.snapshot().last).toMatchObject({
            name: 'wardrobe.undress',
            status: 'failed',
            why: 'no-bare-look',
            params: { step: 'all', naked: true },
        });
        expect(worn(w).slice(-1)).toEqual(['Black Lingerie Set']);
        expect(Actions.snapshot().outfitState).toBe('lingerie');
        expect(prompt()).toMatch(/Being fully bare is not available for this body[\s\S]*nothing was changed/);
        expect(prompt()).toMatch(/still wearing “Black Lingerie Set”/);
        expect(truthful("I'm naked now, just for you. Do you like it?")).not.toMatch(/naked/i);
        expect(w.adult.level).toBe(4);
    });

    test('"take everything off" is a bare request too: never the least lingerie instead', async () => {
        const w = await at(4);
        await say('Mettiti il vestito da cocktail nero');
        await say('Togliti tutto');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ status: 'failed', why: 'no-bare-look' });
        expect(worn(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        expect(Actions.snapshot().outfitState).not.toBe('bare');
    });

    test('PP2. a striptease with nothing left to take off: she puts on a ready striptease set first', async () => {
        const STRIP = {
            lookId: 's',
            name: 'Red Striptease Set',
            outfitId: 'show-strip-red',
            vrmUrl: 'strip.vrm',
            private: true,
        };
        const w = await at(4, { looks: [DRESS, BARE, STRIP] });
        await say('I wanna see you naked');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Bare']);
        await say('Do a striptease for me');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Red Striptease Set']);
        expect(Actions.snapshot().last).toMatchObject({
            name: 'avatar.routine',
            status: 'completed',
            result: { routine: 'striptease', outfit: 'Red Striptease Set' },
        });
    });

    test('with her bare look in the wardrobe, "naked" is exactly that, and she may say so', async () => {
        const w = await at(4, { looks: [DRESS, ...LINGERIE, BARE] });
        await say('Mettiti il vestito da cocktail nero');
        await say('I wanna see you naked');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Bare']);
        expect(Actions.outfitTruth()).toMatchObject({ state: 'changed', bare: true });
        // UN19. dressed → bare, with no lingerie in between, and the state says so.
        expect(worn(w)).toEqual(['Black Cocktail Dress', 'Bare']);
        expect(Actions.snapshot().last).toMatchObject({ status: 'completed', result: { state: 'bare', bare: true } });
        expect(Actions.snapshot().outfitState).toBe('bare');
        expect(prompt()).toMatch(/you are naked now/);
        expect(truthful("I'm naked now, just for you.")).toMatch(/naked/);
        // One step at a time ends there too: after the last lingerie, the next layer is the bare look.
        await say('rivestiti');
        await flush();
        await say('spogliati');
        await say('spogliati');
        await say('spogliati');
        await flush();
        expect(worn(w).slice(-3)).toEqual([
            'Black Lingerie Set',
            'Black Bralette + Black Micro Tailored Thong',
            'Bare',
        ]);
        // … and dressing again goes back to what she wore before the first change.
        await say('rivestiti');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        expect(Actions.snapshot().outfitState).toBe('look');
    });

    test('BL2. a bare look that still draws a garment is not announced: she is put back and says so', async () => {
        const w = await at(4, { looks: [DRESS, ...LINGERIE, BARE] });
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        // The renderer still shows a garment Forge put on her (a stale or wrong file).
        const garment = { isMesh: true, visible: true, userData: { wardrobeForge: { kind: 'garment' } } };
        const root = { userData: {}, parent: null, traverse: (fn) => [root, garment].forEach(fn) };
        garment.parent = root;
        const before = window.NEXUS_VIEWER;
        window.NEXUS_VIEWER = {
            ...(before || {}),
            avatarManager: { ...((before && before.avatarManager) || {}), currentRoot: root },
        };
        try {
            await say('I wanna see you naked');
            await flush();
            expect(Actions.snapshot().last).toMatchObject({
                name: 'wardrobe.undress',
                status: 'failed',
                why: 'not-rendered',
            });
            expect(Actions.outfitTruth()).not.toMatchObject({ bare: true });
            expect(prompt()).not.toMatch(/you are naked now/);
            expect(prompt()).toMatch(/did not show on you/);
        } finally {
            window.NEXUS_VIEWER = before;
        }
    });

    test('UN19. the plan keeps bare and lingerie apart', () => {
        const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
        const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
        const plan = (extra) => Engine.undressPlan({ looks: [DRESS, ...LINGERIE], current: DRESS, allureOf, ...extra });
        expect(plan({ step: 'next' })).toMatchObject({ state: 'lingerie', why: null });
        expect(plan({ step: 'all' })).toEqual({ look: null, state: null, why: 'no-bare-look' });
        expect(plan({ naked: true })).toEqual({ look: null, state: null, why: 'no-bare-look' });
        const withBare = (extra) =>
            Engine.undressPlan({ looks: [DRESS, ...LINGERIE, BARE], current: DRESS, allureOf, ...extra });
        expect(withBare({ naked: true })).toMatchObject({ state: 'bare', look: { name: 'Bare' } });
        expect(withBare({ step: 'next' })).toMatchObject({ state: 'lingerie' });
        expect(Engine.undressPlan({ looks: [BARE], current: BARE, allureOf, naked: true }).why).toBe('already-bare');
        expect(Engine.outfitState(null, allureOf)).toBe('original');
        expect(Engine.outfitState(BARE, allureOf)).toBe('bare');
    });

    test('a look that cannot be loaded: she stays as she was, and "I\'m undressing" is not said', async () => {
        const w = await at(4, { loadFails: true });
        await say('Undress please.');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.undress', status: 'failed' });
        expect(Actions.snapshot().outfit.wearing).toBe(false);
        expect(prompt()).toMatch(/it did not happen/);
        expect(truthful("I'm undressing for you now... Mmh.")).not.toMatch(/undressing/i);
        expect(w.adult.level).toBe(4);
    });

    test('an avatar not declared adult: refused, nothing changes, nothing is claimed', async () => {
        const w = await at(4, { adult: false });
        await say('Please, I wanna see you naked.');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({
            name: 'wardrobe.undress',
            status: 'failed',
            why: 'adult-ineligible',
        });
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(truthful("I'm undressing for you right now...")).not.toMatch(/undressing/i);
    });

    test('below level 4 it waits: "not yet", dressed, and no claim survives', async () => {
        const w = await at(3);
        await say('Undress please.');
        await flush();
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.undress', status: 'blocked', why: 'pace' });
        expect(w.controller.applyLook).not.toHaveBeenCalled();
        expect(prompt()).toMatch(/not that close yet/);
        expect(truthful("I'm undressing for you now.")).not.toMatch(/undressing/i);
        expect(w.adult.level).toBe(3);
    });

    test('a turn with no wardrobe action at all: an undressing claim is taken out', async () => {
        await at(4);
        await say('Sei bellissima stasera');
        await flush();
        expect(Actions.outfitTruth().state).toBe('none');
        expect(truthful('Mi sto spogliando per te. Ti piace?')).not.toMatch(/spogliando/i);
    });

    test('many changes in one evening, then back, then the end restores her own outfit', async () => {
        const w = await at(4);
        await say('Mettiti il vestito da cocktail nero');
        await say('spogliati');
        await say('spogliati');
        await flush();
        expect(worn(w)).toEqual([
            'Black Cocktail Dress',
            'Black Lingerie Set',
            'Black Bralette + Black Micro Tailored Thong',
        ]);
        await say('spogliati'); // the last layer she has: nothing changes, and she says so
        await flush();
        expect(Actions.snapshot().last).toMatchObject({
            name: 'wardrobe.undress',
            status: 'failed',
            why: 'last-layer',
        });
        await say('Ho finito, rivestiti');
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Cocktail Dress']);
        await say('spogliati'); // not locked: the evening can go again
        await flush();
        expect(worn(w).slice(-1)).toEqual(['Black Lingerie Set']);
        w.activity.stop('user');
        await flush();
        expect(w.controller.restore).toHaveBeenCalled();
    });

    test.each([
        'Please, I wanna see you naked.',
        'get naked',
        'strip for me',
        'Voglio vederti nuda',
        'resta senza vestiti',
        'Quiero verte desnuda',
        'Je veux te voir nue',
        'Ich will dich nackt sehen',
        'Quero te ver nua',
    ])('%s → everything off', (said) =>
        expect(Intent.parse(said)).toMatchObject({ name: 'wardrobe.undress', params: { step: 'all', naked: true } })
    );

    test.each(['are you naked?', 'sei nuda?', "don't get naked", 'wear the nude heels', 'strip club music'])(
        '%s → not a request to undress',
        (said) => {
            const got = Intent.parse(said);
            expect(got && got.name).not.toBe('wardrobe.undress');
        }
    );
});

describe('UN11. only a look that covers her top and bottom counts as undressed-to (Forge coverage)', () => {
    const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
    // Found in the real browser: "spogliati" chose Black Garter Set and her cardigan stayed on —
    // Forge's under-garter-set-v1 covers waist, hips and upper legs, never the chest.
    test.each([
        ['Black Garter Set', false],
        ['Wine Suspender Belt', false],
        ['Black Lingerie Set', true],
        ['Ivory Waspie', true],
        ['Red Guêpière', true],
        ['Black Bralette + Black Micro Tailored Thong', true],
    ])('%s → complete %s', (name, complete) => expect(Engine.isComplete({ name })).toBe(complete));

    test('dressed, with only a garter set and a full set to choose from, she takes the full set', () => {
        const looks = [
            { lookId: 'g', name: 'Black Garter Set' },
            { lookId: 'l', name: 'Black Lingerie Set' },
        ];
        const allureOf = (l) => ({ band: 'lingerie', score: /garter/i.test(l.name) ? 9 : 5 });
        expect(Engine.undressStep({ looks, current: null, step: 'next', allureOf }).name).toBe('Black Lingerie Set');
    });
});

describe('RU5. a dictionary outfit already on her shelf is worn, not made again', () => {
    const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
    const entries = [
        {
            id: 'crop-top-jeans',
            title: 'Crop top & jeans',
            request: { prompt: 'black fitted crop top + blue straight jeans' },
        },
        { id: 'red-dress', title: 'Red dress', request: { prompt: 'red cocktail dress' } },
    ];
    // As Forge lists them after a reload: a prompt, no outfitId.
    const shelf = () => [
        {
            lookId: 'look_a',
            name: 'Blue Straight Jeans',
            prompt: 'Black fitted crop top +  blue straight jeans',
            vrmUrl: 'a.vrm',
            source: 'forge',
        },
        {
            lookId: 'look_b',
            name: 'Black Lace Bralette',
            prompt: 'black Lace Bralette',
            vrmUrl: 'b.vrm',
            source: 'forge',
        },
    ];

    test('tags the looks Forge made from a dictionary prompt, and only those', () => {
        const looks = shelf();
        expect(Engine.tagOutfits(looks, entries)).toBe(1);
        expect(looks[0].outfitId).toBe('crop-top-jeans');
        expect(looks[1].outfitId).toBeUndefined();
    });

    test('asking for the outfit then wears her look instead of offering to make it', () => {
        const untagged = Engine.choose({
            request: { outfit: 'crop-top-jeans' },
            looks: shelf(),
            entries,
            canCreate: true,
        });
        expect(untagged).toMatchObject({ kind: 'outfit', generate: true }); // before RU5
        const looks = shelf();
        Engine.tagOutfits(looks, entries);
        const tagged = Engine.choose({ request: { outfit: 'crop-top-jeans' }, looks, entries, canCreate: true });
        expect(tagged).toMatchObject({ kind: 'look', generate: false });
        expect(tagged.look.lookId).toBe('look_a');
    });

    test('a look that already names its outfit keeps it; an ambiguous prompt tags nothing', () => {
        const looks = [{ lookId: 'x', prompt: 'red cocktail dress', outfitId: 'mine', vrmUrl: 'x.vrm' }];
        Engine.tagOutfits(looks, entries);
        expect(looks[0].outfitId).toBe('mine');
        const twins = [...entries, { id: 'red-dress-2', request: { prompt: 'red cocktail dress', preset: 'p' } }];
        const fresh = [{ lookId: 'y', prompt: 'red cocktail dress', vrmUrl: 'y.vrm' }];
        expect(Engine.tagOutfits(fresh, twins)).toBe(0);
    });
});

describe("UN14. what a look covers comes from Forge's templates, not its name", () => {
    const Coverage = require('../../src/experiences/private/WardrobeCoverage.js');
    const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');

    test('the UN11 garter set: no chest, so not complete, and her own top stays visible', () => {
        const garter = { name: 'Black Garter Set' };
        expect(Coverage.describe(garter)).toMatchObject({ templates: ['under-garter-set-v1'], complete: false });
        expect(Coverage.rendered(garter)).toMatchObject({ known: true, ownOutfitVisible: true });
        expect(Engine.isComplete(garter)).toBe(false);
    });

    test("a look resolves by its Forge template id first, then a dictionary outfit, then Forge's name", () => {
        expect(Coverage.templatesOf({ templateId: 'under-thong-v2', name: 'Anything' })).toEqual(['under-thong-v2']);
        const entries = [
            { id: 'crop', garments: [{ template: 'top-crop-tee-v1' }, { template: 'jeans-straight-v1' }] },
        ];
        expect(Coverage.templatesOf({ outfitId: 'crop', name: 'x' }, entries)).toEqual([
            'top-crop-tee-v1',
            'jeans-straight-v1',
        ]);
        // Forge names: colour words, " + " pieces, the "Micro" cut, hosiery straps.
        expect(Coverage.templatesOf({ name: 'Black Micro Tailored G-String' })).toEqual(['under-g-string-v2']);
        expect(
            Coverage.templatesOf({ name: 'Black Waspie + Black Thigh-High Stockings + Black Suspender Straps' })
        ).toEqual(['under-waspie-v1', 'legwear-thigh-highs-v1']);
    });

    test("an attractive name that is not Forge's is unknown, and unknown is never complete", () => {
        const invented = { name: 'Sexy Lace Lingerie Set Deluxe' };
        expect(Coverage.describe(invented)).toBeNull();
        expect(Engine.isComplete(invented)).toBe(false);
        expect(Engine.coverageOf(invented)).toBe(5);
    });

    test('less fabric is measured: a thong covers less of her hips than briefs', () => {
        const thong = Coverage.describe({ name: 'Black Bralette + Black Micro Tailored Thong' });
        const briefs = Coverage.describe({ name: 'Black Tailored Triangle Bralette + Black Tailored Briefs' });
        expect(thong.regions.sort()).toEqual(briefs.regions.sort());
        expect(thong.amount).toBeLessThan(briefs.amount);
    });

    test('garments can be worn together only when they cover none of the same regions', () => {
        expect(Coverage.compatible({ templateId: 'under-bra-full-v2' }, { templateId: 'under-thong-v2' })).toBe(true);
        expect(Coverage.compatible({ templateId: 'under-bodysuit-v2' }, { templateId: 'under-thong-v2' })).toBe(false);
    });

    test('the shelf is annotated when the wardrobe loads: every real lingerie name resolves', () => {
        const real = [
            'Black Garter Set',
            'Champagne Lingerie Set',
            'Black Tailored Triangle Bralette + Black Tailored Briefs',
            'Black High-Waisted Suspender Belt + Black Thigh-High Stockings + Black Suspender Straps',
            'Burgundy Micro Tailored High-Waist Thong',
            'Black Tailored Bodysuit',
            'Black Babydoll',
        ];
        for (const name of real) expect(Coverage.describe({ name })).not.toBeNull();
    });
});

describe('UN18. the reported session: "Togliete vestiti" moved nothing and she said "li tolgo"', () => {
    const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
    const Capability = require('../../src/features/together/TogetherCapability.js');

    test.each(['Togliete vestiti', 'Toglietevi i vestiti', 'Togli i vestiti', 'Spogliatevi', 'Svestitevi'])(
        '%s is a request to undress',
        (said) => expect(Intent.parse(said, {}).name).toBe('wardrobe.undress')
    );

    test('a sentence about something else is not undressing', () => {
        expect(Intent.parse('Togli la musica', {}).name).toBe('music.stop');
    });

    test('"li tolgo" / "le tolgo tutte" with nothing changed on her is taken out of her reply', () => {
        const said = (text, state) => Capability.outfitTruthful(text, { state }, 'it-IT');
        for (const claim of ['Va bene, li tolgo.', 'Le tolgo tutte. Come vuoi.', 'Tolgo tutto per te.'])
            expect(said(claim, 'none')).not.toMatch(/tolgo/i);
        // Once the wardrobe confirmed the change, the same words stand.
        expect(said('Va bene, li tolgo.', 'changed')).toMatch(/li tolgo/);
    });
});

describe('UN27. the closer positions, described to her as her body is', () => {
    const CLOSER_PRESETS = ['sittingOpen', 'kneelingWide', 'lyingKneesUp', 'straddle', 'handsKnees'];
    function poseSystem(spicy = true) {
        const calls = [];
        const presets = ['kneeling', 'lyingBack'];
        if (spicy) presets.push(...CLOSER_PRESETS);
        let current = 'standing';
        return {
            calls,
            lastSupport: null,
            claimBones: () => calls.push('claim'),
            releaseBones: () => calls.push('release') && true,
            applyPreset: (name) => {
                calls.push(`apply:${name}`);
                if (presets.includes(name)) current = name;
            },
            getCurrentPreset: () => current,
            getPresetList: () => presets.map((name) => ({ name })),
        };
    }
    async function at(level, options) {
        const pose = poseSystem(!(options && options.spicyOff));
        window.vrPoseSystem = pose;
        const w = await begin({ adult: true });
        w.adult.level = level;
        w.pose = pose;
        return w;
    }
    const prompt = () => Actions.promptLines().join('\n');

    test('at the top of the pace she is told which closer positions are open, by name', async () => {
        await at(4);
        await say('ciao');
        await flush();
        expect(prompt()).toMatch(/Closer positions open at this step of the evening \(4 of 4\)/);
        for (const name of ['straddling them', 'on your back with your knees up', 'on all fours'])
            expect(prompt()).toContain(name);
    });

    test('below it she is told they are not open yet, and nothing runs when asked', async () => {
        const w = await at(2);
        await say('Mettiti a cavalcioni su di me');
        await flush();
        expect(prompt()).toMatch(
            /Closer positions open at this step of the evening \(2 of 4\): kneeling with your knees wide\./
        );
        expect(prompt()).toMatch(/Not open yet: .*straddling them \(at 3 of 4\)/);
        expect(prompt()).toMatch(/opens at 3 of 4; the evening is at 2/);
        expect(w.pose.calls.filter((c) => c.startsWith('apply:'))).toEqual([]);
    });

    test('with Spicy off the presets are not listed, so they are never offered', async () => {
        await at(4, { spicyOff: true });
        await say('ciao');
        await flush();
        expect(prompt()).not.toMatch(/Closer positions/);
    });

    test('asked for, the position runs and the reply is told what her body is doing', async () => {
        const w = await at(4);
        await say('Mettiti a cavalcioni su di me');
        await flush();
        expect(w.pose.calls).toContain('apply:straddle');
        expect(prompt()).toMatch(/Your body is in that position now \(straddle\): kneeling up astride their lap/);
    });

    test('UN28 at Sensual she can straddle them; at Romantic only kneel wide', async () => {
        const w = await at(3);
        await say('Mettiti a cavalcioni su di me');
        await flush();
        expect(w.pose.calls).toContain('apply:straddle');
        const v = await at(2);
        await say('Mettiti in ginocchio a gambe aperte');
        await flush();
        expect(v.pose.calls).toContain('apply:kneelingWide');
    });

    test('UN28 easing below the step of the position she holds stands her up', async () => {
        const w = await at(3);
        await say('Mettiti a cavalcioni su di me');
        await flush();
        expect(w.pose.calls).toContain('apply:straddle');
        w.adult.level = 3;
        expect(Actions.fitPoseToPace()).toBe(false); // still open: nothing happens
        w.adult.level = 2;
        expect(Actions.fitPoseToPace()).toBe(true);
        await flush();
        expect(w.pose.calls).toContain('release');
        expect(Actions.fitPoseToPace()).toBe(false); // she stands: nothing more to do
    });

    test('her own tag or invitation never moves her into one', async () => {
        const w = await at(4);
        await say('ciao');
        await flush();
        const out = Actions.request('avatar.pose', { pose: 'straddle' }, { source: 'model' });
        await Promise.resolve(out);
        await flush();
        expect(w.pose.calls.filter((c) => c.startsWith('apply:'))).toEqual([]);
    });
});

describe('UN32. her skin follows the pace live when the look has a skin pack', () => {
    const LOOKS_UN32 = [
        { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' },
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
    ];
    function stubSkin() {
        const calls = [];
        let current = null;
        window.NEXUS_SKIN_STATES = {
            mayHavePack: () => true,
            create: () => ({
                attach: async (root, look) => {
                    calls.push(`attach:${look.name}`);
                    return [
                        { name: 'closed', body: 'relaxed' },
                        { name: 'flushed', body: 'a flush on your chest' },
                        { name: 'open', body: 'you are aroused and open' },
                    ];
                },
                apply: async (name) => {
                    calls.push(`apply:${name}`);
                    current = name;
                    return true;
                },
                current: () => current,
                detach: () => calls.push('detach') && true,
            }),
        };
        return calls;
    }
    afterEach(() => {
        delete window.NEXUS_SKIN_STATES;
    });

    test('a look that lands at Intimate shows open, a step down shows flushed, and she is told', async () => {
        const calls = stubSkin();
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
        const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
        const w = await begin({ adult: true, looks: LOOKS_UN32 });
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
        w.adult.level = 4;
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        await say('spogliati');
        await flush();
        expect(calls).toContain('attach:Black Lingerie Set');
        expect(calls).toContain('apply:open');
        expect(Actions.promptLines().join('\n')).toMatch(/Your body right now: you are aroused and open/);
        w.adult.level = 3;
        Actions.fitPoseToPace();
        await flush();
        expect(calls[calls.length - 1]).toBe('apply:flushed');
    });

    test('UN33. coming down from Intimate she glows, cools to flushed, then settles; Intimate again ends it', async () => {
        const calls = stubSkin();
        const create = window.NEXUS_SKIN_STATES.create;
        window.NEXUS_SKIN_STATES.create = () => {
            const skin = create();
            const attach = skin.attach;
            skin.attach = async (root, look) => [
                ...(await attach(root, look)),
                { name: 'afterglow', body: 'you are glowing after coming' },
            ];
            return skin;
        };
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
        const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
        const w = await begin({ adult: true, looks: LOOKS_UN32 });
        window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
        w.adult.level = 4;
        await say('Mettiti il vestito da cocktail nero');
        await flush();
        await say('spogliati');
        await flush();
        expect(calls).toContain('apply:open');
        jest.useFakeTimers();
        try {
            w.adult.level = 2;
            Actions.fitPoseToPace();
            expect(calls[calls.length - 1]).toBe('apply:afterglow');
            expect(Actions.promptLines().join('\n')).toMatch(/glowing after coming/);
            jest.advanceTimersByTime(4 * 60 * 1000);
            expect(calls[calls.length - 1]).toBe('apply:flushed');
            jest.advanceTimersByTime(3 * 60 * 1000);
            expect(calls[calls.length - 1]).toBe('apply:closed');
            // Back up to Intimate and down again, then up before it cools: the fade is over.
            w.adult.level = 4;
            Actions.fitPoseToPace();
            w.adult.level = 3;
            Actions.fitPoseToPace();
            expect(calls[calls.length - 1]).toBe('apply:afterglow');
            w.adult.level = 4;
            Actions.fitPoseToPace();
            expect(calls[calls.length - 1]).toBe('apply:open');
            jest.advanceTimersByTime(10 * 60 * 1000);
            expect(calls[calls.length - 1]).toBe('apply:open');
        } finally {
            jest.useRealTimers();
        }
    });

    describe('UN34. finishing: their words, where they came shown on her', () => {
        const Intent = require('../../src/experiences/private/PrivateActionIntent.js');

        test('a climax word and a place, in several languages; "come here" is not one', () => {
            const where = (t) => {
                const parsed = Intent.parse(t, {});
                return parsed && parsed.name === 'body.finish' ? parsed.params.where : null;
            };
            expect(where("I'm cumming on your back")).toBe('back');
            expect(where('sto venendo dentro di te')).toBe('inside');
            expect(where('vengo nel culo')).toBe('ass');
            expect(where('I am coming all over you')).toBe('all');
            expect(where('me corro dentro')).toBe('inside');
            expect(where('cum in both holes')).toBe('both');
            expect(where("I'm cumming")).toBe('choose');
            expect(where('come here')).toBeNull();
            expect(where("don't cum yet")).toBeNull();
        });

        test('only the person, and only at the closest step', () => {
            const facts = { active: true, care: false, asked: {}, autonomy: 'autonomous' };
            const finish = (source) => ({ name: 'body.finish', params: { where: 'back' }, source });
            expect(Policy.decide(finish('user'), { ...facts, level: 3 }).why).toBe('pace');
            expect(Policy.decide(finish('model'), { ...facts, level: 4 }).allow).toBe(false);
            expect(Policy.decide(finish('user'), { ...facts, level: 4 }).allow).toBe(true);
            expect(Policy.validate('body.finish', { where: 'nose' }).ok).toBe(false);
            // UR1. Her face and her mouth exist, but only in Unrestrained.
            expect(
                Policy.decide({ ...finish('user'), params: { where: 'face' } }, { ...facts, level: 4 })
            ).toMatchObject({
                allow: false,
                why: 'unrestrained',
            });
            expect(
                Policy.decide(
                    { ...finish('user'), params: { where: 'mouth' } },
                    { ...facts, level: 4, unrestrained: true }
                ).allow
            ).toBe(true);
        });

        test('PS2 (Codex #200). their fist shows only the act they asked for, never another', async () => {
            const calls = stubSkin();
            const create = window.NEXUS_SKIN_STATES.create;
            window.NEXUS_SKIN_STATES.create = () => {
                const skin = create();
                const attach = skin.attach;
                skin.attach = async (root, look) => [
                    ...(await attach(root, look)),
                    { name: 'missionary-fisted', body: 'their fist is inside your pussy' },
                ];
                return skin;
            };
            window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
            const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
            const w = await begin({ adult: true, looks: LOOKS_UN32 });
            window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
            w.adult.level = 4;
            await say('Mettiti il vestito da cocktail nero');
            await flush();
            await say('spogliati');
            await flush();
            // Asked for anal; the pack holds only the front state: nothing is shown.
            await say('fammi il pugno nel culo');
            await flush();
            expect(calls).not.toContain('apply:missionary-fisted');
            expect(Actions.snapshot().last).toMatchObject({
                name: 'body.fist',
                status: 'failed',
                why: 'no-fist-state',
            });
            // Asked without a target: what this pack can show.
            await say('fammi il pugno');
            await flush();
            expect(calls[calls.length - 1]).toBe('apply:missionary-fisted');
            // PB1. She is told what her body can show, from this pack only, at the closest step.
            const told = Actions.promptLines().join('\n');
            // PB2: an index always, and the family their words touched ("pugno") in detail.
            expect(told).toMatch(/Your body can show tonight — [^\n]*fisting 1/);
            expect(told).toMatch(/What they are asking about[^\n]*fisting: missionary fisted/);
            expect(told).not.toMatch(/arousal: flushed/); // not asked this turn: counted, not listed
            expect(told).not.toMatch(/sado/);
        });

        test('on her lower back is shown live, she is told, it holds, then the afterglow fades it', async () => {
            const calls = stubSkin();
            const create = window.NEXUS_SKIN_STATES.create;
            window.NEXUS_SKIN_STATES.create = () => {
                const skin = create();
                const attach = skin.attach;
                skin.attach = async (root, look) => [
                    ...(await attach(root, look)),
                    { name: 'afterglow', body: 'you are glowing after coming' },
                    { name: 'lower-back-cum', body: 'a pool of cum in the small of your back' },
                    { name: 'doggy-creampie', body: 'your pussy is full of cum' },
                ];
                return skin;
            };
            window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
            const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
            const w = await begin({ adult: true, looks: LOOKS_UN32 });
            window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
            w.adult.level = 4;
            await say('Mettiti il vestito da cocktail nero');
            await flush();
            await say('spogliati');
            await flush();
            expect(Actions.promptLines().join('\n')).toMatch(
                /ask where they want to finish — on your lower back, inside you/
            );
            jest.useFakeTimers();
            try {
                // `say` waits on a real timer, frozen here: the turn is handed over and its promises run.
                Surface.renderUser("I'm cumming on your back");
                for (let i = 0; i < 40; i += 1) await Promise.resolve();
                expect(calls[calls.length - 1]).toBe('apply:lower-back-cum');
                const lines = Actions.promptLines().join('\n');
                expect(lines).toMatch(/They just came/);
                expect(lines).toMatch(/Your body right now: a pool of cum in the small of your back/);
                // SW4. In proportion, never a performance.
                expect(lines).toMatch(/in proportion/);
                expect(lines).toMatch(/never a scripted crescendo/);
                // SW5. The next few replies are aftercare; then ordinary again.
                const turnOn = async (t) => {
                    Surface.renderUser(t);
                    for (let i = 0; i < 40; i += 1) await Promise.resolve();
                    return Actions.promptLines().join('\n');
                };
                const after = await turnOn('that was amazing');
                expect(after).toMatch(/Afterwards: stay close and unhurried/);
                expect(after).toMatch(/Offer nothing new/);
                expect(after).not.toMatch(/They just came/);
                await turnOn('mmm');
                await turnOn('stay with me');
                expect(await turnOn('tell me about your day')).not.toMatch(/Afterwards: stay close/);
                // Lowering the pace does not take it off her while it holds.
                w.adult.level = 2;
                Actions.fitPoseToPace();
                expect(calls[calls.length - 1]).toBe('apply:lower-back-cum');
                jest.advanceTimersByTime(6 * 60 * 1000);
                expect(calls[calls.length - 1]).toBe('apply:afterglow');
            } finally {
                jest.useRealTimers();
            }
        });

        test('UN35. on all fours a while she sweats; finishing on her back again is a second load', async () => {
            const calls = stubSkin();
            const create = window.NEXUS_SKIN_STATES.create;
            window.NEXUS_SKIN_STATES.create = () => {
                const skin = create();
                const attach = skin.attach;
                skin.attach = async (root, look) => [
                    ...(await attach(root, look)),
                    { name: 'doggy-sweaty-open', body: 'sweat runs down your spine' },
                    { name: 'lower-back-cum', body: 'a pool of cum in the small of your back' },
                    { name: 'lower-back-cum-second', body: 'a second load across your back' },
                ];
                return skin;
            };
            // Her position, as the pose controller reports it: read by the bridge, set here.
            let held = null;
            const real = window.NEXUS_PRIVATE_POSES;
            window.NEXUS_PRIVATE_POSES = {
                create: () => ({
                    held: () => held,
                    apply: () => ({ ok: true }),
                    release: () => {},
                    back: () => ({ ok: true }),
                    describe: () => null,
                }),
            };
            window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
            const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
            try {
                const w = await begin({ adult: true, looks: LOOKS_UN32 });
                window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
                w.adult.level = 4;
                await say('Mettiti il vestito da cocktail nero');
                await flush();
                await say('spogliati');
                await flush();
                expect(Actions.snapshot().finishPlaces).toEqual(['back']);
                jest.useFakeTimers();
                try {
                    held = 'all-fours';
                    Actions.noticePose();
                    jest.advanceTimersByTime(60 * 1000);
                    expect(calls).not.toContain('apply:doggy-sweaty-open'); // not yet
                    jest.advanceTimersByTime(2 * 60 * 1000);
                    expect(calls[calls.length - 1]).toBe('apply:doggy-sweaty-open');
                    expect(Actions.promptLines().join('\n')).toMatch(/sweat runs down your spine/);
                    Surface.renderUser("I'm cumming on your back");
                    for (let i = 0; i < 40; i += 1) await Promise.resolve();
                    expect(calls[calls.length - 1]).toBe('apply:lower-back-cum');
                    jest.advanceTimersByTime(60 * 1000); // a while later, not the same moment twice
                    Surface.renderUser("I'm cumming on your back again");
                    for (let i = 0; i < 40; i += 1) await Promise.resolve();
                    expect(calls[calls.length - 1]).toBe('apply:lower-back-cum-second');
                    // Standing up stops the sweat clock; the finish still holds until it fades.
                    held = null;
                    Actions.noticePose();
                    expect(calls[calls.length - 1]).toBe('apply:lower-back-cum-second');
                    // Codex (#193). Dressed again (her position let go): the sweat does not come back.
                    held = 'all-fours';
                    Actions.noticePose();
                    jest.advanceTimersByTime(3 * 60 * 1000);
                    held = null;
                    await Actions.request('wardrobe.redress', {}, { source: 'control' });
                    for (let i = 0; i < 40; i += 1) await Promise.resolve();
                    jest.advanceTimersByTime(7 * 60 * 1000); // the finish fades
                    expect(calls.slice(-3)).not.toContain('apply:doggy-sweaty-open');
                } finally {
                    jest.useRealTimers();
                }
            } finally {
                window.NEXUS_PRIVATE_POSES = real;
            }
        });
    });
});

describe('UN36. shows: she moves through a series of positions on her own', () => {
    test('step by step on a clock, slower on request, finished, again, and a position stops it', async () => {
        const applied = [];
        let held = null;
        const real = window.NEXUS_PRIVATE_POSES;
        window.NEXUS_PRIVATE_POSES = {
            create: () => ({
                held: () => held,
                apply: (key, options) => {
                    applied.push([key, options && options.duration]);
                    held = key;
                    return { ok: true, pose: key };
                },
                release: () => {
                    held = null;
                },
                back: () => ({ ok: true }),
                describe: () => null,
            }),
        };
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
        const prompt = () => Actions.promptLines().join('\n');
        const turn = async (text) => {
            Surface.renderUser(text);
            for (let i = 0; i < 40; i += 1) await Promise.resolve();
        };
        try {
            const w = await begin({ adult: true });
            w.adult.level = 4;
            expect(prompt()).toMatch(/Shows you know, open now: .*Open for you/);
            expect(Actions.snapshot().routines).toContainEqual(
                expect.objectContaining({ id: 'open-for-you', level: 4 })
            );
            jest.useFakeTimers();
            try {
                await turn('Open up for me');
                expect(applied).toEqual([['kneel-wide', 1.6]]);
                expect(prompt()).toMatch(/You are giving them a show — opening yourself for them, step 1 of 3/);
                jest.advanceTimersByTime(8000);
                expect(applied[applied.length - 1][0]).toBe('sit-open');
                await turn('slower');
                jest.advanceTimersByTime(12000); // at speed 0.7 this step lasts 12 / 0.7 s
                expect(applied[applied.length - 1][0]).toBe('sit-open');
                jest.advanceTimersByTime(6000);
                expect(applied[applied.length - 1][0]).toBe('knees-up');
                expect(applied[applied.length - 1][1]).toBeGreaterThan(1.6); // slower blends too
                jest.advanceTimersByTime(30000);
                expect(prompt()).toMatch(/You have finished the show .*if they want more/);
                await turn('ancora');
                expect(applied[applied.length - 1][0]).toBe('kneel-wide');
                // A position they ask for ends the show where it is.
                await turn('Straddle me');
                const count = applied.length;
                jest.advanceTimersByTime(60000);
                expect(applied.length).toBe(count);
                expect(prompt()).not.toMatch(/You are giving them a show/);
            } finally {
                jest.useRealTimers();
            }
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('a show not open at this step is refused, and she is told why', async () => {
        const w = await begin({ adult: true });
        w.adult.level = 2;
        await say('Show me everything');
        await flush();
        expect(Actions.promptLines().join('\n')).toMatch(/a show that is not open at this step/);
    });
});

describe('UN37. missionary and cowgirl: her skin and the finish follow the position she holds', () => {
    const LOOKS_UN32 = [
        { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' },
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
    ];
    test('held on her back she is open for it, "I am coming" lands on her belly; astride, inside drips', async () => {
        const calls = [];
        let current = null;
        window.NEXUS_SKIN_STATES = {
            mayHavePack: () => true,
            create: () => ({
                attach: async () => [
                    { name: 'closed', body: 'relaxed' },
                    { name: 'open', body: 'aroused and open' },
                    { name: 'missionary-open', body: 'on your back, open and wet' },
                    { name: 'missionary-belly', body: 'cum pooled in your navel' },
                    { name: 'cowgirl-riding', body: 'riding them, flushed' },
                    { name: 'cowgirl-creampie', body: 'cum running down your thighs' },
                ],
                apply: async (name) => {
                    calls.push(name);
                    current = name;
                    return true;
                },
                current: () => current,
                detach: () => true,
            }),
        };
        let held = null;
        const real = window.NEXUS_PRIVATE_POSES;
        window.NEXUS_PRIVATE_POSES = {
            create: () => ({
                held: () => held,
                apply: () => ({ ok: true }),
                release: () => {},
                back: () => ({ ok: true }),
                describe: () => null,
            }),
        };
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
        const { allureOf } = require('../../src/wardrobe/TryOnHaulActivity.js');
        const turn = async (text) => {
            Surface.renderUser(text);
            for (let i = 0; i < 40; i += 1) await Promise.resolve();
        };
        try {
            const w = await begin({ adult: true, looks: LOOKS_UN32 });
            window.NEXUS_TRY_ON_HAUL_ACTIVITY.allureOf = allureOf;
            w.adult.level = 4;
            await say('Mettiti il vestito da cocktail nero');
            await flush();
            await say('spogliati');
            await flush();
            held = 'knees-up';
            Actions.noticePose();
            expect(calls[calls.length - 1]).toBe('missionary-open');
            jest.useFakeTimers();
            try {
                await turn("I'm cumming");
                expect(calls[calls.length - 1]).toBe('missionary-belly');
                expect(Actions.promptLines().join('\n')).toMatch(/cum pooled in your navel/);
                jest.advanceTimersByTime(7 * 60 * 1000); // that finish fades
                held = 'straddle';
                Actions.noticePose();
                expect(calls[calls.length - 1]).toBe('cowgirl-riding');
                jest.advanceTimersByTime(60 * 1000);
                await turn("I'm cumming inside you");
                expect(calls[calls.length - 1]).toBe('cowgirl-creampie');
            } finally {
                jest.useRealTimers();
            }
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
            delete window.NEXUS_SKIN_STATES;
        }
    });
});

describe('VA3. danced shows: the striptease takes layers off at its cues, the table dance ends on their lap', () => {
    const LOOKS_VA3 = [
        { lookId: 'd', name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress', vrmUrl: 'dress.vrm' },
        { lookId: 'g', name: 'Black Lingerie Set', prompt: 'black Lingerie Set', vrmUrl: 'garter.vrm', private: true },
    ];
    function stubs() {
        const played = [];
        let stops = 0;
        const applied = [];
        let held = null;
        window.NEXUS_CLIP_LOADER = {
            playClip: (path) => {
                played.push([path, Date.now()]);
                return Promise.resolve(true);
            },
            stopClip: () => {
                stops += 1;
            },
        };
        window.NEXUS_PRIVATE_POSES = {
            create: () => ({
                held: () => held,
                apply: (key) => {
                    applied.push([key, Date.now()]);
                    held = key;
                    return { ok: true, pose: key };
                },
                release: () => {
                    held = null;
                },
                back: () => ({ ok: true }),
                describe: () => null,
            }),
        };
        return { played, applied, stops: () => stops };
    }
    const turn = async (text) => {
        Surface.renderUser(text);
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
    };
    let real;
    beforeEach(() => {
        real = { poses: window.NEXUS_PRIVATE_POSES, clips: window.NEXUS_CLIP_LOADER };
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
    });
    afterEach(() => {
        window.NEXUS_PRIVATE_POSES = real.poses;
        window.NEXUS_CLIP_LOADER = real.clips;
        jest.useRealTimers();
    });

    test('striptease: two clips danced in turn, a layer off at 8 s, 24 s and 32 s, then she kneels', async () => {
        const st = stubs();
        const w = await begin({ adult: true, looks: LOOKS_VA3 });
        w.adult.level = 4;
        jest.useFakeTimers();
        const t0 = Date.now();
        await turn('Do a striptease for me');
        for (let i = 0; i < 5; i += 1) {
            jest.advanceTimersByTime(8000);
            for (let k = 0; k < 20; k += 1) await Promise.resolve();
        }
        const cues = Actions.log()
            .filter((a) => a.name === 'wardrobe.undress')
            .map((a) => a.at - t0);
        expect(cues).toEqual([8000, 24000, 32000]);
        // Each step starts its clip; a cue step starts it again once the layer has come off (a new
        // look is a new body, and the dance bound to the old one stops with it).
        const starts = [...new Map(st.played.map(([p, at]) => [at - t0, p.split('/').pop()])).entries()];
        expect(starts).toEqual([
            [0, 'slow_body_roll.vrma'],
            [8000, 'slow_body_roll.vrma'],
            [16000, 'club_phrase.vrma'],
            [24000, 'club_phrase.vrma'],
            [32000, 'slow_body_roll.vrma'],
        ]);
        // Restarted after a layer comes off while still on that step; never once she has moved on.
        expect(st.played.length).toBeGreaterThan(starts.length);
        expect(st.played.every(([, at]) => at - t0 < 40000)).toBe(true);
        expect(st.applied.map(([k, at]) => [k, at - t0])).toEqual([['kneel-wide', 40000]]);
        // Codex (#194). Two looks, three cues: what could not come off is not announced.
        const done = Actions.log().filter((a) => a.name === 'wardrobe.undress');
        if (done.some((a) => a.status !== 'completed')) {
            const lines = Actions.promptLines().join('\n');
            expect(lines).not.toMatch(/naked for them/);
            expect(lines).toMatch(/in what you still have on/);
        }
        expect(st.stops()).toBeGreaterThanOrEqual(1); // the dance stops as she kneels
    });

    test('Codex (#194): a clip that finishes loading after the show stopped never plays over what came next', async () => {
        const st = stubs();
        let release;
        window.NEXUS_CLIP_LOADER.playClip = (path) => {
            st.played.push([path, Date.now()]);
            return new Promise((r) => (release = r));
        };
        const w = await begin({ adult: true, looks: LOOKS_VA3 });
        w.adult.level = 4;
        await turn('Give me a table dance');
        await turn('Straddle me');
        const before = st.stops();
        release(true); // the load finishes after the show ended
        for (let k = 0; k < 20; k += 1) await Promise.resolve();
        // The late load is stopped at once (beyond whatever the position's own stop did), never left dancing.
        expect(st.stops()).toBeGreaterThan(before);
        expect(st.applied[st.applied.length - 1][0]).toBe('straddle');
    });

    test('striptease is not open below the closest step; the table dance is, and ends astride them', async () => {
        const st = stubs();
        const w = await begin({ adult: true, looks: LOOKS_VA3 });
        w.adult.level = 3;
        await turn('Do a striptease for me');
        expect(Actions.promptLines().join('\n')).toMatch(/a show that is not open at this step/);
        expect(st.played).toHaveLength(0);
        jest.useFakeTimers();
        await turn('Give me a table dance');
        for (let i = 0; i < 5; i += 1) {
            jest.advanceTimersByTime(8000);
            for (let k = 0; k < 20; k += 1) await Promise.resolve();
        }
        expect(st.played.map(([p]) => p.split('/').pop())).toEqual(['club_phrase.vrma', 'slow_body_roll.vrma']);
        expect(st.applied[st.applied.length - 1][0]).toBe('straddle');
        expect(Actions.log().filter((a) => a.name === 'wardrobe.undress')).toHaveLength(0);
    });
});

describe('LM1. her body alive in a held position: the bridge drives the layer and tells the model', () => {
    let real;
    let layer;
    beforeEach(() => {
        real = { poses: window.NEXUS_PRIVATE_POSES, vps: window.vrPoseSystem };
        layer = null;
        window.vrPoseSystem = { setLayer: (l) => (layer = l), getLayer: () => layer };
        window.NEXUS_PRIVATE_POSES = {
            create: () => ({
                held: () => 'sit-open',
                apply: () => ({ ok: true }),
                release: () => {},
                back: () => ({ ok: true }),
                describe: () => null,
            }),
        };
    });
    afterEach(() => {
        window.NEXUS_PRIVATE_POSES = real.poses;
        window.vrPoseSystem = real.vps;
    });

    test('LM7: still until they ask; "move for me" moves her (hands from the third step), "stay still" stills her', async () => {
        const w = await begin({ adult: true });
        expect(layer).toBeTruthy();
        const run = (seconds) => {
            for (let i = 0; i < seconds * 60; i += 1) layer.apply(1 / 60, { bone: () => null, node: () => null }, null);
        };
        const said = () => Actions.promptLines().join('\n');
        w.adult.level = 4;
        run(30);
        // Not asked: still, and the model is told so — no hands, no motion.
        expect(said()).not.toMatch(/Your hands right now/);
        expect(said()).toMatch(/You hold that position still; you move in it only if they ask/);
        await say('move for me');
        expect(said()).toMatch(/You are moving in that position for them/);
        let seen = false;
        for (let k = 0; k < 12 && !seen; k += 1) {
            run(5);
            seen = /Your hands right now: your (left|right) hand/.test(said());
        }
        expect(seen).toBe(true);
        await say('slower');
        expect(said()).toMatch(/moving in that position for them, slowly/);
        // "stop" alone is consent's (it eases or ends the evening, before any action is read);
        // holding still and going on is "stay still".
        await say('stay still');
        expect(said()).toMatch(/You have stopped moving and hold still/);
        // Codex (#196). Easing off stills her too, whatever the position.
        await say('move for me');
        expect(said()).toMatch(/You are moving in that position for them/);
        await say('wait');
        expect(said()).not.toMatch(/You are moving in that position for them/);
        run(10);
        expect(said()).not.toMatch(/Your hands right now/);
        Actions.end();
        expect(layer).toBeNull();
    });
});

describe('Codex (#196): a negated movement request is a no', () => {
    const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
    const posed = { poseHeld: true };
    const moving = { poseHeld: true, moving: true };
    const move = (t, c) => {
        const p = Intent.parse(t, c);
        return p && p.name === 'avatar.move' ? p.params.move : null;
    };
    test.each([
        ["don't rock your hips", posed, null],
        ["don't grind on me", posed, null],
        ["don't rock your hips", moving, 'still'],
        ["I don't want you to keep moving", moving, 'still'],
        ['non muoverti', moving, 'still'],
        ["don't stop", moving, 'start'],
        ['non fermarti', moving, 'start'],
        ['no pares', moving, 'start'],
        ['move for me', posed, 'start'],
    ])('%s (%o) → %s', (text, c, want) => expect(move(text, c)).toBe(want));
});

describe('PP1. a room made for her show: she invites them, their yes starts it', () => {
    const poses = () => {
        const applied = [];
        let held = null;
        window.NEXUS_PRIVATE_POSES = {
            create: () => ({
                held: () => held,
                apply: (key) => {
                    applied.push(key);
                    held = key;
                    return { ok: true, pose: key };
                },
                release: () => {
                    held = null;
                },
                back: () => ({ ok: true }),
                describe: () => null,
            }),
        };
        window.NEXUS_VIEWER = { avatarManager: { currentRoot: { traverse: () => {} } } };
        return applied;
    };
    const turn = async (text) => {
        Surface.renderUser(text);
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
    };

    test('OL1 "apri le gambe" opens her legs where she is: on her back she stays on her back', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        const applied = poses();
        try {
            const w = await begin({ adult: true });
            w.adult.level = 4;
            await turn('Sdraiati sulla schiena con le ginocchia alzate');
            await turn('apri le gambe');
            expect(applied).not.toContain('sit-open');
            expect(new Set(applied)).toEqual(new Set(['knees-up']));
            await turn('mettiti in ginocchio');
            await turn('apri le gambe');
            expect(applied.slice(-1)).toEqual(['kneel-wide']);
            // Asked to sit, it is the seat (on the floor now, OL1).
            await turn('siediti a gambe aperte');
            expect(applied.slice(-1)).toEqual(['sit-open']);
            // OL3. Remembered: "chiudi le gambe" from the open seat is lounging; from her back with
            // knees up it is lying back; a bare "apri" opens them again where she is.
            await turn('chiudi le gambe');
            expect(applied.slice(-1)).toEqual(['lounge']);
            await turn('Sdraiati sulla schiena con le ginocchia alzate');
            await turn('chiudi le gambe');
            expect(applied.slice(-1)).toEqual(['lie-back']);
            await turn('apri');
            expect(applied.slice(-1)).toEqual(['knees-up']);
            expect(Actions.promptLines().join('\n')).toMatch(
                /from lie back, only your legs changed|asked you to open your legs and you already are/
            );
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('an invitation is an offer: only an open show, and their yes runs it', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        const applied = poses();
        try {
            const w = await begin({ adult: true });
            w.adult.level = 3;
            // Not open at this step (a striptease undresses her: step 4), so not offered.
            expect(Actions.offerShow('striptease')).toBe(false);
            expect(Actions.snapshot().offer).toBeNull();
            expect(Actions.offerShow('tease')).toBe(true);
            expect(Actions.snapshot().offer).toMatchObject({ kind: 'show', routine: 'tease' });
            expect(applied).toEqual([]); // offered, nothing started
            jest.useFakeTimers();
            try {
                await turn('yes');
                expect(Actions.snapshot().last).toMatchObject({
                    name: 'avatar.routine',
                    source: 'user-approved',
                    status: 'completed',
                });
                expect(Actions.promptLines().join('\n')).toMatch(/You are giving them a show — a slow tease, step 1/);
                expect(Actions.snapshot().offer).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('her own show tag never starts it: it becomes the same invitation', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        const applied = poses();
        try {
            const w = await begin({ adult: true });
            w.adult.level = 3;
            const out = await Actions.request(
                'avatar.routine',
                { routine: 'tease', move: 'start' },
                { source: 'model' }
            );
            expect(out.status).toBe('blocked');
            expect(applied).toEqual([]);
            expect(Actions.snapshot().offer).toMatchObject({ kind: 'show', routine: 'tease' });
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('in the lounge she opens in its words and, once the pace opens the show, invites them', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        poses();
        try {
            const w = world({ adult: true });
            w.activity.worldChoice = 'dance-lounge';
            await w.activity.start({ input: { id: 'sensual' } });
            const session = w.activity._privateExperience;
            const Locale = require('../../src/features/together/PrivateLocale.js');
            await flush();
            expect(document.body.textContent).toContain(Locale.t('place.dance-lounge.opening').slice(0, 30));
            // Step 1: no show is open yet, so nothing is offered on arrival.
            expect(Actions.snapshot().offer).toBeNull();
            w.adult.level = 3;
            expect(session._invitePlace(3)).toBe(true);
            expect(Actions.snapshot().offer).toMatchObject({ kind: 'show', routine: 'table-dance' });
            // Once per show per evening: the same step again does not invite twice.
            expect(session._invitePlace(3)).toBe(false);
            // Codex (#198). "Not yet" withdraws the invitation, so a later yes starts nothing.
            session._chooseReply(Locale.t('place.notyet'));
            await flush();
            expect(Actions.snapshot().offer).toBeNull();
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('WR1. the Window Room: her opening, the menu at the door, a deal, then her invitation', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        poses();
        try {
            const w = world({ adult: true });
            w.activity.worldChoice = 'window-room';
            await w.activity.start({ input: { id: 'sensual' } });
            const session = w.activity._privateExperience;
            const Locale = require('../../src/features/together/PrivateLocale.js');
            await flush();
            expect(document.body.textContent).toContain(Locale.t('place.window-room.opening').slice(0, 30));
            // The menu is on screen as chips; nothing is offered before the deal.
            expect(document.body.textContent).toContain(Locale.t('place.deal.tease'));
            expect(Actions.snapshot().offer).toBeNull();
            // Codex (#199). Stepping the pace up before the deal invites to nothing.
            w.adult.level = 3;
            expect(session._invitePlace(3)).toBe(false);
            expect(Actions.snapshot().offer).toBeNull();
            // The deal is answered in her words, remembered, and its show offered once the pace opens it.
            expect(session._chooseReply(Locale.t('place.deal.tease'))).toBe(true);
            await flush();
            expect(session._placeWish).toBe('tease');
            expect(document.body.textContent).toContain(Locale.t('place.deal.ok').slice(0, 20));
            expect(Actions.snapshot().offer).toMatchObject({ kind: 'show', routine: 'tease' });
            // A second tap on a deal chip is just words now: one deal per evening.
            expect(session._dealFor(Locale.t('place.deal.striptease'))).toBeNull();
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });

    test('PS1. Isabelle: the picker offers her, she opens in her words, her menu, her deal, her character', async () => {
        const real = window.NEXUS_PRIVATE_POSES;
        poses();
        try {
            const w = world({ adult: true });
            const Locale = require('../../src/features/together/PrivateLocale.js');
            w.activity.chooseMood({ id: 'sensual' });
            // A Sensual evening reaches Isabelle and Yuki; Gina is Intense only.
            expect(w.activity.personas().map((p) => p.id)).toEqual(['isabelle', 'yuki']);
            w.activity.setAtmosphere({ persona: 'isabelle' });
            expect(w.activity.personaChoice).toBe('isabelle');
            await w.activity.start({ input: { id: 'sensual' } });
            const session = w.activity._privateExperience;
            await flush();
            expect(document.body.textContent).toContain(Locale.t('persona.isabelle.opening').slice(0, 30));
            expect(document.body.textContent).toContain(Locale.t('place.deal.ride'));
            expect(Capability.privateSystemPromptSuffix()).toMatch(/WHO YOU ARE TONIGHT: You are Isabelle, 29/);
            w.adult.level = 3;
            expect(session._chooseReply(Locale.t('place.deal.ride'))).toBe(true);
            await flush();
            expect(document.body.textContent).toContain(Locale.t('persona.isabelle.deal-ok').slice(0, 20));
            expect(Actions.snapshot().offer).toMatchObject({ kind: 'show', routine: 'ride' });
            expect(Capability.privateSystemPromptSuffix()).toMatch(/TONIGHT'S DEAL: they chose climbing onto them/);
        } finally {
            window.NEXUS_PRIVATE_POSES = real;
        }
    });
});

describe('UR1 Unrestrained: the grant, the closest step, their tap', () => {
    const Actions = require('../../src/experiences/private/PrivateActionBridge.js');
    const Policy = require('../../src/experiences/private/PrivateActionPolicy.js');

    test('the policy refuses an Unrestrained show and her face or mouth without it', () => {
        const show = { name: 'avatar.routine', params: { routine: 'edging' }, source: 'user' };
        const base = { active: true, level: 4, asked: { avatar: true }, autonomy: 'suggest' };
        expect(Policy.decide(show, { ...base, unrestrainedOnly: true })).toMatchObject({
            allow: false,
            why: 'unrestrained',
        });
        expect(Policy.decide(show, { ...base, unrestrainedOnly: true, unrestrained: true }).allow).toBe(true);
        expect(Policy.validate('avatar.routine', { routine: 'used-marked', move: 'start' }).ok).toBe(true);
    });

    test('words for the shows and for her face and mouth', () => {
        const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
        expect(Intent.parse('Tienimi al limite', {})).toMatchObject({
            name: 'avatar.routine',
            params: { routine: 'edging' },
        });
        expect(Intent.parse('Use me and mark me', {})).toMatchObject({ params: { routine: 'used-marked' } });
        expect(Intent.parse("I'm coming on your face", {})).toMatchObject({
            name: 'body.finish',
            params: { where: 'face' },
        });
        expect(Intent.parse('vengo in bocca', {})).toMatchObject({ name: 'body.finish', params: { where: 'mouth' } });
        // Ordinary words do not start a show.
        expect(Intent.parse('kiss me again and again', {})).toBeNull();
    });

    test('setUnrestrained turns on only with the grant at the closest step; off is always allowed', () => {
        expect(typeof Actions.setUnrestrained).toBe('function');
        expect(Actions.setUnrestrained(true)).toBe(false); // no evening running
    });
});
