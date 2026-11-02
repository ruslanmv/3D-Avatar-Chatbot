/**
 * AvatarLoadWatch — L1. When is an avatar load "timed out"?
 *
 * The loader's watchdog used to be a fixed 20 s from the moment loadAvatar() was called. The
 * avatars this site ships are 12–23 MB VRMs, so on a phone the download alone outlasts that:
 * measured against www.yourfriend.online on 2026-11-02 with a 3 Mbps link and a 4× slower CPU,
 * "Avatar load timed out. Try another avatar." appeared at 20 s while the file was still
 * arriving, and she then appeared at 31 s — under a message telling the person to give up on
 * her. The text never moved off "Loading 3D Avatar..." either, so a slow load and a dead one
 * looked the same.
 *
 * So the watchdog now measures a stall, not a duration: it fires only after `stallMs` with no
 * bytes arriving (and, as a backstop, at `maxMs` overall). Every progress event re-arms it and
 * updates the text with the percentage and megabytes. It never cancels the load — it only says
 * something — which is what the old watchdog did too.
 *
 * Pure apart from the timer functions, which are injected, so the rules are tested without a
 * clock or a network.
 */
(function (global) {
    'use strict';

    const STALL_MS = 20000;
    const MAX_MS = 180000;
    const STALL_TEXT = 'Avatar load timed out. Try another avatar.';
    const MB = 1024 * 1024;

    function mb(bytes) {
        return (bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1);
    }

    /** The loading line for `loaded` of `total` bytes. `total` 0 means the size is unknown. */
    function progressText(loaded, total) {
        const l = Math.max(0, Number(loaded) || 0);
        const t = Math.max(0, Number(total) || 0);
        if (t > 0) {
            const pct = Math.min(100, Math.floor((l / t) * 100));
            return `Loading 3D Avatar... ${pct}% (${mb(Math.min(l, t))} of ${mb(t)} MB)`;
        }
        if (l > 0) return `Loading 3D Avatar... ${mb(l)} MB`;
        return 'Loading 3D Avatar...';
    }

    /**
     * One watch per load. `onText(text)` shows a line; `onStall()` runs once when the load has
     * made no progress for `stallMs`, or has run `maxMs` in all. `progress()` after `stop()`
     * does nothing, so a superseded load cannot write over the next one.
     */
    function create(options) {
        const o = options || {};
        const stallMs = o.stallMs || STALL_MS;
        const maxMs = o.maxMs || MAX_MS;
        const later = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
        const cancel = o.clearTimeout || ((id) => clearTimeout(id));
        let stallTimer = null;
        let maxTimer = null;
        let running = false;
        let stalled = false;

        function fire() {
            if (!running || stalled) return;
            stalled = true;
            if (o.onStall) o.onStall();
        }
        function armStall() {
            if (stallTimer !== null) cancel(stallTimer);
            stallTimer = later(fire, stallMs);
        }

        return {
            start() {
                running = true;
                stalled = false;
                armStall();
                if (maxTimer !== null) cancel(maxTimer);
                maxTimer = later(fire, maxMs);
            },
            progress(loaded, total) {
                if (!running) return;
                // Bytes arriving after a stall message: the load is alive again, so is the text.
                stalled = false;
                armStall();
                if (o.onText) o.onText(progressText(loaded, total));
            },
            stop() {
                running = false;
                if (stallTimer !== null) cancel(stallTimer);
                if (maxTimer !== null) cancel(maxTimer);
                stallTimer = maxTimer = null;
            },
            isRunning: () => running,
        };
    }

    const api = { STALL_MS, MAX_MS, STALL_TEXT, progressText, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_AVATAR_LOAD_WATCH = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
