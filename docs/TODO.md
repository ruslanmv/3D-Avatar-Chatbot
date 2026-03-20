# Animation Upgrades TODO

> Future improvements for 3D Avatar Chatbot animation systems.
> All proposals are **additive and non-destructive** — existing behavior is preserved;
> new layers blend on top of the current pipeline.

---

## Current Architecture Snapshot

| System | File | Technique | Status |
|--------|------|-----------|--------|
| VRM Loading | `src/VRMLoader.js` | @pixiv/three-vrm expressionManager | Production |
| GLB Loading | `src/VRMLoader.js` | three.js GLTFLoader + AnimationMixer | Production |
| Lip Sync | `src/LipSyncEngine.js` | Text-to-phoneme → 3 visemes (aa, ee, oh) | Production |
| Gaze | `src/BehaviorEngine.js` | Expression-based (lookLeft/Right/Up/Down) | Production |
| Idle / Breathing | `src/ProceduralAnimator.js` | Sine-wave bone offsets on rest pose | Production |
| Emotion | `src/EmotionEngine.js` | Keyword + emoji scoring → expression blend | Production |
| Blink | `src/VRMLoader.js` | Timer-driven (2.5-6.5 s interval) | Production |
| State Machine | `src/BehaviorEngine.js` | 5-state FSM (IDLE → LISTENING → THINKING → SPEAKING → MICRO_IDLE) | Production |
| VR IK | `src/gltf-viewer/VRPoseSystem.js` | CCD-IK chains + pose presets | Partial |
| VR Bone Grab | `src/gltf-viewer/VRBoneGrabber.js` | Controller raycast → bone rotation | Production |
| T-Pose Fix | `src/NaturalPosePlugin.js`, `src/PoseNormalizer.js` | 3-tier (VRM normalized / world-space / Euler fallback) | Production |
| Physics | ProceduralAnimator + damp() | Exponential smoothing only | Basic |
| Morph Adapter | `src/MorphTargetAdapter.js` | ARKit/Oculus/Blender name mapping | Production |

---

## 1. Speaking — Lip Sync & Vocal Animation

### 1.1 Audio-Driven Viseme System
**Industry standard**: Oculus OVRLipSync / Apple ARKit blend shapes (15 visemes).
AAA titles (Cyberpunk 2077, The Last of Us Part II) drive mouth from real-time FFT
or pre-baked phoneme tracks, not text approximation.

- [ ] Add Web Audio API `AnalyserNode` tap on TTS `<audio>` output
- [ ] Compute amplitude envelope + formant peaks per frame
- [ ] Map formant bands → extended viseme set (15 ARKit shapes: jawOpen,
      mouthFunnel, mouthPucker, mouthLeft, mouthRight, mouthSmileL/R,
      mouthFrownL/R, mouthDimpleL/R, mouthStretchL/R, mouthRollLower,
      mouthRollUpper, mouthShrugLower, mouthShrugUpper, mouthClose)
- [ ] Fall back to current text-based engine when audio tap unavailable
- [ ] Smooth with critically-damped spring (not linear lerp) for organic feel

### 1.2 Coarticulation
**Industry standard**: Naughty Dog's blend-shape anticipation system — each viseme
begins transitioning ~80 ms before the phoneme boundary.

- [ ] Add look-ahead buffer (2-3 phonemes) to `LipSyncEngine`
- [ ] Blend onset/offset curves per viseme pair (coarticulation matrix)
- [ ] Weight consonant visemes by surrounding vowel context

### 1.3 Jaw & Tongue Bones
**Industry standard**: AAA face rigs drive jaw bone + tongue chain separately
from morph targets for secondary physics.

- [ ] Detect jaw bone in skeleton (`jaw`, `chin`, `mandible`)
- [ ] Drive jaw rotation proportional to `aa` viseme intensity
- [ ] Optional tongue bone animation for /l/, /t/, /th/ phonemes

### 1.4 Throat & Neck Micro-Motion
**Reference**: Unreal MetaHuman — subtle larynx bob + sternocleidomastoid
flex during speech.

- [ ] Add neck bone micro-rotation layer (±0.02 rad) synced to vowel amplitude
- [ ] Subtle forward lean during emphasis (pitch peak detection from audio)

---

## 2. Eye Gaze & Attention

### 2.1 Bone-Based Eye Rotation
**Industry standard**: Skeletal eye bones with constraint-driven look-at solver
(Unity AIM constraint / Unreal Look-At IK).

