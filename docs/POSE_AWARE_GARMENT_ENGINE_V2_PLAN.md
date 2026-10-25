# HomePilot Pose-Aware Garment Engine V2 — Implementation Plan

**Status:** Proposed architecture and delivery plan only. No runtime changes are made by this document.  
**Owners:** 3D-Avatar-Chatbot (viewer/runtime/UI) and 3D-Wardrobe-Forge (asset authoring/export/QA).  
**Scope:** Existing and generated VRM looks; Pose Studio's currently displayed 43 positions; pose presets, manual bone edits, Puppet IK, VRMA/BVH/procedural animations, live try-on, desktop, Android WebGL and VR/AR.  
**Baseline:** Preserve full character identity, VRM 0.x/1.0 support, expression/gaze/lipsync, current wardrobe and safety/licensing gates. Do not silently replace or re-skin the original avatar.

## Decision

Build a **hybrid, pose-aware clothing system**, not a new general-purpose physics engine and not a blanket re-skin pass. The garment runtime must use the avatar's **final animated bone pose** every frame, deform garments with existing skinning plus joint-angle corrective morphs, then apply fabric-class-specific cloth simulation against moving collision proxies. Retain the existing after-settle PoseClothCorrection as a compatibility/low-end fallback until the new pipeline passes geometric and browser tests.

This is based on repository inspection, **not** a claim that the production URL is fixed or that screenshot artifacts have been reproduced in a browser. Prior measurements are historical regression baselines, not a substitute for testing the exact deployed 3 looks.

## A. Verified current state and causes to investigate

- Forge outfits are already rigged and skinned VRMs. Forge's "wardrobe/vrm/weight_transfer.py" transfers weights from avatar skin; "docs/GARMENT_TEMPLATE_SPEC.md" distinguishes garment **coverage** from **anchors**, explicitly warning not to bind a floor-length gown hem to the shins. Re-skinning everything blindly is neither necessary nor sufficient.
- HomePilot "src/gltf-viewer/VRPoseSystem.js" constructs a "PoseClothCorrector", calls "_releaseCloth()" when applying a pose, schedules "_settleCloth()" two frames after a blend, and invokes the correction from "update(dt)" after settling. No continuous simulated garment update is provided for animated motion. "src/gltf-viewer/PoseClothCorrector.js" CPU-skins Forge-tagged skinned garments and a material-name-selected body, runs "src/wardrobe/PoseClothWorker.js", and writes corrected positions back through inverse per-vertex skin matrices.
- "src/wardrobe/PoseClothCorrection.js" is a quasi-static push/edge-relaxation method. It includes seam welding, piece grouping, separate shoe defaults, layer correction and unfold passes. It is **not** a time-integrating simulation with velocities, gravity, persistent constraints or moving colliders.
- "docs/SITTING_WIDE.md" records an earlier black-bodycon + briefs + boots benchmark: before correction approximately 23 mm inside the bodycon; after correction 0–0.1 mm dress penetration in that test. It also records unresolved knee/hip inversions, brief stretching, and up to 13.2 mm boot penetration in re-baked validation. Browser correction reportedly arrived seconds after applying a pose. Do **not** transfer those outcomes to the yellow sundress or jeans without new tests.
- "src/gltf-viewer/ViewerEngine.js" currently updates the avatar/VRM near the beginning of the frame, then procedural motion, VRPoseSystem, puppeting, locomotion and motion; the cloth corrector runs only from VRPoseSystem. VRMA's normalised bone writes, raw bone syncing, and final collider capture need a formally defined per-frame order.
- The user screenshots show **more severe silhouette failures** than the black-bodycon measured set: yellow maxi skirt becomes a torus/long slab in "sittingWide" and "sittingDesk"; blue jeans bridge the separated legs in "sittingWide". These can arise from topology, weight distribution, loose-panel anchors, mesh deformation, or missing collision/contact. Treat that as a diagnostic hypothesis, not yet a proved single root cause.
- Current Forge docs "docs/POSE_CONTACT_QA.md" already have pose export, numerical contact checks, baking and engineering sheets. Forge "wardrobe/body_surface/xpbd.py" already implements optional **quasi-static** XPBD relaxation for generated shell fitting; it is off by default and does not provide a real-time animation solver.

