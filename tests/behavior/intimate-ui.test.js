/**
 * Private/Intimate Together UI gate.
 *
 * The consumer-facing tile is deliberately ordinary-sized. Its visibility is controlled by
 * the user's explicit Private Mode setting, while actually starting the adult experience
 * still requires deployment capability, trusted session verification and the existing
 * ConsentFlow. This keeps the Settings switch visibly useful without weakening the gate.
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

function director({ enabled = true, verified = true, available = true, withAdult = true } = {}) {
    const p = panel();
    const spicy = spicyGate(enabled);
    const adult = withAdult ? new AdultFlowMock() : null;
    const b = bus();
    const d = {
        config: { adult: { available } },
        blackboard: { adultVerified: verified },
        adult,
        bus: b,
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
    document.body.innerHTML = '';
});

afterEach(() => {
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
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

    test('starting still requires deployment flag, trusted verification, flow, and preference', () => {
        const adult = new AdultFlowMock();
        const spicy = { isEnabled: () => true };
        const base = { config: { adult: { available: true } }, adult, blackboard: { adultVerified: true } };

        expect(eligibility(base, spicy).ok).toBe(true);
        expect(eligibility({ ...base, config: { adult: { available: false } } }, spicy).ok).toBe(false);
        expect(eligibility({ ...base, blackboard: { adultVerified: false } }, spicy).ok).toBe(false);
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

        bridge.detach();
    });

    test('shows and hides the same-sized Private tile dynamically on desktop/mobile shared chooser', () => {
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

        setup.spicy.set(false);
        tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).toBeNull();
        expect(setup.panel.activities.has('intimate')).toBe(false);

        bridge.detach();
    });

    test('unverified users only see neutral locked copy, not the adult presets', () => {
        const setup = director({ enabled: true, verified: false, available: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        const activity = setup.panel.activities.get('intimate');

        expect(activity).toBeTruthy();
        expect(activity.inputs()).toEqual([
            expect.objectContaining({
                id: 'private-locked',
                label: 'Private Mode',
                note: 'Available after trusted adult verification.',
            }),
        ]);

        bridge.detach();
    });

    test('trusted verification loss keeps the neutral tile but removes access to presets', () => {
        const setup = director({ enabled: true, verified: true, available: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        const activity = setup.panel.activities.get('intimate');

        expect(activity.inputs().map((input) => input.id)).toEqual(['affectionate', 'romantic', 'sensual']);

        setup.director.blackboard.adultVerified = false;
        bridge.sync();

        expect(setup.panel.activities.has('intimate')).toBe(true);
        expect(activity.inputs().map((input) => input.id)).toEqual(['private-locked']);

        bridge.detach();
    });
});

describe('Private activity contract', () => {
    test('blocked starts fail before the adult flow can enter', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: false, why: 'trusted adult verification is not present' }),
            bus: bus(),
        });

        expect(activity.inputs().map((input) => input.id)).toEqual(['private-locked']);
        const result = await activity.start({ input: { id: 'romantic' } });
        expect(result).toEqual({ ok: false, why: 'trusted adult verification is not present' });
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
