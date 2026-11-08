# Tutorial C — a forest adventure

**What exists:**

- `oak-glade`: desktop and VR, 46,091 triangles, the scene
  `scenes/oak-glade.glb` (CC0, 3dassets.dev), activity `forest`
- `under-the-trees`: 24,370 triangles, a **prop world**: 14 kit props over a
  Poly Haven panorama, with no scene file
- travel: "andiamo nella foresta" → proposal → the person's yes → `oak-glade`
  on desktop, `under-the-trees` on a phone (`WorldPresence.destinationsFor`,
  tested)

**What does not exist:**

- forest spots
- discoveries
- a forest story

## 1. Spots in the glade (desktop and VR)

1. Dump `scenes/oak-glade.glb`'s top-level names. Choose 3–5 meaningful
   things: the fallen trunk, a clearing, a big oak.
2. Author them in `tools/vr/spot-targets.json` under `scenes/oak-glade.glb`.
3. Run `node tools/vr/measure-spots.mjs scenes/oak-glade.glb`.

Outdoors, the floor vote may find several heights (roots, slopes). Read
`floorY`, and expect the ±0.06 m floor tolerance to reject sloped ground
honestly. **Warning from VW2:** a spot beside a fallen trunk looked clear from
above and was not; trust the raycast, not your eye.

## 2. The phone forest is a prop world (future tooling)

`measure-spots.mjs` measures scene GLBs only. `under-the-trees` places 14 props
in the *place frame* (`props[].at`), so its geometry exists only when assembled.

**To measure it**, extend the tool to assemble a prop world the way
`VRWorlds.buildPlace` does: the same sizing by `height`/`width` and the same
centring (`placementOffset`). Then measure in the place frame and record
`coordinateSpace: "place"`. **Proposed.** Until then the phone forest has no
spots, and she does not offer any there.

## 3. An interactive discovery

**Today's working pattern is Seaside.** It has two objects (shell, lantern),
`ExperienceDirector.interact(id)` → `interaction:completed`, and flags that
change later lines (`src/experiences/seaside/story.js`).

For the forest:

1. **Write the story module** (**proposed**): `src/experiences/forest/story.js`. It is pure: beats `arrive` → `found-feather` /
   `followed-path` → `close`, and flags `featherFound` and `pathTaken`.
2. **Add an anchor** for the discovery object at a **measured** position
   (the trunk), so the picker and gaze can target it.
3. **Register it** with `ExperienceDirector` like Seaside, with world
   mapping `activities: ["forest"]` (it exists).
4. **Consequences** use owners only:
   - `presence.go('<spot>')` to stand by the trunk
   - a gaze at the anchor
   - a light mood
   - the flag

Narration reads the flags. She never says she picked up the feather; *the
person* finds it, which is a click on the anchor and a confirmed
`interaction:completed`.

## 4. Branching

- **Choice A:** "Follow the path". Effect: `goSpot: 'clearing'`. The next
  beat requires the spot `clearing`.
- **Choice B:** "Rest by the oak". Effect: mood `relax`. The next beat is
  `rest`.

The template is in `docs/engine/templates/story.branching.example.json`
(proposed shape).

## 5. Transitions

- **Into the forest:** always a confirmed proposal (implemented).
- **Out:** End (X), or "torniamo a casa" → a proposal to `apartment` →
  yes. `apartment` is in `DESTINATIONS`, with words "home" and "casa".

## 6. Test

1. **Story module:** unit tests for beats and flags, as for Seaside.
2. **Spots:** run `tests/living-worlds` after measuring.
3. **Real app:**
   - travel from the apartment with a "sì"
   - confirm `activeId` is `oak-glade` (desktop) or `under-the-trees`
     (phone)
   - click the anchor and confirm `interaction:completed`
   - check that her next line references the confirmed discovery only
