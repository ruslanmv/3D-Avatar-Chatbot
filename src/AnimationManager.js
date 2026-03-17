'use strict';

/**
 * AnimationManager — Central registry for all avatar animations.
 * ================================================================
 * Single source of truth for poses, gestures, emotions, and animations.
 * Designed so AI can select animations based on conversation context.
 *
 * Spicy Mode: Adult emotions, talk styles, and context presets are
 * only returned when window.NEXUS_SPICY.isEnabled() === true.
 *
 * Registry categories:
 *   - basePoses:   Standing base poses (ProceduralAnimator)
 *   - talkStyles:  Speaking gesture overlays (ProceduralAnimator)
 *   - emotions:    Facial expressions + body mode (VRM morph + ProceduralAnimator)
 *   - vrPoses:     Full-body VR poses (VRPoseSystem)
 *   - clipAnims:   Baked animation clips from loaded models (THREE.AnimationMixer)
 *
 * Usage:
 *   window.NEXUS_ANIMATION_MANAGER.play('happy', false);
 *   window.NEXUS_ANIMATION_MANAGER.setBasePose('presenterOpen');
 *   window.NEXUS_ANIMATION_MANAGER.applyEmotion('happy', 0.7);
 *   const all = window.NEXUS_ANIMATION_MANAGER.getAvailableAnimations();
 *
 * Exposes: window.NEXUS_ANIMATION_MANAGER
 */
