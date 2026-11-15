/**
 * UN3. Una Notte: a different evening every time, from places that exist, and a narrative state
 * that only the renderer can move to "arrived".
 */
const Weaver = require('../../src/features/together/StoryWeaver.js');
const Director = require('../../src/features/together/StoryDirector.js');
const Actions = require('../../src/experiences/private/PrivateActionBridge.js');
const Reset = require('../../src/features/chat/ConversationReset.js');

const PLACES = [
    {
        id: 'neon-discoteca',
        world: 'neon-discoteca',
        title: 'Neon discoteca',
        rating: 'general',
        category: 'Nightlife',
    },
    { id: 'neon-street', world: 'neon-street', title: 'Neon street', rating: 'general', category: 'Nightlife' },
    {
        id: 'private-cabaret',
        world: 'private-cabaret',
        title: 'Private cabaret',
        rating: 'private',
        category: 'Private',
    },
    { id: 'hotel-suite', world: 'hotel-suite', title: 'Hotel suite', rating: 'romantic', category: 'Romantic' },
    { id: 'apartment', world: 'apartment', title: 'Apartment', rating: 'romantic', category: 'Romantic' },
    { id: 'meadow-sunset', world: 'meadow-sunset', title: 'Meadow at sunset', rating: 'general', category: 'Nature' },
];

/** A seeded random source, so every run deals the same evenings. */
function seeded(seed) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) >>> 0;
        return x / 4294967296;
    };
}

beforeEach(() => {
    localStorage.clear();
    Actions.end();
});

describe('UN3. StoryWeaver', () => {
    test('opens and leads only where the catalogue can go, never the same place twice', () => {
        for (let i = 0; i < 30; i += 1) {
            const o = Weaver.weave({ places: PLACES, rng: seeded(i + 1) });
            const ids = PLACES.map((p) => p.id);
            expect(ids).toContain(o.openingVenue);
            expect(ids).toContain(o.destination);
            expect(o.destination).not.toBe(o.openingVenue);
            expect(Weaver.isOpening(PLACES.find((p) => p.id === o.openingVenue))).toBe(true);
            expect(Weaver.isDestination(PLACES.find((p) => p.id === o.destination))).toBe(true);
            expect(Object.keys(Weaver.HOOKS)).toContain(o.narrativeHook);
            expect(Object.keys(Weaver.MOODS)).toContain(o.characterMood);
        }
    });

    test('the room she is already in is the opening, whatever the deal', () => {
        const o = Weaver.weave({ places: PLACES, current: 'apartment', rng: seeded(7) });
        expect(o.openingVenue).toBe('apartment');
        expect(o.destination).not.toBe('apartment');
    });

    test('ten evenings in a row: ten different outlines, and what moves them differs too', () => {
        const rng = seeded(42);
        const seen = [];
        for (let i = 0; i < 10; i += 1) {
            const o = Weaver.weave({ places: PLACES, history: Weaver.history(), rng });
            Weaver.remember(o.fingerprint);
            seen.push(o);
        }
        const prints = new Set(seen.map((o) => JSON.stringify(o.fingerprint)));
        expect(prints.size).toBe(10);
        expect(new Set(seen.map((o) => o.narrativeHook)).size).toBeGreaterThanOrEqual(5);
        expect(new Set(seen.map((o) => o.storyArc)).size).toBeGreaterThanOrEqual(4);
        // Back to back, two evenings never share both their hook and their arc.
        for (let i = 1; i < seen.length; i += 1)
            expect(
                seen[i].narrativeHook === seen[i - 1].narrativeHook && seen[i].storyArc === seen[i - 1].storyArc
            ).toBe(false);
        expect(Weaver.history()).toHaveLength(10);
    });

    test('with every combination worn out it still deals, the least similar one', () => {
        const tiny = PLACES.filter((p) => ['neon-discoteca', 'hotel-suite'].includes(p.id));
        const history = Array.from({ length: 10 }, () => Weaver.weave({ places: tiny, rng: seeded(3) }).fingerprint);
        const o = Weaver.weave({ places: tiny, history, rng: seeded(99) });
        expect(o.openingVenue).toBe('neon-discoteca');
        expect(o.destination).toBe('hotel-suite');
        expect(o.similarity).toBeLessThan(8);
    });

    test('no places at all is a quiet evening "here", not a crash', () => {
        const o = Weaver.weave({ places: [], rng: seeded(5) });
        expect(o.openingVenue).toBe('here');
        expect(o.destination).toBeNull();
    });

    test('the memory holds catalogue ids only, at most ten, and forgets on request', () => {
        localStorage.setItem(
            Weaver.KEY,
            JSON.stringify([
                {
                    narrativeHook: 'last-song',
                    characterMood: 'shy',
                    storyArc: 'reunion',
                    outfitTheme: 'red-night',
                    openingVenue: 'neon-discoteca',
                    destination: 'apartment',
                },
                {
                    narrativeHook: '<script>',
                    characterMood: 'shy',
                    storyArc: 'reunion',
                    outfitTheme: 'red-night',
                    openingVenue: 'x',
                    destination: 'y',
                },
                {
                    narrativeHook: 'last-song',
                    characterMood: 'shy',
                    storyArc: 'reunion',
                    outfitTheme: 'red-night',
                    openingVenue: 'She said: hello',
                    destination: 'apartment',
                },
                'junk',
            ])
        );
        expect(Weaver.history()).toHaveLength(1);
        for (let i = 0; i < 14; i += 1) Weaver.remember(Weaver.weave({ places: PLACES, rng: seeded(i) }).fingerprint);
        expect(Weaver.history()).toHaveLength(10);
        const stored = JSON.parse(localStorage.getItem(Weaver.KEY));
        stored.forEach((f) =>
            expect(Object.keys(f).sort()).toEqual([
                'characterMood',
                'destination',
                'narrativeHook',
                'openingVenue',
                'outfitTheme',
                'storyArc',
            ])
        );
        expect(Weaver.forget()).toBe(true);
        expect(Weaver.history()).toEqual([]);
    });

    test('storage that refuses means an evening without memory, never an error', () => {
        const broken = {
            localStorage: {
                getItem: () => {
                    throw new Error('denied');
                },
                setItem: () => {
                    throw new Error('denied');
                },
                removeItem: () => {
                    throw new Error('denied');
                },
            },
        };
        expect(Weaver.history(broken)).toEqual([]);
        expect(Weaver.remember({ narrativeHook: 'last-song' }, broken)).toBe(false);
        expect(Weaver.forget(broken)).toBe(false);
    });

    test('Clear keeps the evenings memory; it has its own forget', () => {
        expect(Reset.KEPT).toContain(Weaver.KEY);
        expect(Reset.KEYS || []).not.toContain(Weaver.KEY);
    });
});

