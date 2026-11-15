/**
 * GO1. The school is reachable from Private and is only ever General.
 *
 * Acceptance criteria, each a test:
 * - a player in Private can select and visit the school;
 * - the school loads with General interactions enforced (Private is stopped before the visit);
 * - direct links, saves and scene transitions enforce the same rule;
 * - no pending Private action continues inside the school (wear cancelled, Private's own stop);
 * - Private started at the school is ended; going to another place does not end it;
 * - a "General" badge is shown while the school is.
 */
const fs = require('fs');
const path = require('path');

const General = require('../src/features/together/GeneralOnlyPlaces.js');

const WORLDS = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/vr-worlds/worlds.json'), 'utf8')).worlds;

function bus() {
    const handlers = {};
    return {
        on(name, fn) {
            (handlers[name] = handlers[name] || []).push(fn);
            return () => (handlers[name] = handlers[name].filter((f) => f !== fn));
        },
        emit(name, payload) {
            (handlers[name] || []).forEach((fn) => fn(payload));
        },
    };
}

/** A page with Private running, the Together panel and a wardrobe controller, all recorded. */
function page({ privateOn = true } = {}) {
    const calls = [];
    const intimate = {
        active: privateOn,
        adult: { active: privateOn },
        stop: jest.fn((why) => {
            calls.push(['intimate.stop', why]);
            intimate.active = false;
            intimate.adult.active = false;
        }),
    };
    const panel = {
        active: privateOn ? 'intimate' : null,
        stopActivity: jest.fn((why) => {
            calls.push(['stopActivity', why]);
            if (panel.active === 'intimate') intimate.stop(why);
            panel.active = null;
        }),
        startActivity: jest.fn(async (id, input) => {
            calls.push(['startActivity', id, input && input.id, intimate.active]);
            panel.active = id;
            return { ok: true, why: input && input.id };
        }),
    };
    const controller = { cancel: jest.fn(() => calls.push(['wardrobe.cancel'])) };
    window.NEXUS_BD = { bus: bus(), intimate, togetherPanel: panel };
    window.NEXUS_WARDROBE = { service: { controller } };
    window.NEXUS_VR_WORLDS = { placesFor: jest.requireActual('../src/gltf-viewer/VRWorlds.js').placesFor };
    const guard = new General.GeneralOnlyPlaces({ win: window, worlds: WORLDS }).attach();
    guards.push(guard);
    return { guard, calls, intimate, panel, controller };
}

const guards = [];
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    guards.splice(0).forEach((g) => g.detach());
    document.body.innerHTML = '';
    delete window.NEXUS_BD;
    delete window.NEXUS_WARDROBE;
    delete window.NEXUS_VR_WORLDS;
});

describe('GO1 the catalogue', () => {
    test('the school and its light stand-in are general-only and general-rated places', () => {
        expect(General.isGeneralOnly(WORLDS, 'school')).toBe(true);
        expect(General.isGeneralOnly(WORLDS, 'school-light')).toBe(true);
        expect(General.placeOf(WORLDS, 'school-light')).toBe('school');
        const school = WORLDS.find((w) => w.id === 'school');
        expect(school.rating).toBe('general');
        expect(school.place).toBe(true);
        expect(General.isGeneralOnly(WORLDS, 'shopping-street')).toBe(false);
        expect(General.isGeneralOnly(WORLDS, 'hotel-bathroom')).toBe(false);
    });
});

describe('GO1 from Private', () => {
    test('the school is in Private’s destination list, marked general-only', () => {
        const { guard } = page();
        const list = guard.destinations(undefined, 'desktop');
        expect(list.map((p) => p.id)).toEqual(['school']);
        expect(list[0].generalOnly).toBe(true);
        expect(guard.destinations(undefined, 'mobile')[0].world).toBe('school-light');
    });

    test('choosing it ends Private first, cancels a pending wear, then visits it as a place', async () => {
        const { guard, calls, intimate, controller } = page();
        const result = await guard.leavePrivateFor('school');
        expect(result.ok).toBe(true);
        expect(controller.cancel).toHaveBeenCalled();
        const order = calls.map((c) => c[0]);
        expect(order.indexOf('wardrobe.cancel')).toBeLessThan(order.indexOf('stopActivity'));
        expect(order.indexOf('stopActivity')).toBeLessThan(order.indexOf('startActivity'));
        const start = calls.find((c) => c[0] === 'startActivity');
        expect(start.slice(1)).toEqual(['places', 'school', false]); // Private already off
        expect(intimate.active).toBe(false);
    });

    test('her invitation accepted (Private asks the renderer for the school) hands off the same way', async () => {
        const { calls } = page();
        window.dispatchEvent(new CustomEvent('nexus-world-request', { detail: { id: 'school', owner: 'intimate' } }));
        await flush();
        expect(calls.map((c) => c[0])).toEqual(['wardrobe.cancel', 'stopActivity', 'intimate.stop', 'startActivity']);
    });

    test('a light stand-in requested by Private visits the place it stands in for', async () => {
        const { calls } = page();
        window.dispatchEvent(
            new CustomEvent('nexus-world-request', { detail: { id: 'school-light', owner: 'intimate' } })
        );
        await flush();
        expect(calls.find((c) => c[0] === 'startActivity')[2]).toBe('school');
    });

    test('Private going to any other place is left alone', async () => {
        const { calls, intimate } = page();
        window.dispatchEvent(
            new CustomEvent('nexus-world-request', { detail: { id: 'hotel-suite', owner: 'intimate' } })
        );
        await flush();
        expect(calls).toEqual([]);
        expect(intimate.active).toBe(true);
    });
});