### Minimum production debugging before redesign

1. Capture the deployed JavaScript and asset versions (commit SHA, look.vrm SHA-256, generator version, browser/version, mobile GPU), and compare them to GitHub, the bundled wardrobe and remote HF Forge. Verify that the live page actually serves the expected worker module and the exact expected look.
2. Add DEBUG diagnostics with per-pose/animation source, actual humanoid bone angles, garment count, simulated-vertex count, body collider count, worker load/status/errors, correction request generation, cancellation counts, duration, and last applied timestamp.
3. On every look load, classify **all** skinned meshes by Forge extras/garment IDs and inspect skinIndex, skinWeight, skeleton, bind/inverseBind matrices, vertices, indices, connected components, cloth UV splits and vertex topology. A missing Forge tag or a body material-name mismatch currently leads to silent fallback; report this explicitly.
4. Render skin-only, current-after-settle, and proposed-solver variants with identical camera, pose and mesh; capture front, side, back and wireframe, plus penetration/strain heatmaps and skirt hem position.
5. Isolate "sittingWide" and "sittingDesk" by actual preset **keys**, not presentation index. The UI currently shows 17/43 and 18/43; older docs mention 17/26. The test must be robust to ordering changes.
6. Test a "static screenshot" frame after 0.5, 2 and 12 seconds, and animated transitions/VRMA throughout; distinguish late correction, never-started correction and insufficient correction.
7. Capture the same look as a native Forge export, bundled look and remote generated look to find contract/cache/source regressions.

## B. Engine pipeline and data ownership

**Single writer rule:** only the render pipeline's garment simulation stage writes final garment positions; ordinary avatar bones remain owned by Pose Studio, animation mixers, IK and VRM. No garment algorithm moves the character body to solve contact.

Frame stages:
1. Sample all active animation tracks (VRMA, BVH, procedural, idle, locomotion, talk) and Pose Studio blend/IK/custom bone deltas into the authoritative humanoid pose. Use explicit ownership/priority of layers (e.g. Pose Studio overrides base locomotion, face controls separate).
2. Update normalized VRM proxy → raw skeleton once at the correct point, preserving VRM expressions and SpringBone ordering. Capture final world matrices *after* all bone writers and avatar root/root-motion changes.
3. Evaluate garment skinning and compact joint-angle corrective morphs. Generate animated pin targets for fabric areas attached to the body.
4. Update body collision capsules (hips, thighs, calves, knees, chest, upper arms, feet) and optional refined body surface/SDF. Detect when proxies self-overlap; prevent impossible contradictory contact rather than repeatedly pushing a cloth vertex between two colliders.
5. Step hybrid XPBD solver with deterministic fixed substeps (initial target 60 Hz with bounded catch-up); satisfy stretch, shear, bend, seam/weld, pin and unilateral contact constraints. Enable self-collision/layer collision where budgets allow.
6. Transfer low-res cloth simulation mesh to the render mesh via barycentric attachment or author-provided correspondence; only one GPU-visible skin/cloth displacement result. Update bounds/normals as needed and render once.
7. On user drag, animated pose and clip transitions, simulate continuously. On look/avatar switch, reset persistent positions/velocities and collision cache. On tab resume, large time jump, teleport or severe solver divergence, do bounded stable reset to the current animated pin target.
8. Run optional VRM SpringBone for existing hair and accessory secondary motion; avoid treating SpringBone as a substitute for deformable skirt/crotch collision.

**Implementation choice:** pure JS/WASM XPBD worker for CPU mobile fallback, coarse simulation surface per garment and skin-space/GPU-compatible output. Do not claim a WebGL compute-shader solver is universally available. Keep WebGPU GPU compute as a separately gated future option. Use no external game-engine binary dependency in the browser MVP.

## C. Garment-specific policies