- [ ] Detect eye bones (`leftEye`, `rightEye`) in humanoid rig
- [ ] Implement look-at solver: world-space target → local eye quaternion
- [ ] Layer on top of existing expression-based gaze (additive)
- [ ] Clamp rotation to anatomical limits (±35deg horizontal, ±25deg vertical)
- [ ] Add convergence for near targets (each eye aims independently)

### 2.2 Saccade System
**Reference**: GDC talk "Eyes of the NPCs" (CD Projekt RED) — micro-saccades
every 200-500 ms between fixation points.

- [ ] Generate saccade targets on a Poisson schedule (200-500 ms intervals)
- [ ] Ballistic saccade profile: fast initial rotation + deceleration
- [ ] Triangle pattern: left eye → right eye → mouth → repeat (during listening)
- [ ] Inhibit saccades during blinks

### 2.3 Pupil Dilation
**Reference**: Red Dead Redemption 2 — pupil size driven by light + emotion.

- [ ] Expose pupil morph target or UV-scale on iris material
- [ ] Drive dilation from: ambient light estimation, emotion intensity, attention
- [ ] Smooth changes over 0.3-0.8 s (physiologically accurate)

### 2.4 Head-Follows-Gaze
**Industry standard**: Head rotation follows eye rotation with ~150 ms delay
and 50% of eye amplitude.

- [ ] Add gaze-driven head rotation layer in `ProceduralAnimator`
- [ ] Delay = 120-180 ms, amplitude = 40-60% of eye offset
- [ ] Blend with existing mouse-driven head tracking (whichever is dominant wins)

---

## 3. Idle & Breathing

### 3.1 Perlin Noise Motion
**Industry standard**: AAA idle loops use layered Perlin noise, not sine waves,
for organic non-repeating motion (Naughty Dog, Santa Monica Studio).

- [ ] Replace `Math.sin(t * freq)` in `ProceduralAnimator` with Simplex/Perlin noise
- [ ] Layer 3 octaves: slow sway (0.1 Hz), medium fidget (0.4 Hz), micro-tremor (2 Hz)
- [ ] Per-bone amplitude and frequency offsets for natural phase differences

### 3.2 Weight Shift
**Reference**: GDC "Animating Kratos" — standing characters shift weight
between feet every 5-12 seconds.

- [ ] Add hip lateral translation (±2 cm) on slow noise curve
- [ ] Opposite knee slight bend via upper-leg rotation
- [ ] Trigger foot adjustment step when shift exceeds threshold

### 3.3 Micro-Gestures & Fidgets
**Reference**: The Last of Us Part II idle system — randomly queued
micro-animations (scratch, adjust hair, look at hands, sigh).

- [ ] Build gesture clip library (procedural or baked):
  - Head scratch, nose touch, chin rest, arm fold/unfold
  - Deep breath (expanded chest + sigh exhale)
  - Shoulder roll, neck stretch
- [ ] Random scheduler with cooldowns (one fidget every 15-40 s)
- [ ] Blend in/out over 0.5 s using additive animation layer

### 3.4 Muscle Tension & Relaxation Cycle
**Reference**: Unreal MetaHuman — idle face has subtle muscle drift
(brow micro-raises, lip corner shifts).

- [ ] Add face idle layer: random blend shape noise on brow, lip corners, nostrils
- [ ] Amplitude 0.02-0.08, frequency 0.05-0.15 Hz
- [ ] Correlate with emotional state (tense = higher amplitude)

---

## 4. Speaking Body Language

### 4.1 Gesture Synthesis (Beat Gestures)
**Industry standard**: Conversational NPCs use beat gestures timed to speech
prosody (Uncharted, God of War).

- [ ] Detect emphasis in TTS output (pitch peaks, stressed syllables)
- [ ] Map emphasis points to hand/arm gesture primitives:
  - Open palm, point, illustrator sweep, enumeration count
- [ ] Procedural IK-based hand position (target → upper-arm → forearm → wrist chain)
- [ ] Additive layer on `ProceduralAnimator` with `TALK` mode active

### 4.2 Posture Shifts During Speech
**Reference**: AAA dialogue systems — character shifts stance when
switching emotional tone mid-sentence.

- [ ] Monitor `EmotionEngine` output during speech
- [ ] On emotion change: trigger torso lean/weight shift (0.8 s transition)
- [ ] Correlate posture with emotion: happy → open chest, sad → collapsed chest,
      angry → forward lean

### 4.3 Hand Rest Poses
**Reference**: Unreal MetaHuman + CD Projekt RED — hands rest in natural
positions, not T-pose arms-at-sides.

