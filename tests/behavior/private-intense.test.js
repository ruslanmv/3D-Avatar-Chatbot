/**
 * AX21. Intenso: the fourth style, visible but locked until the site and the server unlock it, with
 * a voice of its own at step 4 and room for a scene the person asked for. Against the real profile,
 * voice packs, catalog and Intimate activity; every fixture line is non-explicit.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Profile = require('../../src/features/together/PrivateExperienceProfile.js');
const Voice = require('../../src/features/together/PrivateVoice.js');
const Locale = require('../../src/features/together/PrivateLocale.js');
const Catalog = require('../../src/features/together/PrivatePromptCatalog.js');
const Beats = require('../../src/features/together/PrivateBeats.js');
const Director = require('../../src/features/together/PrivateTurnDirector.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

const LANGS = Object.keys(Voice.PACKS).filter((c) => c !== 'en-GB');

function activity(blackboard) {
    const bus = new EventBus({ debug: false });
    const modes = { activeId: 'companion', activate: () => true, deactivate: () => true };
    const adult = ConsentFlow.attach({ bus, blackboard, modes, profile: AdultProfile, recorder: null, say: null });
    window.NEXUS_BD = { blackboard, modes, adult, bus };
    window.NEXUS_PRIVATE_EXPERIENCE_PROFILE = Profile;
    return new PlaygroundActivity.IntimateActivity.Intimate({ bus, adult, capability: () => ({ ok: true }) });
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge' }));
});

afterEach(() => {
    for (const k of ['NEXUS_BD', 'NEXUS_PRIVATE_EXPERIENCE_PROFILE', 'NEXUS_ADULT_EXPERIENCE_CONFIG', 'AppLanguage'])
        delete window[k];
});

describe('the card: shown locked, never startable until both locks open', () => {
    test('nothing declared: three styles to choose, Intenso listed as locked by the site', async () => {
        const a = activity({ adultVerified: false, nsfwAllowed: true });
        expect(a.inputs().map((i) => i.id)).toEqual(['affectionate', 'romantic', 'sensual']);
        expect(a.lockedInputs()).toEqual([expect.objectContaining({ id: 'mature', locked: true, why: 'site' })]);
        const started = await a.start({ input: { id: 'mature' } });
        expect(started.ok).toBe(false);
        expect(a.active).toBe(false);
    });

    test('declared by the site but no server age attestation: locked, and the reason is age', async () => {
        window.NEXUS_ADULT_EXPERIENCE_CONFIG = { contentTier: 'mature', providers: { ollabridge: 'mature' } };
        const a = activity({ adultVerified: false, nsfwAllowed: true });
        expect(a.lockedInputs()).toEqual([expect.objectContaining({ id: 'mature', why: 'age' })]);
        expect((await a.start({ input: { id: 'mature' } })).ok).toBe(false);
    });

    test('declared and attested: offered with four steps, and nothing is left locked', () => {
        window.NEXUS_ADULT_EXPERIENCE_CONFIG = { contentTier: 'mature', providers: { ollabridge: 'mature' } };
        const a = activity({ adultVerified: true, nsfwAllowed: true });
        expect(a.inputs().find((i) => i.id === 'mature')).toEqual(expect.objectContaining({ maxLevel: 4 }));
        expect(a.lockedInputs()).toEqual([]);
    });

    test('Private itself unavailable: no locked card either', () => {
        const bus = new EventBus({ debug: false });
        const a = new PlaygroundActivity.IntimateActivity.Intimate({
            bus,
            adult: null,
            capability: () => ({ ok: false, why: 'off' }),
        });
        expect(a.lockedInputs()).toEqual([]);
    });
});

describe('the name and the locked notes exist in every language', () => {
    test('each pack names the style, describes it and has both reasons', () => {
        const seen = new Set();
        for (const code of LANGS) {
            const t = (key) => Locale.PACKS[code][key]; // the pack itself: no English fallback
            for (const key of ['preset.name.mature', 'preset.note.mature', 'preset.locked.age', 'preset.locked.site']) {
                expect(t(key)).toBeTruthy();
            }
            expect(t('preset.locked.age')).not.toBe(t('preset.locked.site'));
            expect(Catalog.styleLabel('mature', code)).toBe(t('preset.name.mature'));
            seen.add(t('preset.name.mature'));
        }
        expect(Locale.t('preset.name.mature', null, 'it-IT')).toBe('Intenso');
        expect(seen.size).toBeGreaterThan(4); // translated, not one word copied nine times
    });
});

describe('step 4 has its own voice', () => {
    test('every language: three intense examples, shown only at step 4, all passing the beat filter', () => {
        for (const code of Object.keys(Voice.PACKS)) {
            const p = Voice.PACKS[code];
            expect(p.intense).toHaveLength(3);
            for (const l of p.intense) expect(Beats.line(l)).toBe(l);
            const four = Voice.persona(4, code);
            const three = Voice.persona(3, code);
            expect(four).toContain(p.intense[0]);
            expect(four).not.toContain(p.charged[0]);
            expect(three).toContain(p.charged[0]);
            expect(three).not.toContain(p.intense[0]);
        }
    });

    test('the register at step 4 says what intensity is, and still follows the person', () => {
        const four = Profile.registerLines(4).join(' ');
        expect(four).toMatch(/Intensity is attention/);
        expect(four).toMatch(/Let them set the direction/);
        expect(Profile.registerLines(3).join(' ')).not.toMatch(/Intensity is attention/);
    });

    test('arriving at step 4 she names their choice and hands the pace back, in every language', () => {
        const arrivals = new Set();
        for (const code of LANGS) {
            const lines = Catalog.levelLines(code);
            const pool = lines ? lines[4] : Catalog.LEVEL_LINES[4];
            for (const l of pool) {
                expect(Beats.line(l)).toBe(l);
                arrivals.add(l);
            }
        }
        expect(arrivals.size).toBeGreaterThanOrEqual(LANGS.length);
    });
});

describe('room for a scene they asked for, from step 3', () => {
    const scene = { intent: 'scene-request', words: 6 };

    test('one number decides the prompt, the reminder and the trim', () => {
        expect(Profile.maxSentences(scene, 'present', 2)).toBe(4);
        expect(Profile.maxSentences(scene, 'present', 3)).toBe(6);
        expect(Profile.maxSentences({ intent: 'request' }, 'present', 4)).toBe(6);
        expect(Profile.maxSentences({ intent: 'question' }, 'present', 4)).toBe(4);
        expect(Profile.maxSentences({ intent: 'conversation' }, 'present', 4)).toBe(3);
        expect(Profile.maxSentences(scene, 'quiet', 4)).toBe(1); // fewer words asked for wins
        expect(Profile.lengthLines(scene, 'present', 4).join(' ')).toMatch(/SIX SENTENCES MAXIMUM/);
        expect(Profile.lengthLines(scene, 'present', 2).join(' ')).toMatch(/FOUR SENTENCES MAXIMUM/);
        expect(Profile.lengthReminder(scene, 4).join(' ')).toMatch(/six sentences/);
        expect(Profile.lengthReminder(scene, 1).join(' ')).toMatch(/four sentences/);
    });

    test('the trim keeps six for the scene and stays short for everything else', () => {
        window.NEXUS_PRIVATE_EXPERIENCE_PROFILE = Profile;
        const eight = 'One. Two. Three. Four. Five. Six. Seven. Eight.';
        expect(Capability.shapePrivateReply(eight, scene, 'present', 4)).toBe('One. Two. Three. Four. Five. Six.');
        expect(Capability.shapePrivateReply(eight, scene, 'present', 2)).toBe('One. Two. Three. Four.');
        expect(Capability.shapePrivateReply(eight, { intent: 'conversation' }, 'present', 4)).toBe('One. Two. Three.');
    });

    test('the token budget for a scene matches a plain request and stays inside the cap', () => {
        expect(Director.BUDGET['scene-request']).toBe(Director.BUDGET.request);
        expect(Director.BUDGET['scene-request']).toBeLessThanOrEqual(1024);
    });
});
