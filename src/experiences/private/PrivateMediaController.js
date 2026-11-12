/**
 * Music inside a Private session, without publishing into the ordinary chat (SAE).
 *
 * The ordinary player finds a track and then posts a card into the transcript.
 * That card is a chat message, and a chat message is what gets stored. Private's
 * promise is that the evening stays on its own card, so this controller searches
 * through the same intent and then draws with the session's own soundtrack strip.
 *
 * Playback is reported only when the player says it started. A browser that
 * blocks autoplay leaves a Play control and a loading state — the status line
 * does not say the song is on while the room is silent. The previous player is
 * stopped before a new one starts, so two requests cannot both be audible.
 *
 * Nothing here writes the consent level, the room, or the Private transcript.
 *
 * Exposes: window.NEXUS_PRIVATE_MEDIA
 */
(function (global) {
    'use strict';

    var MOOD_QUERY = 'slow intimate lounge instrumental ambient';
    var listeners = [];

    function pick(name) {
        return global && global[name] ? global[name] : null;
    }

    function phrase(key, fallback) {
        var locale = pick('NEXUS_PRIVATE_LOCALE');
        try {
            if (locale && typeof locale.t === 'function') {
                var said = locale.t(key);
                if (said && said !== key) return said;
            }
        } catch (_) {
            /* a missing pack is not a reason to skip the status */
        }
        return fallback;
    }

    function isMoodQuery(query) {
        var q = String(query || '')
            .trim()
            .toLowerCase();
        if (!q) return true;
        if (/^(?:music|musica|a song|something|qualcosa|un po' di musica|della musica)$/.test(q)) return true;
        return /^(?:(?:something|some|a little|un po' di|qualcosa di|qualcosa)\s+)?(?:relax\w*|rilass\w*|calm|soft|ambient|romantic|intimat\w*)(?:\s+(?:music|musica))?$/.test(
            q
        );
    }

    function searchQuery(query) {
        return isMoodQuery(query) ? MOOD_QUERY : String(query || '').trim();
    }

    /**
     * The track that may actually start.
     *
     * A mood request refuses a title that is for the gym or a study session, the
     * same rule the evening's own soundtrack uses. A named request — "Daft Punk" —
     * keeps the first playable hit, because the person named it.
     */
    function chooseTrack(results, query) {
        var list = Array.isArray(results) ? results.filter(Boolean) : [];
        if (!list.length) return null;
        if (!isMoodQuery(query)) return list[0];
        var capability = pick('NEXUS_TOGETHER_CAPABILITY');
        try {
            if (capability && typeof capability.pickPrivateTrack === 'function') {
                return capability.pickPrivateTrack(list) || null;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function viewOf(deps, request) {
        if (deps && deps.view) return deps.view;
        if (request && request.view) return request.view;
        var capability = pick('NEXUS_TOGETHER_CAPABILITY');
        try {
            var snap = capability && capability.privateSessionSnapshot && capability.privateSessionSnapshot();
            return snap && snap.view;
        } catch (_) {
            return null;
        }
    }

    function still(deps, sessionId) {
        if (deps && typeof deps.still === 'function') {
            try {
                return deps.still(sessionId) === true;
            } catch (_) {
                return false;
            }
        }
        var bridge = pick('NEXUS_PRIVATE_ACTION_BRIDGE');
        try {
            if (bridge && typeof bridge.sessionStill === 'function') return bridge.sessionStill(sessionId) === true;
        } catch (_) {
            return false;
        }
        return true;
    }

    function show(view, fields) {
        if (!view || typeof view.showSeamlessStatus !== 'function') return null;
        try {
            return view.showSeamlessStatus(fields);
        } catch (_) {
            return null;
        }
    }

    function stopPrevious(deps) {
        var embed = (deps && deps.embed) || pick('NEXUS_YT_2D');
        try {
            if (embed && typeof embed.control === 'function') embed.control('stop');
        } catch (_) {
            /* a player that will not stop is replaced by the next card anyway */
        }
    }

    function watch(session, view, track, sessionId, deps) {
        if (!session || typeof session.onChange !== 'function') return function () {};
        var off = function () {};
        var seen = false;
        off = session.onChange(function (detail) {
            if (seen) return;
            if (!still(deps, sessionId)) {
                seen = true;
                try {
                    off();
                } catch (_) {
                    /* already gone */
                }
                return;
            }
            var status = detail && detail.state && detail.state.status;
            if (status === 'playing') {
                seen = true;
                show(view, {
                    kicker: phrase('action.musicPlaying', 'Music playing'),
                    title: track.title || phrase('soundtrack.fallback', 'Music'),
                    detail: track.creator || '',
                });
                try {
                    off();
                } catch (_) {
                    /* the status is already the confirmation */
                }
            } else if (status === 'blocked') {
                seen = true;
                show(view, {
                    kicker: phrase('action.musicBlocked', 'Tap Play to start the music'),
                    title: track.title || phrase('soundtrack.fallback', 'Music'),
                    detail: '',
                    playLabel: phrase('action.play', 'Play'),
                    onPlay: function () {
                        retry(deps, view, track);
                    },
                });
                try {
                    off();
                } catch (_) {
                    /* the button is the rest of the recovery */
                }
            }
        });
        listeners.push(off);
        return off;
    }

    function retry(deps, view, track) {
        var embed = (deps && deps.embed) || pick('NEXUS_YT_2D');
        var card = view && view._soundtrackCard;
        var video = {
            id: String(track.id || ''),
            name: String(track.title || ''),
            author: String(track.creator || ''),
        };
        try {
            if (embed && card && typeof embed.activate === 'function') embed.activate(card, video);
        } catch (_) {
            /* the card's own control remains */
        }
    }

    function blocked(reason) {
        return { ok: false, status: 'blocked', reason: reason };
    }

    async function play(request, deps) {
        var req = request || {};
        var args = req.args || {};
        var sessionId = req.sessionId;
        if (args.resume) return transport('resume', req, deps);
        var query = String(args.query || '').trim();
        if (!query) return { ok: false, status: 'failed', reason: 'empty-query' };
        if (!still(deps, sessionId)) return blocked('session-ended');
        var intent = (deps && deps.intent) || pick('NEXUS_MEDIA_INTENT');
        if (!intent || typeof intent.search !== 'function')
            return { ok: false, status: 'failed', reason: 'no-provider' };
        var view = viewOf(deps, req);
        show(view, { kicker: phrase('action.musicSearching', 'Looking for a song…'), title: query, detail: '' });
        var found = null;
        try {
            found = await intent.search(searchQuery(query), 'music');
        } catch (_) {
            found = null;
        }
        if (!still(deps, sessionId)) return blocked('session-ended');
        if (found == null) return { ok: false, status: 'failed', reason: 'search-failed' };
        var track = chooseTrack(found, query);
        if (!track) return { ok: false, status: 'failed', reason: 'nothing-suitable' };
        stopPrevious(deps);
        var media = (deps && deps.media) || pick('NEXUS_MEDIA_SESSION');
        try {
            if (media && typeof media.requestPlay === 'function') media.requestPlay(track, { source: 'private' });
        } catch (_) {
            /* the strip can still start; the session is the record, not the sound */
        }
        if (view && typeof view.attachSoundtrack === 'function') {
            try {
                view.attachSoundtrack(track, { play: true });
            } catch (_) {
                /* a strip that cannot draw still leaves the session honest */
            }
        }
        watch(media, view, track, sessionId, deps);
        var confirmed = false;
        try {
            confirmed = Boolean(media && typeof media.isPlaying === 'function' && media.isPlaying());
        } catch (_) {
            confirmed = false;
        }
        if (confirmed) {
            show(view, {
                kicker: phrase('action.musicPlaying', 'Music playing'),
                title: track.title || query,
                detail: track.creator || '',
            });
        }
        return {
            ok: true,
            status: confirmed ? 'completed' : 'pending',
            reason: confirmed ? '' : 'awaiting-player',
            track: track,
        };
    }

    function transport(move, request, deps) {
        var sessionId = request && request.sessionId;
        if (!still(deps, sessionId)) return blocked('session-ended');
        var embed = (deps && deps.embed) || pick('NEXUS_YT_2D');
        try {
            if (embed && typeof embed.control === 'function') embed.control(move);
        } catch (_) {
            /* the session state below is still updated */
        }
        var media = (deps && deps.media) || pick('NEXUS_MEDIA_SESSION');
        try {
            if (move === 'pause' && media && typeof media.markPaused === 'function') media.markPaused();
            if (move === 'stop' && media && typeof media.stop === 'function') media.stop();
            if (move === 'resume' && media && typeof media.requestPlay === 'function')
                media.requestPlay(null, { source: 'private' });
        } catch (_) {
            /* a bookkeeping miss does not restart the previous publisher */
        }
        var view = viewOf(deps, request);
        var key = move === 'pause' || move === 'stop' ? 'action.musicStopped' : 'action.musicSearching';
        var fallback = move === 'resume' ? 'Looking for a song…' : 'Music stopped';
        show(view, { kicker: phrase(key, fallback), title: '', detail: '' });
        return { ok: true, status: 'completed', reason: move };
    }

    async function execute(request, deps) {
        var kind = request && request.kind;
        if (kind === 'music.pause') return transport('pause', request, deps);
        if (kind === 'music.stop') return transport('stop', request, deps);
        if (kind === 'music.play') return play(request, deps);
        return { ok: false, status: 'blocked', reason: 'not-authorized' };
    }

    function reset() {
        listeners.splice(0).forEach(function (off) {
            try {
                off();
            } catch (_) {
                /* a listener that already left */
            }
        });
    }

    var api = {
        MOOD_QUERY: MOOD_QUERY,
        isMoodQuery: isMoodQuery,
        searchQuery: searchQuery,
        chooseTrack: chooseTrack,
        play: play,
        execute: execute,
        reset: reset,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_MEDIA = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