| Garment | Default deformation path | Physics/contact | Critical authored data |
| --- | --- | --- | --- |
| Crop top / fitted tee | Existing skinning + shoulder/armpit correctives | Body clearance only, small optional hem | Chest/shoulder/upper-arm attachment |
| Jeans / slim trousers / leggings | Independent left/right leg topology, skin-weighted knee/hip correctives, crotch gusset corrective | Targeted crotch/thigh and leg-to-leg collision, limited cloth | Two leg shells, pelvis bridge, seam and knee twist limits |
| Black bodycon mini dress | Skinning + hip/buttock/thigh fold correctives | Short skirt XPBD region, body/layer collision | Pelvis and thigh attachments, closed skirt topology |
| Yellow maxi sundress | Fitted skinned bodice + pelvis-pinned flowing lower skirt | Gravity-aware cloth, thigh/seat collision, optional self-collision and hem | **No shin/ankle anchor**, waist pins, free-flowing panel topology, simulation/render mesh mapping |
| Jackets, coats, capes | Skinned shoulder/upper arm + free hem/tail simulation | Body collision, self-collision where needed | Back/shoulder pins, sleeve and coat panel segmentation |
| Stockings/underlayers | Second-skin bind and corrective shapes | Strict layer order and occlusion, no free cloth by default | Leg skin weights, crotch segmentation |
| High boots | Foot/ankle largely rigid, calf shaft constrained, knee flexion corrective | Bounded shaft relaxation at knee; shoe cap retained | Separate sole/shaft, knee bend blend, no contradictory calf/thigh pushing |

**Hard stop:** a physically impossible mesh (a one-piece trouser tube spanning two distant legs, or a gown hem permanently bound to both shins) must be repaired in Forge's authoring/binding stage. More iterations of a collider solver will not correct its geometry.

## D. Versioned Forge → HomePilot physics contract

Introduce optional "clothPhysics" metadata per generated look without breaking old "wardrobe.json" packs. Suggested **v3** manifest field (the schema is proposal, not yet supported by either repo):

~~~json
{
  "schemaVersion": 3,
  "looks": [{
    "id": "maxi-sundress",
    "vrmUrl": "looks/maxi-sundress/look.vrm",
    "clothPhysics": {
      "schemaVersion": 1,
      "url": "looks/maxi-sundress/cloth-physics.json",
      "sha256": "<64-lowercase-hex-bytes-hash>",
      "meshSha256": "<64-lowercase-hex-render-mesh-hash>"
    }
  }]
}
~~~

"cloth-physics.json" contains a topology/vertex-count-validated list of garment pieces, where each entry has:
- Persistent garment ID, slot, layer, mesh primitive fingerprint and relevant VRM node/primitive reference; exact mapping to the exported VRM mesh. Do not depend only on material strings.
- Fabric class and physical parameters (thickness, mass/inverse mass, stretch/shear/bend compliance, damping, friction, drag, collision margins), versioned units (metres, seconds).
- Simulation mesh positions, triangles, welded seam vertex groups, rest edge lengths and bending constraints; render-mesh ↔ simulation-mesh barycentric map.
- Per-vertex pin weights and parent bone groups (waist, shoulders, etc.), corrective morph definitions keyed by continuous joint angles and rotation axes, max motion cap for shoes, collision group/mask and layered order.
- Body collider descriptors (bone-relative capsule or sphere shapes, body proxy reference), profile name, max budget LOD and deterministic reset/teleport threshold. Distinguish body collision groups from cloth self-collision.
- Checksum of source VRM bytes and stable mesh geometry hash; renderer refuses mismatched sidecar metadata and falls back to legacy physics.

Use packaged JSON/typed binary arrays only from integrity-verified same-origin or securely provided sources. Apply strict size/vertex limits, prototype-safe parsing and schema validation. Existing v1/v2 assets continue to load and use the current correction, or an explicitly approved precomputed generic profile. No implicit user privacy/age/rights changes from asset metadata. Confirm pack importer allowlist before adding sidecars.

## E. Code work packages (reviewable PRs)

