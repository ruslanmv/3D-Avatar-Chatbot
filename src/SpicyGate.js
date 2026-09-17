'use strict';

/**
 * SpicyGate — Settings gate for Private Mode.
 * ============================================
 *
 * Product invariant:
 *   The Settings switch is the user's preference.
 *   Private is usable only while trusted HomePilot adulthood + ConsentFlow are live.
 *
 * The preference may remain ON while a session reconnects or re-verifies. That does not
 * grant access: `isEnabled()` stays false until the trusted server attestation is live again.
 * This separation prevents a transient socket/attestation loss from silently rewriting the
 * user's Settings choice while preserving the server-only trust boundary.
 *
 * Storage (localStorage):
 *   nexus_spicy_enabled  — the user's accepted ON/OFF preference
 *   nexus_spicy_verified — local conditions acknowledgement only; never trusted adulthood
 *
 * Exposes: window.NEXUS_SPICY
 */
(function () {
    const VERIFY_RETRY_MS = 5000;
    const ENABLE_TIMEOUT_MS = 10000;
    const CONNECTION_TIMEOUT_MS = 10000;
    const REFRESH_MS = 500;

    let enabled = localStorage.getItem('nexus_spicy_enabled') === 'true';
    let verified = localStorage.getItem('nexus_spicy_verified') === 'true';
    let pending = false;
    let pendingSince = 0;
    let connecting = false;
    let connectingSince = 0;
    let connectionAttempt = 0;
    let discoveryInFlight = false;
    let discoveredSession = null;
    let lastVerifyRequestAt = 0;
    let retryAfter = 0;
    let unavailableReason = '';
    let lastUsable = false;
    let refreshTimer = null;
    const listeners = [];
    const pendingCallbacks = [];

    // An ON preference without the local conditions acknowledgement is not meaningful.
    if (enabled && !verified) enabled = false;

    function persist() {
        localStorage.setItem('nexus_spicy_enabled', enabled ? 'true' : 'false');
        localStorage.setItem('nexus_spicy_verified', verified ? 'true' : 'false');
    }
    persist();

    function director() {
        return window.NEXUS_BD || null;
    }

    /**
     * Reuse the repository's existing ConsentFlow. This may attach it lazily after a trusted
     * adult_ack, but it never creates trusted adulthood and never writes adultVerified.
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

    function notify(value) {
        const active = Boolean(value);
        for (const fn of listeners.slice()) {
            try {
                fn(active);
            } catch (_) {}
        }
    }

    function setUsableNotification(active) {
        const next = Boolean(active);
        if (lastUsable === next) return;
        lastUsable = next;
        notify(next);
    }

    function flushCallbacks(ok) {
        const callbacks = pendingCallbacks.splice(0, pendingCallbacks.length);
        for (const fn of callbacks) {
            try {
                fn(Boolean(ok));
            } catch (_) {}
        }
    }

    function resetAttemptState() {
        pending = false;
        pendingSince = 0;
        connecting = false;
        connectingSince = 0;
        connectionAttempt += 1;
        discoveryInFlight = false;
        discoveredSession = null;
        lastVerifyRequestAt = 0;
    }

    /** Explicit user OFF/reset. This is the only normal path that clears the preference. */
    function disableGate(reason, { notifyChange = true } = {}) {
        const wasUsable = lastUsable;
        enabled = false;
        unavailableReason = '';
        retryAfter = 0;
        resetAttemptState();
        persist();
        if (wasUsable && notifyChange) setUsableNotification(false);
        else lastUsable = false;
        updateUI(reason || 'off');
        flushCallbacks(false);
    }

    /**
     * A transport/verification problem removes trusted access but does not rewrite the user's
     * ON preference. The switch therefore stays ON and can recover automatically.
     */
    function suspendTrustedAccess(reason) {
        setUsableNotification(false);
        resetAttemptState();
        unavailableReason = reason || 'unavailable';
        retryAfter = Date.now() + VERIFY_RETRY_MS;
        persist();
        updateUI('unavailable');
        flushCallbacks(false);
        return false;
    }

    function commitEnabled() {
        if (!enabled || !verified || !trustedReady()) return false;
        const shouldNotify = !lastUsable;
        resetAttemptState();
        unavailableReason = '';
        retryAfter = 0;
        persist();
        if (shouldNotify) setUsableNotification(true);
        updateUI('on');
        flushCallbacks(true);
        return true;
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

        // Compatibility with the existing SessionAdapter. Reuse it; do not create a second
        // transport just for Private Mode.
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

    function attemptSessionRecovery(attempt) {
        if (!enabled || !connecting || attempt !== connectionAttempt) return false;
        if (sessionReady()) return true;

        const d = director();
        const session = d && d.session;

        if (session && discoveredSession) {
            const settings = discoveredSession;
            discoveredSession = null;
            if (!applySessionSettings(session, settings)) return suspendTrustedAccess('unavailable');
            return true;
        }

        if (session) {
            const current = session.session || {};
            if (session.socket) return true;
            if (current.enabled === true && current.url && typeof session.connect === 'function') {
                try {
                    if (session.connect() !== false) return true;
                } catch (_) {
                    // Discovery below can still provide a fresh endpoint.
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
                if (!enabled || !connecting || attempt !== connectionAttempt) return;
                if (!found || found.available !== true || !found.sessionUrl) {
                    suspendTrustedAccess('unavailable');
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
                if (enabled && connecting && attempt === connectionAttempt) suspendTrustedAccess('unavailable');
            });
        return true;
    }

    function requestTrustedVerification(force) {
        const d = director();
        if (!sessionReady()) return false;
        if (d && d.blackboard && d.blackboard.adultVerified === true) return false;
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

    function beginVerificationRequest() {
        if (!enabled) return false;
        connecting = false;
        connectingSince = 0;
        discoveredSession = null;
        unavailableReason = '';
        retryAfter = 0;
        if (trustedReady()) return commitEnabled();
        if (!requestTrustedVerification(true)) {
            if (!sessionReady()) return beginSessionRecovery();
            return suspendTrustedAccess('unavailable');
        }
        pending = true;
        pendingSince = Date.now();
        updateUI('verifying');
        return true;
    }

    function beginSessionRecovery() {
        if (!enabled) return false;
        pending = false;
        pendingSince = 0;
        lastVerifyRequestAt = 0;
        unavailableReason = '';
        retryAfter = 0;
        connecting = true;
        connectingSince = Date.now();
        const attempt = ++connectionAttempt;
        updateUI('connecting');
        if (!attemptSessionRecovery(attempt)) {
            return suspendTrustedAccess('unavailable');
        }
        return true;
    }

    /**
     * Reconcile preference and trust. Losing trusted readiness removes Private access at once,
     * but the Settings preference remains ON and the normal HomePilot session is re-established
     * and re-verified automatically.
     */
    function refreshTrustedState() {
        const trusted = trustedReady();

        if (!enabled) {
            if (lastUsable) setUsableNotification(false);
            updateUI('off');
            return false;
        }

        if (!verified) {
            disableGate('reset');
            return false;
        }

        if (trusted) {
            if (!lastUsable || pending || connecting || unavailableReason) return commitEnabled();
            updateUI('on');
            return true;
        }

        // Trust is gone now; consumers must stop using Private immediately. The user's switch
        // choice, however, remains ON while we recover it.
        if (lastUsable) setUsableNotification(false);

        if (connecting) {
            if (sessionReady()) {
                beginVerificationRequest();
                return false;
            }
            if (Date.now() - connectingSince >= CONNECTION_TIMEOUT_MS) {
                return suspendTrustedAccess('connection-timeout');
            }
            attemptSessionRecovery(connectionAttempt);
            updateUI('connecting');
            return false;
        }

        if (pending) {
            if (!sessionReady()) {
                pending = false;
                pendingSince = 0;
                lastVerifyRequestAt = 0;
                return beginSessionRecovery();
            }
            if (Date.now() - pendingSince >= ENABLE_TIMEOUT_MS) {
                return suspendTrustedAccess('verification-timeout');
            }
            if (!requestTrustedVerification(false)) {
                if (!sessionReady()) return beginSessionRecovery();
                return suspendTrustedAccess('unavailable');
            }
            updateUI('verifying');
            return false;
        }

        // A previous recovery attempt may have failed. Keep the preference ON, show the real
        // state, and periodically retry instead of silently flipping the switch OFF.
        if (unavailableReason && Date.now() < retryAfter) {
            updateUI('unavailable');
            return false;
        }
        unavailableReason = '';

        if (sessionReady()) return beginVerificationRequest();
        return beginSessionRecovery();
    }

    function showAgeGate(onConfirm, onCancel, { force = false } = {}) {
        if (verified && !force) {
            onConfirm();
            return;
        }

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
        /** True only while the trusted server attestation + ConsentFlow are live. */
        isEnabled: function () {
            return usable();
        },

        /** The user's Settings preference, independent of current trusted availability. */
        isRequested: function () {
            return enabled;
        },

        isPending: function () {
            return pending;
        },

        isConnecting: function () {
            return connecting;
        },

        /** Local conditions acknowledgement only; not trusted adulthood. */
        isVerified: function () {
            return verified;
        },

        refresh: function () {
            return refreshTrustedState();
        },

        setEnabled: function (on, onComplete, options) {
            if (typeof onComplete === 'function') pendingCallbacks.push(onComplete);

            if (!on) {
                disableGate('user');
                return;
            }

            const begin = function () {
                // Accept is the user's persistent ON choice. Trusted usability is still a
                // separate server result and remains false until adult_ack arrives.
                enabled = true;
                unavailableReason = '';
                retryAfter = 0;
                resetAttemptState();
                persist();

                if (trustedReady()) {
                    commitEnabled();
                    return;
                }
                if (sessionReady()) beginVerificationRequest();
                else beginSessionRecovery();
            };

            const requireConfirmation = Boolean(options && options.requireConfirmation);
            if (!verified || requireConfirmation) {
                showAgeGate(
                    begin,
                    function () {
                        flushCallbacks(false);
                        updateUI(enabled ? 'restoring' : 'off');
                    },
                    { force: requireConfirmation }
                );
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
            description.textContent = 'More personal, romantic, and mature experiences for verified adults.';
        }

        const row = toggle.closest ? toggle.closest('.spicy-toggle-label') : null;
        const rowText = row && row.querySelector('span:not(.spicy-toggle-slider)');
        if (rowText) rowText.textContent = 'Enable Private Mode';

        let detail = section.querySelector('#spicy-verification-status');
        if (!detail) {
            detail = document.createElement('p');
            detail.id = 'spicy-verification-status';
            detail.className = 'spicy-verification-status';
            detail.setAttribute('role', 'status');
            detail.setAttribute('aria-live', 'polite');
            detail.style.cssText = 'font-size:0.7rem;color:rgba(255,255,255,.55);margin:6px 0 0;line-height:1.4';
            const group = toggle.closest ? toggle.closest('.input-group') : null;
            (group || section).appendChild(detail);
        }
    }

    function updateUI(state) {
        const active = usable();
        const checking = pending && !active;
        const establishing = connecting && !active;
        const busy = checking || establishing;
        const requested = enabled;

        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            // The switch reflects the user's preference, not a momentary network condition.
            toggle.checked = requested;
            toggle.disabled = busy;
            toggle.setAttribute('aria-busy', busy ? 'true' : 'false');
        }

        // The headline status mirrors the switch only. Verification is a separate concern and
        // is explained below the switch so a temporary network problem never looks like the
        // user's preference was turned off.
        const label = document.getElementById('spicy-status-label');
        if (label) {
            label.textContent = requested ? 'ON' : 'OFF';
            label.className = 'spicy-status-label' + (requested ? ' spicy-status-on' : ' spicy-status-off');
        }

        const detail = document.getElementById('spicy-verification-status');
        if (detail) {
            let text = '';
            if (requested) {
                if (active) text = 'Verified and ready.';
                else if (establishing) text = 'Connecting to verification…';
                else if (checking) text = 'Verifying adult access…';
                else if (state === 'unavailable' || unavailableReason) {
                    text = 'Verification unavailable. Private experiences stay locked until verification succeeds.';
                } else if (state === 'restoring') text = 'Restoring verification…';
                else text = 'Waiting for verification…';
            }
            detail.textContent = text;
            detail.hidden = !text;
        }

        const adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) adultGroup.style.display = active ? '' : 'none';

        const gated = document.querySelectorAll('.spicy-gated');
        for (let i = 0; i < gated.length; i++) gated[i].style.display = active ? '' : 'none';

        const section = toggle && toggle.closest ? toggle.closest('.config-section') : null;
        if (section) {
            section.dataset.privateState =
                state || (active ? 'on' : establishing ? 'connecting' : checking ? 'verifying' : requested ? 'reverifying' : 'off');
        }
    }

    function initUI() {
        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.addEventListener('change', function () {
                const wantsOn = toggle.checked;
                window.NEXUS_SPICY.setEnabled(
                    wantsOn,
                    function () {
                        updateUI();
                    },
                    wantsOn ? { requireConfirmation: true } : undefined
                );
                updateUI();
            });
        }
        updateSettingsCopy();
        updateUI(enabled ? 'restoring' : 'off');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
    else initUI();

    refreshTimer = window.setInterval(function () {
        refreshTrustedState();
    }, REFRESH_MS);

    window.addEventListener(
        'beforeunload',
        function () {
            if (refreshTimer) window.clearInterval(refreshTimer);
            refreshTimer = null;
        },
        { once: true }
    );

    console.log('[SpicyGate] Initialized — Private preference:', enabled ? 'ON' : 'OFF', 'usable:', usable() ? 'YES' : 'NO');
})();