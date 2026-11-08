<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Private World: a gated premium room inside Private (PW1–PW6)

The private cabaret as a place with measured spots and real interactions, inside
the existing Intimate experience. **Off in every build**: it opens only when the
site sets
`NEXUS_PRIVATE_WORLD_CONFIG = { enabled: true, eligibility: 'server-attested' }`
and the session carries a server attestation. Start at
`docs/engine/PRIVATE_WORLD_ENGINE.md`. The verdict and the blockers are in
`docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md`: not production-ready.

- **The avatar must be declared adult (PW1, PW8).** Private mode says the
  _person_ is an adult; whether the _avatar_ depicts one is the operator's
  declaration. `src/features/together/AvatarAdultDeclaration.js` (boot list) is
  the one place that is asked, and `Intimate.start()` awaits it and refuses with
  its sentence. Two sources count:
    - `depictsAdult: true` on an item of the shipped public catalog
      `vendor/avatars/avatars.json` (all 17 declared, PW8), only for a
      same-origin file at exactly `vendor/avatars/<file>`
    - Forge's `depictsAdult` (`GET /v1/library`, Forge's
      `assets/library/policy.json`, all five library avatars declared)

    An installed, uploaded, `blob:`, `data:` or other-origin avatar is never
    declared by the catalog. A worn look is judged as the controller's
    `original` only while the URL on screen is exactly the controller's
    `wornUrl`; before PW8, any `blob:` after a haul passed as the original. It
    fails closed: a string `'true'`, Forge bytes that differ, a throw. Never
    make private mode stand in for this.

- **`src/experiences/private/PrivateWorldAdapter.js`** (boot list after
  WorldPresence; `live.privateWorld`) owns no consent of its own. Its gate is
  five answers, each exactly `true` and re-asked at every step:
    - deployment config
    - `blackboard.adultVerified`
    - `privateOpenNow`
    - one of this config's private worlds
    - the avatar declared adult

    When the gate closes after having been open, the room is revoked, once: the
    light is restored, a dance stopped, presence reset. Revocation also follows
    `adult:exit`, `private:session-stop`, Clear, the session ending and detach.

- **Interactions are data, confirmed by their owners**
  (`assets/vr-worlds/private/private-sanctuary.json`, `validateConfig`; an
  unknown field refuses the whole config, and a config cannot make a world
  private). The owners:
    - light: `runtime.setMood`
    - dance and stop: the venue router's report
    - look: BehaviorRouter `applied`
    - spots: `WorldPresence.go`

    A pending step is "Happening now", never done. An answer that returns after
    a revoke or in another world is stale and dropped. Her `<act id/>` is only
    an offer that the person's next-turn yes takes.

- **The room hears Private's turns from the conversation surface
  (`observeSurface`), not `chatHistory`**. Private keeps its turns in its own
  card, never persisted, and reading `chatHistory` meant the room heard nothing
  while she claimed the light had changed. `promptChunk` reads the turn first,
  so the request has run before the room is described.
- **The room reaches only Private's own prompt.**
  `TogetherCapability.privateRoomChunk` runs after a non-empty
  `privateSystemPromptSuffix()`, on the system suffix and the remote-persona
  overlay. The companion prompt carries no private field for any destination.
- **WorldPresence gained three things.**
    - `privateGate`: the private instance refuses non-private worlds and
      re-checks the gate.
    - `lightsOffered`.
    - A move that lands after `reset()` is not narrated.

    `WorldSpots.intentOf` marks a named place that is not here
    (`{ move, named }`), so her substitute `<go/>` is an offer, not a move. This
    applies to the public apartment too.

- **The cabaret's spots are measured** (tool v5 adds a top-edge aim for low and
  wide objects): 5 on `cabaret-stage.glb`, 3 on the light variant (curtain
  unverified).
- **Private's card is sized to its box; only the transcript scrolls (PUI-3).** A
  private room's chips are the venue router's own bar, moved into
  `.nexus-private-action-slot` and never floated over her. The row is
  `calc(100% - 14px)` of the chat history at every width. Heading, chip rail and
  footer are fixed, the transcript may shrink to zero, and End never gives way.
  On phones and short screens the heading and the rail share one line. Do not
  cap the card or the row by viewport height: on phones that cut the chips off
  the sheet's top and End off its bottom. Check a layout change with
  `node tools/qa/private-ui-shots.mjs`, which measures her face, the chips, the
  transcript and End at four sizes. Evidence:
  `docs/qa/PRIVATE_PREMIUM_UI_VISUAL_QA.md`.
- **These are client checks, not authorization.** Release needs server-side
  enforcement and age assurance; see the security matrix. Tests:
  `tests/private-world/` (unit, 10 deterministic scenarios, the 20-item matrix,
  attach). Evidence: `docs/qa/PRIVATE_WORLD_*.md` and
  `docs/qa/NEXUS_PREMIUM_WORLD_INDUSTRIALIZATION_REPORT.md`.
