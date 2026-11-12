/**
 * Private can play music and change clothes without leaving the session.
 *
 * The ordinary player publishes a chat row. Try-On Haul opens another activity.
 * Neither belongs in an evening that is already underway. These cases are the
 * ones the action layer has to keep true: one request, the same consent, no
 * second panel, and a result that arrives after End does not touch the scene.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */

const Capability = require('../../src/features/together/TogetherCapability.js');
const PlayDirective = require('../../src/features/together/PlayDirective.js');
const Command = require('../../src/features/together/MediaCommand.js');
const Session = require('../../src/features/together/MediaSession.js');
const Policy = require('../../src/experiences/private/PrivateActionPolicy.js');
const Media = require('../../src/experiences/private/PrivateMediaController.js');
const Bridge = require('../../src/experiences/private/PrivateActionBridge.js');
const Wardrobe = require('../../src/wardrobe/InSceneWardrobe.js');
const Clean = require('../../src/features/chat/ReplyClean.js');
const PrivateConversationView = require('../../src/features/together/ui/PrivateConversationView.js');

const DRESS = {
    id: 'little-black-dress',
    name: 'Little black dress',
    group: 'dressy',
    vrmUrl: 'https://example.com/dress.vrm',
};
const COZY = { id: 'knit-set', name: 'Knit set', group: 'cozy', vrmUrl: 'https://example.com/knit.vrm' };
const LINGERIE = {
    id: 'lace-set',
    name: 'Lace set',
    group: 'lingerie',
    private: true,
    rating: 'private',
    vrmUrl: 'https://example.com/lace.vrm',
};

function privateRunning() {
    window.NEXUS_BD = {
        intimate: { active: true, preset: 'affectionate', _privateExperience: { mood: 'tender' } },
        adult: { active: true, level: 2 },
        blackboard: { adultVerified: true, nsfwAllowed: true },
    };
    window.NEXUS_SPICY = { usable: () => true };
    window.NEXUS_TOGETHER_CAPABILITY = Capability;
    window.NEXUS_PRIVATE_ACTION_POLICY = Policy;
    window.NEXUS_PRIVATE_ACTION_BRIDGE = Bridge;
    window.NEXUS_PRIVATE_MEDIA = Media;
    window.NEXUS_IN_SCENE_WARDROBE = Wardrobe;
    window.NEXUS_MEDIA_COMMAND = Command;
}

function viewDouble() {
    const view = {
        attachSoundtrack: jest.fn(),
        showSeamlessStatus: jest.fn(),
        _history: [],
    };
    window.NEXUS_BD.intimate._privateExperience.view = view;
    return view;
}

async function flush() {
    for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    localStorage.clear();
    Session.reset();
    Policy.setAutonomy('suggest');
    Policy.setMatureCategories(false);
    Policy.setKeepAfterPrivate(false);
    Capability.resetChangeWindow();
    Bridge.reset();
    Media.reset();
    Wardrobe.reset();
    privateRunning();
    window.NEXUS_MEDIA_SESSION = Session;
    window.NEXUS_CONVERSATION_PUBLISHER = { publish: jest.fn() };
    window.AppLanguage = { code: 'it-IT' };
});

afterEach(() => {
    Capability.resetChangeWindow();
    Bridge.reset();
    Media.reset();
    Wardrobe.reset();
    Session.reset();
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_TOGETHER_CAPABILITY;
    delete window.NEXUS_PRIVATE_ACTION_POLICY;
    delete window.NEXUS_PRIVATE_ACTION_BRIDGE;
    delete window.NEXUS_PRIVATE_MEDIA;
    delete window.NEXUS_IN_SCENE_WARDROBE;
    delete window.NEXUS_MEDIA_COMMAND;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_MEDIA_INTENT;
    delete window.NEXUS_CONVERSATION_PUBLISHER;
    delete window.NEXUS_YT_2D;
    delete window.AppLanguage;
    document.body.innerHTML = '';
});

