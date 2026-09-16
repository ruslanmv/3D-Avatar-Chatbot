/**
 * Settings-side Private gate.
 *
 * The Settings switch is the user's accepted preference. Trusted usability is stricter:
 * `isEnabled()` is true only while HomePilot adulthood + ConsentFlow are live. A transient
 * session/attestation loss must remove Private access without silently rewriting the switch OFF.
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

function loadGate({ verified = false, connected = true, storedEnabled = false, discovery = null } = {}) {
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
    const session = {
        connected,
        socket: connected ? {} : null,
        session: connected
            ? { enabled: true, url: 'wss://test/avatar/session', auth: '' }
            : { enabled: false, url: '', auth: '' },
        config: { session: {} },
        send: jest.fn(() => session.connected),
        connect: jest.fn(() => Boolean(session.session.enabled && session.session.url)),
    };
    const director = {
        blackboard: { adultVerified: verified, nsfwAllowed: false },
        adult: verified ? flow : null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
        modes: {},
        clips: null,
        adapters: [],
        session,
    };
    window.NEXUS_BD = director;
    window.NEXUS_BD_CONSENT_FLOW = { attach: jest.fn(() => flow) };
    window.NEXUS_BD_PROFILE_ADULT = { id: 'adult' };
    window.NEXUS_BD_SAY = jest.fn();
    if (discovery) window.NEXUS_BD_BRIDGE_DISCOVERY = { discover: jest.fn(discovery) };
    else delete window.NEXUS_BD_BRIDGE_DISCOVERY;

    require('../../src/SpicyGate.js');
    return { gate: window.NEXUS_SPICY, director, flow, session };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-17T12:00:00Z'));
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
    test('turning ON preserves the user preference while trusted verification is pending', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(true);
        expect(done).not.toHaveBeenCalled();
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
    });

    test('desktop Settings toggle always shows conditions before trusted verification', () => {
        const s = loadGate({ verified: false, connected: true });
        const toggle = document.getElementById('spicy-mode-toggle');

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));

        const overlay = document.querySelector('.spicy-age-overlay');
        expect(overlay).not.toBeNull();
        expect(s.director.session.send).not.toHaveBeenCalled();
        expect(s.gate.isRequested()).toBe(false);

        const consent = overlay.querySelector('#spicy-age-consent');
        const confirm = overlay.querySelector('#spicy-age-confirm');
        expect(confirm.textContent).toBe('Accept');
        expect(confirm.disabled).toBe(true);
        consent.checked = true;
        consent.dispatchEvent(new Event('change', { bubbles: true }));
        confirm.click();

        expect(document.querySelector('.spicy-age-overlay')).toBeNull();
        expect(s.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isPending()).toBe(true);
        expect(toggle.checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
    });

    test('an accepted ON choice re-discovers HomePilot and reconnects before verification', async () => {
        const found = {
            available: true,
            reason: 'ok',
            sessionUrl: 'wss://bridge.example/v1/avatar/session',
            auth: 'pair-token',
            features: ['directives', 'panels'],
        };
        const s = loadGate({
            verified: false,
            connected: false,
            discovery: () => Promise.resolve(found),
        });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isConnecting()).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('CONNECTING…');

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(window.NEXUS_BD_BRIDGE_DISCOVERY.discover).toHaveBeenCalledTimes(1);
        expect(s.session.session).toMatchObject({
            enabled: true,
            url: found.sessionUrl,
            auth: found.auth,
            source: 'bridge',
        });
        expect(s.session.connect).toHaveBeenCalled();

        s.session.connected = true;
        s.session.socket = {};
        jest.advanceTimersByTime(500);

        expect(s.gate.isConnecting()).toBe(false);
        expect(s.gate.isPending()).toBe(true);
        expect(s.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });

        s.director.blackboard.adultVerified = true;
        jest.advanceTimersByTime(500);

        expect(s.gate.isEnabled()).toBe(true);
        expect(done).toHaveBeenCalledWith(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
    });

    test('an unavailable service does not silently rewrite the accepted switch OFF', () => {
        const s = loadGate({ verified: false, connected: false });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(s.gate.isConnecting()).toBe(false);
        expect(done).toHaveBeenCalledWith(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('UNAVAILABLE');
        expect(document.querySelector('.config-section').dataset.privateState).toBe('unavailable');
    });

    test('adult_ack plus the existing ConsentFlow makes the switch usable and reports ON', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();
        s.gate.setEnabled(true, done);

        s.director.blackboard.adultVerified = true;
        expect(s.gate.refresh()).toBe(true);

        expect(window.NEXUS_BD_CONSENT_FLOW.attach).toHaveBeenCalledTimes(1);
        expect(s.director.adult).toBe(s.flow);
        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(done).toHaveBeenCalledWith(true);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
    });

    test('trusted verification alone does not enable Private when the user preference is OFF', () => {
        const s = loadGate({ verified: true, connected: true });

        expect(s.gate.isRequested()).toBe(false);
        expect(s.gate.isEnabled()).toBe(false);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(false);
    });

    test('transient verification loss removes access but keeps the switch ON and re-verifies', () => {
        const s = loadGate({ verified: true, connected: true });
        const changes = [];
        s.gate.onChange((value) => changes.push(value));

        s.gate.setEnabled(true);
        expect(s.gate.isEnabled()).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');

        // Simulate the trusted session attestation disappearing. Access must close, but this is
        // not the same thing as the user turning the Settings switch off.
        s.director.blackboard.adultVerified = false;
        expect(s.gate.refresh()).toBe(false);

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isPending()).toBe(true);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
        expect(changes).toContain(false);

        s.director.blackboard.adultVerified = true;
        expect(s.gate.refresh()).toBe(true);

        expect(s.gate.isEnabled()).toBe(true);
        expect(s.gate.isRequested()).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
        expect(changes[changes.length - 1]).toBe(true);
    });

    test('verification timeout leaves preference ON but trusted access unavailable', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();
        s.gate.setEnabled(true, done);

        jest.advanceTimersByTime(10500);

        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(done).toHaveBeenCalledWith(false);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('UNAVAILABLE');
    });

    test('reload preserves an accepted ON preference and revalidates instead of forcing OFF', () => {
        const s = loadGate({ verified: false, connected: false, storedEnabled: true });

        expect(s.gate.isRequested()).toBe(true);
        expect(s.gate.isEnabled()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('true');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('REVERIFYING…');

        jest.advanceTimersByTime(500);
        expect(s.gate.isRequested()).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('UNAVAILABLE');
    });

    test('only an explicit OFF action clears the preference', () => {
        const s = loadGate({ verified: true, connected: true });
        s.gate.setEnabled(true);
        expect(s.gate.isEnabled()).toBe(true);

        s.gate.setEnabled(false);

        expect(s.gate.isRequested()).toBe(false);
        expect(s.gate.isEnabled()).toBe(false);
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');
    });
});
