---
description:
    Start a NEXUS session - check the setup, take the top lab action, report
argument-hint: '[ai|3d|atlas] [optional goal in a few words]'
---

Start a working session on this repository. Arguments: `$ARGUMENTS` (an area,
optionally followed by a goal; no area means take the overall top action).

Rules for the whole session: stay on the current feature branch, never open a
pull request or merge unless asked, never hand-edit `quality-lab/data/` (only
`atlas/atlas.json`), never fake a measurement. If a step needs a GPU, a real
phone or headset, a real model run or a human review, stop at that step and say
exactly what remains.

## Part 1: setup check (one line each, ✅ or ‼️ with evidence)

1. **Working directory.** Run `pwd`. If it is not the repository root (a cloud
   session with more than one repository starts above the clones, and then the
   repository's hook and `.mcp.json` are not loaded), `cd` into the repository
   and say so.
2. **Startup brief received?** If not, run
   `CLAUDE_PROJECT_DIR=$PWD ./.claude/hooks/session-start.sh` and, if it printed
   a PATH line for Node 24, run `export PATH="/opt/node24/bin:$PATH"` in your
   shell commands. Report `node -v` (24 is required; 22 still passes the gate).
3. **MCP.** Call `lab_status`. If the `nexus-quality-lab` tools are not loaded,
   use `node tools/qa/lab-call.mjs lab_status '{}'` (any tool:
   `node tools/qa/lab-call.mjs <tool> '<json>'`) and say so.
4. **`/lab-check`** (follow `.claude/commands/lab-check.md`). Everything must
   pass before any change.

## Part 2: the task

Follow `.claude/commands/lab-next.md` with the area from `$ARGUMENTS`
(`lab_next_actions`). Say in one line which action you took and why. Then:

1. Read the `docs/claude/` notes the CLAUDE.md feature map names, and the
   matching section of `quality-lab/README.md`.
2. Measure before with the lab tools (`lab_world`, `lab_atlas`, `lab_replies` as
   the action needs). When the action is about a world, take `lab_screenshot`
   (desktop and mobile) and, for a scene,
   `node tools/vr/subset-scene.mjs --list <scene>`.
3. Write a short plan: what changes, which files (start from the action's
   `files`), and which tests or docs pin the old behaviour.
4. Implement, regenerate with `lab_regenerate`, and measure again with the same
   tools and screenshots.
5. Run `/lab-check` and `npm run validate`. Both must pass.
6. Commit code and regenerated lab data together. Use the area's batch prefix
   (see `lab-next.md`; check `git log --grep '^<PREFIX>[0-9]'` for the next free
   number) and include the before → after numbers and which checks you ran.
   Push.

## Part 3: report

1. The setup check, ✅/‼️ each.
2. The task: a before → after table from the lab tools, the screenshots, files
   changed, the commit, and what remains (device checks).
3. Feedback on the setup: what saved time, where you got stuck. Name the file
   and what to change.