describe('music stays inside the Private session', () => {
    test('“Suona Daft Punk ora” is one request and the evening does not change', async () => {
        const view = viewDouble();
        const level = window.NEXUS_BD.adult.level;
        window.NEXUS_MEDIA_INTENT = {
            search: jest.fn(async () => [
                {
                    id: 'dp1',
                    title: 'Daft Punk - Get Lucky',
                    creator: 'Daft Punk',
                    url: 'https://www.youtube.com/watch?v=dp1',
                },
            ]),
        };
        Capability.noteUserTurn('Sì, suona Daft Punk ora');
        await flush();
        PlayDirective.consume('Volentieri. <play kind="music">Daft Punk</play>', {
            intent: { fulfil: jest.fn(), list: jest.fn() },
        });
        await flush();

        expect(window.NEXUS_MEDIA_INTENT.search).toHaveBeenCalledTimes(1);
        expect(window.NEXUS_MEDIA_INTENT.search).toHaveBeenCalledWith('Daft Punk', 'music');
        expect(window.NEXUS_CONVERSATION_PUBLISHER.publish).not.toHaveBeenCalled();
        expect(view.attachSoundtrack).toHaveBeenCalledTimes(1);
        expect(Capability.privateSessionActive()).toBe(true);
        expect(window.NEXUS_BD.adult.level).toBe(level);
        expect(window.NEXUS_BD.intimate._privateExperience.mood).toBe('tender');
        expect(Session.isPlaying()).toBe(false);
        expect(view.showSeamlessStatus).not.toHaveBeenCalledWith(
            expect.objectContaining({ kicker: 'Musica in riproduzione' })
        );
    });

    test('“Che musica ti piace?” does not start playback', async () => {
        window.NEXUS_MEDIA_INTENT = { search: jest.fn() };
        Capability.noteUserTurn('Che musica ti piace?');
        await flush();
        expect(window.NEXUS_MEDIA_INTENT.search).not.toHaveBeenCalled();
        expect(Capability.privateActionAllowed('music')).toBe(false);
        expect(Capability.privateSessionActive()).toBe(true);
    });

    test('“Play something relaxing” plays only after the request, and only a fitting track', async () => {
        const view = viewDouble();
        window.NEXUS_MEDIA_INTENT = {
            search: jest.fn(async () => [
                { id: 'gym', title: 'Workout Motivation Mix', url: 'https://www.youtube.com/watch?v=gym' },
                {
                    id: 'soft',
                    title: 'Soft Piano for a Candlelit Evening',
                    url: 'https://www.youtube.com/watch?v=soft',
                },
            ]),
        };
        PlayDirective.consume('<play kind="music">something relaxing</play>');
        await flush();
        expect(window.NEXUS_MEDIA_INTENT.search).not.toHaveBeenCalled();

        Capability.noteUserTurn('Play something relaxing');
        await flush();
        expect(window.NEXUS_MEDIA_INTENT.search).toHaveBeenCalledWith(Media.MOOD_QUERY, 'music');
        expect(view.attachSoundtrack).toHaveBeenCalledWith(expect.objectContaining({ id: 'soft' }), expect.anything());
        expect(Capability.privateActionAllowed('scene')).toBe(false);
    });

    test('a blocked autoplay shows Play and does not claim the song started', async () => {
        const view = viewDouble();
        window.NEXUS_MEDIA_INTENT = {
            search: jest.fn(async () => [
                { id: 'dp1', title: 'Daft Punk - Get Lucky', url: 'https://www.youtube.com/watch?v=dp1' },
            ]),
        };
        const embed = { activate: jest.fn(), control: jest.fn() };
        window.NEXUS_YT_2D = embed;
        const pending = Bridge.execute({ kind: 'music.play', source: 'user', args: { query: 'Daft Punk' } });
        await pending;
        Session.markBlocked();
        const blocked = view.showSeamlessStatus.mock.calls.map((call) => call[0].kicker);
        expect(blocked).toContain('Tocca Play per far partire la musica');
        expect(blocked).not.toContain('Musica in riproduzione');
        const playCall = view.showSeamlessStatus.mock.calls.find((call) => call[0].onPlay);
        expect(playCall).toBeTruthy();
        view._soundtrackCard = {};
        playCall[0].onPlay();
        expect(embed.activate).toHaveBeenCalled();
        expect(Session.status()).toBe('blocked');
    });

    test('a result that arrives after Private ended does not start the strip', async () => {
        viewDouble();
        let release;
        window.NEXUS_MEDIA_INTENT = {
            search: () =>
                new Promise((resolve) => {
                    release = () =>
                        resolve([{ id: 'late', title: 'Late', url: 'https://www.youtube.com/watch?v=late' }]);
                }),
        };
        const pending = Bridge.execute({ kind: 'music.play', source: 'user', args: { query: 'Daft Punk' } });
        await flush();
        window.NEXUS_BD.intimate._privateExperience._stopped = true;
        Bridge.cancel('private');
        release();
        const result = await pending;
        expect(result.ok).toBe(false);
        expect(window.NEXUS_BD.intimate._privateExperience.view.attachSoundtrack).not.toHaveBeenCalled();
    });
});

