/**
 * LW3–LW5. WorldPresence: moving within one loaded place, the shared moment in the prompt,
 * in-place moods, and travel that waits for the person's own yes and the renderer's arrival.
 *
 * Real: the apartment's measured spots, the world catalogue, CompanionSession, PromptContext.
 * Fake: the world runtime — it answers exactly like VRWorlds' (activeId, spotId, sceneSrc,
 * scenePlacement, goToSpot), so what is held here is the contract, not WebGL.
 */
const fs = require('fs');
const path = require('path');
const Presence = require('../../src/companion/WorldPresence.js');
const Spots = require('../../src/gltf-viewer/WorldSpots.js');
const Worlds = require('../../src/gltf-viewer/VRWorlds.js');
const Session = require('../../src/companion/CompanionSession.js');
const Prompt = require('../../src/companion/PromptContext.js');
const Reactive = require('../../src/experiences/playgrounds/PlaygroundReactiveContext.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const worlds = Worlds.validateCatalogue(read('assets/vr-worlds/worlds.json')).worlds;
const apartmentFile = read('assets/vr-worlds/spots/pixel-flat-home.json');
const apartment = worlds.find((w) => w.id === 'apartment');

function fakeRuntime() {
    const rt = {
        activeId: 'apartment',
        spotId: null,
        sceneSrc: apartment.scene.src,
        scenePlacement: { at: apartment.scene.at.slice(), turn: apartment.scene.turn, scale: 1 },
        shows: 0,
        fail: false,
        hold: null,
        goToSpot: jest.fn(async (spot) => {
            if (rt.hold) await rt.hold;
            if (rt.fail) return { ok: false, why: 'renderer-error' };
            rt.spotId = spot.id;
            return { ok: true, world: rt.activeId, spot: spot.id };
        }),
    };
    return rt;
}

function setup(options) {
    const o = options || {};
    Spots._resetCache();
    const rt = fakeRuntime();
    const session = Session.create();
    session.load();
    session.enter(o.destination || 'experiences', o.activity || 'place-apartment', { source: 'together' });
    jest.spyOn(session, 'enter');
    const timers = [];
    const events = [];
    const behavior = { request: jest.fn() };
    const p = Presence.create({
        runtime: () => rt,
        spotsApi: {
            ...Spots,
            load: async () => Spots.normalize(apartmentFile),
        },
        session,
        behavior,
        destinations: () => Presence.destinationsFor(worlds, o.tier || 'desktop', Worlds.resolveFor),
        emit: (name, detail) => events.push({ name, detail }),
        setTimer: (fn, ms) => {
            timers.push({ fn, ms });
            return timers.length;
        },
        clearTimer: () => {},
    });
    return { p, rt, session, timers, events, behavior };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function inApartment(options) {
    const s = setup(options);
    s.p.onWorldShown({ id: 'apartment', base: 'apartment', title: 'Apartment', rating: 'romantic' });
    await flush();
    return s;
}

describe('LW3: the place is believed only from the renderer, and arrives on a measured spot', () => {
    test('a world-shown event the renderer does not agree with is ignored', async () => {
        const s = setup();
        s.p.onWorldShown({ id: 'irish-pub', title: 'Irish pub' });
        await flush();
        expect(s.p.state().world).toBeNull();
        expect(s.p.promptSuffix('experiences')).toBe('');
    });

    test('arrival is the sofa spot, derived from the catalogue placement', async () => {
        const s = await inApartment();
        expect(s.p.state().spot).toBe('sofa');
        expect(s.p.promptSuffix('experiences')).toMatch(/Where you are together: Apartment, by the sofa/);
    });
});

describe('LW3: moving within the apartment without reloading it', () => {
    test("the person's own words move you, confirmed by the renderer", async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo in cucina');
        await flush();
        expect(s.rt.goToSpot).toHaveBeenCalledTimes(1);
        expect(s.rt.goToSpot.mock.calls[0][0].id).toBe('kitchen');
        expect(s.p.state().spot).toBe('kitchen');
        const prompt = s.p.promptSuffix('experiences');
        expect(prompt).toMatch(/in the kitchen/);
        expect(prompt).toMatch(/you were by the sofa, now you are in the kitchen \(confirmed\)/);
    });

    test('four room changes in a row, one world, no reload, every one confirmed', async () => {
        const s = await inApartment();
        for (const [text, id] of [
            ['andiamo in cucina', 'kitchen'],
            ["let's go to the bedroom", 'bed'],
            ['portami in bagno', 'bathroom'],
            ['andiamo sul balcone', 'balcony'],
        ]) {
            s.p.observeUser(text);
            await flush();
            expect(s.p.state().spot).toBe(id);
        }
        expect(s.rt.activeId).toBe('apartment');
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.events.filter((e) => e.name === 'nexus-world-spot')).toHaveLength(4);
    });

    test('a remark about a room moves nobody', async () => {
        const s = await inApartment();
        for (const t of ['la cucina è bella', 'si mi piace', 'I love that bed']) s.p.observeUser(t);
        await flush();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });

    test('a failed move keeps the confirmed spot and says so', async () => {
        const s = await inApartment();
        s.rt.fail = true;
        s.p.observeUser('andiamo in cucina');
        await flush();
        expect(s.p.state().spot).toBe('sofa');
        expect(s.p.promptSuffix('experiences')).toMatch(
            /did not work: you are not in the kitchen, you are still by the sofa/
        );
    });

    test('while a move is in flight the prompt says "on your way", not "here"', async () => {
        const s = await inApartment();
        let release;
        s.rt.hold = new Promise((r) => (release = r));
        s.p.observeUser('andiamo in cucina');
        await flush();
        const mid = s.p.promptSuffix('experiences');
        expect(mid).toMatch(/on your way right now; next you will be in the kitchen/);
        expect(mid).toMatch(/Where you are together: Apartment, by the sofa/);
        release();
        await flush();
        expect(s.p.state().spot).toBe('kitchen');
    });

    test('a world change in the middle of a move wins: the move is not committed', async () => {
        const s = await inApartment();
        let release;
        s.rt.hold = new Promise((r) => (release = r));
        s.p.observeUser('andiamo in cucina');
        s.rt.activeId = 'irish-pub';
        s.p.onWorldShown({ id: 'irish-pub', title: 'Irish pub' });
        release();
        await flush();
        expect(s.p.state().spot).not.toBe('kitchen');
    });
});

