/**
 * What the YouTube player is actually doing (batch M2).
 *
 * `MediaSession` distinguishes "chosen" from "playing". This is the half that can tell the
 * difference — everything else in the app can only report what it *asked* for.
 *
 * The iframe is a cross-origin document; nothing on the page can read it. YouTube's IFrame
 * Player API is the supported way to hear back from it, and it needs two things: the embed
 * URL must carry `enablejsapi=1` (see `YouTubeLink.embedUrl`), and the API script must be
 * loaded. So the script is fetched lazily, on the first actual playback, and never on a page
 * where nobody presses play.
 *
 * ## Why the states are copied rather than interpreted
 *
 * `PLAYING`, `PAUSED` and `ENDED` map one-to-one onto `markPlaying`, `markPaused` and
 * `markEnded`. `BUFFERING` deliberately maps to nothing: it is a moment inside playback, not
 * a state of the session, and treating it as "not playing" would make the avatar stop and
 * start every time a phone changed cell.
 *
 * `UNSTARTED` is the interesting one. A player that is asked to autoplay and is still
 * unstarted a moment later has been refused — that is what an autoplay policy looks like from
 * inside the page — so after a grace period it becomes `markBlocked()`, and the app says "tap
 * Play" instead of claiming sound is coming out of a silent tab.
 *
 * ## Failure is not an error here
 *
 * Every path degrades to doing nothing: a blocked script, an old browser, an iframe that
 * never initialises. The card still plays exactly as it did before this file existed — the
 * app simply goes back to not knowing, which is where it was. Nothing here is allowed to be
 * the reason a video does not start.
 *
 * Exposes: window.NEXUS_YT_PLAYBACK
 */
(function (global) {
    'use strict';

    const API_SRC = 'https://www.youtube.com/iframe_api';

    /**
     * How long a player may sit unstarted after being asked to autoplay before the app
     * concludes the browser refused.
     *
     * Long enough for a slow network to get the first frame, short enough that somebody
     * staring at a silent card is not told it is playing for the whole time.
     */
    const BLOCKED_AFTER_MS = 4000;

    let loading = null;

    function session() {
        return (global && global.NEXUS_MEDIA_SESSION) || null;
    }

    /**
     * Load YouTube's IFrame API once.
     *
     * Resolves with the `YT` global, or `null` if it cannot be had. It never rejects: a caller
     * that cannot observe playback carries on without observing playback.
     */
    function loadApi() {
        if (!global || !global.document) {
            return Promise.resolve(null);
        }
        if (global.YT && global.YT.Player) {
            return Promise.resolve(global.YT);
        }
        if (loading) {
            return loading;
        }
        loading = new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
                if (!settled) {
                    settled = true;
                    resolve(value);
                }
            };
            // The API calls this global when it is ready. Chained rather than replaced: another
            // feature may have registered one, and stealing it would break that feature
            // silently.
            const prior = global.onYouTubeIframeAPIReady;
            global.onYouTubeIframeAPIReady = function () {
                if (typeof prior === 'function') {
                    try {
                        prior();
                    } catch (_) {
                        /* not ours to fix */
                    }
                }
                done(global.YT || null);
            };
            try {
                const d = global.document;
                const existing = d.querySelector(`script[src="${API_SRC}"]`);
                if (!existing) {
                    const el = d.createElement('script');
                    el.src = API_SRC;
                    el.async = true;
                    el.onerror = () => done(null);
                    (d.head || d.documentElement).appendChild(el);
                }
            } catch (_) {
                done(null);
            }
            // A network that swallows the script would otherwise leave every caller waiting
            // for a promise that never settles.
            if (typeof global.setTimeout === 'function') {
                global.setTimeout(() => done(global.YT || null), 8000);
            }
        });
        return loading;
    }

    /**
     * Watch one iframe and report what it does.
     *
     * Returns a handle with `stop()`, plus `pause`/`resume`/`stopVideo` so a caller that has
     * the handle can drive the player it is watching. `null` when the player could not be
     * attached, which is not an error — see the header.
     */
    async function attach(frame, { onState = null } = {}) {
        if (!frame) {
            return null;
        }
        const YT = await loadApi();
        if (!YT || !YT.Player) {
            return null;
        }

        let player = null;
        let blockedTimer = null;
        let sawPlaying = false;

        const clearBlockedTimer = () => {
            if (blockedTimer !== null && typeof global.clearTimeout === 'function') {
                global.clearTimeout(blockedTimer);
            }
            blockedTimer = null;
        };

        const report = (name) => {
            const s = session();
            if (s) {
                const method = {
                    playing: 'markPlaying',
                    paused: 'markPaused',
                    ended: 'markEnded',
                    blocked: 'markBlocked',
                }[name];
                try {
                    if (method && typeof s[method] === 'function') {
                        s[method]();
                    }
                } catch (_) {
                    /* the session refusing an update is not the player's problem */
                }
            }
            if (typeof onState === 'function') {
                try {
                    onState(name);
                } catch (_) {
                    /* nor a listener's */
                }
            }
        };

        try {
            player = new YT.Player(frame, {
                events: {
                    onReady: () => {
                        // Asked to autoplay and still unstarted after a grace period means the
                        // browser refused. That is a state worth having: the app says "tap
                        // Play" rather than claiming sound is coming out of a silent tab.
                        if (typeof global.setTimeout === 'function') {
                            blockedTimer = global.setTimeout(() => {
                                if (!sawPlaying) {
                                    report('blocked');
                                }
                            }, BLOCKED_AFTER_MS);
                        }
                    },
                    onStateChange: (event) => {
                        const S = YT.PlayerState || {};
                        const value = event && event.data;
                        if (value === S.PLAYING) {
                            sawPlaying = true;
                            clearBlockedTimer();
                            report('playing');
                        } else if (value === S.PAUSED) {
                            clearBlockedTimer();
                            report('paused');
                        } else if (value === S.ENDED) {
                            clearBlockedTimer();
                            report('ended');
                        }
                        // BUFFERING is a moment inside playback, not a state of the session.
                        // Reporting it would make the avatar stop and start every time a phone
                        // changed cell.
                    },
                },
            });
        } catch (_) {
            return null;
        }

        const call = (name) => {
            try {
                if (player && typeof player[name] === 'function') {
                    player[name]();
                    return true;
                }
            } catch (_) {
                /* a player that has gone away is not a crash */
            }
            return false;
        };

        return {
            player,
            pause: () => call('pauseVideo'),
            resume: () => call('playVideo'),
            stopVideo: () => call('stopVideo'),
            stop() {
                clearBlockedTimer();
                try {
                    if (player && typeof player.destroy === 'function') {
                        player.destroy();
                    }
                } catch (_) {
                    /* already gone */
                }
                player = null;
            },
        };
    }

    const api = { API_SRC, BLOCKED_AFTER_MS, loadApi, attach };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_YT_PLAYBACK = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
