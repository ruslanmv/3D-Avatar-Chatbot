/**
 * LT10. In Private, a look that a newer request replaced is stopped, not shown and then undone.
 *
 * Found by tools/qa/wardrobe-scene-acceptance.mjs in a real Private evening: she asked for one
 * outfit, changed her mind while it downloaded, and the first one still appeared on her before
 * the wardrobe took it off again ("a late result is undone, not applied" held only after the
 * fact). In Private the look in flight can be a body state the person has just asked to leave.
 *
 * What must hold for the in-scene wardrobe:
 * - `cancelPending()` aborts the wear in flight through the session and reports it;
 * - the call that asked for the stopped look ends as `stale`, never as a failure, and leaves no
 *   error on the strip;
 * - nothing is undone, because nothing landed;
 * - with nothing in flight it does nothing, and a wear that simply fails still fails.
 */
const { InSceneWardrobe } = require('../../src/experiences/private/InSceneWardrobe.js');

const JEANS = { lookId: 'look_jeans', name: 'Crop top & jeans', vrmUrl: 'jeans.vrm' };
const DRESS = { lookId: 'look_dress', name: 'Yellow sundress', vrmUrl: 'dress.vrm' };

/** A TryOnSession stand-in whose wear settles when told to, and can be cancelled like BI3's. */
function fakeSession() {
    const s = {
        wears: [],
        undos: 0,
        cancels: 0,
        error: null,
        settle: null,
        wear(look) {
            s.wears.push(look.lookId);
            return new Promise((resolve) => {
                s.settle = resolve;
            });
        },
        // TryOnSession.cancelPending → controller.cancel(): the wear in flight resolves false
        // ("she kept what she had on") and no error is set.
        cancelPending() {
            s.cancels += 1;
            if (!s.settle) return false;
            const settle = s.settle;
            s.settle = null;
            settle(false);
            return true;
        },
        undo() {
            s.undos += 1;
            return Promise.resolve(true);
        },
    };
    return s;
}

function wardrobe() {
    const w = new InSceneWardrobe({ win: {} });
    w.session = fakeSession();
    w.privateOpen = true;
    return w;
}

describe('LT10 a superseded outfit change in Private', () => {
    test('is stopped: stale, not failed, and nothing is undone because nothing landed', async () => {
        const w = wardrobe();
        const seen = [];
        w.onChange((snap) => seen.push(`${snap.status}:${snap.why || ''}`));
        const first = w.wearLook(DRESS, () => false); // a newer request has taken over
        expect(w.cancelPending()).toBe(true);
        await expect(first).resolves.toEqual({ ok: false, why: 'stale' });
        expect(w.session.cancels).toBe(1);
        expect(w.session.undos).toBe(0);
        expect(seen.some((line) => line.startsWith('failed'))).toBe(false);
        expect(w.snapshot().status).toBe('idle');
    });

    test('the newer request then wears what was asked for, once', async () => {
        const w = wardrobe();
        const first = w.wearLook(DRESS, () => false);
        w.cancelPending();
        await first;
        const second = w.wearLook(JEANS, () => true);
        w.session.settle(true);
        await expect(second).resolves.toMatchObject({ ok: true, look: JEANS });
        expect(w.session.wears).toEqual(['look_dress', 'look_jeans']);
        expect(w.session.undos).toBe(0);
    });

    test('with nothing on its way there is nothing to stop', () => {
        const w = wardrobe();
        expect(w.cancelPending()).toBe(false);
        expect(w.session.cancels).toBe(0);
    });

    test('a wear that fails by itself is still a failure', async () => {
        const w = wardrobe();
        const wear = w.wearLook(DRESS, () => true);
        w.session.settle(false);
        await expect(wear).resolves.toEqual({ ok: false, why: 'load-failed' });
        expect(w.snapshot().status).toBe('failed');
    });
});
