---
description: Plan a new zone of the Nexus world from a short description
argument-hint: '<what the place is, where it sits, which devices>'
---

Plan a new World atlas zone from this description: $ARGUMENTS

1. Read `quality-lab/README.md` ▸ The World atlas and
   `docs/engine/NEXUS_OPEN_WORLD_ROADMAP.md`. Call `lab_atlas` (MCP) to see
   regions, zones and links.
2. Draft the brief: a lowercase-dashed id, region, title, purpose (why the two
   of you go there), mood, activities, the spots she will need, devices
   (desktop, mobile, vr), assets with their licence (CC0 or Apache-compatible
   only), and links to existing neighbouring zones. A private zone links only to
   private zones. It is an original Nexus place: no names, characters or art
   from an existing game.
3. Validate it with `lab_new_zone` (dry run) or
   `node tools/qa/new-zone.mjs … --dry-run`, fix anything it refuses, and show
   the brief.
4. Write it only after the person agrees (dry run off), then run `/lab-check`
   and commit the atlas, the audits and hub.json together.
