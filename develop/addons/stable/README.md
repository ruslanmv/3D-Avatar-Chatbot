# addons/stable/ — empty

Stage a new candidate clip here (`.vrma` or `.bvh`, one folder per pack with a
`PROVENANCE.md`) and run:

```bash
node develop/verification/audit-additive.mjs
```

Everything that passed review has been promoted to `vendor/animations/vrma/`;
credits and licences for those clips are in
`vendor/animations/vrma/THIRD_PARTY_LICENSES.md`. The staging copies were
removed on 2026-11-14 so the repository does not carry the same binaries twice.
