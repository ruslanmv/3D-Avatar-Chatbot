# Verification evidence (ok-only)

| Run                              | Result                                          |
| -------------------------------- | ----------------------------------------------- |
| `runs/avatar-sample-a-critical/` | 17 **ok** product inventory rows kept           |
| `runs/stable-vrma-mit/`          | `idle_loop` + `test` both **ok**                |
| `runs/additive-*` (latest)       | **8/8 ok** — MIT idle/test + tk256 inactive six |
| `runs/LATEST.json`               | Pointer for agents                              |

Fail/warn packs (ACCAD, CMU) were removed from `develop/`.

## Additive-only command (use this)

```bash
npm start
node develop/verification/audit-additive.mjs
```

See `AGENT.md` for Claude / Cursor / Grok.
