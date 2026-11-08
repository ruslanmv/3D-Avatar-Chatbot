/**
 * PW. attach(): the page wiring of the Private World, with the real modules behind it.
 *
 * Both defects the browser and real-model walkthroughs found lived here, not in create():
 * presence read a companion session Intimate never starts, and the room never heard a Private
 * turn because a Private session keeps its turns in its own card, not in window.chatHistory.
 * This file builds the page globals attach() reads, from the real catalogue, config, spots,
 * presets and template, and drives it the way the page does.
 */
const { fs, path, PW, Presence, Spots, Moods, Templates, Prompt, ROOT, read, cabaret, flush } = require('./harness.js');
const Worlds = require('../../src/gltf-viewer/VRWorlds.js');

const settle = async () => {
    for (let i = 0; i < 6; i++) await flush();
};

function page(options) {
    const o = options || {};
    const turns = []; // the Private card's own store
    const surface = { history: () => ({ id: 'private', getHistory: () => turns.slice() }) };
    const rt = {
        activeId: 'private-cabaret',
        spotId: null,
        sceneSrc: cabaret.scene.src,
        setMood: jest.fn(() => true),
        goToSpot: jest.fn(async (spot) => ((rt.spotId = spot.id), { ok: true })),
    };
    const state = { privateOpen: true, attested: true, adult: true, ...o };
    const target = new EventTarget();
    const g = {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target),
        CustomEvent: window.CustomEvent,
        fetch: async (url) => {
            const file = path.join(ROOT, String(url).replace(/^\//, ''));
            return fs.existsSync(file)
                ? { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) }
                : { ok: false };
        },
        NEXUS_PRIVATE_WORLD_CONFIG:
            o.deployment === false ? undefined : { enabled: true, eligibility: 'server-attested' },
        NEXUS_BD: {
            blackboard: {
                get adultVerified() {
                    return state.attested;
                },
            },
        },
        NEXUS_VIEWER: {
            vrWorlds: rt,
            avatarManager: { getCurrent: () => ({ url: 'vendor/avatars/fem_vroid.vrm' }) },
        },
        NEXUS_AVATAR_ADULT: { check: async () => ({ ok: state.adult }) },
        NEXUS_PLAYGROUND_REACTIVE: { privateOpenNow: () => state.privateOpen },
        NEXUS_WORLD_PRESENCE: Presence,
        NEXUS_WORLD_SPOTS: { ...Spots, load: (src) => Spots.load(src, (u) => g.fetch(u)) },
        NEXUS_VR_WORLDS: {
            ...Worlds,
            loadCatalogue: async () => Worlds.validateCatalogue(read('assets/vr-worlds/worlds.json')),
        },
        NEXUS_PLAYGROUND_TEMPLATES: Templates,
        NEXUS_PLAYGROUND_MOODS: Moods,
        NEXUS_CONVERSATION_SURFACE: surface,
        NEXUS_COMPANION_PROMPT: Prompt,
    };
    const room = PW.attach({ live: {}, global: g });
    g.__NEXUS_COMPANION_LIVE = { privateWorld: room };
    const show = () =>
        g.dispatchEvent(
            new window.CustomEvent('nexus-world-shown', {
                detail: { id: 'private-cabaret', base: 'private-cabaret', title: 'Private cabaret', rating: 'private' },
            })
        );
    const say = (text) => turns.push({ role: 'user', content: text });
    return { g, rt, room, state, show, say, turns };
}

describe('PW attach(): the page wiring', () => {
    test('off in a build without the deployment config, whatever else is true', async () => {
        const p = page({ deployment: false });
        await settle();
        p.show();
        await settle();
        expect(p.room.gate()).toEqual({ ok: false, why: 'disabled-in-this-build' });
        p.say('luce più calda');
        expect(PW.promptChunk(p.g)).toBe('');
        expect(p.rt.setMood).not.toHaveBeenCalled();
    });

    test('a Private turn (in the card, not chatHistory) reaches the room before the room is described', async () => {
        const p = page();
        await settle();
        p.show();
        await settle();
        expect(p.room.gate().ok).toBe(true);
        p.say('Mi metti una luce più calda?');
        const chunk = PW.promptChunk(p.g); // what Private's prompt asks for, at prompt time
        expect(p.rt.setMood).toHaveBeenCalledTimes(1);
        expect(chunk).toMatch(/Just now: warmer, softer light \(confirmed\)/);
        // The same turn read again (the companion's noticeTopic, a second prompt site) is not run twice.
        p.room.observeSurface();
        PW.promptChunk(p.g);
        expect(p.rt.setMood).toHaveBeenCalledTimes(1);
    });

    test('"where you are" is in the prompt without any companion session', async () => {
        const p = page();
        await settle();
        p.show();
        await settle();
        expect(PW.promptChunk(p.g)).toMatch(/Where you are together: Private cabaret/);
    });

    test('a step whose owner has not answered yet is described as in flight, never as done', async () => {
        const p = page();
        await settle();
        p.show();
        await settle();
        let land;
        p.rt.goToSpot.mockImplementationOnce(
            (spot) => new Promise((r) => (land = () => ((p.rt.spotId = spot.id), r({ ok: true }))))
        );
        p.say('andiamo vicino al sipario');
        const during = PW.promptChunk(p.g);
        expect(during).not.toMatch(/now you are by the curtain/);
        expect(during).toMatch(/on your way|Happening now/);
        land();
        await settle();
        expect(PW.promptChunk(p.g)).toMatch(/now you are by the curtain \(confirmed\)/);
    });

    test('an avatar Forge has not declared adult keeps the room shut', async () => {
        const p = page({ adult: false });
        await settle();
        p.show();
        await settle();
        expect(p.room.gate()).toEqual({ ok: false, why: 'avatar-not-declared-adult' });
        p.say('balla per me');
        expect(PW.promptChunk(p.g)).toBe('');
    });

    test('the attestation going away mid-session closes and revokes at the next turn', async () => {
        const p = page();
        await settle();
        p.show();
        await settle();
        p.say('luce più calda');
        PW.promptChunk(p.g);
        p.state.attested = false;
        p.say('luce dorata');
        expect(PW.promptChunk(p.g)).toBe('');
        expect(p.rt.setMood).toHaveBeenLastCalledWith(null, { instant: true });
        expect(p.room.state()).toMatchObject({ open: false, revoked: 'no-server-attestation', lit: false });
    });

    test('detach removes the listeners and revokes', async () => {
        const p = page();
        await settle();
        p.show();
        await settle();
        p.say('luce più calda');
        PW.promptChunk(p.g);
        p.room.detach();
        expect(p.rt.setMood).toHaveBeenLastCalledWith(null, { instant: true });
    });
});
