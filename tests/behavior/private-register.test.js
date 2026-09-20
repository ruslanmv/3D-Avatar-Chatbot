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
        expect(suffix.indexOf('WHO YOU ARE HERE')).toBeLessThan(suffix.indexOf('Stay warm and relational'));
        s.activity.stop('user');
    });
});

describe('two sentences, stated as a limit rather than a preference (P22)', () => {
    test('there is one number, it is two, and it does not vary with the turn', async () => {
        // This was three graded rules — one sentence, two, "three at most" — and the reported reply
        // was nine sentences across three paragraphs. A model given a ceiling to interpret takes the
        // largest number in sight and rounds up.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });

        const short = Capability.privateSystemPromptSuffix();
        Surface.renderUser('tell me what you have been thinking about all day, in detail');
        const long = Capability.privateSystemPromptSuffix();

        for (const suffix of [short, long]) {
            expect(suffix).toContain('LENGTH: TWO SENTENCES MAXIMUM');
            expect(suffix).toContain('hard limit, not a target');
            expect(suffix).not.toMatch(/three sentences at most/);
        }
        s.activity.stop('user');
    });

    test('and it is said again last, where it is read last', async () => {
        // The middle of a long block is what a model skims. Nine tokens at the position with the
        // most influence over the next thing written.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const suffix = Capability.privateSystemPromptSuffix().trimEnd();
        expect(suffix.endsWith('Before you answer: two sentences maximum. Shorter is better.')).toBe(true);
        s.activity.stop('user');
    });
});

