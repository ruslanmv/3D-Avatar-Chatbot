# Claude Code Runbook: HomePilot Avatar Clothing Deformation / Engine V2

**Long-term product goal:** [Immersive Avatar & Garment Engine Vision](IMMERSIVE_AVATAR_GARMENT_ENGINE_VISION.md) — AAA-inspired NPC wardrobe quality for conversational AI, locomotion, expressive motion and verified WebXR/AR device tiers.  
**Entry point:** [Pose-Aware Garment Engine V2 implementation plan](POSE_AWARE_GARMENT_ENGINE_V2_PLAN.md) in [HomePilot draft PR #119](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/119), with [Wardrobe Forge issue #22](https://github.com/ruslanmv/3D-Wardrobe-Forge/issues/22).  
**Job:** Diagnose and incrementally repair three deployed VRM looks, then establish a safe animation/physics architecture.  
**Mode:** Small code PRs, evidence before mutation, test/review gates. Never infer that planning documentation or prior offline measurements prove production has been repaired.

> **The first Claude Code session MUST execute Cut 0 only.** It should not build a new universal cloth engine, re-export the wardrobe wholesale, or deploy to production. If the user later explicitly approves a given cut, implement that cut on its own branch.

## 0. The task Claude Code should receive

Copy into Claude Code, adjust the two local paths and target cut:

~~~text
You are the implementation engineer for HomePilot Avatar and 3D-Wardrobe-Forge.

Read and follow ALL THREE context documents on GitHub draft PR #119:
- docs/IMMERSIVE_AVATAR_GARMENT_ENGINE_VISION.md
- docs/POSE_AWARE_GARMENT_ENGINE_V2_PLAN.md
- docs/CLAUDE_CODE_GARMENT_ENGINE_V2_RUNBOOK.md
and Forge issue #22.

Repositories:
- ruslanmv/3D-Avatar-Chatbot (default master)
- ruslanmv/3D-Wardrobe-Forge (default main)

CURRENT SCOPE: CUT 0 — source/deployment and exact outfit deformation diagnostics only.
DO NOT move on to Cut 1/2/3 without a verified Cut 0 exit and a separate go-ahead.
DO NOT re-skin everything, overwrite existing VRMs, replace PoseClothCorrection or build
an XPBD engine in Cut 0.

The three target live looks are "Yellow sundress", "Crop top & jeans", and
"Black Bodycon Mini Dress & boots". The target stable pose keys are
sittingWide and sittingDesk. The screenshots say 17/43 and 18/43;
the checked master lists 51 total, 26 standard, and keys at positions
10 and 11 in PRESET_ORDER; do not assume the deployed build matches source.

Verified current source:
1. Forge native.py already adds lower-leg candidates for LEG_TUBE_KINDS from coverage.
   Simply adding lowerLegs to jeans JSON is not the fix without exported-weight evidence.
2. Maxi sundress template already anchors chest, waist, hips, not lowerLegs.
   The hips region includes bilateral upper legs and the exporter can redistribute weights.
3. Existing PoseClothCorrector CPU skins and inverse-bakes to bind space after pose settles.
4. Forge body_surface/xpbd.py is quasi-static reference, not a live cloth animation loop.

Begin by reproducing and instrumenting the exact existing assets and the worker.
Deliver exact VRM, JS and generator hashes where accessible, pose matrices, mesh
topology and weights, front/side/back renders and baseline geometric metrics,
plus tests proving diagnostics work and failures are classified.
If live site/access/asset bytes are unavailable, mark the obstacle explicitly
and still commit offline diagnostics, fixtures and a request for missing artifacts.
List tests you actually ran, their outputs, and remaining blockers.
Commit only on a feature branch and open a draft PR; do not change master/main
or deploy to production.
~~~

## Product acceptance guidance for every Claude Code cut

HomePilot's **long-term target is an embodied AI companion with high-quality, physically believable VRM clothing**, not just a no-clipping screenshot. Each implementation PR should describe how it protects eventual support for: interactive NPC **walking, turning, sitting, gestures, dancing and VRMA/BVH**, conversation with **face tracking, gaze and lip sync**, and immersive **WebXR VR / supported AR** without sacrificing frame stability, materials or identity. See the [vision document](IMMERSIVE_AVATAR_GARMENT_ENGINE_VISION.md).

**Do not expand the approved cut:** Cut 0 is still deployed-source/asset/worker diagnostics only. For later cuts, use distinct scorecards for settled render-mesh geometry, dynamic motion, material/silhouette fidelity, desktop/mobile performance, XR comfort and avatar/legacy compatibility. Record which device or clip was actually tested. An untested AR headset is never labeled supported merely because look.vrm opens.

**Forge-to-client distinction:** Hugging Face Forge generates a reusable ordinary skinned look.vrm (with optional physics-ready sidecar). HomePilot's browser drives skeleton/morphs and physics at playback time; do not introduce a cloud request on each animation frame. Generic VRM viewers keep basic skeletal motion, not guaranteed proprietary cloth simulation.

## 1. Workspace and safety setup

Use two local checkouts; verify branch and clean working tree before writing. Do not directly amend documentation PR #119 while implementing a code cut unless the owner explicitly asks to update plans.

~~~bash
# Example from an empty parent directory:
git clone https://github.com/ruslanmv/3D-Avatar-Chatbot.git
git clone https://github.com/ruslanmv/3D-Wardrobe-Forge.git

cd 3D-Avatar-Chatbot
git fetch origin master docs/pose-aware-garment-engine-v2-20261025
git status --short
git show origin/docs/pose-aware-garment-engine-v2-20261025:docs/POSE_AWARE_GARMENT_ENGINE_V2_PLAN.md
git show origin/docs/pose-aware-garment-engine-v2-20261025:docs/CLAUDE_CODE_GARMENT_ENGINE_V2_RUNBOOK.md
git switch -c feat/garment-cut0-diagnostics origin/master

cd ../3D-Wardrobe-Forge
git fetch origin main
git status --short
git switch -c feat/garment-cut0-pose-qa origin/main
~~~

If repo is already checked out or there are uncommitted user changes, do not overwrite/discard them; ask before destructive operations. Use local branches according to repository policy. Do not commit sensitive live access cookies, user avatars, tokens, credentials or private content. Prefer license-approved test assets.

Read before changes:
- HomePilot: src/gltf-viewer/VRPoseSystem.js, ViewerEngine.js, AvatarManager.js, PoseClothCorrector.js; src/wardrobe/PoseClothCorrection.js, PoseClothWorker.js, WardrobePackValidator.js; src/VRMAAnimationLoader.js; docs/SITTING_WIDE.md; tests/wardrobe/pose-cloth-correction.test.js; package.json; vercel.json.
- Forge: docs/POSE_CONTACT_QA.md, GARMENT_TEMPLATE_SPEC.md, FIT_QUALITY.md; wardrobe/engines/native.py; wardrobe/vrm/skinning.py, weight_transfer.py; wardrobe/body_surface/xpbd.py; assets/garment_templates for the exact affected item IDs; tools/inspect/pose_contact.py and fit_checks.py; tests/integration/test_pose_contact.py; tests/unit/test_templates.py; pyproject.toml.
- Confirm actual generator paths/templates for the particular deployed look; prompts and labels are not reliable substitute for an asset hash or template ID.

## 2. Cut 0 — diagnostic engineering tasks (first deliverable)

### 2.1 Deployed build provenance and real asset data

Create a baseline manifest **in a local evidence directory excluded from public git when it may contain user/private asset data**. An approved sanitized fixture is committed only after checking model licenses. Record:

~~~json
{
  "recordedAtUtc": "TBD",
  "liveUrl": "https://yourfriend.online",
  "deployment": {"jsUrl": "TBD", "jsSha256": "TBD", "sourceGitSha": null, "posePresetCount": null},
  "forge": {"generatorGitSha": null, "path": null},
  "looks": [{
    "displayLabel": "Yellow sundress",
    "vrmUrl": "TBD",
    "sha256": "TBD",
    "sourceAvatarSha256": null,
    "physicsProfile": "legacy-skinned",
    "garmentMeshIds": [],
    "poseSamples": ["sittingWide", "sittingDesk"]
  }],
  "testDevice": {"browser": "TBD", "os": "TBD", "gpu": "TBD"}
}
~~~

If a field is missing, leave null/TBD; do not invent an identifier. Check static bundled paths, imported pack paths and remote generator responses separately. Inspect HTTP status and real MIME; detect SPA rewrites returning HTML instead of a .vrm or worker .js.

**Deployment mismatch:** direct evidence is required because source master lists 51 presets (26 non-adult) but reported UI lists 43. Record both actual runtime pose key sequence and actual JS bundle SHA before any change to the preset code.

### 2.2 Instrument existing cloth collector / worker safely

Add a debug-only report helper (disabled by default) exposing:
- Body mesh count, Forge-tagged garment mesh count, names and reason for rejection (mesh not skinned, material-tag/body matcher failed, no position, skinWeight/skinIndex mismatch).
- Worker URL and resource status, message/error/messageerror/timeout, timing, request generation and geometry revision; canceled/stale/failed/succeeded outcome.
- Correction timeline: pose apply time, blend end, pending frames, worker compute time, mesh upload/inverse transform time, first visually corrected frame.
- QA aggregate max/p99 penetration, stretch, seam gap, inversion count and body collider regions, labeled by look hash + pose key. Avoid dumping unbounded per-vertex data into console by default.

**Important:** src/gltf-viewer/PoseClothCorrector.js currently adds a per-correction worker "message" listener and skips removing it when the incoming message id does not match; release() can invalidate a job. Add a lifecycle-safe pending job map / listener ownership and guaranteed promise settlement on cancellation, timeouts and disposal. Test it with rapid pose switching and look replacement. Preserve its snapshot/restore semantics.

Do not change user-visible poses or modify original VRM bytes in Cut 0. A diagnostic flag must be safe to disable and must not burden normal rendering.

### 2.3 Extract exact exported VRM mesh and weight facts

For each known look, report:
- Skinned mesh nodes, glTF primitive indices and the exact Forge tag/extras. Identify body mesh as opposed to underlayers, boots shell/lining and dress.
- Rest-space and posed bounding boxes, triangles/components, seam dupes, degenerate edges/faces, UV continuity.
- Skin joint maps and skinWeight sum, dominant bones and histogram by **front/back skirt hem station**, **separate jean legs**, **crotch/gusset**, **bodycon lap**, and **boot sole/shaft**.
- Normalized/raw VRM bone matrices and actual mesh.bindMatrix / inverseBindMatrix. Compare CPU skinning with actual GPU result at sampling points.
- Render rest, skin-only, legacy corrected on the exact same pose transform; numerical before and after metrics.
- Determine whether jeans actually have leftLowerLeg/rightLowerLeg influence. For every changed asset, compare generated source version and hashes. Never infer from template JSON alone.

Recommended extra QA questions:
- Does the yellow hem have lowerLeg influence despite its template? Does it have both upper legs, and with what weight at the front, back and center?
- Are blue jeans actually two separate leg tubes or a connected two-leg garment with a crotch bridge? Verify with topology; one connected garment is **not** automatically invalid.
- Are the black boot liner/shell grouped as one garment, while sole stays foot-rigid?
- Are non-FORGE-tagged garment and body meshes accidentally excluded from collision?

### 2.4 Generate named-pose fixtures (do not rely on list index)

Use the existing Forge toolchain:
- tools/inspect/export_homepilot_poses.mjs
- tests/fixtures/homepilot-poses.json
- tools/inspect/pose_contact.py
- tools/inspect/fit_checks.py
- tools/inspect/engineering_sheet.py

Make pose export versioned (HomePilot git SHA, preset name/key/hash). Add tests using **sittingWide** and **sittingDesk** and other important keys, with baseline stats before/after legacy correction. Fail loudly if a key is missing or its bone quaternions changed unexpectedly; do not silently use a different pose.

Store comparable screenshot sheets in an approved artifact store or CI uploads; source test fixtures should remain small/license-compliant. Use exact asset + JS + test generation hashes in reports.

### 2.5 Tests, Cut 0

Use existing commands (adjust environment/setup only when necessary):

~~~bash
# 3D-Avatar-Chatbot:
npm ci --legacy-peer-deps
npm test -- --runInBand tests/wardrobe/pose-cloth-correction.test.js
npm run test:ci
npm run wardrobe:check
npm run format:check

# 3D-Wardrobe-Forge:
python -m pip install -e '.[dev]'
python -m pytest tests/integration/test_pose_contact.py tests/unit/test_templates.py
python -m pytest
python -m ruff check .
~~~

Record which commands succeeded, failed, skipped and why. Do not hide flaky/lacking external assets or label tests "passed" when they did not run. Existing HomePilot npm lint scripts target js/; add explicit lint/test coverage for new src/ code as appropriate rather than assuming global lint includes all files.

### Cut 0 completion checklist

- [ ] Reproducible snapshot of exact deployed JS + three VRMs, or exact documented access blocker.
- [ ] Difference between 43 UI items and 51 PRESET_ORDER resolved or explicitly demonstrated as deployed-version mismatch.
- [ ] Observed worker and geometry diagnostics and cancellation robust; instrumentation disabled for ordinary users.
- [ ] Actual jeans shin skin weights and component layout measured.
- [ ] Actual sundress hem/upper-leg weight distribution and selected skin/correction culprit measured.
- [ ] Black bodycon/boot legacy correction and fold baseline measured with no regression claim.
- [ ] Named pose sittingWide and sittingDesk fixture/metrics committed where lawful and executable.
- [ ] Unit/integration tests and performance logs attached.
- [ ] Separate small draft PR(s) ready; stop and request a cut review.

**Phase 0 decision table:**

| Evidence | Next intervention |
| --- | --- |
| Wrong JS/VRM versions, worker 404/CSP, missing garment/body tagging | Fix delivery/asset classification first; do not add cloth simulation |
| Jeans exported with no shin influence, contrary to native candidate logic | Determine which generator path/version omitted it; rebuild only that look |
| Jeans already have correct L/R shin weights, but crotch stretches across abducted hips | Author continuous hip-abduction gusset corrective and collision |
| Sundress hem has shin weights | Fix exporter weight mapping or wrong asset first |
| Sundress hem has thigh-weighted panel and still becomes ring/slab after legacy push | Adjust hanging skirt panel binding/correctives and proceed to coarse skirt XPBD pilot |
| Bodycon & boots penetration improves but inversions remain | Joint-angle hip/knee corrective shapes and targeted contact profile |
| No access to deployed VRMs | Remain in offline Cut 0; request exact files/URLs/hashes before claims about production |

## 3. Cut 1 — targeted authoring/corrective hotfix (after Cut 0 review)

**Forge-owned** (and small HomePilot integration where necessary). The aim is improve seated looks **without building full real-time cloth**.

Tasks:
1. Reproduce measured skin/pose failures in tests/integration/test_pose_contact.py.
2. For jeans: compare generator native LEG_TUBE_KINDS coverage-based shin bones with actual VRM. Only modify export skinning if missing; otherwise fix the crotch/gusset shape and hip-abduction corrective, plus knee bend where measured.
3. For bodycon: add morphs keyed by hip flexion/abduction/seat angle, not by sittingWide name; ensure fit at standing and near 90°.
4. For boots: add knee-angle corrective to prevent knee shaft collapse; preserve foot/sole rigid binding and grouped shell/lining; retain shoe cap in existing corrector.
5. For sundress: do **not** change template anchors blindly. If a solved pose-specific corrective provides a low-cost interim improvement and does not create severe stand/animation regressions, make it an opt-in interim profile pending Cut 3.
6. Keep current PoseClothCorrection as the default on all old packs. Retain snapshots, seam weld, layers and clearance rules; never have a second solver write same skinned position buffer.

Prove with named-pose metrics, standing/idle image comparisons, VRM 0.x and 1.0 identity checks and the license/consent gates. Build only affected looks with new versioned URLs and exact hashes. Do not regenerate the wardrobe catalogue wholesale.

Cut 1 exit = no severe visual failures for corrected **jeans/bodycon/boots** in target settled poses, no identity/standing regression, existing corrector stable and easily reverted. Yellow maxi may require next continuous pilot and must be marked as such.

## 4. Cut 2 — one final animated-pose snapshot before physics

**HomePilot-owned.** Inspect actual render loop ordering: currently ViewerEngine calls avatarManager.update(dt) early and later several other bone writers update movement. Diagnose VRM normalized-to-raw synchronization and decide a strict ordering (including expression/spring phases) **before moving code**.

Suggested interface to design, not implemented here:

~~~ts
type FinalPoseSnapshot = Readonly<{
  avatarGeneration: number;
  poseGeneration: number;
  frameId: number;
  rootMatrixWorld: Float32Array;
  rawBoneWorldMatrices: Float32Array;
  jointAngles: Record<string, number>;
  collisionPoseVersion: number;
  sourceFlags: string[];
}>;
~~~

Tasks:
- Define animation precedence and final capture ordering with VRMA/BVH, Pose Studio preset/drag, procedural gaze/idle, locomotion and root motion.
- Capture after the *last* skeleton writer and after necessary normalized → raw synchronization (without double stepping VRM spring physics).
- Correctives and future colliders read **exactly the same** bone snapshot that renders the body.
- Test pose transitions, IK drag, VRMA clip play/loop/blend/stop, root rotation and scale, avatar/wardrobe switch.
- Confirm current legacy corrector only reads a settled final pose; do not run stale correction when new animation starts.

Cut 2 exit = no skeleton lag, no ghost geometry, no stale avatar writes; a test proving pose matrix source consistency on target 3 look fixtures. **No new XPBD requirement yet.**

## 5. Cut 3 — sundress-only XPBD pilot

**Split between Forge asset sim-mesh generation and HomePilot worker/render integration.**

Before writing physics code, lock:
- Pilot asset hash + garment primitive IDs and garment segmentation (bodice/waist pins, skirt free panels).
- Low-resolution simulation mesh, rest edges, seam constraints, barycentric mapping to render mesh, bounded pinned waist region.
- Body/thigh/pelvis moving collision capsules; **seat proxy and ground plane**; collision response around self-overlapping thighs. Do not pretend thigh capsules represent boot/bodycon contact.
- Explicit single-writer profile switch: legacy settle-worker or new dynamic solver, never both simultaneously on the same geometry.
- Selected render method: continue to use **SkinnedMesh + inverse per-vertex blended skin transform** as the first candidate, not a second shader displacement. Measure transfer and upload costs.
- Device tiers and watchdog: fixed substeps, no unbounded dt, cancellation on look switch, failsafe reset when a clip jumps, detach/race tests.

Suggested solver skeleton (pseudocode, not production code):

~~~text
snapshot = sampleFinalHumanoidPose()
if garment.profile == "dynamic-skirt-v1":
    if snapshot.avatarGeneration != simulation.avatarGeneration:
        simulation.resetToPinTargets(snapshot)
    simulation.updatePinTargets(snapshot)
    simulation.updateBodySeatFloorColliders(snapshot)
    simulation.stepFixedDtWithCap(dt, constraints=["stretch", "shear", "bend", "weld", "contact"])
    posedVertices = simulation.mapParticlesToRenderVertices()
    writeBindSpacePositionsUsingInverseBlendedSkin(mesh, snapshot, posedVertices)
else:
    useExistingSkinningAndOptionalSettledCorrection()
renderFinalAvatarOnce()
~~~

**Metrics:** no ring/slab at sittingWide/sittingDesk, stable hem/seat contact during transition and representative VRMA, no NaNs or runaway velocities, no stale writes, no major Android frame drops and graceful worker/asset fallback. A full universal high-res cloth pass for every look is explicitly out of scope.

Cut 3 exit = measured real Android + desktop evidence on actual **yellow sundress** look and correct rollback, not just headless software Chromium.

## 6. Cut 4 — only measured expansion and asset schema stabilization

- Expand dynamic profile to A-line skirt, coat tails, capes and optional layers one garment family at a time. Defer broad self-collision until profile-specific visual/performance evidence.
- Finalize optional signed/hashed v3 physics sidecar and update both repos' importer/exporter with backward-compatible v1/v2 fallback.
- Preserve existing VRM 0.x/1.0 animation, face tracking, emotions/lipsync, hair springs, static/look switching and adult/licensing checks.
- Automated per-asset and per-device regressions; feature flag can revert to legacy.

## 7. What *not* to do

- Do not make a one-size-fits-all 60 Hz XPBD requirement for crop tops, jeans, boots, bodycon and hair.
- Do not assume a Genshin-like result from a spring-bone hem; SpringBone cannot stop thigh penetration.
- Do not re-skin the entire VRM or replace same-character look.vrm with a rigid clothing attachment.
- Do not add lowerLegs to jeans JSON as the only change: current native.py already adds them from coverage. Diagnose actual binary asset and generator path.
- Do not rewrite maxi anchors to remove shins: they are already absent in the template. Inspect actual exported weights for hip and thighs.
- Do not ship cloth physics using only body/thigh capsules: gravity-driven seated fabric also needs a chair/seat + floor contact.
- Do not drive corrective morphs by pose names; continuous joint angles must work during custom bone edits and VRMA.
- Do not assume RenderMesh vertices == unique cloth particles: glTF UV seams duplicate vertices; use weld and sim-to-render mapping.
- Do not add a second render displacement over an already inverse-corrected SkinnedMesh.
- Do not treat offline closest-point normal penetration as proof a folded triangle is collision-free; test face interiors and self-overlapping body proxies.
- Do not conflate settled-pose geometry gates with transient solver/frame-time budgets.
- Do not claim production deployed, complete all-outfit fix or passing Android metrics without actual tests on current live asset hash.

## 8. Implementation PR and release report template

Copy this into every code PR description:

~~~markdown
## Cut
Cut N — <diagnostics / authored correctives / final pose / sundress XPBD>

## Scope
HomePilot commits:
Forge commits:
Exact look VRM SHA-256:
HomePilot source/deployment JS SHA:
Pose keys and actual UI/source count:

## Before vs after
| Look and pose | Before penetration / seams / strain / inversion | After | Frame/correction latency |
| --- | --- | --- | --- |
| Yellow sundress / sittingWide | ... | ... | ... |
| Yellow sundress / sittingDesk | ... | ... | ... |
| Crop top & jeans / sittingWide | ... | ... | ... |
| Black Bodycon Mini Dress & boots / sittingWide | ... | ... | ... |

## Evidence
- [ ] Real or approved fixture geometry measurements
- [ ] Same-camera front/side/back/wireframe screenshots
- [ ] Physical Android and desktop performance where applicable
- [ ] VRMA + Pose Studio + IK interruptions validated where applicable
- [ ] Existing VRM/pack/licensing integrity maintained

## Tests actually run
- ...
Failed / skipped / blocked:
- ...

## Fallback / rollback
Feature flag:
Known-good asset and source SHA:
Old v1/v2 pack behavior:
Live deployment status: NOT DEPLOYED / PREVIEW ONLY / VERIFIED CANARY / VERIFIED PRODUCTION

## Remaining risks
- ...
~~~

## 9. Deployment is a gated final step, not the default implementation action

Production deployment must follow the actual repository's current deployment provider settings, CI, feature flags, and owner approval. This plan has **no permission to publish untested meshes or automatically flip production defaults**. Even if CI passes, require preview URL verification with current asset SHA, console/worker/CSP checks, representative Android test and explicit go-ahead before production promotion.

Deployment checklist:
- [ ] Pack digest matches uploaded look.vrm and any physics sidecar; immutable/versioned asset URL prevents CDN hash drift.
- [ ] Legacy/sidecar-absent paths render unchanged and correct or fall back safely.
- [ ] Error handling for Worker 404, importScripts and messageerror is tested.
- [ ] Tab resume, rapid pose/clip/outfit switches and context restoration do not leave stale geometry.
- [ ] Scene does not miss VRM expressions/gaze/talk, nor corrupt VRMA normalized/raw transforms.
- [ ] Quality gates for this cut (NOT future cuts) meet agreed baseline; physical Android test attached for physics pilot.
- [ ] Feature flag defaults off for unverified devices and garment families; rollback tested.
- [ ] Release notes reference exact commit, VRM hashes and measured improvements.
