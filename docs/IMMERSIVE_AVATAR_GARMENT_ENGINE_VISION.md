# HomePilot Immersive Avatar & Garment Engine — Product Vision

**North star:** Make **HomePilot Avatar / NEXUS** a compelling *embodied* conversational AI companion: a VRM character with the animation, fashion quality, physical consistency, responsiveness and personality users associate with well-produced MMORPG NPCs. The same character identity and generated outfit should survive chatting, walking, turning, sitting, dancing, gestures and compatible immersive VR/AR interaction **without severe garment tearing, floating, tunneling or catastrophic folding**.

**This is a product vision, not a statement about the current deployed engine.** It guides the [reviewed technical plan](POSE_AWARE_GARMENT_ENGINE_V2_PLAN.md) and [Claude Code runbook](CLAUDE_CODE_GARMENT_ENGINE_V2_RUNBOOK.md). The first implementation cut remains **Cut 0: exact deployed asset and worker diagnostics**. Do not start universal physics or production deployment based on this document.

## 1. Desired end-to-end user experience

1. A user chooses or uploads a rights-compatible VRM avatar, chats with NEXUS and asks for a new look through AI LIVE TRY-ON.
2. **3D-Wardrobe-Forge on Hugging Face** generates the **same character wearing the outfit** as a standard skinned VRM, with fit and garment geometry, material data, skin weights, and where appropriate pose-space corrective shapes. An optional physics sidecar accompanies free-moving garments. It preserves the avatar's humanoid, expressions, lookAt, face and lip-sync capabilities.
3. **HomePilot loads look.vrm and verified optional physics data**, caches them with hashes and selects a device-appropriate deformation profile. Older VRMs remain usable even without a sidecar.
4. NEXUS can talk, listen, look at the user, emote, gesture, walk, turn, sit and stand, run a supported VRMA/BVH sequence, or respond to Pose Studio/Puppet IK. **Outfits respond to the final animated skeleton every frame**, not only after the pose has finished.
5. On **desktop**, quality favors detailed materials and silhouette. On **mobile**, quality adjusts to hardware. In **WebXR VR**, rendering/physics preserve headset-appropriate frame pacing. In **AR/passthrough**, known or estimated floor/seat/environment contact participates only when the scene supplies reliable collision geometry; use virtual proxies or graceful fallback otherwise.
6. Changing outfit/avatar mid-conversation does not lose identity/expressions or leave stale cloth buffers, worker jobs, collider cache or animation-state corruption.

**Core promise: generate once, reuse across movements.** Cloud generation in Forge is for garment authoring; routine physics runs on the client with no per-frame Hugging Face roundtrip.

## 2. AAA-inspired means measurable quality, not proprietary game code

This project draws on documented skeletal animation, pose-space deformation, cloth constraints, body contact and LOD techniques. We do not claim knowledge of Genshin Impact's internal proprietary code, and we do not promise instant console/AAA parity.

| Quality dimension | User-visible objective | Engineering method |
| --- | --- | --- |
| **Garment identity and fit** | A denim leg remains a denim leg; a long dress still looks like a long dress while sitting | Correct templates and seam topology, two-leg clothing construction, avatar-aware fit, rig validation |
| **Dynamic movement** | Fabric follows walking, sitting, dancing, turning and gravity with inertia instead of snapping or waiting seconds | Post-animation skeleton capture, coarse free-panel cloth simulation where useful |
| **Joint deformation** | No severe crotch bridge, stretched hip fold or collapsed boot shaft | Correct skinning plus hip/knee/crotch joint-angle corrective shapes |
| **Physical contact** | No major garment intersection with body, knees, seat, floor or approved layered fabric | Body surface or capsules *depending on garment*, seat/floor/environment colliders, robust constraint handling |
| **Visual fabric quality** | Satin, cotton, denim, leather and knit have distinct realistic/stylized appearance | VRM-compatible MToon/PBR, calibrated materials, normals, roughness/texture/LOD, silhouette QA |
| **NPC expressiveness** | Facial expression, eye contact, speech/lip sync, hand gestures remain smooth during cloth simulation | Layered animations, correct VRM runtime ordering, bounded per-frame work |
| **Immersion and comfort** | Believable world scale, no frozen XR frames or lagging clothing | WebXR integration, adaptive physics/render LOD, measured headset latency and frame stability |
| **Asset compatibility** | Standard VRM still renders/animates outside HomePilot | Mandatory look.vrm is conventional skinned VRM; optional HomePilot cloth sidecar never required for basic playback |

