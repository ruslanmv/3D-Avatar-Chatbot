/**
 * Settings-side Private gate.
 *
 * Turning the preference on may request trusted verification, but `isEnabled()` remains false
 * until adultVerified and the repository's existing ConsentFlow are both ready. If the normal
 * HomePilot realtime session is not connected yet, the Settings action re-runs BridgeDiscovery,
 * reconnects that existing session adapter, and only then sends adult_verify_request.
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
    jest.setSystemTime(new Date('2026-09-16T12:00:00Z'));
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
    test('turning ON requests trusted verification but does not report Private as enabled while unverified', () => {
        const s = loadGate({ verified: false, connected: true });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(true);
        expect(s.gate.isConnecting()).toBe(false);
        expect(done).not.toHaveBeenCalled();
        expect(localStorage.getItem('nexus_spicy_enabled')).toBe('false');
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
    });

    test('desktop Settings toggle always shows the conditions modal before trusted verification', () => {
        const s = loadGate({ verified: false, connected: true });
        const toggle = document.getElementById('spicy-mode-toggle');

        // loadGate intentionally starts with the legacy/local acknowledgement already stored.
        // A visible Settings enable action must still explain the conditions instead of jumping
        // straight to a disabled VERIFYING switch.
        expect(s.gate.isVerified()).toBe(true);
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));

        const overlay = document.querySelector('.spicy-age-overlay');
        expect(overlay).not.toBeNull();
        expect(s.director.session.send).not.toHaveBeenCalled();
        expect(s.gate.isPending()).toBe(false);
        expect(toggle.disabled).toBe(false);
        expect(document.getElementById('spicy-status-label').textContent).toBe('OFF');

        const consent = overlay.querySelector('#spicy-age-consent');
        const confirm = overlay.querySelector('#spicy-age-confirm');
        expect(confirm.textContent).toBe('Accept');
        expect(confirm.disabled).toBe(true);
        consent.checked = true;
        consent.dispatchEvent(new Event('change', { bubbles: true }));
        expect(confirm.disabled).toBe(false);
        confirm.click();

        expect(document.querySelector('.spicy-age-overlay')).toBeNull();
        expect(s.director.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(s.gate.isPending()).toBe(true);
        expect(toggle.checked).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');
        expect(toggle.disabled).toBe(true);
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

        expect(s.gate.isConnecting()).toBe(true);
        expect(s.gate.isPending()).toBe(false);
        expect(document.getElementById('spicy-mode-toggle').checked).toBe(true);
        expect(document.getElementById('spicy-mode-toggle').disabled).toBe(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('CONNECTING…');
        expect(s.director.session.send).not.toHaveBeenCalled();

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

        // Opening the normal SessionAdapter socket is the boundary between CONNECTING and
        // VERIFYING. SpicyGate does not forge that state itself.
        s.session.connected = true;
        s.session.socket = {};
        jest.advanceTimersByTime(500);

        expect(s.gate.isConnecting()).toBe(false);
        expect(s.gate.isPending()).toBe(true);
        expect(s.session.send).toHaveBeenCalledWith({ v: 1, type: 'adult_verify_request' });
        expect(document.getElementById('spicy-status-label').textContent).toBe('VERIFYING…');

        s.director.blackboard.adultVerified = true;
        jest.advanceTimersByTime(500);

        expect(s.gate.isEnabled()).toBe(true);
        expect(done).toHaveBeenCalledWith(true);
        expect(document.getElementById('spicy-status-label').textContent).toBe('ON');
    });

    test('a disconnected service with no discoverable HomePilot never enters fake VERIFYING', () => {
        const s = loadGate({ verified: false, connected: false });
        const done = jest.fn();

        s.gate.setEnabled(true, done);

        expect(s.director.session.send).not.toHaveBeenCalled();
        expect(s.gate.isEnabled()).toBe(false);
        expect(s.gate.isPending()).toBe(false);
        expect(s.gate.isConnecting()).toBe(false);
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