/**
 * ModeManager — modes are data, and leaving one puts everything back (spec v1.1 §4A, §6.7).
 *
 * A mode is a profile: an attention rule, a set of commentary openings, an initiative
 * budget, an NSFW stance and a clip filter. Activating one overlays it; leaving restores
 * what was there before.
 *
 * ## Why restore is a snapshot rather than a reversal
 *
 * "Switching back restores companion exactly" is the acceptance criterion, and the tempting
 * implementation — undo each change as you leave — is the one that drifts: add a field to a
 * profile in six months, forget to add its undo, and companion comes back subtly wrong in a
 * way nobody notices until she behaves oddly on a Tuesday. Instead the manager snapshots
 * every field it is about to touch and puts the snapshot back verbatim. A new field is
 * covered automatically because it was captured, not because someone remembered it.
 *
 * Scene overlays (B14) stack the same way: overlay, then revert to the snapshot beneath.
 *
 * Exposes: window.NEXUS_BD_MODE_MANAGER
 */
const ModeManager = (() => {
    'use strict';

    /** Blackboard fields a mode is allowed to change, and therefore must restore. */
    const OWNED = ['mode', 'attention'];

    class Manager {
        constructor({ blackboard, bus, registry } = {}) {
            this.blackboard = blackboard;
            this.bus = bus;
            this.registry = registry;
            this.profiles = new Map();
            this.activeId = null;
            this._stack = [];
        }

        register(profile) {
            if (!profile || !profile.id) throw new Error('a profile needs an id');
            this.profiles.set(profile.id, profile);
            return this;
        }

        get(id) {
            return this.profiles.get(id) || null;
        }

        get active() {
            return this.activeId ? this.profiles.get(this.activeId) : null;
        }

        /**
         * Enter a mode. The previous state is pushed, so `activate` then `activate` back is
         * a round trip rather than two independent writes.
         */
        activate(id) {
            const profile = this.profiles.get(id);
            if (!profile) return false;
            if (this.activeId === id) return true;

            const requires = profile.requires || [];
            for (const requirement of requires) {
                if (!this.blackboard || !this.blackboard[requirement]) {
                    console.warn(`[BD] mode "${id}" refused: ${requirement} is not satisfied`);
                    return false;
                }
            }

            this._stack.push(this._snapshot());
            this._apply(profile);
            this.activeId = id;
            if (this.bus) this.bus.emit('mode:changed', { id });
            return true;
        }

        /** Leave the current mode, restoring whatever was underneath it. */
        deactivate() {
            const previous = this._stack.pop();
            if (!previous) return false;
            this._restore(previous);
            this.activeId = previous.activeId;
            if (this.bus) this.bus.emit('mode:changed', { id: this.activeId });
            return true;
        }

        _snapshot() {
            const bb = this.blackboard || {};
            const snapshot = { activeId: this.activeId, fields: {} };
            for (const field of OWNED) snapshot.fields[field] = bb[field];
            return snapshot;
        }

        _restore(snapshot) {
            if (!this.blackboard) return;
            for (const [field, value] of Object.entries(snapshot.fields)) {
                this.blackboard[field] = value;
            }
        }

        _apply(profile) {
            if (!this.blackboard) return;
            // The blackboard holds the profile itself, so the ranker's gates read
            // `bb.mode.allows` and `bb.mode.allowNsfw` straight from it (§6.5).
            this.blackboard.mode = profile;
            this.blackboard.attention = profile.attention && profile.attention.primary === 'activityTarget' ? 0.8 : 0;
        }

        /**
         * The showcase cycle: every record, in a stable order, one at a time.
         * @returns {{next: function, remaining: number, total: number}}
         */
        cycler(profileId = 'showcase') {
            const profile = this.profiles.get(profileId);
            if (!profile || typeof profile.cycle !== 'function' || !this.registry) return null;

            const queue = profile.cycle(this.registry);
            const total = queue.length;
            let index = 0;

            return {
                total,
                get remaining() {
                    return total - index;
                },
                next() {
                    if (index >= queue.length) index = 0; // it cycles, it does not stop
                    return queue[index++];
                },
            };
        }
    }

    return { Manager, OWNED };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_MODE_MANAGER = ModeManager;
if (typeof module !== 'undefined' && module.exports) module.exports = ModeManager;