describe('UN3. StoryDirector', () => {
    const outline = () => Weaver.weave({ places: PLACES, current: 'neon-discoteca', rng: seeded(11) });

    test('only the renderer’s confirmation of the trip in progress is an arrival', () => {
        const d = Director.create(outline(), { places: PLACES, current: 'neon-discoteca' });
        expect(d.phase).toBe('opening');
        expect(d.arrived('hotel-suite')).toBe(false); // nothing is travelling
        d.propose('hotel-suite');
        expect(d.phase).toBe('travel-proposed');
        expect(d.arrived('hotel-suite')).toBe(false); // proposed is not agreed
        d.travelling('hotel-suite');
        expect(d.arrived('apartment')).toBe(false); // another world is not this trip
        expect(d.arrived('hotel-suite')).toBe(true);
        expect(d.snapshot()).toMatchObject({ phase: 'arrived', shown: 'hotel-suite', arrivedAt: 'hotel-suite' });
    });

    test('a declined or failed trip leaves the evening where it was', () => {
        const d = Director.create(outline(), { places: PLACES, current: 'neon-discoteca' });
        d.propose('hotel-suite');
        d.decline();
        expect(d.snapshot()).toMatchObject({ phase: 'opening', proposed: null, shown: 'neon-discoteca' });
        d.travelling('hotel-suite');
        d.failed('timeout');
        expect(d.snapshot()).toMatchObject({ phase: 'opening', shown: 'neon-discoteca', failed: 'timeout' });
        expect(d.lines({ canTravel: true }).join('\n')).toMatch(/did not happen; you are still where you were/);
    });

    test('her lines: where she really is, tonight’s motive, an invitation only when a trip can run', () => {
        const o = outline();
        const d = Director.create(o, { places: PLACES, current: 'neon-discoteca', weaver: Weaver });
        const closed = d.lines({ canTravel: false }).join('\n');
        expect(closed).toMatch(/Where you really are: Neon discoteca/);
        expect(closed).toContain(Weaver.HOOKS[o.narrativeHook]);
        expect(closed).not.toMatch(/<go /);
        const open = d.lines({ canTravel: true }).join('\n');
        expect(open).toContain(`<go place="${o.destination}"/>`);
        expect(open).toMatch(/never announce it, never number it/);
        expect(open).toMatch(/Staying is always right/);
        expect(open).not.toMatch(/\b(act|stage) [0-9]/i);
        d.end();
        expect(d.lines({ canTravel: true })).toEqual([]);
    });
});

