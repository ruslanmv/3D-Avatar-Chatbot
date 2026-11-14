# Stable addon staging — ok-only

**Only** clips that passed `node develop/verification/audit-additive.mjs` live
here.

| Folder                   | License | Notes                           |
| ------------------------ | ------- | ------------------------------- |
| `vrma-mit/`              | MIT     | `idle_loop`, `test` — **ok**    |
| `vrma-tk256-candidates/` | MIT     | Former inactive six — **ok** ×6 |

Quaternius GLB is **not** here — see `../pending/` (`NOT_PLAYABLE_YET`).

```bash
node develop/verification/audit-additive.mjs
```
