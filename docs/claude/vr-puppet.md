<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# The VR puppet moves her skeleton (VP1)

three-vrm 2.x gives a VRM two skeletons: the **raw** bones skin the mesh, the
**normalized** rig is a proxy that `vrm.update()` copies onto them — only while
`humanoid.autoUpdateHumanBones` is true. This app keeps it **false** so
ProceduralAnimator can write the raw bones (breathing, base pose). VRPoseSystem
resolves the _normalized_ bones (PoseRigMap's `getBone`), so until VP1 every VR
IK drag, direct bone grab and VR-panel pose moved a skeleton nobody draws: the
sphere moved, she did not (measured: 0.261 m vs 0.000 m).

- **Anything in VR that poses her calls `vrPoseSystem.claimBones()` first**
  (`startIK`, the bone grabber's direct grab, `cyclePreset`, Place mode,
  intimacy presets). `src/gltf-viewer/PuppetSkeleton.js` (IIFE, tested in
  `tests/puppet-skeleton.test.js` against a transcribed three-vrm rig) snapshots
  both skeletons, the copy flag and the animator's pose/edit modes, carries her
  visible pose into the proxy (N = P·raw·B⁻¹·P⁻¹ — the inverse of three-vrm's
  copy, so a grab does not pop), puts the animator in pose mode, and stops a
  clip only if one is playing (the resolver's `stop()` turns the animator's
  mixer permission off for good).
- **While held, `VRPoseSystem.update` copies proxy → skeleton after solving**,
  and the puppet does again after its own solve/grab (`syncSkeleton()`), so the
  mesh shows this frame's pose and a BehaviorEngine talk/think mode cannot take
  her body from the person's hand. She keeps the pose after release — that is
  the feature.
- **Reset, Place mode off, leaving VR, or a new avatar release** —
  `releaseBones()` writes the snapshot back verbatim and, in the headset, blends
  into her idle over 0.4 s. Restoring edit mode matters: `setPoseMode(false)`
  leaves `editMode` on, and an animator left in edit mode never moves her again.
- **Handles sit on the drawn skeleton** (`getVisualBone`), not the proxy, which
  was ~6 cm off her body at rest.
