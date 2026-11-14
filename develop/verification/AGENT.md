# Agent brief: additive animation audit

For Claude, Cursor, Grok. **One job:** prove new `.vrma` / `.bvh` clips before
product wiring. Product promotion of the #153 MIT set is in **PR #155**.

## Do

```bash
npm start
node develop/verification/audit-additive.mjs
# ad-hoc:
node develop/verification/audit-additive.mjs --dir path/to/clips --strict
```

Exit **0** when every playable clip is **ok** (no fail). `--strict` also fails
on warn.

## Rules

1. Prefer `--dir` at the pack you are adding. Default scans
   `vendor/animations/vrma/` (shipped MIT set).
2. Never modify `src/` from an audit-only session — product PRs own wiring.
3. Fail clips: do not promote. Prefer native **VRMA** over unscaled BVH/GLB.
4. MIT redistributions need copyright + licence text (see
   `vendor/animations/vrma/THIRD_PARTY_LICENSES.md` in #155).
5. **Multi-avatar pass bar:** AvatarSample_A + one short (`VRM_Viewer_Sample`) +
   one tall (`Vita`). Single-avatar audits miss hips-scale bugs.

## Pass bar

| Verdict | Meaning                                   | Action       |
| ------- | ----------------------------------------- | ------------ |
| ok      | Grounded, moves                           | Keep/promote |
| warn    | Soft issue                                | Fix or drop  |
| fail    | hips-floating, inverted legs, play-failed | Do not ship  |

Evidence → `develop/verification/runs/additive-<stamp>/`. Catalog:
`../CATALOG.md`.
