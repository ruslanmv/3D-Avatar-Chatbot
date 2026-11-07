# Premium interaction contracts

The shapes a premium location is made from, each marked:

- **EXISTS**: a validator and a consuming runtime are both in the tree, with
  tests
- **PARTIAL**: in use, with a named gap
- **PROPOSED**: written down only; nothing reads it, so nothing may depend on
  it

The rule from the mission holds here: no format is added without its
validator and the runtime that consumes it. Everything EXISTS below has both.

## 1. Experience config: EXISTS

`assets/vr-worlds/private/<id>.json`, read by `PrivateWorldAdapter.attach()`.
Validated by `PrivateWorldAdapter.validateConfig(raw, { worlds, preset,
template })`; the template is `docs/engine/templates/private-world.example.json`.

| Field           | Rule                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `schemaVersion` | `1`                                                                     |
| `id`            | `[a-z0-9-]`                                                             |
| `title`         | `{ en, it }`, ≤ 80 characters each                                      |
| `worlds`        | ids of catalogue worlds rated `private`; any other world refuses        |
| `template`      | a venue template rated `private`                                        |
| `tone`          | `{ en, it }`, one sentence, ≤ 240 characters                            |
| `interactions`  | at least one, below (the prompt offer names at most 12)                 |

Unknown fields refuse the **whole** config, at the top level and inside an
interaction. That is what stops a config from carrying a rating, a URL, a
script or a permission. Strings are stripped of `<>{}[]` and backticks.
Validation never changes a world's rating.

## 2. Interaction: EXISTS (four kinds), PARTIAL (`go`)

`{ id, kind, label{en,it}, words{en,it}, preset | chip | anchor | spot }`.

| kind        | Target                                   | Checked at validation               | Owner at run time                     |
| ----------- | ---------------------------------------- | ----------------------------------- | ------------------------------------- |
| `light`     | `preset` (or `null`: the room's light)   | the preset exists                   | `runtime.setMood` → `true`            |
| `chip`      | `chip`                                   | the template has that `clip` chip   | the venue router + its `started` report |
| `chip-stop` | `chip`                                   | same                                | its `stopped` report                  |
| `look`      | `anchor`                                 | the template lists that anchor      | `BehaviorRouter` → `applied: 'behavior'` |
| `go`        | `spot`                                   | **only the id's shape** (PARTIAL)   | `WorldPresence.go` → renderer `spotId` |

The `go` gap: a spot is checked against the measured file only when it runs,
where an unknown or unverified spot answers `unknown-spot` and nothing moves.
Spots are reachable by the person's own words through presence anyway, so the
shipped config has no `go` interactions.

## 3. Gate answers: EXISTS

`evaluateGate({ deployment, attested, privateOpen, world, avatarAdult })` →
`{ ok, why }`. Each value must be exactly `true`. The order of reasons is fixed
(`PRIVATE_WORLD_ENGINE.md` §2). The page supplies each answer from its owner in
`attach()`; nothing else may.

## 4. Deployment switch: EXISTS

`window.NEXUS_PRIVATE_WORLD_CONFIG = { enabled: true, eligibility:
'server-attested' }`, set by the site before the app loads. Absent, or any
other shape, means off. There is no Settings control and no localStorage key
for it, on purpose: a person cannot turn it on for themselves.

## 5. Avatar declaration: EXISTS

`AvatarAdultDeclaration.decide(identity, published, same)` is pure, and
`check(g)` is its async page form. Its inputs are:

- `AvatarIdentity.resolve` of the avatar on screen
- Forge's `GET /v1/library` avatars
- `matchesPublished`

The answer is `{ ok, why }`, where `why` is a sentence for the person.

## 6. Offer tags: EXISTS

`<act id="…"/>`, at most one per reply, stripped at both `displayText` seams.
In the prompt, the offer must match `PromptContext.ACT_OFFER` exactly. A tag is
an offer, never an action.

## 7. Events: EXISTS

| Event                    | Emitted by           | Detail                                           |
| ------------------------ | -------------------- | ------------------------------------------------ |
| `nexus-private-world`    | the adapter          | `{ kind: confirmed / failed / revoked, act, why }` |
| `nexus-presence`         | WorldPresence        | `moving` / `moved` (the room's instance too)     |
| `nexus-playground-action`| the venue router     | read for `started` / `failed` / `stopped`        |
| `nexus-world-shown`      | the renderer         | read to know the world                           |

Events are information, never permission. A forged `nexus-world-request`
cannot open Private: `privateOpenNow` also needs Intimate, the consent flow and
private mode (matrix 5). A forged `nexus-playground-action` can make the room
believe a dance started. Any script on the page can also call the router
directly, which is why §8 of the engine doc says these are client checks, not
authorization.

## 8. PROPOSED (not built; nothing reads these)

- **One config per world.** `attach()` loads one file today.
- **Per-world audio** (an ambience loop per spot). The scene loops named by
  manifests are not in the repository (CLAUDE.md, MV1 correction).
- **Seat-aligned poses and hand-held props**, as interaction kinds `sit` and
  `hold`. These need an animation and an IK target that exist, and a renderer
  confirmation.
- **A signed attestation**, verified by the client, instead of the
  `blackboard.adultVerified` boolean. The real fix is server-side enforcement;
  see the release readiness doc.
