'use strict';

/**
 * AnimationPresets — Single source of truth for ALL animation data.
 * ================================================================
 * Every emotion, base pose, talk style, animation parameter, duration,
 * AI context mapping, and emotion detection rule lives HERE.
 *
 * To add/edit/fix any animation:
 *   1. Edit THIS file only
 *   2. All systems (ProceduralAnimator, AnimationManager, PoseStudioPanel,
 *      BehaviorEngine, EmotionEngine) read from this file automatically.
 *
 * Exposes: window.NEXUS_ANIMATION_PRESETS
 */
(function () {
    // Helper: degrees to radians
    function deg(x) {
        return (x * Math.PI) / 180;
    }

    // =====================================================================
    // GLOBAL POSE INTENSITY — single source of truth
    // =====================================================================
    // All systems (PoseNormalizer, NaturalPosePlugin, PoseStudioNormalizer)
    // read this value. Change it HERE to adjust pose correction strength globally.
    //   0   = no correction (raw T-pose)
    //   1.0 = full correction (industry standard — arms naturally at sides)
    //   >1  = over-correction (extrapolates past target — use with caution)
    //
    // Production note: 1.0 with 'naturalIdle' preset (55° arm rotation) matches
    // the natural standing pose used by VRoid Hub, Ready Player Me, and AAA games.
    // Previous default of 0.7 with 'relaxedStanding' (40°) left arms partially raised.
    var DEFAULT_POSE_INTENSITY = 1.0;

    // =====================================================================
    // EMOTIONS — facial expressions + body animation modes
    // =====================================================================
    // Each emotion defines:
    //   id          — unique key
    //   label       — display name
    //   icon        — emoji for UI
    //   mode        — ProceduralAnimator mode to activate
    //   vrmExpr     — VRM expression morph target name
    //   intensity   — VRM expression intensity (0.0–1.0)
    //   duration    — how long the mode plays (ms)
    //   adult       — true = only visible when spicy mode enabled

    var EMOTIONS = [
        { id: 'idle', label: 'Idle', icon: '\u{1F9D8}', mode: 'idle', vrmExpr: 'neutral', intensity: 0, duration: 0 },
        {
            id: 'waiting',
            label: 'Waiting',
            icon: '\u{1F9CD}',
            mode: 'waiting',
            vrmExpr: 'neutral',
            intensity: 0,
            duration: 0,
        },
        {
            id: 'happy',
            label: 'Happy',
            icon: '\u{1F60A}',
            mode: 'happy',
            vrmExpr: 'happy',
            intensity: 0.7,
            duration: 6000,
        },
        {
            id: 'thinking',
            label: 'Thinking',
            icon: '\u{1F914}',
            mode: 'thinking',
            vrmExpr: 'neutral',
            intensity: 0.5,
            duration: 8000,
        },
        {
            id: 'dance',
            label: 'Dance',
            icon: '\u{1F57A}',
            mode: 'musicIdle', // procedural fallback only; primary path is clip-first via AnimationResolver
            performanceIntent: 'dance', // routes through NEXUS_ANIMATION_RESOLVER
            vrmExpr: 'happy',
            intensity: 0.6,
            duration: 15000,
        },
        {
            id: 'talk',
            label: 'Talk',
            icon: '\u{1F4AC}',
            mode: 'talk',
            vrmExpr: 'neutral',
            intensity: 0,
            duration: 60000,
        },
        { id: 'sad', label: 'Sad', icon: '\u{1F622}', mode: 'sad', vrmExpr: 'sad', intensity: 0.5, duration: 5000 },
        {
            id: 'angry',
            label: 'Angry',
            icon: '\u{1F620}',
            mode: 'angry',
            vrmExpr: 'angry',
            intensity: 0.5,
            duration: 5000,
        },
        {
            id: 'surprised',
            label: 'Surprised',
            icon: '\u{1F62E}',
            mode: 'surprised',
            vrmExpr: 'surprised',
            intensity: 0.6,
            duration: 5000,
        },
    ];

    var ADULT_EMOTIONS = [
        {
            id: 'flirt',
            label: 'Flirt',
            icon: '\u{1F609}',
            mode: 'flirt',
            vrmExpr: 'happy',
            intensity: 0.5,
            duration: 10000,
            adult: true,
        },
        {
            id: 'tease',
            label: 'Tease',
            icon: '\u{1F61C}',
            mode: 'tease',
            vrmExpr: 'happy',
            intensity: 0.4,
            duration: 8000,
            adult: true,
        },
        {
            id: 'intimate',
            label: 'Intimate',
            icon: '\u{1F48B}',
            mode: 'intimate',
            vrmExpr: 'relaxed',
            intensity: 0.6,
            duration: 12000,
            adult: true,
        },
        {
            id: 'sensualSway',
            label: 'Sensual Sway',
            icon: '\u{1F483}',
            mode: 'sensualSway',
            vrmExpr: 'happy',
            intensity: 0.4,
            duration: 15000,
            adult: true,
        },
        {
            id: 'beckon',
            label: 'Beckon',
            icon: '\u{1F485}',
            mode: 'beckon',
            vrmExpr: 'happy',
            intensity: 0.5,
            duration: 10000,
            adult: true,
        },
        {
            id: 'slowBurn',
            label: 'Slow Burn',
            icon: '\u{1F525}',
            mode: 'slowBurn',
            vrmExpr: 'relaxed',
            intensity: 0.6,
            duration: 12000,
            adult: true,
        },
    ];

    // =====================================================================
    // BASE POSES — standing bone angles applied by ProceduralAnimator
    // =====================================================================
    // Each pose has:
    //   id, label, category, tags — metadata for UI and AI selection
    //   bones — { boneName: [pitchDeg, yawDeg, rollDeg] }
    //   Bone names: head, neck, chest, spine, hips,
    //               leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm,
    //               leftHand, rightHand
    //
    // Lower arm Y convention (matching NaturalPosePlugin):
    //   leftLowerArm:  NEGATIVE Y = forward elbow bend (anatomical flexion)
    //   rightLowerArm: POSITIVE Y = forward elbow bend (anatomical flexion)

    var BASE_POSES = [
        {
            id: 'lecturerNeutral',
            label: 'Lecturer (Neutral)',
            category: 'presenter',
            tags: ['teacher', 'udemy', 'professor', 'calm'],
            bones: {
                leftUpperArm: [4, 0, 36],
                rightUpperArm: [4, 0, -36],
                leftLowerArm: [0, -12, 0],
                rightLowerArm: [0, 12, 0],
                hips: [0, 0, -2],
                spine: [0, 0, 1],
                chest: [-2, 0, 0],
                head: [3, 0, 0],
            },
        },
        {
            id: 'presenterOpen',
            label: 'Presenter (Open)',
            category: 'presenter',
            tags: ['youtube', 'keynote', 'demo', 'engaging'],
            bones: {
                leftUpperArm: [10, 0, 28],
                rightUpperArm: [10, 0, -28],
                leftLowerArm: [0, -22, 0],
                rightLowerArm: [0, 22, 0],
                hips: [0, 0, -1],
                spine: [-2, 0, 1],
                chest: [-4, 0, 0],
                head: [4, 0, 0],
            },
        },
        {
            id: 'anchorGrounded',
            label: 'Anchor (Grounded)',
            category: 'presenter',
            tags: ['news', 'formal', 'briefing', 'authoritative'],
            bones: {
                leftUpperArm: [12, 0, 18],
                rightUpperArm: [12, 0, -18],
                leftLowerArm: [0, -34, 0],
                rightLowerArm: [0, 34, 0],
                hips: [0, 0, -1],
                spine: [-3, 0, 0],
                chest: [-2, 0, 0],
                head: [2, 0, 0],
            },
        },
        {
            id: 'confident',
            label: 'Confident',
            category: 'companion',
            tags: ['bold', 'model', 'strong'],
            bones: {
                leftUpperArm: [6, 0, 32],
                rightUpperArm: [6, 0, -32],
                leftLowerArm: [0, -18, 0],
                rightLowerArm: [0, 18, 0],
                hips: [0, 3, -3],
                spine: [-4, 0, 0],
                chest: [-6, 0, 0],
                head: [2, 0, 0],
            },
        },
        {
            id: 'lounge',
            label: 'Lounge',
            category: 'companion',
            tags: ['casual', 'relaxed', 'chill'],
            bones: {
                leftUpperArm: [2, 0, 40],
                rightUpperArm: [8, 0, -30],
                leftLowerArm: [0, -8, 0],
                rightLowerArm: [0, 20, 0],
                hips: [2, 4, -5],
                spine: [-2, 2, 2],
                chest: [-3, 1, 0],
                head: [5, 0, 0],
            },
        },
        {
            id: 'shy',
            label: 'Shy',
            category: 'companion',
            tags: ['cute', 'gentle', 'demure'],
            bones: {
                leftUpperArm: [8, 0, 24],
                rightUpperArm: [8, 0, -24],
                leftLowerArm: [0, -28, 0],
                rightLowerArm: [0, 28, 0],
                hips: [0, -2, 0],
                spine: [2, 0, 0],
                chest: [3, 0, 0],
                head: [8, 0, 0],
            },
        },
        {
            id: 'elegant',
            label: 'Elegant',
            category: 'companion',
            tags: ['fashion', 'sophisticated', 'graceful'],
            bones: {
                leftUpperArm: [5, 0, 34],
                rightUpperArm: [10, 0, -26],
                leftLowerArm: [0, -14, 0],
                rightLowerArm: [0, 24, 0],
                hips: [0, 2, -4],
                spine: [-3, 1, 2],
                chest: [-5, 0, -1],
                head: [3, 0, 0],
            },
        },
        {
            id: 'intimateSafe',
            label: 'Intimate',
            category: 'companion',
            tags: ['warm', 'romantic', 'asmr'],
            bones: {
                leftUpperArm: [6, 0, 30],
                rightUpperArm: [6, 0, -30],
                leftLowerArm: [0, -20, 0],
                rightLowerArm: [0, 20, 0],
                hips: [2, 0, -3],
                spine: [-3, 0, 0],
                chest: [-5, 0, 0],
                head: [6, 0, 0],
            },
        },
        {
            id: 'conversational',
            label: 'Conversational',
            category: 'companion',
            tags: ['friend', 'podcast', 'interview', 'chat'],
            bones: {
                leftUpperArm: [6, 0, 32],
                rightUpperArm: [8, 0, -28],
                leftLowerArm: [0, -16, 0],
                rightLowerArm: [0, 22, 0],
                hips: [0, 2, -2],
                spine: [-1, 0, 1],
                chest: [-3, 0, 0],
                head: [4, 0, 0],
            },
        },
    ];

    // =====================================================================
    // TALK STYLES — gesture overlays when mode === 'talk'
    // =====================================================================
    // Each style has:
    //   id, label, category, tags — metadata
    //   adult — true = only when spicy mode enabled
    //   anim  — per-bone oscillation: { boneName: { freq, amp, axis, offset? } }
    //           Multiple channels per bone are arrays.

    var TALK_STYLES = [
        {
            id: 'explainCalm',
            label: 'Explain (Calm)',
            category: 'educational',
            tags: ['teaching', 'tutorial', 'calm', 'lecture'],
            anim: {
                head: [{ axis: 'x', freq: 3.0, amp: 0.025 }],
                chest: [{ axis: 'x', freq: 2.2, amp: 0.015 }],
                leftUpperArm: [
                    { axis: 'x', freq: 1.8, amp: 0.04 },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(4) },
                ],
                rightUpperArm: [
                    { axis: 'x', freq: 1.8, amp: 0.06, phase: Math.PI * 0.4 },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(-6) },
                ],
                rightLowerArm: [{ axis: 'y', freq: 1.8, amp: -0.08, phase: Math.PI * 0.4 }],
            },
        },
        {
            id: 'explainEmphasis',
            label: 'Explain (Emphasis)',
            category: 'educational',
            tags: ['youtube', 'energetic', 'pitch', 'emphasis'],
            anim: {
                head: [{ axis: 'x', freq: 3.5, amp: 0.035 }],
                chest: [{ axis: 'x', freq: 2.8, amp: 0.025 }],
                leftUpperArm: [
                    { axis: 'x', freq: 2.5, amp: 0.08 },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(8) },
                ],
                rightUpperArm: [
                    { axis: 'x', freq: 2.5, amp: 0.08, phase: Math.PI },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(-8) },
                ],
                leftLowerArm: [{ axis: 'y', freq: 2.5, amp: -0.12 }],
                rightLowerArm: [{ axis: 'y', freq: 2.5, amp: -0.12, phase: Math.PI }],
            },
        },
        {
            id: 'broadcastAnchor',
            label: 'Broadcast (Anchor)',
            category: 'formal',
            tags: ['news', 'narration', 'formal', 'briefing'],
            anim: {
                head: [{ axis: 'x', freq: 2.5, amp: 0.02 }],
                chest: [{ axis: 'x', freq: 2.0, amp: 0.015 }],
                rightUpperArm: [
                    { axis: 'x', freq: 1.8, amp: 0.04 },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(-4) },
                ],
                rightLowerArm: [{ axis: 'y', freq: 1.8, amp: -0.06 }],
                leftUpperArm: [
                    { axis: 'x', freq: 1.8, amp: 0.02, phase: Math.PI * 0.7 },
                    { axis: 'z', freq: 0, amp: 0, offset: deg(2) },
                ],
            },
        },
    ];

    var ADULT_TALK_STYLES = [
        {
            id: 'whisperIntimate',
            label: '\u{1F525} Whisper (Intimate)',
            category: 'adult',
            adult: true,
            tags: ['asmr', 'romantic', 'intimate', 'whisper'],
            anim: {
                head: [
                    { axis: 'x', freq: 1.5, amp: 0.012 },
                    { axis: 'z', freq: 1.0, amp: 0.02 },
                ],
                spine: [{ axis: 'x', freq: 0.8, amp: 0.015 }],
                chest: [{ axis: 'x', freq: 1.2, amp: 0.01 }],
                neck: [
                    { axis: 'x', freq: 1.2, amp: 0.008 },
                    { axis: 'z', freq: 1.0, amp: 0.015 },
                ],
            },
        },
        {
            id: 'playfulTease',
            label: '\u{1F525} Playful (Tease)',
            category: 'adult',
            adult: true,
            tags: ['flirty', 'playful', 'tease', 'banter'],
            anim: {
                head: [
                    { axis: 'x', freq: 2.5, amp: 0.02 },
                    { axis: 'z', freq: 1.5, amp: 0.03 },
                    { axis: 'y', freq: 1.0, amp: 0.015 },
                ],
                rightUpperArm: [
                    { axis: 'x', freq: 2.0, amp: 0.025 },
                    { axis: 'z', freq: 2.0, amp: -0.03 },
                ],
                rightLowerArm: [{ axis: 'y', freq: 2.5, amp: -0.03 }],
                spine: [{ axis: 'y', freq: 1.2, amp: 0.012 }],
            },
        },
    ];

    // =====================================================================
    // MODE ANIMATIONS — body animations for each emotion mode
    // =====================================================================
    // Same format as talk styles: per-bone oscillation channels.
    // 'offset' = static rotation added, 'amp' = oscillation amplitude.
    // Modes not listed here use base idle (breathing + head look).

    var MODE_ANIMS = {
        // ── THINKING: NPC contemplation — weight on one leg, hand near chin ──
        // Reference: FFXIV /think, WoW /ponder — slow, grounded, minimal motion
        thinking: {
            head: [
                { axis: 'z', freq: 0.4, amp: 0.04 }, // gentle head tilt
                { axis: 'x', freq: 0, amp: 0, offset: 0.08 }, // chin down in thought
                { axis: 'y', freq: 0.25, amp: 0.03 }, // slow deliberate look
            ],
            hips: [
                { axis: 'z', freq: 0.3, amp: 0.015 }, // subtle weight shift
            ],
            chest: [
                { axis: 'x', freq: 1.8, amp: 0.015 }, // breathing only
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: 0.03 }, // slight forward lean
            ],
            rightUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.02, offset: -0.22 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-16) },
            ],
            rightLowerArm: [{ axis: 'y', freq: 0.15, amp: -0.015, offset: deg(48) }],
            leftUpperArm: [
                { axis: 'x', freq: 0.15, amp: 0.01, offset: 0.06 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(10) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-32) }],
            neck: [{ axis: 'z', freq: 0.3, amp: 0.025 }],
            // Legs: weight on right leg (classic thinker pose), left knee slightly bent
            leftUpperLeg: [
                { axis: 'x', freq: 0.3, amp: 0.01 }, // counter hip sway
                { axis: 'z', freq: 0, amp: 0, offset: deg(-2) }, // slight outward
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(-3) }, // locked straight (weight-bearing)
            ],
            leftLowerLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(5) }, // relaxed knee bend
            ],
            rightLowerLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(2) }, // nearly straight
            ],
        },
        // ── HAPPY: NPC cheer — upright posture, gentle bounce, open arms ──
        // Reference: FFXIV /joy, GW2 /cheer — cheerful but planted feet
        happy: {
            chest: [{ axis: 'x', freq: 1.8, amp: 0.03, offset: -0.04 }],
            hips: [
                { axis: 'x', freq: 1.8, amp: 0.025 }, // gentle bounce
                { axis: 'z', freq: 0.8, amp: 0.02 }, // weight shift
            ],
            spine: [{ axis: 'x', freq: 0, amp: 0, offset: -0.03 }],
            head: [
                { axis: 'x', freq: 1.6, amp: 0.025 },
                { axis: 'z', freq: 0.8, amp: 0.03 },
            ],
            leftUpperArm: [
                { axis: 'x', freq: 1.6, amp: 0.08 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(8) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 1.6, amp: 0.08, phase: Math.PI },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-8) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 1.6, amp: -0.06 }],
            rightLowerArm: [{ axis: 'y', freq: 1.6, amp: 0.06, phase: Math.PI }],
            // Legs: knees absorb the bounce — Genshin-style planted feet
            leftUpperLeg: [
                { axis: 'x', freq: 1.8, amp: 0.02 }, // knee flexion matches hip bounce
                { axis: 'z', freq: 0.8, amp: -0.012 }, // counter weight shift
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 1.8, amp: 0.02 },
                { axis: 'z', freq: 0.8, amp: 0.012, phase: Math.PI },
            ],
            leftLowerLeg: [
                { axis: 'x', freq: 1.8, amp: -0.015 }, // shin compensates
            ],
            rightLowerLeg: [{ axis: 'x', freq: 1.8, amp: -0.015 }],
        },
        // ── SAD: NPC dejection — drooped head, slumped posture, weight sinking ──
        // Reference: FFXIV /sulk, WoW /cry — minimal motion, heavy weight
        sad: {
            head: [
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.14 },
                { axis: 'z', freq: 0.15, amp: 0.02 },
            ],
            spine: [{ axis: 'x', freq: 0.15, amp: 0.008, offset: 0.08 }],
            chest: [{ axis: 'x', freq: 0.3, amp: 0.012, offset: 0.06 }],
            hips: [{ axis: 'z', freq: 0.2, amp: 0.01 }],
            neck: [{ axis: 'x', freq: 0.2, amp: 0.008, offset: 0.04 }],
            leftUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(10) },
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.06 },
            ],
            rightUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(-10) },
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.06 },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-30) }],
            rightLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(30) }],
            // Legs: weight sinks, slight knee bend (defeated posture)
            leftUpperLeg: [
                { axis: 'x', freq: 0.2, amp: 0.005, offset: deg(4) }, // knees slightly bent
                { axis: 'z', freq: 0.2, amp: -0.006 },
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 0.2, amp: 0.005, offset: deg(4) },
                { axis: 'z', freq: 0.2, amp: 0.006, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
        },
        // ── ANGRY: NPC aggro stance — rigid, tense, wide planted stance ──
        // Reference: FFXIV /angry, WoW /threaten — controlled intensity
        angry: {
            head: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.06 },
                { axis: 'y', freq: 0.8, amp: 0.03 },
            ],
            chest: [{ axis: 'x', freq: 1.5, amp: 0.02, offset: -0.08 }],
            spine: [{ axis: 'x', freq: 0, amp: 0, offset: -0.05 }],
            hips: [{ axis: 'z', freq: 0.6, amp: 0.015 }],
            leftUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(10) },
                { axis: 'x', freq: 0.8, amp: 0.02 },
            ],
            rightUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(-10) },
                { axis: 'x', freq: 0.8, amp: 0.02, phase: Math.PI },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-25) }],
            rightLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(25) }],
            neck: [{ axis: 'x', freq: 0, amp: 0, offset: -0.03 }],
            // Legs: wide planted stance, tense, restless weight shift
            leftUpperLeg: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(-3) }, // slightly wide stance
                { axis: 'x', freq: 0.6, amp: 0.008 }, // restless
            ],
            rightUpperLeg: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(3) },
                { axis: 'x', freq: 0.6, amp: 0.008, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }], // slightly bent
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
        },
        // ── SURPRISED: NPC startle — step back, hands up, knees bent ──
        // Reference: FFXIV /surprised, WoW /gasp — reactive pose
        surprised: {
            head: [
                { axis: 'x', freq: 0.6, amp: 0.015, offset: -0.1 },
                { axis: 'z', freq: 1.0, amp: 0.03 },
                { axis: 'y', freq: 0.8, amp: 0.02 },
            ],
            chest: [{ axis: 'x', freq: 0.5, amp: 0.015, offset: -0.08 }],
            spine: [{ axis: 'x', freq: 0, amp: 0, offset: -0.06 }],
            hips: [{ axis: 'x', freq: 0.6, amp: 0.015 }],
            leftUpperArm: [
                { axis: 'x', freq: 0.4, amp: 0.025, offset: -0.2 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(15) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 0.4, amp: 0.025, offset: -0.2, phase: Math.PI * 0.3 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-15) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0.6, amp: -0.03, offset: deg(-30) }],
            rightLowerArm: [{ axis: 'y', freq: 0.6, amp: 0.03, offset: deg(30) }],
            // Legs: startle crouch — knees bent, settling back to stand
            leftUpperLeg: [
                { axis: 'x', freq: 0.6, amp: 0.012, offset: deg(6) }, // startled knee bend
            ],
            rightUpperLeg: [{ axis: 'x', freq: 0.6, amp: 0.012, offset: deg(6), phase: Math.PI * 0.3 }],
            leftLowerLeg: [{ axis: 'x', freq: 0.6, amp: -0.008, offset: deg(4) }],
            rightLowerLeg: [{ axis: 'x', freq: 0.6, amp: -0.008, offset: deg(4) }],
        },
        // ── MUSIC IDLE: Subtle rhythmic sway (procedural fallback for dance) ──
        // Used only when no BVH/VRMA dance clip is available.
        // Primary dance path is clip-first via AnimationResolver.
        // Kept deliberately restrained to avoid spinning/floating.
        musicIdle: {
            hips: [
                { axis: 'x', freq: 4.0, amp: 0.025 }, // reduced — knees now drive bounce
                { axis: 'y', freq: 2.0, amp: 0.06 }, // hip rotation groove
                { axis: 'z', freq: 2.0, amp: 0.05, phase: Math.PI * 0.5 }, // weight transfer L/R
            ],
            spine: [
                { axis: 'y', freq: 2.0, amp: -0.04, phase: Math.PI },
                { axis: 'x', freq: 4.0, amp: 0.015 },
            ],
            chest: [
                { axis: 'y', freq: 2.0, amp: 0.05, phase: Math.PI * 0.3 },
                { axis: 'x', freq: 4.0, amp: 0.02 },
                { axis: 'z', freq: 4.0, amp: 0.015 },
            ],
            head: [
                { axis: 'x', freq: 4.0, amp: 0.025, phase: Math.PI * 0.2 },
                { axis: 'y', freq: 2.0, amp: 0.03 },
                { axis: 'z', freq: 1.0, amp: 0.02 },
            ],
            neck: [{ axis: 'y', freq: 2.0, amp: 0.02, phase: Math.PI * 0.5 }],
            leftUpperArm: [
                { axis: 'x', freq: 2.0, amp: 0.1 },
                { axis: 'z', freq: 1.0, amp: 0.04, offset: deg(6) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 2.0, amp: 0.1, phase: Math.PI },
                { axis: 'z', freq: 1.0, amp: 0.04, phase: Math.PI, offset: deg(-6) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 2.0, amp: -0.08 }],
            rightLowerArm: [{ axis: 'y', freq: 2.0, amp: 0.08, phase: Math.PI }],
            // Legs: KNEES DRIVE THE BOUNCE — feet stay planted
            // Upper legs flex on the beat, lower legs compensate to keep feet grounded
            leftUpperLeg: [
                { axis: 'x', freq: 4.0, amp: 0.04 }, // knee bend on half-beat
                { axis: 'z', freq: 2.0, amp: -0.03, phase: Math.PI * 0.5 }, // step-shift L/R
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 4.0, amp: 0.04, phase: Math.PI * 0.15 }, // slightly offset
                { axis: 'z', freq: 2.0, amp: 0.03, phase: Math.PI * 1.5 },
            ],
            leftLowerLeg: [
                { axis: 'x', freq: 4.0, amp: -0.03 }, // shin counter-rotation (keeps foot grounded)
            ],
            rightLowerLeg: [{ axis: 'x', freq: 4.0, amp: -0.03, phase: Math.PI * 0.15 }],
            // Feet: toe-taps on the beat
            leftFoot: [
                { axis: 'x', freq: 2.0, amp: 0.02 }, // toe-tap
            ],
            rightFoot: [
                { axis: 'x', freq: 2.0, amp: 0.02, phase: Math.PI }, // alternating
            ],
        },
        // ── FLIRT: NPC charm — coy head tilt, hand on hip, subtle sway ──
        // Reference: FFXIV /wink, GW2 /flirt — confident but controlled
        flirt: {
            head: [
                { axis: 'z', freq: 0.6, amp: 0.05 }, // coy head tilt
                { axis: 'y', freq: 0.4, amp: 0.04 }, // look-away/back
                { axis: 'x', freq: 0, amp: 0, offset: -0.04 }, // slight chin-up
            ],
            hips: [
                { axis: 'z', freq: 0.5, amp: 0.04 }, // subtle hip sway
                { axis: 'y', freq: 0.4, amp: 0.025 }, // gentle rotation
            ],
            spine: [
                { axis: 'y', freq: 0.4, amp: 0.02 }, // follows hips
                { axis: 'x', freq: 0, amp: 0, offset: -0.03 }, // slight lean forward
            ],
            chest: [
                { axis: 'x', freq: 1.2, amp: 0.015, offset: -0.04 }, // breathing
            ],
            // Right arm: near face/hair gesture
            rightUpperArm: [
                { axis: 'x', freq: 0.3, amp: 0.03, offset: -0.12 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-14) },
            ],
            rightLowerArm: [{ axis: 'y', freq: 0.25, amp: -0.02, offset: deg(30) }],
            // Left arm: hand on hip
            leftUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.08 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(18) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-38) }],
            neck: [{ axis: 'z', freq: 0.5, amp: 0.025 }],
            // Legs: contrapposto — weight on left (hand-on-hip side), right relaxed
            leftUpperLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(-2) }, // weight-bearing, nearly straight
                { axis: 'z', freq: 0.5, amp: -0.015 }, // subtle sway follow
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(4) }, // relaxed, slightly bent
                { axis: 'z', freq: 0.5, amp: 0.015, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(2) }],
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(6) }], // relaxed knee
        },
        // ── TEASE: NPC playful — asymmetric, shoulder pop, wag gesture ──
        // Reference: FFXIV /taunt, GW2 /taunt — characterful but not wild
        tease: {
            head: [
                { axis: 'x', freq: 1.2, amp: 0.03 }, // nod
                { axis: 'z', freq: 0.8, amp: 0.05 }, // playful tilt
                { axis: 'y', freq: 0.5, amp: 0.03 }, // look-away
            ],
            hips: [
                { axis: 'z', freq: 0.8, amp: 0.04 }, // hip pop
                { axis: 'y', freq: 1.0, amp: 0.03 }, // subtle swivel
            ],
            chest: [
                { axis: 'z', freq: 1.5, amp: 0.025 }, // shoulder pop
                { axis: 'x', freq: 1.0, amp: 0.02, offset: -0.03 },
            ],
            spine: [{ axis: 'y', freq: 0.8, amp: 0.02, phase: Math.PI }],
            // Raised arm with finger wag
            rightUpperArm: [
                { axis: 'x', freq: 0.6, amp: 0.04, offset: -0.18 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-12) },
            ],
            rightLowerArm: [{ axis: 'y', freq: 1.5, amp: -0.06, offset: deg(28) }],
            leftUpperArm: [
                { axis: 'x', freq: 0.4, amp: 0.02 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(8) },
            ],
            neck: [{ axis: 'z', freq: 0.8, amp: 0.025 }],
            // Legs: playful weight shift, one hip popped
            leftUpperLeg: [
                { axis: 'z', freq: 0.8, amp: -0.02 }, // follows hip pop
                { axis: 'x', freq: 0.8, amp: 0.01 },
            ],
            rightUpperLeg: [
                { axis: 'z', freq: 0.8, amp: 0.02, phase: Math.PI },
                { axis: 'x', freq: 0.8, amp: 0.01, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0.8, amp: -0.008 }],
            rightLowerLeg: [{ axis: 'x', freq: 0.8, amp: -0.008, phase: Math.PI }],
        },
        // ── INTIMATE: NPC closeness — gentle lean, soft breathing, eye contact ──
        // Reference: FFXIV /blush, GW2 /shy — warm proximity without exaggeration
        intimate: {
            chest: [
                { axis: 'x', freq: 0.8, amp: 0.02, offset: -0.03 }, // breathing + slight lean
            ],
            spine: [
                { axis: 'x', freq: 0.5, amp: 0.015, offset: -0.02 }, // lean in
            ],
            head: [
                { axis: 'y', freq: 0.4, amp: 0.025 }, // slow gaze shift
                { axis: 'x', freq: 0.3, amp: 0.01, offset: -0.04 }, // chin slightly up
                { axis: 'z', freq: 0.3, amp: 0.02 }, // gentle tilt
            ],
            hips: [
                { axis: 'z', freq: 0.35, amp: 0.015 }, // subtle weight shift
            ],
            neck: [{ axis: 'z', freq: 0.4, amp: 0.025 }],
            leftUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.015, offset: -0.04 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(6) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.015, offset: -0.04 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-6) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0.2, amp: -0.01, offset: deg(-12) }],
            rightLowerArm: [{ axis: 'y', freq: 0.2, amp: 0.01, offset: deg(12) }],
            // Legs: gentle weight shift, close stance
            leftUpperLeg: [
                { axis: 'x', freq: 0.35, amp: 0.008 }, // counter hip sway
            ],
            rightUpperLeg: [{ axis: 'x', freq: 0.35, amp: 0.008, phase: Math.PI }],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }], // relaxed
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
        },
        // ── SENSUAL SWAY: NPC slow dance — controlled sway, grounded ──
        // Reference: FFXIV /mdance, slow dance — flowing but not spinning
        sensualSway: {
            hips: [
                { axis: 'z', freq: 0.6, amp: 0.06 }, // side-to-side sway
                { axis: 'y', freq: 0.4, amp: 0.04 }, // gentle rotation
                { axis: 'x', freq: 1.2, amp: 0.015 }, // micro bounce
            ],
            spine: [
                { axis: 'y', freq: 0.4, amp: -0.03, phase: Math.PI }, // counter-rotation
                { axis: 'x', freq: 0.8, amp: 0.015, offset: -0.02 },
            ],
            chest: [
                { axis: 'y', freq: 0.6, amp: 0.04, phase: Math.PI * 0.4 }, // chest follows
                { axis: 'x', freq: 0.8, amp: 0.02, offset: -0.03 }, // breathing
            ],
            head: [
                { axis: 'y', freq: 0.3, amp: 0.03 }, // slow gaze
                { axis: 'z', freq: 0.5, amp: 0.03 }, // tilt
                { axis: 'x', freq: 0, amp: 0, offset: -0.03 }, // chin up
            ],
            neck: [{ axis: 'z', freq: 0.4, amp: 0.02 }],
            leftUpperArm: [
                { axis: 'x', freq: 0.4, amp: 0.03, offset: -0.05 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(8) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 0.4, amp: 0.03, offset: -0.05, phase: Math.PI * 0.5 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-8) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0.3, amp: -0.02, offset: deg(-16) }],
            rightLowerArm: [{ axis: 'y', freq: 0.3, amp: 0.02, offset: deg(16) }],
            // Legs: flowing weight shift with sway, feet planted
            leftUpperLeg: [
                { axis: 'z', freq: 0.6, amp: -0.03 }, // counter hip sway
                { axis: 'x', freq: 1.2, amp: 0.01 }, // micro-bounce absorption
            ],
            rightUpperLeg: [
                { axis: 'z', freq: 0.6, amp: 0.03, phase: Math.PI },
                { axis: 'x', freq: 1.2, amp: 0.01, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 1.2, amp: -0.008 }],
            rightLowerLeg: [{ axis: 'x', freq: 1.2, amp: -0.008, phase: Math.PI }],
        },
        // ── BECKON: NPC "come here" — controlled gesture, hand motion ──
        // Reference: FFXIV /beckon — clear gesture, minimal body movement
        beckon: {
            head: [
                { axis: 'z', freq: 0.5, amp: 0.035 }, // inviting tilt
                { axis: 'x', freq: 0, amp: 0, offset: -0.04 }, // chin up
                { axis: 'y', freq: 0.4, amp: 0.03 }, // gaze direction
            ],
            hips: [
                { axis: 'z', freq: 0.4, amp: 0.025 }, // weight on one leg
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.03 }, // slight forward lean
            ],
            chest: [{ axis: 'x', freq: 0.8, amp: 0.015, offset: -0.04 }],
            // Right hand: beckoning curl — the main gesture
            rightUpperArm: [
                { axis: 'x', freq: 0.3, amp: 0.025, offset: -0.25 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-12) },
            ],
            rightLowerArm: [
                { axis: 'y', freq: 1.5, amp: -0.06, offset: deg(35) }, // beckoning curl
            ],
            // Left arm: hand on hip
            leftUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.1 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(20) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-45) }],
            neck: [{ axis: 'z', freq: 0.4, amp: 0.02 }],
            // Legs: weight on left hip (hand-on-hip side), right relaxed
            leftUpperLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(-2) }, // weight-bearing
                { axis: 'z', freq: 0.4, amp: -0.012 },
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 0, amp: 0, offset: deg(5) }, // relaxed bend
                { axis: 'z', freq: 0.4, amp: 0.012, phase: Math.PI },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(2) }],
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(7) }], // relaxed knee
        },
        // ── SLOW BURN: NPC intensity — controlled, magnetic, minimal ──
        // Reference: FFXIV /pose, confident idle — deliberate stillness with presence
        slowBurn: {
            head: [
                { axis: 'x', freq: 0.2, amp: 0.01, offset: -0.03 }, // chin up, steady
                { axis: 'y', freq: 0.25, amp: 0.02 }, // slow deliberate look
                { axis: 'z', freq: 0.3, amp: 0.025 }, // subtle tilt
            ],
            chest: [
                { axis: 'x', freq: 0.7, amp: 0.025, offset: -0.04 }, // controlled breathing
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.02 }, // upright
            ],
            hips: [
                { axis: 'z', freq: 0.3, amp: 0.02 }, // minimal sway
            ],
            neck: [{ axis: 'z', freq: 0.3, amp: 0.02 }],
            rightUpperArm: [
                { axis: 'x', freq: 0.15, amp: 0.015, offset: -0.08 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-8) },
            ],
            rightLowerArm: [{ axis: 'y', freq: 0.2, amp: -0.015, offset: deg(16) }],
            leftUpperArm: [
                { axis: 'x', freq: 0.15, amp: 0.01, offset: 0.04 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(6) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-10) }],
            // Legs: deliberate planted stance, minimal motion (presence through stillness)
            leftUpperLeg: [
                { axis: 'z', freq: 0.3, amp: -0.01 }, // subtle sway counter
                { axis: 'x', freq: 0, amp: 0, offset: deg(-2) },
            ],
            rightUpperLeg: [
                { axis: 'z', freq: 0.3, amp: 0.01, phase: Math.PI },
                { axis: 'x', freq: 0, amp: 0, offset: deg(-2) },
            ],
            leftLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
            rightLowerLeg: [{ axis: 'x', freq: 0, amp: 0, offset: deg(3) }],
        },
        // ── WAITING: VRoid-style natural idle — weight shift, gentle sway, alive ──
        // Reference: VRoid Hub "Waiting" motion, FFXIV NPC idle, Genshin Impact
        // standing idle, anime character resting pose. Multi-layered procedural
        // idle that combines:
        //   - Slow weight shift (contrapposto, ~8s full cycle)
        //   - Natural breathing (layered spine + chest)
        //   - Gentle head drift (looking around subtly)
        //   - Micro arm adjustments (not rigid)
        //   - Shoulder settling (organic upper body)
        // Total cycle: ~16 seconds before repeating feel, uses irrational
        // frequency ratios so the pattern never visibly loops.
        waiting: {
            // ── WAITING: VRoid-style natural idle — weight shift, gentle sway, alive ──
            // Reference: VRoid Hub "Waiting" motion, FFXIV NPC idle, Genshin Impact
            // standing idle, anime character resting pose. Combines:
            //   - Slow contrapposto weight shift (~8s full cycle)
            //   - Calm breathing (~5s cycle, wave propagates up spine)
            //   - Gentle head drift (looking around subtly)
            //   - Micro arm adjustments + shoulder settling
            // Uses irrational frequency ratios so the pattern never visibly loops.
            // AAA reference: breathing at 12 breaths/min = 0.2 Hz (5s cycle),
            // wave propagation with ~0.15s delay per bone up the chain.

            // Hips: contrapposto weight shift — the signature of natural standing
            // Slow L/R sway (0.125 Hz = 8s cycle) drives the entire silhouette
            hips: [
                { axis: 'z', freq: 0.125, amp: 0.03 }, // weight shift L/R (primary)
                { axis: 'y', freq: 0.09, amp: 0.015 }, // subtle hip rotation following weight
                { axis: 'x', freq: 0.18, amp: 0.004 }, // micro bounce from breathing wave
            ],
            // Spine: organic S-curve that counters hip sway + breathing wave origin
            // Breathing at 0.18 Hz (~5.5s cycle) — relaxed resting breath rate
            spine: [
                { axis: 'z', freq: 0.125, amp: -0.018, phase: Math.PI * 0.3 }, // counter-sway (opposition)
                { axis: 'x', freq: 0.18, amp: 0.014 }, // breathing wave starts here (gentle)
                { axis: 'y', freq: 0.07, amp: 0.006 }, // very slow torso turn
            ],
            // Chest: breathing wave arrives with phase delay (wave propagation)
            chest: [
                { axis: 'x', freq: 0.18, amp: 0.018, phase: 0.5 }, // breathing (delayed from spine)
                { axis: 'z', freq: 0.125, amp: -0.01, phase: Math.PI * 0.5 }, // follows spine counter
                { axis: 'y', freq: 0.11, amp: 0.008, phase: Math.PI * 0.2 }, // shoulder settling
            ],
            // Head: gentle drift — looking around naturally, not locked forward
            // Counter-rotates slightly against breathing to stabilize gaze (AAA standard)
            head: [
                { axis: 'y', freq: 0.08, amp: 0.035 }, // slow horizontal look (~12s cycle)
                { axis: 'z', freq: 0.13, amp: 0.02 }, // gentle head tilt
                { axis: 'x', freq: 0.18, amp: -0.004, phase: 0.9 }, // counter-rotation vs breathing
            ],
            // Neck: adds organic lag between head and torso
            neck: [
                { axis: 'z', freq: 0.11, amp: 0.015, phase: Math.PI * 0.4 }, // tilt lag
                { axis: 'y', freq: 0.06, amp: 0.01 }, // slow turn lag
            ],
            // ── Shoulders: lead arm motion — Genshin-style clavicle independence ──
            // Shoulder rises/settles FIRST, then arm follows with phase delay.
            // More pronounced than before: shoulder is the origin of arm chain motion.
            leftShoulder: [
                { axis: 'z', freq: 0.09, amp: 0.01 }, // settling drift (pronounced)
                { axis: 'x', freq: 0.18, amp: 0.006, phase: 0.4 }, // rises with breath (leads arm)
                { axis: 'y', freq: 0.125, amp: 0.005 }, // follows weight shift
            ],
            rightShoulder: [
                { axis: 'z', freq: 0.09, amp: -0.01, phase: Math.PI * 0.7 }, // async
                { axis: 'x', freq: 0.18, amp: 0.006, phase: 0.6 }, // rises with breath (leads arm)
                { axis: 'y', freq: 0.125, amp: -0.005, phase: Math.PI * 0.3 },
            ],
            // ── Arms: follow shoulder with phase lag — Genshin arm pendulum ──
            // Upper arm responds to: 1) body sway, 2) breathing (inhale lifts), 3) shoulder lead
            // Elbow (lowerArm) is hinge-like: Y-axis only, slight natural bend offset
            leftUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(4) }, // slight outward rest
                { axis: 'x', freq: 0.14, amp: 0.018, phase: 0.4 }, // body sway pendulum (lags shoulder)
                { axis: 'x', freq: 0.18, amp: 0.006, phase: 1.0 }, // breathing: arm rises on inhale
            ],
            leftLowerArm: [
                { axis: 'y', freq: 0.1, amp: -0.012, offset: deg(-8) }, // natural elbow bend (hinge axis)
                // Elbow stays in flexion range — offset keeps it bent, oscillation stays small
            ],
            // Right arm: mirrored with async phase (natural asymmetry)
            rightUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(-4) },
                { axis: 'x', freq: 0.14, amp: 0.018, phase: Math.PI * 0.6 + 0.4 }, // async pendulum
                { axis: 'x', freq: 0.18, amp: 0.006, phase: 1.3 }, // breathing (delayed from left)
            ],
            rightLowerArm: [
                { axis: 'y', freq: 0.1, amp: 0.012, offset: deg(8) }, // hinge-like elbow
            ],
            // ── Hands: wrist follows arm with secondary drag ──
            // Wrist has moderate freedom but is animation-driven (not physics)
            leftHand: [
                { axis: 'z', freq: 0.125, amp: 0.012, phase: Math.PI * 0.6 }, // follows weight shift
                { axis: 'x', freq: 0.18, amp: 0.008, phase: 1.2 }, // follows breathing wave
                { axis: 'y', freq: 0.11, amp: 0.006 }, // subtle wrist rotation (limited)
            ],
            rightHand: [
                { axis: 'z', freq: 0.125, amp: -0.012, phase: Math.PI * 0.8 }, // async
                { axis: 'x', freq: 0.18, amp: 0.008, phase: 1.5 }, // follows breathing wave
                { axis: 'y', freq: 0.11, amp: -0.006, phase: Math.PI * 0.3 }, // limited wrist rotation
            ],
            // ── Fingers: natural resting curl + breathing micro-movement ──
            // Industry standard: progressive curl (each finger slightly more than prev)
            // Thumb rests at ~15°, index ~20°, middle ~25°, ring ~30°, little ~35°
            // Tiny breathing-linked oscillation (0.005-0.008 rad) adds life at close range
            leftThumbProximal: [
                { axis: 'z', freq: 0.18, amp: 0.005, phase: 0.2 }, // micro-movement with breath
                { axis: 'x', freq: 0, amp: 0, offset: deg(15) }, // resting curl
            ],
            leftIndexProximal: [
                { axis: 'x', freq: 0.07, amp: 0.008, offset: deg(20) }, // curl + micro
            ],
            leftMiddleProximal: [{ axis: 'x', freq: 0.07, amp: 0.006, phase: 0.3, offset: deg(25) }],
            leftRingProximal: [{ axis: 'x', freq: 0.07, amp: 0.005, phase: 0.6, offset: deg(30) }],
            leftLittleProximal: [{ axis: 'x', freq: 0.07, amp: 0.004, phase: 0.9, offset: deg(35) }],
            rightThumbProximal: [
                { axis: 'z', freq: 0.18, amp: -0.005, phase: 0.5 },
                { axis: 'x', freq: 0, amp: 0, offset: deg(15) },
            ],
            rightIndexProximal: [{ axis: 'x', freq: 0.07, amp: 0.008, phase: Math.PI * 0.4, offset: deg(20) }],
            rightMiddleProximal: [{ axis: 'x', freq: 0.07, amp: 0.006, phase: Math.PI * 0.4 + 0.3, offset: deg(25) }],
            rightRingProximal: [{ axis: 'x', freq: 0.07, amp: 0.005, phase: Math.PI * 0.4 + 0.6, offset: deg(30) }],
            rightLittleProximal: [{ axis: 'x', freq: 0.07, amp: 0.004, phase: Math.PI * 0.4 + 0.9, offset: deg(35) }],
            // ── Legs: contrapposto weight shift — Genshin-style planted feet ──
            // Rule: when hips shift Z, supporting leg straightens, free leg relaxes.
            // Upper legs counter-rotate against hip sway to keep feet on the ground.
            leftUpperLeg: [
                { axis: 'x', freq: 0.125, amp: 0.018, phase: Math.PI }, // counter hip tilt
                { axis: 'z', freq: 0.125, amp: -0.012 }, // leg follows weight shift
            ],
            rightUpperLeg: [
                { axis: 'x', freq: 0.125, amp: 0.018 }, // opposite phase from left
                { axis: 'z', freq: 0.125, amp: 0.012, phase: Math.PI },
            ],
            leftLowerLeg: [
                { axis: 'x', freq: 0.125, amp: -0.012, phase: Math.PI }, // knee absorbs
            ],
            rightLowerLeg: [
                { axis: 'x', freq: 0.125, amp: -0.012 }, // knee absorbs
            ],
            // Feet: stay at rest (planted on ground) — no animation = surface contact
        },
    };

    // =====================================================================
    // IDLE ANIMATION — breathing + head look parameters
    // =====================================================================
    var IDLE_PARAMS = {
        breathing: {
            spine: { freq: 2.0, amp: 0.04 },
            chest: { freq: 2.0, phase: 0.7, amp: 0.03 },
        },
        headLook: {
            yawScale: 0.55,
            pitchScale: 0.25,
            yawClamp: 0.7,
            pitchClamp: 0.45,
            dampLambda: 10,
        },
        jawTalk: { freq: 12.0, amp: 0.25 },
    };

    // =====================================================================
    // CLIP INTENTS — clip-first animation routing (used by AnimationResolver)
    // =====================================================================
    // When an intent is requested (e.g. 'dance'), the resolver picks a clip
    // from preferredFiles first, falling back to procedural fallbackMode.
    var CLIP_INTENTS = {
        dance: {
            id: 'dance',
            category: 'dance',
            preferredFiles: ['dance/dance_1.bvh', 'dance/dance_2.bvh', 'dance/dance_rumba.bvh'],
            fallbackMode: 'musicIdle',
            loop: true,
        },
    };

    // =====================================================================
    // AI CONTEXT MAP — maps conversation topics to pose + talk style
    // =====================================================================
    var AI_CONTEXT_MAP = {
        teaching: { basePose: 'lecturerNeutral', talkStyle: 'explainCalm' },
        tutorial: { basePose: 'lecturerNeutral', talkStyle: 'explainCalm' },
        lecture: { basePose: 'lecturerNeutral', talkStyle: 'explainCalm' },
        presentation: { basePose: 'presenterOpen', talkStyle: 'explainEmphasis' },
        youtube: { basePose: 'presenterOpen', talkStyle: 'explainEmphasis' },
        keynote: { basePose: 'presenterOpen', talkStyle: 'explainEmphasis' },
        demo: { basePose: 'presenterOpen', talkStyle: 'explainEmphasis' },
        news: { basePose: 'anchorGrounded', talkStyle: 'broadcastAnchor' },
        briefing: { basePose: 'anchorGrounded', talkStyle: 'broadcastAnchor' },
        formal: { basePose: 'anchorGrounded', talkStyle: 'broadcastAnchor' },
        casual: { basePose: 'conversational', talkStyle: 'explainCalm' },
        friend: { basePose: 'conversational', talkStyle: 'explainCalm' },
        romantic: { basePose: 'intimateSafe', talkStyle: 'explainCalm' },
        intimate: { basePose: 'intimateSafe', talkStyle: 'explainCalm' },
        confident: { basePose: 'confident', talkStyle: 'explainEmphasis' },
        shy: { basePose: 'shy', talkStyle: 'explainCalm' },
        elegant: { basePose: 'elegant', talkStyle: 'explainCalm' },
    };

    var ADULT_CONTEXT_MAP = {
        flirty: { basePose: 'intimateSafe', talkStyle: 'playfulTease' },
        seductive: { basePose: 'elegant', talkStyle: 'whisperIntimate' },
        sensual: { basePose: 'intimateSafe', talkStyle: 'whisperIntimate' },
        passionate: { basePose: 'confident', talkStyle: 'playfulTease' },
        dominant: { basePose: 'confident', talkStyle: 'explainEmphasis' },
        submissive: { basePose: 'shy', talkStyle: 'whisperIntimate' },
        bedroom: { basePose: 'intimateSafe', talkStyle: 'whisperIntimate' },
        roleplay: { basePose: 'lounge', talkStyle: 'playfulTease' },
    };

    // =====================================================================
    // EMOTION CLIP MAP — maps emotions to baked animation clip names
    // =====================================================================
    // Used by BehaviorEngine for GLB models with baked animations.
    // Falls back through the list until one is found.
    var EMOTION_CLIP_MAP = {
        happy: ['Happy', 'Dance', 'Yes', 'ThumbsUp', 'Wave', 'joy', 'amusement', 'excitement'],
        sad: ['Sad', 'Death', 'No', 'Sitting', 'sadness', 'grief', 'disappointment'],
        angry: ['Angry', 'Punch', 'No', 'anger', 'annoyance', 'disgust'],
        surprised: ['Surprised', 'Jump', 'Wave', 'surprise', 'realization'],
        thinking: ['Idle', 'Standing', 'confusion', 'curiosity', 'Thinking', 'LookAround'],
        dance: [
            'dance_1',
            'dance_2',
            'dance_rumba',
            'dance_gangnam_style',
            'dance_dab',
            'dance_ontop',
            'dance_pushback',
            'dance_backup',
            'dance_northern_soul_spin',
            'dance_headdrop',
            'dance_marachinostep',
        ],
        love: ['love', 'love2', 'love3', 'caring', 'desire', 'Blush'],
        fear: ['fear', 'fear2', 'fear3', 'nervousness'],
        excited: ['excitement', 'excitement2', 'excitement3', 'admiration', 'optimism'],
    };

    // =====================================================================
    // MICRO-EXPRESSIONS — subtle idle facial twitches
    // =====================================================================
    var MICRO_EXPRESSIONS = [
        { expr: 'happy', value: 0.12, duration: 900 },
        { expr: 'surprised', value: 0.08, duration: 600 },
    ];

    // =====================================================================
    // EMOTION DETECTION — emoji + keyword rules for EmotionEngine
    // =====================================================================
    var EMOJI_MAP = {
        happy: /[\u{1F600}-\u{1F606}\u{1F60A}\u{1F60D}\u{1F60E}\u{1F970}\u{1F973}\u{1F929}\u{2764}\u{1F496}\u{1F4AA}\u{1F389}\u{1F38A}\u{1F44D}]/u,
        sad: /[\u{1F622}\u{1F625}\u{1F62D}\u{1F614}\u{1F61E}\u{1F62A}\u{1F494}\u{1F615}]/u,
        angry: /[\u{1F620}\u{1F621}\u{1F624}\u{1F92C}\u{1F4A2}]/u,
        surprised: /[\u{1F62E}\u{1F62F}\u{1F632}\u{1F631}\u{1F633}\u{1F914}\u{2049}\u{203C}]/u,
        excited: /[\u{1F525}\u{2B50}\u{1F680}\u{1F4AB}\u{26A1}\u{1F31F}\u{1F60D}]/u,
    };

    var KEYWORD_GROUPS = [
        {
            emotion: 'happy',
            weight: 1.0,
            patterns: [
                /\b(glad|happy|delighted|pleased|wonderful|fantastic|great|awesome|love|lovely|excellent|brilliant|perfect|beautiful)\b/i,
                /\b(glad to help|happy to|my pleasure|you're welcome|of course)\b/i,
                /\b(congratulations|well done|bravo|cheers)\b/i,
            ],
        },
        {
            emotion: 'excited',
            weight: 1.2,
            patterns: [
                /\b(amazing|incredible|extraordinary|phenomenal|spectacular|outstanding|magnificent)\b/i,
                /\b(absolutely|definitely|totally|extremely|super)\b/i,
                /\b(exciting|thrilling|can't wait|looking forward)\b/i,
            ],
        },
        {
            emotion: 'sad',
            weight: 1.0,
            patterns: [
                /\b(sorry|unfortunately|sadly|regret|apologize|miss|loss|difficult|tough)\b/i,
                /\b(I'm sorry to hear|my condolences|that's hard|I understand how)\b/i,
                /\b(disappointed|heartbreaking|painful|suffering)\b/i,
            ],
        },
        {
            emotion: 'thinking',
            weight: 0.8,
            patterns: [
                /\b(think|consider|perhaps|maybe|possibly|might|could be|let me)\b/i,
                /\b(hmm|hmmm|interesting|curious|wonder|ponder|reflect)\b/i,
                /\b(on one hand|on the other|it depends|that's a good question)\b/i,
            ],
        },
        {
            emotion: 'surprised',
            weight: 1.0,
            patterns: [
                /\b(wow|whoa|oh my|really|seriously|no way|unbelievable)\b/i,
                /\b(I didn't expect|surprising|astonishing|remarkable|unexpected)\b/i,
                /\b(mind-blowing|jaw-dropping|speechless)\b/i,
            ],
        },
        {
            emotion: 'angry',
            weight: 0.6,
            patterns: [
                /\b(frustrating|unacceptable|outrageous|terrible|horrible|awful)\b/i,
                /\b(ridiculous|absurd|inexcusable|disgraceful)\b/i,
            ],
        },
    ];

    // Maps detected emotion label → VRM expression + ProceduralAnimator mode
    var EMOTION_OUTPUT_MAP = {
        happy: { emotion: 'happy', mode: 'happy', baseIntensity: 0.5 },
        excited: { emotion: 'happy', mode: 'happy', baseIntensity: 0.8 },
        sad: { emotion: 'sad', mode: 'sad', baseIntensity: 0.45 },
        thinking: { emotion: 'neutral', mode: 'thinking', baseIntensity: 0.5 },
        surprised: { emotion: 'surprised', mode: 'surprised', baseIntensity: 0.6 },
        angry: { emotion: 'angry', mode: 'angry', baseIntensity: 0.4 },
        neutral: { emotion: 'neutral', mode: 'idle', baseIntensity: 0.0 },
    };

    // =====================================================================
    // HELPER: Build Euler from bone degrees array [pitch, yaw, roll]
    // =====================================================================
    function boneDegreesToEuler(THREE, arr) {
        return new THREE.Euler(deg(arr[0]), deg(arr[1]), deg(arr[2]));
    }

    /**
     * Convert a base pose's bones object into a map of THREE.Euler.
     * Used by ProceduralAnimator.
     */
    function getBasePoseEulerMap(THREE, poseId) {
        var pose = null;
        for (var i = 0; i < BASE_POSES.length; i++) {
            if (BASE_POSES[i].id.toLowerCase() === (poseId || '').toLowerCase()) {
                pose = BASE_POSES[i];
                break;
            }
        }
        if (!pose || !pose.bones) return null;
        var result = {};
        var keys = Object.keys(pose.bones);
        for (var k = 0; k < keys.length; k++) {
            result[keys[k]] = boneDegreesToEuler(THREE, pose.bones[keys[k]]);
        }
        return result;
    }

    /**
     * Apply oscillation channels to a bone given current time.
     * Returns a THREE.Euler with the combined rotation.
     */
    function evalAnimChannels(THREE, channels, timeSec) {
        var x = 0,
            y = 0,
            z = 0;
        for (var i = 0; i < channels.length; i++) {
            var ch = channels[i];
            var phase = ch.phase || 0;
            var value = ch.offset || 0;
            if (ch.freq > 0 && ch.amp !== 0) {
                value += Math.sin(timeSec * ch.freq + phase) * ch.amp;
            }
            if (ch.axis === 'x') x += value;
            else if (ch.axis === 'y') y += value;
            else if (ch.axis === 'z') z += value;
        }
        return new THREE.Euler(x, y, z);
    }

    /**
     * Find an emotion by ID from both SFW and adult lists.
     */
    function getEmotionById(id, includeAdult) {
        for (var i = 0; i < EMOTIONS.length; i++) {
            if (EMOTIONS[i].id === id) return EMOTIONS[i];
        }
        if (includeAdult) {
            for (var j = 0; j < ADULT_EMOTIONS.length; j++) {
                if (ADULT_EMOTIONS[j].id === id) return ADULT_EMOTIONS[j];
            }
        }
        return null;
    }

    /**
     * Get duration for an emotion mode.
     */
    function getDuration(emotionId) {
        var e = getEmotionById(emotionId, true);
        return e ? e.duration : 5000;
    }

    // =====================================================================
    // EXPOSE
    // =====================================================================
    window.NEXUS_ANIMATION_PRESETS = {
        // Global defaults
        DEFAULT_POSE_INTENSITY: DEFAULT_POSE_INTENSITY,

        // Data registries
        EMOTIONS: EMOTIONS,
        ADULT_EMOTIONS: ADULT_EMOTIONS,
        BASE_POSES: BASE_POSES,
        TALK_STYLES: TALK_STYLES,
        ADULT_TALK_STYLES: ADULT_TALK_STYLES,
        MODE_ANIMS: MODE_ANIMS,
        IDLE_PARAMS: IDLE_PARAMS,
        AI_CONTEXT_MAP: AI_CONTEXT_MAP,
        ADULT_CONTEXT_MAP: ADULT_CONTEXT_MAP,
        EMOTION_CLIP_MAP: EMOTION_CLIP_MAP,
        MICRO_EXPRESSIONS: MICRO_EXPRESSIONS,
        EMOJI_MAP: EMOJI_MAP,
        KEYWORD_GROUPS: KEYWORD_GROUPS,
        EMOTION_OUTPUT_MAP: EMOTION_OUTPUT_MAP,
        CLIP_INTENTS: CLIP_INTENTS,

        // Helpers
        deg: deg,
        getBasePoseEulerMap: getBasePoseEulerMap,
        evalAnimChannels: evalAnimChannels,
        getEmotionById: getEmotionById,
        getDuration: getDuration,
    };

    console.log('[AnimationPresets] Loaded — single source of truth for all animation data');
})();