**Quality is visual and geometric.** Physics alone is not enough when an authored mesh, normals, materials or body fit is wrong. Conversely high polygon counts do not prevent collisions. Assess both photo/frame quality and measurable geometry.

## 3. Cloud authoring → client animation → hybrid physics

~~~text
AI request + rights-compatible avatar
    |
    v
Hugging Face: 3D-Wardrobe-Forge
  generator: avatar fit + garment topology + anatomy-aware skin
  authoring: pose-space hip/knee correctives + fabrics
  optional: low-res cloth surface, pin map, constraints, collider metadata
    |
    v
Immutable validated artifact:
  look.vrm (required) + previews + fit/provenance/license metadata
  optional cloth-physics sidecar(s) with hashes and version contract
    |
    v
HomePilot runtime — authoritative final humanoid pose
  Pose Studio, Puppet IK, VRMA/BVH, locomotion, AI behavior,
  gaze, facial expressions / talk, root motion
    |
    +--> fitted garments: skinning + corrective morph + legacy correction
    |
    +--> loose regions: coarse XPBD cloth + gravity and contact
    |     thighs/hips, floor and seat, optional approved AR geometry
    |
    v
One final compatible skinned render update, device LOD and materials
    |
    +--> Desktop browser
    +--> Mobile WebGL / AR
    +--> WebXR VR / compatible headset
~~~

**VRM portability boundary:** The VRM can be worn/animated in generic compatible viewers. The optional cloth physics profile is a **HomePilot runtime extension** unless some other client supports that profile; a valid VRM alone does not obligate third-party viewers to simulate cloth.

## 4. Garment-family physics, not a universal cloth stage

The engineering plan's **Section C garment policies take precedence over any generic pipeline diagram**:

| Garment | Avatar-authoring model | Runtime deformation |
| --- | --- | --- |
| Yellow maxi sundress | Fitted skinned bodice and waist, pelvis-pinned skirt lower panel, appropriate flowing topology | Gravity-aware coarse XPBD skirt with hip/thigh/seat/floor collision; fallback to existing skinning/correction |
| Crop top + blue jeans | Separate L/R leg topology verified, correct shin influence, hip/crotch gusset geometry | Existing skinning + knee/hip/crotch corrective shapes and local contact; *not* entire-jeans XPBD |
| Black bodycon mini | Skinning with authored hip/seat fold correction | Existing collision correction, with selective dynamic detail only if measured later |
| Over-the-knee boots | Rigid sole and foot, skin-weighted shaft and knee morph | Existing shoe-capped collision with refined skinned body where capsulized contact is insufficient |
| Jackets, capes, skirts | Skin shoulders/waist; free cloth panels | Coarse selective dynamics after measured pilot |
| Stockings, leggings | Skin-space close fitting + joint correctives | Corrective/skin contact, generally no full cloth |
| Hair, small accessories | Existing SpringBone or attachments | Spring motion only; no claim it solves dress-thigh collision |

**Forge owns correctness of asset topology.** Do not make a pose solver compensate for malformed or wrong-weighted garments. In particular current Forge native.py **already includes lower-leg candidates for jeans**, and the sundress template **already excludes lowerLegs anchors**; inspect exported live weights and generator version before changing recipes.

## 5. Animation / NPC / immersive world interaction requirements

**Final-pose contract:** All garment skinning, cloth pin targets and collider transforms derive from the **same final raw VRM skeleton pose** seen by the rendered body after normalized-to-raw synchronization and all relevant animation layers. Avoid double-running the VRM's springs or overwriting bones from separate systems.

Test scenarios spanning:
- **NPC locomotion:** idle → walk → stop, turn, run, avatar scaling and root motion.
- **Human posture:** standing → sittingWide → sittingDesk → standing, hip abduction, bent knee, crouch and reach.
- **Talk and behavior:** concurrent lip-sync/face tracking, gaze, blink, gestures and motion.
- **VRMA/BVH:** play, loop, blend, interrupt, stop/restart, VRM 0.x/1.0 retargeted clips.
- **Pose Studio/XR:** presets, manual sliders, puppet drags, controller movement, grab/release, outfit/avatar swap during animation.
- **Environment:** floor/seat proxies and explicit tracked/known AR collision shapes where supported; absence of reliable environment scanning must degrade predictably.

