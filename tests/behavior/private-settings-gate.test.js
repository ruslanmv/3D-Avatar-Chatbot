/**
 * Settings-side Private gate.
 *
 * Turning the preference on may request trusted verification, but `isEnabled()` remains false
 * until adultVerified and the repository's existing ConsentFlow are both ready. VERIFYING is
 * shown only after a request was really sent; missing/disconnected verification immediately
 * returns the switch to OFF. Verification loss turns the preference OFF rather than silently
 * restoring it on reconnect.
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

function loadGate({ verified = false, connected = true, storedEnabled = false } = {}) {
    jest.resetModules();
    localStorage.clear();
    localStorage.setItem('nexus_spicy_verified', 'true');
    localStorage.setItem('nexus_spicy_enabled', storedEnabled ? 'true' : 'false');
    document.body.innerHTML = `
        <section class="config-section">
            <div class="config-title">PRIVATE MODE <span id="spicy-status-label">OFF</span></div>
            <p></p>
            <label class="spicy-toggle-label"><span>Enable</span><input id="spicy-mode-toggle" type="checkbox"><span class="spicy-toggle-slider"></span></label>
        </section>`;

    const flow = adultFlow();
    const director = {
        blackboard: { adultVerified: verified, nsfwAllowed: false },
        adult: verified ? flow : null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
        modes: {},
        clips: null,
        adapters: [],
        session: { connected, send: jest.fn(() => connected) },
    };
    window.NEXUS_BD = director;
    window.NEXUS_BD_CONSENT_FLOW = { attach: jest.fn(() => flow) };
    window.NEXUS_BD_PROFILE_ADULT = { id: 'adult' };
    window.NEXUS_BD_SAY = jest.fn();

    require('../../src/SpicyGate.js');
    return { gate: window.NEXUS_SPICY, director, flow };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD;
    delete window.NEXUS_BD_CONSENT_FLOW;
    delete window.NEXUS_BD_PROFILE_ADULT;
    delete window.NEXUS_BD_SAY;
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
});

describe('Private Settings gate', () => {
    test('turning ON requests trusted verification but does not report Private as enabled while unverified', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(true);
        expect(done).not.toHaveBeenCalled();
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
    });

    test('a disconnected verification service never enters VERIFYING or persists an eventual-on preference', () => {
        const s = loadGate({ verified: false, connected: false });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.director.session.send).not.toHaveBeenCalled();
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(done).toHaveBeenCalledWith(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');
        expect(document.querySelector('.config-section').dataset.privateState).toBe('unavailable');
    });

    test('adult_ack plus the existing ConsentFlow makes the switch usable and only then reports ON', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();
        s.gate.setEnabled(true, done);

        s.director.blackboard.adultVerified = true;
        expect(s.gate.refresh()).toBe(true);

        expect(window.NEXUS_BD_CONSENT_FLOW.attach).toHaveBeenCalledTimes(1);
        expect(s.director.adult).toBe(s.flow);
        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(done).toHaveBeenCalledWith(true);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
    });

    test('trusted verification alone does not enable Private when the local setting is OFF', () => {
        const s = loadGate({ verified: true, connected: true });

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(false);
    });

    test('verification loss after Private was usable turns the preference OFF and never silently restores it', () => {
        const s = loadGate({ verified: true, connected: true });
        s.gate.setEnabled(true);
        expect(s.gate.isEnabled()).toBe(true);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');

        s.director.blackboard.adultVerified = false;
        expect(s.gate.refresh()).toBe(false);
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');

        s.director.blackboard.adultVerified = true;
        s.director.adult = s.flow;
        expect(s.gate.refresh()).toBe(false);
        expect(s.gate.isEnabled()).toBe(false);
    });

    test('verification timeout returns the Settings switch to OFF instead of leaving an eventual-on preference', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();
        s.gate.setEnabled(true, done);

        jest.advanceTimersByTime(10500);

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(done).toHaveBeenCalledWith(false);
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');
    });

    test('reload never restores a stale enabled bit into VERIFYING before a trusted session exists', () => {
        const s = loadGate({ verified: false, connected: false, storedEnabled: true });

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(s.director.session.send).not.toHaveBeenCalled();
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');
    });
});
