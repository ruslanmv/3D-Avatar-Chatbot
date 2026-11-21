/**
 * WM3. Forge ranks her looks for the scene; she is shown a few numbered lines and chooses by
 * number. The closet is a stand-in whose `suggest` answers as Forge's
 * `POST /v1/wardrobes/{slug}/suggest` does (Forge's tests pin the ranking itself).
 */
const Actions = require('../../src/experiences/private/PrivateActionBridge.js');
const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
const Policy = require('../../src/experiences/private/PrivateActionPolicy.js');

const flush = async (n = 8) => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
};

const LOOKS = [
    { id: 'strip-red', name: 'Red Slip Dress', outfitId: 'show-strip-red', vrmUrl: 'a.vrm' },
    { id: 'lace-black', name: 'Black Lace Set', vrmUrl: 'b.vrm' },
];
const FORGE = {
    scene: 'strip-stage',
    level: 3,
    looks: [
        {
            ref: 1,
            id: 'strip-red',
            kind: 'outfit',
            line: 'striptease · red slip dress: red bra, red thong, red slip dress',
        },
        { ref: 2, id: 'lace-black', kind: 'outfit', line: 'lace lingerie set: black bralette, black briefs' },
    ],
    make: [
        {
            ref: 'A',
            outfitId: 'roleplay-nurse',
            line: 'nurse: white bodycon mini dress, white stockings',
            title: 'Nurse',
            prompt: 'white bodycon mini dress + sheer white thigh-high stockings',
        },
    ],
    prompt: 'LOOKS THAT FIT NOW (wear one by its number):\n1 outfit: striptease · red slip dress: red bra, red thong, red slip dress\n2 outfit: lace lingerie set: black bralette, black briefs\nNOT IN YOUR WARDROBE YET (wear by its letter; say you ordered it online and will try it on the moment it arrives, about a minute):\nA outfit: nurse: white bodycon mini dress, white stockings',
};

function closet() {
    const asked = [];
    return {
        asked,
        looks: LOOKS,
        recent: [],
        _loadedAt: Date.now(),
        privateOpen: true,
        canCreate: true,
        availability: () => ({ ok: true }),
        snapshot: () => ({ name: 'Base', canUndo: false }),
        names: () => LOOKS.map((l) => l.name),
        current: () => null,
        open: async () => ({ ok: true }),
        plan(params) {
            const choice = Engine.choose({ request: params, looks: LOOKS, entries: [], canCreate: true });
            return choice ? { ok: true, choice } : { ok: false, why: 'no-match' };
        },
        wearLook: jest.fn(async () => ({ ok: true })),
        create: jest.fn(async () => ({ ok: true })),
        suggest: jest.fn(async (body) => {
            asked.push(body);
            return FORGE;
        }),
    };
}

const session = () => ({
    _stopped: false,
    _care: false,
    adult: { level: 3, active: true },
    activity: { personaChoice: 'valentina' },
});

beforeEach(() => {
    localStorage.clear();
    Actions.end();
});

describe('WM3. her looks for the scene, from Forge', () => {
    test("the prompt carries Forge's few lines instead of a list of names, asked once per scene", async () => {
        const c = closet();
        Actions.begin(session(), { win: window, deps: { wardrobe: c } });
        Actions.promptLines(); // the first prompt asks Forge; its answer is for the next one
        await flush();
        const text = Actions.promptLines().join('\n');
        expect(text).toMatch(/LOOKS THAT FIT NOW/);
        expect(text).toMatch(/1 outfit: striptease · red slip dress/);
        expect(text).toMatch(/ordered it online/);
        expect(text).not.toMatch(/Your saved looks:/);
        expect(c.suggest).toHaveBeenCalledTimes(1); // same scene: not asked again
        expect(c.asked[0]).toMatchObject({ persona: 'valentina', level: 3, k: 5 });
        // Short enough for a small model.
        const block = text.split('\n').filter((l) => /^ {2}(\d|[AB]) outfit|LOOKS THAT|NOT IN YOUR/.test(l));
        expect(block.join('\n').length).toBeLessThan(700);
    });

    test('words about clothes ask again, with their words', async () => {
        const c = closet();
        Actions.begin(session(), { win: window, deps: { wardrobe: c } });
        Actions.promptLines();
        await flush();
        await Actions.onUserTurn('mettiti la lingerie rossa');
        await flush();
        expect(c.asked[c.asked.length - 1].text).toBe('mettiti la lingerie rossa');
    });

    test('a number is that look by id; a number not offered matches nothing', () => {
        const fit = { looks: FORGE.looks, make: FORGE.make };
        const choose = (look) => Engine.choose({ request: Object.assign({}, resolve(fit, look)), looks: LOOKS });
        expect(choose('2').look.id).toBe('lace-black');
        expect(choose('7')).toBeNull();
    });

    test("a letter is an outfit to make, offered with Forge's description", async () => {
        localStorage.setItem(Policy.AUTONOMY_KEY, 'suggest'); // she may offer, they decide
        const c = closet();
        Actions.begin(session(), { win: window, deps: { wardrobe: c } });
        Actions.promptLines();
        await flush();
        await Actions.fromModel('wardrobe.wear', { look: 'A' });
        await flush();
        const offer = Actions.snapshot().offer;
        expect(offer).toMatchObject({ kind: 'create', name: 'Nurse' });
        expect(c.create).not.toHaveBeenCalled(); // made only on their yes
    });
});

