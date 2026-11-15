# NEXUS Grounded Hands-and-Knees — Isolated Pose and Asset Review

**Review branch:** `feat/grounded-hands-knees-pose-audit-20261114`  
**Parent:** `feat/living-worlds-spatial-storytelling`  
**Scope:** one additional gated static pose, source/asset compatibility tests, no changes to existing pose IDs, renderer, wardrobe, Private logic or UI styling.  
**Status:** *Experimental — browser and real-VRM contact validation still required*. No PR or merge.

> **Update (UN6, `una-notte`, 2026-11-15):** integrated by cherry-pick and verified on the rendered avatar — knees and palms on the sole plane (palms 10–16 mm, the arms straight at the elbow limit), fingers forward, palms down, held through turning and an outfit change, routed from "Mettiti a quattro zampe" at level 4 only. See `docs/qa/UN6_PRIVATE_POSES_RENDER_AUDIT.md`.

## What was actually found

The existing `allFoursArched` and `doggyStyle` presets in `src/gltf-viewer/VRPoseSystem.js` are **standing forward-bend presets**, not hands-and-knees contacts. The preset's name or a successful `getCurrentPreset()` response is insufficient evidence that the character is visibly on four points. `PoseLibrary.js` does not own built-in presets: `VRPoseSystem.js` does.

This review adds an **independent `handsKnees` candidate** with a pitched torso, flexed knees and arms aimed toward ground contact. It deliberately does **not** replace the old presets or hardcode a new fixed pelvis position. The existing MO5 ground settling remains the only vertical adjustment. Note that MO5 grounds the lowest measured joint; it cannot, by itself, guarantee simultaneous contact of **all four** joints.

A new adult-gated entry in `PoseStudioPanel.js` exposes the candidate only behind the existing `NEXUS_SPICY` Pose Studio filter. Do **not** wire the new preset into Private language commands until the visual/geometry checks pass. No age, consent, provider or avatar authority checks are removed.

## Public animation sources verified (not yet downloaded into this environment)

### KinemIQ female crawl, CC BY 3.0

- Source page: https://kinemiq.app/animations/move-crawl-female/
- Clip: 20 seconds, 600 frames at 30fps; FBX/GLB/BVH export via KinemIQ Studio.
- License: **CC BY 3.0**; credit **Open Motion Project by ACCAD / The Ohio State University** and retain license metadata with any exported or derived asset.
- Use: trim to a near-still contact frame, export in-place GLB, retarget to the VRM humanoid. Verify contact and orientation. Do not repackage the full source clip without reviewing provenance.
- Exports may require interaction with KinemIQ Studio. A website description is **not** a downloaded asset or evidence of successful retarget.

### Quaternius Universal Animation Library, CC0

- Publisher: https://quaternius.itch.io/universal-animation-library
- Publisher pack page: https://quaternius.com/packs/universalanimationlibrary.html
- **CC0 1.0**, suitable for commercial use without required attribution.
- Download the free Standard archive from the publisher, inspect the included GLB animation names and seek the crawling sequence.
- Prefer in-place `UAL1_Standard.glb` rather than a root-motion clip for a static held pose. Verify which exact filename is in the downloaded version.
- Retargeting from the Quaternius humanoid rig into the selected VRM is still required; skeleton names do not automatically match.

**Download blocker in this ChatGPT session:** the execution environment cannot resolve the external asset hosts or GitHub through its command-line downloader. A KinemIQ Studio export also needs an interactive browser workflow. As a result **no third-party GLB was downloaded or checked into GitHub**, and neither asset can honestly be marked "retargeted and tested."

Do not substitute an unlicensed sample, upload publisher ZIP archives to the repo, or claim that a documentation link is a tested 3D asset.

## What was implemented on the new branch

1. `src/gltf-viewer/VRPoseSystem.js` — new **candidate** `handsKnees` preset with no mutation of `allFoursArched`, `doggyStyle`, kneeling or prone presets.
2. `src/PoseStudioPanel.js` — one adult-gated "Hands and Knees (Candidate)" entry under Ground.
3. `tests/vr/hands-knees-candidate.test.js` — structural checks for isolation, gating, required bones and reuse of the existing skeleton/ground owners. These tests do **not** establish correct mesh contact.
4. `tools/qa/hands-knees-asset-probe.mjs` — dependency-free GLB 2.0 header, animation-name and humanoid-bone inspection for locally downloaded assets; **metadata only**.
5. `tools/qa/hands-knees-visual-audit.mjs` — real-application browser audit measuring both hands and both knees against standing-foot ground reference, saving front/right/back/left screenshots, and checking avatar identity and return to standing. Requires the app, an avatar asset and Playwright.
6. This document — source/license evidence and explicit validation gates.

## Run in a checkout with Internet / a real browser

```bash
git switch feat/grounded-hands-knees-pose-audit-20261114
npm ci
npx jest tests/vr/hands-knees-candidate.test.js --runInBand

# In another terminal, start the app on your usual local port.
npm start

# With the running app (adjust the URL to your local server):
node tools/qa/hands-knees-visual-audit.mjs --url http://127.0.0.1:8080/

# After YOU download the source .glb from its publisher:
node tools/qa/hands-knees-asset-probe.mjs /path/to/UAL1_Standard.glb
node tools/qa/hands-knees-asset-probe.mjs /path/to/kinemiq-crawl.glb

# Full project checks (do not confuse these with visual approval):
npm run validate
```

The visual audit writes `docs/audits/hands-knees-candidate/result.json` and four PNG screenshots by default. These outputs are generated locally; do not claim they exist in the GitHub branch until they are actually produced.

### Hard QA gates for the new pose

- Pose is genuinely low to the floor and visually supported on both palms and both knees.
- Each hand and knee joint is at most **80 mm above** the standing-foot ground reference, and no more than **60 mm below** it. These thresholds are initial *structural smoke-test* bounds, **not** a guarantee of mesh contact or a validated production tolerance.
- Test front, side, back, three-quarter or equivalent viewpoints. Check body facing and camera framing; no head/legs outside the viewport.
- Keep the same VRM and same world. Pose can be held, switched and reset without orphaning animation ownership.
- Test the selected garment (including garment clipping at the torso, elbows and knees); underlayers and outfit changes must retain avatar identity.
- Check VRM humanoid bone retargeting and non-penetration against the real world geometry; a normal desktop floor is not necessarily the current Private bed/platform height.
- Private action routing, any proposed adult terminology mapping and the existing eligibility gates must be audited separately. None was added here.

**Release rule:** a passing structural test does **not** approve the pose. If real contact checks, visual review, asset licensing or device behavior fail, leave the new pose isolated and fix/revert it before presenting it as completed.

## Next step when a downloaded source clip is available

Retarget a sampled motion-capture frame, using normalized humanoid local bone rotations and contact-aware pelvis adjustment or limited IK for hands and knees. Compare its four measured contact points to the candidate. Prefer the motion-capture frame only if it provides better joint alignment, stable grounding, correct feet orientation and safe garment deformation. Preserve current model, camera and scene invariants. Record exactly which downloaded file and license produced the final asset.

**No PR. No merge. No unverified performance or real-avatar claims.**
