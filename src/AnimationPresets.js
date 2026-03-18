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
            mode: 'dance',
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
            // Right hand near chin — the classic think pose
            rightUpperArm: [
                { axis: 'x', freq: 0.2, amp: 0.02, offset: -0.22 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-16) },
            ],
            rightLowerArm: [{ axis: 'y', freq: 0.15, amp: -0.015, offset: deg(48) }],
            // Left arm crosses body — self-holding
            leftUpperArm: [
                { axis: 'x', freq: 0.15, amp: 0.01, offset: 0.06 },
                { axis: 'z', freq: 0, amp: 0, offset: deg(10) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-32) }],
            neck: [{ axis: 'z', freq: 0.3, amp: 0.025 }],
        },
        // ── HAPPY: NPC cheer — upright posture, gentle bounce, open arms ──
        // Reference: FFXIV /joy, GW2 /cheer — cheerful but planted feet
        happy: {
            chest: [
                { axis: 'x', freq: 1.8, amp: 0.03, offset: -0.04 }, // open chest, light bounce
            ],
            hips: [
                { axis: 'x', freq: 1.8, amp: 0.025 }, // gentle bounce
                { axis: 'z', freq: 0.8, amp: 0.02 }, // weight shift
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.03 }, // upright posture
            ],
            head: [
                { axis: 'x', freq: 1.6, amp: 0.025 }, // gentle nod
                { axis: 'z', freq: 0.8, amp: 0.03 }, // slight head tilt
            ],
            leftUpperArm: [
                { axis: 'x', freq: 1.6, amp: 0.08 }, // relaxed arm lift
                { axis: 'z', freq: 0, amp: 0, offset: deg(8) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 1.6, amp: 0.08, phase: Math.PI },
                { axis: 'z', freq: 0, amp: 0, offset: deg(-8) },
            ],
            leftLowerArm: [{ axis: 'y', freq: 1.6, amp: -0.06 }],
            rightLowerArm: [{ axis: 'y', freq: 1.6, amp: 0.06, phase: Math.PI }],
        },
        // ── SAD: NPC dejection — drooped head, slumped posture, self-comfort ──
        // Reference: FFXIV /sulk, WoW /cry — minimal motion, heavy weight
        sad: {
            head: [
                { axis: 'x', freq: 0.2, amp: 0.01, offset: 0.14 }, // head hanging down
                { axis: 'z', freq: 0.15, amp: 0.02 }, // slow tilt
            ],
            spine: [
                { axis: 'x', freq: 0.15, amp: 0.008, offset: 0.08 }, // slumped forward
            ],
            chest: [
                { axis: 'x', freq: 0.3, amp: 0.012, offset: 0.06 }, // chest caved in
            ],
            hips: [
                { axis: 'z', freq: 0.2, amp: 0.01 }, // barely perceptible sway
            ],
            neck: [{ axis: 'x', freq: 0.2, amp: 0.008, offset: 0.04 }],
            // Arms hang heavy, slight self-holding
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
        },
        // ── ANGRY: NPC aggro stance — rigid, tense, fists ready ──
        // Reference: FFXIV /angry, WoW /threaten — controlled intensity, no flailing
        angry: {
            head: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.06 }, // chin up defiant
                { axis: 'y', freq: 0.8, amp: 0.03 }, // slow glare shifts
            ],
            chest: [
                { axis: 'x', freq: 1.5, amp: 0.02, offset: -0.08 }, // puffed up chest + tense breathing
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.05 }, // rigid upright
            ],
            hips: [
                { axis: 'z', freq: 0.6, amp: 0.015 }, // restless weight shift
            ],
            // Fists at sides, slightly raised — ready stance
            leftUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(10) },
                { axis: 'x', freq: 0.8, amp: 0.02 }, // tense micro-pump
            ],
            rightUpperArm: [
                { axis: 'z', freq: 0, amp: 0, offset: deg(-10) },
                { axis: 'x', freq: 0.8, amp: 0.02, phase: Math.PI },
            ],
            leftLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(-25) }],
            rightLowerArm: [{ axis: 'y', freq: 0, amp: 0, offset: deg(25) }],
            neck: [{ axis: 'x', freq: 0, amp: 0, offset: -0.03 }],
        },
        // ── SURPRISED: NPC startle — step back, hands up, then settle ──
        // Reference: FFXIV /surprised, WoW /gasp — reactive pose, not continuous
        surprised: {
            head: [
                { axis: 'x', freq: 0.6, amp: 0.015, offset: -0.1 }, // head pulled back
                { axis: 'z', freq: 1.0, amp: 0.03 }, // alert look
                { axis: 'y', freq: 0.8, amp: 0.02 }, // scanning
            ],
            chest: [
                { axis: 'x', freq: 0.5, amp: 0.015, offset: -0.08 }, // lean back
            ],
            spine: [
                { axis: 'x', freq: 0, amp: 0, offset: -0.06 }, // upright, pulled back
            ],
            hips: [
                { axis: 'x', freq: 0.6, amp: 0.015 }, // settling
            ],
            // Hands raised, palms out — startle reflex
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
        },
        // ── DANCE: MMORPG NPC groove — rhythmic sway, grounded feet ──
        // Reference: FFXIV /dance, GW2 /dance — rhythmic but contained,
        // weight stays centered, no spinning/flailing. Clean step-sway feel.
        // 120 BPM base (freq 2.0 = on-beat, 4.0 = half-beat)
        dance: {
            // Hips: gentle sway and bounce — drives rhythm without spinning
            hips: [
                { axis: 'x', freq: 4.0, amp: 0.04 }, // knee bounce
                { axis: 'y', freq: 2.0, amp: 0.06 }, // hip rotation groove
                { axis: 'z', freq: 2.0, amp: 0.06, phase: Math.PI * 0.5 }, // weight transfer L/R
            ],
            // Spine: gentle counter to hips — natural opposition
            spine: [
                { axis: 'y', freq: 2.0, amp: -0.04, phase: Math.PI }, // counter-rotate
                { axis: 'x', freq: 4.0, amp: 0.02 }, // pulse with bounce
            ],
            // Chest: subtle isolation on top of spine
            chest: [
                { axis: 'y', freq: 2.0, amp: 0.05, phase: Math.PI * 0.3 }, // chest groove
                { axis: 'x', freq: 4.0, amp: 0.025 }, // bounce follow
                { axis: 'z', freq: 4.0, amp: 0.015 }, // micro-shimmy accent
            ],
            // Head: bobbing to the beat, relaxed
            head: [
                { axis: 'x', freq: 4.0, amp: 0.03, phase: Math.PI * 0.2 }, // head bob
                { axis: 'y', freq: 2.0, amp: 0.03 }, // look direction
                { axis: 'z', freq: 1.0, amp: 0.02 }, // vibe tilt
            ],
            neck: [{ axis: 'y', freq: 2.0, amp: 0.02, phase: Math.PI * 0.5 }],
            // Arms: natural swing, not pumping wildly
            leftUpperArm: [
                { axis: 'x', freq: 2.0, amp: 0.1 }, // relaxed swing
                { axis: 'z', freq: 1.0, amp: 0.04, offset: deg(6) },
            ],
            rightUpperArm: [
                { axis: 'x', freq: 2.0, amp: 0.1, phase: Math.PI },
                { axis: 'z', freq: 1.0, amp: 0.04, phase: Math.PI, offset: deg(-6) },
            ],
            leftLowerArm: [
                { axis: 'y', freq: 2.0, amp: -0.08 }, // elbow groove
            ],
            rightLowerArm: [{ axis: 'y', freq: 2.0, amp: 0.08, phase: Math.PI }],
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

        // Helpers
        deg: deg,
        getBasePoseEulerMap: getBasePoseEulerMap,
        evalAnimChannels: evalAnimChannels,
        getEmotionById: getEmotionById,
        getDuration: getDuration,
    };

    console.log('[AnimationPresets] Loaded — single source of truth for all animation data');
})();
