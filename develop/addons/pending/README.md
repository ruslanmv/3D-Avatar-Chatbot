# Pending — development staging

| Pack                       | Status                                                        | In git? |
| -------------------------- | ------------------------------------------------------------- | ------- |
| `quaternius-ual-standard/` | GLB — **not playable** on VRM yet                             | Yes     |
| `vrma-booth-vroid/ok/`     | 6 VRMA **playback ok**; Greeting removed (legs-inverted fail) | Yes\*   |
| `vrma-mocopi-tfuru/`       | 5 VRMA **playback ok**; SPDX unclear                          | Yes\*   |

\* Dev staging only — do not promote BOOTH into `vendor/` as extractable files;
clarify mocopi license before stable.

## Re-audit pending VRMA

```bash
node develop/verification/audit-additive.mjs \
  --dir develop/addons/pending/vrma-booth-vroid/ok \
  --dir develop/addons/pending/vrma-mocopi-tfuru
```

## Development only

These binaries are for **in-repo development and testing**. They are **not** a
redistribution package. Do not treat BOOTH or unclear-SPDX packs as Apache-2.0
vendor extracts.
