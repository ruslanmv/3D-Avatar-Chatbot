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

## 11. End-to-end funnel run (PX8, 2026-11-13)

A person's path through the real UI — Together ▸ Private ▸ style ▸ atmosphere ▸ preparing ▸
Begin ▸ eight turns with a real model (OllaBridge `free-best`, Italian) ▸ two steps closer with the
footer control ▸ End ▸ "Another private moment" — on desktop (1366×860) and a phone (iPhone 13
emulation). Harness: real clicks and typing into the composer; no API key for music search.

| Measure | Desktop | Phone |
| --- | --- | --- |
| Taps from the Private tile to her first line | 5 | 5 |
| Of which "preparing" | 7–9 s | 9 s |
| First line after choosing a style | ≈ 14 s | ≈ 15 s |
| Reply time per turn | 4–8 s | 5–13 s |
| Page errors | 0 | 0 |

Found and fixed (PX8):

1. **She said "I'm putting on Daft Punk" and then nothing played** (no music search connected).
   The providers are now asked when the evening starts, so the failure is known before her reply;
   a failure that arrives after her reply gets one short line in her voice, in the app language.
2. **She described music that was not playing** ("I feel the rhythm"). Her prompt now states
   when no music is playing.
3. **"Another private moment" went back to the Together menu.** It now reopens Private's setup,
   where "Continue like last time" is one tap.
4. **The finished card kept the music line and the outfit chip.** Cleared when End is pressed.
5. **"Last time: Intense" on an Italian screen.** The summary names the style in the app language.
6. **On a phone the music notice and the outfit chip took the rows her replies needed** — a card
   with no conversation visible. The notice now goes after 7 s, "Wearing X · Undo" after 8 s (an
   offer waiting for a yes stays), and both are compact on small screens.

Not changed, and needs a decision: **a person who has never switched Private Mode on does not see
Private at all** — the tile is hidden until Settings has it on. That is the current, deliberate
rule; showing a locked "🔐 Private · 18+" tile that explains how to turn it on would be the usual
way to make it discoverable.

## 12. Music works the way Together's does (PX9–PX10, 2026-11-13)

- **Same search as Together.** Private asked the search provider directly, so a deployment
  without a search key had no music in Private while Together's Music played. It now calls
  `MediaIntent.search` — the connected provider (a visitor's key or the deployment's
  `/api/yt/search`) and, with neither, the keyless sample song. No key is required.
- **Honest about the sample.** When only the sample can play and they named something else, her
  prompt says so, and a reply already written ("putting on Daft Punk") gets one short line in the
  app language ("Quella qui non la trovo, allora ho messo questa per noi.").
