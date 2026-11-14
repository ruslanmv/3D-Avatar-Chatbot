# develop/ status — audit tooling only

**Product promotion lives in
[#155](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/155)** (MO7–MO9):
idle_loop + tk256 six wired into chat, VRMA hips scaling fixed (node-0 `safeGet`
bug), MIT notices in `vendor/animations/vrma/THIRD_PARTY_LICENSES.md`.

## This PR (#153) keeps

| Path                              | Role                                           |
| --------------------------------- | ---------------------------------------------- |
| `verification/AGENT.md`           | Brief for Claude / Cursor / Grok               |
| `verification/audit-additive.mjs` | Additive clip audit (`--dir` for ad-hoc packs) |
| `verification/CHECKLIST.md`       | Promotion checklist                            |
| `CATALOG.md`                      | Compatible internet sources                    |
| `verification/runs/`              | Historical evidence / screenshots              |

## Removed from this PR (per review)

- Duplicate tk256 / idle_loop VRMA copies (already in `vendor/` or promoted in
  #155)
- Quaternius GLB/zip (LFS pointer + unconverted — keep out of git until VRMA
  passes)
- BOOTH / mocopi binaries (license / redistrib gates)

## Pass bar (suggested)

Audit on **AvatarSample_A** plus one short avatar (`VRM_Viewer_Sample`) and one
tall (`Vita`). Single-avatar-only audits miss hips scale bugs (#155 MO8).
