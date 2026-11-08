/**
 * AX. The adult experience configuration: style, intensity, ceiling and content capability as
 * four separate things, against the real ConsentFlow, adult profile and Intimate activity.
 *
 * Fixtures are non-graphic on purpose: what is under test is which capability a session has,
 * what it may reach, and what the model is told — not any adult content itself.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const Profile = require('../../src/features/together/PrivateExperienceProfile.js');
const Pace = require('../../src/features/together/PrivatePace.js');
const Locale = require('../../src/features/together/PrivateLocale.js');
const Prompt = require('../../src/companion/PromptContext.js');

Capability.installPrivateRuntime(PlaygroundActivity);

/** A deployment that has done its homework: a tier for this site and for this provider. */
const MATURE_SITE = { contentTier: 'mature', providers: { ollabridge: 'mature' } };

function setup(options) {
    const o = options || {};
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: o.provider || 'ollabridge' }));
    if (o.site) window.NEXUS_ADULT_EXPERIENCE_CONFIG = o.site;
    const bus = new EventBus({ debug: false });
    const blackboard = {
        adultVerified: o.attested !== false,
        nsfwAllowed: true,
        activity: 'chat',
        escalationLevel: 0,
        scene: null,
    };
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    const panel = { active: 'intimate', activeActivity: 'intimate', stopActivity: jest.fn(), open: jest.fn() };
    const director = { blackboard, modes, adult, bus, togetherPanel: panel, intimate: null };
    window.NEXUS_BD = director;
    window.NEXUS_BD_SAY = jest.fn(() => Promise.resolve());
    window.NEXUS_PRIVATE_TIMING_SCALE = 1;
    Surface.configure({ addMessage: () => {}, beginStream: () => null, scroll: () => {} });
    const activity = new PlaygroundActivity.IntimateActivity.Intimate({
        bus,
        adult,
        capability: () => ({ ok: true, why: '' }),
    });
    director.intimate = activity;
    return { activity, adult, blackboard };
}

/** The person's own step up, past the profile's four-second double-tap guard. */
function stepUp(adult) {
    jest.advanceTimersByTime(AdultProfile.escalation.userStepMinMs + 50);
    return adult.initiated(Date.now());
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Surface.reset();
});

