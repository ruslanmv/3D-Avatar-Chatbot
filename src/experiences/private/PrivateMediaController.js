/**
 * PX3. Music inside a Private session: asked for by the person, played in the session's own
 * strip, and described by what the player actually reports.
 *
 * Two paths existed and neither was right for this. `MediaIntent.fulfil` finds a track and
 * publishes it through `ConversationPublisher` — an ordinary chat row with the watch URL in its
 * text, which is what `_persistChat` saves. A Private evening that spilled a YouTube card into
 * the public transcript was a reported bug, and `PlayDirective` answers it by refusing every
 * model-driven change inside Private. The other path, `_startSoundtrack`, plays in the session's
 * strip but only once, at the start, from the mood chosen at setup.
 *
 * This is the second path made reachable during the evening:
 *
 * - **One owner.** `MediaSession` stays the one record of what is playing and the session stays
 *   the one that hands the music back on exit (`_ownsMedia`). The strip is replaced, never added
 *   to: `attachSoundtrack` empties its slot, and `YouTubeEmbed2D.activate` retires the previous
 *   card, so two songs cannot overlap.
 * - **Real results only.** A track comes from the connected search provider or not at all. The
 *   keyless samples `MediaIntent` falls back to are real videos, but they are not what somebody
 *   who asked for Daft Punk asked for; here "nothing found" is said instead.
 * - **Status is the player's.** `playing` is set from `MediaSession`'s own event, which the
 *   YouTube adapter raises when the iframe reports it. Until then the state is `loading`, and
 *   when the browser refuses autoplay it is `blocked` — with one button that starts it from the
 *   person's own tap.
 * - **Nothing applies after the session ends.** Every await is followed by `alive()`.
 *
 * Exposes: window.NEXUS_PRIVATE_MEDIA_CONTROLLER
 */
