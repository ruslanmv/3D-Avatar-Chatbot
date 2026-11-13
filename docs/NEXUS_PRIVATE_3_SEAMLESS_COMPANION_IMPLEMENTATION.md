# NEXUS Private 3.0 — Seamless Living Companion: implementation report

Batch prefix **PX** (PX1–PX7). Branch `feat/living-worlds-spatial-storytelling`. Written
2026-11-13, against the tree at the commit that adds this file.

One avatar, one conversation: music, outfit changes and dancing asked for inside a Private
session now happen inside it. Nothing here starts or stops an activity, publishes into the
ordinary chat, or reads or moves the consent level.

## 1. Release-readiness, first

**Not production-ready yet.** The code is complete and its automated gate passes, but three
things were not verified and are needed before release:

| What | State |
| --- | --- |
| Real music search (YouTube Data API) inside Private | **Not verified.** No API key is configured in the development container, so the provider reports `no-provider`. Verified instead with a stand-in search result in a real browser (§7). |
| Audible playback | **Not verified.** Headless Chromium refuses autoplay; the app showed that honestly as `blocked` with one Play control. A real browser with a person's tap is needed to hear it. |
| Outfit *generation* through Wardrobe Forge inside Private | **Not verified live.** Changing into saved looks was verified in a real browser. Making a new look is covered by tests with a stand-in generator only. |
| Phone, Quest/VR, AR | **Not tested.** Desktop Chromium only. |
| A real model's replies with the new prompt lines | **Not measured.** The action path was driven directly; no LLM was connected in the browser runs. |

Automated gate: `npm run validate` exits 0 — **6260 tests in 287 suites**. Parity harness OK
(re-recorded once: a line-number shift in `src/main.js`, no new reference). Lab checks up to date.

## 2. The two reported bugs, and their causes

**A. "Sì, suona Daft Punk ora." played nothing.** Two causes. The pattern matcher that turns a
typed request into playback (`YouTubeAsk`) knows English verbs and wants a media noun; and inside
Private the model is deliberately not told it can play anything, because a model that mentioned a
song used to replace the evening's soundtrack and post a YouTube card into the public transcript
(`PlayDirective.privateActive`). A request nobody recognised was answered with small talk. A
third, latent path made it worse: an English "play some jazz music" typed in Private *was*
intercepted by `YouTubeAsk` and answered in the ordinary chat.

**B. "Mettiti un vestito elegante." opened Try-On Haul.** `WardrobeTool.call` has one executor,
`TryOnHaulActivity.request`, whose first line starts the Try-On activity through the Together
panel. Starting an activity ends the one that was running, so Private stopped.

## 3. Architecture

```
their words ──► PrivateActionIntent.parse ─┐
a tag she wrote (PlayDirective,            ├─► PrivateActionBridge.request ─► PrivateActionPolicy
  WardrobeTool) ───────────────────────────┤                                      │ allow
a tap on the strip ────────────────────────┘                                      ▼
                                     PrivateMediaController · InSceneWardrobe · NEXUS_MOTION
```

All new modules are IIFEs with the dual export, in `src/experiences/private/`, loaded by
`src/behavior/boot.js` (no change to `index.html`, so the parity harness's script count is
unchanged).

| Module | What it is |
| --- | --- |
| `PrivateActionIntent.js` (PX1) | Pure. One message → at most one action, in the nine app languages. Talk about music or clothes is talk; a bare "stop" is never the music. |
| `PrivateActionPolicy.js` (PX2) | Pure. The allowlist (12 actions), parameter schemas, and who may authorize what. Holds the outfit autonomy setting. |
| `PrivateMediaController.js` (PX3) | Search → play in Private's own strip; status from `MediaSession`; pause/resume/stop on the one player. |
| `OutfitDecisionEngine.js` (PX4) | Pure. Chooses a look from what she has: named → matches style/colour → her choice → a dictionary set that must be made. |
| `InSceneWardrobe.js` (PX5) | `TryOnSession` + `WardrobeController` + `TryOnGenerator` + `loadLooks` without the haul's view. Never calls `startActivity`. |
| `PrivateActionBridge.js` (PX6) | The one door. Session and turn binding, one action per family per turn, stale-result rejection, and the facts her prompt is given. |
| `ReplyClean.maskStreaming` (PX7) | Reasoning and directive tags hidden — and withheld from a streamed voice — while a reply is still arriving. |

### The action contract

