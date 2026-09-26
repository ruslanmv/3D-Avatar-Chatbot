/**
 * W10. Private mode in Try-On.
 *
 * Private mode says the person is an adult. Wardrobe Forge's operator says, per avatar,
 * whether the avatar depicts one. Private outfits open only when both are true; otherwise
 * Try-On says why rather than offering buttons Forge would refuse.
 */
const Private = require('../../src/wardrobe/TryOnPrivate.js');
const TryOn = require('../../src/wardrobe/TryOnHaulActivity.js');
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Identity = require('../../src/wardrobe/AvatarIdentity.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');

const SAMPLE_A = Identity.resolve({ url: 'vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A' });
const DECLARED = [{ slug: 'avatar-sample-a', depictsAdult: true, declaredBy: 'operator' }];
const UNDECLARED = [{ slug: 'avatar-sample-a', depictsAdult: false }];

describe('TryOnPrivate.evaluate', () => {
    test('private mode off: nothing private is offered, whatever the avatar', () => {
        expect(
            Private.evaluate({ privateOn: false, identity: SAMPLE_A, published: DECLARED, canCreate: true })
        ).toEqual({
            mode: 'off',
        });
    });

    test('private mode on and the avatar declared adult by Forge’s operator: open, with picks', () => {
        const state = Private.evaluate({ privateOn: true, identity: SAMPLE_A, published: DECLARED, canCreate: true });
        expect(state.mode).toBe('open');
        expect(state.picks.map((pick) => pick.label)).toContain('Lace lingerie');
    });

    test('private mode on but the avatar not declared adult: locked, and says why', () => {
        const state = Private.evaluate({ privateOn: true, identity: SAMPLE_A, published: UNDECLARED, canCreate: true });
        expect(state).toMatchObject({ mode: 'locked', why: expect.stringMatching(/not declared this avatar adult/) });
        const named = Private.evaluate({
            privateOn: true,
            identity: Object.assign({}, SAMPLE_A, { name: 'AvatarSample_A.vrm' }),
            published: [{ slug: 'avatar-sample-a', name: 'AvatarSample A', depictsAdult: false }],
            canCreate: true,
        });
        expect(named.why).toMatch(/for AvatarSample A:/);
    });

    test('an avatar Forge does not hold, Forge unreachable, or no Forge at all: locked with the reason', () => {
        const external = Identity.resolve({ url: 'uploads/mine.vrm', name: 'Mine' });
        expect(
            Private.evaluate({ privateOn: true, identity: external, published: DECLARED, canCreate: true }).why
        ).toMatch(/Mine is not one of them/);
        expect(Private.evaluate({ privateOn: true, identity: SAMPLE_A, published: null, canCreate: true }).why).toMatch(
            /can’t be reached/
        );
        expect(
            Private.evaluate({ privateOn: true, identity: SAMPLE_A, published: DECLARED, canCreate: false }).why
        ).toMatch(/not connected/);
    });

    test('privateOn reads NEXUS_SPICY.isEnabled() and never throws', () => {
        expect(Private.privateOn({ NEXUS_SPICY: { isEnabled: () => true } })).toBe(true);
        expect(Private.privateOn({ NEXUS_SPICY: { isEnabled: () => false } })).toBe(false);
        expect(
            Private.privateOn({
                NEXUS_SPICY: {
                    isEnabled: () => {
                        throw new Error('x');
                    },
                },
            })
        ).toBe(false);
        expect(Private.privateOn({})).toBe(false);
    });
});

