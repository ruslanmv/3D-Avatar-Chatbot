# Pending — not playable on the VRM yet

Assets here are **license-clean** but **not** product-ready. Do not promote into
`vendor/animations/` or treat as additive-audit **ok**.

| Pack                       | Why pending                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `quaternius-ual-standard/` | CC0 AnimationLibrary **GLB** — Blender `DEF-*` bones; **0** tracks bind to AvatarSample_A; ClipLoader only plays `.vrma` / `.bvh` |

**Probe evidence:**
`develop/verification/runs/quaternius-glb-probe/probe.json`  
**Verdict:** `does-not-drive-vrm` (load OK, name overlap empty).

## To graduate into `addons/stable/`

1. Convert clips → VRMA (e.g. [bvh2vrma](https://vrm-c.github.io/bvh2vrma/))
   with humanoid retarget.
2. Place `.vrma` under `addons/stable/…` with `PROVENANCE.md`.
3. `npm start` then `node develop/verification/audit-additive.mjs` → all **ok**.
4. Move or delete the pending GLB/zip when no longer needed.
