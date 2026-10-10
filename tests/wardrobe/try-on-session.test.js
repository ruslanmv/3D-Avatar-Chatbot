/**
 * W6, LT1. The haul, played live: tap a look and she wears it; every change is a step in
 * one history; compare, favourites and Show Mode never lose a look; End restores once.
 *
 * The controller stays the only thing that swaps her avatar; these tests hold that the
 * session asks it the right things, in the right order, once.
 */
const { TryOnSession, ORIGINAL } = require('../../src/wardrobe/TryOnSession.js');

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
            controller.worn.push('(original)');
            current = controller.original;
            return true;
        }),
        land: () => pending.shift()(),
        pending,
    };
    return controller;
}

function session(controller, options = {}) {
    const s = new TryOnSession({ controller, ...options });
    s.setLooks(LOOKS);
    return s;
}

const names = (s) => s.state().history.map((step) => step.name);
const tick = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe('TryOnSession — live play', () => {
    test('tapping a look puts it on at once: no choosing, no Start, and the haul begins there', async () => {
        const c = fakeController();
        const s = session(c);
        expect(s.state()).toMatchObject({ phase: 'live', began: false, look: null });
        expect(c.snapshot).not.toHaveBeenCalled(); // opening Try-On touches nothing
        expect(await s.wear('summer')).toBe(true);
        expect(c.snapshot).toHaveBeenCalledTimes(1);
        expect(c.worn).toEqual(['Summer Casual']);
        expect(s.state()).toMatchObject({ began: true, position: 1, total: 3, look: { id: 'summer' } });
        expect(names(s)).toEqual(['Original', 'Summer Casual']);
    });

    test('Next and Previous walk her shelf (wrapping), starting from the first look', async () => {
        const c = fakeController();
        const s = session(c);
        await s.next(); // nothing on yet: the first look
        await s.next();
        await s.next();
        await s.next(); // wraps
        await s.previous(); // wraps back
        expect(c.worn).toEqual(['Burgundy Evening', 'Summer Casual', 'Black Satin', 'Burgundy Evening', 'Black Satin']);
        expect(s.state().position).toBe(2);
    });

    test('tapping faster than a VRM loads lands on the last tap, and skipped looks never enter the history', async () => {
        const c = fakeController({ instant: false });
        const s = session(c);
        const first = s.wear('burgundy');
        s.wear('summer'); // while burgundy is still loading
        s.wear('satin');
        expect(s.state().going.id).toBe('satin');
        c.land(); // burgundy lands
        await tick();
        c.land(); // then straight to satin — summer is never loaded
        await first;
        expect(c.worn).toEqual(['Burgundy Evening', 'Black Satin']);
        expect(names(s)).toEqual(['Original', 'Black Satin']);
        expect(s.state()).toMatchObject({ busy: false, going: null });
    });

    test('the screen is told a look is on its way before it lands', async () => {
        const c = fakeController({ instant: false });
        const seen = [];
        const s = new TryOnSession({ controller: c, onChange: (state) => seen.push(state.busy) });
        s.setLooks(LOOKS);
        const wearing = s.wear('burgundy');
        expect(seen[seen.length - 1]).toBe(true); // "Putting it on…" is showing while it loads
        c.land();
        await wearing;
        expect(seen[seen.length - 1]).toBe(false);
    });

    test('Undo walks the history back, all the way to the original', async () => {
        const c = fakeController();
        const s = session(c);
        await s.wear('burgundy');
        await s.wear('satin');
        expect(s.state().canUndo).toBe(true);
        await s.undo();
        expect(s.state().look.id).toBe('burgundy');
        await s.undo();
        expect(s.state()).toMatchObject({ look: null, original: true, canUndo: false });
        expect(c.worn).toEqual(['Burgundy Evening', 'Black Satin', 'Burgundy Evening', '(original)']);
        expect(await s.undo()).toBe(false);
    });

    test('wearing what she has on again does not add a step', async () => {
        const s = session(fakeController());
        await s.wear('burgundy');
        await s.wear('burgundy');
        expect(names(s)).toEqual(['Original', 'Burgundy Evening']);
    });

    test('compare shows the original or the previous look without touching the history, and returns', async () => {
        const c = fakeController();
        const s = session(c);
        expect(s.canCompare('original')).toBe(false); // nothing to compare yet
        await s.wear('burgundy');
        await s.wear('satin');
        await s.compare('previous');
        expect(s.state()).toMatchObject({ comparing: 'previous', look: { id: 'satin' } });
        expect(s.state().worn.id).toBe('burgundy');
        await s.toggleCompare('previous'); // tap again: back
        expect(s.state()).toMatchObject({ comparing: null });
        expect(s.state().worn.id).toBe('satin');
        await s.compare('original');
        expect(s.state().worn).toBe(ORIGINAL);
        await s.compareEnd();
        expect(names(s)).toEqual(['Original', 'Burgundy Evening', 'Black Satin']);
        expect(c.worn).toEqual([
            'Burgundy Evening',
            'Black Satin',
            'Burgundy Evening',
            'Black Satin',
            '(original)',
            'Black Satin',
        ]);
    });

    test('a favourite is a heart, not a decision: the haul goes on', async () => {
        const c = fakeController();
        const s = session(c);
        await s.wear('burgundy');
        expect(s.favorite()).toBe(true);
        await s.wear('satin');
        s.favorite();
        expect(s.state()).toMatchObject({ phase: 'live', favorites: ['burgundy', 'satin'], favorite: true });
        expect(s.favorite('burgundy')).toBe(false); // un-heart
        expect(s.state().favorites).toEqual(['satin']);
    });

    test('Show Mode plays the favourites once there are two, else every look, and any tap stops it', async () => {
        const queue = [];
        const timers = { setTimeout: (fn) => (queue.push(fn), queue.length), clearTimeout: () => {} };
        const c = fakeController();
        const s = session(c, { timers });
        expect(s.playlist().map((l) => l.id)).toEqual(['burgundy', 'summer', 'satin']);
        s.favorite('burgundy');
        s.favorite('satin');
        expect(s.play({ interval: 10 })).toBe(true);
        await tick();
        expect(c.worn).toEqual(['Burgundy Evening']);
        queue.shift()(); // the interval passes
        await tick();
        expect(c.worn).toEqual(['Burgundy Evening', 'Black Satin']);
        expect(s.state().playing).toBe(true);
        await s.wear('summer'); // the person takes over
        expect(s.state().playing).toBe(false);
    });

    test('End puts her back exactly once, however many times it is asked', async () => {
        const c = fakeController();
        const s = session(c);
        await s.wear('summer');
        const [a, b] = await Promise.all([s.end(), s.end()]);
        await s.end();
        expect(a).toEqual({ kept: false, restored: true });
        expect(b).toBe(a);
        expect(c.restores).toBe(1);
        expect(s.state().phase).toBe('ended');
    });

    test('ending while she is already in her original does not load it again', async () => {
        const c = fakeController();
        const s = session(c);
        await s.wear('summer');
        await s.undo();
        expect(await s.end()).toEqual({ kept: false, restored: true });
        expect(c.restores).toBe(1); // the undo's, not a second one
    });

    test('Keep ends the haul without putting her back — and needs a look on', async () => {
        const c = fakeController();
        const s = session(c);
        expect(await s.keep()).toBe(false);
        await s.wear('satin');
        await s.compare('original');
        expect(await s.keep()).toBe(true); // the compare is ended first: she keeps the look, not the original
        expect(c.worn[c.worn.length - 1]).toBe('Black Satin');
        expect(await s.end()).toEqual({ kept: true, restored: false });
        expect(c.restores).toBe(1); // only the compare's
    });

    test('after a look was kept, "original" and End mean that look, not her base avatar', async () => {
        const kept = { url: 'https://f/looks/satin.vrm', name: 'Black Satin', index: -1 };
        const c = fakeController({ current: kept, original: { ...BASE } });
        const s = session(c);
        await s.wear('burgundy');
        await s.end();
        expect(c.restores).toBe(0);
        expect(c.applyLook).toHaveBeenLastCalledWith({ vrmUrl: kept.url, name: 'Black Satin' });
        expect(c.original).toEqual(BASE); // the base avatar, which new looks are made from, is untouched
    });

    test('a look that cannot be put on is reported, and she and the history stay on the last good one', async () => {
        const c = fakeController();
        const s = new TryOnSession({ controller: c });
        s.setLooks([LOOKS[0], { id: 'broken', name: 'Broken', vrmUrl: 'x', fail: true }]);
        await s.wear('burgundy');
        expect(await s.wear('broken')).toBe(false);
        expect(s.state()).toMatchObject({ look: { id: 'burgundy' }, error: expect.stringMatching(/finish loading/) });
        expect(names(s)).toEqual(['Original', 'Burgundy Evening']);
    });

    test('a look made during the haul joins the shelf; wearing it is a separate call', () => {
        const c = fakeController();
        const s = session(c);
        s.add({ id: 'new', name: 'Fresh', vrmUrl: 'https://f/new.vrm' });
        expect(s.state().looks.map((l) => l.id)).toContain('new');
        expect(c.applyLook).not.toHaveBeenCalled();
    });

    test('ending a haul in which nothing was worn changes nothing', async () => {
        const c = fakeController();
        const s = session(c);
        expect(await s.end()).toEqual({ kept: false, restored: false });
        expect(c.restores + c.applyLook.mock.calls.length + c.snapshot.mock.calls.length).toBe(0);
    });
});
