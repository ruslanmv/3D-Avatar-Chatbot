/**
 * LT10. The session never says she wears a look the renderer is not showing.
 *
 * The cancellation work made a wear something that can end three ways (landed, failed,
 * stopped) at any moment relative to the taps around it, and each defect found so far was one
 * ordering nobody had written down: a superseded look landing anyway, End waiting for a look
 * it should have stopped, a look given up while it was wanted again. So the orderings are not
 * enumerated here. Seeded random sequences of everything a person or another owner can do
 * (tap a look, Undo, an outside cancel, a download arriving, a download failing) run against
 * the real WardrobeController, and after every step:
 *
 * - what the session reports as worn is what the stage has loaded;
 * - when nothing is in flight, the look it names (the head of its history) is that same one,
 *   and the controller's record of the look agrees;
 * - a look that was stopped or failed is never the one loaded last.
 *
 * And at the end, with every download settled and the haul ended, she is in her own file.
 */
const ORIGINAL = { url: '/vendor/avatars/AvatarSample_B.vrm', name: 'B', index: 1 };
const IDS = ['jeans', 'dress', 'coat'];

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
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

/** A small seeded generator: the same seed is the same sequence, so a failure can be replayed. */
function random(seed) {
    let state = seed >>> 0 || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function haul() {
    jest.resetModules();
    delete window.NEXUS_WARDROBE_CLIENT;
    window.NEXUS_WARDROBE_CLIENT = require('../../src/wardrobe/WardrobeClient.js');
    const Controller = require('../../src/wardrobe/WardrobeController.js');
    const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
    const manager = {
        current: Object.assign({}, ORIGINAL),
        getCurrent() {
            return this.current;
        },
        setAvatarByUrl: jest.fn(async (url, name) => {
            manager.current = { url, name };
            return { url };
        }),
    };
    const open = []; // downloads still held: {id, gate}
    const controller = new Controller({
        forge: { resolveUrl: (u) => u },
        viewer: { avatarManager: manager },
        verifyLook: (look, options) => {
            const gate = deferred();
            const entry = { id: look.id, gate };
            open.push(entry);
            if (options && options.signal) {
                options.signal.addEventListener('abort', () => {
                    if (open.includes(entry)) open.splice(open.indexOf(entry), 1);
                    gate.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            }
            return gate.promise;
        },
    });
    const looks = IDS.map((id) => ({
        id,
        key: `builtin:pack:avatar-sample-b:${id}`,
        name: id,
        vrmUrl: `/looks/${id}.vrm`,
        sha256: id,
    }));
    const session = new TryOnSession({ controller });
    looks.forEach((look) => session.add(look));
    return { session, controller, manager, looks, open };
}

/** What the stage has loaded: 'original', or a look's id. */
function onStage(manager) {
    if (manager.current.url === ORIGINAL.url) return 'original';
    const match = /^blob:([a-z]+)#/.exec(manager.current.url);
    return match ? match[1] : `unknown:${manager.current.url}`;
}

function named(item) {
    return !item || item.original || !item.id ? 'original' : item.id;
}

function check(world, trail) {
    const { session, controller, manager } = world;
    const state = session.state();
    const stage = onStage(manager);
    const where = `after ${trail.join(', ')}`;
    // What it reports as worn is what is on stage, in flight or not.
    expect(`${named(state.worn)} (${where})`).toBe(`${stage} (${where})`);
    expect(`${controller.activeLook ? controller.activeLook.id : 'original'} (${where})`).toBe(`${stage} (${where})`);
    if (!state.busy) {
        // Nothing on its way: the look it names is the look she is in.
        expect(`${named(state.head)} (${where})`).toBe(`${stage} (${where})`);
        expect(state.going).toBeNull();
        expect(controller.pending).toBe(false);
    }
}

async function play(seed, steps) {
    const world = haul();
    const { session, controller, looks, open } = world;
    const pick = random(seed);
    const trail = [];
    for (let i = 0; i < steps; i += 1) {
        const roll = pick();
        if (roll < 0.45) {
            const look = looks[Math.floor(pick() * looks.length)];
            trail.push(`tap ${look.id}`);
            session.wear(look).catch(() => {});
        } else if (roll < 0.55) {
            trail.push('undo');
            session.undo().catch(() => {});
        } else if (roll < 0.65) {
            trail.push('outside cancel');
            controller.cancel();
        } else if (roll < 0.9 && open.length) {
            const entry = open.shift();
            trail.push(`${entry.id} arrives`);
            entry.gate.resolve({ url: `blob:${entry.id}#look.vrm`, revoke: jest.fn() });
        } else if (open.length) {
            const entry = open.shift();
            trail.push(`${entry.id} fails`);
            entry.gate.reject(new Error('503'));
        } else {
            trail.push('wait');
        }
        // Half the time the next thing happens before this one has settled.
        if (pick() < 0.5) {
            await flush();
            check(world, trail);
        }
    }
    await flush(); // the last tap may not have asked for its download yet
    while (open.length) {
        const entry = open.shift();
        trail.push(`${entry.id} arrives late`);
        entry.gate.resolve({ url: `blob:${entry.id}#look.vrm`, revoke: jest.fn() });
        await flush();
    }
    await flush();
    check(world, trail);
    expect(`${session.state().busy} (after ${trail.join(', ')})`).toBe(`false (after ${trail.join(', ')})`);
    trail.push('end');
    const ended = await session.end();
    await flush();
    expect(`${onStage(world.manager)} (after ${trail.join(', ')})`).toBe(`original (after ${trail.join(', ')})`);
    expect(controller.activeLook).toBeNull();
    expect(controller.pending).toBe(false);
    expect(ended.kept).toBe(false);
    return trail;
}

describe('LT10 what the session says she wears is what is on stage', () => {
    test('400 seeded sequences of taps, undos, outside cancels, arrivals and failures', async () => {
        for (let seed = 1; seed <= 400; seed += 1) await play(seed, 14);
    });

    test('long sequences', async () => {
        for (let seed = 1001; seed <= 1040; seed += 1) await play(seed, 60);
    });

    test('a look somebody else stops is not left named on the stage', async () => {
        const world = haul();
        const { session, controller, looks, open } = world;
        const wearing = session.wear(looks[0]);
        await flush();
        expect(open.length).toBe(1);
        controller.cancel();
        expect(await wearing).toBe(false);
        await flush();
        const state = session.state();
        expect(state.original).toBe(true);
        expect(state.look).toBeNull();
        expect(state.error).toBeNull();
        expect(onStage(world.manager)).toBe('original');
        // And the look can still be put on afterwards.
        const again = session.wear(looks[0]);
        await flush();
        open.shift().gate.resolve({ url: 'blob:jeans#look.vrm', revoke: jest.fn() });
        expect(await again).toBe(true);
        expect(session.state().look.id).toBe('jeans');
        expect(onStage(world.manager)).toBe('jeans');
    });
});