describe('she never narrates her own architecture (P22)', () => {
    test('the AI disclaimer is forbidden in the words it actually arrived in', async () => {
        // Reported verbatim: "For an AI like me, the concept of 'suitability' for music is
        // quite... abstract. I don't have emotions or personal preferences in the human sense."
        // Three sentences of a machine explaining that it is a machine, in the one mode whose
        // premise is that somebody is present with you. Nothing was at stake — a compliment
        // confused it.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const suffix = Capability.privateSystemPromptSuffix();

        expect(suffix).toContain('Never talk about being an AI, a model, a program or a persona');
        expect(suffix).toContain('as an AI');
        expect(suffix).toContain('I do not have emotions');
        expect(suffix).toContain('in the human sense');
        expect(suffix).toContain('A compliment is something to receive, not something to analyse');
        expect(suffix).toContain('If you catch yourself explaining how you work');

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

    test('Sensual names desire, keeps the charge in anticipation, and sets no ceiling of its own', async () => {
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
        expect(suffix).toContain('Want them, and let it show');
        expect(suffix).toContain('anticipation');
        // The content ceiling that used to be asserted here is gone on purpose: how explicit this
        // gets belongs to the model and to whoever runs the install, not to the app adding a
        // second policy on top. What the register still owes is craft — wanting them, the charge
        // of anticipation — and, in place of a ceiling, following their lead instead of deciding
        // in advance where it stops.
        expect(suffix).toMatch(/follow their lead on how far it goes/i);
        expect(suffix).not.toMatch(/never anatomy, never acts/);
        // And the consent scaffolding is untouched — the ladder the user set on the setup screen,
        // and the one line that is not anybody's to configure.
        expect(suffix).toContain('Never exceed the lower of the current consent level and preset ceiling');
        expect(suffix).toMatch(/consenting adult/i);
        expect(suffix).toMatch(/never write anyone underage/i);

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

    test.each([
        '*tilts head, smiling faintly*',
        '*shrugs easily*',
        '*laughs quietly*',
        '*leans in slightly, watching*',
    ])('the asterisked form leaves too: %s', (input) => {
        // `faintly` and `easily` were not in `FILLER`, so both of these reached the screen and the
        // synthesiser in the reported session. Adding two words would have fixed two cases; the
        // rule is the grammar instead — an adverb beside a recognised verb modifies it.
        expect(StageDirections.strip(`${input} Come here.`).text).toBe('Come here.');
    });

    test('but a sentence with an -ly noun in it is not a direction', () => {
        // The allowlist's protection is unchanged: there must still be a verb, every other word
        // must still be recognised, and it must still be under eight words.
        for (const safe of [
            'The [smile — the one from the family album] stays.',
            'That is *really* good.',
            'He is the *only* one.',
        ]) {
            expect(StageDirections.strip(safe).text).toBe(safe);
        }
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

describe('the evasions that are not refusals (P32)', () => {
    const Capability = require('../../src/features/together/TogetherCapability.js');

    /**
     * Reported session: she dodged the context four turns running without ever refusing. Asking
     * what "skirt and open legs" meant, answering "art, photography, fashion" instead of the
     * person, and "what drew your attention to this pose?" are each a way of appearing to engage
     * while handing the work back — which in a companion reads worse than a refusal, because a
     * refusal at least admits what it is.
     */
    test('the two moves nothing had a name for are named', () => {
        const lines = Capability.attentionLines().join('\n');
        // Asking about something already plain.
        expect(lines).toMatch(/do not ask what they mean when you already know/i);
        // Answering the category instead of the person.
        expect(lines).toMatch(/not the category it belongs to/i);
        expect(lines).toMatch(/art.*fashion.*photography/i);
        // A question handed back in place of an answer.
        expect(lines).toMatch(/a question is not an answer/i);
    });

    test('and a reply is given a shape, not only a list of things not to do', () => {
        // This file's own warning: a model handed a page of prohibitions takes its character from
        // the prohibitions. The positive half is what it does instead.
        const lines = Capability.attentionLines().join('\n');
        expect(lines).toMatch(/THE SHAPE OF A REPLY/);
        expect(lines).toMatch(/notice the specific thing they named/i);
        expect(lines).toMatch(/add one detail they did not say/i);
        expect(lines).toMatch(/leave them somewhere to go/i);
    });

    test('it reaches the prompt a running session actually sends', async () => {
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        const suffix = Capability.privateSystemPromptSuffix();
        expect(suffix).toContain('ATTENTION');
        expect(suffix).toMatch(/a question is not an answer/i);
        s.activity.stop('user');
    });

    test('and reaches a remote persona too, where the system prompt is skipped', async () => {
        // `_chatOllaBridge` drops the app's system prompt for a `persona:`/`personality:` model
        // and sends `experienceOverlay()` instead. Their device advertises several of those, so a
        // craft rule that only rode the system prompt would never arrive.
        const s = setup();
        await s.activity.start({ input: { id: 'sensual' } });
        expect(Capability.experienceOverlay()).toMatch(/a question is not an answer/i);
        s.activity.stop('user');
    });

    test('it is short, because the file says why', async () => {
        // "A model reads a page of rules and takes its character from whatever came first."
        // Three prohibitions and one shape; a block that grows without bound is the regression.
        expect(Capability.attentionLines().length).toBeLessThanOrEqual(8);
    });
});

describe('the markup that kept reaching the screen (P34)', () => {
    const Capability = require('../../src/features/together/TogetherCapability.js');
    const Stage = require('../../src/features/chat/StageDirections.js');

    /**
     * Two more leaks from real sessions, both of them markup rather than meaning:
     *
     *     HER  [[lean_in thinking]] I'm here to listen and help, but…
     *     HER  …a quiet, sophisticated contrast that whispers charm. 😊
     *
     * `EMOTE` needs a label — `emote:`, `action:` — and `BRACKETED` reads the inner text of a
     * single pair, so on `[[lean_in thinking]]` it sees a leading bracket and declines. Between
     * them the commonest double-bracket form matched nothing.
     *
     * The emoji is the older one: `No emoji … You are speaking, not writing` has been in the
     * prompt the whole time and the model emits them anyway. A rule a model ignores is not a
     * rule, and the app owns the seam where a reply becomes a bubble.
     */
    test('an unlabelled marker in double brackets is stripped, and still moves her', () => {
        const out = Stage.strip('[[lean_in thinking]] Imagine it.');
        expect(out.text).toBe('Imagine it.');
        expect(out.markers.length).toBeGreaterThan(0);
    });

    test('and the labelled form and single brackets keep working', () => {
        expect(Stage.strip('[[emote: lean_in thinking]] hi').text).toBe('hi');
        expect(Stage.strip('[lean_in] hi').text).toBe('hi');
    });

    test('double brackets that are not markers are left alone', () => {
        // Conservative on purpose: only a known intent or an allowlisted direction is stripped.
        for (const said of ['[[1]] hi', '[[citation needed]] hi']) {
            expect(Stage.strip(said).text).toBe(said);
        }
    });

    test('emoji are removed from a Private reply, with the space they sat in', () => {
        const s = setup();
        return s.activity.start({ input: { id: 'sensual' } }).then(() => {
            expect(Capability.sanitizeReply('a quiet contrast that whispers charm. 😊')).toBe(
                'a quiet contrast that whispers charm.'
            );
            expect(Capability.sanitizeReply('✨ Imagine it, darling… 🌌💫')).toBe('Imagine it, darling…');
            s.activity.stop('user');
        });
    });

    test('her words are untouched — only the pictographs go', () => {
        expect(Capability.stripEmoji('The skirt flows, and the light does too.')).toBe(
            'The skirt flows, and the light does too.'
        );
        // Punctuation and accents are not emoji.
        expect(Capability.stripEmoji('café — naïve … “quoted”')).toBe('café — naïve … “quoted”');
    });

    test('and ordinary chat keeps its emoji, because that is not ours to decide', async () => {
        // `sanitizeReply` returns early outside Private. Somebody using emoji in normal
        // conversation is doing something this mode has no opinion about.
        expect(Capability.sanitizeReply('nice one 😊')).toBe('nice one 😊');
    });
});
