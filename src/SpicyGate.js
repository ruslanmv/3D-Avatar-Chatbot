'use strict';

/**
 * SpicyGate — user preference gate for mature/private experiences.
 * =================================================================
 *
 * This remains the repository's single local preference authority. The user-facing product
 * label is now "Intimate experiences", while the internal `NEXUS_SPICY` API and storage keys
 * stay unchanged for backwards compatibility.
 *
 * IMPORTANT: this local preference is not sufficient to expose Together -> Intimate.
 * The Together bridge also requires the deployment adult capability and the trusted,
 * session-scoped `blackboard.adultVerified` server attestation.
 *
 * Storage (localStorage):
 *   nexus_spicy_enabled  — "true" / "false"
 *   nexus_spicy_verified — "true" / "false" (legacy/local confirmation)
 *
 * Usage:
 *   window.NEXUS_SPICY.isEnabled()       → bool
 *   window.NEXUS_SPICY.setEnabled(true)  → asks for the existing local confirmation if needed
 *   window.NEXUS_SPICY.onChange(fn)       → subscribe to preference changes
 *
 * Exposes: window.NEXUS_SPICY
 */
(function () {
    // ─── State ───
    let enabled = localStorage.getItem('nexus_spicy_enabled') === 'true';
    let verified = localStorage.getItem('nexus_spicy_verified') === 'true';
    const listeners = [];

    // If enabled but not locally confirmed, force off. This is an extra client-side consent
    // step only; trusted adult eligibility is still supplied independently by the session.
    if (enabled && !verified) {
        enabled = false;
        localStorage.setItem('nexus_spicy_enabled', 'false');
    }

    // ─── Persistence ───
    function persist() {
        localStorage.setItem('nexus_spicy_enabled', enabled ? 'true' : 'false');
        localStorage.setItem('nexus_spicy_verified', verified ? 'true' : 'false');
    }

    // ─── Notify subscribers ───
    function notify() {
        const active = enabled && verified;
        for (let i = 0; i < listeners.length; i++) {
            try {
                listeners[i](active);
            } catch (_) {}
        }
    }

    // ─── Local confirmation modal ───
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
            '    <h3>Intimate experiences</h3>' +
            '  </div>' +
            '  <div class="spicy-age-body">' +
            '    <p>Intimate experiences can make supported companion interactions more romantic, flirtatious ' +
            '       or sensual. They never start automatically.</p>' +
            '    <div class="spicy-age-allowed">' +
            '      <strong>When enabled:</strong>' +
            '      <ul>' +
            '        <li>The Intimate activity may appear in Together after trusted adult verification</li>' +
            '        <li>Eligible adult poses, expressions and mature companion behavior may be available</li>' +
            '        <li>You can turn the preference off at any time</li>' +
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
            '      <span>I am 18 years or older and want Intimate experiences enabled on this device</span>' +
            '    </label>' +
            '  </div>' +
            '  <div class="spicy-age-actions">' +
            '    <button class="secondary-btn" id="spicy-age-cancel">Cancel</button>' +
            '    <button class="primary-btn" id="spicy-age-confirm" disabled>Enable Intimate experiences</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);

        var checkbox = overlay.querySelector('#spicy-age-consent');
        var confirmBtn = overlay.querySelector('#spicy-age-confirm');
        var cancelBtn = overlay.querySelector('#spicy-age-cancel');

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

    // ─── Public API ───
    window.NEXUS_SPICY = {
        /** Check whether the user's local mature-content preference is active. */
        isEnabled: function () {
            return enabled && verified;
        },

        /** Legacy/local confirmation state. Not the trusted session attestation. */
        isVerified: function () {
            return verified;
        },

        /**
         * Enable or disable the local mature-content preference.
         * @param {boolean} on
         * @param {Function} [onComplete]
         */
        setEnabled: function (on, onComplete) {
            if (on && !verified) {
                showAgeGate(
                    function () {
                        enabled = true;
                        persist();
                        notify();
                        updateUI();
                        if (onComplete) onComplete(true);
                    },
                    function () {
                        if (onComplete) onComplete(false);
                    }
                );
                return;
            }

            enabled = !!on;
            persist();
            notify();
            updateUI();
            if (onComplete) onComplete(enabled && verified);
        },

        /** Subscribe to preference changes. Returns an unsubscribe function. */
        onChange: function (fn) {
            listeners.push(fn);
            return function () {
                var idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        },

        /** Reset local confirmation (testing / parental control). */
        resetVerification: function () {
            verified = false;
            enabled = false;
            persist();
            notify();
            updateUI();
        },
    };

    // ─── Product copy ───
    function updateSettingsCopy() {
        var toggle = document.getElementById('spicy-mode-toggle');
        if (!toggle) return;
        var section = toggle.closest ? toggle.closest('.config-section') : null;
        if (!section) return;

        var title = section.querySelector('.config-title');
        if (title) {
            // Preserve the existing status badge element and only replace the text node.
            for (var i = 0; i < title.childNodes.length; i++) {
                if (title.childNodes[i].nodeType === 3 && title.childNodes[i].textContent.trim()) {
                    title.childNodes[i].textContent = '\n                            INTIMATE EXPERIENCES\n                            ';
                    break;
                }
            }
        }

        var description = title && title.nextElementSibling;
        if (description && description.tagName === 'P') {
            description.textContent =
                'Allow private adult romantic and sensual experiences. The Intimate button only appears after trusted adult verification and never starts automatically.';
        }

        var row = toggle.closest ? toggle.closest('.spicy-toggle-label') : null;
        var rowText = row && row.querySelector('span:not(.spicy-toggle-slider)');
        if (rowText) rowText.textContent = 'Enable Intimate experiences';
    }

    // ─── UI Sync ───
    function updateUI() {
        var active = enabled && verified;

        var toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) toggle.checked = active;

        var label = document.getElementById('spicy-status-label');
        if (label) {
            label.textContent = active ? 'ON' : 'OFF';
            label.className = 'spicy-status-label' + (active ? ' spicy-status-on' : ' spicy-status-off');
        }

        var adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) adultGroup.style.display = active ? '' : 'none';

        var gated = document.querySelectorAll('.spicy-gated');
        for (var i = 0; i < gated.length; i++) {
            gated[i].style.display = active ? '' : 'none';
        }
    }

    // ─── Init UI on DOM ready ───
    function initUI() {
        var toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.checked = enabled && verified;
            toggle.addEventListener('change', function () {
                window.NEXUS_SPICY.setEnabled(toggle.checked, function (result) {
                    // If the local confirmation dialog was cancelled, put the switch back in
                    // sync immediately instead of leaving a visually-on control with an off gate.
                    toggle.checked = !!result;
                });
            });
        }

        updateSettingsCopy();
        updateUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    console.log('[SpicyGate] Initialized — Intimate preference:', enabled && verified ? 'ON' : 'OFF');
})();
