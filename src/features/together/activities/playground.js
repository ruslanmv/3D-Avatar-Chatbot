/**
 * Playground — the family-friendly way into scene-aware stories.
 *
 * This activity owns the Playground entry point and, in this branch, also installs the
 * separate private/adult Together tile. The two experiences remain deliberately independent:
 * Playground is always family-safe; the Private tile is shown only after the user explicitly
 * enables Private Mode, while the actual adult experience still requires the deployment
 * capability, trusted server attestation and the existing consent flow before it can start.
 *
 * There is still one Together chooser for desktop and mobile, so both activities use the
 * same native contract and the same responsive tile size. Private is not a wide/special card
 * and it never appears while Private Mode is off.
 *
 * Exposes:
 *   window.NEXUS_BD_PLAYGROUND
 *   window.NEXUS_BD_INTIMATE
 */
const PlaygroundActivity = (() => {
    'use strict';

    const SCENE_TALE = Object.freeze({
        id: 'scene-tale',
        label: 'Scene Tale',
        permission: null,
        note: 'A short interactive story inspired by where we are.',
    });

    const PRIVATE_LOCKED = Object.freeze({
        id: 'private-locked',
        label: 'Private Mode',
        permission: null,
        note: 'Available after trusted adult verification.',
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

    /**
     * Product visibility is intentionally narrower than the adult-content vocabulary but
     * broader than runtime eligibility: once the user deliberately enables Private Mode,
     * the neutral Private tile may appear. The full gate below still decides whether any
     * adult experience may actually start.
     */
    function privateTileVisibility(spicy) {
        if (!spicy || typeof spicy.isEnabled !== 'function' || !spicy.isEnabled()) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        return { ok: true, why: '' };
    }

    /** Full runtime gate. This is never weakened just because the tile is visible. */
    function intimateEligibility(director, spicy) {
        if (!director || !director.config || !director.config.adult || director.config.adult.available !== true) {
            return { ok: false, why: 'adult capability is not available in this deployment' };
        }
        if (!director.adult || typeof director.adult.enter !== 'function') {
            return { ok: false, why: 'adult consent flow is unavailable' };
        }
        if (!director.blackboard || director.blackboard.adultVerified !== true) {
            return { ok: false, why: 'trusted adult verification is not present' };
        }
        if (!spicy || typeof spicy.isEnabled !== 'function' || !spicy.isEnabled()) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        return { ok: true, why: '' };
    }

    class Intimate {
        constructor({ bus, adult, capability } = {}) {
            this.__contract = true;
            this.id = 'intimate';
            // Consumer-facing label stays neutral. The internal id remains `intimate` so the
            // existing adult architecture and tests do not need a second vocabulary.
            this.title = 'Private';
            this.icon = '🔐';
            // Normal-sized tile. It follows Meeting and stays before the wide Help tile.
            this.order = 85;
            this.prompt = 'Choose a private experience.';

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

        inputs() {
            const gate = this.availability();
            if (!gate || gate.ok === false) return [{ ...PRIVATE_LOCKED }];
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
            if (!this.adult || typeof this.adult.enter !== 'function') return { ok: false, why: 'adult consent flow is unavailable' };

            // V1 presets are ceilings, not shortcuts. ConsentFlow still starts at level 1,
            // keeps its two-minute floor/check-ins and owns every advance. Shadowing the
            // instance getter narrows only this session; stop() restores the exact descriptor.
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
     *
     * Visibility and runtime permission are intentionally separate:
     *
     *   Settings Private Mode OFF -> tile absent
     *   Settings Private Mode ON  -> neutral Private tile present
     *   Start attempt             -> full adult deployment + trusted verification gate
     *
     * This makes the Settings switch visibly do what it says on both desktop and mobile,
     * while preserving the trusted adult boundary at the moment any mature experience starts.
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

        const repaint = () => {
            if (director && director.togetherPanel && typeof director.togetherPanel.setContext === 'function') {
                director.togetherPanel.setContext({});
            }
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
            const gate = intimateEligibility(director, window.NEXUS_SPICY);

            if (visible.ok) {
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
                    director.intimate = existing;
                }

                // A visible tile is not permission. If trusted eligibility disappears while
                // the experience is active, stop it immediately but leave the neutral tile
                // visible as long as the user has kept Private Mode enabled.
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
                unsubscribeSpicy = window.NEXUS_SPICY.onChange(() => sync());
            }
            if (director.togetherPanel && typeof director.togetherPanel.onChange === 'function') {
                unsubscribePanel = director.togetherPanel.onChange((snapshot) => {
                    if (snapshot && snapshot.open) sync();
                });
            }
            if (bus && typeof bus.on === 'function') {
                unsubscribeAdultExit = bus.on('adult:exit', (event) => {
                    if (event && event.kind === 'hard' && director.togetherPanel.activeActivity === 'intimate') {
                        director.togetherPanel.stopActivity('adult exit');
                    }
                });
            }

            // `adult_ack` currently writes the blackboard directly rather than publishing a
            // capability event. Watch that single boolean at a low rate so an active Private
            // session is stopped immediately if trusted verification expires, and so the
            // setup screen can switch from the neutral locked message to the verified presets.
            verifyTimer = setInterval(() => {
                if (stopped || !director) return;
                const verified = Boolean(director.blackboard && director.blackboard.adultVerified);
                if (verified !== lastVerified) {
                    lastVerified = verified;
                    sync();
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
