/**
 * AnimationResolver — Clip-first animation routing for dance and gestures.
 *
 * Routes animation intents to BVH/VRMA clips first, falling back to
 * procedural modes only when no clip is available.
 *
 * Production notes:
 * - Prevents stale async play requests from overriding newer clicks
 * - Stops active clip safely before starting a new one
 * - Disables procedural mixer overlays during clip playback
 * - Falls back cleanly to procedural modes when clip playback fails
 *
 * Exposes: window.NEXUS_ANIMATION_RESOLVER
 */
(function (global) {
    'use strict';

    var CLIPS = null;
    var PROC = null;

    var currentIntent = null;
    var currentClip = null;
    var clipPlaying = false;
    var requestToken = 0;

    function getClips() {
        if (!CLIPS) CLIPS = global.NEXUS_CLIP_LOADER || null;
        return CLIPS;
    }

    function getProc() {
        if (!PROC) PROC = global.NEXUS_PROCEDURAL_ANIMATOR || null;
        return PROC;
    }

    function getPresets() {
        return global.NEXUS_ANIMATION_PRESETS || null;
    }

    function log() {
        if (global.console && typeof global.console.log === 'function') {
            global.console.log.apply(global.console, arguments);
        }
    }

    function warn() {
        if (global.console && typeof global.console.warn === 'function') {
            global.console.warn.apply(global.console, arguments);
        }
    }

    function hasFunction(obj, fnName) {
        return !!(obj && typeof obj[fnName] === 'function');
    }

    function pickRandomFile(files) {
        if (!Array.isArray(files) || files.length === 0) return null;
        var index = Math.floor(Math.random() * files.length);
        return files[index];
    }

    function setProceduralMode(mode, duration) {
        var proc = getProc();
        if (hasFunction(proc, 'setMode')) {
            proc.setMode(mode, duration || 0);
        }
    }

    function setAllowWithMixer(allow) {
        var proc = getProc();
        if (hasFunction(proc, 'setAllowWithMixer')) {
            proc.setAllowWithMixer(!!allow);
        }
    }

    function clearState() {
        currentIntent = null;
        currentClip = null;
        clipPlaying = false;
    }

    function setState(intent, clipPath, isPlaying) {
        currentIntent = intent || null;
        currentClip = clipPath || null;
        clipPlaying = !!isPlaying;
    }

    async function stopActiveClip() {
        var clips = getClips();
        if (!clips || !clipPlaying) return;

        try {
            if (hasFunction(clips, 'stopClip')) {
                await clips.stopClip();
            }
        } catch (err) {
            warn('[AnimResolver] Failed to stop active clip:', err);
        }
    }

    async function tryPlayClip(clips, file, loop) {
        if (!clips || !hasFunction(clips, 'playClip')) return false;

        try {
            var result = await clips.playClip(file, loop);
            return !!result;
        } catch (err) {
            warn('[AnimResolver] Clip playback failed for', file, err);
            return false;
        }
    }

    /**
     * Play a semantic intent (e.g. 'dance').
     *
     * opts:
     * - fallbackMode: procedural fallback mode
     * - duration: fallback duration
     * - loop: override clip loop behavior
     *
     * @param {string} intent
     * @param {object=} opts
     * @returns {Promise<boolean>}
     */
    async function play(intent, opts) {
        opts = opts || {};

        var clips = getClips();
        var proc = getProc();
        var presets = getPresets();
        var myToken = ++requestToken;

        if (!intent || typeof intent !== 'string') {
            warn('[AnimResolver] play() called without a valid intent');
            return false;
        }

        var clipIntents = presets && presets.CLIP_INTENTS ? presets.CLIP_INTENTS : null;
        var intentDef = clipIntents ? clipIntents[intent] : null;

        await stopActiveClip();

        // If another play() happened while we were stopping, abort this request.
        if (myToken !== requestToken) {
            return false;
        }

        // No semantic clip config: procedural fallback only.
        if (!intentDef) {
            var noIntentFallback = opts.fallbackMode || 'waiting';

            log('[AnimResolver] No intent config for:', intent, '-> fallback:', noIntentFallback);

            setAllowWithMixer(false);
            setProceduralMode(noIntentFallback, opts.duration || 0);
            setState(intent, null, false);
            return false;
        }

        var files = Array.isArray(intentDef.preferredFiles) ? intentDef.preferredFiles : [];
        var selectedFile = pickRandomFile(files);
        var loop = typeof opts.loop === 'boolean' ? opts.loop : intentDef.loop !== false;

        if (clips && selectedFile) {
            log('[AnimResolver] Trying clip for intent:', intent, '->', selectedFile, loop ? '(loop)' : '(once)');

            var ok = await tryPlayClip(clips, selectedFile, loop);

            // If a newer request happened while awaiting playback, stop this one immediately.
            if (myToken !== requestToken) {
                try {
                    await stopActiveClip();
                } catch (_) {}
                return false;
            }

            if (ok) {
                // Do not let procedural animation fight the clip.
                setAllowWithMixer(false);

                // Keep procedural system in a neutral low-impact state.
                if (proc && hasFunction(proc, 'setMode')) {
                    proc.setMode('idle', 1);
                }

                setState(intent, selectedFile, true);
                log('[AnimResolver] Clip playback active for intent:', intent, '->', selectedFile);
                return true;
            }
        }

        // Clip unavailable or failed: clean procedural fallback.
        var fallbackMode = intentDef.fallbackMode || opts.fallbackMode || 'waiting';

        log('[AnimResolver] Clip unavailable for intent:', intent, '-> fallback:', fallbackMode);

        setAllowWithMixer(false);
        setProceduralMode(fallbackMode, opts.duration || 15000);
        setState(intent, null, false);

        return false;
    }

    /**
     * Stop the current intent and return to waiting idle.
     */
    async function stop() {
        requestToken++;

        await stopActiveClip();

        setAllowWithMixer(false);
        setProceduralMode('waiting', 0);
        clearState();
    }

    /**
     * Get current resolver state.
     */
    function getCurrentState() {
        return {
            intent: currentIntent,
            clip: currentClip,
            clipPlaying: clipPlaying,
        };
    }

    global.NEXUS_ANIMATION_RESOLVER = {
        play: play,
        stop: stop,
        getCurrentState: getCurrentState,
    };

    log('[AnimationResolver] Initialized - clip-first animation routing');
})(window);
