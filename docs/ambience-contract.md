# Ambience — frozen data contract (batch A0)

The shapes every ambience batch codes against. Frozen here so that batches in the
same wave can be written in parallel without negotiating a shape through merge
conflicts.

**Changing anything in this file is a cross-batch event.** If a batch needs a
different shape, stop and change this file first, in its own commit, and say which
batches are affected.

Designs: [`VIEWPORT_IMAGE_BACKGROUNDS.md`](VIEWPORT_IMAGE_BACKGROUNDS.md),
[`AI_SCENE_AMBIENCE.md`](AI_SCENE_AMBIENCE.md). Plan:
[`AMBIENCE_BATCHES.md`](AMBIENCE_BATCHES.md).

---

## 1. Catalogue entry (A2 produces, A3/A4/A6/A9 consume)

Two kinds. `type` is the discriminator; nothing infers kind from a file extension.

```js
// colour — describes one of the five existing viewport backgrounds.
// ViewerEngine.BG_COLORS stays the authority for the actual value; `swatch` is
// for the Settings card only.
{
    id: 'black',            // the existing key, unchanged
    type: 'color',
    label: 'Black',
    swatch: '#000000'
}

// image — a flat scenic background.
{
    id: 'ambient:terrace:night',   // stable; NEVER contains an asset path
    type: 'image',
    label: 'Coastal Terrace',      // UI only, free to change or localise
    variantLabel: 'Twilight',      // UI composes "Coastal Terrace — Twilight"
    src: 'assets/ambient/dark/coastal-terrace-twilight.webp',
    thumb: 'assets/ambient/dark/coastal-terrace-twilight.webp',
    focalPoint: 'center',          // CSS-style string, parsed by A1
    intensity: 1,                  // → scene.backgroundIntensity, default 1
    category: 'relax',             // semantic, for A3
    tags: ['sea', 'ocean', 'coast', 'terrace', 'night', 'relax']
}
```

Rules:

- **`id` is the persisted value and the radio `value`.** It never contains a path,
  so re-encoding or moving an asset cannot invalidate a saved selection.
- **`src` and `thumb` are relative, same-origin paths.** No leading `/`, no `..`,
  no absolute URL. A2 rejects violations at load time with one warning.
- **No entry ever carries a function, HTML, or executable content.** Strings and
  numbers only.
- `thumb` is separate from `src` from day one so a smaller thumbnail can be
  introduced later as a data change.
- Unknown fields are ignored by consumers, so the catalogue can gain fields
  without a coordinated release.

### ID format

`ambient:<scene>:<variant>` — e.g. `ambient:terrace:night`, `ambient:sky:day`.

The `ambient:` namespace gives one place to detect "an image id I do not
recognise" for fallback. Colons are safe: every existing lookup is a quoted
attribute selector (`input[name="desktop-bg"][value="…"]`, `main.js:2627`,
`:2671`), which handles `:` without escaping.

### V1 scene set

Five scenes, ten assets (both variants land in A6; A6 decides which surface in the
grid first). Source: the `yourfriend` curated set, all 1672×941 WebP, ~1.28 MB
total.

| scene     | day asset                          | night asset                                   |
| --------- | ---------------------------------- | --------------------------------------------- |
| `ocean`   | `light/ocean-sunrise.webp`         | `dark/ocean-moonlight.webp`                   |
| `lake`    | `light/mountain-lake.webp`         | `dark/mountain-lake-night.webp`               |
| `garden`  | `light/meditation-garden.webp`     | `dark/meditation-garden-night.webp`           |
| `terrace` | `light/coastal-terrace.webp`       | `dark/coastal-terrace-twilight.webp`          |
| `sky`     | `light/open-sky.webp`              | `dark/starlight-sky.webp`                     |

**Licensing: Apache-2.0**, same as this repository, confirmed by the owner
(2026-09-12). This resolves the open question in `AMBIENCE_BATCHES.md` A6 — the
assets may be copied in. Record the same note beside the assets when they land.

---

## 2. Cover transform (A1 produces, A4 consumes)

```js
computeCoverTransform(imageAspect, viewAspect, focal) →
    { repeat: { x, y }, offset: { x, y } }

parseFocalPoint(str) → { x, y }     // 0..1, x from LEFT, y from TOP
```

`repeat` is always `≤ 1` on both axes, so the visible window is a sub-rectangle of
the image: cover, never stretch, never tile. Formula and its verified numbers are
in `VIEWPORT_IMAGE_BACKGROUNDS.md` §B.3 — do not re-derive them.

`parseFocalPoint` accepts `center`, `top`, `bottom`, `left`, `right`, two-keyword
pairs (`center top`), and percentages (`45% center`). Anything unparseable returns
`{ x: 0.5, y: 0.5 }` rather than throwing.

