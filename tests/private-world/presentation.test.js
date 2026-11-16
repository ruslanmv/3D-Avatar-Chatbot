/**
 * AX7. The chosen style and step change how she sounds and looks, through the owners that exist,
 * and nothing outside Private changes. Against the real ConsentFlow and Intimate activity; the VRM
 * loader, renderer runtime and mood presets are recording fakes.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Profile = require('../../src/features/together/PrivateExperienceProfile.js');
const Presentation = require('../../src/features/together/PrivatePresentation.js');
const Beats = require('../../src/features/together/PrivateBeats.js');

Capability.installPrivateRuntime(PlaygroundActivity);

const MATURE_SITE = { contentTier: 'mature', providers: { ollabridge: 'mature' } };

function setup(options) {
    const o = options || {};
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge' }));
    if (o.site) window.NEXUS_ADULT_EXPERIENCE_CONFIG = o.site;
    const emotions = [];
    const moods = [];
    window.NEXUS_VIEWER = {
        avatarManager: { vrmLoader: { setEmotion: (e, i) => emotions.push([e, i]) } },
        vrWorlds: o.world ? { activeId: 'private-cabaret', setMood: (l) => (moods.push(l), true) } : { activeId: null },
    };
    window.NEXUS_PLAYGROUND_MOODS = { get: (id) => ({ id, light: { id } }) };
    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0 };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    window.NEXUS_BD = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    Surface.configure({ addMessage: () => {}, beginStream: () => null, scroll: () => {} });
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({ bus, adult, capability: () => ({ ok: true }) });
    window.NEXUS_BD.intimate = activity;
    return { activity, adult, emotions, moods };
}

function stepUp(adult) {
    jest.advanceTimersByTime(AdultProfile.escalation.userStepMinMs + 50);
    return adult.initiated(Date.now());
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Surface.reset();
    Presentation.reset();
});

afterEach(() => {
    jest.useRealTimers();
    Surface.reset();
    Presentation.reset();
    for (const k of [
        'NEXUS_BD',
        'NEXUS_BD_SAY',
        'NEXUS_PRIVATE_TIMING_SCALE',
        'NEXUS_ADULT_EXPERIENCE_CONFIG',
        'NEXUS_VIEWER',
        'NEXUS_PLAYGROUND_MOODS',
    ])
        delete window[k];
    document.body.innerHTML = '';
});

describe('the style is something you hear and see, not a label', () => {
    test('each style and step computes a distinct, bounded presentation', () => {
        const at = (style, level) => Presentation.compute(style, level, { profile: Profile });
        expect(at('affectionate', 1).rate).toBeGreaterThan(at('sensual', 1).rate);
        expect(at('sensual', 1).rate).toBeGreaterThan(at('mature', 1).rate);
        // deeper steps: slower and warmer, never below the floor
        expect(at('mature', 4).rate).toBeLessThan(at('mature', 1).rate);
        expect(at('mature', 4).expression.intensity).toBeGreaterThan(at('mature', 1).expression.intensity);
        for (const style of Object.keys(Profile.STYLES))
            for (let level = 1; level <= 4; level += 1) {
                const p = at(style, level);
                expect(p.rate).toBeGreaterThanOrEqual(Presentation.MIN_RATE_FACTOR);
                expect(p.rate).toBeLessThanOrEqual(1);
                expect(p.expression.intensity).toBeLessThanOrEqual(0.32);
                expect(p.level).toBeLessThanOrEqual(Profile.STYLES[style].maxLevel);
            }
    });

    test('outside Private every reply keeps the person’s own voice', () => {
        expect(Presentation.adjustVoice({ rate: 1.1, pitch: 0.9 })).toEqual({ rate: 1.1, pitch: 0.9 });
        expect(Presentation.restingExpression()).toBeNull();
    });
});

describe('a real session drives it, follows the ladder, and gives it all back', () => {
    test('start applies voice and expression; each step deepens; stop resets', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const first = Presentation.state();
        expect(first.active).toBe(true);
        expect(first.presentation.style).toBe('sensual');
        expect(first.applied).toMatchObject({ voice: true, expression: true, light: false });
        const slow1 = Presentation.adjustVoice({ rate: 1 }).rate;
        expect(slow1).toBeLessThan(1);
        expect(s.emotions[s.emotions.length - 1][0]).toBe('happy');

        stepUp(s.adult);
        stepUp(s.adult);
        expect(s.adult.level).toBe(3);
        expect(Presentation.state().presentation.level).toBe(3);
        expect(Presentation.adjustVoice({ rate: 1 }).rate).toBeLessThan(slow1);

        s.activity.stop('user');
        expect(Presentation.state().active).toBe(false);
        expect(Presentation.adjustVoice({ rate: 1 }).rate).toBe(1);
        expect(s.emotions[s.emotions.length - 1]).toEqual(['neutral', 0]);
    });

    test('the room’s light is set once at start, only with a room on screen, and never on a later step', async () => {
        const s = setup({ world: true, site: MATURE_SITE });
        await s.activity.start({ input: { id: 'mature' } });
        expect(s.moods).toHaveLength(1);
        expect(Presentation.state().applied.light).toBe(true);
        stepUp(s.adult);
        expect(s.moods).toHaveLength(1); // a light the person chooses in the room stays theirs
        s.activity.stop('user');
    });

    test('without a VRM loader the expression is reported as not applied, not claimed', async () => {
        const s = setup();
        delete window.NEXUS_VIEWER.avatarManager;
        await s.activity.start({ input: { id: 'romantic' } });
        expect(Presentation.state().applied).toMatchObject({ voice: true, expression: false });
        s.activity.stop('user');
    });

    test('care mode overrides the style: calm voice, neutral face', async () => {
        const s = setup({ site: MATURE_SITE });
        await s.activity.start({ input: { id: 'mature' } });
        Surface.renderUser('some nights I want to kill myself');
        const p = Presentation.state().presentation;
        expect(p.care).toBe(true);
        expect(p.expression).toEqual({ emotion: 'neutral', intensity: 0 });
        expect(p.rate).toBe(Presentation.CARE_RATE);
        expect(Presentation.restingExpression()).toBeNull();
        s.activity.stop('user');
    });
});

describe('Mature has its own voice in the written beats', () => {
    test('its written plan is not Sensual’s, and every line passes the beat filter', () => {
        const mature = Beats.fallbackPlan({ id: 'mature', maxLevel: 4 }, { rng: () => 0 });
        const sensual = Beats.fallbackPlan({ id: 'sensual', maxLevel: 3 }, { rng: () => 0 });
        expect(mature.opening).not.toBe(sensual.opening);
        const pool = Beats.POOLS.mature;
        const lines = [
            ...pool.openings,
            ...pool.playful,
            ...pool.tender,
            ...pool.middle.playful,
            ...pool.middle.tender,
            ...pool.closing.playful,
            ...pool.closing.tender,
            pool.texture.prompt,
            pool.texture.quieter,
            pool.texture.closer,
        ];
        for (const l of lines) expect(Beats.line(l)).toBe(l);
    });
});

describe('AC10. the person’s energy reaches her face', () => {
    const at = (style, level, energy) => Presentation.compute(style, level, { profile: Profile, energy });

    test('the default energy is exactly what every session had', () => {
        expect(at('romantic', 2).expression).toEqual({
            emotion: 'happy',
            intensity: at('romantic', 2, 'present').expression.intensity,
        });
        expect(at('romantic', 2, 'present').expression.emotion).toBe('happy');
        expect(at('romantic', 2).energy).toBe('present');
    });

    test('quiet is a settled, relaxed face; playful is a brighter one; the level still sets the warmth', () => {
        const quiet = at('romantic', 3, 'quiet').expression;
        const present = at('romantic', 3, 'present').expression;
        const playful = at('romantic', 3, 'playful').expression;
        expect(quiet.emotion).toBe('relaxed');
        expect(playful.emotion).toBe('happy');
        expect(playful.intensity).toBeGreaterThan(present.intensity);
        // Warmer at a higher step, whatever the energy.
        expect(at('romantic', 3, 'playful').expression.intensity).toBeGreaterThan(
            at('romantic', 1, 'playful').expression.intensity
        );
        // And bounded: a resting face never becomes a performance.
        for (const level of [1, 2, 3, 4])
            for (const energy of ['quiet', 'present', 'playful']) {
                expect(at('romantic', level, energy).expression.intensity).toBeLessThanOrEqual(0.4);
            }
    });

    test('an energy that is not one of the three is the default, never an error', () => {
        expect(at('romantic', 2, 'loud').expression).toEqual(at('romantic', 2, 'present').expression);
    });

    test('care mode wins over energy: neutral, whatever was chosen', () => {
        expect(
            Presentation.compute('romantic', 3, { profile: Profile, care: true, energy: 'playful' }).expression
        ).toEqual({
            emotion: 'neutral',
            intensity: 0,
        });
    });

    test('apply() puts the energy’s face on the VRM through the loader that exists', () => {
        const setEmotion = jest.fn();
        const g = {
            NEXUS_PRIVATE_EXPERIENCE_PROFILE: Profile,
            NEXUS_VIEWER: { avatarManager: { vrmLoader: { setEmotion } } },
        };
        Presentation.apply('romantic', 2, { global: g, energy: 'quiet' });
        expect(setEmotion).toHaveBeenLastCalledWith('relaxed', expect.any(Number));
        Presentation.apply('romantic', 2, { global: g, energy: 'playful' });
        expect(setEmotion).toHaveBeenLastCalledWith('happy', expect.any(Number));
        Presentation.reset({ global: g });
    });
});
