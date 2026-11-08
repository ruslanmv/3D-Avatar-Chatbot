---
description:
    Start the Quality Lab's top-ranked next action (optionally for one area)
argument-hint: '[ai|3d|atlas]'
---

Take the top open action from the NEXUS Quality Lab and do it properly.

1. Get the ranked work: call the `nexus-quality-lab` MCP tool `lab_next_actions`
   (area: `$ARGUMENTS` if given), or read `quality-lab/data/hub.json` if the
   server is not enabled; `node tools/qa/lab-call.mjs lab_next_actions '{}'`
   calls the tool without it). Pick the first action and say which one you took
   and why, in one line.
2. Read the files the action names, and the matching `docs/claude/` notes from
   the feature map in `CLAUDE.md`, before changing anything.
3. Measure before: record the numbers the action quotes (its `why`), from the
   lab tools, not from memory.
4. Make one focused change. If it touches several files, write the plan first.
5. Measure after with the same tool, regenerate lab data through the tools
   (`lab_regenerate`, or `node tools/qa/world-audit.mjs`; a scorer change also
   needs `node tools/qa/lab-publish.mjs --rescore-all`), then run `/lab-check`.
6. Commit code and regenerated lab data together, with the batch prefix of the
   area, and report before → after. Prefixes: 3D worlds, gateways and stand-ins
   `VW`; spots and movement within a place `LW`; playground venues and chips
   `PG`; the Private World `PW`; AI quality, the Private prompt and this lab's
   own setup `AX`. Code comments use numbers that `git log` may not show, so
   take the next free number from both: `git log --oneline --grep '^VW[0-9]'`
   and `grep -rn 'VW[0-9]' src tools`.

When the action is about a world, look before and after:
`lab_screenshot {"world":"<id>"}` (desktop and phone, inline) and
`node tools/vr/subset-scene.mjs --list <scene>` (its parts, nearest her first).

Never hand-edit files under `quality-lab/data/` other than `atlas/atlas.json`.
If the action needs a device, a real model run or a human review you cannot do,
stop and say exactly what remains.
