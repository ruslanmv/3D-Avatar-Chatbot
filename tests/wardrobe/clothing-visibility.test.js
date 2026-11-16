/**
 * CV1. Clothing hidden and shown again, only where Forge allows it for the exact bytes on stage.
 *
 * The scene is a fake graph (meshes with materials, parents and userData); Forge is a fake `ask`. The
 * hash is the real SHA-256 of the bytes "loaded". Nothing here renders, and no character is approved:
 * Forge's answer is the fixture.
 */
const { webcrypto } = require('crypto');

Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
const CV = require('../../src/wardrobe/ClothingVisibility.js');

function mesh(name, material, userData) {
    return { isMesh: true, name, visible: true, material: { name: material }, userData: userData || {}, parent: null };
}

function scene() {
    const body = mesh('Body', 'Body_SKIN');
    const face = mesh('Face', 'Face_SKIN');
    const tee = mesh('Tee', 'White Fitted Tee [Forge_Tops_01_CLOTH]');
    const teeOutline = mesh('TeeOutline', 'White Fitted Tee [Forge_Tops_01_CLOTH] (Outline)');
    const jeans = mesh('Jeans', 'Blue Straight Jeans [Forge_Bottoms_01_CLOTH]');
    const hiddenAlready = mesh('Belt', 'Belt [Forge_Bottoms_01_CLOTH]');
    hiddenAlready.visible = false;
    const all = [body, face, tee, teeOutline, jeans, hiddenAlready];
    const root = { uuid: 'r1', traverse: (fn) => [root, ...all].forEach(fn), userData: {} };
    for (const m of all) m.parent = root;
    return { root, body, face, tee, teeOutline, jeans, hiddenAlready };
}

const BYTES = Uint8Array.from(Buffer.from('the exact file on stage')).buffer;
let SHA;

function page({ privateOn = true, answer } = {}) {
    const s = scene();
    const prefs = [];
    const usable = [];
    const win = {
        NEXUS_VIEWER: { avatarManager: { current: { url: 'her.vrm' }, currentRoot: s.root } },
        NEXUS_SPICY: {
            on: privateOn,
            isEnabled() {
                return this.on;
            },
            onPreferenceChange: (fn) => (prefs.push(fn), () => {}),
            onChange: (fn) => (usable.push(fn), () => {}),
        },
        localStorage: window.localStorage,
        addEventListener: (type, fn) => (win.listeners[type] = fn),
        removeEventListener: () => {},
        listeners: {},
        setInterval: () => 0,
        clearInterval: () => {},
        setTimeout: (fn) => fn(),
    };
    const ask = jest.fn(async (sha) => (typeof answer === 'function' ? answer(sha) : answer));
    const c = new CV.ClothingVisibilityController({ win, ask, bytesOf: async () => BYTES }).attach();
    return { c, win, s, ask, prefs, usable };
}

const ALLOWED = (sha) => ({
    sha256: sha,
    allowed: true,
    refusedBy: null,
    hideMaterials: ['White Fitted Tee [Forge_Tops_01_CLOTH]', 'Blue Straight Jeans [Forge_Bottoms_01_CLOTH]'],
    structure: { verdict: 'separable-complete' },
});

beforeAll(async () => {
    SHA = await CV.sha256(BYTES);
});
beforeEach(() => window.localStorage.clear());