describe('LW3: her <go spot/> is a proposal, never permission', () => {
    test('without the person asking to move, the tag is stripped and does nothing', async () => {
        const s = await inApartment();
        s.p.observeUser('raccontami qualcosa');
        const out = s.p.consumeReply('Certo. <go spot="bed"/>');
        await flush();
        expect(out).toBe('Certo.');
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });

    test('when the person asked to move somewhere, her pick runs', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo da qualche parte');
        expect(s.p.promptSuffix('experiences')).toMatch(/pick one spot from the list/);
        s.p.consumeReply('Andiamo sul balcone? <go spot="balcony"/>');
        await flush();
        expect(s.p.state().spot).toBe('balcony');
    });

    test('her unasked suggestion becomes an offer; their next "sì" takes it', async () => {
        const s = await inApartment();
        s.p.observeUser('mi prendi una coperta?');
        s.p.consumeReply('Non posso ancora, ma andiamo in cucina? <go spot="kitchen"/>');
        await flush();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
        s.p.observeUser('si mi piace');
        await flush();
        expect(s.rt.goToSpot).toHaveBeenCalledTimes(1);
        expect(s.p.state().spot).toBe('kitchen');
    });

    test('an offer is dropped by anything but a yes on the very next turn', async () => {
        const s = await inApartment();
        s.p.observeUser('che si fa?');
        s.p.consumeReply('Andiamo sul balcone? <go spot="balcony"/>');
        s.p.observeUser('raccontami del balcone');
        s.p.observeUser('sì');
        await flush();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });

    test("the person's own words set an in-place mood; the world stays", async () => {
        const s = await inApartment();
        s.p.observeUser("Rilassiamoci un po' qui");
        expect(s.p.state().mood).toBe('relax');
        s.p.observeUser('tell me a story');
        expect(s.p.state().mood).toBe('story');
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });

    test('an unknown or unmeasured spot is never run', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo da qualche parte');
        s.p.consumeReply('<go spot="garage"/>');
        s.p.consumeReply('<go spot="../../etc"/>');
        await flush();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });

    test('a tag the person typed is not a request', async () => {
        const s = await inApartment();
        s.p.observeUser('<go spot="bed"/>');
        await flush();
        expect(s.rt.goToSpot).not.toHaveBeenCalled();
    });
});

