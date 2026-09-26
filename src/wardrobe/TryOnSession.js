/**
 * W6. One Try-On haul: which looks, which one she has on, and how it ends.
 *
 * `WardrobeController.tryOnHaul()` already walks a list of looks and puts her back, on a
 * timer. Together's Try-On is the person's own pace instead — Previous, Next, Keep, End —
 * so the pacing moves here and the controller keeps what it is for: it is still the only
 * thing that swaps her avatar (`applyLook`) and the only owner of the snapshot it restores
 * (`restore`). This file never calls the viewer.
 *
 * Two things this state machine is careful about, both of which a timer never had to be:
 *
 * - **Navigation faster than loading.** A VRM takes a moment to load, and a person taps
 *   Next three times in that moment. Every tap moves the target; one load runs at a time;
 *   when it lands, the newest target is loaded next and the ones in between are skipped.
 *   The screen always shows where she is going, and she always ends up there.
 *
 * - **What "restore" means after Keep.** The controller's snapshot is her base avatar —
 *   and it must stay that, because a new look is made from the base avatar, which is what
 *   Forge knows (see AvatarIdentity). But a person who kept a look in an earlier haul and
 *   ends this one expects that look back, not the base avatar. So the session notes where
 *   she was when *this* haul began and, if that was a kept look, ends by wearing it again
 *   through `applyLook`; otherwise it asks the controller to `restore()`.
 *
 * End is idempotent — the panel's Stop, the view's End button and a page navigation can
 * all ask — and restores exactly once.
 *
 * Exposes: window.NEXUS_TRY_ON_SESSION
 */
