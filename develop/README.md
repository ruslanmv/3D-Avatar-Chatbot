# develop/ — animation audit tooling

Staging **binaries were removed** after review. Product wiring is in
[#155](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/155).

What remains here is the **additive audit** agents use on new clips:

```bash
npm start
# default: shipped VRMA under vendor/
node develop/verification/audit-additive.mjs
# or any folder of .vrma / .bvh
node develop/verification/audit-additive.mjs --dir path/to/clips --strict
```

See `STATUS.md`, `CATALOG.md`, and `verification/AGENT.md`.