- [ ] Define hand rest pose library (hands clasped, one hand on hip,
      arms loosely crossed, hands in pockets gesture)
- [ ] Transition between rest poses on emotion or topic change
- [ ] IK blend so hands avoid interpenetrating body mesh

---

## 5. Dancing & Full-Body Motion

### 5.1 Rhythm Detection & Beat Sync
**Industry standard**: Fortnite, Just Dance — animation system syncs to
audio BPM with beat-locked keyframes.

- [ ] Add BPM detection via Web Audio API onset detection (spectral flux)
- [ ] Lock procedural dance cycle to detected beat grid
- [ ] Support half-time and double-time feel variations

### 5.2 Dance Move Library
**Reference**: Fortnite emotes — short looping clips that blend seamlessly.

- [ ] Create modular dance building blocks:
  - Upper body: arm pumps, waves, rolls
  - Lower body: step-touch, bounce, hip sway
  - Combined: full choreography loops
- [ ] Each block = additive clip or procedural function with phase parameter
- [ ] Random sequencer picks combinations, avoiding repetition

### 5.3 Motion Matching
**Industry standard**: The Last of Us Part II, Forza Horizon 5 — motion
matching selects best-fit animation frame from a database based on current
velocity, facing, and desired trajectory.

- [ ] (Long-term) Implement motion matching database for locomotion + dance
- [ ] Pose feature vector: joint positions + velocities + trajectory
- [ ] Nearest-neighbor search with spring-damped blending at transitions

### 5.4 Inverse Kinematics for Feet
**Reference**: Any AAA title with terrain — foot IK prevents foot sliding
and ensures ground contact.

- [ ] Add two-bone IK solver for legs (hip → knee → ankle)
- [ ] Raycast down from hips to find ground plane
- [ ] Blend foot IK with procedural dance to eliminate sliding

---

## 5b. Walking & Locomotion (Planned)

> **Status**: Not yet implemented — architectural planning phase.
> This section outlines the industry-standard approach for avatar locomotion.

### 5b.1 Procedural Walk Cycle
**Industry standard**: AAA titles (GTA V, Red Dead 2, Uncharted 4) use
parameterized procedural walk cycles or blended motion-captured clips
driven by velocity and direction.

- [ ] Implement basic bipedal walk cycle generator:
  - Leg swing via hip/knee/ankle IK chain
  - Foot plant detection with ground contact events
  - Arm counter-swing (opposite arm to leg, ~30% amplitude)
  - Hip vertical bob (sinusoidal, 2-4 cm at walk speed)
  - Spine counter-rotation (shoulders twist opposite to hips)
- [ ] Speed-parameterized blending: idle → walk → jog → run
- [ ] Direction blending: forward, backward, strafe left/right (2D blend space)

### 5b.2 Foot IK & Ground Adaptation
**Industry standard**: All AAA locomotion systems use foot IK to prevent
floating/penetrating feet on uneven terrain (Unreal/Unity built-in).

- [ ] Two-bone IK solver per leg (hip → knee → ankle)
- [ ] Per-frame ground raycast from each foot
- [ ] Pelvis height adjustment based on lowest foot contact
- [ ] Toe alignment to surface normal (ankle rotation)
- [ ] Foot locking during stance phase (prevents sliding)

### 5b.3 Root Motion vs In-Place Animation
**Industry standard**: Root motion (animation drives transform) is used
for precise movement (combat, cinematics). In-place animation with
code-driven translation is used for responsive gameplay.

- [ ] Support both modes: root-motion clips and in-place + velocity drive
- [ ] Extract root displacement from animation clips for root-motion mode
- [ ] Blend between modes for smooth transitions (cutscene → gameplay)

### 5b.4 VR Locomotion Integration
**Reference**: VRChat, Blade & Sorcery — avatar walks when user moves
via thumbstick, with upper body driven by tracked controllers.

- [ ] Map thumbstick input to walk velocity vector
- [ ] Upper body follows HMD + controllers (IK), lower body walks procedurally
- [ ] Smooth acceleration/deceleration curves (no instant start/stop)
- [ ] Turn-in-place animation when user rotates without translating

### 5b.5 Navigation & Pathfinding (Future)
**Reference**: NavMesh-based pathfinding (Unreal/Unity standard).

- [ ] Bake simple NavMesh from scene geometry
- [ ] A* pathfinding for autonomous avatar movement
- [ ] Steering behaviors: arrive, avoid obstacles, follow path
- [ ] Integration with chat commands ("walk to X", "come here")