---

## 3. Resolver (A3 produces, A9 consumes)

```js
resolve({ intent, mood, preference, entries, now }) → sceneId | null
```

- `intent` — required; one of the 14 canonical intents, or an alias of one
- `mood` — optional; one of `relax meditation focus sleep cozy dream`
- `preference` — `auto` or one of the dropdown values; a **weight, never a filter**
- `entries` — image catalogue entries (§1). Passed in, so the resolver has no
  catalogue dependency and is testable with fixtures
- `now` — injected clock, for the deterministic day/night signal
- returns a catalogue `id`, or **`null` meaning no change** — never a guess

Canonical intents: `sea forest river lake mountain garden sky rain study cozy
night fantasy meditation relax`. Alias table and scoring weights are in
`AI_SCENE_AMBIENCE.md` §8.

---

## 4. Switch state (A7 produces, A8/A9/A10 consume)

```js
isEnabled() → boolean            // default FALSE
setEnabled(on) → void
getPreference() → string         // default 'auto'
setPreference(value) → void
onChange(fn) → unsubscribeFn
```

Storage keys — **exactly two, no more**:

| key                               | values                | default |
| --------------------------------- | --------------------- | ------- |
| `nexus_scene_ambience_enabled`    | `'on'` \| `'off'`     | `'off'` |
| `nexus_scene_ambience_preference` | dropdown value        | `'auto'` |

Two-state, not the tri-state `TogetherSwitch` uses — nothing here turns itself on,
so `null` and `off` would behave identically.

`desktop_bg` keeps owning **which background is showing**. There is no third key,
and the controller stores no copy of it.

Namespace is `NEXUS_SCENE_AMBIENCE*`. Never `NEXUS_AMBIENT` /
`nexus_ambient_enabled` — those belong to Calm mode, the interface dimmer
(`AmbientMode.js:71`, `:440`).

---

## 5. Controller (A9 produces, A10/A11 consume)

```js
apply(sceneId, { source, intent }) → boolean   // true if a change happened
requestByIntent({ intent, mood }) → sceneId | null
current() → string          // reads getVisualState().background — NOT a stored copy
```

`source` is `'model' | 'settings' | 'restore'`.

The controller owns: the no-op guard (requesting the active scene changes nothing
and fires no event) and a **20 s cooldown on `source: 'model'` only**.

It does **not** own a `currentSceneId` field. That is
`ViewerEngine._desktopBgKey`, published by `getVisualState().background`. A stored
copy here is a bug, not a convenience — it is how the Settings panel ends up
showing Ocean while the scene is Forest.

---

## 6. Event (A9 emits, A11 consumes)

```js
window.dispatchEvent(
    new CustomEvent('nexus:scene-ambience-change', {
        detail: {
            sceneId,
            previousSceneId,
            source, // 'model' | 'settings' | 'restore'
            intent, // null for a manual selection
        },
    })
);
```

Fired **once per real change**. Never on a no-op, never twice for one selection.
Matches the existing `vr-session-start` / `vr-session-end` window-event
convention.

---

## 7. Directive (A10 produces)

```xml
<ambience intent="sea" mood="relax"/>
```

Attributes only, no text content. `intent` required, `mood` optional, **unknown
attribute names reject the whole directive**. Grammar, the verified case table and
the `ORPHAN`/`BARE` strip patterns are in `AI_SCENE_AMBIENCE.md` §7.

```js
consume(text, options) → cleanText
```

`options` carries `{ controller, switch }` with a global fallback, mirroring
`PlayDirective.consume`'s `{ intent, claim }`. That injection is what lets A10 ship
before A9 exists.

---

## 8. Module placement and load mechanism

Decided here because it determines how each batch writes its files — see
`CLAUDE.md` for why the two directories differ.

| Batch      | File                                              | Shape                              | Loaded by                              |
| ---------- | ------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| A1, A2, A4 | `src/gltf-viewer/ambience/*.js`                   | IIFE, **no** `import`/`export`, dual export | plain `<script>` in `index.html`, before the `engine-bridge.js` module at `:119` |
| A3, A7–A10 | `src/features/ambience/*.js`                      | IIFE, dual export                  | the ordered list in `src/behavior/boot.js` |

`ViewerEngine.js` is an ES module and **cannot `import`** a non-module script, so
it reads `window.NEXUS_VIEWPORT_BACKGROUND_MANAGER` lazily in its constructor,
null-guarded: if the script is absent the app degrades to colours-only and nothing
throws.

This is why **A5 owns the three `<script>` tags** it adds near `index.html:119` —
a different region of the file from A6's settings grid, and a different wave, so
the two never conflict.
