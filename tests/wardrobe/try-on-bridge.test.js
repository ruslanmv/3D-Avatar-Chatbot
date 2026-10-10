/**
 * W8. The wiring: Try-On joins Together late, once, and hides the old drawer only when
 * the tile is really there — and the switch puts everything back as it was.
 */
const TryOn = require('../../src/wardrobe/TryOnHaulActivity.js');

function load() {
    jest.resetModules();
    return require('../../src/wardrobe/TryOnTogetherBridge.js');
}

function fakePanel() {
    return {
        activities: new Map(),
        register: jest.fn(function (activity) {
            this.activities.set(activity.id, activity);
            return true;
        }),
    };
}

describe('TryOnTogetherBridge', () => {
    beforeEach(() => {
        document.body.className = '';
        document.head.innerHTML = '';
        delete window.NEXUS_BD;
        delete window.NEXUS_WARDROBE;
        delete window.NEXUS_WARDROBE_CONFIG;
        delete window.NEXUS_TRY_ON;
        window.NEXUS_TRY_ON_HAUL_ACTIVITY = TryOn;
    });

    test('waits while either half is missing, and hides nothing meanwhile', () => {
        const Bridge = load();
        expect(Bridge.attach()).toEqual({ ok: false, why: 'waiting' });
        window.NEXUS_BD = { togetherPanel: fakePanel() };
        expect(Bridge.attach().why).toBe('waiting'); // the wardrobe is not ready yet
        expect(document.body.classList.contains(Bridge.HIDE_CLASS)).toBe(false);
    });

    test('registers the tile once, whichever half arrives last, then hides the drawer', () => {
        const Bridge = load();
        window.NEXUS_WARDROBE = { service: { controller: {} }, config: {} };
        const panel = fakePanel();
        window.NEXUS_BD = { togetherPanel: panel };
        expect(Bridge.attach()).toEqual({ ok: true, why: '' });
        expect(Bridge.attach()).toEqual({ ok: true, why: '' });
        expect(panel.register).toHaveBeenCalledTimes(1);
        expect(panel.activities.get('try-on-haul').ui.title).toBe('Try-On');
        expect(document.body.classList.contains(Bridge.HIDE_CLASS)).toBe(true);
        expect(document.getElementById('nexus-try-on-bridge-style').textContent).toMatch(/#nexus-wardrobe-button/);
    });

    test('start() polls until both exist', async () => {
        jest.useFakeTimers();
        const Bridge = load();
        const done = Bridge.start({ intervalMs: 100, timeoutMs: 5000 });
        window.NEXUS_BD = { togetherPanel: fakePanel() };
        jest.advanceTimersByTime(100);
        window.NEXUS_WARDROBE = { service: { controller: {} }, config: {} };
        jest.advanceTimersByTime(100);
        jest.useRealTimers();
        await expect(done).resolves.toEqual({ ok: true, why: '' });
    });

    test('a page without Together gives up quietly and keeps the drawer', async () => {
        jest.useFakeTimers();
        const Bridge = load();
        const done = Bridge.start({ intervalMs: 100, timeoutMs: 300 });
        jest.advanceTimersByTime(400);
        jest.useRealTimers();
        await expect(done).resolves.toEqual({ ok: false, why: 'timeout' });
        expect(document.body.classList.contains(Bridge.HIDE_CLASS)).toBe(false);
    });

    test('tryOnInTogether: false leaves everything as it was', () => {
        window.NEXUS_WARDROBE_CONFIG = { tryOnInTogether: false };
        const Bridge = load();
        const panel = fakePanel();
        window.NEXUS_BD = { togetherPanel: panel };
        window.NEXUS_WARDROBE = { service: { controller: {} }, config: {} };
        expect(Bridge.attach()).toEqual({ ok: false, why: 'disabled' });
        expect(panel.register).not.toHaveBeenCalled();
        expect(document.body.classList.contains(Bridge.HIDE_CLASS)).toBe(false);
    });
});