describe('UN3. the bridge deals one story per Private session and follows the renderer', () => {
    const session = () => ({ _stopped: false, _care: false, adult: { level: 1, active: true } });

    test('each session gets its own outline, remembered once, ended with the session', () => {
        const s1 = session();
        Actions.begin(s1, {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(1) } },
        });
        const first = Actions.snapshot().story;
        expect(first).toMatchObject({ phase: 'opening', shown: 'neon-discoteca' });
        expect(Actions.promptLines().join('\n')).toMatch(/TONIGHT — your own outline/);
        Actions.end(s1);
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(2) } },
        });
        const second = Actions.snapshot().story;
        expect(second.storyId).not.toBe(first.storyId);
        expect(Weaver.history()).toHaveLength(2);
    });

    test('a world the renderer announces is where she is; nothing else moves her', () => {
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(3) } },
        });
        window.dispatchEvent(
            new window.CustomEvent('nexus-world-shown', { detail: { id: 'apartment', base: 'apartment' } })
        );
        expect(Actions.snapshot().story.shown).toBe('apartment');
        expect(Actions.snapshot().story.phase).toBe('opening');
    });
});

describe('UN4. a real two-place evening: asked, agreed, and arrived only on the renderer’s word', () => {
    const session = () => ({ _stopped: false, _care: false, adult: { level: 1, active: true } });
    let requests;
    const onRequest = (e) => requests.push(e.detail);
    const prompt = () => Actions.promptLines().join('\n');
    const shown = (id) =>
        window.dispatchEvent(new window.CustomEvent('nexus-world-shown', { detail: { id, base: id } }));

    function evening(seed) {
        const s = session();
        Actions.begin(s, {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(seed || 21), canTravel: true } },
        });
        return { s, outline: Actions.snapshot().story };
    }

    beforeEach(() => {
        requests = [];
        window.addEventListener('nexus-world-request', onRequest);
    });
    afterEach(() => {
        window.removeEventListener('nexus-world-request', onRequest);
        jest.useRealTimers();
        Actions.end();
    });

    const destination = () => {
        const id = Actions.snapshot().story && Actions.snapshot().story.storyId;
        return id ? PLACES.find((p) => prompt().includes(`<go place="${p.id}"/>`)) : null;
    };

    test('"Possiamo andare altrove?" is a question to them about tonight’s place; "no" changes nothing', async () => {
        evening();
        const dest = destination();
        await Actions.onUserTurn('Possiamo andare altrove?');
        expect(Actions.snapshot().offer).toEqual({ kind: 'travel', name: dest.title });
        expect(Actions.snapshot().story.phase).toBe('travel-proposed');
        expect(prompt()).toMatch(/the app is asking them/);
        await Actions.onUserTurn('No, restiamo qui');
        expect(Actions.snapshot().offer).toBeNull();
        expect(Actions.snapshot().story).toMatchObject({ phase: 'opening', shown: 'neon-discoteca' });
        expect(requests).toEqual([]);
    });

    test('"Volentieri" takes the trip; "arrived" waits for the renderer, and only for that room', async () => {
        evening();
        const dest = destination();
        await Actions.onUserTurn("Andiamo da un'altra parte");
        await Actions.onUserTurn('Volentieri');
        expect(requests).toEqual([{ id: dest.id, owner: 'intimate' }]);
        expect(Actions.snapshot().story.phase).toBe('travelling');
        expect(prompt()).toMatch(/on your way to .*do not describe arriving yet/s);
        shown('meadow-sunset'); // another world is not this trip
        expect(Actions.snapshot().story.phase).toBe('travelling');
        shown(dest.id);
        expect(Actions.snapshot().story).toMatchObject({ phase: 'arrived', shown: dest.id });
        expect(prompt()).toMatch(/You have just arrived at .* as they agreed/);
        const again = prompt();
        expect(again).not.toMatch(/You have just arrived/); // the news is told once
        expect(again).toMatch(/You came here together tonight/);
    });

    test('her <go place/> is only an invitation: stripped from her words, asked, never travelled alone', async () => {
        evening();
        const clean = Actions.consumeTravel('Conosco un posto più tranquillo. <go place="apartment"/>');
        await Promise.resolve();
        expect(clean).toBe('Conosco un posto più tranquillo.');
        expect(Actions.snapshot().offer).toEqual({ kind: 'travel', name: 'Apartment' });
        expect(requests).toEqual([]);
        await Actions.onUserTurn('Sì, andiamo');
        expect(requests).toEqual([{ id: 'apartment', owner: 'intimate' }]);
    });

    test('a trip that does not land goes back to the room she was in, and says so once', async () => {
        jest.useFakeTimers();
        evening();
        await Actions.onUserTurn('andiamo in hotel');
        expect(requests).toEqual([{ id: 'hotel-suite', owner: 'intimate' }]);
        jest.advanceTimersByTime(Actions.TRAVEL_MS + 10);
        expect(requests[1]).toEqual({ id: 'neon-discoteca', owner: 'intimate' });
        expect(Actions.snapshot().story).toMatchObject({
            phase: 'opening',
            shown: 'neon-discoteca',
            failed: 'timeout',
        });
        expect(prompt()).toMatch(/did not happen; you are still where you were/);
    });

    test('a place this device cannot show is never requested, and she says so', async () => {
        evening();
        await Actions.onUserTurn('andiamo al motel');
        expect(requests).toEqual([]);
        expect(Actions.snapshot().last).toMatchObject({ name: 'world.travel', status: 'failed', why: 'not-a-place' });
        expect(prompt()).toMatch(/cannot take them from here tonight/);
        expect(Actions.snapshot().story.shown).toBe('neon-discoteca');
    });

    test('care mode blocks a trip, and ending the evening mid-trip leaves nothing behind', async () => {
        const { s } = evening();
        s._care = true;
        await Actions.onUserTurn('andiamo in hotel');
        expect(requests).toEqual([]);
        s._care = false;
        await Actions.onUserTurn('andiamo in hotel');
        expect(requests).toHaveLength(1);
        Actions.end(s);
        shown('hotel-suite');
        expect(Actions.snapshot().story).toBeUndefined();
        expect(Actions.active()).toBe(false);
    });

    test('nothing moves on its own: ten quiet turns in the opening stay in the opening', async () => {
        evening();
        for (const t of ['Ciao', 'Che bella musica', 'Mi piace qui', 'Raccontami di te', 'Sei bellissima'])
            await Actions.onUserTurn(t);
        expect(requests).toEqual([]);
        expect(Actions.snapshot().story).toMatchObject({ phase: 'opening', shown: 'neon-discoteca' });
    });
});

