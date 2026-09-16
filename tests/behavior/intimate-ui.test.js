/**
 * Intimate Together UI gate.
 *
 * The consumer-facing tile is deliberately ordinary-sized and deliberately absent until
 * three independent facts are true: deployment capability, trusted session verification,
 * and the user's existing NEXUS_SPICY preference. The bridge must also remove/stop the tile
 * immediately when that preference is turned off.
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

function director({ enabled = true, verified = true, available = true } = {}) {
    const p = panel();
    const spicy = spicyGate(enabled);
    const adult = new AdultFlowMock();
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

describe('Intimate eligibility', () => {
    const eligibility = PlaygroundActivity.IntimateActivity.eligibility;

    test('requires deployment flag, trusted verification, and the existing local preference', () => {
        const adult = new AdultFlowMock();
        const spicy = { isEnabled: () => true };
        const base = { config: { adult: { available: true } }, adult, blackboard: { adultVerified: true } };

        expect(eligibility(base, spicy).ok).toBe(true);
        expect(eligibility({ ...base, config: { adult: { available: false } } }, spicy).ok).toBe(false);
        expect(eligibility({ ...base, blackboard: { adultVerified: false } }, spicy).ok).toBe(false);
        expect(eligibility(base, { isEnabled: () => false }).ok).toBe(false);
    });
});

describe('Intimate tile bridge', () => {
    test('does not advertise Intimate while the Settings preference is off', () => {
        const setup = director({ enabled: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        setup.panel.open();

        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(setup.panel.activities.has('intimate')).toBe(false);

        bridge.detach();
    });

    test('shows and hides the same-sized tile dynamically when the Settings preference changes', () => {
        const setup = director({ enabled: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });

        setup.spicy.set(true);
        setup.panel.open();
        let tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).not.toBeNull();
        expect(tile.classList.contains('nexus-bd-together-tile')).toBe(true);
        expect(tile.classList.contains('is-wide')).toBe(false);
        expect(tile.textContent).toContain('Intimate');

        setup.spicy.set(false);
        tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).toBeNull();
        expect(setup.panel.activities.has('intimate')).toBe(false);

        bridge.detach();
    });

    test('trusted verification is also live: losing it removes the tile on the next sync', () => {
        const setup = director({ enabled: true, verified: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: setup.bus });
        expect(setup.panel.activities.has('intimate')).toBe(true);

        setup.director.blackboard.adultVerified = false;
        bridge.sync();
        expect(setup.panel.activities.has('intimate')).toBe(false);

        bridge.detach();
    });
});

describe('Intimate activity contract', () => {
    test('uses Affectionate/Romantic/Sensual as ceilings and restores the adult flow afterwards', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: true, why: '' }),
            bus: bus(),
        });

        expect(activity.__contract).toBe(true);
        expect(activity.id).toBe('intimate');
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
