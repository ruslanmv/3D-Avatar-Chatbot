/**
 * UN15. Every wardrobe change ends: in her new look, or back in the one she had, with the reason.
 * Found in a real run: a first change against a cold Forge store stayed pending past 180 s.
 */
const { InSceneWardrobe, WEAR_MS, CREATE_MS } = require('../../src/experiences/private/InSceneWardrobe.js');

const LOOK = { lookId: 'look_a', name: 'Black Babydoll', vrmUrl: 'a.vrm' };

/** A TryOnSession stand-in: `wear` resolves when told to, `undo` is recorded. */
function fakeSession() {
    const s = {
        worn: { original: true },
        history: [{ original: true }],
        wears: 0,
        undos: 0,
        pending: null,
        wear(look) {
            s.wears += 1;
            s.history.push(look);
            return new Promise((resolve) => {
                s.pending = (ok = true) => {
                    if (ok) s.worn = look;
                    resolve(ok);
                };
            });
        },
        undo() {
            s.undos += 1;
            s.history.pop();
            return Promise.resolve(true);
        },
        head() {
            return s.history[s.history.length - 1];
        },
    };
    return s;
}

function wardrobe({ wearMs = 80, slowMs = 20, createMs = 80 } = {}) {
    const w = new InSceneWardrobe({ win: {} });
    w.session = fakeSession();
    w.privateOpen = true;
    w._wearMs = wearMs;
    w._slowMs = slowMs;
    w._createMs = createMs;
    return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('UN15. wardrobe changes are bounded, deduplicated and recoverable', () => {
    test('the deadlines are a minute to put a look on and four to make one', () => {
        expect(WEAR_MS).toBe(60000);
        expect(CREATE_MS).toBe(240000);
    });

    test('a slow change says so, and a change past the deadline is given up and undone', async () => {
        const w = wardrobe();
        const seen = [];
        w.onChange((snap) => seen.push(`${snap.status}:${snap.why || ''}`));
        const out = await w.wearLook(LOOK);
        expect(out).toEqual({ ok: false, why: 'timeout' });
        expect(seen).toContain('changing:slow');
        expect(w.state).toMatchObject({ status: 'failed', why: 'timeout' });
        expect(w.session.undos).toBe(1); // back to what she had once the slow file lands
    });

    test('a change that lands in time is worn, and nothing is undone', async () => {
        const w = wardrobe({ wearMs: 500 });
        const pending = w.wearLook(LOOK);
        await wait(5);
        w.session.pending(true);
        expect(await pending).toMatchObject({ ok: true });
        expect(w.state.status).toBe('worn');
        expect(w.session.undos).toBe(0);
    });

    test('the same look asked for twice while it is on its way is one change', async () => {
        const w = wardrobe({ wearMs: 500 });
        const a = w.wearLook(LOOK);
        const b = w.wearLook({ ...LOOK });
        expect(b).toBe(a);
        await wait(5);
        w.session.pending(true);
        await a;
        expect(w.session.wears).toBe(1);
        // Once it has landed, asking again is a new request (and the session sees it is worn).
        w.wearLook(LOOK);
        expect(w.session.wears).toBe(2);
    });

    test('a load that fails leaves her in what she had and says why', async () => {
        const w = wardrobe({ wearMs: 500 });
        const pending = w.wearLook(LOOK);
        await wait(5);
        w.session.pending(false);
        expect(await pending).toEqual({ ok: false, why: 'load-failed' });
        expect(w.session.worn).toEqual({ original: true });
    });

    test('a new look that is not made in time is cancelled, never left pending', async () => {
        const w = wardrobe({ createMs: 30 });
        w.canCreate = true;
        let signal = null;
        w.generator = {
            create: (prompt, options) =>
                new Promise((resolve, reject) => {
                    signal = options.signal;
                    signal.addEventListener('abort', () =>
                        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
                    );
                }),
        };
        const out = await w.create({ prompt: 'black satin slip dress' });
        expect(out).toEqual({ ok: false, why: 'timeout' });
        expect(signal.aborted).toBe(true);
        expect(w.state).toMatchObject({ status: 'failed', why: 'timeout' });
    });
});

describe('UN15. what the person and she are told', () => {
    const Locale = require('../../src/features/together/PrivateLocale.js');
    test('every language has the still-changing and too-long lines', () => {
        for (const lang of ['en', 'es', 'it', 'fr', 'de', 'pt', 'ja', 'ko', 'zh']) {
            const t = (key) => Locale.t(key, {}, lang);
            expect(t('outfit.slow')).toBeTruthy();
            expect(t('outfit.failed.timeout')).toBeTruthy();
            expect(t('outfit.slow')).not.toBe('outfit.slow');
        }
    });
});
