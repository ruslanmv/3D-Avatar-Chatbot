# Together: Playground vs Private

A review of the two flagship Together destinations as they exist in the tree — what they
share, where they diverge, and which of the divergences are design and which are drift.

Everything below was read out of the source, not inferred from the design docs. Where the code
and `docs/PLAYGROUND_SCENE_TALE.md` / `docs/INTIMATE_MODE.md` disagree, the code is described
and the disagreement is named.

---

## 1. The machinery both of them sit on

`TogetherPanel` (`src/features/together/ui/TogetherPanel.js`) is a three-state view, and every
activity in the app passes through it:

```text
chooser  ──choose(id)──▶  setup  ──startActivity(id, input)──▶  running
   ▲                        │                                      │
   └────── close() ─────────┴──────────── stopActivity() ──────────┘
                             (failure view on a refused start)
```

- **chooser** — one tile per registered activity, drawn from `choices()`. Nothing is behind a
  disclosure and nothing is filtered out.
- **setup** — the activity's own question. This is the only view that can ask for a
  permission, and it asks only after something that needs one has been picked.
- **running** — the panel closes; the experience lives in `#chat-history`.

An activity is a plain object with `{ id, title, icon, order, inputs(), availability(), start(),
stop(), status() }`, wrapped by `activities/contract.js`. `STEPS` in `TogetherPanel` supplies the
product copy for the eight capture-shaped activities; anything with its own `ui` overrides it.

Both Playground and Private opt out of the generic setup view, by two different mechanisms:

| | how it takes over `_paintSetup` |
| --- | --- |
| Playground | `installPlaygroundPanelBridge()` monkey-patches `Panel.prototype._paintSetup` and delegates to `activity.paintSetup(panel)` |
| Private | a hard-coded `if (this.pending === 'intimate' && contract)` branch inside `_paintSetup`, calling `_paintPrivateSetup` |

