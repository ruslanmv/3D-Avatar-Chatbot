# Private World engine

A premium room inside the existing Private experience: a measured place, what
she can really do there, and a gate that fails closed. The first one is the
**Private Sanctuary**: the private cabaret, with two lights, a dance, a look at
the stage and five measured spots.

**Status: implemented, and off in every build.** It opens only on a deployment
that sets `NEXUS_PRIVATE_WORLD_CONFIG = { enabled: true, eligibility:
'server-attested' }`, with a server attestation on the session. No build in
this repository does either. `docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md` says
what is missing before anyone should.

## 1. What it is, and what it is not

It **is** a narrow adapter (`src/experiences/private/PrivateWorldAdapter.js`,
`window.NEXUS_PRIVATE_WORLD`) that sits inside Intimate, Private's activity. It
adds three things:

- a place she is in
- things that can happen there
- one paragraph in Private's own prompt that says both

It is **not** a second Private. It owns no consent, no level, no ceiling and no
adult check of its own. Every one of those stays with its existing owner, and
the adapter asks them, at every step:

| Question                                 | Owner                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Is this deployment allowed to offer it?  | the site's `NEXUS_PRIVATE_WORLD_CONFIG` (absent: no)                  |
| Is the person attested adult?            | the server, via `SessionAdapter` → `blackboard.adultVerified`         |
| Is Private really open?                  | `PlaygroundReactiveContext.privateOpenNow`                            |
| Is this one of this experience's worlds? | the renderer's `vrWorlds.activeId` + the catalogue's `rating`         |
| Is the avatar declared adult?            | Wardrobe Forge's operator, via `AvatarAdultDeclaration`               |
| What level and ceiling apply?            | ConsentFlow and Intimate's preset, unchanged                          |

`privateOpenNow` itself requires four things: Intimate active, the consent flow
active, private mode on, and the renderer's world request owned by `intimate`.

## 2. The gate

`evaluateGate(answers)` is pure. Each answer must be exactly `true`; anything
else (`'true'`, `1`, `undefined`, a throw) is a no, with a reason:

```
disabled-in-this-build → no-server-attestation → private-experience-not-active
  → not-this-experience-world → avatar-not-declared-adult → open
```

It is asked again by every `act`, `observeUser`, `consumeReply` and
`promptSuffix`. When it closes after having been open, the room is **revoked**:

- the light goes back (`setMood(null, { instant: true })`)
- a dance is stopped through the venue router
- presence forgets where you are
- `nexus-private-world { kind: 'revoked' }` is emitted once, even when one exit
  arrives as `adult:exit` and then `private:session-stop`

Revocation also follows:

- the bus events `adult:exit` and `private:session-stop`
- Clear (`ConversationReset.onReset`)
- the companion session ending
- `detach()`

### The avatar question (PW1)

Private mode says the **person** is an adult. Whether the **avatar** depicts
one is a different question with a different owner. Forge's operator declares
it per library avatar (`depictsAdult` in `GET /v1/library`), and Try-On's W10
gate already read it. Intimate's own comment claimed the same gate stood in
front of it, and nothing checked.

`src/features/together/AvatarAdultDeclaration.js` is now the one place that
question is asked. It answers yes only for a built-in library avatar whose
bytes match what Forge publishes and which Forge declares adult. Everything
else is a no, with a sentence:

- an external or custom avatar
- an unreachable Forge
- an avatar Forge does not list
- a declaration of `'true'` (a string)
- anything that throws

A yes is cached for 10 minutes per avatar; a no is never cached.
`Intimate.start()` awaits it and refuses with the sentence. The avatar judged
is the one on screen; a worn Forge look (`blob:`) is judged by the base avatar
the wardrobe snapshotted.

Today the live Forge declares exactly one avatar adult: **VRoid Female**
(`fem-vroid`). Private therefore works only with her until the operator
declares others. That is the intended behaviour, not a bug.

## 3. Interactions

Each interaction has:

- a semantic id
- a verified target (a preset, a chip in the venue template, an anchor in it)
- an owner that does it
- a confirmation from that owner
- a cancel path

It is narrated only after the confirmation.