describe('UN6. a yes to going is a yes, and "let\'s stay" is not', () => {
    const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
    // Found in the real browser: "Let's stay here a little longer" took her to the bedroom.
    test.each([
        "Let's stay here a little longer",
        'No, non andiamo',
        'Aspetta, andiamo dopo',
        "Not yet, let's wait",
        'Restiamo qui',
        "Why not, let's stay",
        'No',
    ])('%s → not a yes', (said) => expect(Intent.affirmsGoing(said)).toBe(false));
    test.each([
        'Sì, andiamo',
        "Yes, let's go",
        'Andiamo!',
        'Vamos',
        'Volentieri',
        "let's do it",
        'Why not!',
        'Perché no?',
        'Allons-y',
    ])('%s → yes', (said) => expect(Intent.affirmsGoing(said)).toBe(true));
});

describe('UN9. the person closes the evening, or asks her to forget past evenings', () => {
    const Intent = require('../../src/experiences/private/PrivateActionIntent.js');
    const session = () => ({ _stopped: false, _care: false, adult: { level: 1, active: true } });
    let requests;
    const onRequest = (e) => requests.push(e.detail);
    const prompt = () => Actions.promptLines().join('\n');
    const shown = (id) =>
        window.dispatchEvent(new window.CustomEvent('nexus-world-shown', { detail: { id, base: id } }));
    const evening = () =>
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(21), canTravel: true } },
        });

    beforeEach(() => {
        requests = [];
        window.addEventListener('nexus-world-request', onRequest);
    });
    afterEach(() => {
        window.removeEventListener('nexus-world-request', onRequest);
        Actions.end();
    });

    test.each([
        ['Si è fatto tardi', 'epilogue'],
        ["It's getting late", 'epilogue'],
        ['Ultimo ballo?', 'epilogue'],
        ['Se hace tarde', 'epilogue'],
        ['Il se fait tard', 'epilogue'],
        ['Dimentica le nostre serate', 'forget'],
        ['Forget our evenings', 'forget'],
        ['Non è tardi', null],
        ['Ciao, che bella musica', null],
        ['Ricordi le nostre serate?', null],
    ])('%s → %s', (said, cue) => expect(Intent.storyCue(said)).toBe(cue));

    test('"it\'s getting late" closes gently: no new invitation, her <go/> refused, nothing ends', async () => {
        evening();
        expect(prompt()).toMatch(/you may invite them to/);
        await Actions.onUserTurn('Si è fatto tardi');
        expect(Actions.snapshot().story.phase).toBe('epilogue');
        expect(Actions.active()).toBe(true);
        expect(prompt()).toMatch(/drawing to a close.*Propose nothing new.*do not end it yourself/s);
        expect(prompt()).not.toMatch(/you may invite them to/);
        const clean = Actions.consumeTravel('Un ultimo posto? <go place="apartment"/>');
        await Promise.resolve();
        expect(clean).toBe('Un ultimo posto?');
        expect(Actions.snapshot().offer).toBeNull();
        expect(requests).toEqual([]);
    });

    test('they can still ask to go in the epilogue; the trip lands and the evening stays closing', async () => {
        evening();
        await Actions.onUserTurn("It's getting late");
        await Actions.onUserTurn('andiamo in hotel');
        expect(requests).toEqual([{ id: 'hotel-suite', owner: 'intimate' }]);
        shown('hotel-suite');
        expect(Actions.snapshot().story).toMatchObject({ shown: 'hotel-suite', phase: 'epilogue' });
    });

    test('"forget our evenings" erases the between-evenings history and says so once', async () => {
        evening();
        expect(Weaver.history(window).length).toBeGreaterThan(0);
        await Actions.onUserTurn('Dimentica le nostre serate');
        expect(Weaver.history(window)).toEqual([]);
        expect(prompt()).toMatch(/forget your past evenings together, and it is done/);
        await Actions.onUserTurn('Grazie');
        expect(prompt()).not.toMatch(/forget your past evenings/);
        expect(Actions.snapshot().story.phase).toBe('opening'); // tonight goes on
    });
});