### 6.1 VRM Spring Bone Integration
**Industry standard**: VRM spec includes SpringBone for hair, skirt, accessories.
@pixiv/three-vrm ships `VRMSpringBoneManager`.

- [ ] Enable `vrm.springBoneManager` if present on loaded model
- [ ] Call `vrm.springBoneManager.update(dt)` in render loop
- [ ] Expose gravity, stiffness, drag multipliers in settings panel

### 6.2 Procedural Secondary Motion
**Reference**: Pixar's "Overlapping Action" principle — appendages follow
root motion with delay and overshoot.

- [ ] Add mass-spring-damper simulation for hair/ponytail bones when no SpringBone
- [ ] Input = parent bone velocity; output = child bone rotation offset
- [ ] Tune: mass 0.5, spring 80, damping 5 (start values, expose in settings)

### 6.3 Cloth Simulation (Lightweight)
**Reference**: Unreal Chaos Cloth / Unity Cloth — vertex-level cloth sim
for skirts, capes, scarves.

- [ ] Detect skirt/cape bones or cloth mesh regions
- [ ] Verlet integration with distance constraints (10-20 particles)
- [ ] Wind force = Perlin noise vector field

### 6.4 Soft-Body Jiggle
**Reference**: Most AAA character rigs include jiggle bones for soft tissue
(cheeks, chest, belly) — critically-damped spring on local rotation.

- [ ] Identify soft-tissue bones by naming convention or user tag
- [ ] Apply per-bone spring: input = parent acceleration, output = rotation offset
- [ ] Critically damped (zeta = 1.0) to prevent oscillation artifacts

---

## 7. Facial Animation Upgrades

### 7.1 FACS-Based Blend Shapes
**Industry standard**: Facial Action Coding System (Ekman & Friesen) —
44 Action Units used by AAA studios (Naughty Dog, Rockstar, CD Projekt RED).

- [ ] Map VRM expressions to FACS Action Units (AU1 innerBrowRaise,
      AU2 outerBrowRaise, AU4 browLowerer, AU6 cheekRaiser, etc.)
- [ ] Drive AUs from emotion engine with per-AU intensity curves
- [ ] Support asymmetric expressions (one-sided smile, raised eyebrow)

### 7.2 Wrinkle Maps
**Reference**: Unreal MetaHuman — normal map layers driven by blend shape
values for dynamic wrinkle detail.

- [ ] Add secondary normal map slots on face material
- [ ] Blend wrinkle normal intensity proportional to blend shape value
- [ ] Key maps: forehead furrow (AU4), crow's feet (AU6), nasolabial fold (AU12)

### 7.3 Micro-Expression Flashes
**Reference**: L.A. Noire — involuntary micro-expressions that last 40-200 ms
reveal true emotional state.

- [ ] Add micro-expression layer triggered by emotion transitions
- [ ] Flash duration: 80-160 ms, intensity: 0.3-0.5 of full expression
- [ ] Trigger when new emotion differs from current (brief "leak" of new emotion)

---

## 8. State Machine & Blending

### 8.1 Animation Layer System
**Industry standard**: Unity Animator layers / Unreal AnimGraph —
multiple animation layers with masks and blend weights.

- [ ] Implement layer stack: Base (idle) → Additive (breathing) →
      Override (gesture) → Face (expressions) → Physics (spring)
- [ ] Per-layer bone mask (e.g., gesture layer only affects arms)
- [ ] Per-layer blend weight with smooth ramping

### 8.2 Blend Tree for Locomotion
**Reference**: Unity Blend Trees — parameterized blending between
walk/run/turn animations based on speed and direction.

- [ ] (Future, if locomotion added) 2D blend tree: speed × turn angle
- [ ] Foot-phase sync between blended clips

### 8.3 Sub-State Machines
**Reference**: Unreal AnimBP nested state machines.

- [ ] Break SPEAKING into sub-states: SpeakingCalm, SpeakingExcited,
      SpeakingWhisper — each with different gesture intensity
- [ ] Break IDLE into: StandingIdle, LeaningIdle, FidgetIdle
- [ ] Transition conditions from EmotionEngine intensity thresholds

---

## 9. VR-Specific Enhancements

### 9.1 Full-Body IK (FABRIK)
**Industry standard**: VRChat, NeosVR — FABRIK solver for full-body
estimation from 3 tracked points (HMD + 2 controllers).

- [ ] Implement FABRIK (Forward And Backward Reaching IK) solver
- [ ] Input: head position/rotation, left/right hand position/rotation
- [ ] Estimate hip position, spine curvature, leg poses
- [ ] Support optional tracker points (feet, hip, elbows)

