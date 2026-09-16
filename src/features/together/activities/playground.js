/**
 * Playground — the family-friendly way into scene-aware stories.
 *
 * This activity owns the Playground entry point and also installs the separate Private
 * Together tile. Playground remains family-safe. Private is visible only after the user
 * explicitly enables Private Mode; mature behaviour still requires a trusted server
 * attestation and the existing ConsentFlow before anything can start.
 *
 * The important runtime rule is that the shipped static `adult.available` config is not the
 * source of truth for a live Private session. That flag still controls eager boot-time
 * construction and deliberately ships false. When the user opens Private, this bridge asks
 * the connected HomePilot session for the existing `adult_ack`. A positive server-authored
 * attestation is what permits the client to attach the already-shipped ConsentFlow lazily.
 * No client code writes `adultVerified`.
 *
 * There is one Together chooser for desktop and mobile, so both activities use the same
 * native contract and responsive tile size.
 *
 * Exposes:
 *   window.NEXUS_BD_PLAYGROUND
 *   window.NEXUS_BD_INTIMATE
 */
const PlaygroundActivity = (() => {
    'use strict';

    const VERIFY_RETRY_MS = 5000;

    const SCENE_TALE = Object.freeze({
        id: 'scene-tale',
        label: 'Scene Tale',
        permission: null,
        note: 'A short interactive story inspired by where we are.',
    });

    const INTIMATE_PRESETS = Object.freeze([
        Object.freeze({
            id: 'affectionate',
            label: 'Affectionate',
            permission: null,
            note: 'Warm, close and gentle.',
            maxLevel: 1,
        }),
        Object.freeze({
            id: 'romantic',
            label: 'Romantic',
            permission: null,
            note: 'Romantic conversation and atmosphere.',
            maxLevel: 2,
        }),
        Object.freeze({
            id: 'sensual',
            label: 'Sensual',
            permission: null,
            note: 'A more intimate atmosphere, still consent-gated.',
            maxLevel: 3,
        }),
    ]);

    /** The user's Settings preference controls discovery, not trusted adult permission. */
    function privateTileVisibility(spicy) {
        if (!spicy || typeof spicy.isEnabled !== 'function' || !spicy.isEnabled()) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        return { ok: true, why: '' };
    }

    /**
     * Full runtime gate. A positive `adult_ack` is the live deployment capability: the
     * static `config.adult.available` flag is only the old eager-construction switch and is
     * intentionally not required here. The flow itself must still exist before start.
     */
    function intimateEligibility(director, spicy) {
        if (!spicy || typeof spicy.isEnabled !== 'function' || !spicy.isEnabled()) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        if (!director || !director.blackboard || director.blackboard.adultVerified !== true) {
            return { ok: false, why: 'trusted adult verification is not ready yet' };
        }
        if (!director.adult || typeof director.adult.enter !== 'function') {
            return { ok: false, why: 'Private consent flow is still loading' };
        }
        return { ok: true, why: '' };
    }

    /** Ask the connected session for the one server-authored adult attestation. */
    function requestAdultVerification(director) {
        const session = director && director.session;
        if (!session || typeof session.send !== 'function') return false;
        try {
            return session.send({ v: 1, type: 'adult_verify_request' }) === true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Construct the existing ConsentFlow only after trusted verification arrives.
     *
     * This is deliberately not a second adult system. It is the same flow/profile/blackboard
     * boot.js uses when `adult.available` is eagerly enabled. Keeping the shipped static
     * flag false therefore no longer strands the user after they deliberately enable Private
     * Mode, while the server remains the only authority that can set `adultVerified`.
     */
    function ensureAdultFlow(director) {
        if (!director) return null;
        if (director.adult && typeof director.adult.enter === 'function') return director.adult;
        if (!director.blackboard || director.blackboard.adultVerified !== true) return null;

        const globalObj = typeof window !== 'undefined' ? window : null;
        const factory = globalObj && globalObj.NEXUS_BD_CONSENT_FLOW;
        const profile = globalObj && globalObj.NEXUS_BD_PROFILE_ADULT;
        if (!factory || typeof factory.attach !== 'function' || !profile) return null;

        try {
            const flow = factory.attach({
                bus: director.bus,
                blackboard: director.blackboard,
                modes: director.modes,
                profile,
                recorder: director.clips,
                say: globalObj.NEXUS_BD_SAY || null,
            });
            if (!flow || typeof flow.enter !== 'function') return null;
            director.adult = flow;
            if (Array.isArray(director.adapters) && !director.adapters.includes(flow)) {
                director.adapters.push(flow);
            }
            return flow;
        } catch (error) {
            console.warn('[BD] Private consent flow could not attach', error);
            return null;
        }
    }

    function lockedPrompt(gate) {
        const why = String((gate && gate.why) || 'trusted adult verification is not ready yet');
        if (/verification/i.test(why)) {
            return 'Checking trusted adult verification… Keep this screen open. If it stays locked, enable adult verification in HomePilot and reconnect.';
        }
        if (/consent flow/i.test(why)) {
            return 'Trusted verification arrived. Preparing Private Mode…';
        }
        return why;
    }

    class Intimate {
        constructor({ bus, adult, capability } = {}) {
            this.__contract = true;
            this.id = 'intimate';
            this.title = 'Private';
            this.icon = '🔐';
            this.order = 85;

            this.bus = bus || null;
            this.adult = adult || null;
            this.capability = typeof capability === 'function' ? capability : () => ({ ok: false, why: 'unavailable' });
            this.active = false;
            this.preset = null;
            this.startedAt = null;
            this._adultMaxDescriptor = null;
        }

        get name() {
            return 'Private';
        }

        /** TogetherPanel reads prompt before inputs(), so this must be live rather than cached. */
        get prompt() {
            const gate = this.availability();
            return gate && gate.ok ? 'Choose a private experience.' : lockedPrompt(gate);
        }

        /**
         * A locked Private screen intentionally has no Start button. That keeps the user in a
         * neutral setup/waiting view while verification is requested, instead of routing a
         * fake option into TogetherPanel's generic "could not start / Try again" failure UI.
         */
        inputs() {
            const gate = this.availability();
            if (!gate || gate.ok === false) return [];
            return INTIMATE_PRESETS.map((preset) => ({ ...preset }));
        }

        availability() {
            return this.capability();
        }

        async start({ input = {} } = {}) {
            if (this.active) return { ok: false, why: 'Private is already running' };
            const gate = this.availability();
            if (!gate || gate.ok === false) return gate || { ok: false, why: 'Private is unavailable' };

            const preset = INTIMATE_PRESETS.find((candidate) => candidate.id === String(input.id || ''));
            if (!preset) return { ok: false, why: `unknown Private preset: ${String(input.id || '')}` };
            if (!this.adult || typeof this.adult.enter !== 'function') return { ok: false, why: 'Private consent flow is unavailable' };

            // V1 presets are ceilings, not shortcuts. ConsentFlow still starts at level 1,
            // keeps its two-minute floor/check-ins and owns every advance.
            this._installCeiling(preset.maxLevel);
            const entered = this.adult.enter();
            if (!entered || entered.ok === false) {
                this._restoreCeiling();
                return entered || { ok: false, why: 'adult consent flow refused to enter' };
            }

            this.active = true;
            this.preset = preset.id;
            this.startedAt = Date.now();
            this._emit('intimate:start', {
                preset: preset.id,
                maxLevel: preset.maxLevel,
                startedAt: this.startedAt,
            });
            return { ok: true, why: preset.id, preset: preset.id, maxLevel: preset.maxLevel };
        }

        stop(why = 'user') {
            const wasActive = this.active || Boolean(this.adult && this.adult.active);
            const preset = this.preset;
            this.active = false;
            this.preset = null;
            this.startedAt = null;

            if (this.adult && this.adult.active && typeof this.adult.exit === 'function') {
                this.adult.exit('hard');
            }
            this._restoreCeiling();
            if (wasActive) this._emit('intimate:stop', { preset, why });
            return wasActive;
        }

        status() {
            if (!this.active) return null;
            const preset = INTIMATE_PRESETS.find((candidate) => candidate.id === this.preset);
            return { label: preset ? preset.label : 'Private', detail: 'Private' };
        }

        detach() {
            this.stop('detached');
        }

        _installCeiling(maxLevel) {
            if (!this.adult) return;
            if (this._adultMaxDescriptor === null) {
                this._adultMaxDescriptor = Object.getOwnPropertyDescriptor(this.adult, 'maxLevel') || false;
            }
            const profileMax = Number(this.adult.profile && this.adult.profile.escalation && this.adult.profile.escalation.levels) || 4;
            Object.defineProperty(this.adult, 'maxLevel', {
                configurable: true,
                enumerable: false,
                get: () => Math.max(1, Math.min(profileMax, Number(maxLevel) || 1)),
            });
        }

        _restoreCeiling() {
            if (!this.adult || this._adultMaxDescriptor === null) return;
            try {
                delete this.adult.maxLevel;
                if (this._adultMaxDescriptor && this._adultMaxDescriptor !== false) {
                    Object.defineProperty(this.adult, 'maxLevel', this._adultMaxDescriptor);
                }
            } catch (_) {
                /* best effort; ConsentFlow still owns the server/user gates */
            }
            this._adultMaxDescriptor = null;
        }

        _emit(event, payload) {
            if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
        }

        get stats() {
            return {
                active: this.active,
                preset: this.preset,
                startedAt: this.startedAt,
            };
        }
    }

    /**
     * Bridge Private into the already-mounted TogetherPanel without inventing a second UI.
     * Visibility and permission stay separate. When visible but not yet verified, the bridge
     * requests the existing HomePilot attestation and leaves the panel in a neutral waiting
     * setup instead of failing.
     */
    function installIntimateBridge({ bus } = {}) {
        if (typeof window === 'undefined') return null;

        let director = null;
        let activity = null;
        let stopped = false;
        let retryTimer = null;
        let verifyTimer = null;
        let unsubscribeSpicy = null;
        let unsubscribePanel = null;
        let unsubscribeAdultExit = null;
        let lastVerified = null;
        let lastVerifyRequestAt = 0;

        const repaint = () => {
            if (director && director.togetherPanel && typeof director.togetherPanel.setContext === 'function') {
                director.togetherPanel.setContext({});
            }
        };

        const mirrorPreference = (enabled) => {
            // `nsfwAllowed` is the blackboard's runtime mirror of the user's existing
            // NEXUS_SPICY preference. It is not adult verification and cannot replace it.
            if (director && director.blackboard) director.blackboard.nsfwAllowed = Boolean(enabled);
        };

        const maybeRequestVerification = (force = false) => {
            if (!director || !director.blackboard || director.blackboard.adultVerified === true) return false;
            const now = Date.now();
            if (!force && lastVerifyRequestAt && now - lastVerifyRequestAt < VERIFY_RETRY_MS) return false;
            const sent = requestAdultVerification(director);
            if (sent) lastVerifyRequestAt = now;
            return sent;
        };

        const unregister = (why = 'Private Mode disabled') => {
            if (!director || !director.togetherPanel) return;
            const panel = director.togetherPanel;
            const current = panel.activities && panel.activities.get('intimate');
            if (!current) return;
            if (panel.activeActivity === 'intimate' && typeof panel.stopActivity === 'function') {
                panel.stopActivity(why);
            } else if (typeof current.detach === 'function') {
                current.detach();
            }
            if (panel.activities) panel.activities.delete('intimate');
            if (panel.adapted) panel.adapted.delete('intimate');
            if (director.intimate === current) director.intimate = null;
            activity = null;
            repaint();
        };

        const sync = () => {
            if (stopped) return false;
            if (!director) director = window.NEXUS_BD || null;
            if (!director || !director.togetherPanel || !window.NEXUS_SPICY) return false;

            const visible = privateTileVisibility(window.NEXUS_SPICY);
            mirrorPreference(visible.ok);

            if (visible.ok) {
                if (!director.blackboard || director.blackboard.adultVerified !== true) {
                    maybeRequestVerification();
                } else {
                    ensureAdultFlow(director);
                }

                const existing = director.togetherPanel.activities && director.togetherPanel.activities.get('intimate');
                if (!existing) {
                    activity = new Intimate({
                        bus: bus || director.bus,
                        adult: director.adult,
                        capability: () => intimateEligibility(director, window.NEXUS_SPICY),
                    });
                    director.intimate = activity;
                    director.togetherPanel.register(activity);
                    repaint();
                } else {
                    activity = existing;
                    activity.adult = director.adult || activity.adult;
                    director.intimate = existing;
                }

                const gate = intimateEligibility(director, window.NEXUS_SPICY);
                if (!gate.ok && director.togetherPanel.activeActivity === 'intimate') {
                    director.togetherPanel.stopActivity(gate.why || 'Private eligibility changed');
                }
            } else {
                unregister(visible.why);
            }
            return visible.ok;
        };

        const wire = () => {
            if (stopped) return;
            director = window.NEXUS_BD || null;
            if (!director || !director.togetherPanel || !window.NEXUS_SPICY) {
                retryTimer = setTimeout(wire, 100);
                return;
            }

            lastVerified = Boolean(director.blackboard && director.blackboard.adultVerified);
            sync();

            if (typeof window.NEXUS_SPICY.onChange === 'function') {
                unsubscribeSpicy = window.NEXUS_SPICY.onChange((enabled) => {
                    mirrorPreference(enabled);
                    lastVerifyRequestAt = 0;
                    sync();
                    if (enabled) maybeRequestVerification(true);
                });
            }
            if (director.togetherPanel && typeof director.togetherPanel.onChange === 'function') {
                unsubscribePanel = director.togetherPanel.onChange((snapshot) => {
                    if (snapshot && snapshot.open) {
                        sync();
                        if (window.NEXUS_SPICY.isEnabled()) maybeRequestVerification();
                    }
                });
            }
            const eventBus = bus || director.bus;
            if (eventBus && typeof eventBus.on === 'function') {
                unsubscribeAdultExit = eventBus.on('adult:exit', (event) => {
                    if (event && event.kind === 'hard' && director.togetherPanel.activeActivity === 'intimate') {
                        director.togetherPanel.stopActivity('adult exit');
                    }
                });
            }

            // SessionAdapter writes `adultVerified` directly on adult_ack. Poll the one
            // boolean at a low rate, request/retry while Private is visible, and repaint the
            // setup as soon as trusted verification arrives.
            verifyTimer = setInterval(() => {
                if (stopped || !director || !window.NEXUS_SPICY) return;
                const enabled = window.NEXUS_SPICY.isEnabled();
                const verified = Boolean(director.blackboard && director.blackboard.adultVerified);
                if (enabled && !verified) maybeRequestVerification();
                if (verified !== lastVerified || (verified && (!director.adult || typeof director.adult.enter !== 'function'))) {
                    lastVerified = verified;
                    sync();
                    if (activity) activity.adult = director.adult || activity.adult;
                    repaint();
                }
            }, 1000);
        };

        wire();

        return {
            sync,
            detach() {
                stopped = true;
                if (retryTimer) clearTimeout(retryTimer);
                if (verifyTimer) clearInterval(verifyTimer);
                if (unsubscribeSpicy) unsubscribeSpicy();
                if (unsubscribePanel) unsubscribePanel();
                if (unsubscribeAdultExit) unsubscribeAdultExit();
                mirrorPreference(false);
                unregister('detached');
            },
        };
    }

    class Playground {
        constructor({ bus } = {}) {
            this.__contract = true;
            this.id = 'playground';
            this.title = 'Playground';
            this.icon = '✨';
            this.order = 45;
            this.prompt = 'What should we imagine together?';

            this.bus = bus || null;
            this.active = false;
            this.mode = null;
            this.startedAt = null;
            this._intimateBridge = installIntimateBridge({ bus: this.bus });
        }

        get name() {
            return 'Playground';
        }

        inputs() {
            return [SCENE_TALE];
        }

        availability() {
            return { ok: true, why: '' };
        }

        async start({ input = {} } = {}) {
            const mode = String(input.id || 'scene-tale');
            if (mode !== SCENE_TALE.id) return { ok: false, why: `unknown Playground mode: ${mode}` };
            if (this.active) return { ok: false, why: 'Playground is already running' };

            this.active = true;
            this.mode = mode;
            this.startedAt = Date.now();
            this._emit('playground:start', {
                mode,
                audience: 'family',
                startedAt: this.startedAt,
            });
            return { ok: true, why: mode, mode };
        }

        stop(why = 'user') {
            if (!this.active) return false;
            const mode = this.mode;
            this.active = false;
            this.mode = null;
            this.startedAt = null;
            this._emit('playground:stop', { mode, why });
            return true;
        }

        status() {
            if (!this.active) return null;
            return { label: 'Scene Tale', detail: 'Playground' };
        }

        detach() {
            this.stop('detached');
            if (this._intimateBridge) this._intimateBridge.detach();
            this._intimateBridge = null;
        }

        _emit(event, payload) {
            if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
        }

        get stats() {
            return {
                active: this.active,
                mode: this.mode,
                startedAt: this.startedAt,
            };
        }
    }

    function attach(deps) {
        return new Playground(deps);
    }

    const IntimateActivity = {
        Intimate,
        presets: INTIMATE_PRESETS,
        eligibility: intimateEligibility,
        visibility: privateTileVisibility,
        requestAdultVerification,
        ensureAdultFlow,
    };

    return {
        attach,
        Playground,
        SCENE_TALE,
        IntimateActivity,
        installIntimateBridge,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_BD_PLAYGROUND = PlaygroundActivity;
    window.NEXUS_BD_INTIMATE = PlaygroundActivity.IntimateActivity;
}
if (typeof module !== 'undefined' && module.exports) module.exports = PlaygroundActivity;
