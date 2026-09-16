'use strict';

/**
 * SpicyGate — Settings gate for Private Mode.
 * ============================================
 *
 * Product invariant:
 *   If Private is visible in Together, Private is already usable.
 *   If Private is not usable, the tile does not exist.
 *
 * The local 18+ confirmation is only a device acknowledgement. It never writes trusted
 * adulthood state. Trusted adulthood comes exclusively from the connected HomePilot session
 * through blackboard.adultVerified, and Private is committed ON only after that attestation and
 * the existing ConsentFlow are both ready.
 *
 * Storage (localStorage):
 *   nexus_spicy_enabled  — true only for a currently usable Private gate; pending verification
 *                           is never persisted as enabled
 *   nexus_spicy_verified — local confirmation only; never trusted adulthood
 *
 * Exposes: window.NEXUS_SPICY
 */
(function () {
    const VERIFY_RETRY_MS = 5000;
    const ENABLE_TIMEOUT_MS = 10000;
    const CONNECTION_TIMEOUT_MS = 10000;
    const REFRESH_MS = 500;

    // Trusted adulthood is session-scoped. A persisted ON bit from an earlier page/session can
    // therefore never be restored before a fresh adult_ack; starting OFF also prevents booting
    // directly into the misleading VERIFYING state.
    let enabled = false;
    let verified = localStorage.getItem('nexus_spicy_verified') === 'true';
    let pending = false;
    let pendingSince = 0;
    let connecting = false;
    let connectingSince = 0;
    let connectionAttempt = 0;
    let discoveryInFlight = false;
    let discoveredSession = null;
    let lastVerifyRequestAt = 0;
    let refreshTimer = null;
    const listeners = [];
    const pendingCallbacks = [];

    if (localStorage.getItem('nexus_spicy_enabled') === 'true') {
        localStorage.setItem('nexus_spicy_enabled', 'false');
    }

    function persist() {
        localStorage.setItem('nexus_spicy_enabled', enabled ? 'true' : 'false');
        localStorage.setItem('nexus_spicy_verified', verified ? 'true' : 'false');
    }

    function director() {
        return window.NEXUS_BD || null;
    }

    /**
     * Reuse the repository's one existing ConsentFlow. This helper may attach that flow lazily
     * after a trusted adult_ack, but it never creates a second consent state machine and never
     * writes adultVerified itself.
     */
    function ensureTrustedAdultFlow() {
        const d = director();
        if (!d || !d.blackboard || d.blackboard.adultVerified !== true) return null;
        if (d.adult && typeof d.adult.enter === 'function') return d.adult;

        const factory = window.NEXUS_BD_CONSENT_FLOW;
        const profile = window.NEXUS_BD_PROFILE_ADULT;
        if (!factory || typeof factory.attach !== 'function' || !profile) return null;
        try {
            const flow = factory.attach({
                bus: d.bus,
                blackboard: d.blackboard,
                modes: d.modes,
                profile,
                recorder: d.clips,
                say: window.NEXUS_BD_SAY || null,
            });
            if (!flow || typeof flow.enter !== 'function') return null;
            d.adult = flow;
            if (Array.isArray(d.adapters) && !d.adapters.includes(flow)) d.adapters.push(flow);
            return flow;
        } catch (error) {
            console.warn('[SpicyGate] Private consent flow could not attach', error);
            return null;
        }
    }

    function trustedReady() {
        const d = director();
        if (!d || !d.blackboard || d.blackboard.adultVerified !== true) return false;
        return Boolean(ensureTrustedAdultFlow());
    }

    function usable() {
        return enabled && verified && trustedReady();
    }

    function sessionReady() {
        const d = director();
        const session = d && d.session;
        return Boolean(session && session.connected === true && typeof session.send === 'function');
    }

    function applySessionSettings(session, settings) {
        if (!session || !settings || !settings.url) return false;
        if (typeof session.configureSession === 'function') {
            try {
                return session.configureSession(settings) !== false;
            } catch (_) {
                return false;
            }
        }

        // Compatibility with the current SessionAdapter while this branch rolls out the
        // Settings-side recovery path. These are already public instance fields used by boot.js.
        session.session = { ...(session.session || {}), ...settings };
        if (session.config && typeof session.config === 'object') session.config.session = session.session;
        if (session.connected || session.socket) return true;
        if (session._timer) {
            try {
                window.clearTimeout(session._timer);
            } catch (_) {}
            session._timer = null;
        }
        if (typeof session.connect !== 'function') return false;
        try {
            return session.connect() !== false;
        } catch (_) {
            return false;
        }
    }

    /**
     * Private may be enabled after the Behavior Director booted without a realtime HomePilot
     * session. Re-run the same bridge discovery boot.js uses, configure the existing adapter,
     * and let its normal WebSocket lifecycle establish the trusted channel. This does not invent
     * a second transport and it never changes adultVerified locally.
     */
    function attemptSessionRecovery(attempt) {
        if (!connecting || attempt !== connectionAttempt) return false;
        if (sessionReady()) return true;

        const d = director();
        const session = d && d.session;

        if (session && discoveredSession) {
            const settings = discoveredSession;
            discoveredSession = null;
            if (!applySessionSettings(session, settings)) {
                disableGate('unavailable');
                return false;
            }
            return true;
        }

        if (session) {
            const current = session.session || {};
            if (session.socket) return true;
            if (current.enabled === true && current.url && typeof session.connect === 'function') {
                try {
                    return session.connect() !== false;
                } catch (_) {
                    // Discovery below may still provide a fresh bridge endpoint.
                }
            }
        }

        const discovery = window.NEXUS_BD_BRIDGE_DISCOVERY;
        if (!discovery || typeof discovery.discover !== 'function') return false;
        if (discoveryInFlight) return true;

        discoveryInFlight = true;
        Promise.resolve()
            .then(function () {
                return discovery.discover();
            })
            .then(function (found) {
                discoveryInFlight = false;
                if (!connecting || attempt !== connectionAttempt) return;
                if (!found || found.available !== true || !found.sessionUrl) {
                    disableGate('unavailable');
                    return;
                }
                discoveredSession = {
                    enabled: true,
                    url: found.sessionUrl,
                    auth: found.auth || '',
                    source: 'bridge',
                    features: Array.isArray(found.features) ? found.features.slice() : [],
                };
                attemptSessionRecovery(attempt);
            })
            .catch(function () {
                discoveryInFlight = false;
                if (connecting && attempt === connectionAttempt) disableGate('unavailable');
            });
        return true;
    }

    /**
     * Ask the connected service for trusted adulthood verification. VERIFYING is entered only
     * after this returns true. A missing/disconnected session is handled by the connection
     * recovery path rather than being mistaken for a verification refusal.
     */
    function requestTrustedVerification(force) {
        const d = director();
        if (d && d.blackboard && d.blackboard.adultVerified === true) return false;
        if (!sessionReady()) return false;
        const now = Date.now();
        if (!force && lastVerifyRequestAt && now - lastVerifyRequestAt < VERIFY_RETRY_MS) return true;
        try {
            const sent = d.session.send({ v: 1, type: 'adult_verify_request' }) === true;
            if (sent) lastVerifyRequestAt = now;
            return sent;
        } catch (_) {
            return false;
        }
    }

    function flushCallbacks(ok) {
        const callbacks = pendingCallbacks.splice(0, pendingCallbacks.length);
        for (const fn of callbacks) {
            try {
                fn(Boolean(ok));
            } catch (_) {}
        }
    }

    function notify(value) {
        const active = Boolean(value);
        for (let i = 0; i < listeners.length; i++) {
            try {
                listeners[i](active);
            } catch (_) {}
        }
    }

    function disableGate(reason, { notifyChange = true } = {}) {
        const changed = enabled || pending || connecting;
        enabled = false;
        pending = false;
        pendingSince = 0;
        connecting = false;
        connectingSince = 0;
        connectionAttempt += 1;
        discoveryInFlight = false;
        discoveredSession = null;
        lastVerifyRequestAt = 0;
        persist();
        if (changed && notifyChange) notify(false);
        updateUI(reason || 'off');
        flushCallbacks(false);
    }

    function commitEnabled() {
        if (!verified || !trustedReady()) return false;
        const changed = !enabled || pending || connecting;
        enabled = true;
        pending = false;
        pendingSince = 0;
        connecting = false;
        connectingSince = 0;
        connectionAttempt += 1;
        discoveryInFlight = false;
        discoveredSession = null;
        lastVerifyRequestAt = 0;
        persist();
        updateUI('on');
        if (changed) notify(true);
        flushCallbacks(true);
        return true;
    }

    function beginVerificationRequest() {
        connecting = false;
        connectingSince = 0;
        discoveredSession = null;
        if (!requestTrustedVerification(true)) {
            disableGate('unavailable');
            return false;
        }
        pending = true;
        pendingSince = Date.now();
        updateUI('verifying');
        return true;
    }

    function beginSessionRecovery() {
        connecting = true;
        connectingSince = Date.now();
        const attempt = ++connectionAttempt;
        updateUI('connecting');
        if (!attemptSessionRecovery(attempt)) {
            disableGate('unavailable');
            return false;
        }
        return true;
    }

    /**
     * Reconcile the Settings switch with trusted session state. Connection recovery and trusted
     * verification are separate states: first establish the normal HomePilot session, then send
     * adult_verify_request, then commit ON only after adult_ack + ConsentFlow are ready.
     */
    function refreshTrustedState() {
        if (enabled) {
            if (trustedReady()) {
                updateUI('on');
                return true;
            }
            disableGate('verification-lost');
            return false;
        }

        if (connecting) {
            if (trustedReady()) return commitEnabled();
            if (sessionReady()) {
                beginVerificationRequest();
                return false;
            }
            if (Date.now() - connectingSince >= CONNECTION_TIMEOUT_MS) {
                disableGate('connection-timeout');
                return false;
            }
            attemptSessionRecovery(connectionAttempt);
            updateUI('connecting');
            return false;
        }

        if (!pending) {
            updateUI('off');
            return false;
        }

        if (trustedReady()) return commitEnabled();

        // A request that loses its transport is no longer legitimately "verifying". Start a
        // fresh recovery attempt instead of dropping the user's accepted ON choice immediately.
        if (!sessionReady()) {
            pending = false;
            pendingSince = 0;
            lastVerifyRequestAt = 0;
            return beginSessionRecovery();
        }

        if (Date.now() - pendingSince >= ENABLE_TIMEOUT_MS) {
            disableGate('verification-timeout');
            return false;
        }

        if (!requestTrustedVerification(false)) {
            disableGate('unavailable');
            return false;
        }

        updateUI('verifying');
        return false;
    }

    /**
     * The Settings switch always presents the conditions before an OFF -> ON request. The stored
     * local acknowledgement is useful to programmatic callers, but it must never make a desktop
     * click jump straight to VERIFYING with no visible explanation. `force` is therefore used by
     * the Settings UI while existing callers can keep the legacy one-time acknowledgement path.
     */
    function showAgeGate(onConfirm, onCancel, { force = false } = {}) {
        if (verified && !force) {
            onConfirm();
            return;
        }

        // One modal owns one enable attempt. Avoid duplicate overlays if a browser dispatches a
        // second change/click while the first confirmation is already open.
        const existing = document.querySelector('.spicy-age-overlay');
        if (existing) return;

        const overlay = document.createElement('div');
        overlay.className = 'spicy-age-overlay';
        overlay.innerHTML =
            '<div class="spicy-age-modal">' +
            '  <div class="spicy-age-header">' +
            '    <span class="spicy-age-icon">♡</span>' +
            '    <h3>Private Mode</h3>' +
            '  </div>' +
            '  <div class="spicy-age-body">' +
            '    <p>Private Mode can make supported companion interactions more personal, romantic ' +
            '       or sensual. It never starts automatically.</p>' +
            '    <div class="spicy-age-allowed">' +
            '      <strong>When available:</strong>' +
            '      <ul>' +
            '        <li>Private appears in Together only after trusted adult verification</li>' +
            '        <li>Affectionate, Romantic and Sensual experiences remain consent-gated</li>' +
            '        <li>You can turn Private Mode off at any time</li>' +
            '      </ul>' +
            '    </div>' +
            '    <div class="spicy-age-blocked">' +
            '      <strong>Always blocked:</strong>' +
            '      <ul>' +
            '        <li>Content involving minors</li>' +
            '        <li>Non-consensual scenarios</li>' +
            '        <li>Illegal content</li>' +
            '      </ul>' +
            '    </div>' +
            '    <p style="font-size:0.78rem;opacity:.75">This local confirmation does not replace the ' +
            '       connected service\'s trusted adult verification.</p>' +
            '    <label class="spicy-age-checkbox">' +
            '      <input type="checkbox" id="spicy-age-consent" />' +
            '      <span>I am an adult and want Private Mode enabled on this device</span>' +
            '    </label>' +
            '  </div>' +
            '  <div class="spicy-age-actions">' +
            '    <button class="secondary-btn" id="spicy-age-cancel">Cancel</button>' +
            '    <button class="primary-btn" id="spicy-age-confirm" disabled>Accept</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);

        const checkbox = overlay.querySelector('#spicy-age-consent');
        const confirmBtn = overlay.querySelector('#spicy-age-confirm');
        const cancelBtn = overlay.querySelector('#spicy-age-cancel');

        checkbox.addEventListener('change', function () {
            confirmBtn.disabled = !checkbox.checked;
        });

        confirmBtn.addEventListener('click', function () {
            overlay.remove();
            verified = true;
            persist();
            onConfirm();
        });

        cancelBtn.addEventListener('click', function () {
            overlay.remove();
            onCancel();
        });

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                overlay.remove();
                onCancel();
            }
        });
    }

    window.NEXUS_SPICY = {
        /** True only when the local preference, trusted verification and ConsentFlow are ready. */
        isEnabled: function () {
            if (!enabled) return false;
            if (usable()) return true;
            disableGate('verification-lost');
            return false;
        },

        /** A real trusted-verification request is currently in flight. */
        isPending: function () {
            return pending;
        },

        /** The gate is establishing the normal HomePilot realtime session before verification. */
        isConnecting: function () {
            return connecting;
        },

        /** Legacy/local confirmation state. Not the trusted session attestation. */
        isVerified: function () {
            return verified;
        },

        /** Explicitly re-check trusted state (used by tests and session adapters). */
        refresh: function () {
            return refreshTrustedState();
        },

        /**
         * Enable or disable Private Mode. Enabling is committed only after a real connected
         * verification request succeeds and trusted state/ConsentFlow become ready.
         *
         * Settings passes `{ requireConfirmation: true }` so every visible OFF -> ON action is
         * explained by the conditions modal even when this device acknowledged them previously.
         */
        setEnabled: function (on, onComplete, options) {
            if (typeof onComplete === 'function') pendingCallbacks.push(onComplete);

            if (!on) {
                disableGate('user');
                return;
            }

            const begin = function () {
                if (trustedReady()) {
                    commitEnabled();
                    return;
                }

                // Do not write an eventual-on preference. Keep the accepted switch visually ON
                // while we establish the existing HomePilot session and then verify it.
                enabled = false;
                pending = false;
                pendingSince = 0;
                connecting = false;
                connectingSince = 0;
                lastVerifyRequestAt = 0;
                persist();

                if (sessionReady()) beginVerificationRequest();
                else beginSessionRecovery();
            };

            const requireConfirmation = Boolean(options && options.requireConfirmation);
            if (!verified || requireConfirmation) {
                showAgeGate(begin, function () {
                    flushCallbacks(false);
                    updateUI('off');
                }, { force: requireConfirmation });
                return;
            }
            begin();
        },

        onChange: function (fn) {
            listeners.push(fn);
            return function () {
                const idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        },

        /** Reset local confirmation (testing / parental control). */
        resetVerification: function () {
            verified = false;
            disableGate('reset');
            persist();
        },
    };

    function updateSettingsCopy() {
        const toggle = document.getElementById('spicy-mode-toggle');
        if (!toggle) return;
        const section = toggle.closest ? toggle.closest('.config-section') : null;
        if (!section) return;

        const title = section.querySelector('.config-title');
        if (title) {
            for (let i = 0; i < title.childNodes.length; i++) {
                if (title.childNodes[i].nodeType === 3 && title.childNodes[i].textContent.trim()) {
                    title.childNodes[i].textContent = '\n                            PRIVATE MODE\n                            ';
                    break;
                }
            }
        }

        const description = title && title.nextElementSibling;
        if (description && description.tagName === 'P') {
            description.textContent =
                'Allows verified adults to access more personal, romantic, and mature experiences. This option is available only after adult verification and is never enabled automatically.';
        }

        const row = toggle.closest ? toggle.closest('.spicy-toggle-label') : null;
        const rowText = row && row.querySelector('span:not(.spicy-toggle-slider)');
        if (rowText) rowText.textContent = 'Enable Private Mode';
    }

    function updateUI(state) {
        const active = usable();
        const checking = pending && !active;
        const establishing = connecting && !active;
        const busy = checking || establishing;

        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            // Accepting the conditions is the user's ON choice, so keep the switch visually ON
            // while the trusted channel connects/verifies. Private itself remains unavailable
            // until `active` is true; this changes presentation only, not the trusted gate.
            toggle.checked = active || busy;
            toggle.disabled = busy;
            toggle.setAttribute('aria-busy', busy ? 'true' : 'false');
        }

        const label = document.getElementById('spicy-status-label');
        if (label) {
            label.textContent = establishing ? 'CONNECTING…' : checking ? 'VERIFYING…' : active ? 'ON' : 'OFF';
            label.className = 'spicy-status-label' + (active ? ' spicy-status-on' : ' spicy-status-off');
        }

        const adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) adultGroup.style.display = active ? '' : 'none';

        const gated = document.querySelectorAll('.spicy-gated');
        for (let i = 0; i < gated.length; i++) gated[i].style.display = active ? '' : 'none';

        const section = toggle && toggle.closest ? toggle.closest('.config-section') : null;
        if (section) section.dataset.privateState = state || (establishing ? 'connecting' : checking ? 'verifying' : active ? 'on' : 'off');
    }

    function initUI() {
        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.addEventListener('change', function () {
                const wantsOn = toggle.checked;
                window.NEXUS_SPICY.setEnabled(wantsOn, function () {
                    updateUI();
                }, wantsOn ? { requireConfirmation: true } : undefined);
                // The switch itself is not trusted verification. Keep the visible switch/state in
                // sync while the conditions modal owns the OFF -> ON decision.
                updateUI();
            });
        }
        updateSettingsCopy();
        updateUI();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
    else initUI();

    refreshTimer = window.setInterval(function () {
        refreshTrustedState();
    }, REFRESH_MS);

    window.addEventListener('beforeunload', function () {
        if (refreshTimer) window.clearInterval(refreshTimer);
        refreshTimer = null;
    }, { once: true });

    console.log('[SpicyGate] Initialized — Private usable:', usable() ? 'ON' : 'OFF');
})();