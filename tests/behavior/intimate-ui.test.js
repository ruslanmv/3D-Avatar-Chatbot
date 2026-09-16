/**
 * Private/Intimate Together UI gate.
 *
 * The consumer-facing tile is ordinary-sized. Its visibility follows the user's explicit
 * Private Mode setting. Starting a mature experience still requires trusted session
 * verification and the existing ConsentFlow. The shipped static adult.available flag may
 * stay false: a positive server adult_ack allows that flow to be attached lazily.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

function consentMachine() {
    return {
        state: 'idle',
        onChange() {
            return () => {};
        },
        revoke() {
            this.state = 'idle';
            return true;
        },
    };
}

function panel() {
    document.body.innerHTML = '<div id="host"></div>';
    const p = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
    p.mount(document.getElementById('host'));
    return p;
}

function spicyGate(initial = false) {
    let enabled = initial;
    const listeners = [];
    return {
        isEnabled: () => enabled,
        set(value) {
            enabled = !!value;
            for (const listener of [...listeners]) listener(enabled);
        },
        onChange(listener) {
            listeners.push(listener);
            return () => {
                const index = listeners.indexOf(listener);
                if (index >= 0) listeners.splice(index, 1);
            };
        },
    };
}

function bus() {
    return {
        emit: jest.fn(),
        on: jest.fn(() => () => {}),
    };
}

class AdultFlowMock {
    constructor() {
        this.active = false;
        this.profile = { escalation: { levels: 4 } };
        this.enter = jest.fn(() => {
            this.active = true;
            return { ok: true, why: 'entered', level: 1 };
        });
        this.exit = jest.fn(() => {
            this.active = false;
            return { ok: true, kind: 'hard', level: 1 };
        });
    }

    get maxLevel() {
        return 4;
    }
}

function director({ enabled = true, verified = true, available = false, withAdult = true, connected = true } = {}) {
    const p = panel();
    const spicy = spicyGate(enabled);
    const adult = withAdult ? new AdultFlowMock() : null;
    const b = bus();
    const d = {
        config: { adult: { available } },
        blackboard: { adultVerified: verified, nsfwAllowed: false },
        adult,
        bus: b,
        modes: {},
        clips: null,
        adapters: [],
        session: {
            connected,
            send: jest.fn(() => connected),
        },
        togetherPanel: p,
        intimate: null,
    };
    window.NEXUS_SPICY = spicy;
    window.NEXUS_BD = d;
    return { director: d, panel: p, spicy, adult, bus: b };
}

beforeEach(() => {
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD_CONSENT_FLOW;
    delete window.NEXUS_BD_PROFILE_ADULT;
    delete window.NEXUS_BD_SAY;
    document.body.innerHTML = '';
});

afterEach(() => {
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD_CONSENT_FLOW;
    delete window.NEXUS_BD_PROFILE_ADULT;
    delete window.NEXUS_BD_SAY;
    document.body.innerHTML = '';
});

describe('Private visibility vs adult eligibility', () => {
    const eligibility = PlaygroundActivity.IntimateActivity.eligibility;
    const visibility = PlaygroundActivity.IntimateActivity.visibility;

    test('Private tile visibility follows only the explicit Settings preference', () => {
        expect(visibility({ isEnabled: () => true }).ok).toBe(true);
        expect(visibility({ isEnabled: () => false }).ok).toBe(false);
        expect(visibility(null).ok).toBe(false);
    });

    test('runtime eligibility requires trusted verification, a consent flow, and the preference — not the static boot flag', () => {
        const adult = new AdultFlowMock();
        const spicy = { isEnabled: () => true };
        const base = {
            config: { adult: { available: false } },
            adult,
            blackboard: { adultVerified: true, nsfwAllowed: true },
        };

        expect(eligibility(base, spicy).ok).toBe(true);
        expect(eligibility({ ...base, blackboard: { adultVerified: false, nsfwAllowed: true } }, spicy).ok).toBe(false);
        expect(eligibility({ ...base, adult: null }, spicy).ok).toBe(false);
        expect(eligibility(base, { isEnabled: () => false }).ok).toBe(false);
    });
});

describe('Private tile bridge', () => {
    test('is absent while Private Mode is off', () => {
        const setup = director({ enabled: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        setup.panel.open();

        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(setup.panel.activities.has('intimate')).toBe(false);
        expect(setup.director.blackboard.nsfwAllowed).toBe(false);

        bridge.detach();
    });

    test('shows and hides the same-sized Private tile dynamically on the shared desktop/mobile chooser', () => {
        const setup = director({ enabled: false, verified: false, available: false, withAdult: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });

        setup.spicy.set(true);
        setup.panel.open();
        let tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).not.toBeNull();
        expect(tile.classList.contains('nexus-bd-together-tile')).toBe(true);
        expect(tile.classList.contains('is-wide')).toBe(false);
        expect(tile.textContent).toContain('Private');
        expect(setup.panel.activities.has('intimate')).toBe(true);
        expect(setup.director.blackboard.nsfwAllowed).toBe(true);

        setup.spicy.set(false);
        tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).toBeNull();
        expect(setup.panel.activities.has('intimate')).toBe(false);
        expect(setup.director.blackboard.nsfwAllowed).toBe(false);

        bridge.detach();
    });

    test('requests trusted verification from the connected session when Private is enabled', () => {
        const setup = director({ enabled: true, verified: false, available: false, withAdult: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });

        expect(setup.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(setup.director.blackboard.adultVerified).toBe(false);

        bridge.detach();
    });

    test('unverified users stay on a neutral waiting setup instead of the generic failure screen', () => {
        const setup = director({ enabled: true, verified: false, available: false, withAdult: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        setup.panel.open();

        const result = setup.panel.choose('intimate');
        const activity = setup.panel.activities.get('intimate');

        expect(result).toEqual({ ok: true, why: 'setup' });
        expect(activity.inputs()).toEqual([]);
        expect(setup.panel.view).toBe('setup');
        expect(setup.panel.root.textContent).toContain('Checking trusted adult verification');
        expect(setup.panel.root.textContent).not.toContain('could not start');
        expect(setup.panel.root.textContent).not.toContain('Try again');
        expect(setup.panel.root.textContent).not.toContain('Affectionate');
        expect(setup.panel.root.textContent).not.toContain('Romantic');
        expect(setup.panel.root.textContent).not.toContain('Sensual');

        bridge.detach();
    });

    test('a server-authored verification can lazily attach the existing flow even though adult.available stays false', () => {
        const setup = director({ enabled: true, verified: true, available: false, withAdult: false });
        const lazyAdult = new AdultFlowMock();
        window.NEXUS_BD_CONSENT_FLOW = { attach: jest.fn(() => lazyAdult) };
        window.NEXUS_BD_PROFILE_ADULT = { id: 'adult' };

        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        const activity = setup.panel.activities.get('intimate');

        expect(window.NEXUS_BD_CONSENT_FLOW.attach).toHaveBeenCalledTimes(1);
        expect(setup.director.adult).toBe(lazyAdult);
        expect(activity.adult).toBe(lazyAdult);
        expect(activity.inputs().map((input) => input.id)).toEqual(['affectionate', 'romantic', 'sensual']);
        expect(setup.director.config.adult.available).toBe(false);

        bridge.detach();
    });

    test('losing trusted verification removes preset access and stops an active Private experience', async () => {
        const setup = director({ enabled: true, verified: true, available: false, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        const activity = setup.panel.activities.get('intimate');

        expect(activity.inputs().map((input) => input.id)).toEqual(['affectionate', 'romantic', 'sensual']);
        await setup.panel.startActivity('intimate', { id: 'romantic' });
        expect(setup.panel.activeActivity).toBe('intimate');

        setup.director.blackboard.adultVerified = false;
        bridge.sync();

        expect(setup.panel.activities.has('intimate')).toBe(true);
        expect(activity.inputs()).toEqual([]);
        expect(setup.panel.activeActivity).toBeNull();
        expect(setup.adult.exit).toHaveBeenCalledTimes(1);

        bridge.detach();
    });
});

describe('Private activity contract', () => {
    test('blocked starts fail before the adult flow can enter', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: false, why: 'trusted adult verification is not ready yet' }),
            bus: bus(),
        });

        expect(activity.inputs()).toEqual([]);
        const result = await activity.start({ input: { id: 'romantic' } });
        expect(result).toEqual({ ok: false, why: 'trusted adult verification is not ready yet' });
        expect(adult.enter).not.toHaveBeenCalled();
    });

    test('uses Affectionate/Romantic/Sensual as ceilings and restores the adult flow afterwards', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: true, why: '' }),
            bus: bus(),
        });

        expect(activity.__contract).toBe(true);
        expect(activity.id).toBe('intimate');
        expect(activity.title).toBe('Private');
        expect(activity.order).toBe(85);
        expect(activity.inputs().map((input) => [input.id, input.maxLevel])).toEqual([
            ['affectionate', 1],
            ['romantic', 2],
            ['sensual', 3],
        ]);

        const started = await activity.start({ input: { id: 'romantic' } });
        expect(started).toEqual(expect.objectContaining({ ok: true, preset: 'romantic', maxLevel: 2 }));
        expect(adult.enter).toHaveBeenCalledTimes(1);
        expect(adult.maxLevel).toBe(2);
        expect(activity.status()).toEqual({ label: 'Romantic', detail: 'Private' });

        expect(activity.stop('user')).toBe(true);
        expect(adult.exit).toHaveBeenCalledTimes(1);
        expect(adult.maxLevel).toBe(4);
        expect(activity.status()).toBeNull();
    });
});
