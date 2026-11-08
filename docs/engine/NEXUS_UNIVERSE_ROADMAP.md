# NEXUS Universe roadmap — from one companion to connected worlds

**Version:** 1.0, 2026-11-07. This is a **plan, not a claim**. Nothing in this
document exists unless its row says so.

**The principle:** grow by reusable data and contracts, and keep today's
single-companion runtime fast. Build expensive systems (networking, economy,
multiplayer) only when a measured product need arrives.

## Stage 0 — today (implemented)

- **Places:** one companion, one conversation, 37 worlds in
  `worlds.json`, 14 of them named places.
- **Inside a place:** verified spots in the apartment, renderer-confirmed
  moves, and travel that needs a yes (Living Worlds).
- **Venues:** chips, gaze anchors and reactive behaviour (PG1–PG3).
- **Privacy:** Private behind its own gates; Copilot isolated.

## Stage 1 — near-term reusable abstractions (cheap, do next)

| Item | Builds on | Notes |
| --- | --- | --- |
| Spots for every place (club, pub, academy, glade) | `measure-spots.mjs` | data work; accept ✗ results |
| Prop-world measuring (`coordinateSpace: "place"`) | `VRWorlds.buildPlace` sizing | unlocks phone forest, hotel suite |
| A spot menu (one compact control, accessible) | `WorldPresence.go` | user taps are authorization |
| `WorldRegistry` view over `worlds.json` + spots + `DESTINATIONS` | existing files | one catalogue, no second source |
| Seat-aligned `sit`/`lie` at measured seats | `sit`, `sit_idle`, `lay` clips; seat height/facing from the tool | only then add `sit-on` affordances |
| Gaze anchors from measured nodes (not hand `at`) | the measuring tool | anchors and spots share one truth |
| Behaviour manifests → `INTENTS`/`CHANNELS`/`PROFILES` | `BehaviorRouter` | a loader is a thin layer |

## Stage 2 — connected zones (moderate)

- **Zones and rooms:** `RoomDefinition` with measured door points, and a
  navigation graph *measured by a tool* (no hand-drawn walls).
- **Walking:** avatar walking on desktop and phone only, along the graph,
  via `AvatarLocomotionSystem.walkToPoint`. VR keeps blink.
- **Portals:** `WorldTransition` data. Every portal is still a proposal plus
  the person's yes.
- **Story state:** persistent quest and story state per story, as Seaside
  persists beat and flags. Consented, not a transcript, and erased by Clear
  where it is conversation content.
- **Asset streaming:** preload the next destination while the proposal waits
  (`runtime.show` already loads before the swap). Cache via the existing
  `modelCache`.

## Stage 3 — more characters (expensive; only with a need)

- **Character registry:** id, VRM, persona, permitted worlds, behaviours.
  NEXUS stays the one companion identity.
- **Several agents in a scene:** each needs its own behaviour arbitration and
  speech turn-taking (`VoiceTurnController` is single-speaker today), plus
  explicit render and performance budgets per tier.
- **Inventories and object ownership:** only after hand-attach and
  affordances exist.

## Stage 4 — shared worlds (very expensive)

- **Multiplayer:** **server-authoritative**. Clients propose and the server
  validates, the same Observe → Verify → Execute → Confirm rule at network
  scale. Sync world id, spot, story flags and object state; never raw prompts
  or private memory.
- **Social spaces:** moderation, reporting, blocking, consent for proximity
  and voice, age gating, and private spaces that stay private.
- **Economy and progression:** only with legal review, never pay-to-unlock
  intimacy, no dark patterns.
- **User-created worlds:** packages validated like wardrobe packs (hashes,
  whitelisted fields, no code), **untrusted by default** (`SceneCatalog`
  trust tiers), with ratings that can only narrow.

## Non-goals now

- No multiplayer and no networking.
- No second renderer or animation engine.
- No agent framework.
- No TypeScript build.
- No smooth locomotion in VR.
- No public package format until Stage 1's registry exists.

## How to tell a stage is real

Each stage is done only when:

- its contracts load real data
- tests hold them
- a real-app walkthrough shows them
- hardware results are reported where they matter
- `ENGINE_DOCUMENTATION_REPORT.md` is updated