(function (global) {
    'use strict';

    /** MediaSession's states, as the strip shows them. */
    const FROM_SESSION = Object.freeze({
        loading: 'loading',
        playing: 'playing',
        paused: 'paused',
        ended: 'stopped',
        blocked: 'blocked',
        unconfirmed: 'blocked',
        selected: 'stopped',
    });

    /** How long a tap on play may go unconfirmed before the strip stops saying "starting…". */
    const CONFIRM_MS = 6000;

    class PrivateMediaController {
        /**
         * @param {object} options
         * @param {object} options.win      the window (providers, MediaSession, the embed)
         * @param {object} options.session  the Private session: `view`, `preset`, `_stopped`
         * @param {Function} [options.pick] `TogetherCapability.pickPrivateTrack`, for a request
         *   that named nothing — the evening's mood decides, and a workout mix is not it
         */
        constructor(options) {
            const o = options || {};
            this.win = o.win || global;
            this.session = o.session || null;
            this.pick = typeof o.pick === 'function' ? o.pick : null;
            this.state = { status: 'idle', track: null, why: null };
            this.listeners = new Set();
            this._unwatch = null;
            this._watch();
            // PX8. Ask the search providers now, at the start of the evening, so that "no music
            // search here" is already known when somebody asks — and her reply to that request,
            // built a moment later, can say so instead of "I'm putting it on".
            this._warmed = false;
            try {
                const registry = this.win && this.win.NEXUS_DISCOVERY;
                if (registry && typeof registry.warm === 'function') {
                    Promise.resolve(registry.warm())
                        .then(() => (this._warmed = true))
                        .catch(() => (this._warmed = true));
                } else this._warmed = true;
            } catch (_) {
                this._warmed = true;
            }
        }

        status() {
            const t = this.state.track;
            return {
                status: this.state.status,
                why: this.state.why,
                title: t ? String(t.title || '') : '',
                creator: t ? String(t.creator || '') : '',
                id: t ? String(t.id || '') : '',
            };
        }

        onChange(fn) {
            if (typeof fn !== 'function') return () => {};
            this.listeners.add(fn);
            return () => this.listeners.delete(fn);
        }

        _set(status, why) {
            this.state.status = status;
            this.state.why = why || null;
            const snapshot = this.status();
            for (const fn of [...this.listeners]) {
                try {
                    fn(snapshot);
                } catch (_) {
                    /* one bad listener does not stop the others */
                }
            }
        }

        /** Follow the one record of what is playing; only while it is *this* session's track. */
        _watch() {
            const media = this.win && this.win.NEXUS_MEDIA_SESSION;
            if (!media || typeof media.onChange !== 'function') return;
            this._unwatch = media.onChange((detail) => {
                const now = detail && detail.state;
                const mine = this.state.track;
                if (!mine || !now || !now.current || String(now.current.id) !== String(mine.id)) return;
                const next = FROM_SESSION[now.status];
                // A stop the person asked for stays a stop; the player's own echo does not undo it.
                if (next && next !== this.state.status && this.state.status !== 'failed') this._set(next);
            });
        }

        _provider() {
            const registry = this.win && this.win.NEXUS_DISCOVERY;
            if (!registry || typeof registry.forCapability !== 'function') return null;
            try {
                const provider = registry.forCapability('music.search');
                return provider && typeof provider.search === 'function' ? provider : null;
            } catch (_) {
                return null;
            }
        }

        /**
         * Find something and start it in the session's strip.
         *
         * @param {{query?: string, different?: boolean}} params  `query` empty: she chooses, from
         *   the mood the evening was set up with
         * @param {Function} alive  false once the session ended or the request was superseded
         * @returns {Promise<{ok: boolean, why?: string, track?: object}>}
         */
        async play(params, alive) {
            const p = params || {};
            const stillMine = typeof alive === 'function' ? alive : () => true;
            const session = this.session;
            const view = session && session.view;
            if (!view || typeof view.attachSoundtrack !== 'function') return { ok: false, why: 'no-view' };

            const asked = String(p.query || '').trim();
            const mood = String((session.preset && session.preset.music) || '').trim();
            const query = asked || mood;
            if (!query) return { ok: false, why: 'empty-query' };

            // Known now, and said now: the prompt for this very turn reads the state synchronously.
            if (this._warmed && !this._provider()) {
                this._set(this.state.track ? this._lastKnown() : 'failed', 'no-provider');
                return { ok: false, why: 'no-provider' };
            }
            this._set('searching');
            let found = null;
            try {
                const registry = this.win && this.win.NEXUS_DISCOVERY;
                if (registry && typeof registry.warm === 'function') await registry.warm();
                const provider = this._provider();
                if (!provider) {
                    if (stillMine()) this._set(this.state.track ? this._lastKnown() : 'failed', 'no-provider');
                    return { ok: false, why: 'no-provider' };
                }
                found = await provider.search(query, { max: 5, kind: 'music' });
            } catch (_) {
                if (stillMine()) this._set(this.state.track ? this._lastKnown() : 'failed', 'search-failed');
                return { ok: false, why: 'search-failed' };
            }
            if (!stillMine()) return { ok: false, why: 'stale' };

            const current = this.state.track;
            let results = (Array.isArray(found) ? found : []).filter((r) => r && r.id);
            if (p.different && current) results = results.filter((r) => String(r.id) !== String(current.id));
            // A request that named something gets the provider's first answer for it. One that
            // named nothing gets the first that suits the evening, and silence if none does.
            const track = asked ? results[0] : this.pick ? this.pick(results) : results[0];
            if (!track) {
                this._set(current ? this._lastKnown() : 'failed', 'nothing-found');
                return { ok: false, why: 'nothing-found' };
            }
            // The same track again is not a second player.
            if (
                current &&
                String(current.id) === String(track.id) &&
                ['loading', 'playing'].includes(this._lastKnown())
            ) {
                this._set(this._lastKnown());
                return { ok: true, track, same: true };
            }

            try {
                const media = this.win && this.win.NEXUS_MEDIA_SESSION;
                this.state.track = track;
                if (media && typeof media.requestPlay === 'function') media.requestPlay(track, { source: 'private' });
                view.attachSoundtrack(track);
                // The session hands the music back when it ends, exactly as for a soundtrack
                // chosen at setup.
                session._ownsMedia = true;
                session.track = track;
                this._set('loading');
                return { ok: true, track };
            } catch (_) {
                this._set('failed', 'player-failed');
                return { ok: false, why: 'player-failed' };
            }
        }

        _settleLater() {
            const win = this.win;
            if (!win || typeof win.setTimeout !== 'function') return;
            if (this._settle) win.clearTimeout(this._settle);
            this._settle = win.setTimeout(() => {
                this._settle = null;
                if (this.state.status === 'loading' && this.state.track) this._set(this._lastKnown());
            }, CONFIRM_MS);
        }

        /** What `MediaSession` last said about this track, when a search leaves it untouched. */
        _lastKnown() {
            const media = this.win && this.win.NEXUS_MEDIA_SESSION;
            try {
                const now = media && typeof media.get === 'function' ? media.get() : null;
                const mine = this.state.track;
                if (mine && now && now.current && String(now.current.id) === String(mine.id))
                    return FROM_SESSION[now.status] || 'stopped';
            } catch (_) {
                /* fall through */
            }
            return this.state.track ? 'stopped' : 'idle';
        }

        /** The IFrame-API handle the embed attaches to the strip's card, or null. */
        _handle() {
            const view = this.session && this.session.view;
            const card = view && view._soundtrackCard;
            return (card && card._nexusPlayback) || null;
        }

        pause() {
            if (!this.state.track) return { ok: false, why: 'nothing-playing' };
            const handle = this._handle();
            let done = false;
            try {
                done = Boolean(handle && typeof handle.pause === 'function' && handle.pause());
            } catch (_) {
                done = false;
            }
            if (!done) return { ok: false, why: 'no-player' };
            this._set('paused');
            return { ok: true };
        }

        /**
         * Start it again — and the one way out of `blocked`: called from the person's tap on the
         * strip, `playVideo()` runs inside a user gesture, which is what the browser wanted.
         */
        resume() {
            if (!this.state.track) return { ok: false, why: 'nothing-playing' };
            const handle = this._handle();
            let done = false;
            try {
                done = Boolean(handle && typeof handle.resume === 'function' && handle.resume());
            } catch (_) {
                done = false;
            }
            if (!done) return { ok: false, why: 'no-player' };
            // Not `playing`: the player says so itself, through MediaSession.
            this._set('loading');
            // And if it never says so — the tap did not start it either — the strip must not sit
            // on "starting…" for the rest of the evening: go back to what the record says.
            this._settleLater();
            return { ok: true };
        }

        /**
         * Silence. With a player to talk to it stops and the strip stays; with none (the API never
         * attached) the strip is removed, because taking the iframe away is the one thing that
         * certainly stops a sound nobody can otherwise reach.
         */
        stop() {
            if (!this.state.track) return { ok: false, why: 'nothing-playing' };
            const handle = this._handle();
            let done = false;
            try {
                done = Boolean(handle && typeof handle.stopVideo === 'function' && handle.stopVideo());
            } catch (_) {
                done = false;
            }
            const view = this.session && this.session.view;
            if (!done && view && typeof view.clearSoundtrack === 'function') {
                view.clearSoundtrack();
                this.state.track = null;
            }
            try {
                const media = this.win && this.win.NEXUS_MEDIA_SESSION;
                if (media && typeof media.stop === 'function') media.stop();
            } catch (_) {
                /* stopped either way */
            }
            this._set('stopped');
            return { ok: true };
        }

        dispose() {
            if (this._settle && this.win && typeof this.win.clearTimeout === 'function')
                this.win.clearTimeout(this._settle);
            this._settle = null;
            if (this._unwatch) {
                try {
                    this._unwatch();
                } catch (_) {
                    /* already gone */
                }
            }
            this._unwatch = null;
            this.listeners.clear();
        }
    }

    const api = { PrivateMediaController, FROM_SESSION, CONFIRM_MS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_MEDIA_CONTROLLER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
