# Changelog

Notable changes, newest first. Batches are named as in the code comments and
commit subjects (`CLAUDE.md` ▸ Conventions).

## Living Worlds: one place, moved within, left only by yes (LW1–LW5)

- **The apartment**: a connected flat with a living room, kitchen, bedroom,
  bathroom and balcony, on phones too. Say "andiamo in cucina" and you both move
  there, without the world reloading.
- **Eight measured spots**, each checked so she stands on real floor, out of the
  furniture, and the screen can see her.
- **Another place asks first.** "Andiamo in discoteca?" gets a question; only
  your "sì" takes you there, and she says you've arrived only once you have.
- **Relaxing, a story or focus happen right where you are.** The background no
  longer jumps to a meadow because of a reply.
- **She knows what's really there** (the blanket on the sofa, the dog by the
  record player) and says plainly what she can't do yet: sit, lie down or hand
  you things.

## SonicAgent wakes up instead of failing (SW1)

- When the speech service has been asleep, the app wakes it and waits up to 75
  seconds. Settings shows "Waking the speech service…" instead of "SonicAgent
  could not start".
- SonicAgent's Space is checked four times a day: woken if asleep, restarted if
  it has crashed. The owner can force a restart from GitHub Actions.

## The same companion, reacting to the place (V5 release, PG3)

- Tap, click or point the VR controller at something in a place (the bar, the DJ
  booth, the study desk) and she looks at it and remembers you pointed it out.
- Her smile is a smile now, not an arm-waving clip; glances are real glances.
- She can join in when asked: "let's dance" starts the venue's own dance, and
  "let's stop" stops it — only ever through the place's buttons.
- At Seaside she remembers lighting the lantern together.
- When a reply fails, the chat says why and what to do (pair again, check the
  connection, retry, or pick another model).
- In a playground she responds to what really happened: a smile for Cheers, she
  listens for a story or a quiz, keeps still while a dance clip plays and looks
  back when it stops, and stays quiet through a study block.
- Her model hears one short, verified paragraph about where she is and what she
  actually did — never a gesture that did not play, never Copilot, never a
  private room.
- Everything is checked against its owner (the renderer, the chip catalogue, the
  Private experience's own gate); forged events do nothing.

## Premium places menu and a quieter status bar (PG2, DX3)

- **Every place has a picture.** Thirteen 640×480 renders of the real places,
  drawn the same way (one pose, one three-quarter camera, eyes open, no UI) by
  `tools/vr/render-place-previews.mjs`, replace the cropped screenshots.
- **Places is a card grid**: picture, name, category and one line, two to a row
  on desktop and phone; Private's rooms show their pictures too.
- **The lagoon beach faces the water** (the world was turned 180° about her
  spot; it had faced empty sand).
- **The status bar is just an X.** No name, no dot: one small round button that
  ends the experience (its name and tooltip say what it ends), sharing one row
  with the place's chips.
- **Clean view**: an eye in the corner hides the X, chips, HUD and (by choice)
  the chat; one control or Escape brings them back. Nothing stops.

## V4 release — playgrounds (PG1)

- **Five venues**, each a world plus a template of things to do there: Irish
  pub, Neon discoteca and Creative academy (general, in Experiences ▸ Visit a
  place) and Private cabaret and Private stream studio (private, only in
  Private's rooms, after its own gates). CC0 scenes from 3dassets.dev and the
  Kenney Furniture Kit; provenance in `assets/vr-worlds/PROVENANCE.md`.
- **Every venue loads on a phone**, under the 30 000-triangle budget, through a
  light stand-in with the same title, cut by recipe
  (`tools/vr/playground-subsets.json`, `node tools/vr/subset-scene.mjs`).
- **Venue cards**: a preview picture, a category and one line, in Visit a place
  and in Private's "Or a 3D room". Places without a template are unchanged.
- **Things-to-do chips** while a venue is up — say a line, a shipped dance or
  wave clip, the light, a 25-minute study block, the studio's pretend-show badge
  — under the status bar on desktop, docked above the chat sheet on a phone.
- **Seven light moods**, blended over 0.9 s or cut under reduced motion. No
  strobe and nothing animated.
- **The stream studio is pretend**: it records nothing and sends nothing, says
  so on the card and the badge, and the playground code names no capture or
  network API.
- Not in this release: sitting on a seat, venue music, and any measurement on a
  real phone or headset (checked in headless Chromium only).
