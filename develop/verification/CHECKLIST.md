# Verification before integration

For AI coders: start with **`AGENT.md`**. Audit only new clips under
`develop/addons/stable/`.

## Additive gate (required)

```bash
npm start
node develop/verification/audit-additive.mjs
# optional: fail on warn
node develop/verification/audit-additive.mjs --strict
```

Exit 0 only when every `.vrma` / `.bvh` under `addons/stable/` is **ok**.

## Per clip

- [ ] License allows Apache-2.0 redistribution (CC0 / MIT / CC BY with credit).
- [ ] Provenance line exists under the pack `PROVENANCE.md`.
- [ ] Additive audit: not `hips-floating`, not sink, not inverted legs, not
      unexpected `no-motion`.
- [ ] Intent mapping proposed (sit / dance / wave / follow / idle / …) or marked
      pose-only.
- [ ] Credit string ready for `vendor/animations/manifest.json`.

## Optional full product matrix

Only when debugging shipped clips — not for additive staging:

```bash
node tools/qa/animation-audit.mjs --play --avatar AvatarSample_A --full --shots fail
```

## Promotion

1. Copy verified files into `vendor/animations/<category>/` (or `addons/…`).
2. Wire `manifest.json` / intents in a **separate product PR** (no `src/` here).
3. Keep `develop/` evidence (`runs/LATEST.json`) as the audit trail.

## Known gaps these packs target

| Need                       | Candidate source                                     |
| -------------------------- | ---------------------------------------------------- |
| Natural idle / sway / wait | `vrma-mit/idle_loop.vrma` (**ok**); Quaternius idle  |
| Conversation gestures      | tk256 Clapping / LookAround (**ok**)                 |
| Wave / goodbye             | tk256 Goodbye (**ok**)                               |
| Jump                       | tk256 Jump (**ok**)                                  |
| Emotes                     | tk256 Blush / Sleepy (**ok**); Quaternius after VRMA |
| Walk / sit / dance (game)  | Quaternius UAL Standard GLB → convert                |