**PR-A: Reproduce and observe (both repos)**  
3D-Avatar-Chatbot:
- "src/gltf-viewer/PoseClothCorrector.js": expose counts, worker health, worker errors/timeouts, mesh/pose SHA, source and elapsed correction time; avoid worker pending-message handler leakage when generations are invalidated; do not swallow failures without debug metrics.
- "src/gltf-viewer/VRPoseSystem.js": instrument preset selection, blend and settle/release events with pose generation IDs.
- "src/gltf-viewer/ViewerEngine.js": add final-pose snapshot telemetry and a debug geometry overlay, disabled by default.
- "tests/wardrobe/pose-cloth-correction.test.js": keep unit tests, add real VRM and screenshot integration test.
3D-Wardrobe-Forge:
- Extend "tools/inspect/pose_contact.py" and "tools/inspect/fit_checks.py" to reproduce maxi sundress, jeans and black bodycon with real assets, with exported HomePilot preset keys and visible geometry metrics. Store baselines under tests/fixtures.

**PR-B: Forge authored metadata and asset repairs**
- "wardrobe/vrm/weight_transfer.py", "wardrobe/engines/native.py", garment templates and build/export functions: garment family classification, coverage/anchor assertions, correct two-leg topology, correct maxi-hem anchoring, knee/crotch/hip blend-shape bake.
- "wardrobe/body_surface/xpbd.py": extract test vectors/config defaults for a portable constraint solver; this Python fitter is only a *reference*, not a browser physics update loop.
- "wardrobe/domain/manifests.py", wardrobe pack exporters and schema validation: write optional v3 clothPhysics sidecar with checksums and asset metadata.
- Add fast validation rejecting missing skin attributes, un-normalized weights, wrong skeleton reference, inverted rest triangles, disconnected seams, incorrect hem anchors, degenerate/rest edges, incompatible collision references.
- Keep all existing normal and adult-gated garment provenance/permissions checks.

**PR-C: Browser pipeline foundations**
- New "src/gltf-viewer/GarmentPhysicsManager.js": load and validate optional sidecar, choose garment profile/LOD, manage lifecycle (load, reset, dispose, rebind, fallback).
- New "src/gltf-viewer/FinalPoseSnapshot.js": authoritative post-animation bone matrix snapshot and pose generation token.
- Modify "src/gltf-viewer/ViewerEngine.js" to establish final bone -> corrective -> simulation -> render ordering.
- Modify "src/gltf-viewer/AvatarManager.js" and wardrobe swap boundaries so a new VRM binds to its own garment state. Never reuse correction arrays across looks.
- Preserve "src/gltf-viewer/PoseClothCorrector.js" for old looks and low-end fallback.

**PR-D: Continuous XPBD solver**
- New "src/wardrobe/physics/GarmentXPBDWorker.js", "ConstraintBuilder.js", "CollisionProxies.js", "GarmentProfiles.js" (or corresponding WASM implementation).
- Persistent positions/velocities, fixed dt, stretch/shear/bend/pins, seam welds, body capsule contacts; deterministic constraint order and reset.
- Separate body collision from leg-to-leg and cloth self-collision. Add garment layering after the basic solver is stable.
- Renderer mapping: low-res simulation particles to render positions. Avoid repeatedly inverse-baking new geometry then running GPU skinning a second time; choose one validated skin/deform composition.
- Runtime load shedding: LOD, reduced collision detail, solver iterations and update rate when FPS degrades; never remove mandatory crotch/seat contact or show a wildly folded skirt.

**PR-E: Pose-space correctives and motion integrations**
- Joint angle-driven continuous corrective morph weights (not string-based "sittingWide" only). Prioritize hip flexion, knee flexion, hip abduction, pelvis tilt, upper-arm raise.
- Bind all animation sources: "src/VRMAAnimationLoader.js", "src/ClipAnimationLoader.js", "src/PoseEditor.js", "src/PosePuppetIK.js", "src/gltf-viewer/VRPoseSystem.js", "src/behavior/" and locomotion update to the same *final transform* pipeline.
- Test VRM 0.x and 1.0 normalized/raw skeleton semantics, scene rotation, hips translation/root motion, both imported Forge look VRMs and avatar swaps.
- Include face tracking, idle/talk, emotional gestures, dancing and multi-clip blending; no cloth sticking to a previously played clip.

**PR-F: Performance, rollout, migration**
- UI in Settings/Avatar Manager: Cloth Quality (Auto, Low, Balanced, High), debug status, legacy fallback; no advanced controls cluttering Live Try-On by default.
- Build/bundle physics metadata for current static looks and for remote Forge response; cache by VRM SHA + physics manifest SHA, invalidate on change.
- Feature flag: legacy → passive shadow evaluation → opt-in experimental → default for verified looks/GPUs, with server/browser kill switch and clear rollback.
- Never mark the feature production-ready until the matrix below passes in real mobile browsers and CI.