describe('Try-On follows private mode', () => {
    function gate(on) {
        const listeners = [];
        return {
            on,
            isEnabled() {
                return this.on;
            },
            onChange(fn) {
                listeners.push(fn);
                return () => listeners.splice(listeners.indexOf(fn), 1);
            },
            set(value) {
                this.on = value;
                listeners.slice().forEach((fn) => fn(value));
            },
            listeners,
        };
    }

    function start(spicy, published) {
        document.body.innerHTML = '<div class="avatar-card"><div id="nexus-bd-together-panel" hidden></div></div>';
        const controller = {
            original: { url: 'vendor/avatars/AvatarSample_A.vrm', name: 'AvatarSample A' },
            avatarManager: { getCurrent: () => controller.original },
            applyLook: jest.fn(async (look) => look),
            restore: jest.fn(async () => true),
        };
        const created = [];
        class FakeGenerator {
            constructor() {
                this.library = { library: async () => published };
            }
            availability() {
                return { ok: true };
            }
            identity() {
                return SAMPLE_A;
            }
            async create(prompt) {
                created.push(prompt);
                return { id: 'p1', name: 'Private look', vrmUrl: 'https://f/p1.vrm' };
            }
        }
        const activity = TryOn.create({
            wardrobe: { service: { controller, staticSource: null }, config: {} },
            doc: document,
            Session: TryOnSession,
            View: TryOnView,
            Generator: FakeGenerator,
            Identity,
            Reasons,
            Private,
            spicy,
        });
        return { activity, created };
    }

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    test('with private mode on and a declared avatar, the picks are there and make a look', async () => {
        const { activity, created } = start(gate(true), DECLARED);
        await activity.start({});
        await flush();
        const pick = document.querySelector('.nexus-try-on-pick');
        expect(pick.textContent).toBe('Lace lingerie');
        pick.click();
        await flush();
        expect(created).toEqual(['black lace lingerie set']);
    });

    test('with private mode on and an undeclared avatar, a sentence and no picks', async () => {
        const { activity } = start(gate(true), UNDECLARED);
        await activity.start({});
        await flush();
        expect(document.querySelector('.nexus-try-on-pick')).toBeNull();
        expect(document.querySelector('.nexus-try-on-private').textContent).toMatch(/not declared this avatar adult/);
    });

    test('switching private mode in Settings updates an open Try-On, and closing it stops listening', async () => {
        const spicy = gate(false);
        const { activity } = start(spicy, DECLARED);
        await activity.start({});
        await flush();
        expect(document.querySelector('.nexus-try-on-private')).toBeNull();
        spicy.set(true);
        await flush();
        expect(document.querySelector('.nexus-try-on-pick')).not.toBeNull();
        spicy.set(false);
        await flush();
        expect(document.querySelector('.nexus-try-on-private')).toBeNull();
        activity.stop('user');
        await flush();
        expect(spicy.listeners).toHaveLength(0);
    });
});

describe('against the real SpicyGate, not a fake', () => {
    // The fakes above were once written with the method name this module *assumed*, and
    // passed while the real page never saw private mode. This loads src/SpicyGate.js itself.
    afterEach(() => {
        jest.useRealTimers();
        delete window.NEXUS_SPICY;
        delete window.NEXUS_BD;
        localStorage.clear();
    });

    function loadRealGate(on) {
        jest.useFakeTimers();
        jest.resetModules();
        localStorage.clear();
        localStorage.setItem('nexus_spicy_verified', 'true');
        localStorage.setItem('nexus_spicy_enabled', on ? 'true' : 'false');
        document.body.innerHTML =
            '<section class="config-section"><span id="spicy-status-label">OFF</span>' +
            '<input id="spicy-mode-toggle" type="checkbox"></section>';
        window.NEXUS_BD = {
            blackboard: {},
            bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
            modes: {},
            adapters: [],
            session: { connected: false, send: jest.fn(() => false) },
        };
        window.NEXUS_BD_CONSENT_FLOW = { attach: jest.fn(() => ({ active: false, profile: {} })) };
        window.NEXUS_BD_PROFILE_ADULT = { id: 'adult', requires: ['adultVerified'] };
        window.NEXUS_BD_SAY = jest.fn();
        require('../../src/SpicyGate.js');
        return window.NEXUS_SPICY;
    }

    test('privateOn agrees with the gate the Settings switch drives', () => {
        const gate = loadRealGate(true);
        jest.advanceTimersByTime(1000);
        expect(gate.isEnabled()).toBe(true);
        expect(Private.privateOn(window)).toBe(true);

        gate.setEnabled(false);
        expect(Private.privateOn(window)).toBe(false);
    });

    test('a device that never turned private mode on gets nothing private', () => {
        loadRealGate(false);
        jest.advanceTimersByTime(1000);
        expect(Private.privateOn(window)).toBe(false);
    });
});