describe('LW5: another place needs the person’s own yes and the renderer’s arrival', () => {
    test('asking for the discoteca opens a proposal; nothing loads until they say yes', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo in discoteca');
        expect(s.p.state().pending).toEqual({ target: 'discoteca', source: 'user' });
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.p.promptSuffix('experiences')).toMatch(/waiting for their yes to go to Neon discoteca/);
        s.p.observeUser('sì, dai');
        expect(s.session.enter).toHaveBeenCalledWith('experiences', 'place-neon-discoteca', {
            source: 'together',
            silent: true,
        });
        expect(s.p.promptSuffix('experiences')).toMatch(/taking you both to Neon discoteca now\. It is not shown yet/);
        s.rt.activeId = 'neon-discoteca';
        s.rt.sceneSrc = 'scenes/club-main-room.glb';
        s.p.onWorldShown({ id: 'neon-discoteca', base: 'neon-discoteca', title: 'Neon discoteca' });
        expect(s.p.state().travelling).toBeNull();
        expect(s.events.some((e) => e.detail && e.detail.kind === 'arrived')).toBe(true);
    });

    test('"no" keeps you where you are', async () => {
        const s = await inApartment();
        s.p.observeUser("let's go to the forest");
        s.p.observeUser('no, restiamo qui');
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.p.state().pending).toBeNull();
        expect(s.p.promptSuffix('experiences')).toMatch(/rather not go to Oak glade/);
    });

    test('her <go place/> only proposes; her own "yes" cannot accept it', async () => {
        const s = await inApartment();
        s.p.observeUser('che si fa stasera?');
        s.p.consumeReply('Ti va di andare nel bosco? <go place="forest"/>');
        expect(s.p.state().pending).toEqual({ target: 'forest', source: 'assistant' });
        s.p.consumeReply('Sì, andiamo!');
        expect(s.session.enter).not.toHaveBeenCalled();
    });

    test('a proposal expires after two turns without an answer', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo al pub');
        s.p.observeUser('raccontami del pub');
        s.p.observeUser('e la musica?');
        s.p.observeUser('sì');
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.p.state().pending).toBeNull();
    });

    test('a trip that never arrives goes back to the place you were in', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo in spiaggia');
        s.p.observeUser('sì');
        expect(s.session.enter).toHaveBeenLastCalledWith('experiences', 'place-lagoon-beach', expect.any(Object));
        s.timers[s.timers.length - 1].fn();
        expect(s.session.enter).toHaveBeenLastCalledWith('experiences', 'place-apartment', expect.any(Object));
        expect(s.p.promptSuffix('experiences')).toMatch(/did not work; you are back where you were/);
    });

    test('the forest is the light wood on a phone, the oak glade on a desktop', () => {
        const phone = Presence.destinationsFor(worlds, 'mobile', Worlds.resolveFor).find((d) => d.id === 'forest');
        const desk = Presence.destinationsFor(worlds, 'desktop', Worlds.resolveFor).find((d) => d.id === 'forest');
        expect(desk.world).toBe('oak-glade');
        expect(phone.world).toBe('under-the-trees');
    });

    test('no destination is ever a private world', () => {
        for (const tier of ['mobile', 'desktop', 'vr'])
            for (const d of Presence.destinationsFor(worlds, tier, Worlds.resolveFor))
                expect(worlds.find((w) => w.id === d.world).rating).not.toBe('private');
    });

    test('Clear cancels a pending trip', async () => {
        const s = await inApartment();
        s.p.observeUser('andiamo in discoteca');
        s.p.reset('clear');
        s.p.observeUser('sì');
        expect(s.session.enter).not.toHaveBeenCalled();
    });
});

