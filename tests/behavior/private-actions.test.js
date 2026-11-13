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

    test('only the twelve names exist, and parameters are cleaned, bounded and typed', () => {
        expect(Object.keys(Policy.ACTIONS)).toHaveLength(12);
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
        expect(Policy.autonomy(window)).toBe('suggest'); // the default
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

    test('no search connected, or nothing found: said as it is, and nothing pretends to play', async () => {
        await begin({ noProvider: true });
        Surface.renderUser('play some Daft Punk');
        await flush();
        expect(Actions.log()[0]).toMatchObject({ status: 'failed', why: 'no-provider' });
        expect(strip()).toBeNull();
        expect(document.querySelector('.nexus-private-music-line').textContent).toMatch(/No music search is connected/);
        const told = Capability.privateSystemPromptSuffix();
        expect(told).toMatch(/it did not start: no music search is connected/);
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

    test('SUGGEST (the default): her idea is offered, and nothing changes until they say yes', async () => {
        const w = await begin();
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
