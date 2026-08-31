/**
 * TogetherPanel — the consent controls, and a shelf for the activities (batch B11).
 *
 * B11 lands before Together Mode has any activities, so this panel deliberately ships as
 * the half that exists: the sharing controls, the live state, and an `activities` registry
 * that is empty today. B12–B14 register into it. Drawing a picker for zero activities and
 * calling it a flagship would be a mock-up rather than a batch.
 *
 * The one rule the panel keeps: **it does not capture.** Every button here goes through
 * `ConsentMachine`, the panel never sees a `MediaStream`, and the pipeline it hands out is
 * built from a grant like everybody else's. A UI that could shortcut the machine would make
 * the machine advisory.
 *
 * Exposes: window.NEXUS_BD_TOGETHER_PANEL
 */
const TogetherPanel = (() => {
    'use strict';

    const PANEL_ID = 'nexus-bd-together-panel';

    class Panel {
        constructor({ consent, capture, config = {}, doc } = {}) {
            this.consent = consent;
            this.capture = capture || (typeof window !== 'undefined' ? window.NEXUS_BD_CAPTURE : null);
            this.config = config;
            this.doc = doc || (typeof document !== 'undefined' ? document : null);

            /** Registered by later batches: `{id, label, start, stop}`. */
            this.activities = new Map();
            this.pipeline = null;
            this.root = null;
            this.state = { state: 'idle', label: '' };
            this._unsubscribe = consent ? consent.onChange((snapshot) => this._onState(snapshot)) : () => {};
        }

        get name() {
            return 'TogetherPanel';
        }

        /** B12–B14 call this. Registration, not surgery — the point of the source enum. */
        register(activity) {
            if (!activity || !activity.id) return false;
            this.activities.set(activity.id, activity);
            this._paint();
            return true;
        }

        /**
         * Ask for a source and, if granted, build the one pipeline this panel owns.
         * Resolves to the pipeline or null; a refusal leaves the panel usable and every
         * other channel untouched.
         */
        async share(source = 'screen') {
            const grant = await this.consent.request(source);
            if (!grant) {
                this.pipeline = null;
                return null;
            }
            this.pipeline = this.capture.fromGrant(grant, { config: this.config });
            return this.pipeline;
        }

        stopSharing(reason = 'panel') {
            if (this.pipeline) this.pipeline.stop();
            this.pipeline = null;
            return this.consent.revoke(reason);
        }

        _onState(snapshot) {
            this.state = snapshot;
            // A revoke from anywhere — the browser's own bar, a hotkey, another batch —
            // must take this panel's pipeline with it, or the panel keeps a dead object
            // that looks alive.
            if (snapshot.state !== 'active' && this.pipeline) {
                this.pipeline.stop();
                this.pipeline = null;
            }
            this._paint();
        }

        // ── DOM ──────────────────────────────────────────────────────────────

        mount(container) {
            if (!this.doc || !container) return null;
            this.root = this.doc.createElement('div');
            this.root.id = PANEL_ID;
            container.appendChild(this.root);
            this._paint();
            return this.root;
        }

        _paint() {
            if (!this.root) return;
            const sharing = this.state.state === 'active';
            const activities = [...this.activities.values()].map((a) => a.label || a.id);
            this.root.textContent = '';

            const status = this.doc.createElement('p');
            status.className = 'nexus-bd-together-status';
            status.textContent = sharing
                ? this.state.label
                : this.state.reason === 'declined'
                  ? 'Not sharing — you declined. Everything else still works.'
                  : 'Not sharing.';
            this.root.appendChild(status);

            const button = this.doc.createElement('button');
            button.type = 'button';
            button.className = 'nexus-bd-together-share';
            button.textContent = sharing ? 'Stop sharing' : 'Share screen';
            button.addEventListener('click', () => (sharing ? this.stopSharing('user') : this.share('screen')));
            this.root.appendChild(button);

            const list = this.doc.createElement('ul');
            list.className = 'nexus-bd-together-activities';
            for (const label of activities) {
                const item = this.doc.createElement('li');
                item.textContent = label;
                list.appendChild(item);
            }
            // Honest about being early: an empty list says so rather than looking broken.
            if (!activities.length) {
                const empty = this.doc.createElement('li');
                empty.textContent = 'No activities yet.';
                list.appendChild(empty);
            }
            this.root.appendChild(list);
        }

        detach() {
            this._unsubscribe();
            this.stopSharing('detached');
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
            this.root = null;
        }

        get stats() {
            return {
                state: this.state.state,
                sharing: this.state.state === 'active',
                activities: [...this.activities.keys()],
                pipeline: this.pipeline ? this.pipeline.stats : null,
            };
        }
    }

    function attach(deps) {
        return new Panel(deps);
    }

    return { attach, Panel, PANEL_ID };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TOGETHER_PANEL = TogetherPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = TogetherPanel;
