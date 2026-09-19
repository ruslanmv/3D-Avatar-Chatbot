/**
 * Settings-side Private gate.
 *
 * Accepting the adult confirmation is the complete gate: it must not depend on HomePilot,
 * a socket, or a second server acknowledgement. ConsentFlow still gates each experience.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

function adultFlow() {
    return {
        active: false,
        profile: { escalation: { levels: 4 } },
        enter: jest.fn(() => ({ ok: true, why: 'entered', level: 1 })),
        exit: jest.fn(() => ({ ok: true, kind: 'hard', level: 1 })),
    };
}

function loadGate({ storedEnabled = false, acknowledged = true, connected = false } = {}) {
    jest.resetModules();
    localStorage.clear();
    localStorage.setItem('nexus_spicy_verified', acknowledged ? 'true' : 'false');
    localStorage.setItem('nexus_spicy_enabled', storedEnabled ? 'true' : 'false');
    document.body.innerHTML = `
        <section class="config-section">
            <div class="config-title">PRIVATE MODE <span id="spicy-status-label">OFF</span></div>
            <p></p>
            <div class="input-group">
                <label class="spicy-toggle-label"><span>Enable</span><input id="spicy-mode-toggle" type="checkbox"><span class="spicy-toggle-slider"></span></label>
            </div>
        </section>`;

    const flow = adultFlow();
    const session = {
        connected,
        socket: connected ? {} : null,
        send: jest.fn(() => connected),
    };
    const director = {
        blackboard: { adultVerified: false, nsfwAllowed: false },
        adult: null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
        modes: {},
        clips: null,
        adapters: [],
        session,
    };
    window.NEXUS_BD = director;
    window.NEXUS_BD_CONSENT_FLOW = { attach: jest.fn(() => flow) };
    window.NEXUS_BD_PROFILE_ADULT = { id: 'adult', requires: ['adultVerified', 'nsfwAllowed'] };
    window.NEXUS_BD_SAY = jest.fn();

    require('../../src/SpicyGate.js');
    return { gate: window.NEXUS_SPICY, director, flow, session };
}

beforeEach(() => {
    jest.useFakeTimers();
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_CONSENT_FLOW;
    delete window.NEXUS_BD_PROFILE_ADULT;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_BD_BRIDGE_DISCOVERY;
});

afterEach(() => {
    window.dispatchEvent(new Event('beforeunload'));
    jest.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_CONSENT_FLOW;
    delete window.NEXUS_BD_PROFILE_ADULT;
    delete window.NEXUS_BD_SAY;
    delete window.NEXUS_BD_BRIDGE_DISCOVERY;
});

describe('Private Settings gate', () => {
    test('accepting the Settings confirmation enables Private immediately without a service', () => {
        const s = loadGate({ acknowledged: false, connected: false });
        const toggle = document.getElementById('spicy-mode-toggle');

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));

        const overlay = document.querySelector('.spicy-age-overlay');
        expect(overlay).not.toBeNull();
        overlay.querySelector('#spicy-age-consent').click();
        overlay.querySelector('#spicy-age-confirm').click();

        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(s.gate.isConnecting()).toBe(false);
        expect(s.session.send).not.toHaveBeenCalled();
        expect(toggle.checked).toBe(true);
        expect(toggle.disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
        expect(document.getElementById('spicy-verification-status').textContent).toBe('Private Mode is enabled.');
        expect(document.querySelector('.config-section').dataset.privateState).toBe('on');
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(localStorage.getItem('nexus_spicy_verified')).toBe('true');
    });

    test('programmatic enable completes immediately after conditions were already accepted', () => {
        const s = loadGate({ acknowledged: true, connected: false });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.gate.isEnabled()).toBe(true);
        expect(done).toHaveBeenCalledWith(true);
        expect(s.session.send).not.toHaveBeenCalled();
    });

    test('the local ConsentFlow profile does not require a second adult acknowledgement', () => {
        const s = loadGate({ acknowledged: true });

        s.gate.setEnabled(true);

        expect(window.NEXUS_BD_CONSENT_FLOW.attach).toHaveBeenCalledTimes(1);
        const options = window.NEXUS_BD_CONSENT_FLOW.attach.mock.calls[0][0];
        expect(options.profile.requires).toEqual(['nsfwAllowed']);
        expect(window.NEXUS_BD_PROFILE_ADULT.requires).toEqual(['adultVerified', 'nsfwAllowed']);
        expect(s.director.adult).toBe(s.flow);
    });

    test('losing a server acknowledgement does not disable an accepted local gate', () => {
        const s = loadGate({ acknowledged: true, connected: true });
        s.director.blackboard.adultVerified = true;
        s.gate.setEnabled(true);
        s.director.blackboard.adultVerified = false;

        expect(s.gate.refresh()).toBe(true);
        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(s.session.send).not.toHaveBeenCalled();
        expect(document.getElementById('spicy-verification-status').textContent).toBe('Private Mode is enabled.');
    });

    test('reload restores an accepted ON gate without connecting or re-verifying', () => {
        const s = loadGate({ storedEnabled: true, acknowledged: true, connected: false });

        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(s.gate.isConnecting()).toBe(false);
        expect(s.session.send).not.toHaveBeenCalled();
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-verification-status').textContent).toBe('Private Mode is enabled.');
    });

    test('only an explicit OFF action clears the accepted preference', () => {
        const s = loadGate({ acknowledged: true });
        s.gate.setEnabled(true);

        s.gate.setEnabled(false);

        expect(s.gate.isRequested()).toBe(false);
        expect(s.gate.isEnabled()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');
        expect(document.getElementById('spicy-verification-status').hidden).toBe(true);
    });
});
