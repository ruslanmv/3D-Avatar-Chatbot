/**
 * W7. Try-On as a Together activity: it speaks the contract, it opens where the panel
 * was, it shows her looks only, and every way out restores her exactly once.
 */
const Contract = require('../../src/features/together/activities/contract.js');
const TryOn = require('../../src/wardrobe/TryOnHaulActivity.js');
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Identity = require('../../src/wardrobe/AvatarIdentity.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');
const Intent = require('../../src/wardrobe/TryOnIntent.js');
const Reactions = require('../../src/wardrobe/TryOnReactions.js');

const BASE = { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A', index: 0 };
const LOOK = (id, name) => ({ id, name, vrmUrl: `https://f/${id}.vrm` });

function fakeService({
    owner = 'avatar-sample-a',
    looks = [LOOK('burgundy', 'Burgundy'), LOOK('summer', 'Summer')],
} = {}) {
    let current = BASE;
    const controller = {
        original: { ...BASE },
        avatarManager: { getCurrent: () => current },
        snapshot: jest.fn(),
        applyLook: jest.fn(async (look) => {
            current = { url: look.vrmUrl, name: look.name };
            return look;
        }),
        restore: jest.fn(async () => {
            current = BASE;
            return true;
        }),
    };
    return {
        controller,
        remoteEnabled: false,
        staticSource: {
            load: async () => ({ avatarId: owner }),
            listLooks: async () => looks,
        },
    };
}

function mountHost() {
    document.body.innerHTML = '<div class="avatar-card"><div id="nexus-bd-together-panel" hidden></div></div>';
    return document.querySelector('.avatar-card');
}

function activityWith(service, panel) {
    return TryOn.create({
        wardrobe: { service, config: {} },
        panel,
        doc: document,
        Session: TryOnSession,
        View: TryOnView,
        Identity,
        Reasons,
        Intent,
        Reactions,
    });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The sheet folds to the remote as a look arrives (LT2); More opens it again. */
const more = () => {
    const button = document.querySelector('[data-key="collapse"]');
    if (button && button.getAttribute('aria-expanded') === 'false') button.click();
};

describe('try-on-haul activity', () => {
    beforeEach(() => mountHost());

    test('speaks the contract natively, so the adapter passes it through untouched', () => {
        const activity = activityWith(fakeService());
        expect(Contract.adapt(activity)).toBe(activity);
        expect(activity.ui).toEqual({ title: 'Try-On', icon: '👗', order: 45 });
        // One input that asks nothing: the panel starts it straight from the tile.
        const inputs = activity.inputs();
        expect(inputs).toHaveLength(1);
        expect(inputs[0].permission).toBeNull();
    });

    test('without the wardrobe service it says why instead of starting', async () => {
        const activity = activityWith(null);
        expect(activity.availability()).toMatchObject({ ok: false, why: expect.stringMatching(/getting ready/) });
        expect(await activity.start({})).toMatchObject({ ok: false });
        expect(document.getElementById('nexus-try-on-view')).toBeNull();
    });

    test('start opens the view where the Together panel lives, and lists her looks', async () => {
        const activity = activityWith(fakeService());
        expect(await activity.start({})).toEqual({ ok: true, why: '' });
        const view = document.getElementById('nexus-try-on-view');
        expect(view.parentNode.className).toBe('avatar-card');
        expect(view.getAttribute('role')).toBe('dialog');
        await flush();
        expect(
            [...view.querySelectorAll('.nexus-try-on-card:not(.is-new) .nexus-try-on-name')].map((n) => n.textContent)
        ).toEqual(['Burgundy', 'Summer']);
    });

    test('a bundled wardrobe that belongs to another avatar is not offered', async () => {
        const activity = activityWith(fakeService({ owner: 'masc-vroid' }));
        await activity.start({});
        await flush();
        expect(document.querySelectorAll('.nexus-try-on-card:not(.is-new)')).toHaveLength(0);
        expect(document.querySelector('.nexus-try-on-empty').textContent).toMatch(/No looks for her yet/);
    });

    test('LT2: tap a look and she wears it; the launcher line follows', async () => {
        const service = fakeService();
        const activity = activityWith(service);
        await activity.start({});
        await flush();
        expect(activity.status()).toEqual({ label: 'Try-On', detail: 'Browsing looks' });
        document.querySelector('[data-key="look:burgundy"]').click();
        await flush();
        expect(activity.status().detail).toBe('Look 1 of 2 · Burgundy');
        document.querySelector('[data-key="next"]').click(); // the folded remote steps too
        await flush();
        expect(activity.status().detail).toBe('Look 2 of 2 · Summer');
        expect(service.controller.applyLook).toHaveBeenCalledTimes(2);
    });

    test('LT2: Turn spins the loaded model round and puts the exact yaw back at the end', async () => {
        const service = fakeService();
        const root = { rotation: { y: Math.PI } }; // a VRM 0.x file is turned at load
        service.controller.avatarManager.currentRoot = root;
        // Reduced motion: the turn is a cut, not an animation, so it can be read at once.
        const matchMedia = window.matchMedia;
        window.matchMedia = () => ({ matches: true });
        const activity = activityWith(service);
        await activity.start({});
        await flush();
        document.querySelector('[data-key="look:burgundy"]').click();
        await flush();
        document.querySelector('[data-key="turn"]').click();
        expect(root.rotation.y).toBeCloseTo(2 * Math.PI);
        activity.stop('user');
        await flush();
        expect(root.rotation.y).toBe(Math.PI);
        window.matchMedia = matchMedia;
    });

    test('LT2: a new file is not turned back by a stale snapshot', () => {
        const manager = { currentRoot: { rotation: { y: 0 } } };
        const turner = TryOn.makeTurner(manager, {});
        expect(turner.toggle()).toBe(true);
        manager.currentRoot = { rotation: { y: 0.5 } }; // a look loaded: a new root
        turner.reset();
        expect(manager.currentRoot.rotation.y).toBe(0.5);
        expect(turner.toggle()).toBe(true); // the new root turns from its own yaw
        expect(manager.currentRoot.rotation.y).toBeCloseTo(0.5 + Math.PI);
    });

    test('the panel’s Stop and the view’s End both restore her, once between them', async () => {
        const service = fakeService();
        const panel = {
            active: 'try-on-haul',
            stopActivity: jest.fn(function (why) {
                activity.stop(why);
            }),
        };
        const activity = activityWith(service, panel);
        await activity.start({});
        await flush();
        document.querySelector('.nexus-try-on-card').click();
        await flush();
        more();
        document.querySelector('[data-key="end"]').click();
        activity.stop('user');
        await flush();
        expect(service.controller.restore).toHaveBeenCalledTimes(1);
        expect(panel.stopActivity).toHaveBeenCalledWith('ended');
        expect(document.getElementById('nexus-try-on-view')).toBeNull();
    });

    test('Keep closes Try-On and leaves her in the look', async () => {
        const service = fakeService();
        const activity = activityWith(service);
        await activity.start({});
        await flush();
        document.querySelector('.nexus-try-on-card').click();
        await flush();
        more();
        document.querySelector('[data-key="keep"]').click();
        await flush();
        expect(service.controller.restore).not.toHaveBeenCalled();
        expect(document.getElementById('nexus-try-on-view')).toBeNull();
    });

    test('ownedBy: an unnamed or default bundle belongs to anyone, a named one to its owner', () => {
        const identity = { kind: 'library', slug: 'fem-vroid', name: 'VRoid Female', file: 'fem_vroid.vrm' };
        expect(TryOn.ownedBy(undefined, identity)).toBe(true);
        expect(TryOn.ownedBy('default', identity)).toBe(true);
        expect(TryOn.ownedBy('fem-vroid', identity)).toBe(true);
        expect(TryOn.ownedBy('avatar-sample-a', identity)).toBe(false);
    });
});

describe('W16–W17: the companion’s wardrobe tool and the hosted haul', () => {
    const { OutfitDictionary } = require('../../src/wardrobe/OutfitDictionary.js');
    const SNAPSHOT = require('../../assets/wardrobe/outfits.json');

    async function setup({ host = null } = {}) {
        mountHost();
        const service = fakeService();
        const dictionary = new OutfitDictionary({ fetch: async () => ({ ok: true, json: async () => SNAPSHOT }) });
        await dictionary.load();
        const created = [];
        class Generator {
            constructor() {
                this.library = { available: true, library: async () => [] };
            }
            availability() {
                return { ok: true };
            }
            identity() {
                return { kind: 'library', slug: 'avatar-sample-a', name: 'AvatarSample A' };
            }
            async create(prompt, options) {
                created.push({ prompt, options });
                return { id: 'made-' + created.length, name: 'Made ' + created.length, vrmUrl: 'https://f/made.vrm' };
            }
        }
        const activity = TryOn.create({
            wardrobe: { service, config: {} },
            doc: document,
            Session: TryOnSession,
            View: TryOnView,
            Generator,
            Identity,
            Reasons,
            Intent: require('../../src/wardrobe/TryOnIntent.js'),
            Reactions: require('../../src/wardrobe/TryOnReactions.js'),
            dictionary,
            host,
            noWarm: true,
        });
        return { activity, service, created };
    }

    test('a tool call opens Try-On and wears a dictionary set by making it — with its request', async () => {
        const { activity, service, created } = await setup();
        const result = await activity.request('wear', { outfit: 'stockings-mini-dress' });
        // Private (stockings) while private outfits are closed: refused, nothing made.
        expect(result.ok).toBe(false);
        expect(created).toHaveLength(0);
        expect(document.getElementById('nexus-try-on-view').textContent).toMatch(/not one she can wear/);

        expect((await activity.request('wear', { outfit: 'little-black-dress' })).ok).toBe(true);
        expect(created[0].prompt).toBe('black satin cocktail dress');
        expect(service.controller.applyLook).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'made-1' }));
        // Asked again, she wears the one she already has rather than making it twice.
        await activity.request('wear', { outfit: 'little-black-dress' });
        expect(created).toHaveLength(1);
    });

    test('tattoos are refused while private outfits are closed', async () => {
        const { activity, created } = await setup();
        const result = await activity.request('tattoo', { design: 'lotus-ornament-01', placement: 'lower-back' });
        expect(result.ok).toBe(false);
        expect(created).toHaveLength(0);
    });

    test('the host opens the haul, reveals each look and closes with the recap', async () => {
        const host = {
            available: () => true,
            open: jest.fn(),
            reveal: jest.fn(async () => ({ line: 'Okay, obsessed.', spin: false })),
            outro: jest.fn(),
        };
        const { activity } = await setup({ host });
        await activity.start({});
        await flush();
        expect(host.open).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }));
        document.querySelector('[data-key="look:burgundy"]').click();
        await flush();
        expect(host.reveal).toHaveBeenCalledWith(
            expect.objectContaining({ look: expect.objectContaining({ id: 'burgundy' }), private: false })
        );
        expect(document.querySelector('.nexus-try-on-react').textContent).toMatch(/obsessed/);
        activity.stop('user');
        await flush();
        expect(host.outro).toHaveBeenCalledWith({ favorites: [], kept: null });
    });

    test('what the companion is told: her shelf and whether private outfits are open', async () => {
        const { activity } = await setup();
        await activity.start({});
        await flush();
        expect(activity.shelf()).toMatchObject({ looks: ['Burgundy', 'Summer'], running: true });
        expect(activity.privateOpen()).toBe(false);
    });
});

