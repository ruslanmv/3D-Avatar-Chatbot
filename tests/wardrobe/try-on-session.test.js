/**
 * W6. The haul at the person's own pace: choose, step through, keep or end.
 *
 * The controller stays the only thing that swaps her avatar; these tests hold that the
 * session asks it the right things, in the right order, once.
 */
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');

const LOOKS = [
    { id: 'burgundy', name: 'Burgundy Evening', vrmUrl: 'https://f/looks/burgundy.vrm' },
    { id: 'summer', name: 'Summer Casual', vrmUrl: 'https://f/looks/summer.vrm' },
    { id: 'satin', name: 'Black Satin', vrmUrl: 'https://f/looks/satin.vrm' },
];
const BASE = { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A', index: 0 };

/** A controller whose loads finish when the test says so (or at once, with `instant`). */
function fakeController({ instant = true, current = BASE, original = null } = {}) {
    const pending = [];
    const controller = {
        original,
        worn: [],
        restores: 0,
        avatarManager: { getCurrent: () => current },
        snapshot: jest.fn(function () {
            this.original = { ...current };
            return this.original;
        }),
        applyLook: jest.fn(function (look) {
            if (look.fail)
                return Promise.reject(new Error('Wait for the avatar to finish loading before trying on a look'));
            const done = () => {
                controller.worn.push(look.name);
                current = { url: look.vrmUrl, name: look.name, index: -1 };
            };
            if (instant) {
                done();
                return Promise.resolve(look);
            }
            return new Promise((resolve) => pending.push(() => (done(), resolve(look))));
        }),
        restore: jest.fn(async () => {
            controller.restores += 1;
            current = controller.original;
            return true;
        }),
        land: () => pending.shift()(),
        pending,
    };
    return controller;
}

function session(controller) {
    const s = new TryOnSession({ controller });
    s.setLooks(LOOKS);
    return s;
}

describe('TryOnSession', () => {
    test('choosing keeps the order looks were chosen in, and ignores what is not on the shelf', () => {
        const s = session(fakeController());
        s.toggle('satin');
        s.toggle('burgundy');
        expect(s.toggle('nope')).toBe(false);
        expect(s.selected().map((l) => l.id)).toEqual(['satin', 'burgundy']);
        s.toggle('satin');
        expect(s.selected().map((l) => l.id)).toEqual(['burgundy']);
    });

    test('start needs a choice, and says so', async () => {
        const s = session(fakeController());
        expect(await s.start()).toBe(false);
        expect(s.state().error).toMatch(/Choose at least one/);
        expect(s.state().phase).toBe('choosing');
    });

    test('Next and Previous wrap, and each puts the look on through the controller', async () => {
        const c = fakeController();
        const s = session(c);
        ['burgundy', 'summer', 'satin'].forEach((id) => s.toggle(id));
        await s.start();
        await s.next();
        await s.next();
        await s.next(); // wraps to the first
        await s.previous(); // wraps to the last
        expect(c.worn).toEqual(['Burgundy Evening', 'Summer Casual', 'Black Satin', 'Burgundy Evening', 'Black Satin']);
        expect(s.state()).toMatchObject({ index: 2, total: 3, look: expect.objectContaining({ id: 'satin' }) });
    });

    test('tapping faster than a VRM loads skips the looks in between and lands on the last tap', async () => {
        const c = fakeController({ instant: false });
        const s = session(c);
        ['burgundy', 'summer', 'satin'].forEach((id) => s.toggle(id));
        const started = s.start();
        s.next(); // → summer, while burgundy is still loading
        s.next(); // → satin
        expect(s.state().going.id).toBe('satin');
        c.land(); // burgundy lands
        await Promise.resolve();
        await Promise.resolve();
        c.land(); // then straight to satin — summer is never loaded
        await started;
        expect(c.worn).toEqual(['Burgundy Evening', 'Black Satin']);
        expect(s.state()).toMatchObject({ index: 2, busy: false });
    });

    test('the screen is told a look is on its way before it lands', async () => {
        const c = fakeController({ instant: false });
        const seen = [];
        const s = new TryOnSession({ controller: c, onChange: (state) => seen.push(state.busy) });
        s.setLooks(LOOKS);
        s.toggle('burgundy');
        const started = s.start();
        expect(seen[seen.length - 1]).toBe(true); // "putting it on…" is showing while it loads
        c.land();
        await started;
        expect(seen[seen.length - 1]).toBe(false);
    });

    test('End puts her back exactly once, however many times it is asked', async () => {
        const c = fakeController();
        const s = session(c);
        s.toggle('summer');
        await s.start();
        const [a, b] = await Promise.all([s.end(), s.end()]);
        await s.end();
        expect(a).toEqual({ kept: false, restored: true });
        expect(b).toBe(a);
        expect(c.restores).toBe(1);
        expect(s.state().phase).toBe('ended');
    });

    test('Keep ends the haul without putting her back', async () => {
        const c = fakeController();
        const s = session(c);
        s.toggle('satin');
        await s.start();
        await s.keep();
        expect(await s.end()).toEqual({ kept: true, restored: false });
        expect(c.restores).toBe(0);
    });

    test('after a look was kept, the next haul ends on that look, not on her base avatar', async () => {
        const kept = { url: 'https://f/looks/satin.vrm', name: 'Black Satin', index: -1 };
        const c = fakeController({ current: kept, original: { ...BASE } });
        const s = session(c);
        s.toggle('burgundy');
        await s.start();
        await s.end();
        expect(c.restores).toBe(0);
        expect(c.applyLook).toHaveBeenLastCalledWith({ vrmUrl: kept.url, name: 'Black Satin' });
        expect(c.original).toEqual(BASE); // the base avatar, which new looks are made from, is untouched
    });

    test('a look that cannot be put on is reported and she stays on the last good one', async () => {
        const c = fakeController();
        const s = new TryOnSession({ controller: c });
        s.setLooks([LOOKS[0], { id: 'broken', name: 'Broken', vrmUrl: 'x', fail: true }]);
        s.toggle('burgundy');
        s.toggle('broken');
        await s.start();
        expect(await s.next()).toBe(false);
        expect(s.state()).toMatchObject({ index: 0, target: 0, error: expect.stringMatching(/finish loading/) });
    });

    test('a look made during the haul is added to the shelf and chosen', () => {
        const s = session(fakeController());
        s.add({ id: 'new', name: 'Fresh', vrmUrl: 'https://f/new.vrm' });
        expect(s.isChosen('new')).toBe(true);
        expect(s.state().looks.map((l) => l.id)).toContain('new');
    });

    test('ending a haul that never started changes nothing', async () => {
        const c = fakeController();
        const s = session(c);
        expect(await s.end()).toEqual({ kept: false, restored: false });
        expect(c.restores + c.applyLook.mock.calls.length).toBe(0);
    });
});
