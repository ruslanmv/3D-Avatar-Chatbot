/**
 * Private / Together availability contract.
 *
 * Product invariant: if the Private tile is visible, it is already usable. Verification is a
 * Settings concern; Together never exposes a locked destination or a verification/waiting page.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');

function consentMachine() {
    return {
        state: 'idle',
        onChange() { return () => {}; },
        revoke() { this.state = 'idle'; return true; },
    };
}

function panel() {
    document.body.innerHTML = '<div id="host"></div>';
    const p = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
    p.mount(document.getElementById('host'));
    return p;
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

    get maxLevel() { return 4; }
}

/**
 * Test double for the NEW Settings contract: requested preference and actual usability are
 * separate. `onChange` reports the user's request so the bridge can repaint/request verification;
 * `isEnabled` reports only the usable state and therefore controls tile visibility.
 */
function privateGate(initialRequested = false) {
    let requested = initialRequested;
    let director = null;
    const listeners = [];
    return {
        bind(d) { director = d; return this; },
        isEnabled() {
            return Boolean(
                requested
                && director
                && director.blackboard
                && director.blackboard.adultVerified === true
                && director.adult
                && typeof director.adult.enter === 'function'
            );
        },
        isRequested() { return requested; },
        set(value) {
            requested = Boolean(value);
            for (const listener of [...listeners]) listener(requested);
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

function setup({ requested = true, verified = true, withAdult = true, connected = true } = {}) {
    const p = panel();
    const adult = withAdult ? new AdultFlowMock() : null;
    const b = bus();
    const d = {
        config: { adult: { available: false } },
        blackboard: { adultVerified: verified, nsfwAllowed: false },
        adult,
        bus: b,
        modes: {},
        clips: null,
        adapters: [],
        session: { connected, send: jest.fn(() => connected) },
        togetherPanel: p,
        intimate: null,
    };
    const spicy = privateGate(requested).bind(d);
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

describe('Private runtime eligibility', () => {
    const eligibility = PlaygroundActivity.IntimateActivity.eligibility;

    test('requires the usable Settings gate, trusted verification and the existing consent flow', () => {
        const adult = new AdultFlowMock();
        const base = {
            config: { adult: { available: false } },
            adult,
            blackboard: { adultVerified: true, nsfwAllowed: true },
        };

        expect(eligibility(base, { isEnabled: () => true }).ok).toBe(true);
        expect(eligibility({ ...base, blackboard: { adultVerified: false, nsfwAllowed: true } }, { isEnabled: () => true }).ok).toBe(false);
        expect(eligibility({ ...base, adult: null }, { isEnabled: () => true }).ok).toBe(false);
        expect(eligibility(base, { isEnabled: () => false }).ok).toBe(false);
    });
});

describe('Private tile invariant', () => {
    test('Private Mode OFF means no registered activity, tile, or verification UI in Together', () => {
        const s = setup({ requested: false, verified: true, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        s.panel.open();

        expect(s.panel.activities.has('intimate')).toBe(false);
        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(s.panel.root.textContent).not.toContain('Checking trusted adult verification');
        expect(s.director.blackboard.nsfwAllowed).toBe(false);

        bridge.detach();
    });

    test('a requested preference remains invisible while trusted verification is not ready', () => {
        const s = setup({ requested: true, verified: false, withAdult: false });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        s.panel.open();

        expect(s.spicy.isRequested()).toBe(true);
        expect(s.spicy.isEnabled()).toBe(false);
        expect(s.panel.activities.has('intimate')).toBe(false);
        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(s.panel.root.textContent).not.toContain('Checking trusted adult verification');
        expect(s.panel.root.textContent).not.toContain('Preparing Private Mode');
        expect(s.director.blackboard.nsfwAllowed).toBe(false);

        bridge.detach();
    });

    test('trusted verification alone does not expose Private when Settings is OFF', () => {
        const s = setup({ requested: false, verified: true, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        s.panel.open();

        expect(s.panel.activities.has('intimate')).toBe(false);
        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();

        bridge.detach();
    });

    test('when Private is visible it is immediately usable and shows all three presets', () => {
        const s = setup({ requested: true, verified: true, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        s.panel.open();

        const tile = document.querySelector('[data-activity="intimate"]');
        expect(tile).not.toBeNull();
        expect(tile.classList.contains('nexus-bd-together-tile')).toBe(true);
        expect(tile.classList.contains('is-wide')).toBe(false);
        expect(s.panel.activities.has('intimate')).toBe(true);
        expect(s.director.blackboard.nsfwAllowed).toBe(true);

        const result = s.panel.choose('intimate');
        const activity = s.panel.activities.get('intimate');
        expect(result).toEqual({ ok: true, why: 'setup' });
        expect(activity.inputs().map((input) => input.id)).toEqual(['affectionate', 'romantic', 'sensual']);
        expect(s.panel.root.textContent).toContain('Affectionate');
        expect(s.panel.root.textContent).toContain('Romantic');
        expect(s.panel.root.textContent).toContain('Sensual');
        expect(s.panel.root.textContent).not.toContain('Checking trusted adult verification');

        bridge.detach();
    });

    test('switching Private Mode OFF stops an active session and removes every Private destination immediately', async () => {
        const s = setup({ requested: true, verified: true, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        await s.panel.startActivity('intimate', { id: 'romantic' });
        expect(s.panel.activeActivity).toBe('intimate');

        s.spicy.set(false);

        expect(s.panel.activeActivity).toBeNull();
        expect(s.panel.activities.has('intimate')).toBe(false);
        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(s.director.intimate).toBeNull();
        expect(s.adult.exit).toHaveBeenCalledTimes(1);
        expect(s.director.blackboard.nsfwAllowed).toBe(false);

        bridge.detach();
    });

    test('losing trusted verification stops Private and unregisters the tile instead of leaving a locked activity', async () => {
        const s = setup({ requested: true, verified: true, withAdult: true });
        const bridge = PlaygroundActivity.installIntimateBridge({ bus: s.bus });
        await s.panel.startActivity('intimate', { id: 'romantic' });
        expect(s.panel.activeActivity).toBe('intimate');

        s.director.blackboard.adultVerified = false;
        bridge.sync();

        expect(s.panel.activeActivity).toBeNull();
        expect(s.panel.activities.has('intimate')).toBe(false);
        expect(document.querySelector('[data-activity="intimate"]')).toBeNull();
        expect(s.director.intimate).toBeNull();
        expect(s.adult.exit).toHaveBeenCalledTimes(1);
        expect(s.panel.root.textContent).not.toContain('Checking trusted adult verification');
        expect(s.panel.root.textContent).not.toContain('Preparing Private Mode');

        bridge.detach();
    });
});

describe('Private activity contract', () => {
    test('blocked starts fail before the adult flow can enter', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: false, why: 'Private Mode is unavailable' }),
            bus: bus(),
        });

        expect(activity.inputs()).toEqual([]);
        const result = await activity.start({ input: { id: 'romantic' } });
        expect(result).toEqual({ ok: false, why: 'Private Mode is unavailable' });
        expect(adult.enter).not.toHaveBeenCalled();
    });

    test('uses Affectionate/Romantic/Sensual as ceilings and restores the adult flow afterwards', async () => {
        const adult = new AdultFlowMock();
        const activity = new PlaygroundActivity.IntimateActivity.Intimate({
            adult,
            capability: () => ({ ok: true, why: '' }),
            bus: bus(),
        });

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