describe('GO1 links, saves and transitions', () => {
    test('the school shown with Private still running (a link, a saved visit) ends Private', async () => {
        const { calls, intimate } = page();
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school-light', base: 'school' } }));
        await flush();
        expect(intimate.active).toBe(false);
        expect(calls.map((c) => c[0])).toContain('wardrobe.cancel');
    });

    test('the school shown without Private changes nothing but the badge', async () => {
        const { calls } = page({ privateOn: false });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        await flush();
        expect(calls).toEqual([]);
        expect(document.getElementById(General.BADGE_ID).querySelector('span').textContent).toBe('General');
    });

    test('Private started at the school is ended; started on its way elsewhere it is not', async () => {
        const at = page({ privateOn: false });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        at.intimate.active = true;
        at.panel.active = 'intimate';
        window.NEXUS_BD.bus.emit('intimate:start', {});
        await flush();
        expect(at.intimate.active).toBe(false);

        at.guard.detach();
        const away = page({ privateOn: false });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        away.intimate.active = true;
        away.panel.active = 'intimate';
        window.NEXUS_BD.bus.emit('intimate:start', {});
        window.dispatchEvent(
            new CustomEvent('nexus-world-request', { detail: { id: 'hotel-suite', owner: 'intimate' } })
        );
        await flush();
        expect(away.intimate.active).toBe(true);
    });

    test('the badge goes with the school', () => {
        page({ privateOn: false });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        expect(document.getElementById(General.BADGE_ID)).not.toBeNull();
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'shopping-street' } }));
        expect(document.getElementById(General.BADGE_ID)).toBeNull();
    });
});

describe('GO1 previous location and the way back', () => {
    test('leaving Private for the school remembers where she was; Back visits it again', async () => {
        const { guard, calls, panel } = page();
        window.NEXUS_VIEWER = { vrWorlds: { activeId: 'cinema' } };
        await guard.leavePrivateFor('school');
        expect(guard.previous).toMatchObject({ world: 'cinema', place: 'cinema' });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        const back = document.querySelector('[data-action="general-back"]');
        expect(back.style.display).toBe('');
        calls.length = 0;
        const result = await guard.goBack();
        expect(result).toEqual({ ok: true, returnedTo: 'cinema' });
        expect(calls.map((c) => c.slice(0, 3))).toEqual([
            ['stopActivity', 'back'],
            ['startActivity', 'places', 'cinema'],
        ]);
        expect(panel.active).toBe('places');
        delete window.NEXUS_VIEWER;
    });

    test('a private room is not a place a visit can show: Back leaves the school and says so', async () => {
        const { guard } = page();
        window.NEXUS_VIEWER = { vrWorlds: { activeId: 'private-cabaret' } };
        await guard.leavePrivateFor('school');
        const result = await guard.goBack();
        expect(result).toEqual({ ok: true, returnedTo: null, privateRoom: true });
        delete window.NEXUS_VIEWER;
    });

    test('no Back button when there is nowhere to go back to', () => {
        page({ privateOn: false });
        window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail: { id: 'school' } }));
        expect(document.querySelector('[data-action="general-back"]').style.display).toBe('none');
    });

    test('the guard loads the catalogue itself when it has none (the page case)', async () => {
        const calls = [];
        const intimate = { active: true, adult: { active: true }, stop: () => (intimate.active = false) };
        const panel = {
            active: 'intimate',
            stopActivity: () => {
                intimate.stop();
                panel.active = null;
            },
            startActivity: async (id, input) => {
                calls.push([id, input.id]);
                return { ok: true };
            },
        };
        window.NEXUS_BD = { bus: bus(), intimate, togetherPanel: panel };
        window.NEXUS_VR_WORLDS = {
            // The page's loader drops `generalOnly` (it builds a fresh object per world): the
            // validated catalogue the page hands out has no such flag, and the guard must not need it.
            loadCatalogue: async () => ({ worlds: WORLDS.map(({ generalOnly, ...rest }) => rest) }),
            CATALOGUE_URL: 'assets/vr-worlds/worlds.json',
        };
        window.fetch = async () => ({ ok: true, json: async () => ({ worlds: WORLDS }) });
        const guard = new General.GeneralOnlyPlaces({ win: window }).attach();
        guards.push(guard);
        expect(guard.worlds).toBeNull();
        await guard.leavePrivateFor('school');
        expect(calls).toEqual([['places', 'school']]);
        expect(intimate.active).toBe(false);
        delete window.fetch;
    });
});
