# develop/ — stable addon candidates only

Only license-clean assets that match **working** playback (native VRMA /
grounded motion). Fail/warn packs (ACCAD, CMU) were removed.

Nothing here is product-wired until AX16 scores **ok** and a separate PR
promotes into `addons/` or `vendor/animations/`.

## Layout

| Path                                     | Contents                                        |
| ---------------------------------------- | ----------------------------------------------- |
| `addons/stable/vrma-mit/`                | MIT VRMA (`idle_loop`, `test`) — **ok**         |
| `addons/stable/vrma-tk256-candidates/`   | Inactive tk256 six — **re-audited ok**          |
| `addons/stable/quaternius-ual-standard/` | CC0 GLB library — convert to VRMA next          |
| `archives/`                              | Quaternius zip + SHA-256                        |
| `CATALOG.md`                             | More compatible sources on the internet         |
| `verification/AGENT.md`                  | One-page brief for Claude / Cursor / Grok       |
| `verification/audit-additive.mjs`        | Audit **only** new clips under `addons/stable/` |

## Agent loop (simple)

```bash
npm start
node develop/verification/audit-additive.mjs
```

Exit 0 when every playable stable clip is **ok**. Full vendor matrix is optional
(`tools/qa/animation-audit.mjs`) — not required for additive work.

See `CATALOG.md` before downloading anything else.
