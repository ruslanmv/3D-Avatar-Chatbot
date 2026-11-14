# develop/ — animation staging

Staging area for animation clips **before** they reach the app. It holds no
binaries today: everything that passed review was promoted to
`vendor/animations/vrma/` (credits: the `credits` block in
`vendor/animations/manifest.json`), and clips nobody used were removed on
2026-11-14.

| Path                             | Contents                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `addons/stable/`                 | empty — stage candidates here, then audit                      |
| `addons/pending/`                | empty — licence-clean packs awaiting conversion                |
| `NEEDS_FIX.md`, `needs-fix.json` | clips that failed review (they live in `addons/`, quarantined) |
| `CATALOG.md`                     | compatible sources to look at next                             |
| `verification/`                  | audit + screenshot scripts, and the evidence of past runs      |

## Agent loop

```bash
npm start
node develop/verification/audit-additive.mjs          # develop/addons/stable
node develop/verification/audit-additive.mjs --dir <path>
```

Then look at the frames (`verification/screenshot-clips.mjs`) on more than one
avatar height — hips height alone missed a sideways tilt and a leg flip.