(function () {
    // ─── Read from centralized AnimationPresets (single source of truth) ───
    const P = window.NEXUS_ANIMATION_PRESETS || {};

    function isSpicy() {
        return !!(window.NEXUS_SPICY && window.NEXUS_SPICY.isEnabled());
    }

    const BASE_POSES = P.BASE_POSES || [];
    const TALK_STYLES = P.TALK_STYLES || [];
    const ADULT_TALK_STYLES = P.ADULT_TALK_STYLES || [];
    const EMOTIONS = P.EMOTIONS || [];
    const ADULT_EMOTIONS = P.ADULT_EMOTIONS || [];

    // ─── Baked clip animations (populated at runtime from loaded model) ───
    let clipAnimations = []; // { id, label, category, duration }

    const AI_CONTEXT_MAP = P.AI_CONTEXT_MAP || {};
    const ADULT_CONTEXT_MAP = P.ADULT_CONTEXT_MAP || {};

    // ─── Public API ───

    /**
     * Register baked animation clips from a loaded model.
     * Call this after GLTFLoader finishes loading.
     * @param {THREE.AnimationClip[]} clips
     */
    function registerClips(clips) {
        clipAnimations = [];
        if (!Array.isArray(clips)) return;
        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const name = clip.name || 'clip_' + i;
            clipAnimations.push({
                id: name.toLowerCase(),
                label: name,
                category: 'clip',
                duration: clip.duration || 0,
            });
        }
        console.log('[AnimationManager] Registered', clipAnimations.length, 'clip animations');
    }

    /**
     * Get all available animations (for UI dropdowns / AI selection).
     * Includes adult content only when spicy mode is enabled.
     * @returns {Array<{ id: string, label: string, category: string }>}
     */
    function getAvailableAnimations() {
        const result = [];
        var spicy = isSpicy();

        // Procedural modes (SFW)
        for (let i = 0; i < EMOTIONS.length; i++) {
            result.push({
                id: EMOTIONS[i].id,
                label: EMOTIONS[i].icon + ' ' + EMOTIONS[i].label,
                category: 'emotion',
            });
        }

        // Adult emotions (spicy only)
        if (spicy) {
            for (let i = 0; i < ADULT_EMOTIONS.length; i++) {
                result.push({
                    id: ADULT_EMOTIONS[i].id,
                    label: ADULT_EMOTIONS[i].icon + ' ' + ADULT_EMOTIONS[i].label,
                    category: 'emotion-adult',
                });
            }
        }

        // Baked clips
        for (let i = 0; i < clipAnimations.length; i++) {
            result.push({
                id: clipAnimations[i].id,
                label: '\u{1F3AC} ' + clipAnimations[i].label,
                category: 'clip',
            });
        }

        return result;
    }

    /**
     * Play an animation by ID.
     * Checks emotions first (SFW + adult), then baked clips.
     * @param {string} id
     * @param {boolean} [loop=false]
     */
    function play(id, loop) {
        const key = (id || '').toLowerCase();

        // Check SFW emotions
        const emotion = EMOTIONS.find((e) => e.id === key);
        if (emotion) {
            applyEmotion(emotion.id, emotion.intensity);
            return;
        }

        // Check adult emotions (if spicy)
        if (isSpicy()) {
            const adultEmotion = ADULT_EMOTIONS.find((e) => e.id === key);
            if (adultEmotion) {
                applyEmotion(adultEmotion.id, adultEmotion.intensity);
                return;
            }
        }

        // Check if it's a baked clip
        if (window.NEXUS_VIEWER?.playAnimationByName) {
            window.NEXUS_VIEWER.playAnimationByName(key);
        }
    }

    /**
     * Stop all playing animations and return to idle.
     */
    function stopAll() {
        try {
            // Setting mode to idle with minimal duration clears animOverride
            // so editMode resumes control in Pose Studio
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
        } catch (_) {}
        try {
            const vrmLoader = window.NEXUS_VIEWER?.avatarManager?.vrmLoader;
            if (vrmLoader) vrmLoader.setEmotion('neutral', 0);
        } catch (_) {}
    }

    /**
     * Apply an emotion (VRM morph + procedural mode).
     * Supports both SFW and adult emotions.
     * @param {string} emotionId
     * @param {number} [intensity=0.7]
     */
    function applyEmotion(emotionId, intensity) {
        // Search SFW first, then adult
        var emotion = EMOTIONS.find((e) => e.id === emotionId);
        if (!emotion && isSpicy()) {
            emotion = ADULT_EMOTIONS.find((e) => e.id === emotionId);
        }
        if (!emotion) return;

        // Duration from centralized presets
        const dur = (P.getDuration ? P.getDuration(emotion.id) : null) || emotion.duration || 5000;
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(emotion.mode, dur);
        } catch (_) {}
        try {
            const vrmLoader = window.NEXUS_VIEWER?.avatarManager?.vrmLoader;
            if (vrmLoader) {
                var vrmExpr = emotion.vrmExpr || emotion.vrmExpression || 'neutral';
                vrmLoader.setEmotion(vrmExpr, intensity != null ? intensity : emotion.intensity);
                // Reset VRM expression after mode finishes (with 500ms buffer)
                if (emotion.id !== 'idle') {
                    setTimeout(() => {
                        try {
                            vrmLoader.setEmotion('neutral', 0);
                        } catch (_) {}
                    }, dur - 500);
                }
            }
        } catch (_) {}

        if (window.setEmotionIcon) window.setEmotionIcon(emotionId);
    }

    /**
     * Set the base standing pose.
     * @param {string} poseId
     */
    function setBasePose(poseId) {
        window.NEXUS_PROCEDURAL_ANIMATOR?.setBasePose?.(poseId);
    }

    /**
     * Set the talk gesture style.
     * @param {string} styleId
     */
    function setTalkStyle(styleId) {
        window.NEXUS_PROCEDURAL_ANIMATOR?.setTalkStyle?.(styleId);
    }

    /**
     * AI-driven: pick the best pose + talk style for a conversation context.
     * Checks adult context map when spicy mode is on.
     * @param {string} context — keyword like 'teaching', 'news', 'romantic'
     * @returns {{ basePose: string, talkStyle: string } | null}
     */
    function applyContextPreset(context) {
        const key = (context || '').toLowerCase();

        // Check adult contexts first (when spicy)
        if (isSpicy() && ADULT_CONTEXT_MAP[key]) {
            var adultPreset = ADULT_CONTEXT_MAP[key];
            setBasePose(adultPreset.basePose);
            setTalkStyle(adultPreset.talkStyle);
            console.log('[AnimationManager] Adult context preset applied:', key, adultPreset);
            return adultPreset;
        }

        const preset = AI_CONTEXT_MAP[key];
        if (!preset) return null;

        setBasePose(preset.basePose);
        setTalkStyle(preset.talkStyle);
        console.log('[AnimationManager] Context preset applied:', key, preset);
        return preset;
    }

    /**
     * Get the registries for external use.
     * Adult content included only when spicy mode is on.
     */
    function getBasePoses() {
        return BASE_POSES.slice();
    }
    function getTalkStyles() {
        if (isSpicy()) return TALK_STYLES.concat(ADULT_TALK_STYLES);
        return TALK_STYLES.slice();
    }
    function getEmotions() {
        if (isSpicy()) return EMOTIONS.concat(ADULT_EMOTIONS);
        return EMOTIONS.slice();
    }
    function getContextMap() {
        if (isSpicy()) return Object.assign({}, AI_CONTEXT_MAP, ADULT_CONTEXT_MAP);
        return Object.assign({}, AI_CONTEXT_MAP);
    }

    // Expose
    window.NEXUS_ANIMATION_MANAGER = {
        // Core actions
        play,
        stopAll,
        applyEmotion,
        setBasePose,
        setTalkStyle,
        applyContextPreset,

        // Registration
        registerClips,

        // Queries (for UI / AI)
        getAvailableAnimations,
        getBasePoses,
        getTalkStyles,
        getEmotions,
        getContextMap,
    };

    console.log('[AnimationManager] Initialized — single registry for all avatar animations');
})();
