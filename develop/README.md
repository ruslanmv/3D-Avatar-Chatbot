# develop/ — candidate poses & animations (staging only)

**Not integrated.** Files here are downloaded for planning and verification
before any product wiring (`vendor/animations/`, `MotionClipMap`, Pose
Navigator, intents).

Goal: gather license-clean motion so the avatar can become more natural and less
static — then prove each clip with the AX16 audit before promotion.

## Rules

1. Nothing under `develop/` is loaded by the app or `boot.js`.
2. Do **not** copy into `vendor/animations/` or change `src/` until a clip
   passes verification (see `verification/CHECKLIST.md`).
3. Record provenance in each `sources/*/PROVENANCE.md`. Keep archive checksums
   in `archives/SHA256SUMS.txt`.
4. Prefer **CC0** / **CC BY** (with credit) / CMU commercial-OK. Never stage CC
   BY-NC, SFU research-only, or Mixamo redistributions here.

## Layout

| Path                               | Contents                                      |
| ---------------------------------- | --------------------------------------------- |
| `sources/quaternius-ual-standard/` | CC0 game animations (Godot `.glb` + glTF)     |
| `sources/accad-female1/`           | ACCAD Open Motion Female1 BVH (81)            |
| `sources/accad-male1/`             | ACCAD Male1 BVH (69)                          |
| `sources/accad-male2/`             | ACCAD Male2 BVH (149)                         |
| `sources/cmu-curated/`             | Curated CMU BVH (sit, wave, jump, walk, talk) |
| `archives/`                        | Original zip downloads + SHA-256              |
| `MANIFEST.json`                    | Inventory of every clip file + hash           |
| `verification/`                    | How to prove a clip before integration        |

## Counts (this commit)

See `MANIFEST.json` → `counts`. Roughly **325 BVH** + Quaternius GLB/glTF.

## Next step (verify, then integrate)

```bash
# After converting a BVH → VRMA (https://vrm-c.github.io/bvh2vrma/)
# or playing BVH through the existing loader in a throwaway branch:
node tools/qa/animation-audit.mjs
node audits/vrm_animations/run.mjs --avatar AvatarSample_A --shots fail
```

Only promote clips that score **ok** (or an accepted warn) into
`vendor/animations/` with a credit line — never from this folder by path alias
alone.