describe('clothes change inside the scene', () => {
    test('wardrobe.wear applies a look and does not open Try-On', async () => {
        const startActivity = jest.fn();
        const controller = {
            avatarId: 'her',
            original: { url: 'https://example.com/her.vrm' },
            applyLook: jest.fn(async (look) => look),
            snapshot: jest.fn(),
        };
        const result = await Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'little-black-dress' },
            {
                source: 'user',
                session: Capability.privateSessionSnapshot(),
                looks: [DRESS, COZY],
                controller,
                eligibility: { mode: 'open' },
                panel: { startActivity },
            }
        );
        expect(result.ok).toBe(true);
        expect(controller.applyLook).toHaveBeenCalledWith(expect.objectContaining({ id: 'little-black-dress' }));
        expect(startActivity).not.toHaveBeenCalled();
        expect(Capability.privateSessionActive()).toBe(true);
        expect(window.NEXUS_BD.adult.level).toBe(2);
    });

    test('an unsolicited choice waits, and an allowed one picks an elegant saved look', async () => {
        const controller = {
            original: { url: 'https://example.com/her.vrm' },
            applyLook: jest.fn(async (look) => look),
            snapshot: jest.fn(),
        };
        const refused = await Wardrobe.execute(
            'wardrobe_wear',
            { choose: true, occasion: 'elegant' },
            { source: 'assistant', session: Capability.privateSessionSnapshot(), looks: [DRESS, COZY], controller }
        );
        expect(refused.ok).toBe(false);
        expect(refused.reason).toBe('needs-confirmation');
        expect(controller.applyLook).not.toHaveBeenCalled();

        Policy.setAutonomy('auto');
        const chosen = await Wardrobe.execute(
            'wardrobe_wear',
            { choose: true, occasion: 'elegant' },
            { source: 'assistant', session: Capability.privateSessionSnapshot(), looks: [COZY, DRESS], controller }
        );
        expect(chosen.ok).toBe(true);
        expect(controller.applyLook).toHaveBeenCalledWith(expect.objectContaining({ id: 'little-black-dress' }));
    });

    test('a mature look is refused when the avatar is not eligible', async () => {
        Policy.setMatureCategories(true);
        const controller = { applyLook: jest.fn(), original: { url: 'https://example.com/her.vrm' } };
        const result = await Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'lace-set' },
            {
                source: 'user',
                session: Capability.privateSessionSnapshot(),
                looks: [LINGERIE, DRESS],
                controller,
                eligibility: { mode: 'locked' },
            }
        );
        expect(result.reason).toBe('avatar-ineligible');
        expect(controller.applyLook).not.toHaveBeenCalled();
    });

    test('a Forge job that finishes after Private ended does not apply', async () => {
        const session = Capability.privateSessionSnapshot();
        let release;
        const generator = {
            create: () =>
                new Promise((resolve) => {
                    release = () => resolve({ name: 'Late dress', vrmUrl: 'https://example.com/late.vrm' });
                }),
        };
        const controller = {
            applyLook: jest.fn(async (look) => look),
            original: { url: 'https://example.com/her.vrm' },
        };
        const pending = Wardrobe.execute(
            'wardrobe_create',
            { prompt: 'black satin dress' },
            { source: 'user', session, generator, controller, eligibility: { mode: 'open' } }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        session.stopped = true;
        release();
        const result = await pending;
        expect(result.ok).toBe(false);
        expect(controller.applyLook).not.toHaveBeenCalled();
    });

    test('two rapid wears do not overlap, and the later one is what she has on', async () => {
        let active = 0;
        let max = 0;
        const worn = [];
        const controller = {
            original: { url: 'https://example.com/her.vrm' },
            applyLook: jest.fn(async (look) => {
                active += 1;
                max = Math.max(max, active);
                await Promise.resolve();
                active -= 1;
                worn.push(look.id);
                return look;
            }),
        };
        const session = Capability.privateSessionSnapshot();
        const first = Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'knit-set' },
            { source: 'user', session, looks: [COZY, DRESS], controller }
        );
        const second = Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'little-black-dress' },
            { source: 'user', session, looks: [COZY, DRESS], controller }
        );
        const results = await Promise.all([first, second]);
        expect(max).toBeLessThanOrEqual(1);
        expect(worn[worn.length - 1]).toBe('little-black-dress');
        expect(results.some((item) => item.reason === 'superseded' || item.ok)).toBe(true);
    });

    test('“Fammi vedere diversi vestiti” does not navigate and does not grant a wear', () => {
        const startActivity = jest.fn();
        window.NEXUS_TRY_ON = { activity: { request: jest.fn() }, panel: { startActivity } };
        Capability.noteUserTurn('Fammi vedere diversi vestiti');
        expect(Capability.privateActionAllowed('wardrobe')).toBe(false);
        expect(startActivity).not.toHaveBeenCalled();
        expect(window.NEXUS_TRY_ON.activity.request).not.toHaveBeenCalled();
    });

    test('ending Private restores the previous outfit unless the person asked to keep it', async () => {
        const controller = {
            original: { url: 'https://example.com/her.vrm', name: 'Her' },
            activeLook: null,
            applyLook: jest.fn(async (look) => {
                controller.activeLook = look;
                return look;
            }),
            restore: jest.fn(async () => {
                controller.activeLook = null;
                return true;
            }),
            snapshot: jest.fn(),
        };
        const session = Capability.privateSessionSnapshot();
        await Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'little-black-dress' },
            { source: 'user', session, looks: [DRESS], controller }
        );
        await Wardrobe.release({ controller });
        expect(controller.restore).toHaveBeenCalled();

        Policy.setKeepAfterPrivate(true);
        controller.restore.mockClear();
        await Wardrobe.execute(
            'wardrobe_wear',
            { outfit: 'little-black-dress' },
            { source: 'user', session, looks: [DRESS], controller }
        );
        await Wardrobe.release({ controller });
        expect(controller.restore).not.toHaveBeenCalled();
    });
});