### 9.2 Finger Tracking
**Reference**: Meta Quest hand tracking API — 26 joints per hand.

- [ ] Detect WebXR hand tracking support (`inputSource.hand`)
- [ ] Map 26 XRJointSpace joints → VRM finger bones
- [ ] Smooth with per-joint spring damper (stiffer for proximal, softer for distal)

### 9.3 Mirror Mode
**Reference**: VRChat mirror — avatar mirrors user's motion for
self-expression and feedback.

- [ ] Add virtual mirror plane in scene
- [ ] Render mirrored avatar with flipped X on camera
- [ ] Useful for pose checking and social interaction

### 9.4 Social VR Gestures
**Reference**: VRChat gesture system — controller inputs trigger
hand poses (peace sign, thumbs up, fist, open hand, point).

- [ ] Map controller button combos to gesture presets
- [ ] Blend between gesture poses using trigger analog value
- [ ] Add gesture recognition from hand tracking (ML-based classifier)

---

## 10. Performance & Pipeline

### 10.1 GPU Skinning & Morph Target Optimization
- [ ] Ensure morph targets use GPU-based computation (`morphTargetsRelative`)
- [ ] Batch blend shape updates per frame (single `needsUpdate` flag)
- [ ] Profile morph target count; if > 52, consider LOD groups

### 10.2 Animation LOD
**Industry standard**: AAA engines reduce animation update rate
at distance (60 Hz near, 15 Hz mid, 5 Hz far).

- [ ] Skip procedural animator update every N frames when avatar < 100px on screen
- [ ] Reduce spring bone iterations at distance
- [ ] Disable micro-expressions and saccades below visibility threshold

### 10.3 Web Worker Offloading
- [ ] Move IK solving to a Web Worker (transferable ArrayBuffer for bone data)
- [ ] Move spring bone simulation to Worker
- [ ] Keep render-thread cost to quaternion copy only

---

## Priority Matrix

| Upgrade | Impact | Effort | Priority |
|---------|--------|--------|----------|
| 1.1 Audio-Driven Visemes | High | Medium | P0 |
| 2.1 Bone-Based Eye Rotation | High | Low | P0 |
| 2.2 Saccade System | High | Low | P0 |
| 6.1 VRM Spring Bone Integration | High | Low | P0 |
| 3.1 Perlin Noise Motion | Medium | Low | P1 |
| 2.4 Head-Follows-Gaze | Medium | Low | P1 |
| 4.1 Beat Gesture Synthesis | High | Medium | P1 |
| 8.1 Animation Layer System | High | High | P1 |
| 1.2 Coarticulation | Medium | Medium | P2 |
| 3.2 Weight Shift | Medium | Low | P2 |
| 3.3 Micro-Gestures & Fidgets | Medium | Medium | P2 |
| 5.1 Rhythm Detection | Medium | Medium | P2 |
| 7.1 FACS Blend Shapes | High | High | P2 |
| 9.1 FABRIK Full-Body IK | High | High | P2 |
| 5b.1 Procedural Walk Cycle | High | High | P2 |
| 5b.2 Foot IK & Ground Adapt | High | Medium | P2 |
| 9.2 Finger Tracking | Medium | Medium | P2 |
| 5b.4 VR Locomotion | Medium | Medium | P2 |
| 5.3 Motion Matching | Very High | Very High | P3 |
| 6.3 Cloth Simulation | Low | High | P3 |
| 7.2 Wrinkle Maps | Low | Medium | P3 |
| 10.3 Web Worker Offloading | Medium | High | P3 |

---

## References

- **Naughty Dog GDC**: "The Last of Us Part II Animation System" — layered state machines, motion matching
- **CD Projekt RED GDC**: "Animating Geralt" / "Eyes of NPCs" — saccade system, gaze behavior
- **Unreal MetaHuman**: FACS-based face rig, wrinkle maps, micro-expressions
- **Oculus OVRLipSync**: Real-time audio-to-viseme with 15 blend shapes
- **Apple ARKit**: 52 blend shape specification (face tracking standard)
- **VRM Specification**: SpringBone, Expression, LookAt, Humanoid systems
- **Pixar's 12 Principles**: Overlapping action, follow-through, secondary motion
- **FABRIK Paper**: Aristidou & Lasenby, "FABRIK: A fast, iterative solver for the IK problem"
- **Fortnite/Epic**: Emote system, beat-locked dance animations
- **Unity Mecanim**: Animator layers, blend trees, avatar masks