**Compatibility caveat:** “VRM glasses” is not a universal hardware capability. Claim support for explicitly **tested WebXR device/browser combinations**, using feature detection for immersive sessions, passthrough, controllers, hand tracking and plane detection rather than assumptions.

## 6. Adaptive quality in desktop, mobile and immersive XR

| Tier | Priority | Acceptable fallback |
| --- | --- | --- |
| Legacy / viewer outside HomePilot | Standard VRM skinning and valid materials | No HomePilot-specific cloth physics claimed |
| Constrained mobile | Good fitted morphs, basic silhouette, memory/FPS stability | Reduced panel physics or legacy correction |
| Balanced desktop/mobile | Coarse cloth where free fabric genuinely exists | Reduced particles/substeps/interpolation |
| High desktop | Higher cloth LOD, refined collision/materials, optional self/layer contact | Return to Balanced when measured costs spike |
| VR/AR WebXR | Stable stereo, tracking and comfort, plausible cloth | Coarse cloth or animation-only fallback rather than breaking headset refresh |

**Performance planning, not measured achievement:** 72 Hz headset total frame budget is approximately 13.9 ms; 90 Hz about 11.1 ms. Cloth shares that time with stereo rendering, avatar skeleton, face/talk and browser overhead. Validate P50/P95 cost, frame drops/reprojection and long-session memory on physical representative hardware. Do not use a single synthetic 4 ms desktop target as universal certification.

**Separate scorecards:** 
- (A) pose-settled mesh geometry (contact, seam, strain, triangle inversion);
- (B) animation/transient cloth stability and latency;
- (C) visual/material fidelity and silhouette;
- (D) mobile/WebXR performance and VR/AR comfort;
- (E) compatibility, identity, safe rollback and source rights.

## 7. Long-term roadmap — protect the immediate release order

| Cut | Deliverable | Proof of user value |
| --- | --- | --- |
| **0, first** | Capture deployed hashes, precise worker/asset root cause for all three looks | The wrong version/mesh/weight/pose path is identified or responsibly blocked |
| **1** | Jeans crotch/knee, bodycon hip, boot knee and any evidence-backed generator/export hotfix | No grotesque folds/leg bridge in target settled sitting poses |
| **2** | Final animated skeleton snapshot shared by Pose Studio, Puppet IK, VRMA/BVH and behaviors | Garments never read stale bones; no face/lipsync/animation regression |
| **3** | Yellow sundress lower-skirt XPBD pilot with waist pins, gravity, thighs, seat and floor | Natural motion through seated transitions on physical Android/desktop, plus XR pilot validation |
| **4** | Additional garment classes, optional hashed physics sidecar, material/render and layer improvements | Reusable physics-ready wardrobe, tested family by family |
| **Future** | Polished NPC locomotion/expressiveness, richer XR contact, authoring tools, higher-quality fabrics and device-specific fidelity | Sustained immersive companion sessions that maintain cloth and animation quality |

Cuts 0–3 are **not** equivalent to having shipped all AAA-like features. Implement them as separate reviewable PRs with explicit tests, preview deployment, feature-flag rollout and rollback, preserving the legacy corrector and old wardrobe packs. Nothing here authorizes mass regeneration, merging draft PR #119 or deploying to production.

## 8. Coding agent success and guardrails

Every Claude Code implementation cut must identify:
1. The user-visible NPC experience improved and the exact garment/device/movement tested.
2. What was verified in the source vs what remains a deployment/physics hypothesis.
3. Whether it changes Forge's **generator** or HomePilot's **client runtime** (or both), and the sidecar contract if any.
4. What passed geometric, animation and physical-device tests; never write “AAA complete” without relevant measurement.
5. Impact on existing lip sync, facial expressions, avatar identity, rights/license metadata, outfits, VRM 0.x/1.0, stereo/headset experience and old packs.
6. Feature flags and rollback. Work only on feature branches; do not silently ship.

**Experience-level acceptance story:** A user asks NEXUS for the yellow sundress, sees the *same character* wearing it, talks while the avatar looks back and gestures, watches it walk and sit in a supported environment, and sees the skirt drape and react sensibly rather than forming a ring or rigid slab. The cloud does not need to regenerate the outfit when the NPC changes poses. Expand that reliability to new outfits and immersive hardware over time.
