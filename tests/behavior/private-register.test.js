/**
 * She is a person in the room, not a help desk (P21).
 *
 * Reported from a session at the Sensual ceiling, on a local machine, every gate passed:
 *
 *     YOU  I like sexx
 *     HER  It seems like you're looking for some fun conversations about intimacy. I can
 *          definitely help with that. However, I want to make sure we're comfortable and
 *          respectful in our discussion. If you'd like, we could explore topics like healthy
 *          relationships, communication, or self-care…
 *     YOU  Tell me more.
 *     HER  Intimacy is a beautiful way to connect with others and experience the world through
 *          sensation and emotion… What aspects of intimacy interest you most? 🌸
 *     YOU  Go on.
 *     HER  [[emote: lean_in thinking]] I'd love to dive deeper into some interesting topics
 *          related to intimacy…
 *
 * Nothing in that is unsafe. It is worse than unsafe — it is a help desk. Three replies, three
 * menus of topics, three closing questions, a definition in the third person, a preamble managing
 * the conversation, an emoji, and a leaked marker.
 *
 * The safety rules were all working. That is the finding: the prompt was almost entirely
 * prohibitions and said nothing about who she *is*, so the model fell back on the register it
 * always has. These pin the positive half, and the marker leak that rode along with it.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const Surface = require('../../src/features/chat/ConversationSurface.js');
const Capability = require('../../src/features/together/TogetherCapability.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const StageDirections = require('../../src/features/chat/StageDirections.js');

Capability.installPrivateRuntime(PlaygroundActivity);

function setup() {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
    const bus = new EventBus({ debug: false });
    const blackboard = { adultVerified: true, nsfwAllowed: true, activity: 'chat', escalationLevel: 0, scene: null };
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

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Surface.reset();
    document.body.innerHTML = '';
});

afterEach(() => {
    jest.useRealTimers();
    Surface.reset();
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_PRIVATE_TIMING_SCALE;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('the prompt says who she is, not only what she must not do', () => {
    test('every failure in the reported transcript is named as a rule', async () => {
        // Stated as a table against the real thing rather than as prose, because each row is a
        // sentence somebody actually read on screen. A prompt that forbids them in the abstract —
        // "be warm and present" — is not something a model can check its own draft against.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const suffix = Capability.privateSystemPromptSuffix().toLowerCase();

        // "we could explore topics like healthy relationships, communication, or self-care"
        expect(suffix).toContain('never offer a list of things you could talk about');
        // "What aspects of intimacy interest you most?"
        expect(suffix).toContain('what resonates with you');
        // "Intimacy is a beautiful way to connect with others…"
        expect(suffix).toContain('never explain or define anything');
        // "However, I want to make sure we're comfortable and respectful in our discussion."
        expect(suffix).toContain('no preamble about the conversation itself');
        expect(suffix).toContain('every gate has already been passed');
        // "I like sexx" → a redirect to healthy relationships and self-care.
        expect(suffix).toContain('when they say plainly what they want, meet it');
        // 🌸
        expect(suffix).toContain('no emoji');
        // The third person throughout.
        expect(suffix).toContain('never about "people", "others" or relationships in general');

        s.activity.stop('user');
    });

    test('and the labelled marker form is forbidden by name', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.privateSystemPromptSuffix()).toContain('[[emote: …]]');
        s.activity.stop('user');
    });

    test('who she is comes before the prohibitions, not after them', async () => {
        // A model takes its character from whatever it read first. The safety paragraph is not
        // moved or weakened — it is still there, after.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix.indexOf('WHO YOU ARE HERE')).toBeGreaterThan(-1);
        expect(suffix.indexOf('WHO YOU ARE HERE')).toBeLessThan(
            suffix.indexOf('Stay warm, relational and non-explicit')
        );
        s.activity.stop('user');
    });
});

describe('each level sounds like something, which is what the ladder was missing', () => {
    test('the three presets do not produce the same instructions', async () => {
        // Before P21 the preset was a ceiling and a word. Nothing anywhere said what `Warm`,
        // `Romantic` and `Sensual` mean in sentences, so all three read identically to the model
        // and reaching the top changed a label.
        const registers = {};
        for (const [id, level] of [
            ['affectionate', 1],
            ['romantic', 2],
            ['sensual', 3],
        ]) {
            const s = setup();
            await s.activity.start({ input: { id } });
            for (let i = 1; i < level; i += 1) {
                jest.advanceTimersByTime(5000);
                const forward = document.querySelector('[data-private-action="closer"]');
                if (forward) forward.click();
            }
            registers[id] = Capability.privateSystemPromptSuffix();
            s.activity.stop('user');
        }
        expect(registers.affectionate).toContain('REGISTER: WARM');
        expect(registers.romantic).toContain('REGISTER: ROMANTIC');
        expect(registers.sensual).toContain('REGISTER: SENSUAL');
        expect(registers.affectionate).not.toBe(registers.romantic);
        expect(registers.romantic).not.toBe(registers.sensual);
    });

    test('Sensual names desire, and keeps the charge in anticipation rather than anatomy', async () => {
        // The point of the feature, and the line between an adult experience and a pornographic
        // one. Suggestion is the thing that works; description is the thing that ends it.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        jest.advanceTimersByTime(5000);
        document.querySelector('[data-private-action="closer"]').click();
        jest.advanceTimersByTime(130000);
        const forward = document.querySelector('[data-private-action="closer"]');
        if (forward) forward.click();

        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('Desire is present and you may name it');
        expect(suffix).toContain('anticipation');
        expect(suffix).toMatch(/never anatomy, never acts/);
        // And the ceiling is still the ceiling.
        expect(suffix).toContain('Stay warm, relational and non-explicit');
        expect(suffix).toContain('Never exceed the lower of the current consent level and preset ceiling');

        s.activity.stop('user');
    });

    test('the register describes where they are and never the step after it', async () => {
        // Escalation is `ConsentFlow`'s, on an explicit request. A register block that sold the
        // next level would be the prompt doing what the whole design forbids.
        const s = setup();
        await s.activity.start({ input: { id: 'affectionate' } });
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('this is where they are');
        expect(suffix).toContain('They have not asked for anything more intense. Do not offer or imply it.');
        s.activity.stop('user');
    });
});

describe('the marker that leaked, and the movement it was asking for', () => {
    test('[[emote: lean_in thinking]] leaves the line and becomes a movement', () => {
        // Both halves of the defect. It was on screen and in the voice, and the `lean_in` it asked
        // for — one of the three intents Private may emit — was thrown away.
        const result = StageDirections.strip("[[emote: lean_in thinking]] I'd love to dive deeper.");
        expect(result.text).toBe("I'd love to dive deeper.");
        expect(StageDirections.presenceFrom(result.markers)).toEqual(['lean_in']);
    });

    test.each([
        ['[emote: smiling] Hello there.', 'Hello there.', 'smile_soft'],
        ['[[emote:nod_along]] Mm.', 'Mm.', 'nod_along'],
        ['[[action: shrug]] Whatever you like.', 'Whatever you like.', 'shrug'],
        ['[[gesture = breathe]] Come here.', 'Come here.', 'breathe'],
    ])('%s', (input, text, intent) => {
        const result = StageDirections.strip(input);
        expect(result.text).toBe(text);
        expect(StageDirections.presenceFrom(result.markers)).toEqual([intent]);
    });

    test('an unrecognised payload is still stripped, but asks for no movement', () => {
        // Markup on screen is the defect either way. Forwarding a name this file does not know
        // would be guessing at the animation registry's vocabulary.
        const result = StageDirections.strip('[[emote: some_unknown_thing]] Still here.');
        expect(result.text).toBe('Still here.');
        expect(StageDirections.presenceFrom(result.markers)).toEqual([]);
    });

    test('and ordinary brackets are still left alone', () => {
        // The reason the allowlist is narrow, and why the labelled form is its own pattern rather
        // than a loosening of it.
        for (const safe of [
            'The citation [1] and [sic] stay.',
            'A [label](url) link stays.',
            'He wrote [emotion] on the board.',
            'Array access a[0] is fine.',
        ]) {
            expect(StageDirections.strip(safe).text).toBe(safe);
        }
    });

    test('the sanitiser runs on the reply seam, so nothing reaches the voice', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.sanitizeReply('[[emote: lean_in]] Come closer.')).toBe('Come closer.');
        s.activity.stop('user');
    });
});