## F. Tests, fixtures and release gates

Required **look × movement** matrix, measured in Forge and also in the actual viewer:

- 3 supplied looks: "Crop top & jeans", "Yellow sundress", "Black Bodycon Mini Dress & boots".
- Pose keys "sittingWide" and "sittingDesk" (currently displayed at 17/43 and 18/43), "sitting", "sittingCrossed", "standing", "tPose"; all 43 currently exposed entries enumerated by key rather than index.
- Custom hip/knee edits (0°, 45°, 90°, 120°), arms down/raised, IK dragging while pointer is down, Undo/Redo, reset, outfit-switch and avatar-switch.
- Live animations: at least one walking, one running, one dancing, one seated idle, one gesture/talk, plus VRMA animation loop and blend/interrupt/resume.
- Compare VRM 0.x and 1.0, fast and slow devices, desktop and mobile Chromium WebGL. Test remote-generated, bundled and imported pack looks.

**Recommended target gates** (engineering targets to tune per fabric; not claims already reached):
- No visibly catastrophic long-panel ring/slab, detached giant tube, broken two-leg topology or unbounded bounding box in any supported standard pose.
- 0 nonfinite positions/normals, 0 runtime uncaught worker errors, 0 persistent stale correction after look changes.
- Seam gap <= 1 mm at authored weld seams (unless intentionally open); no new mesh-connected-component tears.
- At least 99% of garment samples (vertices **and** face-interior samples) no deeper than 2 mm inside collision body; any deeper contact localized, quantified and reviewed; maximum should not exceed 5 mm in ordinary poses. Unavoidable self-intersecting avatar knees need documented proxy/LOD treatment.
- No newly inverted visible triangles in the core dress/jeans/boot regression set. Track total inversion count and require improving or zero for high-quality assets; don't report depth alone as success.
- Stretch: p99 edge ratio <= 1.25 for relatively inelastic clothes, and max <= 1.8 unless the fabric template explicitly allows elasticity; evaluate against per-fabric authored stretch limits. Verify crotch gusset width and skirt hem continuity.
- Hem anchors and floor contact visually plausible; skirt follows pelvis and gravity rather than knees; shoes stay aligned to feet.
- Dynamic motion: no >100 ms frame freeze on Apply from cloth work, no >1 s "uncorrected clothes" window on interactive sitting in target hardware, and stable physics within first few frames. Use event telemetry in browser, not modelled estimates.
- Performance: initially budget median <= 4 ms per physics update on representative desktop, <= 8 ms on target Android in Balanced mode, and <= 16 ms total simulation/render integration frame contribution in degraded mode; verify with representative 2024–2026 lower/mid Android devices. Allow dynamic cloth rate of 30 Hz and interpolation while rendering at display rate. All targets must be measured and may need per-device revision.
- Reproducibility: identical source hashes, pose clip and deterministic step count produce close geometric metrics; visual regression photos from front/side/back and Android Playwright. Include corrupted/mismatched physics sidecar, unsupported GLB, worker missing/CSP blocked, context loss, simulated low memory and tab resume.

QA tooling: existing Forge "tools/inspect/export_homepilot_poses.mjs", "pose_contact.py", "engineering_sheet.py"; add CI fixtures with artifact/pose manifests, detached garment render and before/after metric JSON, and browser Playwright screenshot/mesh readback where practical. Ensure the exact deployed look SHA is included before signing off.

## G. Delivery milestones and dependencies

