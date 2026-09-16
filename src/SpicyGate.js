'use strict';

/**
 * SpicyGate — Settings gate for Private Mode.
 * ============================================
 *
 * Product invariant:
 *   If Private is visible in Together, Private is already usable.
 *   If Private is not usable, the tile does not exist.
 *
 * The local confirmation stored here is only a device preference. It never writes trusted
 * adulthood state. Trusted adulthood still comes exclusively from the connected session via
 * blackboard.adultVerified. Enabling Private therefore has two phases that are deliberately
 * presented only in Settings: local confirmation, then trusted verification + existing
 * ConsentFlow attachment. NEXUS_SPICY.isEnabled() becomes true only after both are ready.
 *
 * Storage (localStorage):
 *   nexus_spicy_enabled  — the user's requested Private preference
 *   nexus_spicy_verified — legacy/local confirmation only; never trusted adulthood
 *
 * Exposes: window.NEXUS_SPICY
 */
(function () {
    const VERIFY_RETRY_MS = 5000;
    const ENABLE_TIMEOUT_MS = 20000;
    const REFRESH_MS = 500;

    let enabled = localStorage.getItem('nexus_spicy_enabled') === 'true';
    let verified = localStorage.getItem('nexus_spicy_verified') === 'true';
    let pendingSince = 0;
    let lastVerifyRequestAt = 0;
    let lastUsable = false;
    let refreshTimer = null;
    const listeners = [];
    const pendingCallbacks = [];

    // A stored preference without the local confirmation is never allowed to survive startup.
    if (enabled && !verified) {
        enabled = false;
        localStorage.setItem('nexus_spicy_enabled', 'false');
    }

    function persist() {
        localStorage.setItem('nexus_spicy_enabled', enabled ? 'true' : 'false');
        localStorage.setItem('nexus_spicy_verified', verified ? 'true' : 'false');
    }

    function requested() {
        return enabled && verified;
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
        return requested() && trustedReady();
    }

    /**
     * Ask the connected service for trusted adulthood verification. The client never interprets
     * its own request as success; only adultVerified=true from the session can unlock Private.
     */
    function requestTrustedVerification(force) {
        const d = director();
        if (!requested() || (d && d.blackboard && d.blackboard.adultVerified === true)) return false;
        const now = Date.now();
        if (!force && lastVerifyRequestAt && now - lastVerifyRequestAt < VERIFY_RETRY_MS) return false;
        const session = d && d.session;
        if (!session || typeof session.send !== 'function') return false;
        try {
            const sent = session.send({ v: 1, type: 'adult_verify_request' }) === true;
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

    /**
     * Subscribers are told what the user requested, not granted trusted state. The Together
     * bridge still calls isEnabled() before exposing anything, so a request can trigger its
     * verification plumbing without ever making a locked tile visible.
     */
    function notify() {
        const value = requested();
        for (let i = 0; i < listeners.length; i++) {
            try {
                listeners[i](value);
            } catch (_) {}
        }
    }

    function disableRequested(reason) {
        const changed = enabled;
        enabled = false;
        pendingSince = 0;
        lastVerifyRequestAt = 0;
        lastUsable = false;
        persist();
        if (changed) notify();
        updateUI(reason || 'off');
        flushCallbacks(false);
    }

    /**
     * Reconcile the Settings switch with trusted session state. If verification is lost after
     * Private was usable, the preference is turned OFF and will not silently restore later.
     */
    function refreshTrustedState() {
        if (!requested()) {
            lastUsable = false;
            updateUI('off');
            return false;
        }

        const ready = trustedReady();
        if (ready) {
            const becameUsable = !lastUsable;
            lastUsable = true;
            pendingSince = 0;
            lastVerifyRequestAt = 0;
            updateUI('on');
            if (becameUsable) notify();
            flushCallbacks(true);
            return true;
        }

        // Trusted state disappeared after an active/usable session. Make OFF absolute and do not
        // re-enable when a later reconnect happens; the user can explicitly enable again.
        if (lastUsable) {
            disableRequested('verification-lost');
            return false;
        }

        if (!pendingSince) pendingSince = Date.now();
        if (Date.now() - pendingSince >= ENABLE_TIMEOUT_MS) {
            disableRequested('verification-timeout');
            return false;
        }

        requestTrustedVerification(false);
        updateUI('verifying');
        return false;
    }

    function showAgeGate(onConfirm, onCancel) {
        if (verified) {
            onConfirm();
            return;
        }

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
            '    <button class="primary-btn" id="spicy-age-confirm" disabled>Continue with verification</button>' +
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
            const active = usable();
            // If Together can see Private, remember that it was genuinely usable. A later
            // verification loss must therefore turn the preference OFF instead of silently
            // restoring it on reconnect.
            if (active) lastUsable = true;
            return active;
        },

        /** User asked for Private but trusted verification/ConsentFlow is not ready yet. */
        isPending: function () {
            return requested() && !trustedReady();
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
         * Enable or disable Private Mode. Enabling is not committed as ON until trusted session
         * verification and the existing ConsentFlow are ready.
         */
        setEnabled: function (on, onComplete) {
            if (typeof onComplete === 'function') pendingCallbacks.push(onComplete);

            if (!on) {
                disableRequested('user');
                return;
            }

            const begin = function () {
                enabled = true;
                pendingSince = Date.now();
                lastVerifyRequestAt = 0;
                lastUsable = false;
                persist();
                notify();
                requestTrustedVerification(true);
                refreshTrustedState();
            };

            if (!verified) {
                showAgeGate(begin, function () {
                    flushCallbacks(false);
                    updateUI('off');
                });
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
            disableRequested('reset');
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
        const pending = requested() && !active;

        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.checked = active;
            toggle.disabled = pending;
            toggle.setAttribute('aria-busy', pending ? 'true' : 'false');
        }

        const label = document.getElementById('spicy-status-label');
        if (label) {
            label.textContent = pending ? 'VERIFYING…' : active ? 'ON' : 'OFF';
            label.className = 'spicy-status-label' + (active ? ' spicy-status-on' : ' spicy-status-off');
        }

        const adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) adultGroup.style.display = active ? '' : 'none';

        const gated = document.querySelectorAll('.spicy-gated');
        for (let i = 0; i < gated.length; i++) gated[i].style.display = active ? '' : 'none';

        const section = toggle && toggle.closest ? toggle.closest('.config-section') : null;
        if (section) section.dataset.privateState = state || (pending ? 'verifying' : active ? 'on' : 'off');
    }

    function initUI() {
        const toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.addEventListener('change', function () {
                window.NEXUS_SPICY.setEnabled(toggle.checked, function () {
                    updateUI();
                });
                // Never leave a visually-ON switch while verification is still pending.
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

    // Keep the timer private, but let page teardown/test harnesses stop it without changing the
    // public preference semantics.
    window.addEventListener('beforeunload', function () {
        if (refreshTimer) window.clearInterval(refreshTimer);
        refreshTimer = null;
    }, { once: true });

    console.log('[SpicyGate] Initialized — Private usable:', usable() ? 'ON' : requested() ? 'VERIFYING' : 'OFF');
})();
