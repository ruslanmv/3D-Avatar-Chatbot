# tk256 VRMA candidates (MIT)

Copied from `vendor/animations/vrma/` for **additive re-audit** before
re-enabling in `vendor/animations/manifest.json`.

Upstream: [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer)
(MIT). Same pack as the six shipped active emotions. Product README currently
marks these six inactive (historical skeleton concerns) — AX16 additive audit
re-checks them on AvatarSample_A.

| File            | Role       |
| --------------- | ---------- |
| Blush.vrma      | Expression |
| Clapping.vrma   | Gesture    |
| Goodbye.vrma    | Gesture    |
| Jump.vrma       | Locomotion |
| LookAround.vrma | Look       |
| Sleepy.vrma     | Expression |

Keep only clips that score **ok** under
`node develop/verification/audit-additive.mjs`.
