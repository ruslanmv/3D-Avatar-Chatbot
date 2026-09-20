/**
 * The soundtrack is chosen once, at setup, and a Private session stays inside its own card.
 *
 * Reported, from one session:
 *
 *     HER  I can help you relax by putting on some calming music…
 *     HER  …Let me play something to match that vibe.
 *
 * and then, in the ordinary conversation *outside* the Private card:
 *
 *     NEXUS  Playing "Beautiful Relaxing Music — Piano, Cello & Guitar…"
 *            [YouTube card]
 *
 * Two bugs with one cause. The general media capability stayed switched on during Private, so
 * the model was told in the same breath that it could search for and play anything it liked:
 *
 *   * it replaced the soundtrack the preflight had already chosen — that track is not
 *     decoration, it was picked deliberately before the session opened and is meant to sit under
 *     the whole evening; and
 *   * the media pipeline publishes into the ordinary conversation, so the new song arrived as a
 *     `NEXUS` row with a card in the chat that Private is supposed to be contained within.
 *
 * The fix has the two halves this repository's capability pattern asks for: the prompt stops
 * offering it, and execution re-checks rather than trusting the prompt.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Capability = require('../../src/features/together/TogetherCapability.js');
const PlayDirective = require('../../src/features/together/PlayDirective.js');
const AmbienceDirective = require('../../src/features/ambience/SceneAmbienceDirective.js');
const AmbienceCapability = require('../../src/features/ambience/SceneAmbienceCapability.js');

/** A director with a Private session genuinely running, the way `privateContext` reads it. */
function privateRunning() {
    window.NEXUS_BD = {
        intimate: { active: true, preset: 'affectionate', _privateExperience: { mood: 'tender' } },
        adult: { active: true, level: 1 },
        blackboard: { adultVerified: true, nsfwAllowed: true },
    };
    window.NEXUS_SPICY = { usable: () => true };
}

function ordinaryChat() {
    window.NEXUS_BD = { intimate: { active: false }, adult: { active: false }, blackboard: {} };
    window.NEXUS_SPICY = { usable: () => true };
}

beforeEach(() => {
    Capability.resetChangeWindow();
    window.NEXUS_TOGETHER_CAPABILITY = Capability;
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true, onChange: () => () => {} };
    // A discovery provider exists, so `canSearch()` is true and the instruction is on the table.
    window.NEXUS_DISCOVERY = { forCapability: () => ({ search: () => Promise.resolve([]) }) };
});

afterEach(() => {
    Capability.resetChangeWindow();
    delete window.NEXUS_TOGETHER_CAPABILITY;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_DISCOVERY;
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
});

describe('the prompt stops offering it', () => {
    test('ordinary chat still knows how to play music', () => {
        // The capability is not being removed — it is being kept out of one place.
        ordinaryChat();
        expect(Capability.systemPromptSuffix()).toContain('MEDIA YOU CAN PLAY');
    });

    test('a running Private session is not told it can play anything', () => {
        privateRunning();
        const suffix = Capability.systemPromptSuffix();
        expect(suffix).not.toContain('MEDIA YOU CAN PLAY');
        expect(suffix).not.toContain('<play kind=');
    });

    test('and still gets everything Private needs to say', () => {
        // Withholding one block must not take the session's own instructions with it.
        privateRunning();
        expect(Capability.systemPromptSuffix()).toContain('ACTIVE PRIVATE EXPERIENCE');
    });

    test('the session is what decides, not the switch', () => {
        privateRunning();
        expect(Capability.privateSessionActive()).toBe(true);
        ordinaryChat();
        expect(Capability.privateSessionActive()).toBe(false);
    });
});

describe('execution re-checks, because a prompt is not a guarantee', () => {
    /**
     * A model can emit a tag it was told about a turn ago, a provider can answer from a cached
     * prompt, and a reply can outlive the moment it was asked for. So the prompt half is the
     * polite one and this is the half that holds.
     */
    test('a play tag inside Private is stripped and not acted on', () => {
        privateRunning();
        const intent = { fulfil: jest.fn(), list: jest.fn() };
        const out = PlayDirective.consume('Let me play something.\n<play kind="music">lounge jazz</play>', {
            intent,
        });

        expect(out).toBe('Let me play something.');
        expect(intent.fulfil).not.toHaveBeenCalled();
    });

    test('the same tag outside Private plays, exactly as before', () => {
        ordinaryChat();
        const intent = { fulfil: jest.fn(), list: jest.fn() };
        PlayDirective.consume('Here you go.\n<play kind="music">lounge jazz</play>', { intent });
        expect(intent.fulfil).toHaveBeenCalledWith(expect.objectContaining({ query: 'lounge jazz', kind: 'music' }));
    });

    test('a find tag inside Private shows no results either', () => {
        // Listing opens a picker in the ordinary conversation — the same leak by another route.
        privateRunning();
        const intent = { fulfil: jest.fn(), list: jest.fn() };
        PlayDirective.consume('<find kind="music">something calm</find>', { intent });
        expect(intent.list).not.toHaveBeenCalled();
    });

    test('and the claim backstop is silenced', () => {
        // It exists to make good on a sentence that claims to be playing something. Inside
        // Private the honest answer is that the chosen soundtrack is already playing; starting a
        // second one to match her words is precisely what was reported.
        privateRunning();
        const claim = { honour: jest.fn() };
        PlayDirective.consume('Let me put on something calming for us.', { claim });
        expect(claim.honour).not.toHaveBeenCalled();
    });

    test('the backstop still works in ordinary chat', () => {
        ordinaryChat();
        const claim = { honour: jest.fn() };
        PlayDirective.consume('Let me put on something calming for us.', { claim });
        expect(claim.honour).toHaveBeenCalled();
    });

    test('her sentence survives either way — only the acting stops', () => {
        // A reply that mentions music is still a reply. Dropping it would trade one bug for a
        // worse one: a turn where she says nothing at all.
        privateRunning();
        const said = PlayDirective.consume('Something soft, then.\n<play kind="music">piano</play>', {
            intent: { fulfil: jest.fn() },
        });
        expect(said).toBe('Something soft, then.');
    });

    test('a capability that throws is not treated as a live session', () => {
        // Fail-soft: if the check cannot be made, ordinary chat must keep working.
        const intent = { fulfil: jest.fn() };
        PlayDirective.consume('<play kind="music">x</play>', {
            intent,
            capability: {
                privateSessionActive() {
                    throw new Error('boom');
                },
            },
        });
        expect(intent.fulfil).toHaveBeenCalled();
    });
});

