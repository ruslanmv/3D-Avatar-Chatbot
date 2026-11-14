# Compatible animation sources (match what already works)

Local AX16 showed **native VRMA** and a few grounded sit/idle clips stay on her
feet (~0.85–0.90 m hips). Raw ACCAD/CMU BVH floated and were removed.

Prefer sources below. Avoid Mixamo redistributions and unscaled academic BVH.

## Already in this repo (highest compatibility)

| Asset                                                                               | Status               | Notes                                                                                |
| ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `vendor/animations/vrma/{Angry,Relax,Sad,Surprised,Thinking,waiting-standard}.vrma` | Active, **ok**       | From [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer)               |
| `vendor/animations/vrma/{Blush,Clapping,Goodbye,Jump,LookAround,Sleepy}.vrma`       | Active, **ok** (MO9) | Re-enabled once MO8 fixed the hips scaling that made them look skeleton-incompatible |
| Pose Navigator presets                                                              | Mostly **ok**        | Built-in poses, not downloadable clips                                               |
| `sitting/sit_idle*.bvh`, `kneeling/*`, some idle                                    | Mixed                | SillyTavern pack — only keep ones that score ok                                      |

## Staged here earlier — where each pack went (2026-11-14)

| Pack                           | Outcome                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| ChatVRM `idle_loop.vrma` (MIT) | Promoted → `vendor/animations/vrma/idle_loop.vrma` (MO9)               |
| tk256 six (MIT)                | Already in `vendor/animations/vrma/`; staging copies removed           |
| three-vrm `test.vrma` (MIT)    | Removed — sanity sample, no product role                               |
| VRoid BOOTH six                | Promoted → `vendor/animations/vrma/` (MO10); `VRMA_02` Greeting failed |
| mocopi five (tfuru)            | Promoted → `vendor/animations/vrma/` (MO10)                            |
| Quaternius UAL Standard (CC0)  | Removed — not playable until converted; re-download to work on it      |

## More to fetch (compatible format / license)

| Source                               | Format             | License                                         | Fit                                                                                  | Link                                                    |
| ------------------------------------ | ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **tk256ailab/vrm-viewer** (full set) | VRMA               | MIT                                             | Same as working emotions — all six now active                                        | https://github.com/tk256ailab/vrm-viewer/tree/main/VRMA |
| **pixiv/ChatVRM** `idle_loop.vrma`   | VRMA               | MIT                                             | Natural breathing idle — **in the app** (`idle_loop.vrma`)                           | https://github.com/pixiv/ChatVRM                        |
| **pixiv/three-vrm** `test.vrma`      | VRMA               | MIT                                             | Tiny sample — not needed (removed)                                                   | https://github.com/pixiv/three-vrm                      |
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

1. ~~Re-AX16 the six inactive tk256 VRMA~~ — **done**, all six active (MO9).
2. Quaternius UAL: download again, convert idle/sit/walk → VRMA, stage in
   `addons/stable/` and audit on three avatar heights before promoting.
3. Fix or replace the clips tagged in `NEEDS_FIX.md` (17 Mixamo, 8 converted
   dances).

## Agent audit (additive only)

```bash
npm start
node develop/verification/audit-additive.mjs
```

See `verification/AGENT.md`.