Every action record carries: `id`, `sessionId`, `turnId`, `name`, `params` (validated),
`source` (`user` · `user-approved` · `control` · `model`), `locale`, `status`
(`pending` → `completed` · `blocked` · `failed`) and `why`.

Allowlisted names: `music.search`, `music.play`, `music.pause`, `music.resume`, `music.stop`,
`wardrobe.wear`, `wardrobe.change`, `wardrobe.create`, `wardrobe.undo`, `avatar.dance`,
`avatar.react`, `scene.change`.

### Decisions worth knowing

1. **Recognition runs on the person's words, not only on the model.** The parser hears the
   request before the model is called; the action is already in progress when the prompt for that
   turn is built, so she is told what is actually happening ("the app is finding it now — do not
   say it is playing yet").
2. **Permission is separate from intent.** A tag the model writes runs only if the person asked
   for that kind of thing in the same turn. This is what keeps "she mentioned a song, so a song
   started" from coming back, without refusing the person as well.
3. **The Private suppression in `PlayDirective` was not removed.** It was preceded: while a
   Private session runs, a `<play>` tag goes to the bridge and nothing reaches
   `ConversationPublisher`. Outside Private the file behaves exactly as before.
4. **Status belongs to the player.** A play request stays `pending` until `MediaSession` reports
   `playing` (raised by the YouTube adapter). A browser that refuses autoplay is `blocked`, with
   one control that starts it from the person's own tap.
5. **The controller remains the only avatar swapper.** `InSceneWardrobe` goes through
   `TryOnSession` → `WardrobeController.applyLook`, which holds the camera across the swap and
   keeps the snapshot. A load that fails leaves her as she was.
6. **Leaving Private puts her own outfit back.** Snapshot-and-restore, per the house rule; a
   private-rated look never follows her into ordinary chat.
7. **No layered-garment system was built.** The proven whole-model swap is reused. A mesh-level
   garment swap would be faster and seamless but would mean changing VRM loading; not attempted.

## 4. Outfit autonomy

Setting `nexus_private_wardrobe_autonomy`, chosen on Private's setup screen ("Her outfits"):

| Level | Her own idea (a tag nobody asked for) |
| --- | --- |
| `off` — Only when I ask | Nothing changes, nothing is offered. |
| `suggest` — She suggests (**default**) | Offered inline: "Wear 'Yellow sundress'?" Yes / Not now. |
| `autonomous` — She chooses | A **saved** look is worn. |

At every level: a request in the person's own words is honoured ("Scegli tu cosa indossare" is
permission for that one change, not a standing one), and **making a new outfit always needs the
person's yes** — it is offered first, because it takes about a minute and may cost. A deployment
that wants direct requests to generate without the question sets
`localStorage nexus_private_wardrobe_generate = 'allow'`.

## 5. What was kept exactly as it was

- Private is still silent on entry; music starts only when asked.
- Consent: no action reads or moves the level or the ceiling (a test holds both still across
  music, outfits and dancing). `ConsentFlow` remains the only owner.
- "stop", "cozy" and care mode are decided before the bridge runs. In care mode only pausing or
  stopping music is allowed.
- Adult outfits follow the existing gate: private-rated sets and looks exist only when
  `TryOnPrivate.evaluate` answers `open` (private mode on **and** Forge's operator declares the
  avatar adult). Asked for otherwise, the refusal says so.
- Try-On Haul is untouched and remains its own, explicitly chosen experience.
- Ordinary chat, outside Private: unchanged. The bridge reports `not-in-private` and the
  directives take their usual paths.

## 6. Files changed

New: the six modules above, `tests/behavior/private-actions.test.js` (74 tests), this document.

Changed:

- `src/features/together/TogetherCapability.js` — session begins/ends the bridge, hands it each
  user turn last (after exit, slow-down and care), adds the bridge's lines to Private's prompt.
- `src/features/together/PlayDirective.js`, `src/wardrobe/WardrobeTool.js` — route through the
  bridge while Private runs; the wardrobe's haul instructions are withheld from her prompt there.
- `src/features/youtube/YouTubeAsk.js` — does not intercept a message typed in Private.
- `src/features/together/ui/PrivateConversationView.js` — `showActions`, `clearSoundtrack`; the
  outfit chip shares the soundtrack's slot and survives a new song.