- **More requests recognised** (a real Italian session): fillers before the verb ("Grazie,
  suona…", "Allora metti…", a typed "Poi" for "Puoi"); genres as music words ("mettimi qualcosa
  di jazz"); wishes ("vorrei ascoltare…"); an artist after "metti" ("Ora metti i Coldplay");
  and waiting ("Aspetto il brano", "e la musica?") asks again for the last request unless
  something is already playing.
- **Low volume (PX11).** Every Private soundtrack — asked for during the evening or chosen at
  setup — plays at 10 %, so her voice is always clear; "slow down" takes it to 6.

## 13. Several outfits in one evening (PX14–PX15, 2026-11-13)

Verified in a real browser with the real model (Italian): five outfit changes in one Private session — elegant → comfortable → yellow → back → "Cambia vestito" — each reaching the avatar, Private staying the running session.

Fixed:

- **Requests the parser missed:** the typo "indossaare", underwear words, "togliti / spogliati / quítate / take off".
- **False claims:** her prompt says what she wears changes only when the app changes it; a reply that still claims a change that did not happen has that sentence replaced by one true line in the app language (no extra model call).
- **An underwear request worn as an ordinary look** ("Ponte el sujetador negro" → crop top): the private gate is checked first, and a lingerie request only ever matches lingerie.
- **English silence lines in Italian sessions:** localized for all nine languages; none spoken in a language without lines.

### Garments understood (English · Italian · Spanish)

Each line maps every word to one English name, the vocabulary looks are named in. Source: `GARMENTS` in `src/experiences/private/PrivateActionIntent.js`.

**Lingerie and underwear (private outfits: only behind the adult-avatar gate)**

| Garment | Words |
| --- | --- |
| lingerie set | lingerie set, lingerie, underwear set, completo intimo, completino intimo, biancheria intima, intimo, conjunto de lencería, lencería, ropa interior |
| bra | push-up bra, bralette, brassiere, bra, reggiseno, reggiseni, sujetador, sostén, brasier |
| panties | g-string, thong, knickers, panties, briefs, mutandine, mutande, slip, tanga, perizoma, bragas, braguitas, culotte, culotes |
| corset | corset, bustier, basque, corsetto, bustino, corsé, corpiño |
| bodysuit | lace bodysuit, bodysuit, teddy, body di pizzo, body de encaje, body |
| babydoll | baby doll, baby-doll, babydoll |
| garter belt | suspender belt, garter belt, garters, reggicalze, liguero, ligas |
| negligee | negligee, négligé, chemise, sottoveste, combinación, picardías, salto de cama |

**Hosiery**

| Garment | Words |
| --- | --- |
| fishnets | fishnet stockings, fishnets, calze a rete, medias de red, medias de rejilla |
| stockings | thigh-highs, hold-ups, stockings, calze autoreggenti, autoreggenti, calze, medias de liga, medias |
| tights | pantyhose, tights, collant, collants, pantis, panties de nylon |

**Night and lounge**

| Garment | Words |
| --- | --- |
| nightdress | nightdress, nightgown, camicia da notte, camisón |
| robe | dressing gown, bathrobe, robe, kimono, vestaglia, accappatoio, bata, albornoz |
| pyjamas | pyjamas, pajamas, pigiama, pijama |

**Swim**

| Garment | Words |
| --- | --- |
| bikini | bikini |
| swimsuit | one-piece swimsuit, swimsuit, bathing suit, costume da bagno, costume intero, bañador, traje de baño |

**Dresses**

| Garment | Words |
| --- | --- |
| slip dress | slip dress, abito sottoveste, vestito sottoveste, vestido lencero |
| evening gown | evening gown, ball gown, gown, abito da sera, vestito da sera, vestido de noche, vestido de gala |
| cocktail dress | cocktail dress, little black dress, abito da cocktail, tubino nero, tubino, vestido de cóctel |
| bodycon dress | bodycon dress, bodycon, abito aderente, vestito aderente, vestido ajustado, vestido ceñido |
| mini dress | mini dress, minidress, minivestito, vestitino, vestido corto, minivestido |
| sundress | sundress, abito estivo, vestito estivo, prendisole, vestido de verano |
| dress | dress, vestito, abito, vestido |

**Tops**

| Garment | Words |
| --- | --- |
| crop top | crop top, top corto, top cropped, top |
| tank top | tank top, camisole, cami, canotta, canottiera, camiseta de tirantes, camisola |
| blouse | sheer blouse, blouse, camicetta, blusa |
| shirt | shirt, camicia, camisa |
| tee | t-shirt, tshirt, tee, maglietta, camiseta |
| sweater | sweater, jumper, cardigan, maglione, golfino, jersey, suéter, chaqueta de punto |
| hoodie | hoodie, sweatshirt, felpa, sudadera |

**Bottoms**

| Garment | Words |
| --- | --- |
| miniskirt | miniskirt, mini skirt, minigonna, minifalda |
| pencil skirt | pencil skirt, gonna a tubino, falda lápiz, falda de tubo |
| skirt | skirt, gonna, gonnellina, falda |
| jeans | jeans, denim, vaqueros, tejanos |
| shorts | hot pants, shorts, pantaloncini, calzoncini, pantalones cortos, short |
| leggings | leggings, leggins, mallas |
| trousers | trousers, pants, pantaloni, pantalones |

**Shoes**

| Garment | Words |
| --- | --- |
| heels | high heels, stilettos, heels, pumps, tacchi a spillo, tacchi, décolleté, tacones, zapatos de tacón |
| boots | thigh-high boots, ankle boots, boots, stivali, stivaletti, botas, botines |

**Outerwear**

| Garment | Words |
| --- | --- |
| jacket | leather jacket, jacket, blazer, giacca, giubbotto, chaqueta, americana |
| coat | trench coat, coat, cappotto, abrigo, gabardina |

