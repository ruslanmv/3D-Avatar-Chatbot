# Agent brief: develop/ additive animation audit

For Claude, Cursor, Grok, or any AI coder. **One job:** prove new clips in
`develop/addons/stable/` before anyone copies them into product.

## Do

```bash
npm start                                          # http://127.0.0.1:8080
node develop/verification/audit-additive.mjs       # ONLY develop/ addons
```

Exit **0** only when every playable clip is **ok** (no fail). Warn is printed
but does not fail the process unless `--strict`.

## Rules

1. Audit **additive paths only** — `develop/addons/stable/**/*.{vrma,bvh}`. Do
   not re-run the full vendor matrix unless asked.
2. Never modify `src/` from this folder. Promote in a separate product PR.
3. Fail/warn clips: delete or move out of `addons/stable/` (do not leave junk).
4. Record provenance in each pack’s `PROVENANCE.md`.
5. Prefer native **VRMA** (same class as shipped tk256 clips). Raw academic BVH
   usually floats — skip unless grounded.

## Pass bar

| Verdict | Meaning                                   | Action                   |
| ------- | ----------------------------------------- | ------------------------ |
| ok      | Grounded, moves                           | Keep / promote candidate |
| warn    | Soft issue (e.g. no-motion on a hold)     | Fix or drop              |
| fail    | hips-floating, inverted legs, play-failed | **Remove from develop/** |

Evidence → `develop/verification/runs/additive-<stamp>/`.

## Catalog

More compatible internet sources: `develop/CATALOG.md`.
