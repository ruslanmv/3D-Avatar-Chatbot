# AI-controlled scene ambience — design and implementation plan

Lets the companion act on the shared environment: *"I want to relax by the sea"* → she says one
short sentence and the surroundings change. Additive, user-enabled, bounded to a trusted
catalogue, provider-neutral.

Design document. **No production code is part of this change.** Every claim about current
behaviour cites a file and line at commit `251e07b`.

Builds on [`VIEWPORT_IMAGE_BACKGROUNDS.md`](VIEWPORT_IMAGE_BACKGROUNDS.md), which owns the
rendering layer (`ViewportBackgroundManager`, the catalogue of scenes, the texture lifecycle).
This document owns only the **language → intent → scene** path and the settings that gate it.

---

## 1. Current architecture analysis

### 1.1 The repository already has exactly this pattern

Four files describe a complete, battle-tested capability/action architecture, and this feature
should be a fifth instance of it rather than anything new:

```
TogetherSwitch.js        state owner: tri-state, localStorage, listeners      (166 lines)
        ↓ isOn()
TogetherCapability.js    systemPromptSuffix() — '' when off, or when the      (144 lines)
        ↓                capability genuinely cannot run (canSearch())
   [LLM emits  <play kind="music">ambient rain</play>]
        ↓
PlayDirective.js         extract / strip / execute, assistant replies only    (203 lines)
        ↓
MediaIntent.fulfil()     trusted application code does the actual thing
```

Integration points, all of which this feature reuses verbatim:

| Seam | Location |
|---|---|
| Module load order | `src/behavior/boot.js:95-103` (ordered list; `TogetherSwitch`, `TogetherCapability`, `PlayDirective`) |
| Prompt assembly | `src/main.js:3563-3572`, `:3842-3851`, `:5327-5330` — three sites, each a chain of `?.systemPromptSuffix?.() \|\| ''` |
| Reply processing | `src/main.js:3595`, `:3657` — `displayText = NEXUS_PLAY_DIRECTIVE.consume(displayText)`, plus three more in the research modules (`SearchQuality.js:96`, `LookUp.js:417`, `SearchUX.js:139`) |
| Settings toggle markup | `index.html:1464-1476` — `.spicy-toggle-label` + `.spicy-toggle-switch` + `.spicy-toggle-slider` |
| Settings dropdown markup | `.select-input` (e.g. `index.html:1216`) |

### 1.2 Why the strip point matters

`main.js:3590-3596` has the comment that explains the whole security model:

> *Here, beside the motion seam, because everything downstream reads `displayText` — the bubble,
> the transcript, the VR forward and `speakText` — so stripping once covers the screen and the
> voice. A tag that reached the synthesiser would be her reading XML aloud.*

So there is **one** place to strip, and it already covers display, transcript, VR forward and
TTS. An ambience directive inserted into that same chain inherits all four for free.

### 1.3 Why a tag and not tool calling

`TogetherCapability.js:24-28` already made and documented this decision:

> *This app talks to OpenAI, Claude, watsonx, Ollama and OllaBridge, and only some of those
> expose tool calling through this client. A fenced tag works on every one of them […] Tool
> calling is the better mechanism where it exists, and the wrong one to build on when four of
> five paths cannot use it.*

Nothing has changed. The baseline stays a tag. A native-tool-calling adapter can be added later
*behind the same resolver* without touching anything below the parser.

### 1.4 Confirmed: the naming collision is real

```js
// src/features/together/AmbientMode.js:71
const KEY = 'nexus_ambient_enabled';
// :440
global.NEXUS_AMBIENT = api;
```

