---
description: Verify lab data is current and the gate passes before committing
---

Run the pre-commit checks for this repository and report each as pass or fail
with the failing output:

1. `node tools/qa/world-audit.mjs --check` (3D and atlas audits current)
2. `node tools/qa/hub.mjs --check` (hub.json current)
3. `node scripts/behavior-parity-baseline.mjs --check` (engine inert, no stray
   engine references)
4. `npx prettier --check` on the files changed in this session
5. `npm run validate` (lint, format, the whole Jest suite)

If an audit or the hub is stale, regenerate it with its tool (never by hand) and
re-run the check. Do not commit while any check fails; any failure is this
session's to fix.
