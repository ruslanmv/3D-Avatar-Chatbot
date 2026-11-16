/**
 * LT10. A look that is no longer wanted is cancelled, not landed and then undone.
 *
 * Found by the clothed acceptance matrix (tools/qa/wardrobe-clothed-acceptance.mjs) in a real
 * browser, on every character: BI3 taught the controller to cancel a wear, but TryOnSession
 * still waited for the look in flight. Tap one look and then another, or end the haul while
 * the first was downloading, and the unwanted look finished its download, appeared on her, and
 * was only then replaced.
 *
 * What must hold, with the real WardrobeController and a manager that drops stale loads as
 * AvatarManager does:
 * - a second tap aborts the first look's download; the first look is never loaded;
 * - tapping back to what she already wears aborts the look in flight and loads nothing;
 * - End haul while the first look downloads aborts it; the look never loads, she keeps her own
 *   file, and nothing is recorded as worn;
 * - End haul while a later look downloads aborts it and restores her once;
 * - a kept look is not disturbed, and a restore in flight is left to finish.
 */
const ORIGINAL = { url: '/vendor/avatars/AvatarSample_B.vrm', name: 'B', index: 1 };

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** The real controller over a stage whose loads land at once, and downloads the test holds. */
function haul() {
    jest.resetModules();
    delete window.NEXUS_WARDROBE_CLIENT;
    window.NEXUS_WARDROBE_CLIENT = require('../../src/wardrobe/WardrobeClient.js');
    const Controller = require('../../src/wardrobe/WardrobeController.js');
    const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
    const loaded = [];
    const manager = {
        current: Object.assign({}, ORIGINAL),
        getCurrent() {
            return this.current;
        },
        setAvatarByUrl: jest.fn(async (url, name) => {
            loaded.push(url);
            manager.current = { url, name };
            return { url };
        }),
    };
    const downloads = {};
    const aborted = [];
    const controller = new Controller({
        forge: { resolveUrl: (u) => u },
        viewer: { avatarManager: manager },
        verifyLook: (look, options) => {
            const gate = deferred();
            downloads[look.id] = gate;
            if (options && options.signal) {
                options.signal.addEventListener('abort', () => {
                    aborted.push(look.id);
                    gate.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            }
            return gate.promise;
        },
    });
    const looks = ['jeans', 'dress'].map((id) => ({
        id,
        key: `builtin:pack:avatar-sample-b:${id}`,
        name: id,
        vrmUrl: `/looks/${id}.vrm`,
        sha256: id,
    }));
    const session = new TryOnSession({ controller });
    looks.forEach((look) => session.add(look));
    const land = (id) => downloads[id].resolve({ url: `blob:${id}#look.vrm`, revoke: jest.fn() });
    return { session, controller, manager, loaded, aborted, land, looks };
}

describe('LT10 a superseded wear is cancelled', () => {
    test('a second tap aborts the first download; the first look never loads', async () => {
        const { session, controller, loaded, aborted, land, looks } = haul();
        const [jeans, dress] = looks;
        session.wear(jeans);
        await flush();
        expect(controller.pending).toBe(true);
        const second = session.wear(dress);
        await flush();
        expect(aborted).toEqual(['jeans']);
        land('dress');
        await second;
        expect(loaded).toEqual(['blob:dress#look.vrm']);
        expect(controller.activeLook.id).toBe('dress');
        expect(session.error).toBeNull();
        // The skipped look never entered the history: Undo goes back to her own outfit.
        expect(session.state().history.map((h) => h.name)).toEqual(['Original', 'dress']);
    });

    test('tapping back to what she wears aborts the look in flight and loads nothing', async () => {
        const { session, controller, loaded, aborted, land, looks } = haul();
        const [jeans, dress] = looks;
        const first = session.wear(dress);
        await flush();
        land('dress');
        await first;
        session.wear(jeans);
        await flush();
        const back = session.wear(dress);
        await flush();
        await back;
        expect(aborted).toEqual(['jeans']);
        expect(loaded).toEqual(['blob:dress#look.vrm']);
        expect(controller.activeLook.id).toBe('dress');
        expect(controller.pending).toBe(false);
        expect(session.state().look.id).toBe('dress');
    });

    // Review finding on the LT10 change: one look, then another, then the first again, faster
    // than the first cancellation settles. The first look's wear had been cancelled by the
    // session itself, and its rejection arrived when that look was the target once more, so
    // the loop read it as "somebody stopped this look" and gave up: her own outfit on stage,
    // the session naming the look, no error. The look wanted last is the one she ends up in.
    test('back to a look whose wear the session has just cancelled: it is worn after all', async () => {
        const { session, controller, loaded, aborted, land, looks } = haul();
        const [jeans, dress] = looks;
        session.wear(jeans);
        await flush();
        session.wear(dress);
        const again = session.wear(jeans);
        await flush();
        expect(aborted).toEqual(['jeans']);
        expect(controller.pending).toBe(true);
        land('jeans');
        expect(await again).toBe(true);
        expect(loaded).toEqual(['blob:jeans#look.vrm']);
        expect(controller.activeLook.id).toBe('jeans');
        expect(session.state().look.id).toBe('jeans');
        expect(session.error).toBeNull();
    });

    test('and on to the other look again: only the look wanted last is loaded', async () => {
        const { session, controller, loaded, land, looks } = haul();
        const [jeans, dress] = looks;
        session.wear(jeans);
        await flush();
        session.wear(dress);
        session.wear(jeans);
        const last = session.wear(dress);
        await flush();
        land('dress');
        expect(await last).toBe(true);
        expect(loaded).toEqual(['blob:dress#look.vrm']);
        expect(controller.activeLook.id).toBe('dress');
        expect(session.state().look.id).toBe('dress');
    });

    test('a wear somebody else cancels is still given up, not started again', async () => {
        const { session, controller, loaded, aborted, looks } = haul();
        const wearing = session.wear(looks[0]);
        await flush();
        controller.cancel();
        expect(await wearing).toBe(false);
        await flush();
        expect(aborted).toEqual(['jeans']);
        expect(loaded).toEqual([]);
        expect(controller.pending).toBe(false);
        expect(session.error).toBeNull();
    });
});

describe('LT10 ending the haul stops a look on its way', () => {
    test('End while the first look downloads: aborted, never loaded, her own file stays', async () => {
        const { session, controller, manager, loaded, aborted, looks } = haul();
        session.wear(looks[0]);
        await flush();
        const ended = await session.end();
        expect(aborted).toEqual(['jeans']);
        expect(loaded).toEqual([]);
        expect(manager.current.url).toBe(ORIGINAL.url);
        expect(controller.activeLook).toBeNull();
        expect(controller.pending).toBe(false);
        expect(ended.kept).toBe(false);
        expect(session.error).toBeNull();
    });

    test('End while a later look downloads: aborted, and she is restored once', async () => {
        const { session, controller, manager, loaded, aborted, land, looks } = haul();
        const [jeans, dress] = looks;
        const first = session.wear(jeans);
        await flush();
        land('jeans');
        await first;
        session.wear(dress);
        await flush();
        const ended = await session.end();
        expect(aborted).toEqual(['dress']);
        expect(loaded).toEqual(['blob:jeans#look.vrm', ORIGINAL.url]);
        expect(manager.current.url).toBe(ORIGINAL.url);
        expect(controller.activeLook).toBeNull();
        expect(ended).toEqual({ kept: false, restored: true });
    });

    test('a kept look is left on, and End with nothing in flight cancels nothing', async () => {
        const { session, controller, aborted, land, looks } = haul();
        const first = session.wear(looks[0]);
        await flush();
        land('jeans');
        await first;
        session.keep();
        const ended = await session.end();
        expect(ended.kept).toBe(true);
        expect(aborted).toEqual([]);
        expect(controller.activeLook.id).toBe('jeans');
    });
});
