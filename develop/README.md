# develop/ — animation staging

- **`addons/stable/`** — working VRMA only (additive audit **ok**).
- **`addons/pending/`** — license-clean but **not playable yet** (Quaternius
  GLB).
- Nothing here is product-wired until a separate promotion PR.

## Layout

| Path                                      | Contents                                |
| ----------------------------------------- | --------------------------------------- |
| `addons/stable/vrma-mit/`                 | MIT VRMA (`idle_loop`, `test`) — **ok** |
| `addons/stable/vrma-tk256-candidates/`    | tk256 six — **ok**                      |
| `addons/pending/quaternius-ual-standard/` | CC0 GLB — **not playable yet**          |
| `addons/pending/vrma-booth-vroid/ok/`     | BOOTH 6 VRMA — playback **ok** (dev)    |
| `addons/pending/vrma-mocopi-tfuru/`       | mocopi 5 VRMA — playback **ok** (dev)   |
| `addons/pending/archives/`                | Quaternius zip + SHA-256                |
| `CATALOG.md`                              | More compatible sources                 |
| `verification/AGENT.md`                   | Brief for Claude / Cursor / Grok        |
| `verification/audit-additive.mjs`         | Audits **stable** `.vrma`/`.bvh` only   |

## Agent loop

```bash
npm start
node develop/verification/audit-additive.mjs
```

Pending packs are excluded from that audit on purpose. See
`addons/pending/README.md`.