describe('the conversation surface', () => {
    test('a thought and a tool tag never become the line she says', () => {
        const shown = PlayDirective.consume(
            Clean.stripThought(
                'THINK: The user wants music. I should hide this.\n\nResto qui con te. <play kind="music">jazz</play>'
            )
        );
        expect(shown).toBe('Resto qui con te.');
        expect(shown).not.toMatch(/THINK|<play|hide this/);
    });

    test('status is one line inside the Private card, on a narrow viewport too', () => {
        document.body.innerHTML = `
            <section class="chat-panel">
                <div id="chat-history"></div>
                <input id="speech-text">
                <button id="speak-btn" type="button">Send</button>
            </section>`;
        const view = new PrivateConversationView.View({ doc: document, win: window });
        expect(view.mount({ preset: { label: 'Romantic' }, scene: 'Sala' })).toBe(true);
        const before = view._history.length;
        view.showSeamlessStatus({
            kicker: 'Musica in riproduzione',
            title: 'Daft Punk',
            playLabel: 'Riproduci',
            onPlay: () => {},
        });
        view.showSeamlessStatus({
            kicker: "Cambio d'abito completato",
            title: 'Abito nero',
            undoLabel: 'Annulla',
            onUndo: () => {},
        });
        const row = document.getElementById('nexus-private-conversation-row');
        expect(row.querySelectorAll('.nexus-private-seamless')).toHaveLength(1);
        expect(document.querySelectorAll('.nexus-private-seamless')).toHaveLength(1);
        expect(row.textContent).toContain("Cambio d'abito completato");
        expect(view._history.length).toBe(before);
        view.history().persist();
        expect(view._history.length).toBe(before);
        view.destroy();
    });

    test('the ordinary media intercept does not fire during Private', () => {
        window.__NEXUS_YT_ASK_NOAUTO__ = true;
        jest.resetModules();
        document.body.innerHTML =
            '<input id="speech-text" value="play music please"><button id="speak-btn" type="button"></button><div id="chat-history"></div>';
        const Ask = require('../../src/features/youtube/YouTubeAsk.js');
        const input = document.getElementById('speech-text');
        const fulfil = jest.fn();
        window.NEXUS_MEDIA_INTENT = { fulfil };
        window.NEXUS_TOGETHER_CAPABILITY = { privateSessionActive: () => true };
        Ask.hook(document);
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(fulfil).not.toHaveBeenCalled();
        expect(input.value).toBe('play music please');
    });
});