That asymmetry is the first piece of drift. Two activities want a custom setup screen and there
are two different extension points for it, one of which (`activity.ui`, documented in the
panel's own header as "the extension point a ninth one would use") neither of them uses.

---

## 2. Playground — the prepare-then-play shape

Registered by `src/features/together/activities/playground.js` as `{ id: 'playground', title:
'Playground', icon: '✨', order: 45 }`. `availability()` is unconditionally `{ ok: true }` — it is
general-audience and always reachable.

It has exactly one mode today, `scene-tale`, and a **four-state setup** of its own that lives
*inside* the Together panel:

```text
configure ──Create story──▶ preparing ──▶ ready ──Start story──▶ playing ──▶ complete
    ▲                           │           │
    └────────── Cancel ─────────┴── error ──┘
```

`configure` asks three things: the current place (read-only), an optional 180-character idea,
and a soundtrack radio (`Let her choose` / `No music`).

`preparing` is the part worth keeping. `StoryPlanner.prepare()` runs a **single** LLM call that
returns the whole branching plan, validates it against `validateStoryPlan`, falls back to
`fallbackStory()` when the model or the JSON fails, then searches for a soundtrack. It reports
four named steps while it works:

```text
✓ Understanding this place
✓ Writing the story
○ Preparing your choices
○ Finding a soundtrack
```

`ready` shows the story title, `About 5 minutes · 2 choices`, and whether a soundtrack was
found. `Start story` hands `preparedPlan` and `preparedSoundtrack` to `panel.startActivity`,
which closes Together; `StoryPlayer` mounts into `#chat-history` and executes the plan locally,
so a choice never waits on another round trip.

Three presentation layers decorate this from outside, all injected as plain `<script>` tags by
`ConversationPublisher` rather than listed in `boot.js`: `SceneTaleSetupView` (polishes the
configure screen), `SceneTaleArtView` (hero image), `SceneTaleMobileMode` (stage-first phone
layout). `SceneTaleConversationView` patches `StoryPlayer.prototype._mount` so playback lands in
Conversation instead of a fixed overlay.

**Playground's family-safe boundary is real and enforced in code**: `_leavePrivateIfNeeded()`
runs before the player is built, so a Private session is stopped and the base profile restored
before a Playground profile is derived.

---

## 3. Private — the gate-then-perform shape

Registered by the same file, as a *conditional* activity: `installIntimateBridge()` adds and
removes `{ id: 'intimate', title: 'Private', icon: '🔐', order: 85 }` from the panel as the
Settings preference changes.

There are two separate questions, and the code keeps them separate on purpose:

| question | answered by | what it controls |
| --- | --- | --- |
| is the destination *visible*? | `privateTileVisibility(spicy)` → the Settings preference alone | whether the tile exists in the chooser |
| can a session *start*? | `intimateEligibility(director, spicy)` → preference **and** `spicy.isEnabled()` **and** an attached `ConsentFlow` | whether `Begin private moment` can succeed |

Splitting them is right: a tile that vanishes when a background flow has not attached yet reads
as a feature that disappeared, which is exactly the recovery bug the last few commits on this
branch were about.

`_paintPrivateSetup` draws a **single screen**: kicker, lead, current place, three preset cards
(Affectionate / Romantic / Sensual, ceilings 1 / 2 / 3), a soundtrack radio (`Let her choose` /
`Keep current` / `No music`), a ready summary that appears on selection, a safety line, and
`Begin private moment →`.

Selecting a preset never starts anything — it only enables the button. Pressing it calls
`startActivity('intimate', { ...preset, soundtrack })`, which:

1. `_installCeiling(preset.maxLevel)` — redefines `adult.maxLevel` as a getter so the preset caps
   escalation, with the original property descriptor stashed for exact restore.
2. `adult.enter()` — the existing `ConsentFlow`, unchanged.
3. `IntimateExperienceSession` (in `TogetherCapability.js`) mounts `PrivateConversationView`,
   speaks the preset's opening, starts a soundtrack and schedules a fixed five-minute arc:
   mood choice at 45 s, consent check-in at 120 s, middle line at 210 s, closing at 285 s,
   complete at 300 s.

Exit snapshots and restores `blackboard.activity`, `blackboard.escalationLevel` and the active
mode. Ten enter/exit cycles are covered by a test for stack drift.

---

## 4. Side by side

| | **Playground** | **Private** |
| --- | --- | --- |
| Gate | none — always available | Settings preference for visibility, preference + `isEnabled()` + `ConsentFlow` for start |
| Setup | four states over two screens, with progress | one screen |
| Work before start | whole story planned, validated, soundtrack found | none — everything happens after `Begin` |
| Content source | one LLM call, validated, with a written fallback | fixed preset strings, no LLM |
| Length | ~5 min, 2 branching choices | exactly 5 min, fixed beats |
| Agency during | choices change the story | Keep it cozy / End; escalation asked for, never assumed |
| Conversation surface | `SceneTaleConversationView` (cyan) | `PrivateConversationView` (pink) |
| Soundtrack choices | Let her choose / No music | Let her choose / **Keep current** / No music |
| Persistence | written to `HistoryStore` | nothing — the completion card says so |
| Setup extension point | prototype patch on `_paintSetup` | hard-coded branch in `_paintSetup` |
| Decoration layers | 4 injected view modules | none |

The two are **not** the same shape, and mostly should not be: one is a generated story you
watch, the other is a bounded conversation you are inside. But four of those rows are drift
rather than design, and they are the ones worth closing.

---

## 5. What was actually broken, and what this change fixed

### 5.1 The soundtrack line was the uploader's keywords, not the track's name

Both experiences rendered `♫ ${result.title}` — the provider's title, verbatim, into a
single ellipsised line. What shipped on screen:

```text
♫ Relaxing Chill Music – Stress Relief Lounge Music | Background Music
♫ Epic Motivational and Cinematic Inspirational Music | Force - by AShamaluevMusic (Full Album)
```

A YouTube title is a search-engine artefact before it is a name. Because the strip ellipsises,
the keywords are what survives and the name is what gets cut.

**Fixed** by `src/features/together/MediaTitle.js`, which removes the three things that are
reliably not part of the name — production brackets (`(Full Album)`, `[Official Video]`), a
trailing `- by <creator>` attribution, and every segment after the first when the separator is
one people only use to append keywords (`|`, en/em dash, `·`) — and deliberately leaves the
hyphen in `Beethoven - Moonlight Sonata` and the comma in `Clair de Lune, Debussy` alone. The
recovered creator gets its own line; the untouched title stays reachable as a tooltip. It never
returns an empty string.

### 5.2 Private named a track and then played silence

`IntimateExperienceSession._startSoundtrack()` searched, then called
`MediaSession.requestPlay(track, { source: 'private' })` and `view.attachSoundtrack(track)`.
`MediaSession` records that playback was *requested*; it owns no player. `attachSoundtrack`
wrote the title into a div. Nothing ever called `NEXUS_YT_2D.activate`.

So a Private session announced a specific track by name and then ran for five minutes in
silence, with a line on screen insisting otherwise — the same class of defect the
`ConversationPublisher` header documents at length for `Playing "…"`.

**Fixed** by `src/features/together/ui/SoundtrackStrip.js`, one renderer for both experiences.
Private now carries the same real collapsed YouTube card Scene Tale has had all along. It stays
*inside* the Private row rather than going through `ConversationPublisher`, because the
publisher writes a chat message whose text is what `_persistChat` saves — and a Private moment
is supposed to leave nothing in the transcript.

### 5.3 Scene Tale could stack two soundtrack strips

`removeSoundtrack` used `querySelector`, so a second track arriving over a story that already
had one left the first in place: two `Soundtrack` rows, two `Show player` buttons, one of them
wired to an iframe that had already been replaced. Now `querySelectorAll`.

### 5.4 A locked Private setup screen explained nothing

`_paintPrivateSetup` short-circuits past the generic setup view, which is where
`activity.prompt` (and therefore `lockedPrompt(gate)`) is rendered. With the gate shut,
`contract.inputs()` returns `[]`, so the screen drew the pink card, an empty *How should this
feel?* section and a permanently disabled button — indistinguishable from a broken feature
rather than one waiting on a setting the person can change. The reason is now rendered in the
empty grid.

---

## 6. Recommendations, in the order they are worth doing

**1. Give Private a prepare step, or give Playground's away.**
Playground tells you what it is doing for the several seconds it needs (`Writing the story`,
`Finding a soundtrack`). Private does the same amount of asynchronous work — a discovery warm-up
and a music search — *after* `Begin private moment`, with no indication, and the soundtrack
simply appears some seconds into a session that has already started talking. A three-line
`Setting the mood…` state reusing `nexus-story-progress` would cost very little and remove the
only moment in Private where the app looks like it is not responding.

**2. Make the two soundtrack pickers the same three options.**
Private offers `Keep current`; Playground does not, even though `StoryPlayer` has an
`AudioFocusManager` and could honour it. Same control, same words, both places.

**3. Move Private's setup onto the `activity.ui` extension point.**
The hard-coded `pending === 'intimate'` branch in `TogetherPanel` makes the panel know about one
specific activity, which is precisely what the `STEPS`/`activity.ui` split exists to prevent. A
third custom setup screen would add a third mechanism.

**4. Show the scene picture in Private's setup.**
`SceneTaleArtView` already resolves the current scene's plate from the ambience manifest for
Playground. Private renders the scene as a *text label* in a bordered card. The asset and the
resolver both exist; this is a one-view reuse, and "a more personal moment" is exactly the
screen where a picture of where you are earns its place.

**5. Show what is playing on the completion card.**
Both experiences end with a completion card that drops the soundtrack strip. `SoundtrackStrip.describe()`
is exported separately from `render()` for this: a finished session can say what it played
without keeping a live player.

**6. Reconsider Private's fixed 300-second arc.**
Every beat is a `setTimeout` from `start()`. A user who replies at length gets the closing line
mid-conversation; one who says nothing gets the same session as one who says a lot. Scene Tale
has the same property but earns it — it is a *story*, and a story has a length. A conversation
does not. Advancing on turns taken, with the wall clock only as a ceiling, would fit what
Private is.

**7. Name the family-safe boundary on screen.**
`_leavePrivateIfNeeded()` is a genuinely good safety property that the user is never told
about. One line on the Playground ready screen — *Playground is always family-safe; starting it
ends a Private moment* — turns an invisible guarantee into a reason to trust the product.

---

## 7. Test coverage added

| file | covers |
| --- | --- |
| `tests/behavior/media-title.test.js` | the two shipped titles, the shapes that must survive untouched, capping, and that nothing ever returns empty |
| `tests/behavior/soundtrack-strip.test.js` | Private actually plays what it names; neither view can stack two strips; degradation with no embed and with one that throws |
| `tests/behavior/intimate-ui.test.js` | a locked Private setup screen states its reason |

The gate is green on everything above: `4107 tests / 157 suites` passing, lint clean. Twelve
files fail `format:check` on this branch, all of them pre-existing and none of them touched
here — `SceneTaleConversationView.js` was a thirteenth and is now formatted.