describe('UN12. an outline dealt before the opening room is shown never leads to that room', () => {
    afterEach(() => Actions.end());
    test('the renderer shows the destination as the opening: the evening is dealt again from there', () => {
        // No current room at deal time, as when the setup screen's world is still loading.
        Actions.begin(
            { _stopped: false, _care: false, adult: { level: 1, active: true } },
            { win: window, deps: { story: { places: PLACES, current: null, rng: seeded(5), canTravel: true } } }
        );
        const first = Actions.snapshot().story;
        const dest = Actions.promptLines()
            .join('\n')
            .match(/<go place="([a-z0-9-]+)"\/>/)[1];
        window.dispatchEvent(new window.CustomEvent('nexus-world-shown', { detail: { id: dest, base: dest } }));
        const after = Actions.snapshot().story;
        expect(after.shown).toBe(dest);
        expect(after.storyId).not.toBe(first.storyId);
        const next = Actions.promptLines()
            .join('\n')
            .match(/<go place="([a-z0-9-]+)"\/>/);
        if (next) expect(next[1]).not.toBe(dest);
    });
});

describe('UN13. one evening is one history entry, and a late opening never replaces it', () => {
    const session = () => ({ _stopped: false, _care: false, adult: { level: 1, active: true } });
    const shown = (id) =>
        window.dispatchEvent(new window.CustomEvent('nexus-world-shown', { detail: { id, base: id } }));
    const goTo = () =>
        (Actions.promptLines()
            .join('\n')
            .match(/<go place="([a-z0-9-]+)"\/>/) || [])[1];
    // No room known when the outline is dealt: the setup screen's world is still loading.
    const unsure = (seed) =>
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: null, rng: seeded(seed || 5), canTravel: true } },
        });
    afterEach(() => {
        Actions.end();
        delete window.NEXUS_VR_WORLDS;
    });

    test('an outline dealt without a room is provisional and not yet in the history', () => {
        unsure();
        expect(Actions.snapshot().story).toMatchObject({ provisional: true, committed: false });
        expect(Weaver.history(window)).toHaveLength(0);
    });

    test('a UN12 re-deal keeps one fingerprint for the evening, not two', () => {
        unsure();
        const first = Actions.snapshot().story.storyId;
        shown(goTo()); // the room it was going to lead to turns out to be the opening
        expect(Actions.snapshot().story.storyId).not.toBe(first);
        expect(Actions.snapshot().story).toMatchObject({ provisional: false, committed: true });
        expect(Weaver.history(window)).toHaveLength(1);
        Actions.end();
        expect(Weaver.history(window)).toHaveLength(1);
    });

    test('a provisional outline is dealt again from the opening the renderer reports', () => {
        unsure();
        const before = Actions.snapshot().story;
        const opening = PLACES.find((p) => p.id !== before.shown && p.category === 'Nightlife' && p.id !== goTo());
        shown(opening.id);
        expect(Actions.snapshot().story).toMatchObject({ shown: opening.id, committed: true });
        expect(Weaver.history(window)).toHaveLength(1);
        expect(goTo()).not.toBe(opening.id);
    });

    test('the same announcement twice changes nothing the second time', () => {
        unsure();
        shown('neon-discoteca');
        const after = Actions.snapshot().story;
        shown('neon-discoteca');
        expect(Actions.snapshot().story.storyId).toBe(after.storyId);
        expect(Weaver.history(window)).toHaveLength(1);
    });

    test('after the person has spoken, a late opening says where she is and keeps their evening', async () => {
        unsure();
        await Actions.onUserTurn('Ciao, che bel posto');
        const evening = Actions.snapshot().story;
        expect(evening.committed).toBe(true); // their first turn made it theirs
        shown(goTo()); // late: even the destination, which UN12 alone would have re-dealt
        expect(Actions.snapshot().story.storyId).toBe(evening.storyId);
        expect(Weaver.history(window)).toHaveLength(1);
    });

    test('an evening that ends before its opening is confirmed is still kept once; later events do nothing', () => {
        unsure();
        Actions.end();
        expect(Weaver.history(window)).toHaveLength(1);
        shown('neon-discoteca');
        expect(Actions.snapshot().story).toBeUndefined();
        expect(Weaver.history(window)).toHaveLength(1);
    });

    test('a catalogue that resolves after its session ended cannot deal into the next one', async () => {
        let release;
        window.NEXUS_VR_WORLDS = {
            loadCatalogue: () => new Promise((resolve) => (release = () => resolve({ worlds: [] }))),
            placesFor: () => PLACES,
            tierFor: () => 'desktop',
        };
        Actions.begin(session(), { win: window, deps: { story: {} } }); // dealt from the slow catalogue
        Actions.end();
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(9), canTravel: true } },
        });
        const second = Actions.snapshot().story.storyId;
        release();
        await new Promise((r) => setTimeout(r, 0));
        expect(Actions.snapshot().story.storyId).toBe(second);
        expect(Weaver.history(window)).toHaveLength(1);
    });

    test('a known opening is committed at once, and forgetting is not undone by the end', async () => {
        Actions.begin(session(), {
            win: window,
            deps: { story: { places: PLACES, current: 'neon-discoteca', rng: seeded(3), canTravel: true } },
        });
        expect(Actions.snapshot().story).toMatchObject({ provisional: false, committed: true });
        await Actions.onUserTurn('Dimentica le nostre serate');
        expect(Weaver.history(window)).toEqual([]);
        Actions.end();
        expect(Weaver.history(window)).toEqual([]);
    });
});