describe('W17: a shared Forge wardrobe', () => {
    test('one look per name — the public Space keeps every visitor’s sundress', async () => {
        const look = (id, name) => ({ id, name, vrmUrl: `/v1/assets/looks/${id}/look.vrm`, type: 'look' });
        const library = {
            available: true,
            resolveUrl: (url) => 'https://forge.test' + url,
            client: {
                getWardrobe: async () => ({
                    looks: [
                        look('a', 'Yellow sundress'),
                        look('b', 'Yellow sundress'),
                        look('c', 'yellow sundress '),
                        look('d', 'Wrap dress'),
                        { id: 'src', name: 'Original', vrmUrl: '/x.vrm', type: 'source' },
                    ],
                }),
            },
        };
        const identity = { kind: 'library', slug: 'avatar-sample-a' };
        const looks = await TryOn.loadLooks({ library, identity });
        expect(looks.map((l) => l.id)).toEqual(['a', 'd']);
        expect(looks[0].vrmUrl).toBe('https://forge.test/v1/assets/looks/a/look.vrm');
    });
});

describe('OD2: a private look with a host', () => {
    test('is counted by the host but handed to Try-On’s own reaction, never posted', async () => {
        mountHost();
        const lace = { ...LOOK('lace', 'Black Lace Set'), private: true };
        const service = fakeService({ looks: [lace, LOOK('summer', 'Summer')] });
        const host = {
            available: () => true,
            open: jest.fn(async () => null),
            outro: jest.fn(async () => null),
            reveal: jest.fn(async (event) => ({ line: event.private ? null : 'Love it!', spin: false })),
        };
        const activity = TryOn.create({
            wardrobe: { service, config: {} },
            doc: document,
            Session: TryOnSession,
            View: TryOnView,
            Identity,
            Reasons,
            Intent,
            Reactions,
            host,
            noWarm: true,
        });
        activity.start();
        await flush();
        await flush();
        document.querySelector('[data-key="look:lace"]').click();
        await flush();
        await flush();
        expect(host.reveal).toHaveBeenCalledWith(expect.objectContaining({ private: true }));
        const line = document.querySelector('.nexus-try-on-react');
        expect(line).not.toBeNull();
        expect(
            Object.values(Reactions.PRIVATE_LINES)
                .flat()
                .some((l) => line.textContent.includes(l))
        ).toBe(true);
    });
});
