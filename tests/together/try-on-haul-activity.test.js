/**
 * W7. Try-On as a Together activity: it speaks the contract, it opens where the panel
 * was, it shows her looks only, and every way out restores her exactly once.
 */
const Contract = require('../../src/features/together/activities/contract.js');
const TryOn = require('../../src/features/together/activities/try-on-haul.js');
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Identity = require('../../src/wardrobe/AvatarIdentity.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');

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
    });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
        expect([...view.querySelectorAll('.nexus-try-on-name')].map((n) => n.textContent)).toEqual([
            'Burgundy',
            'Summer',
        ]);
    });

    test('a bundled wardrobe that belongs to another avatar is not offered', async () => {
        const activity = activityWith(fakeService({ owner: 'masc-vroid' }));
        await activity.start({});
        await flush();
        expect(document.querySelectorAll('.nexus-try-on-card')).toHaveLength(0);
        expect(document.querySelector('.nexus-try-on-empty').textContent).toMatch(/No looks for her yet/);
    });

    test('choose, start, step, and the launcher line follows', async () => {
        const service = fakeService();
        const activity = activityWith(service);
        await activity.start({});
        await flush();
        document.querySelectorAll('.nexus-try-on-card').forEach((card) => card.click());
        expect(activity.status()).toEqual({ label: 'Try-On', detail: '2 chosen' });
        document.querySelector('[data-key="start"]').click();
        await flush();
        expect(activity.status().detail).toBe('Look 1 of 2 · Burgundy');
        document.querySelector('[data-key="next"]').click();
        await flush();
        expect(activity.status().detail).toBe('Look 2 of 2 · Summer');
        expect(service.controller.applyLook).toHaveBeenCalledTimes(2);
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
        document.querySelector('[data-key="start"]').click();
        await flush();
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
        document.querySelector('[data-key="start"]').click();
        await flush();
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