| id           | kind      | owner                                       | confirmed by                                   | cancel / revoke            |
| ------------ | --------- | ------------------------------------------- | ---------------------------------------------- | -------------------------- |
| `light-warm` | light     | `runtime.setMood` (preset romantic-evening) | `setMood` returns `true`                       | `light-own`; revoke resets |
| `light-gold` | light     | `runtime.setMood` (preset cabaret-gold)     | same                                           | same                       |
| `light-own`  | light     | `runtime.setMood(null)`                     | same                                           | —                          |
| `dance`      | chip      | the venue router (`__NEXUS_PLAYGROUND_LIVE.act`) | its `nexus-playground-action` `started` / `failed` | `stop-dance`; revoke stops |
| `stop-dance` | chip-stop | the venue router                            | its `stopped` report                           | —                          |
| `look-stage` | look      | `BehaviorRouter.request('look_at_object')`  | `applied === 'behavior'`                       | the gaze override expires  |
| spot moves   | go        | `WorldPresence.go` → `runtime.goToSpot`     | the renderer's `spotId` equals the target      | a failed move keeps the old spot |

While an owner has not answered, the prompt says "Happening now: … do not say
it is done". An answer that comes back after a revoke, or in another world, is
**stale**: it is dropped and never narrated (matrix 8).

**Not implemented, and never claimed:**

- sitting, lying down
- holding or handing an object
- opening doors
- touching

The presence paragraph says so in the prompt, and the light clause is dropped
only because this room really offers its lights (`lightsOffered`).

## 4. Turns, offers and tags

The person's words act directly (`actIntentOf`: the interaction's own
`words.en` / `words.it`). Her reply may end with one `<act id="…"/>`. That tag
is **only an offer**: it is stripped at both `displayText` seams, and the
person's next-turn yes runs it. Anything else drops it; so does a yes two turns
later.

- Her own "sì" is not a yes.
- A tag the person types runs nothing.
- An unknown id is stripped and ignored.

**Where the person's turn comes from (PW5).** A Private session keeps its
turns in its own card (`PrivateConversationView`'s store), never in
`window.chatHistory`, so nothing of it is persisted. The room reads the latest
user turn from the **active conversation surface** (`observeSurface`), first
thing when Private's prompt is built, so the request has already run, or is in
flight, when the room is described. Words said in Private never reach the
companion's context classifier, which reads `chatHistory` only.

## 5. Where the room reaches the model

Only through Private's own prompt owner. `TogetherCapability` asks
`NEXUS_PRIVATE_WORLD.promptChunk()` only after
`privateSystemPromptSuffix()` came back non-empty, and it does so on both of
Private's paths:

- the system suffix
- the remote-persona overlay (`experienceOverlay`)

The companion prompt (`src/companion/PromptContext.js`) carries no private
field for any destination. `ACT_OFFER` is exported there only to check the
offer's exact shape.

The paragraph is spatial and non-explicit. It contains:

- where you are, and what is really there (the measured spot's `sees`)
- the other spots
- what can happen, and what just happened (confirmed or not)
- the experience's tone
- the exact `<act/>` and `<go spot/>` offers

## 6. Space

The cabaret's spots are measured by `tools/vr/measure-spots.mjs` (v5) from the
real GLBs and checked against their SHA-256:

- `assets/vr-worlds/spots/cabaret-stage.json`: 5 verified
- `assets/vr-worlds/spots/cabaret-stage-light.json`: 3 verified, curtain
  unverified

The tables are in `NEXUS_SPATIAL_COORDINATES.md` §6.

The room's presence is a second `WorldPresence` instance with `privateGate`.
That instance refuses every non-private world, and private ones unless the
gate is true at each step. Its `destinations` are empty: **there is no travel
out of a private room**. Leaving is the person's End. The public instance is
unchanged and still refuses every private world.

## 7. Files

| File                                                   | Role                                    |
| ------------------------------------------------------ | --------------------------------------- |
| `src/experiences/private/PrivateWorldAdapter.js`       | gate, interactions, prompt, attach      |
| `assets/vr-worlds/private/private-sanctuary.json`      | the experience config (data, validated) |
| `src/features/together/AvatarAdultDeclaration.js`      | "is this avatar declared adult?"        |
| `src/companion/WorldPresence.js`                       | `privateGate`, `lightsOffered`          |
| `src/features/together/TogetherCapability.js`          | `privateRoomChunk` in Private's prompt  |
| `src/companion/index.js`                               | `attach`, `consume`, `noticeRoomTurn`   |
| `tests/private-world/`                                 | unit, scenarios, matrix, attach         |

Boot order (`src/behavior/boot.js`): after `PlaygroundReactiveContext.js`,
then `AvatarAdultDeclaration.js`, `WorldPresence.js`,
`PrivateWorldAdapter.js`, `src/companion/index.js`.

## 8. Known limits

These are client-side checks. They are defence in depth, not authorization.
Anything on the page can set `blackboard.adultVerified` or dispatch an event;
a production adult service must enforce eligibility **on the server** for
every model request and every private asset it serves.
`docs/qa/PRIVATE_WORLD_SECURITY_MATRIX.md` lists what is and is not covered,
and `docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md` lists the blockers.
