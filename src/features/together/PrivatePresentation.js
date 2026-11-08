/**
 * AX7. PrivatePresentation — what the chosen style and the person's current step look and sound
 * like, applied through the owners that already exist, and taken back on stop.
 *
 * The audit behind this: before AX7 a Private session's style changed the words she was told to
 * say and nothing else. `PrivateExperienceProfile.presentationFor` computed a voice pace, a gaze
 * and a light for each style, and no code read it — Affectionate and Mature sounded and looked
 * identical, which is a label, not a style.
 *
 * Three channels, each through its one owner, each reporting whether it really applied:
 *
 *   voice       `adjustVoice({rate, pitch})`, consulted by both speech paths in main.js after the
 *               persona's own overrides. Slower as the evening deepens; never below 0.8 of the
 *               person's own rate, so a setting they chose is shaded, not replaced.
 *   expression  the VRM loader's `setEmotion` — a low resting warmth that rises a little with each
 *               step. The companion's transient expressions settle back to this resting one
 *               instead of to `neutral` (`restingExpression`), so a smile no longer ends the mood.
 *   light       `runtime.setMood(preset)` once, when the session starts with a room on screen —
 *               the same call the venue chips and the Private World use. Not re-applied on later
 *               steps: a light the person chose in the room is theirs, and this never overrides it.
 *
 * What it never does: move a consent level, start an animation (the ranker and the clip engine own
 * her body; `presentationFor(...).intents` is advice for them, already ceilinged per level), touch
 * lip-sync, or claim a channel applied when its owner was missing — `state().applied` says
 * `false` for each one that was not there.
 *
 * Care mode (AX6) overrides everything: a calm, slightly slow voice and a neutral face.
 *
 * Exposes: window.NEXUS_PRIVATE_PRESENTATION
 */
(function (global) {
    'use strict';

    /** Per-step deepening on top of the style's base: a little slower, a little warmer. */
    const STEP_RATE = -0.02;
    const STEP_WARMTH = 0.04;
    /** Never shade the person's own speech rate by more than this. */
    const MIN_RATE_FACTOR = 0.8;
    /** Care mode: calm and clear, not slow enough to sound strange. */
    const CARE_RATE = 0.95;

    let current = null; // { style, level, rate, expression: {emotion,intensity}|null, care }
    let applied = { voice: false, expression: false, light: false };

    function profile(g) {
        return (g && g.NEXUS_PRIVATE_EXPERIENCE_PROFILE) || null;
    }

    function loaderOf(g) {
        const m = g && g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager;
        const l = m && m.vrmLoader;
        return l && typeof l.setEmotion === 'function' ? l : null;
    }

    /** Pure: the presentation for a style at a level (care wins over everything). */
    function compute(styleId, level, options) {
        const o = options || {};
        if (o.care)
            return {
                style: styleId,
                level: 1,
                rate: CARE_RATE,
                expression: { emotion: 'neutral', intensity: 0 },
                light: null,
                care: true,
            };
        const P = o.profile;
        const pres = P && typeof P.presentationFor === 'function' ? P.presentationFor(styleId, level) : null;
        if (!pres) return null;
        const steps = Math.max(0, pres.level - 1);
        const rate = Math.max(MIN_RATE_FACTOR, Math.min(1, Number(pres.voiceRate || 1) + STEP_RATE * steps));
        const intensity = Math.min(0.32, 0.1 + STEP_WARMTH * steps);
        return {
            style: styleId,
            level: pres.level,
            rate: Math.round(rate * 100) / 100,
            expression: { emotion: 'happy', intensity: Math.round(intensity * 100) / 100 },
            light: pres.mood || null,
            care: false,
        };
    }

    /**
     * Apply a style at a level. `first` is the session start: only then is the room's light set.
     * Never throws; answers what applied.
     */
    function apply(styleId, level, options) {
        const o = options || {};
        const g = o.global || global;
        const next = compute(styleId, level, { profile: profile(g), care: o.care === true });
        if (!next) return { ok: false, why: 'no-profile', applied: { ...applied } };
        current = next;
        applied = { voice: true, expression: false, light: applied.light && !o.first };
        const loader = loaderOf(g);
        if (loader) {
            try {
                loader.setEmotion(next.expression.emotion, next.expression.intensity);
                applied.expression = true;
            } catch (_) {
                applied.expression = false;
            }
        }
        if (o.first && next.light) {
            try {
                const rt = g.NEXUS_VIEWER && g.NEXUS_VIEWER.vrWorlds;
                const preset = g.NEXUS_PLAYGROUND_MOODS && g.NEXUS_PLAYGROUND_MOODS.get(next.light);
                applied.light = Boolean(rt && rt.activeId && preset && rt.setMood(preset.light) === true);
            } catch (_) {
                applied.light = false;
            }
        }
        return { ok: true, applied: { ...applied }, presentation: { ...current } };
    }

    /**
     * The voice hook both speech paths call. Identity while no Private presentation is active, so
     * every other reply in the app is spoken exactly as before.
     */
    function adjustVoice(settings) {
        const s = settings || {};
        const rate = Number.isFinite(Number(s.rate)) ? Number(s.rate) : 1;
        const pitch = Number.isFinite(Number(s.pitch)) ? Number(s.pitch) : 1;
        if (!current) return { rate, pitch };
        return { rate: Math.max(0.1, Math.round(rate * current.rate * 1000) / 1000), pitch };
    }

    /**
     * What a transient expression settles back to: the session's resting warmth, or null (the
     * caller's own neutral) when no Private presentation is active.
     */
    function restingExpression() {
        return current && current.expression && current.expression.emotion !== 'neutral'
            ? { ...current.expression }
            : null;
    }

    /** Take everything back: neutral face, the person's own voice. The room's light leaves with the room. */
    function reset(options) {
        const g = (options && options.global) || global;
        const had = current;
        current = null;
        applied = { voice: false, expression: false, light: false };
        if (had) {
            const loader = loaderOf(g);
            try {
                if (loader) loader.setEmotion('neutral', 0);
            } catch (_) {
                /* the face settles on its own */
            }
        }
        return Boolean(had);
    }

    function state() {
        return { active: Boolean(current), presentation: current ? { ...current } : null, applied: { ...applied } };
    }

    const api = {
        STEP_RATE,
        STEP_WARMTH,
        MIN_RATE_FACTOR,
        CARE_RATE,
        compute,
        apply,
        adjustVoice,
        restingExpression,
        reset,
        state,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PRESENTATION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