(function (global) {
    'use strict';

    var PHASES = Object.freeze(['choosing', 'running', 'kept', 'ended']);

    function keyOf(look) {
        return (look && (look.id || look.vrmUrl)) || null;
    }

    class TryOnSession {
        /**
         * options.controller   a WardrobeController (applyLook, restore, snapshot, original)
         * options.onChange     called with state() after every change
         */
        constructor(options) {
            options = options || {};
            this.controller = options.controller;
            this.onChange = options.onChange || null;
            this.phase = 'choosing';
            this.looks = [];
            this.chosen = [];
            this.index = 0;
            this.target = 0;
            this.busy = false;
            this.error = null;
            this.restorePoint = null;
            this._ending = null;
        }

        // ------------------------------------------------------------ choosing
        setLooks(looks) {
            this.looks = (looks || []).filter(function (look) {
                return keyOf(look);
            });
            var known = new Set(this.looks.map(keyOf));
            this.chosen = this.chosen.filter(function (key) {
                return known.has(key);
            });
            this._changed();
        }

        /** A look made during the haul: added to the shelf and chosen, so Start includes it. */
        add(look, options) {
            var key = keyOf(look);
            if (!key) return false;
            if (!this.looks.some((item) => keyOf(item) === key)) this.looks.push(look);
            if ((!options || options.choose !== false) && this.chosen.indexOf(key) === -1) this.chosen.push(key);
            this._changed();
            return true;
        }

        toggle(key) {
            if (this.phase !== 'choosing') return false;
            var at = this.chosen.indexOf(key);
            if (at === -1) {
                if (!this.looks.some((look) => keyOf(look) === key)) return false;
                this.chosen.push(key);
            } else {
                this.chosen.splice(at, 1);
            }
            this._changed();
            return true;
        }

        isChosen(key) {
            return this.chosen.indexOf(key) !== -1;
        }

        /** The chosen looks, in the order they were chosen. */
        selected() {
            var byKey = new Map(this.looks.map((look) => [keyOf(look), look]));
            return this.chosen.map((key) => byKey.get(key)).filter(Boolean);
        }

        // ------------------------------------------------------------ running
        async start() {
            if (this.phase !== 'choosing') return false;
            if (!this.selected().length) {
                this._fail('Choose at least one look first.');
                return false;
            }
            var controller = this.controller;
            if (!controller.original && controller.snapshot) controller.snapshot();
            var manager = controller.avatarManager;
            var current = manager && manager.getCurrent ? manager.getCurrent() : null;
            var base = controller.original;
            // Where she was when this haul began, if that was not her base avatar (a kept look).
            this.restorePoint =
                current && current.url && base && base.url && current.url !== base.url
                    ? Object.assign({}, current)
                    : null;
            this.phase = 'running';
            this.index = 0;
            this.target = 0;
            this._changed();
            await this._wearTarget();
            return this.phase === 'running' && !this.error;
        }

        next() {
            return this.go(this.target + 1);
        }

        previous() {
            return this.go(this.target - 1);
        }

        /** Go to look `i` (wrapping). Resolves when she is wearing the newest target. */
        async go(i) {
            if (this.phase !== 'running') return false;
            var total = this.selected().length;
            this.target = ((i % total) + total) % total;
            this._changed();
            return this._wearTarget();
        }

        async _wearTarget() {
            if (this.busy) return this._settled; // the running load picks the new target up
            this.busy = true;
            // Said at once: a VRM takes seconds to load, and a screen that shows the new look's
            // name over the old outfit, with nothing saying it is on its way, looks broken.
            this._changed();
            this._settled = (async () => {
                try {
                    while (this.phase === 'running') {
                        var want = this.target;
                        var look = this.selected()[want];
                        try {
                            await this.controller.applyLook(look);
                            this.index = want;
                            this.error = null;
                        } catch (error) {
                            this.target = this.index;
                            this._fail((error && error.message) || 'That look could not be put on.');
                            return false;
                        }
                        if (this.target === want) return true;
                    }
                    return false;
                } finally {
                    this.busy = false;
                    this._changed();
                }
            })();
            return this._settled;
        }

        /** Keep the look she has on: the haul ends and she is not put back. */
        async keep() {
            if (this.phase !== 'running') return false;
            if (this.busy) await this._settled;
            this.phase = 'kept';
            this._changed();
            return true;
        }

        /** End the haul. Unless she kept a look, she goes back to where the haul began — once. */
        end() {
            if (!this._ending) this._ending = this._end();
            return this._ending;
        }

        async _end() {
            var kept = this.phase === 'kept';
            var ran = this.phase === 'running' || kept;
            if (this.busy) {
                try {
                    await this._settled;
                } catch (_) {
                    /* the load's own failure is already on screen */
                }
            }
            this.phase = 'ended';
            var restored = false;
            if (ran && !kept) {
                try {
                    if (this.restorePoint) {
                        await this.controller.applyLook({
                            vrmUrl: this.restorePoint.url,
                            name: this.restorePoint.name || 'Look',
                        });
                        restored = true;
                    } else {
                        restored = Boolean(await this.controller.restore());
                    }
                } catch (error) {
                    this._fail((error && error.message) || 'She could not be put back.');
                }
            }
            this._changed();
            return { kept: kept, restored: restored };
        }

        // ------------------------------------------------------------ reading
        current() {
            return this.phase === 'running' || this.phase === 'kept' ? this.selected()[this.index] || null : null;
        }

        state() {
            var selected = this.selected();
            return {
                phase: this.phase,
                looks: this.looks.slice(),
                chosen: this.chosen.slice(),
                total: selected.length,
                index: this.index,
                target: this.target,
                look: this.current(),
                going: this.phase === 'running' ? selected[this.target] || null : null,
                busy: this.busy,
                error: this.error,
            };
        }

        _fail(message) {
            this.error = message;
            this._changed();
        }

        _changed() {
            if (!this.onChange) return;
            try {
                this.onChange(this.state());
            } catch (error) {
                console.warn('[Wardrobe] a Try-On listener threw', error);
            }
        }
    }

    var api = { TryOnSession: TryOnSession, PHASES: PHASES, keyOf: keyOf };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_SESSION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
