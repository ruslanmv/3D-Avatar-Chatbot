/**
 * MotionClipMap — resolves motion command names ("wave", "sit", "handshake")
 * to real animation files and plays them through NEXUS_CLIP_LOADER.
 *
 * Every entry has a fallback chain, so the system degrades gracefully:
 * the app works out-of-the-box with the assets already shipped in
 * `vendor/animations/` and `addons/vrma-actions|dance/`, and automatically
 * upgrades when the optional pack in `addons/vrma-locomotion/` is generated
 * with `scripts/retarget_mixamo_to_vrma.py`.
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionClipMap
 */

const MotionClipMap = (() => {
    'use strict';

    const PACK = 'addons/vrma-locomotion/'; // optional generated pack
    const ACT = 'addons/vrma-actions/'; // ships with the repo
    const DANCE = 'addons/vrma-dance/'; // ships with the repo
    const VEND = 'vendor/animations/'; // ships with the repo

    const DANCE_CLIPS = [
        DANCE + 'hipHopDancing.vrma',
        DANCE + 'sambaDancing.vrma',
        DANCE + 'rumbaDancing.vrma',
        DANCE + 'twistDance.vrma',
        DANCE + 'sillyDancing.vrma',
        DANCE + 'breakdanceUprock.vrma',
    ];

    /**
     * name → { candidates, loop, sticky }
     *  loop   — clip loops until replaced
     *  sticky — do NOT auto-return to idle after playing (posture/state clips)
     */
    const ENTRIES = {
        idle: { candidates: [VEND + 'idle/neutral_idle.bvh', VEND + 'idle/neutral.bvh'], loop: true, sticky: true },
        idle_happy: { candidates: [ACT + 'happyIdle.vrma'], loop: true, sticky: true },
        idle_sad: { candidates: [ACT + 'sadIdle.vrma'], loop: true, sticky: true },
        talking: { candidates: [ACT + 'talking.vrma'], loop: true, sticky: true },

        wave: { candidates: [ACT + 'waving.vrma', VEND + 'action/action_greeting.bvh'], loop: false },
        greeting: { candidates: [ACT + 'standingGreeting.vrma', VEND + 'action/action_greeting.bvh'], loop: false },
        bow: { candidates: [ACT + 'bowing.vrma'], loop: false },
        shrug: { candidates: [ACT + 'shrugging.vrma'], loop: false },
        clap: { candidates: [ACT + 'standingClap.vrma'], loop: false },
        victory: { candidates: [ACT + 'victory.vrma'], loop: false },
        sing: { candidates: [ACT + 'singing.vrma'], loop: true, sticky: true },
        backflip: { candidates: [ACT + 'backflip.vrma'], loop: false },
        jumping_jacks: { candidates: [ACT + 'jumpingJacks.vrma'], loop: false },

        // Posture — sit_down/stand_up come from the generated pack; the
        // shipped sit_idle/standup assets are the always-working fallback.
        sit: {
            candidates: [PACK + 'sit_down.vrma', VEND + 'sitting/sit_idle.bvh'],
            loop: false,
            sticky: true,
            then: 'sit_idle',
        },
        sit_idle: {
            candidates: [VEND + 'sitting/sit_idle.bvh', VEND + 'sitting/sit_idle2.bvh'],
            loop: true,
            sticky: true,
        },
        stand: { candidates: [PACK + 'stand_up.vrma', VEND + 'action/action_standup.bvh'], loop: false },

        // Interaction — generated pack first, graceful procedural fallback is
        // handled by MotionIntegration when resolve() returns no playable clip.
        nod: { candidates: [PACK + 'nod.vrma'], loop: false, procedural: 'nod' },
        headshake: { candidates: [PACK + 'headshake.vrma'], loop: false, procedural: 'headshake' },
        point: { candidates: [PACK + 'point.vrma'], loop: false, procedural: 'reach' },
        offer_hand: { candidates: [PACK + 'offer_hand.vrma'], loop: true, sticky: true, procedural: 'reach' },
        high_five: {
            candidates: [PACK + 'high_five.vrma', PACK + 'offer_hand.vrma'],
            loop: true,
            sticky: true,
            procedural: 'reach_high',
        },
        handshake: { candidates: [PACK + 'handshake.vrma'], loop: false, procedural: 'shake' },

        dance: { candidates: DANCE_CLIPS, loop: true, sticky: true, random: true },
    };

    const ALIASES = {
        hello: 'wave',
        hi: 'wave',
        greet: 'greeting',
        applaud: 'clap',
        applause: 'clap',
        sit_down: 'sit',
        stand_up: 'stand',
        get_up: 'stand',
        shake_hands: 'handshake',
        highfive: 'high_five',
        no: 'headshake',
        yes: 'nod',
        celebrate: 'victory',
    };

    /** Paths that failed to load once are skipped next time (missing pack). */
    const _unavailable = Object.create(null);

    function _loader() {
        return typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null;
    }

    /**
     * Resolve a command name to its entry.
     * @param {string} name
     * @returns {Object|null}
     */
    function resolve(name) {
        const key = String(name || '')
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
        return ENTRIES[key] || ENTRIES[ALIASES[key]] || null;
    }

    /**
     * Play the best available clip for a command name.
     *
     * @param {string} name
     * @param {Object} [opts] - { fadeIn, fadeOut }
     * @returns {Promise<{ok:boolean, duration:number, loop:boolean, sticky:boolean, then:(string|null), procedural:(string|null)}>}
     */
    async function play(name, opts) {
        const entry = resolve(name);
        const fail = {
            ok: false,
            duration: 0,
            loop: false,
            sticky: false,
            then: null,
            procedural: entry ? entry.procedural || null : null,
        };
        const loader = _loader();
        if (!entry || !loader) return fail;

        let candidates = entry.candidates.slice();
        if (entry.random && candidates.length > 1) {
            candidates = [candidates[Math.floor(Math.random() * candidates.length)]].concat(candidates);
        }

        for (let i = 0; i < candidates.length; i++) {
            const path = candidates[i];
            if (_unavailable[path]) continue;
            try {
                const clip = await loader.loadClip(path);
                if (!clip) {
                    _unavailable[path] = true;
                    continue;
                }
                const ok = await loader.playClip(path, {
                    loop: !!entry.loop,
                    fadeIn: (opts && opts.fadeIn) != null ? opts.fadeIn : 0.3,
                    fadeOut: (opts && opts.fadeOut) != null ? opts.fadeOut : 0.25,
                });
                if (ok) {
                    return {
                        ok: true,
                        duration: clip.duration || 0,
                        loop: !!entry.loop,
                        sticky: !!entry.sticky,
                        then: entry.then || null,
                        procedural: null,
                    };
                }
            } catch (_err) {
                _unavailable[path] = true;
            }
        }
        return fail;
    }

    /** Stop the current clip (crossfade handled by the loader). */
    function stop(opts) {
        const loader = _loader();
        if (loader && typeof loader.stopClip === 'function') loader.stopClip(opts || { fadeOut: 0.3 });
    }

    /** Names to advertise to the LLM in the motion contract. */
    function availableNames() {
        return Object.keys(ENTRIES).filter((n) => n.indexOf('idle') !== 0 && n !== 'sit_idle');
    }

    return { resolve, play, stop, availableNames, ENTRIES, ALIASES };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_CLIPS = MotionClipMap;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionClipMap;
