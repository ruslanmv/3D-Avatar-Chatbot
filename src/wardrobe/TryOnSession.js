/**
 * W6, LT1. One Try-On haul, played live: what she has on, how she got there, and how it ends.
 *
 * `WardrobeController.tryOnHaul()` already walks a list of looks and puts her back, on a
 * timer. Together's Try-On is the person's own pace instead, so the pacing lives here and
 * the controller keeps what it is for: it is still the only thing that swaps her avatar
 * (`applyLook`) and the only owner of the snapshot it restores (`restore`). This file never
 * calls the viewer.
 *
 * W6 was a selection workflow — tick looks, press Start, then Previous / Next / Keep — and
 * the first thing a person met was a form. LT1 makes it live play: **tapping a look puts it
 * on.** There is no Start; the haul begins with the first thing she wears, and that is the
 * moment the controller is asked for its snapshot. Everything after is a step in one
 * history — Original, Yellow Sundress, Crop top & jeans, Black top & jeans — so Undo,
 * Compare and "go back" are natural, and nobody loses a good look because they
 * experimented after it.
 *
 * Things this state machine is careful about:
 *
 * - **Navigation faster than loading.** A VRM takes a moment to load, and a person taps
 *   three looks in that moment. Every tap moves the target; one load runs at a time; when
 *   it lands, the newest target is loaded next and the ones in between are skipped. A
 *   skipped look was never on screen, so it never enters the history: a wear that has not
 *   landed yet is the history's *pending* head, and the next tap replaces it rather than
 *   stacking on it. W6 kept this behaviour and so does LT1 — it is the hard part.
 *
 * - **Compare is not a step.** "Hold to see the original", or Previous ↔ Current, puts the
 *   other look on without touching the history; letting go goes back to the head. A
 *   compare that outlives a wear, an undo or Keep is simply cancelled by them.
 *
 * - **Favourite is not Keep.** A heart marks a look and the haul goes on; four hearts and a
 *   decision at the end is the point. Keep is the decision: the haul ends and she stays in
 *   it. The favourites are also what Show Mode plays, once there are two of them.
 *
 * - **What "restore" means after Keep.** The controller's snapshot is her base avatar —
 *   and it must stay that, because a new look is made from the base avatar, which is what
 *   Forge knows (see AvatarIdentity). But a person who kept a look in an earlier haul and
 *   ends this one expects that look back, not the base avatar. So the session notes where
 *   she was when *this* haul began and, if that was a kept look, "Original" means that look
 *   — worn through `applyLook` — and only otherwise does it ask the controller to
 *   `restore()`.
 *
 * End is idempotent — the panel's Stop, the view's End button and a page navigation can
 * all ask — and restores exactly once. A haul in which she never wore anything ends
 * without touching her.
 *
 * Exposes: window.NEXUS_TRY_ON_SESSION
 */
