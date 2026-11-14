# Stable addon staging

| Folder                     | License | Notes                                         |
| -------------------------- | ------- | --------------------------------------------- |
| `vrma-mit/`                | MIT     | Native VRMA; additive audit **ok**            |
| `vrma-tk256-candidates/`   | MIT     | Former inactive six; additive audit **ok** ×6 |
| `quaternius-ual-standard/` | CC0     | Multi-clip GLB — split/convert before ship    |

Audit only this tree:

```bash
node develop/verification/audit-additive.mjs
```

See `../../CATALOG.md` for other compatible sources.