describe('CV1 clothing visibility', () => {
    test('allowed for these bytes: only the named garments are hidden; body and face stay', async () => {
        const { c, s, ask } = page({ answer: ALLOWED });
        const r = await c.hideClothing();
        expect(r).toEqual({ ok: true, hidden: 3 });
        expect(ask).toHaveBeenCalledWith(SHA, BYTES);
        expect([s.tee.visible, s.teeOutline.visible, s.jeans.visible]).toEqual([false, false, false]);
        expect([s.body.visible, s.face.visible]).toEqual([true, true]);
    });

    test('shown again exactly as it was: a garment hidden before stays hidden', async () => {
        const { c, s } = page({ answer: ALLOWED });
        await c.hideClothing();
        c.showClothing();
        expect([s.tee.visible, s.teeOutline.visible, s.jeans.visible]).toEqual([true, true, true]);
        expect(s.hiddenAlready.visible).toBe(false);
        expect(c.hidden).toBe(false);
    });

    test('Forge refuses (body missing under the dress): nothing changes and the reason is Forge’s', async () => {
        const limitation = 'no body under her clothes in: upper';
        const { c, s } = page({
            answer: (sha) => ({
                sha256: sha,
                allowed: false,
                refusedBy: 'clothing-structure',
                structure: { verdict: 'separable-body-missing', limitation },
            }),
        });
        expect(await c.hideClothing()).toEqual({ ok: false, why: 'clothing-structure', limitation });
        expect(s.tee.visible).toBe(true);
    });

    test('no character review: refused at design-clearance, whatever the person confirmed', async () => {
        const { c, s } = page({ answer: (sha) => ({ sha256: sha, allowed: false, refusedBy: 'design-clearance' }) });
        expect((await c.hideClothing()).why).toBe('design-clearance');
        expect(s.jeans.visible).toBe(true);
    });

    test('an answer about other bytes is not an answer', async () => {
        const { c, s } = page({ answer: () => ALLOWED('0'.repeat(64)) });
        expect((await c.hideClothing()).why).toBe('answer-mismatch');
        expect(s.tee.visible).toBe(true);
    });

    test('Private off: nothing is asked and nothing hidden', async () => {
        const { c, ask } = page({ privateOn: false, answer: ALLOWED });
        expect((await c.hideClothing()).why).toBe('private-off');
        expect(ask).not.toHaveBeenCalled();
    });

    test('turning Private off, or Private becoming unusable, shows her clothing again', async () => {
        for (const which of ['prefs', 'usable']) {
            const p = page({ answer: ALLOWED });
            await p.c.hideClothing();
            p[which].forEach((fn) => fn(false));
            expect(p.s.tee.visible).toBe(true);
            expect(window.localStorage.getItem(CV.STORAGE)).toBeNull();
        }
    });

    test('a General-only place shown: her clothing is shown again', async () => {
        const p = page({ answer: ALLOWED });
        await p.c.hideClothing();
        p.win.__NEXUS_GENERAL_ONLY = { shown: 'school' };
        p.win.listeners['nexus-world-shown']({ detail: { id: 'school' } });
        expect(p.s.jeans.visible).toBe(true);
    });

    test('another avatar on stage: the old snapshot is dropped, the new avatar untouched', async () => {
        const p = page({ answer: ALLOWED });
        await p.c.hideClothing();
        const other = scene();
        p.win.NEXUS_VIEWER.avatarManager.currentRoot = other.root;
        p.c.showClothing('avatar-changed');
        expect(other.tee.visible).toBe(true);
        expect(p.c.hidden).toBe(false);
    });

    test('remembered for these exact bytes only, and re-applied only while Forge and Private say yes', async () => {
        const p = page({ answer: ALLOWED });
        await p.c.hideClothing();
        expect(window.localStorage.getItem(CV.STORAGE)).toBe(SHA);
        const again = page({ answer: ALLOWED });
        expect((await again.c.resume()).ok).toBe(true);
        expect(again.s.tee.visible).toBe(false);
        const refused = page({ answer: (sha) => ({ sha256: sha, allowed: false, refusedBy: 'operator-switch' }) });
        expect((await refused.c.resume()).ok).toBe(false);
        expect(refused.s.tee.visible).toBe(true);
    });

    test('Forge’s answer is asked once per exact file, then reused', async () => {
        const p = page({ answer: ALLOWED });
        await p.c.hideClothing();
        p.c.showClothing();
        await p.c.hideClothing();
        expect(p.ask).toHaveBeenCalledTimes(1);
    });
});