(function (global) {
    'use strict';

    var PHASES = Object.freeze(['live', 'kept', 'ended']);
    var ORIGINAL_KEY = '__original__';
    var ORIGINAL = Object.freeze({ key: ORIGINAL_KEY, name: 'Original', original: true });
    var PLAY_INTERVAL_MS = 4500;

    function keyOf(look) {
        return (look && (look.key || look.id || look.vrmUrl)) || null;
    }

    function isOriginal(look) {
        return Boolean(look && look.original);
    }

    class TryOnSession {
        /**
         * options.controller   a WardrobeController (applyLook, restore, snapshot, original)
         * options.onChange     called with state() after every change
         * options.timers       {setTimeout, clearTimeout}, injected for tests (Show Mode)
         */
        constructor(options) {
            options = options || {};
            this.controller = options.controller;
            this.onChange = options.onChange || null;
            this.timers = options.timers || {
                setTimeout: function (fn, ms) {
                    return setTimeout(fn, ms);
                },
                clearTimeout: function (id) {
                    clearTimeout(id);
                },
            };
            this.phase = 'live';
            this.looks = [];
            this.history = [];
            this.favorites = [];
            this.worn = null; // what she actually has on, once the haul began
            this.target = null; // what she is going to have on
            this.comparing = null; // null | 'original' | 'previous'
            this.began = false;
            this.busy = false;
            this.error = null;
            this.restorePoint = null;
            this.landed = 0; // counts arrivals, so a view can play a reveal for each
            this.lastLanding = null; // {look, cause}
            this.playing = false;
            this._pending = false; // the history's head was asked for and has not landed
            this._timer = null;
            this._settled = Promise.resolve(true);
            this._ending = null;
        }

        // ------------------------------------------------------------ the shelf
        setLooks(looks) {
            this.looks = (looks || []).filter(function (look) {
                return keyOf(look);
            });
            var known = new Set(this.looks.map(keyOf));
            this.favorites = this.favorites.filter(function (key) {
                return known.has(key);
            });
            this._changed();
        }

        /** A look made during the haul: put on the shelf (at the end), not worn — `wear` does that. */
        add(look) {
            var key = keyOf(look);
            if (!key) return false;
            if (!this.looks.some((item) => keyOf(item) === key)) this.looks.push(look);
            this._changed();
            return true;
        }

        find(key) {
            return this.looks.find((look) => keyOf(look) === key) || null;
        }

        // ------------------------------------------------------------ wearing
        /** The look at the head of the history: what the haul is on, compare aside. */
        head() {
            return this.history.length ? this.history[this.history.length - 1] : null;
        }

        /**
         * Put a look on — a look object or the key of one on the shelf. The haul begins with
         * the first one. Resolves when she is wearing the newest target.
         */
        wear(lookOrKey, options) {
            options = options || {};
            if (this.phase !== 'live') return Promise.resolve(false);
            var look = typeof lookOrKey === 'string' ? this.find(lookOrKey) : lookOrKey;
            if (!keyOf(look)) return Promise.resolve(false);
            if (!options.fromPlay) this.pause();
            this._begin();
            this.comparing = null;
            // A head that never landed was skipped: this tap replaces it rather than stacking.
            if (this._pending && this.history.length > 1) this.history.pop();
            var head = this.head();
            if (keyOf(head) === keyOf(look)) {
                // Already the head (back to what she has on, or a compare showing something
                // else): go there without a second entry for the same look.
                this._pending = keyOf(this.worn) !== keyOf(head);
                return this._go(head, options.cause || 'wear');
            }
            this.history.push(look);
            this._pending = true;
            return this._go(look, options.cause || 'wear');
        }

        /** The next look on the shelf after the one she has on (wrapping). */
        next() {
            return this._step(1);
        }

        /** The look before it ("go back"). Not Undo: Undo walks the history, this the shelf. */
        previous() {
            return this._step(-1);
        }

        _step(delta, options) {
            var list = (options && options.list) || this.looks;
            if (!list.length) return Promise.resolve(false);
            var at = this._position(list);
            var i =
                at === -1
                    ? delta > 0
                        ? 0
                        : list.length - 1
                    : (((at + delta) % list.length) + list.length) % list.length;
            return this.wear(list[i], options);
        }

        _position(list) {
            var head = this.head();
            var key = head && !isOriginal(head) ? keyOf(head) : null;
            if (!key) return -1;
            for (var i = 0; i < list.length; i += 1) if (keyOf(list[i]) === key) return i;
            return -1;
        }

        /** Back one step in the history: the look before this one, or the original. */
        undo() {
            if (this.phase !== 'live' || this.history.length < 2) return Promise.resolve(false);
            this.pause();
            this.comparing = null;
            this.history.pop();
            this._pending = false;
            return this._go(this.head(), 'undo');
        }

        /**
         * Show the original (or the previous step) for a moment, without changing the history.
         * `which`: 'original' | 'previous'. Ended by `compareEnd()`, or by any wear/undo/keep.
         */
        compare(which) {
            if (this.phase !== 'live' || !this.began) return Promise.resolve(false);
            var other = this._compareTarget(which);
            if (!other) return Promise.resolve(false);
            this.pause();
            this.comparing = which;
            return this._go(other, 'compare');
        }

        compareEnd() {
            if (!this.comparing) return Promise.resolve(false);
            this.comparing = null;
            return this._go(this.head(), 'compare-end');
        }

        /** Tap-to-toggle: the same button starts and ends a compare. */
        toggleCompare(which) {
            return this.comparing === which ? this.compareEnd() : this.compare(which);
        }

        _compareTarget(which) {
            if (which === 'original') return isOriginal(this.head()) ? null : ORIGINAL;
            if (which === 'previous') return this.history.length >= 2 ? this.history[this.history.length - 2] : null;
            return null;
        }

        canCompare(which) {
            return this.phase === 'live' && this.began && Boolean(this._compareTarget(which));
        }

        _begin() {
            if (this.began) return;
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
            this.began = true;
            this.worn = ORIGINAL;
            this.history = [ORIGINAL];
        }

        /** Put "the original" on: the look this haul began in, else her base avatar. */
        _wearOriginal() {
            if (this.restorePoint) {
                return this.controller.applyLook({
                    vrmUrl: this.restorePoint.url,
                    name: this.restorePoint.name || 'Look',
                });
            }
            return this.controller.restore();
        }

        _go(look, cause) {
            this.target = look;
            this._cause = cause;
            this.error = null;
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
                    while (this.phase === 'live') {
                        var want = this.target;
                        var cause = this._cause;
                        if (!want) return false;
                        if (keyOf(want) !== keyOf(this.worn)) {
                            try {
                                if (isOriginal(want)) await this._wearOriginal();
                                else await this.controller.applyLook(want);
                            } catch (error) {
                                this._failed((error && error.message) || 'That look could not be put on.');
                                return false;
                            }
                            this.worn = want;
                            if (this.target === want) {
                                this.landed += 1;
                                this.lastLanding = { look: want, cause: cause };
                            }
                        }
                        if (this.target === want) {
                            if (want === this.head()) this._pending = false;
                            this._schedulePlay();
                            return true;
                        }
                    }
                    return false;
                } finally {
                    this.busy = false;
                    this._changed();
                }
            })();
            return this._settled;
        }

        /** A load failed: she is still in `worn`, so the history and the target say that again. */
        _failed(message) {
            if (this._pending && this.history.length > 1) this.history.pop();
            this._pending = false;
            if (this.worn && keyOf(this.head()) !== keyOf(this.worn) && !this.comparing) this.history.push(this.worn);
            this.comparing = null;
            this.target = this.worn;
            this.pause();
            this._fail(message);
        }

        // ------------------------------------------------------------ favourites
        /** Heart (or un-heart) a look — the one she has on when no key is given. */
        favorite(key) {
            var head = this.head();
            key = key || (head && !isOriginal(head) ? keyOf(head) : null);
            if (!key || key === ORIGINAL_KEY) return false;
            var at = this.favorites.indexOf(key);
            if (at === -1) this.favorites.push(key);
            else this.favorites.splice(at, 1);
            this._changed();
            return at === -1;
        }

        isFavorite(key) {
            return this.favorites.indexOf(key) !== -1;
        }

        // ------------------------------------------------------------ Show Mode
        /** The looks Show Mode plays: her favourites once there are two, else the whole shelf. */
        playlist() {
            if (this.favorites.length >= 2) {
                return this.favorites.map((key) => this.find(key)).filter(Boolean);
            }
            return this.looks.slice();
        }

        /** ▶ Play the haul: the next look every few seconds, until any other action. */
        play(options) {
            if (this.phase !== 'live' || this.playlist().length < 2) return false;
            this.playInterval = (options && options.interval) || PLAY_INTERVAL_MS;
            this.playing = true;
            this._changed();
            this._advance();
            return true;
        }

        pause() {
            if (this._timer) this.timers.clearTimeout(this._timer);
            this._timer = null;
            if (!this.playing) return false;
            this.playing = false;
            this._changed();
            return true;
        }

        _advance() {
            if (!this.playing) return;
            this._step(1, { list: this.playlist(), fromPlay: true, cause: 'play' });
        }

        _schedulePlay() {
            if (!this.playing || this._timer) return;
            this._timer = this.timers.setTimeout(() => {
                this._timer = null;
                this._advance();
            }, this.playInterval || PLAY_INTERVAL_MS);
        }

        // ------------------------------------------------------------ ending
        /** Keep the look she has on: the haul ends and she is not put back. */
        async keep() {
            if (this.phase !== 'live') return false;
            this.pause();
            if (this.comparing) await this.compareEnd();
            if (this.busy) await this._settled;
            var head = this.head();
            if (!head || isOriginal(head) || keyOf(this.worn) !== keyOf(head)) {
                this._fail('Put a look on first, then keep it.');
                return false;
            }
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
            this.pause();
            var kept = this.phase === 'kept';
            if (this.busy) {
                try {
                    await this._settled;
                } catch (_) {
                    /* the load's own failure is already on screen */
                }
            }
            this.phase = 'ended';
            this.comparing = null;
            var restored = false;
            if (this.began && !kept) {
                try {
                    if (!isOriginal(this.worn)) await this._wearOriginal();
                    this.worn = ORIGINAL;
                    restored = true;
                } catch (error) {
                    this._fail((error && error.message) || 'She could not be put back.');
                }
            }
            this._changed();
            return { kept: kept, restored: restored };
        }

        // ------------------------------------------------------------ reading
        /** The look the haul is on (not a compare), or null while she is in her original. */
        current() {
            var head = this.head();
            return head && !isOriginal(head) ? head : null;
        }

        state() {
            var head = this.head();
            var look = this.current();
            return {
                phase: this.phase,
                looks: this.looks.slice(),
                look: look,
                worn: this.worn,
                going: this.busy ? this.target : null,
                began: this.began,
                original: !look,
                history: this.history.map(function (item) {
                    return { key: keyOf(item), name: item.name || 'Look', original: isOriginal(item) };
                }),
                canUndo: this.phase === 'live' && this.history.length >= 2,
                canCompare: {
                    original: this.canCompare('original'),
                    previous: this.canCompare('previous'),
                },
                comparing: this.comparing,
                favorites: this.favorites.slice(),
                favorite: Boolean(look && this.isFavorite(keyOf(look))),
                playing: this.playing,
                position: this._position(this.looks),
                total: this.looks.length,
                busy: this.busy,
                landed: this.landed,
                lastLanding: this.lastLanding,
                error: this.error,
                head: head,
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

    var api = {
        TryOnSession: TryOnSession,
        PHASES: PHASES,
        ORIGINAL: ORIGINAL,
        PLAY_INTERVAL_MS: PLAY_INTERVAL_MS,
        keyOf: keyOf,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_SESSION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
