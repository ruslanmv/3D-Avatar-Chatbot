'use strict';

/**
 * SpicyGate — Settings gate for Private Mode.
 * ============================================
 *
 * Product invariant:
 *   The Settings switch is the user's preference.
 *   Accepting the adult confirmation enables Private Mode on this device. The existing
 *   ConsentFlow still owns per-experience consent and escalation after the gate is enabled.
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
    const preferenceListeners = [];
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

    function localPrivateProfile(profile) {
        if (!profile) return profile;
        return {
            ...profile,
            requires: (profile.requires || []).filter((flag) => flag !== 'adultVerified'),
        };
    }

    /**
     * Reuse the repository's existing ConsentFlow. Private Mode's explicit local adult
     * confirmation satisfies the profile's entry gate; per-experience consent remains intact.
     */
    function ensureTrustedAdultFlow() {
        const d = director();
        if (!d || !d.blackboard) return null;
        if (d.adult && typeof d.adult.enter === 'function') {
            d.adult.profile = localPrivateProfile(d.adult.profile);
            return d.adult;
        }

        const factory = window.NEXUS_BD_CONSENT_FLOW;
        const profile = window.NEXUS_BD_PROFILE_ADULT;
        if (!factory || typeof factory.attach !== 'function' || !profile) return null;
        try {
            const flow = factory.attach({
                bus: d.bus,
                blackboard: d.blackboard,
                modes: d.modes,
                profile: localPrivateProfile(profile),
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
        return enabled && verified;
    }

    function usable() {
        return enabled && verified;
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

    function notifyPreference(value) {
        const requested = Boolean(value);
        for (const fn of preferenceListeners.slice()) {
            try {
                fn(requested);
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
        const wasRequested = enabled;
        const wasUsable = lastUsable;
        enabled = false;
        unavailableReason = '';
        retryAfter = 0;
        resetAttemptState();
        persist();
        if (wasRequested) notifyPreference(false);
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
        if (!enabled || !verified) return false;
        ensureTrustedAdultFlow();
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
        let discoveryResult;
        try {
            // Start discovery immediately. Besides avoiding an unnecessary event-loop turn,
            // this lets callers observe the recovered SessionAdapter settings as soon as the
            // discovery promise settles.
            discoveryResult = discovery.discover();
        } catch (_) {
            discoveryInFlight = false;
            return suspendTrustedAccess('unavailable');
        }
        Promise.resolve(discoveryResult)
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

        if (sessionReady()) beginVerificationRequest();
        else beginSessionRecovery();
        // `refresh()` reports trusted usability, not whether a recovery attempt started.
        return false;
    }

    /**
     * AC8. The words the consent confirmation and the Settings switch use, one pack per language.
     *
     * This file had no language handling at all, so the adult confirmation, the one dialog that has
     * to be understood, was English in every session. A pack is chosen by the app's language
     * (`AppLanguage.code`, read when the dialog opens, so a language changed in Settings applies at
     * once); a language with no pack here falls back to English, exactly as before. English and
     * Italian are written out in full and are not mixed: nothing in `it` is borrowed from `en`.
     */
    const COPY = {
        en: {
            title: 'Private Mode',
            intro: 'Private Mode can make supported companion interactions more personal, romantic or sensual. It never starts automatically.',
            allowedTitle: 'When available:',
            allowed: [
                'Private appears in Together after you accept this confirmation',
                'Affectionate, Romantic and Sensual experiences remain consent-gated',
                'You can turn Private Mode off at any time',
            ],
            blockedTitle: 'Always blocked:',
            blocked: ['Content involving minors', 'Non-consensual scenarios', 'Illegal content'],
            foot: 'Each Private experience still asks for consent and can be stopped at any time.',
            checkbox: 'I am an adult and want Private Mode enabled on this device',
            cancel: 'Cancel',
            accept: 'Accept',
            settingsTitle: 'PRIVATE MODE',
            settingsDescription: 'More personal, romantic, and mature experiences for verified adults.',
            settingsEnable: 'Enable Private Mode',
            on: 'ON',
            off: 'OFF',
            enabled: 'Private Mode is enabled.',
            connecting: 'Connecting to verification…',
            verifying: 'Verifying adult access…',
            unavailable: 'Verification unavailable. Private experiences stay locked until verification succeeds.',
            restoring: 'Restoring verification…',
            waiting: 'Waiting for verification…',
        },
        it: {
            title: 'Modalità privata',
            intro: 'La modalità privata può rendere più personali, romantiche o sensuali le interazioni supportate con la tua compagna. Non parte mai automaticamente.',
            allowedTitle: 'Quando è disponibile:',
            allowed: [
                'Private compare in Together dopo che hai accettato questa conferma',
                'Le esperienze Affettuoso, Romantico e Sensuale restano subordinate al tuo consenso',
                'Puoi disattivare la modalità privata in qualsiasi momento',
            ],
            blockedTitle: 'Sempre bloccato:',
            blocked: ['Contenuti che coinvolgono minori', 'Scenari non consensuali', 'Contenuti illegali'],
            foot: 'Ogni esperienza Private chiede comunque il tuo consenso e può essere interrotta in qualsiasi momento.',
            checkbox: 'Sono maggiorenne e voglio attivare la modalità privata su questo dispositivo',
            cancel: 'Annulla',
            accept: 'Accetto',
            settingsTitle: 'MODALITÀ PRIVATA',
            settingsDescription: 'Esperienze più personali, romantiche e mature, solo per adulti verificati.',
            settingsEnable: 'Attiva la modalità privata',
            on: 'ATTIVA',
            off: 'DISATTIVA',
            enabled: 'La modalità privata è attiva.',
            connecting: 'Connessione alla verifica in corso…',
            verifying: 'Verifica dell’accesso per adulti in corso…',
            unavailable:
                'Verifica non disponibile. Le esperienze Private restano bloccate finché la verifica non riesce.',
            restoring: 'Ripristino della verifica…',
            waiting: 'In attesa della verifica…',
        },
    };

    /** The app's language, read now. English for any language without its own pack. */
    function copy() {
        let base = 'en';
        try {
            const code = (window.AppLanguage && window.AppLanguage.code) || '';
            if (code) base = String(code).slice(0, 2).toLowerCase();
        } catch (_) {
            base = 'en';
        }
        return COPY[base] || COPY.en;
    }

    function esc(text) {
        return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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
        const t = copy();
        const items = (list) => list.map((item) => '<li>' + esc(item) + '</li>').join('');
        overlay.innerHTML =
            '<div class="spicy-age-modal">' +
            '  <div class="spicy-age-header">' +
            '    <span class="spicy-age-icon">♡</span>' +
            '    <h3>' +
            esc(t.title) +
            '</h3>' +
            '  </div>' +
            '  <div class="spicy-age-body">' +
            '    <p>' +
            esc(t.intro) +
            '</p>' +
            '    <div class="spicy-age-allowed">' +
            '      <strong>' +
            esc(t.allowedTitle) +
            '</strong>' +
            '      <ul>' +
            items(t.allowed) +
            '</ul>' +
            '    </div>' +
            '    <div class="spicy-age-blocked">' +
            '      <strong>' +
            esc(t.blockedTitle) +
            '</strong>' +
            '      <ul>' +
            items(t.blocked) +
            '</ul>' +
            '    </div>' +
            '    <p style="font-size:0.78rem;opacity:.75">' +
            esc(t.foot) +
            '</p>' +
            '    <label class="spicy-age-checkbox">' +
            '      <input type="checkbox" id="spicy-age-consent" />' +
            '      <span>' +
            esc(t.checkbox) +
            '</span>' +
            '    </label>' +
            '  </div>' +
            '  <div class="spicy-age-actions">' +
            '    <button class="secondary-btn" id="spicy-age-cancel">' +
            esc(t.cancel) +
            '</button>' +
            '    <button class="primary-btn" id="spicy-age-confirm" disabled>' +
            esc(t.accept) +
            '</button>' +
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

        /**
         * AX18b. The same answer under the name Private's prompt asks for. TogetherCapability's
         * `privateContext` has called `gate.usable()` since c4f8eaa, and this object never exposed
         * it, so the check fell back to the server attestation alone: in a client-only install a
         * Private session started (Intimate checks `isEnabled()`), and every live reply was written
         * without Private's prompt — no register, no length rule, no consent rules, and none of
         * the in-Private guards (the music guard among them). Unit tests mocked `{ usable }` and
         * never saw the real shape.
         */
        usable: function () {
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
                // Accept is the user's persistent ON choice and is sufficient to enable the
                // local Private gate. ConsentFlow still gates each individual experience.
                const wasRequested = enabled;
                enabled = true;
                unavailableReason = '';
                retryAfter = 0;
                resetAttemptState();
                persist();
                if (!wasRequested) notifyPreference(true);

                commitEnabled();
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

        /** Usability changes: trusted Private access became available/unavailable. */
        onChange: function (fn) {
            listeners.push(fn);
            return function () {
                const idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        },

        /** Settings preference changes: the user explicitly turned Private ON or OFF. */
        onPreferenceChange: function (fn) {
            preferenceListeners.push(fn);
            return function () {
                const idx = preferenceListeners.indexOf(fn);
                if (idx >= 0) preferenceListeners.splice(idx, 1);
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
                    title.childNodes[i].textContent =
                        '\n                            ' + copy().settingsTitle + '\n                            ';
                    break;
                }
            }
        }

        const description = title && title.nextElementSibling;
        if (description && description.tagName === 'P') {
            description.textContent = copy().settingsDescription;
        }

        const row = toggle.closest ? toggle.closest('.spicy-toggle-label') : null;
        const rowText = row && row.querySelector('span:not(.spicy-toggle-slider)');
        if (rowText) rowText.textContent = copy().settingsEnable;

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
            label.textContent = requested ? copy().on : copy().off;
            label.className = 'spicy-status-label' + (requested ? ' spicy-status-on' : ' spicy-status-off');
        }

        const detail = document.getElementById('spicy-verification-status');
        if (detail) {
            let text = '';
            if (requested) {
                const t = copy();
                if (active) text = t.enabled;
                else if (establishing) text = t.connecting;
                else if (checking) text = t.verifying;
                else if (state === 'unavailable' || unavailableReason) text = t.unavailable;
                else if (state === 'restoring') text = t.restoring;
                else text = t.waiting;
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
                state ||
                (active
                    ? 'on'
                    : establishing
                      ? 'connecting'
                      : checking
                        ? 'verifying'
                        : unavailableReason
                          ? 'unavailable'
                          : requested
                            ? 'reverifying'
                            : 'off');
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

    console.log(
        '[SpicyGate] Initialized — Private preference:',
        enabled ? 'ON' : 'OFF',
        'usable:',
        usable() ? 'YES' : 'NO'
    );
})();
