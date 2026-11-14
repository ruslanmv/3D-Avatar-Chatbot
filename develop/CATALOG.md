# Compatible animation sources (match what already works)

Local AX16 showed **native VRMA** and a few grounded sit/idle clips stay on her
feet (~0.85–0.90 m hips). Raw ACCAD/CMU BVH floated and were removed.

Prefer sources below. Avoid Mixamo redistributions and unscaled academic BVH.

## Already in this repo (highest compatibility)

| Asset                                                                               | Status                | Notes                                                                                         |
| ----------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `vendor/animations/vrma/{Angry,Relax,Sad,Surprised,Thinking,waiting-standard}.vrma` | Active, **ok**        | From [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer)                        |
| `vendor/animations/vrma/{Blush,Clapping,Goodbye,Jump,LookAround,Sleepy}.vrma`       | On disk, **inactive** | Same pack — README said skeleton issues; re-test with AX16 before enabling in `manifest.json` |
| Pose Navigator presets                                                              | Mostly **ok**         | Built-in poses, not downloadable clips                                                        |
| `sitting/sit_idle*.bvh`, `kneeling/*`, some idle                                    | Mixed                 | SillyTavern pack — only keep ones that score ok                                               |

## New in `develop/addons/stable/` (verified ok)

| Pack                                        | License | Smoke                                         |
| ------------------------------------------- | ------- | --------------------------------------------- |
| `vrma-mit/idle_loop.vrma` (ChatVRM)         | MIT     | **ok**                                        |
| `vrma-mit/test.vrma` (three-vrm)            | MIT     | **ok**                                        |
| `vrma-tk256-candidates/{Blush…Sleepy}.vrma` | MIT     | **ok** ×6 (safe to re-enable in a product PR) |

## Pending (`develop/addons/pending/`) — development

| Pack                            | License                    | Status                                          |
| ------------------------------- | -------------------------- | ----------------------------------------------- |
| `quaternius-ual-standard/` GLB  | CC0                        | Not playable — convert → VRMA                   |
| `vrma-booth-vroid/ok/` (6 VRMA) | BOOTH (credit; no extract) | Playback **ok**; Greeting removed (fail)        |
| `vrma-mocopi-tfuru/` (5 VRMA)   | Unclear (no SPDX)          | Playback **ok** — clarify license before stable |

## More to fetch (compatible format / license)

| Source                               | Format             | License                                         | Fit                                                                                  | Link                                                    |
| ------------------------------------ | ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **tk256ailab/vrm-viewer** (full set) | VRMA               | MIT                                             | Same as working emotions; enable inactive six after re-test                          | https://github.com/tk256ailab/vrm-viewer/tree/main/VRMA |
| **pixiv/ChatVRM** `idle_loop.vrma`   | VRMA               | MIT                                             | Natural breathing idle — **already staged**                                          | https://github.com/pixiv/ChatVRM                        |
| **pixiv/three-vrm** `test.vrma`      | VRMA               | MIT                                             | Tiny sample — **already staged**                                                     | https://github.com/pixiv/three-vrm                      |
| **Quaternius UAL / UAL2**            | FBX/GLB → BVH/VRMA | CC0                                             | Locomotion, sit, emotes — convert with [bvh2vrma](https://vrm-c.github.io/bvh2vrma/) | https://quaternius.com                                  |
| **VRoid Project BOOTH pack**         | VRMA               | Credit required; **no redistributable extract** | 6 ok staged in `pending/vrma-booth-vroid/ok/`; Greeting fail removed                 | https://booth.pm/ja/items/5512385                       |
| **tfuru mocopi samples**             | VRMA               | No SPDX                                         | 5 ok in `pending/vrma-mocopi-tfuru/` — rights TBD                                    | https://github.com/tfuru/vrma-loader-sample             |
| **BOOTH `#VRMA`**                    | VRMA               | Per item                                        | Prefer creator terms that allow OSS redistribution                                   | booth.pm search VRMA                                    |

## Do not add to develop/ (failed or incompatible)

| Source                             | Why                                               |
| ---------------------------------- | ------------------------------------------------- |
| ACCAD / CMU raw BVH                | Hips-floating / wrong scale on AvatarSample_A     |
| Mixamo FBX → VRMA without retarget | Floats 2–3.5 m (same class as quarantined addons) |
| Bandai Namco / SFU mocap           | NC or research-only                               |
| tfuru mocopi samples               | No clear SPDX on the sample repo                  |

## Recommended next pulls

1. ~~Re-AX16 the six inactive tk256 VRMA~~ — **done** (all ok in
   `vrma-tk256-candidates/`). Promote via product PR + `manifest.json`.
2. Convert pending Quaternius idle/sit/walk → VRMA; graduate only **ok** into
   `addons/stable/`.
3. Optionally document VRoid BOOTH 7-pack as an external optional set (credit;
   do not vendor).

## Agent audit (additive only)

```bash
npm start
node develop/verification/audit-additive.mjs
```

See `verification/AGENT.md`.