describe('LW4: the shared moment is grounded, honest and scoped', () => {
    test('relax happens here: a mood, a calm posture, no session change', async () => {
        const s = await inApartment();
        expect(s.p.setMood('relax')).toMatchObject({ ok: true, why: 'in-place' });
        expect(s.behavior.request).toHaveBeenCalledWith('relax', { source: 'presence' });
        expect(s.session.enter).not.toHaveBeenCalled();
        expect(s.p.promptSuffix('experiences')).toMatch(/relaxing together right here/);
    });

    test('she is told plainly what she cannot do yet', async () => {
        const s = await inApartment();
        expect(s.p.promptSuffix('experiences')).toMatch(
            /cannot sit, lie down, pick things up, open doors or switch lights/
        );
    });

    test('Copilot hears where you are, but no bed and no trips', async () => {
        const s = await inApartment({ destination: 'copilot' });
        const prompt = s.p.promptSuffix('copilot');
        expect(prompt).not.toMatch(/by the bed/);
        expect(s.p.goOffer('copilot')).not.toMatch(/go place/);
        expect(s.p.goOffer('copilot')).not.toMatch(/\bbed\b/);
    });

    test('a private room gets nothing from this module, and her tags there do nothing', async () => {
        const s = setup({ activity: 'place-roadside-motel' });
        s.rt.activeId = 'roadside-motel';
        s.p.onWorldShown({ id: 'roadside-motel', title: 'Roadside motel', rating: 'private' });
        await flush();
        expect(s.p.promptSuffix('life')).toBe('');
        expect(s.p.goOffer('life')).toBe('');
        expect(s.p.consumeReply('Ok <go place="forest"/>')).toBe('Ok');
        expect(s.p.state().pending).toBeNull();
    });

    test('the offer passes PromptContext’s exact-shape check and reaches the prompt', async () => {
        const s = await inApartment();
        const offer = s.p.goOffer('experiences');
        expect(offer).toMatch(Prompt.GO_OFFER);
        const out = Prompt.suffix({
            customized: true,
            active: true,
            destination: 'experiences',
            activity: 'place-apartment',
            presence: s.p.promptSuffix('experiences'),
            goOffer: offer,
        });
        expect(out).toContain('<go spot="');
        expect(out).toContain('Where you are together: Apartment, by the sofa');
    });

    test('PromptContext refuses an offer that is not the generated shape', () => {
        const out = Prompt.suffix({
            customized: true,
            active: true,
            destination: 'experiences',
            goOffer: 'When they ask to move within this place, end your reply with one tag: <script>"/>.',
        });
        expect(out).not.toContain('<script>');
    });

    test('a streamed <go …/> is hidden while it is being written', () => {
        for (const m of [Presence.maskStreaming, Reactive.maskStreaming]) {
            expect(m('Andiamo! <go spot="kit')).toBe('Andiamo!');
            expect(m('Andiamo! <g')).toBe('Andiamo!');
            expect(m('Andiamo! <go')).toBe('Andiamo!');
        }
        expect(Reactive.maskStreaming('Ciao <gest')).toBe('Ciao');
    });

    test('parseGo strips every tag and keeps only the first call', () => {
        const r = Presence.parseGo('A <go spot="bed"/> B <go place="forest"/>');
        expect(r.clean).toBe('A B');
        expect(r.call).toEqual({ spot: 'bed' });
    });

    test('the module has no loop, storage or network of its own', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/companion/WorldPresence.js'), 'utf8');
        for (const banned of [
            'requestAnimationFrame',
            'localStorage',
            'fetch(',
            'XMLHttpRequest',
            'WebSocket',
            'setInterval',
        ])
            expect(src).not.toContain(banned);
    });
});