describe('the place is set at setup too, and stays set', () => {
    /**
     * The soundtrack was only half of it. A scene change is the same decision by the other door:
     * the setup screen picked where they are, and a model that moves the room mid-session undoes
     * the choice the person made there. If the AI can revisit either, the setup screen stops
     * meaning anything.
     */
    test('a running session is not offered the scene vocabulary', () => {
        privateRunning();
        const suffix = AmbienceCapability.systemPromptSuffix({
            switch: { isEnabled: () => true },
            capability: Capability,
        });
        expect(suffix).toBe('');
    });

    test('and a scene directive from the model is refused', () => {
        privateRunning();
        const controller = { requestByIntent: jest.fn() };
        const out = AmbienceDirective.consume('<ambience intent="beach"></ambience>Somewhere warmer.', {
            switch: { isEnabled: () => true },
            controller,
            capability: Capability,
        });
        expect(controller.requestByIntent).not.toHaveBeenCalled();
        expect(out).toContain('Somewhere warmer.');
    });

    test('outside Private the scene still changes as it always did', () => {
        ordinaryChat();
        const controller = { requestByIntent: jest.fn() };
        AmbienceDirective.consume('<ambience intent="beach"></ambience>Here we are.', {
            switch: { isEnabled: () => true },
            controller,
            capability: Capability,
        });
        expect(controller.requestByIntent).toHaveBeenCalled();
    });
});

describe('but the user may still ask, or the setup screen is a one-way door', () => {
    /**
     * The rule is about *who decides*, not about freezing the session. She must not reach for a
     * different track on her own initiative; the person who chose it may change their mind.
     */
    test('asking for different music lets the next reply act on it', () => {
        privateRunning();
        const intent = { fulfil: jest.fn() };
        // Blocked on her own initiative...
        PlayDirective.consume('<play kind="music">jazz</play>', { intent });
        expect(intent.fulfil).not.toHaveBeenCalled();

        // ...allowed once the person asks.
        Capability.noteUserTurn('play something else');
        PlayDirective.consume('<play kind="music">jazz</play>', { intent });
        expect(intent.fulfil).toHaveBeenCalled();
    });

    test('asking to stop the music counts as asking', () => {
        privateRunning();
        Capability.noteUserTurn('stop the music');
        expect(Capability.privateChangeAllowed()).toBe(true);
    });

    test('asking to change the place opens the same door', () => {
        privateRunning();
        const controller = { requestByIntent: jest.fn() };
        Capability.noteUserTurn('can we change the scene to a beach');
        AmbienceDirective.consume('<ambience intent="beach"></ambience>', {
            switch: { isEnabled: () => true },
            controller,
            capability: Capability,
        });
        expect(controller.requestByIntent).toHaveBeenCalled();
    });

    test('ordinary conversation does not open it by accident', () => {
        // The scene half is deliberately narrow. Mentioning a place is not asking to go there,
        // and a session that re-scened itself because somebody described a beach would be the
        // reported bug wearing a different hat.
        privateRunning();
        for (const said of [
            'Tell me what you had in mind.',
            'I had in mind a secluded beachside villa surrounded by greenery.',
            'That is a good answer.',
            'This music suits you.',
        ]) {
            Capability.noteUserTurn(said);
            expect(Capability.privateChangeAllowed()).toBe(false);
        }
    });

    test('permission belongs to the moment, not to the session', () => {
        // "Put something else on" five minutes ago must not authorise a swap she decides on now.
        privateRunning();
        Capability.noteUserTurn('play something else');
        expect(Capability.privateChangeAllowed()).toBe(true);

        const realNow = Date.now;
        Date.now = () => realNow() + Capability.CHANGE_WINDOW_MS + 1000;
        try {
            expect(Capability.privateChangeAllowed()).toBe(false);
        } finally {
            Date.now = realNow;
        }
    });

    test('only a user turn can open it — her own words cannot', () => {
        // `noteUserTurn` is called from `_onUserTurn` and nowhere else, so a reply that says
        // "let me play something" grants nothing.
        privateRunning();
        PlayDirective.consume('Let me play something to match that vibe.', {
            claim: { honour: jest.fn() },
        });
        expect(Capability.privateChangeAllowed()).toBe(false);
    });
});