- `src/features/together/ui/TogetherPanel.js` — the "Her outfits" control on the setup screen.
- `src/features/together/PrivateLocale.js` — 27 new strings in each of the nine languages.
- `src/features/chat/ReplyClean.js`, `src/main.js` — `maskStreaming` for the bubble and the
  streamed voice.
- `src/behavior/boot.js` — the six new entries.
- `tests/behavior/baseline/boot-baseline.json` — re-recorded (one line number).

## 7. What was verified, and how

**Automated (jsdom), against the real session, view, ConsentFlow, MediaSession and
TryOnSession** — only the search provider, the YouTube embed, the avatar controller and Forge are
stand-ins:

- Music: the Italian command; "Play music."; talk does not start music; pause/resume/stop;
  blocked autoplay and the one control; one strip and one player after a second request; nothing
  published to the ordinary chat; no provider / nothing found said plainly.
- Wardrobe: change while Private stays the running session; Try-On never started; SUGGEST offers
  and waits; single-turn permission for "Scegli tu"; Undo; Forge unavailable; failed load keeps
  her as she was; a late result after Private ended is taken off and its action is `stale`.
- Safety: adult outfit refused for an avatar not declared adult; level and ceiling unmoved; "stop"
  still ends Private; care mode; nothing happens outside Private.
- Conversation: one Private transcript across the actions; no rows in the ordinary chat.
- Streaming: a thought or a directive tag never appears at any point of its arrival, and a
  streamed voice is only given text that will be kept.

**Real browser (headless Chromium, Italian, desktop), no model connected:**

- "Che musica ti piace?" → nothing starts.
- "Sì, suona Daft Punk ora." → search called with `Daft Punk`; one strip in the Private row with
  a real YouTube iframe; state `loading`, then `blocked` ("Tocca ▶ per avviare la musica") because
  headless Chromium does not autoplay. The search result was a stand-in (no API key here).
- "suona i Queen" → replaced: still one strip, one iframe.
- "ferma la musica" → stopped.
- "Mettiti un vestito elegante." → she changed into "Black Cocktail Dress" in place; the Together
  panel still showed Private as the active activity; Try-On was never opened; consent level
  unchanged.
- "Cambia vestito." / "Torna al vestito di prima." / "Balliamo" → completed.
- Ending Private → her original avatar restored. No page errors.

## 8. Remaining limitations

- **"stop the music" in English still ends Private.** The exit word is matched anywhere in a
  message (`PrivateTurnDirector.END`), and that rule was left alone on purpose. "pause", "turn off
  the music", "ferma la musica" and the strip's button all work.
- **`scene.change`** is in the contract and the policy (the person's words only) but has no
  parser; the existing `<ambience>` directive remains the way a scene changes in Private.
- **A soundtrack chosen at setup** keeps its original strip without the new play/pause control;
  the control appears for music asked for during the evening.
- **Rhythmic movement to the music** was not added. Dancing happens when asked ("Balliamo"),
  through the existing motion fast path; nothing sways automatically because audio exists.
- **Outfit matching is by words** in a look's name and tags. A look with an uninformative name
  will not be found by style.
- **The other languages' request patterns** (es, fr, de, pt, ja, ko, zh) and the 27 new strings
  were written here and need a native speaker's review; Italian and English are exercised by the
  tests most heavily.
- **The model can still decline to act** on phrasings the parser does not know; her tag then runs
  only if the turn was plainly about music (a statement, not a question).

## 9. Run and verify locally

```bash
npm ci
npx jest tests/behavior/private-actions.test.js
npm run validate
npm start
```

Then in the app: turn Private Mode on (Settings), open Together ▸ Private, choose a style, and on
the second setup screen pick a "Her outfits" level. In the session try, in any app language:
"play some jazz" · "pause" · "put on something elegant" · "you choose" · "go back to the previous
one" · "let's dance". For music a YouTube Data API key must be set (Settings ▸ Discovery); without
one the strip says so.

In the console, `NEXUS_PRIVATE_ACTIONS.log()` lists every action with its source, status and
reason, and `NEXUS_PRIVATE_ACTIONS.snapshot()` shows what the strip is drawing.

## 10. Configuration and migration

No migration. Two optional `localStorage` keys, both the person's:

| Key | Values | Default |
| --- | --- | --- |
| `nexus_private_wardrobe_autonomy` | `off` · `suggest` · `autonomous` | `suggest` |
| `nexus_private_wardrobe_generate` | `ask` · `allow` | `ask` |
