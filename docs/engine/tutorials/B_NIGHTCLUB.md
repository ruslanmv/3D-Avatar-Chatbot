# Tutorial B — extending the nightclub

**What exists:**

- the world `neon-discoteca` (desktop, 138,814 triangles,
  `scenes/club-main-room.glb`)
- its light version `neon-discoteca-light` (mobile and VR, 27,904 triangles,
  `scenes/club-main-room-light.glb`), made by recipe `club-light`
- the venue template in
  `src/experiences/playgrounds/PlaygroundTemplateCatalog.js`
- the reaction profile in `PlaygroundReactiveContext` `PROFILES['neon-discoteca']`
- travel to it from the apartment (`WorldPresence.DESTINATIONS`
  `discoteca`), verified with a real model

**What does not exist:** a spots file for the club, so she cannot move within it
yet.

## 1. Music and dance today (implemented)

- **Chips** (template `actions`):
  - `dance`: `kind: 'clip'`, clip `dance` → `dance/dance_rumba.bvh`, looping,
    with a "⏹ Stop dancing" label
  - `music`: a `say`
  - `wave`
  - `light`: a mood
- **Ownership:** `PROFILES.owns: ['dance']`. While dancing, nothing else is
  requested, and `afterOwn: 'look_at_user'` runs once on stop.
- **Her side:** `<gesture intent="dance"/>` / `"stop_dancing"` run *only*
  through the venue chip (`runChip`). Verified with a real model in PG3.
- **Safe stop:** the chip's stop label, End (X), and leaving the world, which
  clears clip ownership by generation.

## 2. Add a verified dance-floor spot (do this next)

1. Add to `tools/vr/spot-targets.json`. Fill in `near` from the club's node
   dump; don't guess:

   ```json
   "scenes/club-main-room.glb": { "title": {"en":"the club","it":"il club"}, "spots": [
     { "id": "dance-floor", "label": {"en":"on the dance floor","it":"sulla pista"}, "room": "club",
       "near": ["<dance floor node regex>"], "can": ["stand-near","look-at"],
       "sees": {"en":"the LED dance floor and the DJ booth","it":"la pista LED e la console del DJ"}, "rating": "general" },
     { "id": "booth", "label": {"en":"by the booth","it":"vicino al divanetto"}, "room": "club",
       "near": ["<booth node regex>"], "can": ["stand-near","look-at"],
       "sees": {"en":"the seating booth","it":"il divanetto"}, "rating": "general" } ] }
   ```

2. Add the same for `scenes/club-main-room-light.glb`. It is a different
   model, so it gets its own measurement.
3. Run `node tools/vr/measure-spots.mjs scenes/club-main-room.glb` and the
   light version. Accept ✗ results.
4. Add `WorldSpots.WORDS`: `'dance-floor': ['dance floor','pista']`,
   `booth: ['booth','divanetto']`, with a test.
5. **Compose with the dance:**
   - Move to the dance floor first (`presence.go('dance-floor')`), then run
     the dance chip.
   - Never start the dance mid-move: `presence.state().moving` must be null.
   - **Proposed:** a `BehaviorTrigger` `{on:'spot-arrived', when:{spot:'dance-floor'}}`
     that *offers* the Dance chip, highlighting it, rather than starting it.
     Dancing remains the person's choice.

## 3. Conversation

The venue `note` sets the tone ("Playful and energetic, but never loud in
words"). Spots and `sees` give her something true to say. Make sure the club's
`sees` matches the measured nodes.

## 4. Test

```bash
npx jest tests/playgrounds.test.js tests/playground-reactive.test.js tests/playground-pg3.test.js tests/living-worlds
```

**Then a real-app walkthrough:**

1. Enter `place-neon-discoteca`.
2. `presence.observeUser('andiamo sulla pista')`.
3. Check that `vrWorlds.spotId === 'dance-floor'`.
4. Tap Dance, then Stop, and check the router's `nexus-playground-action`
   phases.

**Do the same on a phone profile,** which shows the light model.