`NEXUS_AMBIENT` / `nexus_ambient_enabled` belong to **Calm mode** — dimming the *interface*
while media plays (`index.html:1487-1498`, "Calm mode — dim the interface while something is
playing"). Entirely unrelated to scenery. This feature uses `NEXUS_SCENE_AMBIENCE*` and
`nexus_scene_ambience_*` throughout.

---

## 2. A tension in the spec, resolved explicitly

§4 of the addendum says that when the master toggle is **ON**, "manual scenic backgrounds are
available" — implying the toggle gates the scenic *images*. §6, §23 and §24 say manual
background control remains regardless, and recommend the "AI Ambience" label precisely because
"backgrounds exist regardless".

**Recommendation: the toggle gates AI agency only. Scenic backgrounds are always manually
available.** Reasons:

1. Scenic images ship as part of **VIEWPORT BACKGROUND** (the previous PR). They are a display
   preference like `white` or `gray`, and gating a display preference behind an AI-permission
   switch is surprising.
2. It gives one sentence users can hold in their head:
   `VIEWPORT BACKGROUND = what I see.` `AI AMBIENCE = whether she may change it.`
3. It makes the OFF path trivially non-destructive (§23) — turning AI control off cannot take
   away a background the user chose by hand.

This also matches §24's own conclusion, so the spec's later sections win over §4's aside.

---

## 3. Settings design

New section, placed directly under the existing Together/Calm-mode rows so all three
permission-shaped switches sit together. **No change to the Settings modal structure**, and
the existing VIEWPORT BACKGROUND section is untouched.

```
AI AMBIENCE

Ambience — let her change where you are            [ OFF ]

  Off by default. On, she can move you somewhere that suits what you
  asked for — the sea, a forest, somewhere quiet to study. You can
  always change it yourself under Viewport Background.

Preferred ambience
[ Auto — let her choose                         ▼ ]   (disabled while off)

Current: Coastal Terrace                              (optional, event-fed)
```

Markup reuses the existing language exactly:

```html
<div class="input-group">
  <label class="spicy-toggle-label">
    <span>Ambience — let her change where you are</span>
    <div class="spicy-toggle-switch">
      <input type="checkbox" id="scene-ambience-enabled-toggle" />
      <span class="spicy-toggle-slider"></span>
    </div>
  </label>
  <p style="font-size: 0.7rem; color: #888; margin: 6px 0 0">…</p>
</div>

<div class="input-group">
  <label for="scene-ambience-preference">Preferred ambience</label>
  <select id="scene-ambience-preference" class="select-input" disabled>…</select>
</div>
```

Label wording follows the house voice — the existing rows are conversational
("Together — watch, listen and focus with her", "Calm mode — dim the interface…"), not
feature-name-first. "Ambience — let her change where you are" matches that and makes the
permission obvious without the word "AI" appearing in the control itself; the section heading
carries that.

### Dropdown

| Value (internal) | Label |
|---|---|
| `auto` *(default)* | Auto — let her choose |
| `relax` | Relax & Meditation |
| `nature` | Nature |
| `ocean` | Ocean & Beach |
| `forest` | Forest & River |
| `study` | Study & Focus |
| `cozy` | Cozy |
| `night` | Night & Sleep |
| `fantasy` | Fantasy & Dream |

Internal values are never shown. Labels are free to change; values are the stable contract.

---

## 4. Master toggle semantics

Storage key `nexus_scene_ambience_enabled`. **Default OFF** — this grants the model permission
to alter what the user sees, and permission defaults to "not given".

Unlike `TogetherSwitch`'s tri-state (`null` / `on` / `off`), this switch is **plain two-state**.
The tri-state exists there because Together turns itself on the first time you tap a tile, so
"never touched" and "deliberately off" differ. Nothing here turns itself on, so `null` and
`off` would behave identically and the extra state would be dead weight.

| | OFF (default) | ON |
|---|---|---|
| Prompt suffix | `''` — the model is never told the capability exists | capability described |
| Directive execution | **refused at execution time** | executed |
| Preference dropdown | disabled | enabled |
| Manual scenic backgrounds | **still available** (§2) | available |
| Currently-shown background | **unchanged** (§23) | unchanged |

### The race in §4 is handled by checking twice

```
Ambience ON → user: "take me to the forest" → request in flight
           → user turns Ambience OFF
           → reply arrives carrying <ambience intent="forest"/>
           → REFUSED
```

The gate is re-read inside the directive's execute path, not captured when the prompt was
built. A stale model response can never re-enable a user-disabled capability. The reverse race
(OFF at prompt time, ON by the time the reply lands) is allowed to execute: the switch is ON
when the action happens, which is the state the user is actually in.

---

## 5. Preference semantics

Storage key `nexus_scene_ambience_preference`, default `auto`.

A **ranking signal, never a filter** (§17). An explicit request always wins:

```
preference = forest      user: "take me to the beach"     → beach
preference = forest      user: "somewhere relaxing"       → forest-ish scene
preference = auto        user: "somewhere relaxing"       → any suitable scene
```

Encoded as a weight in the resolver (§8), not as a candidate filter — so a preference can never
make a direct request unsatisfiable.

---

## 6. The model-facing capability

`SceneAmbienceCapability.systemPromptSuffix()` returns `''` when **either**:

- the switch is off, **or**
- the catalogue contains no scenes that can actually be applied on this device.

The second condition mirrors `TogetherCapability.canSearch()` (`:62-74`) and its reasoning: no
point promising what cannot run. With no scenic entries available, she would offer to move you
somewhere and nothing would happen.

Draft instruction — deliberately shaped around the four failure modes that would otherwise
occur (asking permission, acting on every mood, claiming success early, inventing assets):

```text
WHERE YOU BOTH ARE

You can change the surroundings you and the person share. When they ask to go
somewhere, to be somewhere, or to change where they are — or when they ask for
something that plainly needs a different setting, like somewhere quiet to study
or somewhere peaceful to meditate — change it. Write, on its own line:

  <ambience intent="sea" mood="relax"/>

intent is one of: sea, forest, river, lake, mountain, garden, sky, rain,
study, cozy, night, fantasy, meditation, relax
mood is optional, one of: relax, meditation, focus, sleep, cozy, dream

Say one short sentence first, then the tag. Do not ask whether they would like
you to — they already asked. Write at most one tag per reply.

  "Let's go somewhere quiet by the water."
  <ambience intent="sea" mood="relax"/>

Talking about a place is not asking to be in one. "I went to the beach last
summer", "I love forests", "tell me about rivers" — these are conversation,
not requests. Do not change anything. Nor for a passing feeling: "I'm tired",
"that was stressful", "I'm sad" are not requests to move.

Say it as somewhere you are going, not somewhere you have arrived —
"let's go somewhere by the sea", not "we're at the beach now". The app picks
from the places it actually has, and it may take a moment or find nothing
suitable.

Never write a URL, a file name, a scene name or an ID. You do not know what
places exist; the app chooses. A name you invent is a guess that reads as a
fact.
```

Two non-obvious choices:

- **The intent vocabulary is in the prompt; the catalogue is not.** Without a vocabulary the
  model invents intents (`tropical-lagoon`, `serene-vista`) that the resolver cannot match.
  Fourteen stable words cost ~30 tokens and make the output resolvable. The catalogue itself
  never goes in — §47, and it keeps asset URLs out of model reasoning entirely.
- **"Say it as somewhere you are going"** is the §14 rule. Loading can fail; a sentence that
  already claimed arrival becomes a lie that the UI then contradicts.

### Optional current-scene line (§46)

One short line, appended only when a scene is active:

```text
Right now you are both at: Coastal Terrace
```

That makes *"can we go somewhere brighter?"* answerable. It is a name only — no tags, no URLs,
no manifest. Recommended, and cheap; it can ship in the second PR if the first needs to stay
minimal.

---

## 7. Directive format and parser

```xml
<ambience intent="sea" mood="relax"/>
```

**Self-closing, attributes only, no text content.** This is a deliberate departure from
`<play>`, which carries a free-text query because a search needs arbitrary words. An ambience
request needs only two enumerated values, so a text payload would be pure attack surface — and
`PlayDirective`'s `ORPHAN` regex (`:56`) exists precisely because an unclosed content-bearing
tag swallows the rest of the reply.

The grammar the parser accepts, strictest first:

```js
// Attributes in either order, tolerant of quoting/spacing, optional self-closing slash,
// and a separate closing tag tolerated because models produce both.
const TAG = /<ambience((?:\s+[a-z]+\s*=\s*["'][^"'<>]{0,32}["']){0,2})\s*\/?>(?:\s*<\/ambience\s*>)?/i;
```

Then, on the captured attribute string:

1. Parse into pairs. **Unknown attribute names → reject the whole directive** (not ignore). A
   model writing `url="…"` or `src="…"` must fail loudly in the log, not succeed partially.
2. `intent` required, `mood` optional.
3. Each value must match `^[a-z][a-z-]{0,23}$` **and** appear in the vocabulary. An unknown
   `intent` with a known `mood` falls back to resolving on mood alone; both unknown → no action.
4. **At most one.** The first is executed; every further occurrence is stripped and never run —
   `PlayDirective` establishes this (`:19-21`): *"an instruction is not a guarantee, so the
   guarantee lives here."*

Also stripped but never executed, mirroring `PlayDirective`'s hard-won cases:

```js
const ORPHAN = /<ambience(?:\s[^>]{0,120})?$/i;               // truncated reply
const BARE   = /(?:^|\n)\s*ambience\s+intent\s*=\s*["'][a-z-]{1,24}["'][^\n]{0,80}/gi;
```

`consume(text, options)` returns the cleaned text and never throws — a `try/catch` around
execution, exactly as `PlayDirective.consume` does (`:155-199`), because *"a directive that
cannot run must not take the reply down with it."*

### Grammar verified

The regex and allowlist above were run against the cases this section claims to handle:

| Input | Matches tag | Allowlist verdict |
|---|---|---|
| `<ambience intent="sea" mood="relax"/>` | yes | **accept** |
| `<ambience intent="sea"/>` | yes | accept |
| `<ambience intent='forest' />` | yes | accept |
| `<ambience mood="relax" intent="sea">` (order swapped, no slash) | yes | accept |
| `<ambience intent="sea"></ambience>` | yes | accept |
| `<ambience intent="sea" url="http://x/a.webp"/>` | **yes** | **reject — unknown attr `url`** |
| `<ambience intent="Sea!!"/>` | yes | reject — value charset |
| `<ambience mood="relax"/>` | yes | reject — no `intent` |
| `<ambience intent="sea"` (truncated) | no | stripped by `ORPHAN`, never run |

The `url=` row is the important one, and it shows why matching and accepting must be separate
steps: the tag **matches** (so it is stripped from the bubble and the voice) and is then
**rejected** (so it never executes). A grammar that simply failed to match it would leave
`<ambience intent="sea" url="…"/>` visible in the chat and spoken aloud.

Stripping confirmed: `Let's go somewhere quiet by the water.\n<ambience intent="sea" mood="relax"/>`
→ `Let's go somewhere quiet by the water.`

### Security rules

| Rule | Mechanism |
|---|---|
| No URLs, paths or file names | There is nowhere to put one. Unknown attributes reject the directive |
| No code execution | Values are matched against an enum; nothing is evaluated or interpolated |
| No arbitrary scene selection | The model emits an intent; **trusted code** picks the ID from the catalogue |
| Assistant output only | `consume` is called on assistant replies only. A user typing `<ambience intent="forest"/>` is ordinary text — `PlayDirective.js:27-30` establishes this rule and the reason |
| Gate re-checked at execution | §4 |
| Never reaches screen or voice | One strip point covers bubble, transcript, VR forward and TTS (§1.2) |
| At most one change per reply | Parser-enforced |

---

## 8. Intent resolver

A pure, deterministic, testable function. No second LLM (§34).

```js
resolve({ intent, mood, preference, context }) → sceneId | null
```

### Vocabulary (centralised, not scattered ifs — §18)

```js
const ALIASES = {
  sea:     ['sea', 'ocean', 'beach', 'coast', 'shore', 'seaside', 'waves'],
  forest:  ['forest', 'woodland', 'woods', 'trees', 'jungle'],
  river:   ['river', 'stream', 'creek', 'waterfall'],
  lake:    ['lake', 'pond'],
  mountain:['mountain', 'mountains', 'alpine', 'peak'],
  garden:  ['garden', 'zen', 'courtyard'],
  sky:     ['sky', 'clouds', 'stars', 'aurora', 'starlight'],
  rain:    ['rain', 'rainy', 'storm'],
  study:   ['study', 'focus', 'work', 'concentrate', 'desk', 'library'],
  cozy:    ['cozy', 'cosy', 'warm', 'fireplace', 'campfire'],
  night:   ['night', 'evening', 'dark', 'sleep', 'moonlight', 'twilight'],
  fantasy: ['fantasy', 'dream', 'magical', 'glowing'],
  meditation:['meditation', 'meditate', 'calm', 'peaceful', 'still'],
  relax:   ['relax', 'relaxing', 'chill', 'unwind', 'rest'],
};
```

One table. The model does the language understanding; this is normalisation and a safety net.

### Scoring

Matches against catalogue `tags` and `category`, which the Studio contract already publishes
(§16):

| Signal | Weight | Why this order |
|---|---|---|
| `intent` alias hits a scene **tag** | **+10** each | The explicit request — must dominate |
| `intent` hits the scene **category** | +6 | Weaker than a tag, still explicit |
| `mood` alias hits a tag or category | +4 | Refines within the request |
| `preference` hits a tag or category | **+3** | A nudge, never a filter (§5, §17) |
| day/night matches current local hour | +1 | Context |
| `featured` | +0.5 | Tie-break toward curated content |

Then: sort by score, tie-break on `id` ascending for determinism, and apply a floor —
**if the best score is below the intent threshold (10), return `null`** rather than
something irrelevant. §35's "Take me to Mars" resolves to `null`, and the policy is
**no change** with a natural sentence from her, not a wrong place.

Worked examples against the §43 fixture catalogue:

```
intent=sea                        → ocean-sunrise     (tags: ocean beach sea → +30)
intent=forest                     → forest-river      (tags: forest → +10)
intent=study                      → rain-study        (tags: study focus → +20)
intent=meditation mood=night      → night-garden      (+10 meditation, +4 night)
intent=relax preference=nature    → forest-river      (+10 relax, +3 nature)
intent=mars                       → null              (below threshold → no change)
```

---

## 9. Single state owner

The most important structural decision, and the one most easily got wrong: **do not create a
second store of "the current scene."**

```
        Settings radios (manual)          SceneAmbienceDirective (model)
                   │                                 │
                   │                        resolve → sceneId
                   └────────────┬────────────────────┘
                                ▼
                   SceneAmbienceController
                     · isEnabled() / setEnabled()
                     · preference get/set
                     · apply(sceneId, { source, intent })
                     · cooldown + no-op guard
                                ▼
                   ViewerEngine.setDesktopBackground(id)     ← already the one application point
                                ▼
                   ViewportBackgroundManager  (texture lifecycle)
                                ▼
                   emit  nexus:scene-ambience-change
```

The controller holds **no copy of the current scene**. "What is showing" is already owned by
`ViewerEngine._desktopBgKey` and published by `getVisualState().background`
(`ViewerEngine.js:1389`). The controller reads it and never shadows it. That is what makes §44
("no duplicate state") true by construction rather than by discipline, and it is why the
Settings panel can never display *Ocean* while the scene is *Forest*.

What the controller does own: the enabled flag, the preference, a **no-op guard** (requesting
the scene that is already active changes nothing and fires no event) and a **model-only
cooldown**.

### The cooldown

The prompt asks her not to be hyperactive (§12), but an instruction is not a guarantee — the
same reasoning that puts "at most one" in the parser. So: an AI-initiated change within **20
seconds** of the previous AI-initiated change is refused and logged. It does **not** apply to
manual selection (the user may click as fast as they like) and it does not apply to the first
change in a session. Deterministic, one timestamp, testable.

No timers, no rotation, no polling, no per-message changes (§22).

---

## 10. Desktop path, and why XR is already safe

Desktop/mobile: the controller calls `setDesktopBackground(sceneId)`, which routes image IDs to
`ViewportBackgroundManager`. No avatar reload, no renderer recreation, no animation restart, no
camera reset, no chat or TTS interruption — the background is one `scene.background` assignment
(see the viewport-background design).

**Immersive XR needs no special case in this feature**, because the existing guard already does
the right thing:

```js
// ViewerEngine.js:1561-1564
this._desktopBgKey = key;
if (!this.renderer.xr.isPresenting) {
    this.scene.background = new THREE.Color(color);
}
```

While presenting, the selection is *recorded* and the scene is left alone. So an ambience change
requested in VR:

1. resolves to a scene ID,
2. records it as the current selection,
3. applies nothing to the immersive view — **a flat rectangular image is never pushed into
   immersive space** (§28),
4. is applied on exit, via the `reapplyCurrent()` fix described in the viewport-background
   design (`ViewerEngine.js:499-500`).

When an environment later carries `variants.quest.kind = "panorama"`, the *same* semantic scene
ID resolves to the panorama through the profile resolver. The model said `forest`; which variant
renders is entirely runtime business (§26, §27). That is the payoff of making the action target
an environment identity rather than an image file.

---

## 11. Catalogue, and the Studio contract

V1 uses the local catalogue from the viewport-background design — it works with
`3D-Ambience-Studio` offline (§30). The resolver consumes **normalised entries** and does not
care where they came from:

```js
{ id, label, category, tags: [...], /* + render fields the resolver ignores */ }
```

`category` and `tags` are exactly what the Studio's catalogue already publishes, so the later
swap is additive:

```
SceneAmbienceCatalog
  ├── local entries          (assets/ambient/backgrounds.json)     ← V1
  └── Studio catalog.json    (fetched from the CDN)                ← later
```

The Avatar never calls a Studio project or generation API (§29, §35). Generation stays an
offline content pipeline.

**V1 local entries need `category` and `tags` added** — the viewport-background data model has
`id`, `label`, `src`, `focalPoint`. Adding two fields to a JSON file is the only catalogue
change this feature requires:

```json
{ "id": "ambient:terrace:night", "label": "Coastal Terrace", "variantLabel": "Twilight",
  "category": "relax", "tags": ["sea", "ocean", "coast", "terrace", "night", "relax"],
  "src": "assets/ambient/dark/coastal-terrace-twilight.webp", "focalPoint": "center" }
```

---

## 12. Persistence

| Key | Owner | Default |
|---|---|---|
| `nexus_scene_ambience_enabled` | this feature | `off` |
| `nexus_scene_ambience_preference` | this feature | `auto` |
| `desktop_bg` | existing; unchanged | `black` |

No new key for "current scene" — `desktop_bg` already is that, and the whole point of §9 is not
to duplicate it. Both the manual radio path and the AI path converge on `setDesktopBackground`,
so whichever changed it, `desktop_bg` is written once by the existing save path.

`localStorage` access is wrapped in `try/catch` with an in-memory fallback, copying
`TogetherSwitch.storage()` (`:43-51`) — private mode and embedded webviews throw.

---

## 13. Event and state synchronisation

One `CustomEvent` on `window`, matching the existing `vr-session-start` / `vr-session-end`
convention:

```js
window.dispatchEvent(new CustomEvent('nexus:scene-ambience-change', {
  detail: { sceneId, previousSceneId, source: 'model' | 'settings' | 'restore', intent }
}));
```

Fired **once** per actual change — never on a no-op, never twice for one selection. Consumers:

- the Settings panel updates the checked radio and the optional `Current:` line, so an AI
  change is visible in an open Settings modal (§19);
- the capability's current-scene line (§6) reads the same state.

---

## 14. Exact repository changes

### CREATE

| File | Why | Rough size |
|---|---|---|
| `src/features/ambience/SceneAmbienceSwitch.js` | State owner: enabled flag + preference, `localStorage` with memory fallback, `onChange` listeners. Mirrors `TogetherSwitch` minus the tri-state | ~110 |
| `src/features/ambience/SceneAmbienceCapability.js` | `systemPromptSuffix()` — `''` when off or when no scene can run | ~90 |
| `src/features/ambience/SceneAmbienceDirective.js` | `extract` / `has` / `consume`; attribute allowlist; one-per-reply; execution-time gate | ~150 |
| `src/features/ambience/SceneAmbienceResolver.js` | Alias table + deterministic scoring → scene ID or `null` | ~130 |
| `src/features/ambience/SceneAmbienceController.js` | Enabled/preference policy, no-op guard, cooldown, calls `setDesktopBackground`, emits the event | ~120 |
| `tests/scene-ambience-switch.test.js` · `-capability` · `-directive` · `-resolver` · `-controller` | §15 | — |

Five small modules, each with one job. No `SceneAmbienceCatalog.js`: the catalogue already
exists as `ViewportBackgroundCatalog` from the previous PR, and a second one would be the
duplicate state §9 forbids — the resolver takes entries as an argument.

### MODIFY

| File | Change |
|---|---|
| `src/behavior/boot.js` | Add the five modules to the ordered list, after the Together block (`:95-103`) |
| `src/main.js` | (a) add `NEXUS_SCENE_AMBIENCE_CAPABILITY?.systemPromptSuffix?.() \|\| ''` at the three prompt sites (`:3572`, `:3851`, `:5330`); (b) add `NEXUS_SCENE_AMBIENCE_DIRECTIVE.consume(displayText)` beside the `<play>` strip at `:3595` and `:3657`; (c) wire the toggle + dropdown, and listen for the change event to sync the background radios |
| `index.html` | Add the AI AMBIENCE section (one toggle, one select) after the Calm-mode row at `:1498` |
| `assets/ambient/backgrounds.json` | Add `category` and `tags` to each entry (§11) |

The research-module `consume` sites (`SearchQuality.js:96`, `LookUp.js:417`,
`SearchUX.js:139`) are **deliberately not modified**: an ambience directive is never expected in
a search-refinement round trip, and fewer execution paths is a smaller attack surface. If a
directive does appear there it survives as visible text — mildly ugly, never harmful. Revisit
only if it is seen in practice.

### DO NOT TOUCH

| File | Why |
|---|---|
| `TogetherSwitch.js`, `TogetherCapability.js`, `PlayDirective.js`, `MediaIntent.js` | Precedent to copy, not to change. Separate namespace (§1.4) |
| `AmbientMode.js` | Different feature that owns `NEXUS_AMBIENT` (§1.4) |
| `ViewerEngine.js` | This feature adds no renderer behaviour. Its changes belong to the viewport-background PR, which must land first |
| `CompanionMode.js`, `ARSupport.js`, `PassthroughEnhancer.js`, `VRSupport.js`, `PostProcessing.js` | Unaffected — the XR guard already exists (§10) |
| LLM providers, TTS, chat transport, animation, face tracking | No provider-specific code; the tag works across the whole matrix |
| `3D-Ambience-Studio` | Out of scope |

---

## 15. Tests

### Unit — switch
default is OFF · enable/disable · persists · preference persists · `onChange` fires immediately
for both · unknown stored values fall back to the defaults · a throwing `localStorage` degrades
to memory without throwing.

### Unit — capability
OFF → `systemPromptSuffix() === ''` · ON with no runnable scene → `''` · ON → the text contains
the tag syntax, the intent vocabulary, an example, the no-URL rule, "at most one", and the
talking-about-vs-asking-for distinction · current-scene line appears only when a scene is active
· the suffix never contains a scene URL or a catalogue dump.

### Unit — directive
valid, with and without `mood` · attribute order swapped · single vs double quotes ·
self-closing vs separate closing tag · **unknown attribute (`url=`, `src=`) → rejected** ·
value failing the charset → rejected · unknown intent + known mood → resolves on mood · both
unknown → no action · two directives → first executes, both stripped · orphan/truncated tag
stripped, not executed · bare bracket-less form stripped · **stripped from display and from the
TTS path** · **disabled at execution time → refused even though the text parsed** ·
**user-authored text is never executed** · a throwing resolver does not lose the reply.

### Unit — resolver
the §8 worked examples · determinism (same input → same output, 100 runs) · tie-break is stable
· preference ranks but never filters · an explicit request beats a conflicting preference ·
below-threshold → `null` · an empty catalogue → `null` · a catalogue entry missing `tags` does
not throw.

### Unit — controller
no-op when the requested scene is already active (no event) · cooldown refuses a second
model change inside the window · cooldown does **not** apply to manual · disabled → `apply`
from a model source refuses, from settings succeeds · event fires exactly once per change with
the right `source`.

### Integration / regression
manual radio and AI change go through the same controller and emit the same event · Settings
open during an AI change updates the radio and the `Current:` line · `desktop_bg` is written
once · **toggling AI ambience OFF does not change the visible background** (§23) · the five
solid colours still work · avatar animation, chat and TTS uninterrupted across a change · a
failed image load keeps the previous background and the reply still stands.

### XR
scene selected → enter VR → **no flat image in immersive space** → exit → selected scene
restored · an ambience directive *while in VR* records the selection, applies nothing immersive,
applies on exit · later, an entry with a Quest panorama resolves to the panorama for the same
scene ID.

---

## RECOMMENDED AI AMBIENCE ARCHITECTURE

```text
Master setting:
    "Ambience — let her change where you are" in a new AI AMBIENCE Settings section,
    reusing .spicy-toggle-label / .spicy-toggle-switch. Key
    nexus_scene_ambience_enabled. Two-state (not tri-state: nothing turns itself on).
    Gates AI agency ONLY — manual scenic backgrounds stay available, and turning it
    off never changes what is currently on screen.

Default:
    OFF. It grants the model permission to change what the user sees.

Preference setting:
    "Preferred ambience" dropdown, key nexus_scene_ambience_preference, default auto,
    disabled while the toggle is off. A ranking weight (+3), never a filter — an
    explicit request always wins.

Model action format:
    <ambience intent="sea" mood="relax"/>
    Self-closing, attributes only, NO text content — unlike <play>, which needs a free
    text query. intent from a 14-word vocabulary carried in the prompt; mood optional
    from 6. A tag, not tool calling, because TogetherCapability.js:24-28 already
    established that only some of the five providers expose tools through this client.

Action parser:
    SceneAmbienceDirective — extract / strip / execute, modelled on PlayDirective.
    Unknown attribute names REJECT the directive (so url= can never partially
    succeed); values matched against an enum; at most one per reply, extras stripped
    and never run; orphan and bracket-less forms stripped; never throws. Called at the
    existing single strip point (main.js:3595, :3657), which already covers bubble,
    transcript, VR forward and TTS. Assistant replies only — a user typing the tag is
    ordinary text.

Intent resolver:
    SceneAmbienceResolver — pure, deterministic, no second LLM. One centralised alias
    table; scores catalogue tags/category: intent-tag +10, intent-category +6, mood +4,
    preference +3, day/night +1, featured +0.5; stable id tie-break; below-threshold
    returns null → no change, not a wrong place.

Catalog:
    Reuses ViewportBackgroundCatalog from the viewport-background PR — no second
    catalogue. Entries gain `category` and `tags`, which is the only data change this
    feature needs. The model never sees the catalogue (§47); asset URLs stay out of
    model reasoning entirely.

State owner:
    SceneAmbienceController owns the enabled flag, the preference, a no-op guard and a
    20 s model-only cooldown. It owns NO copy of the current scene — that stays
    ViewerEngine._desktopBgKey, published by getVisualState().background. Manual and AI
    paths converge on setDesktopBackground(), so duplicate state is impossible rather
    than merely discouraged.

Desktop renderer:
    Controller → ViewerEngine.setDesktopBackground(id) → ViewportBackgroundManager →
    scene.background. No avatar reload, no renderer recreation, no animation, camera,
    chat or TTS interruption.

Quest renderer:
    No special case needed now. ViewerEngine.js:1561-1564 already records the key and
    skips the scene while xr.isPresenting, so a flat image can never enter immersive
    space; it applies on exit via reapplyCurrent(). When an environment carries
    variants.quest.kind = "panorama", the same scene ID resolves to the panorama — the
    model said "forest", the runtime chose the variant.

Persistence:
    nexus_scene_ambience_enabled, nexus_scene_ambience_preference. desktop_bg keeps
    owning the current background. No third key. Separate namespace from
    NEXUS_AMBIENT / nexus_ambient_enabled, which is Calm mode (verified:
    AmbientMode.js:71, :440).

Event:
    window CustomEvent 'nexus:scene-ambience-change' with
    { sceneId, previousSceneId, source: 'model'|'settings'|'restore', intent },
    fired once per real change, matching the vr-session-* convention. Settings listens,
    so the UI can never show Ocean while the scene is Forest.

3D-Ambience-Studio integration:
    Local catalogue first; works with the Studio offline. Later a Studio catalog.json
    adapter is added alongside it, using the category/tags the Studio already publishes.
    The Avatar never calls a Studio project or generation API — "take me to Mars" with
    no Mars scene resolves to null and she says something natural.

Files to create:
    src/features/ambience/SceneAmbienceSwitch.js
    src/features/ambience/SceneAmbienceCapability.js
    src/features/ambience/SceneAmbienceDirective.js
    src/features/ambience/SceneAmbienceResolver.js
    src/features/ambience/SceneAmbienceController.js
    tests/scene-ambience-{switch,capability,directive,resolver,controller}.test.js

Files to modify:
    src/behavior/boot.js          (load the five modules)
    src/main.js                   (3 prompt sites; 2 strip sites; settings wiring)
    index.html                    (AI AMBIENCE section: one toggle, one select)
    assets/ambient/backgrounds.json  (add category + tags)

Files not to touch:
    TogetherSwitch.js, TogetherCapability.js, PlayDirective.js, MediaIntent.js,
    AmbientMode.js, ViewerEngine.js, CompanionMode.js, ARSupport.js,
    PassthroughEnhancer.js, VRSupport.js, PostProcessing.js, LLM providers, TTS,
    chat transport, animation, face tracking, 3D-Ambience-Studio.
```

### FIRST PR

Depends on the viewport-background PRs landing first — there must be scenes to select.

1. `SceneAmbienceSwitch` + the Settings section (toggle, dropdown, disabled-while-off), wired
   and persisted. **Verifiable on its own:** the setting exists, persists, changes nothing yet.
2. `category` + `tags` added to the local catalogue entries.
3. `SceneAmbienceResolver` with the alias table and scoring, fully unit-tested against fixtures
   before anything calls it. Pure function, no DOM, no renderer.
4. `SceneAmbienceController` — no-op guard, cooldown, `setDesktopBackground`, the event. Wire
   Settings to listen, so a change from any source syncs the radios.
5. `SceneAmbienceCapability` — prompt suffix, `''` when off or unrunnable; the three `main.js`
   sites.
6. `SceneAmbienceDirective` — parser, gate, the two strip sites. Last, because everything it
   calls now exists.
7. Full test suite; manual pass on the §15 integration list.

That is the complete feature. It is one PR because splitting it leaves a capability the model
is told about but nothing can execute, or a parser with nothing to parse — both worse to review
than the whole.

### SECOND PR (only if the first is too large in review)

Split at step 5: PR A = switch, settings, catalogue tags, resolver, controller (manual path only,
fully testable); PR B = capability + directive (the model path). The seam is clean because the
controller is the boundary.

### FUTURE

- Current-scene line in the prompt (§6) if it does not ship in the first PR.
- Native tool-calling adapter for providers that support it, emitting the **same** resolver call.
- Quest panorama variants → the same intent becomes immersive (§10).
- Ambience audio, lighting presets, particles and near-field props bound to the same semantic
  action: the model still says `forest`, and the environment manifest decides what Forest means
  (§48). This is why the action is "select environment", not "change image".
- Studio `catalog.json` adapter replacing the local catalogue.
