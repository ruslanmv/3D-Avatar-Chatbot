/**
 * NL3–NL7. Words to body, through the one entry every surface uses.
 *
 * `NEXUS_MOTION.onUserUtterance` is what typed text, the desktop microphone, the companion
 * call and (NL7) the VR voice loop all call. These run the real MotionIntegration, fast path,
 * clip map, resolver, lifecycle and pose controller; the stand-ins are the pose system's bones,
 * the clip loader's files and the clock.
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
const fs = require('fs');
const path = require('path');
const Policy = require('../../src/xr/MotionPolicy');
const FastPath = require('../../src/xr/IntentFastPath');
const ClipMap = require('../../src/xr/MotionClipMap');
const Commands = require('../../src/xr/PoseCommands.js');
const Poses = require('../../src/experiences/private/PrivatePoseController.js');
const Service = require('../../src/xr/BodyPoseService.js');
const MI = require('../../src/xr/MotionIntegration');
const { catalogue, poseSystem } = require('./harness.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vendor/animations/manifest.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let sys;
let statuses;
let echoes;
let playing;
let played;
let loads;
let onAction;

/** What the reply would be told right now. */
const fact = () => (MI.systemPromptSuffix().split('YOUR BODY, RIGHT NOW')[1] || '').split('\n')[0];
const say = (text) => MI.onUserUtterance(text);
const pass = (ms) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Policy._setOverride({ enabled: true, movement: 'off' });
    ClipMap._setManifest(manifest);
    ClipMap.resetUnavailable();
    sys = poseSystem();
    statuses = [];
    echoes = [];
    playing = { isPlaying: false, clip: null, category: null };
    played = [];
    loads = { fail: null };

    window.AppLanguage = { code: 'en-US' };
    window.THREE = {
        Vector3: class {
            distanceTo(o) {
                return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
            }
        },
    };
    window.vrPoseSystem = sys;
    window.NEXUS_POSE_STUDIO_PANEL = { catalogue };
    window.NEXUS_POSE_COMMANDS = Commands;
    window.NEXUS_PRIVATE_POSES = Poses;
    window.NEXUS_INTENT_FASTPATH = FastPath;
    window.NEXUS_MOTION_CLIPS = ClipMap;
    window.NEXUS_MOTION = MI;
    window.NEXUS_MOTION_CONTRACT = require('../../src/xr/MotionContract');
    window.NEXUS_PROCEDURAL_ANIMATOR = { setAllowWithMixer: () => {}, setPoseMode: () => {} };
    window.__CLIP_ANIM_CONST__ = { setHumanoidAutoUpdate: () => {} };
    window.NEXUS_CLIP_LOADER = {
        getManifest: () => manifest,
        getCurrentPlaybackState: () => playing,
        loadClip: async (p) => (loads.fail && loads.fail.test(p) ? null : { duration: 4 }),
        playClip: async (p) => {
            playing = { isPlaying: true, clip: p, category: null };
            played.push(p);
            sys.animated = true; // a clip that plays moves her
            return true;
        },
        stopClip: () => {
            playing = { isPlaying: false, clip: null, category: null };
        },
    };
    window.NEXUS_BODY_POSES = Service.create({ win: window });
    onAction = (e) => {
        const d = e.detail || {};
        if (d.source === 'body_status') statuses.push(d.status);
        else echoes.push(`${d.source}:${d.label}`);
    };
    window.addEventListener('nexus-motion:action', onAction);
    MI.state.booted = true;
    MI.state.sitting = false;
    MI.state.laying = false;
    MI.onAvatarChanged({ position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, uuid: 'avatar-1' }, null);
    MI.holdForPoseStudio(false);
});

afterEach(() => {
    window.removeEventListener('nexus-motion:action', onAction);
    window.NEXUS_BODY_POSES.release('test-over');
    MI.holdForPoseStudio(false);
    MI.state.booted = false;
    Policy._setOverride(null);
    ClipMap._setManifest(null);
    for (const k of ['NEXUS_PRIVATE_ACTIONS', 'NEXUS_BODY_POSES', 'vrPoseSystem', 'AppLanguage', 'THREE'])
        delete window[k];
    jest.useRealTimers();
});