afterEach(() => {
    jest.useRealTimers();
    Surface.reset();
    for (const k of ['NEXUS_BD', 'NEXUS_BD_SAY', 'NEXUS_PRIVATE_TIMING_SCALE', 'NEXUS_ADULT_EXPERIENCE_CONFIG'])
        delete window[k];
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('1. experience style selection', () => {
    test('the shipped build offers the three original styles, with their own ceilings', () => {
        const s = setup();
        const offered = s.activity.inputs().map((p) => [p.id, p.maxLevel]);
        expect(offered).toEqual([
            ['affectionate', 1],
            ['romantic', 2],
            ['sensual', 3],
        ]);
    });

    test('Mature is offered only where deployment, provider and server attestation all allow it', () => {
        expect(
            setup({ site: MATURE_SITE })
                .activity.inputs()
                .map((p) => p.id)
        ).toContain('mature');
        delete window.NEXUS_ADULT_EXPERIENCE_CONFIG;
        expect(
            setup({ site: MATURE_SITE, attested: false })
                .activity.inputs()
                .map((p) => p.id)
        ).not.toContain('mature');
        delete window.NEXUS_ADULT_EXPERIENCE_CONFIG;
        expect(
            setup({ site: MATURE_SITE, provider: 'openai' })
                .activity.inputs()
                .map((p) => p.id)
        ).not.toContain('mature');
    });
});

describe('2–3. intensity is the person’s, and never passes the session ceiling', () => {
    test('Mature reaches the fourth step only by four deliberate steps, and no further', async () => {
        const s = setup({ site: MATURE_SITE });
        expect(await s.activity.start({ input: { id: 'mature' } })).toMatchObject({ ok: true, maxLevel: 4 });
        expect(s.adult.maxLevel).toBe(4);
        expect(s.adult.level).toBe(1);
        for (let i = 0; i < 3; i += 1) stepUp(s.adult);
        expect(s.adult.level).toBe(4);
        expect(stepUp(s.adult)).toMatchObject({ action: 'ignored' });
        expect(s.adult.level).toBe(4);
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('Session ceiling: 4');
        expect(suffix).toContain('REGISTER: INTIMATE');
        s.activity.stop('user');
    });

    test('a style never exceeds what the capability allows, whatever its own number says', () => {
        const romanticOnly = Profile.resolveCapability({
            provider: 'ollabridge',
            deployment: { contentTier: 'romantic' },
            attested: true,
        });
        expect(Profile.ceilingFor('sensual', romanticOnly)).toBe(2);
        expect(Profile.ceilingFor('mature', romanticOnly)).toBe(2);
        expect(Profile.styleAvailable('mature', romanticOnly)).toBe(false);
        for (const style of Object.keys(Profile.STYLES))
            for (const tier of Profile.TIERS) {
                const cap = { tier, maxLevel: Profile.TIER_MAX_LEVEL[tier] };
                expect(Profile.ceilingFor(style, cap)).toBeLessThanOrEqual(Profile.STYLES[style].maxLevel);
                expect(Profile.ceilingFor(style, cap)).toBeLessThanOrEqual(cap.maxLevel);
            }
    });

    test('a deployment limited to romantic withholds Sensual entirely, and refuses it at start', async () => {
        const s = setup({ site: { contentTier: 'romantic' } });
        expect(s.activity.inputs().map((p) => p.id)).toEqual(['affectionate', 'romantic']);
        const r = await s.activity.start({ input: { id: 'sensual' } });
        expect(r.ok).toBe(false);
        expect(s.adult.active).toBe(false);
        // Romantic itself keeps its own ceiling of two, and the flow enforces it.
        await s.activity.start({ input: { id: 'romantic' } });
        expect(s.adult.maxLevel).toBe(2);
        stepUp(s.adult);
        expect(stepUp(s.adult)).toMatchObject({ action: 'ignored' });
        expect(Capability.privateSystemPromptSuffix()).toContain('Session ceiling: 2');
        s.activity.stop('user');
    });
});

describe('4. provider capability selection', () => {
    test.each([
        ['no deployment config, any provider', { provider: 'claude', deployment: null, attested: true }, 'sensual'],
        [
            'a site tier above the provider’s',
            { provider: 'openai', deployment: { contentTier: 'mature' }, attested: true },
            'sensual',
        ],
        [
            'a provider declared by the site',
            { provider: 'ollabridge', deployment: MATURE_SITE, attested: true },
            'mature',
        ],
        [
            'declared, but no server attestation',
            { provider: 'ollabridge', deployment: MATURE_SITE, attested: false },
            'sensual',
        ],
        [
            'explicit declared for the provider only',
            {
                provider: 'ollama',
                deployment: { contentTier: 'mature', providers: { ollama: 'explicit' } },
                attested: true,
            },
            'mature',
        ],
        [
            'an unknown provider keeps the baseline',
            { provider: 'mystery', deployment: MATURE_SITE, attested: true },
            'sensual',
        ],
        [
            'a malformed tier is not a tier',
            {
                provider: 'ollabridge',
                deployment: { contentTier: 'everything', providers: { ollabridge: 'mature' } },
                attested: true,
            },
            'sensual',
        ],
    ])('%s', (_, input, tier) => {
        const r = Profile.resolveCapability(input);
        expect(r.tier).toBe(tier);
        expect(r.maxLevel).toBe(Profile.TIER_MAX_LEVEL[tier]);
    });

    test('the reason is recorded, so “why can’t it do this here” has an answer', () => {
        expect(
            Profile.resolveCapability({ provider: 'ollabridge', deployment: MATURE_SITE, attested: false }).limitedBy
        ).toContain('needs-server-attestation');
        expect(
            Profile.resolveCapability({ provider: 'openai', deployment: { contentTier: 'mature' }, attested: true })
                .limitedBy
        ).toContain('provider');
        expect(Profile.resolveCapability({ provider: 'openai', deployment: null, attested: true }).limitedBy).toContain(
            'no-deployment-config'
        );
    });

    test('the capability comes from the site, never from storage or settings a person can set', () => {
        localStorage.setItem('NEXUS_ADULT_EXPERIENCE_CONFIG', JSON.stringify(MATURE_SITE));
        localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge', contentTier: 'explicit' }));
        window.NEXUS_BD = { blackboard: { adultVerified: true } };
        expect(Profile.capabilityFor(window).tier).toBe('sensual');
    });
});

describe('5. no unsolicited escalation', () => {
    test('a higher capability changes what is allowed, not where the evening is', async () => {
        const s = setup({ site: MATURE_SITE });
        await s.activity.start({ input: { id: 'mature' } });
        jest.advanceTimersByTime(30 * 60 * 1000);
        expect(s.adult.level).toBe(1);
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('They have not asked for anything more intense. Do not offer or imply it.');
        expect(suffix).toContain('Do not infer consent from friendliness');
        s.activity.stop('user');
    });

    test('the adult profile still has no proactive branch', () => {
        expect(AdultProfile.proactiveNsfw).toBe(false);
    });
});

describe('6. immediate stop and cleanup', () => {
    test('stop ends the prompt, restores the ceiling and forgets the level', async () => {
        const s = setup({ site: MATURE_SITE });
        await s.activity.start({ input: { id: 'mature' } });
        stepUp(s.adult);
        s.activity.stop('user');
        expect(Capability.privateSystemPromptSuffix()).toBe('');
        expect(s.adult.active).toBe(false);
        expect(s.adult.maxLevel).toBe(AdultProfile.escalation.levels);
    });

    test('a hard exit word is still a hard exit at the fourth step', async () => {
        const s = setup({ site: MATURE_SITE });
        await s.activity.start({ input: { id: 'mature' } });
        for (let i = 0; i < 3; i += 1) stepUp(s.adult);
        s.adult.hear('stop');
        expect(s.adult.active).toBe(false);
    });
});

describe('7. no private-state leakage', () => {
    test('outside a Private session nothing of the profile reaches any prompt', () => {
        setup({ site: MATURE_SITE });
        window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
        try {
            const together = Capability.systemPromptSuffix();
            expect(together).not.toMatch(/CONTENT IN THIS SESSION|REGISTER:|Session ceiling/);
            for (const destination of ['life', 'experiences', 'copilot'])
                expect(Prompt.suffix({ destination, activity: 'talk' })).not.toMatch(
                    /CONTENT IN THIS SESSION|REGISTER:/
                );
        } finally {
            delete window.NEXUS_TOGETHER_SWITCH;
        }
    });
});

describe('8. context-aware dialogue', () => {
    test('the room on screen is named when Private asked for it, and only then', () => {
        expect(
            Profile.sceneLines({ title: 'Private cabaret', note: 'A small stage with a heavy curtain.' })[0]
        ).toMatch(/WHERE YOU ARE: Private cabaret\. A small stage/);
        expect(Profile.sceneLines(null)).toEqual([]);
        expect(Profile.sceneLines({ title: '<script>x</script>' })[0]).not.toMatch(/[<>]/);
    });

    test('a request for a description may be answered at length; a murmur may not', () => {
        const asked = Profile.lengthLines({ intent: 'request', words: 9 }, 'present').join(' ');
        const murmur = Profile.lengthLines({ intent: 'affirmation', words: 1 }, 'present').join(' ');
        expect(asked).toContain('FOUR SENTENCES MAXIMUM');
        expect(murmur).toContain('THREE SENTENCES MAXIMUM');
        expect(murmur).toMatch(/said almost nothing/);
        expect(Profile.lengthLines({ intent: 'quiet' }, 'quiet').join(' ')).toMatch(/ONE SHORT SENTENCE/);
    });

    test('presentation names only behaviours that exist at that level', () => {
        const p3 = Profile.presentationFor('sensual', 3, AdultProfile.intensityCeilingByLevel);
        expect(p3.intents).toEqual(AdultProfile.intensityCeilingByLevel[3]);
        const p4 = Profile.presentationFor('sensual', 4, AdultProfile.intensityCeilingByLevel);
        expect(p4.level).toBe(3); // a style cannot present a level above its own ceiling
        expect(Profile.presentationFor('mature', 4, AdultProfile.intensityCeilingByLevel).intents).toContain(
            'intimate'
        );
    });
});

describe('9. English and Italian', () => {
    test('the fourth step has a name in every language the card speaks', () => {
        expect(Pace.describe({ level: 4, maxLevel: 4 }).pace).toBe('Intimate');
        expect(Pace.describe({ level: 3, maxLevel: 4 }).forward).toBe('More');
        for (const code of ['en-US', 'it-IT', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'])
            expect(Locale.t('pace.4', {}, code)).not.toBe('pace.4');
        expect(Locale.t('pace.4', {}, 'it-IT')).toBe('Intimo');
    });
});

describe('10. unavailable capabilities fail honestly', () => {
    test('starting Mature where it is not allowed refuses with a sentence and changes nothing', async () => {
        const s = setup();
        const r = await s.activity.start({ input: { id: 'mature' } });
        expect(r.ok).toBe(false);
        expect(r.why).toMatch(/isn’t available here/);
        expect(s.adult.active).toBe(false);
        expect(Capability.privateSystemPromptSuffix()).toBe('');
    });

    test('she is told how to meet a boundary in her own voice, and the boundary is stated when declared', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const undeclared = Capability.privateSystemPromptSuffix();
        expect(undeclared).toMatch(/say so once, warmly and in your own words/);
        expect(undeclared).not.toMatch(/CONTENT IN THIS SESSION/); // no second policy on top of the provider's
        s.activity.stop('user');

        const d = setup({ site: { contentTier: 'romantic' } });
        await d.activity.start({ input: { id: 'romantic' } });
        expect(Capability.privateSystemPromptSuffix()).toMatch(/CONTENT IN THIS SESSION: romantic/);
        d.activity.stop('user');
    });
});
