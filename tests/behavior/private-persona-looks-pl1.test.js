/**
 * PL1. Her persona dressed for the evening's step: Gina at the window is in a short dress at
 * level 1, fishnets at 2, lingerie at 3 — not the avatar's own cardigan (owner, 2026-11-21).
 */
const Actions = require('../../src/experiences/private/PrivateActionBridge.js');
const Personas = require('../../src/experiences/private/PrivatePersonas.js');

const flush = async (n = 8) => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
};

const look = (outfitId) => ({ id: `look-${outfitId}`, name: outfitId, outfitId, vrmUrl: `${outfitId}.vrm` });

function closet(ids) {
    return {
        looks: ids.map(look),
        entries: [
            {
                id: 'red-bodycon',
                title: 'Red bodycon mini',
                request: { prompt: 'red bodycon mini dress' },
                private: false,
            },
        ],
        recent: [],
        privateOpen: true,
        canCreate: true,
        _loadedAt: Date.now(),
        availability: () => ({ ok: true }),
        snapshot: () => ({ name: 'Base', canUndo: false }),
        names: () => [],
        current: () => null,
        open: async () => ({ ok: true }),
        plan: () => ({ ok: false, why: 'no-match' }),
        wearLook: jest.fn(async () => ({ ok: true })),
    };
}

const session = (level, persona = 'gina') => ({
    _stopped: false,
    _care: false,
    adult: { level, active: true },
    activity: { personaChoice: persona },
});

beforeEach(() => {
    localStorage.clear();
    Actions.end();
});

describe('PL1. her persona dressed for the evening', () => {
    test('every persona has a plan for levels 1–3 and nothing beyond', () => {
        for (const p of Object.values(Personas.PERSONAS)) {
            expect(Object.keys(p.looks).map(Number)).toEqual([1, 2, 3]);
            for (const ids of Object.values(p.looks)) expect(ids.length).toBeGreaterThan(0);
        }
    });

    test('Gina starts in her dress and warms into fishnets, then lingerie', async () => {
        const c = closet(['red-bodycon', 'fishnets-mini', 'guepiere']);
        const s = session(1);
        Actions.begin(s, { win: window, deps: { wardrobe: c } });
        await flush();
        expect(c.wearLook.mock.calls.map((x) => x[0].outfitId)).toEqual(['red-bodycon']);
        s.adult.level = 2;
        Actions.fitPoseToPace();
        await flush();
        s.adult.level = 3;
        Actions.fitPoseToPace();
        await flush();
        expect(c.wearLook.mock.calls.map((x) => x[0].outfitId)).toEqual(['red-bodycon', 'fishnets-mini', 'guepiere']);
        // Easing down never re-dresses her; 4 is undressing, not a new costume.
        s.adult.level = 2;
        Actions.fitPoseToPace();
        s.adult.level = 4;
        Actions.fitPoseToPace();
        await flush();
        expect(c.wearLook).toHaveBeenCalledTimes(3);
    });

    test('what she does not have is offered to be made, never made without a yes', async () => {
        const c = closet([]);
        Actions.begin(session(1), { win: window, deps: { wardrobe: c } });
        await flush();
        expect(c.wearLook).not.toHaveBeenCalled();
        expect(Actions.snapshot().offer).toMatchObject({ kind: 'create', name: 'Red bodycon mini' });
    });

    test('once the person chose her clothes, the plan steps aside', async () => {
        const c = closet(['red-bodycon', 'fishnets-mini']);
        const s = session(1);
        Actions.begin(s, { win: window, deps: { wardrobe: c } });
        await flush();
        await Actions.request('wardrobe.wear', { look: 'something' }, { source: 'user' });
        s.adult.level = 2;
        Actions.fitPoseToPace();
        await flush();
        expect(c.wearLook.mock.calls.map((x) => x[0].outfitId)).toEqual(['red-bodycon']);
    });

    test('no persona, no plan', async () => {
        const c = closet(['red-bodycon']);
        Actions.begin(session(1, null), { win: window, deps: { wardrobe: c } });
        await flush();
        expect(c.wearLook).not.toHaveBeenCalled();
    });
});
