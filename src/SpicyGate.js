'use strict';

/**
 * SpicyGate — Simple ON/OFF adult content gate with age verification.
 * =================================================================
 * When OFF (default): all adult poses, emotes, modes, and behaviors are hidden.
 * When ON: everything unlocks — poses, animations, talk styles, emotes.
 *
 * Requires one-time age verification (18+ checkbox) before enabling.
 *
 * Storage (localStorage):
 *   nexus_spicy_enabled  — "true" / "false"
 *   nexus_spicy_verified — "true" / "false"
 *
 * Usage:
 *   window.NEXUS_SPICY.isEnabled()       → bool
 *   window.NEXUS_SPICY.setEnabled(true)  → shows age gate if not verified
 *   window.NEXUS_SPICY.onChange(fn)       → subscribe to toggle changes
 *
 * Exposes: window.NEXUS_SPICY
 */
(function () {
    // ─── State ───
    let enabled = localStorage.getItem('nexus_spicy_enabled') === 'true';
    let verified = localStorage.getItem('nexus_spicy_verified') === 'true';
    const listeners = [];

    // If enabled but not verified, force off
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
        for (let i = 0; i < listeners.length; i++) {
            try {
                listeners[i](enabled);
            } catch (_) {}
        }
    }

    // ─── Age Verification Modal ───
    function showAgeGate(onConfirm, onCancel) {
        // If already verified, skip
        if (verified) {
            onConfirm();
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'spicy-age-overlay';
        overlay.innerHTML =
            '<div class="spicy-age-modal">' +
            '  <div class="spicy-age-header">' +
            '    <span class="spicy-age-icon">\u{1F525}</span>' +
            '    <h3>Adult Content</h3>' +
            '  </div>' +
            '  <div class="spicy-age-body">' +
            '    <p>Spicy Mode unlocks adult poses, animations, emotes, and behaviors ' +
            '       designed for mature audiences.</p>' +
            '    <div class="spicy-age-allowed">' +
            '      <strong>When enabled:</strong>' +
            '      <ul>' +
            '        <li>Adult poses (seductive, intimate, explicit)</li>' +
            '        <li>Flirt, tease &amp; intimate animation modes</li>' +
            '        <li>Whisper &amp; playful talk styles</li>' +
            '        <li>Adult interaction emotes</li>' +
            '        <li>Mature roleplay behaviors</li>' +
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
            '    <label class="spicy-age-checkbox">' +
            '      <input type="checkbox" id="spicy-age-consent" />' +
            '      <span>I am 18 years or older and consent to viewing adult content</span>' +
            '    </label>' +
            '  </div>' +
            '  <div class="spicy-age-actions">' +
            '    <button class="secondary-btn" id="spicy-age-cancel">Cancel</button>' +
            '    <button class="primary-btn" id="spicy-age-confirm" disabled>Enable Spicy Mode</button>' +
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

        // Close on overlay click (outside modal)
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                overlay.remove();
                onCancel();
            }
        });
    }

    // ─── Public API ───
    window.NEXUS_SPICY = {
        /**
         * Check if spicy mode is active (enabled AND verified).
         * @returns {boolean}
         */
        isEnabled: function () {
            return enabled && verified;
        },

        /**
         * Check if user has passed age verification.
         * @returns {boolean}
         */
        isVerified: function () {
            return verified;
        },

        /**
         * Enable or disable spicy mode.
         * If enabling and not yet verified, shows the age gate modal.
         * @param {boolean} on
         * @param {Function} [onComplete] — called after state change (or cancel)
         */
        setEnabled: function (on, onComplete) {
            if (on && !verified) {
                // Must pass age gate first
                showAgeGate(
                    function () {
                        enabled = true;
                        persist();
                        notify();
                        updateUI();
                        if (onComplete) onComplete(true);
                    },
                    function () {
                        // Cancelled — stay off
                        if (onComplete) onComplete(false);
                    }
                );
                return;
            }

            enabled = !!on;
            persist();
            notify();
            updateUI();
            if (onComplete) onComplete(enabled);
        },

        /**
         * Subscribe to spicy mode changes.
         * @param {Function} fn — called with (enabled: boolean)
         * @returns {Function} unsubscribe
         */
        onChange: function (fn) {
            listeners.push(fn);
            return function () {
                var idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        },

        /**
         * Reset age verification (for testing / parental control).
         */
        resetVerification: function () {
            verified = false;
            enabled = false;
            persist();
            notify();
            updateUI();
        },
    };

    // ─── UI Sync ───
    function updateUI() {
        // Update toggle switch in settings
        var toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) toggle.checked = enabled && verified;

        // Update settings label
        var label = document.getElementById('spicy-status-label');
        if (label) {
            label.textContent = enabled && verified ? 'ON' : 'OFF';
            label.className = 'spicy-status-label' + (enabled && verified ? ' spicy-status-on' : ' spicy-status-off');
        }

        // Gate adult optgroup in settings VR pose dropdown
        var adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) {
            adultGroup.style.display = enabled && verified ? '' : 'none';
        }

        // Gate all elements with .spicy-gated class
        var gated = document.querySelectorAll('.spicy-gated');
        for (var i = 0; i < gated.length; i++) {
            gated[i].style.display = enabled && verified ? '' : 'none';
        }
    }

    // ─── Init UI on DOM ready ───
    function initUI() {
        // Wire the toggle switch in settings
        var toggle = document.getElementById('spicy-mode-toggle');
        if (toggle) {
            toggle.checked = enabled && verified;
            toggle.addEventListener('change', function () {
                window.NEXUS_SPICY.setEnabled(toggle.checked);
            });
        }

        // Set initial badge visibility
        updateUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    console.log('[SpicyGate] Initialized — spicy mode:', enabled && verified ? 'ON' : 'OFF');
})();