describe('WM3. a number from the model', () => {
    test('is offered as exactly that look, and a number not on the list offers nothing', async () => {
        localStorage.setItem(Policy.AUTONOMY_KEY, 'suggest');
        const c = closet();
        Actions.begin(session(), { win: window, deps: { wardrobe: c } });
        Actions.promptLines();
        await flush();
        await Actions.fromModel('wardrobe.wear', { look: '2' });
        await flush();
        expect(Actions.snapshot().offer).toMatchObject({ kind: 'wear', name: 'Black Lace Set' });
        Actions.declineOffer();
        await Actions.onUserTurn('ok');
        await Actions.fromModel('wardrobe.wear', { look: '7' });
        await flush();
        expect(Actions.snapshot().offer).toBeNull();
    });
});

/** The same mapping the bridge applies (fitParams), for the pure check above. */
function resolve(fit, ref) {
    if (/^\d$/.test(ref)) {
        const item = fit.looks.find((x) => String(x.ref) === ref);
        return { id: item ? item.id : '\u0000none' };
    }
    return { look: ref };
}

describe('FN1. a fantasy in their words dresses her', () => {
    const catalogue = require('../../assets/wardrobe/fantasies.json');

    test('"vestiti da infermiera" puts on her nurse look', async () => {
        const c = closet();
        const nurse = {
            id: 'nurse-look',
            name: 'White Bodycon Mini Dress',
            outfitId: 'roleplay-nurse',
            vrmUrl: 'n.vrm',
        };
        c.looks = LOOKS.concat([nurse]);
        c.plan = (params) => {
            const choice = Engine.choose({ request: params, looks: c.looks, entries: [], canCreate: true });
            return choice ? { ok: true, choice } : { ok: false, why: 'no-match' };
        };
        Actions.begin(session(), { win: window, deps: { wardrobe: c, fantasies: catalogue } });
        await Actions.onUserTurn('vestiti da infermiera');
        await flush();
        expect(c.wearLook).toHaveBeenCalledWith(expect.objectContaining({ id: 'nurse-look' }), expect.anything());
        expect(Actions.snapshot().last).toMatchObject({ name: 'wardrobe.wear', source: 'user', status: 'completed' });
    });

    test('at level 4 the naughty nurse is the one put on', async () => {
        const c = closet();
        const dressed = { id: 'nurse', name: 'White Bodycon Mini Dress', outfitId: 'roleplay-nurse', vrmUrl: 'n.vrm' };
        const naughty = {
            id: 'nurse-4',
            name: 'White Lace Plunge Bra + White G-String + White Garter Set',
            outfitId: 'roleplay-nurse-naughty',
            vrmUrl: 'n4.vrm',
        };
        c.looks = LOOKS.concat([dressed, naughty]);
        c.plan = (params) => {
            const choice = Engine.choose({ request: params, looks: c.looks, entries: [], canCreate: true });
            return choice ? { ok: true, choice } : { ok: false, why: 'no-match' };
        };
        const s = session();
        s.adult.level = 4;
        Actions.begin(s, { win: window, deps: { wardrobe: c, fantasies: catalogue } });
        await Actions.onUserTurn('vestiti da infermiera');
        await flush();
        expect(c.wearLook).toHaveBeenCalledWith(expect.objectContaining({ id: 'nurse-4' }), expect.anything());
    });

    test('talk about a nurse is not a request', async () => {
        const c = closet();
        Actions.begin(session(), { win: window, deps: { wardrobe: c, fantasies: catalogue } });
        await Actions.onUserTurn('mia sorella è infermiera');
        await flush();
        expect(c.wearLook).not.toHaveBeenCalled();
    });
});
