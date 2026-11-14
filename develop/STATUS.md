# Staging status

| Pack                    | License                  | Files        | Verification                                | Integration             |
| ----------------------- | ------------------------ | ------------ | ------------------------------------------- | ----------------------- |
| Quaternius UAL Standard | CC0                      | 1 GLB + glTF | pending (multi-clip GLB, not in BVH smoke)  | not started             |
| ACCAD Female1           | CC BY 3.0                | 81 BVH       | smoked 6 clips — play OK, all hips-floating | blocked on scale/ground |
| ACCAD Male1             | CC BY 3.0                | 69 BVH       | not smoked yet                              | not started             |
| ACCAD Male2             | CC BY 3.0                | 149 BVH      | not smoked yet                              | not started             |
| CMU curated             | CMU free (commercial OK) | 26 BVH       | smoked 6 clips — play OK, hips ~16 m        | blocked on retarget     |

**Product inventory** (vendor + Pose Navigator) verified locally 2026-11-14 —
see `verification/REPORT.md`. Pose Navigator 24/26 ok; shipped VRMA ok; most
vendor BVH float until PR #152 hip/quarantine work.

**Intentionally not staged:** Bandai Namco (NC), SFU (research-only), Mixamo,
pixiv free VRMA (redistribution of extractable motions restricted).