describe('a position asked for in the chat box', () => {
    test('is taken, and the status and the reply both follow her body, not the request', async () => {
        say('Kneel down.');
        expect(statuses).toEqual(['changing']);
        expect(fact()).toMatch(/not confirmed on screen yet/);
        expect(MI.getWorldSnapshot().body).toMatchObject({ action: 'pose:kneeling', status: 'requested' });
        await pass(1500);
        expect(statuses).toEqual(['changing', 'applied']);
        expect(sys.getCurrentPreset()).toBe('kneeling');
        expect(fact()).toMatch(/confirmed on screen/);
        expect(fact()).not.toMatch(/not confirmed/);
        expect(MI.getWorldSnapshot().body).toMatchObject({ action: 'pose:kneeling', status: 'confirmed' });
    });

    test.each([
        ['Sit with your legs crossed.', 'sittingCrossed'],
        ['Lie on your back.', 'lyingBack'],
        ['Please change your position to kneeling.', 'kneeling'],
    ])('%s → %s on her body', async (said, preset) => {
        say(said);
        await pass(1500);
        expect(sys.getCurrentPreset()).toBe(preset);
        expect(statuses.slice(-1)).toEqual(['applied']);
    });

    test('a spoken transcript (no capitals, no full stop) takes the same path to the same result', async () => {
        say('kneel down');
        await pass(1500);
        expect(sys.getCurrentPreset()).toBe('kneeling');
        expect(statuses).toEqual(['changing', 'applied']);
    });

    test('Italian in an Italian session; the same words do nothing to her in an English one', async () => {
        say('Inginocchiati');
        await pass(1500);
        expect(sys.calls).toEqual([]);
        window.AppLanguage = { code: 'it-IT' };
        say('Inginocchiati');
        await pass(1500);
        expect(sys.getCurrentPreset()).toBe('kneeling');
        say('Torna alla posizione precedente');
        await pass(4500);
        expect(sys.isHoldingBones()).toBe(false);
    });

    test('the reply waits for her body: whenBodySettled resolves at the confirmation, not before', async () => {
        expect(MI.whenBodySettled(3000)).toBeNull(); // nothing in flight, nobody waits
        say('Kneel down.');
        let settled = false;
        MI.whenBodySettled(3000).then(() => {
            settled = true;
        });
        await pass(200);
        expect(settled).toBe(false);
        await pass(1300);
        expect(settled).toBe(true);
        expect(fact()).toMatch(/confirmed on screen/);
    });

    test('a position that does not render is said to have failed, in the status and to the reply', async () => {
        window.vrPoseSystem = sys = poseSystem({ renders: false });
        say('Kneel down.');
        await pass(1500);
        expect(statuses).toEqual(['changing', 'failed']);
        expect(fact()).toMatch(/did not show on your body/);
        expect(fact()).not.toMatch(/confirmed on screen/);
        expect(MI.getWorldSnapshot().last_action).toMatchObject({ type: 'pose:kneeling', result: 'not-rendered' });
    });

    test('a position nobody has is refused without touching her', async () => {
        say('Change your position to a handstand.');
        await pass(300);
        expect(statuses).toEqual(['changing', 'unsupported']);
        expect(sys.calls).toEqual([]);
        expect(fact()).toMatch(/cannot take here/);
    });

    test('a request’s outcome is told for its own turn only; a held position stays told', async () => {
        say('Get into the relaxed pose.'); // two presets answer: a question back
        await pass(300);
        expect(fact()).toMatch(/Ask which one/);
        say('Tell me about your day.');
        expect(fact() || '').not.toMatch(/Ask which one/);
        say('Play the unicorn animation.');
        await pass(300);
        expect(fact()).toMatch(/isn't available/);
        say('Never mind.');
        expect(fact() || '').not.toMatch(/isn't available|Ask which one/);
        // A position she is in is still true on the turns after it was taken.
        say('Kneel down.');
        await pass(1500);
        say('How are you feeling?');
        expect(fact()).toMatch(/holding the position "Kneeling"/);
        expect(fact()).not.toMatch(/they asked for/);
    });

    test('the model’s own motion plan for the same turn is dropped: one request, one execution', async () => {
        say('Kneel down.');
        await pass(1500);
        const before = sys.calls.length;
        MI.processReply('Of course.\n```motion\n{"commands":[{"type":"sit"}]}\n```');
        await pass(500);
        expect(sys.calls.length).toBe(before);
        expect(MI.state.sitting).toBe(false);
    });
});

describe('what holds her and what takes over', () => {
    test('while a position is held, no idle is scheduled over it', async () => {
        say('Kneel down.');
        await pass(1500);
        const started = [];
        const play = window.NEXUS_CLIP_LOADER.playClip;
        window.NEXUS_CLIP_LOADER.playClip = async (p) => (started.push(p), play(p));
        await pass(20000);
        expect(started).toEqual([]);
        expect(sys.getCurrentPreset()).toBe('kneeling');
        expect(sys.isHoldingBones()).toBe(true);
    });

    test('"Stand up" while posed lets go of the position; with nothing held it is the fast path’s', async () => {
        say('Stand up.');
        expect(echoes).toEqual(['fastpath:stand']);
        expect(sys.calls).toEqual([]);
        say('Kneel down.');
        await pass(1500);
        say('Stand up.');
        await pass(4500);
        expect(statuses.slice(-2)).toEqual(['standing-up', 'stood']);
        expect(sys.isHoldingBones()).toBe(false);
        expect(fact()).toMatch(/standing again/);
    });

    test('an animation asked for while posed takes over: the position is let go first', async () => {
        say('Kneel down.');
        await pass(1500);
        say('Dance for me.');
        expect(sys.isHoldingBones()).toBe(false);
        expect(echoes).toContain('fastpath:dance');
        expect(fact()).not.toMatch(/Kneeling/);
    });

    test('bare "sit down" stays the fast path’s, untouched', () => {
        say('Sit down.');
        expect(echoes).toEqual(['fastpath:sit']);
        expect(statuses).toEqual([]);
        expect(sys.calls).toEqual([]);
    });

    test('another avatar: the held position is released and no fact about it survives', async () => {
        say('Kneel down.');
        await pass(1500);
        sys.avatarRoot = { uuid: 'avatar-2' };
        MI.onAvatarChanged({ position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, uuid: 'avatar-2' }, null);
        expect(sys.isHoldingBones()).toBe(false);
        expect(fact()).not.toMatch(/Kneeling/);
    });

    test('while Private is running, ordinary chat does not pose her: its bridge does', async () => {
        window.NEXUS_PRIVATE_ACTIONS = { active: () => true, ownsBody: () => false };
        say('Kneel down.');
        await pass(1500);
        expect(sys.calls).toEqual([]);
        expect(statuses).toEqual([]);
    });
});

describe('animations by name', () => {
    test('a named clip plays, and is confirmed from the player and from her moving', async () => {
        say('Play the Rumba animation.');
        expect(statuses).toEqual(['clip-starting']);
        expect(fact()).toMatch(/not confirmed on screen yet/);
        await pass(1200);
        expect(playing.clip).toMatch(/dance_rumba/);
        expect(statuses).toEqual(['clip-starting', 'clip-playing']);
        expect(fact()).toMatch(/is playing on your body now/);
        expect(MI.getWorldSnapshot().body.status).toBe('confirmed');
    });

    test('a clip the player reports while nothing on her moves is a failure', async () => {
        const loader = window.NEXUS_CLIP_LOADER;
        loader.playClip = async (p) => {
            playing = { isPlaying: true, clip: p, category: null };
            sys.animated = false; // "playing", and her hands never move
            return true;
        };
        say('Play the Rumba animation.');
        await pass(4000);
        expect(statuses).toEqual(['clip-starting', 'clip-failed']);
        expect(fact()).toMatch(/Nothing played/);
    });

    test('an animation that is not installed is said to be unavailable, and nothing plays', async () => {
        say('Play the unicorn animation.');
        await pass(500);
        expect(statuses).toEqual(['clip-unavailable']);
        // Her resting idle may start; nothing answering to the name does.
        expect(played.filter((p) => /unicorn/i.test(p))).toEqual([]);
        expect(fact()).toMatch(/isn't available for this character/);
        expect(MI.getWorldSnapshot().last_action).toMatchObject({ result: 'unknown_clip' });
    });

    test('an animation that is switched off is said to be switched off, and nothing plays', async () => {
        const off = ClipMap.registry().find((c) => c.why === 'quarantined');
        const only = ClipMap.registry;
        ClipMap.registry = () => [off];
        try {
            say(`Play the ${off.name} animation.`);
            await pass(500);
        } finally {
            ClipMap.registry = only;
        }
        expect(statuses).toEqual(['clip-disabled']);
        expect(played).not.toContain(off.path);
        expect(fact()).toMatch(/switched off for this character/);
    });

    test('a file that fails to load is reported, not claimed', async () => {
        loads.fail = /dance_rumba/;
        say('Play the Rumba animation.');
        await pass(1500);
        expect(statuses.slice(-1)).toEqual(['clip-unavailable']);
        expect(fact()).toMatch(/Nothing played/);
    });

    test('repeat plays the last one again; next moves on within its category; idle stops', async () => {
        say('Repeat that animation.');
        await pass(300);
        expect(statuses).toEqual(['clip-unavailable']); // nothing to repeat yet
        say('Play the Rumba animation.');
        await pass(1200);
        const first = playing.clip;
        playing = { isPlaying: false, clip: null, category: null };
        say('Repeat that animation.');
        await pass(1500);
        expect(playing.clip).toBe(first);
        say('Play the next animation.');
        await pass(1500);
        expect(playing.clip).not.toBe(first);
        expect(ClipMap.registry().find((c) => c.path === playing.clip).category).toBe('dance');
        say('Go back to idle.');
        expect(echoes).toContain('fastpath:stop');
    });

    test('the fast path keeps its own words; a gesture it has no rule for is found in the clip map', async () => {
        say('Do the peace sign.');
        expect(echoes).toEqual(['fastpath:peace_sign']);
        say('Clap your hands.');
        await pass(1500);
        expect(statuses).toContain('clip-starting');
        expect(MI.getWorldSnapshot().body.action).toBe('clap');
    });
});

describe('every surface reaches her through this entry', () => {
    test('typed text and the desktop microphone: handleUserMessage, which waits for her body', () => {
        const main = read('src/main.js');
        const handler = main.slice(
            main.indexOf('async function handleUserMessage'),
            main.indexOf('function _turnIsCurrent')
        );
        expect(handler).toMatch(/NEXUS_MOTION\?\.onUserUtterance\?\.\(text\)/);
        expect(handler.indexOf('whenBodySettled')).toBeGreaterThan(handler.indexOf('onUserUtterance'));
        expect(handler.indexOf('whenBodySettled')).toBeLessThan(handler.indexOf('_handleStreamingResponse'));
        // The microphone's transcript is sent through that same function.
        expect(main).toMatch(/handleUserMessage\(transcript\.trim\(\)\)/);
    });

    test('VR voice: the panel’s own message path calls the same entry and carries the same fact', () => {
        const vr = read('src/gltf-viewer/VRChatIntegration.js');
        const heard = vr.slice(vr.indexOf('    handleUserMessage(text) {'), vr.indexOf('    async processUserMessage'));
        const asked = vr.slice(
            vr.indexOf('    async processUserMessage'),
            vr.indexOf('    handleBotResponse(response) {')
        );
        expect(heard).toMatch(/NEXUS_MOTION\?\.onUserUtterance\?\.\(text\)/);
        expect(asked).toMatch(/whenBodySettled/);
        expect(asked).toMatch(/NEXUS_MOTION\?\.bodyFact\?\.\(\)/);
        expect(asked.indexOf('whenBodySettled')).toBeLessThan(asked.indexOf('bodyFact'));
    });

    test('the fact alone, for the VR panel: what her body did, or that it cannot move', async () => {
        expect(MI.bodyFact()).toBe('');
        say('Kneel down.');
        await pass(1500);
        expect(MI.bodyFact()).toMatch(/confirmed on screen/);
        Policy._setOverride({ enabled: false, movement: 'off' });
        expect(MI.bodyFact()).toMatch(/switched off/);
    });

    test('the modules are on the page whatever the engine switch says: three tags at the end of body', () => {
        const html = read('index.html');
        const tail = html.slice(html.lastIndexOf('AvatarLoadWatch.js'));
        for (const file of ['src/xr/PoseCommands.js', 'PrivatePoseController.js', 'src/xr/BodyPoseService.js'])
            expect(tail).toContain(file);
        expect(html.indexOf('src/xr/BodyPoseService.js')).toBeGreaterThan(html.indexOf('src/wardrobe/'));
    });
});