| Phase | Deliverable | Suggested duration* | Exit criterion |
| --- | --- | --- | --- |
| 0 | Live reproduction & telemetry | 2–4 dev days | Exact three looks / pose keys reproduced; deployed hashes and failure reason verified |
| 1 | Authoring/topology & v3 metadata | 1–2 weeks | Maxi hem, jeans leg/crotch topology and bodycon corrective data validate on Forge fixtures |
| 2 | Viewer pipeline & compatibility | 1 week | One final-pose snapshot; no VRMA, Puppet IK or outfit-switch races; legacy fallback intact |
| 3 | Worker XPBD MVP | 2–3 weeks | Sundress and bodycon corrected *during* seating/animations, with stable body contact |
| 4 | Correctives/boots/jeans + layer collision | 2–3 weeks | Knee/hip/crotch and 3-look visual regressions meet geometric gates |
| 5 | Mobile tuning & progressive rollout | 1–2 weeks | Android/desktop tests, workers, perf budgets and rollback verified |

*Indicative effort with small team and reusable Forge assets; not a delivery promise or guarantee of AAA parity. Parallel tracks can shorten elapsed time but raise integration risk.

**Critical order:** Phase 0 first, then asset topology correctness and authoritative animation/pose capture. Do not simply port "xpbd.py" and declare done: it is quasi-static, omits gravity/velocity and does not resolve topology or raw/normalised rig ordering. Implement dress and jeans as separate reference families.

## H. Risk register / things not to claim

- **Production deployment unknown:** repository inspection cannot verify yourfriend.online's current commit, cache, worker CSP, or exact 3-look VRM bytes. Require real deployment evidence.
- **Existing success is narrower than requested scope:** "SITTING_WIDE.md" measures one black bodycon, not the yellow maxi dress or jeans, and explicitly documents remaining inverted triangles and knee failures.
- **Skinning alone cannot physically drape broad fabric**, but XPBD alone cannot repair incorrect assets. Both asset authoring and runtime must change.
- **Penetration metrics can lie in tight folds** if closest-vertex normals are used instead of real signed distance; augment with face sampling, representative signed-distance proxies and visual review.
- **SpringBone** is useful for hair and accessory sway, not a replacement for cloth panels with body/self collision.
- **AAA goal** means borrowing documented hybrid techniques. Do not assert details of proprietary Genshin Impact implementation or promise equivalent quality without artist-authored shapes and benchmark results.
- **Performance constraints:** CPU cloth, particularly self-collision and multiple layers, can be expensive on mobile. Start with coarse sim mesh and adaptive LOD; prioritize contact-critical garment regions.
- **Licensing:** prefer implementation based on papers/documentation or license-compatible dependencies, audit bundle licenses before shipping any third-party solvers and preserve avatar/garment license metadata.

## I. References and cross-repo source anchors

HomePilot:
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/docs/SITTING_WIDE.md
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/gltf-viewer/VRPoseSystem.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/gltf-viewer/ViewerEngine.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/gltf-viewer/PoseClothCorrector.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/wardrobe/PoseClothCorrection.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/wardrobe/PoseClothWorker.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/VRMAAnimationLoader.js
- https://github.com/ruslanmv/3D-Avatar-Chatbot/blob/master/src/wardrobe/WardrobePackValidator.js

Forge:
- https://github.com/ruslanmv/3D-Wardrobe-Forge/blob/main/docs/POSE_CONTACT_QA.md
- https://github.com/ruslanmv/3D-Wardrobe-Forge/blob/main/docs/GARMENT_TEMPLATE_SPEC.md
- https://github.com/ruslanmv/3D-Wardrobe-Forge/blob/main/wardrobe/body_surface/xpbd.py
- https://github.com/ruslanmv/3D-Wardrobe-Forge/blob/main/wardrobe/vrm/weight_transfer.py

Industry patterns:
- Unreal Chaos Cloth Panel Editor: https://dev.epicgames.com/documentation/en-us/unreal-engine/panel-cloth-editor-overview
- XPBD (Macklin, Müller & Chentanez, 2016): https://doi.org/10.1145/2994258.2994272
- Three.js SkinnedMesh contract: https://threejs.org/docs/pages/SkinnedMesh.html
- VRM 1.0 humanoid and animation update ordering: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md
- VRM SpringBone 1.0: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md

## Definition of Done

This feature is accepted only when **every supported current look** can transition across the pose and animation test matrix without major garment tears or tunnels, critical geometry is validated independently of pretty renders, exact failing screenshot looks are fixed in the deployed site, and Android/desktop target performance is verified. Unsupported old looks must fail back safely with an honest status rather than silently claiming simulated cloth.
