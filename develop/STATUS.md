# Staging status

> **Development staging only — not redistribution.** Binaries under
> `develop/addons/` stay in this PR for local/agent work. Product shipping and
> MIT notices are handled in
> [#155](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/155); BOOTH/mocopi
> remain pending license gates and must not be copied into public `vendor/` as
> extractable redistributables.

## `addons/stable/` — MIT VRMA, additive **ok**

| Pack                    | Location                               | Verification |
| ----------------------- | -------------------------------------- | ------------ |
| ChatVRM / three-vrm MIT | `addons/stable/vrma-mit/`              | **ok** ×2    |
| tk256 candidates        | `addons/stable/vrma-tk256-candidates/` | **ok** ×6    |

Stable additive: **8/8 ok**.

## `addons/pending/` — development binaries

| Pack                 | Playback                        | License gate                         |
| -------------------- | ------------------------------- | ------------------------------------ |
| Quaternius UAL GLB   | not playable                    | CC0 — convert → VRMA                 |
| BOOTH VRoid (6 kept) | **ok** ×6; Greeting **removed** | Credit; no product `vendor/` extract |
| mocopi tfuru (5)     | **ok** ×5                       | No SPDX — clarify before stable      |

See `addons/pending/README.md`. ACCAD/CMU floaters removed.

## 2026-11-14 — promoted to the app (MO10)

BOOTH VRoid six (`show_outfit`, `peace_sign`, `finger_gun`, `spin`,
`model_pose`, `playful_dip`) and mocopi five (`turn_aside`, `open_arms`,
`hand_on_heart`, `explain`, `present`) now live in `vendor/animations/vrma/` at
the owner's direction, with credits and licence notes in
`vendor/animations/vrma/THIRD_PARTY_LICENSES.md`. Their staging copies were
removed from `addons/pending/`.

Clips that failed review are tagged in [`NEEDS_FIX.md`](NEEDS_FIX.md).
