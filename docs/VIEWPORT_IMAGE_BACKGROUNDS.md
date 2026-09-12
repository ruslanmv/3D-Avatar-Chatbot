# Viewport image backgrounds — design and implementation plan

Additive, non-destructive extension of the existing **Settings → VIEWPORT BACKGROUND**
setting so it offers scenic image backgrounds alongside the five solid colours.

Design document. **No production code is part of this change.** Every claim about current
behaviour cites a file and line at commit `251e07b`, and every claim about Three.js cites
the vendored `vendor/three-0.147.0/build/three.module.js` that this app actually runs.

Scope: flat 2D viewport images behind the VRM on desktop/mobile. **Not** 360 panoramas,
GLB environments, ambience audio, particles, HDRI lighting, Quest dioramas, WebXR Layers,
scene rotation, or anything involving AI generation.

---

## A. Current implementation analysis

### A.1 The existing flow, end to end

```
index.html  5 × <input type="radio" name="desktop-bg" value="black|dark|gray|light|white">
            inside  <div class="provider-grid" id="bg-selector">          :1786-1863
     │
     ├── live preview    main.js:2333-2337   querySelectorAll('input[name="desktop-bg"]')
     │                                       → NEXUS_VIEWER.setDesktopBackground(value)
     │
     ├── save            main.js:3342-3345   localStorage['desktop_bg'] = value
     │                                       → setDesktopBackground(value)
     │
     ├── restore (boot)  engine-bridge.js:121-122   localStorage → setDesktopBackground
     │                   main.js:4855-4856          a second restore on the startup path
     │
     └── UI sync         main.js:2627-2628   getVisualState().background → check the radio
                         main.js:2670-2672   pre-select on panel open
```

`ViewerEngine`:

```js
static BG_COLORS = { black: 0x000000, dark: 0x1a1a2e, gray: 0x808080,
                     light: 0xb0b0b0, white: 0xf5f5f5 };            // :1321-1327

this._desktopBgKey = 'black';                                        // :97

setDesktopBackground(key) {                                          // :1559-1569
    const color = ViewerEngine.BG_COLORS[key];
    if (color === undefined) { return; }            // ← unknown keys are silently ignored
    this._desktopBgKey = key;
    if (!this.renderer.xr.isPresenting) {
        this.scene.background = new THREE.Color(color);
    }
}

getVisualState() { return { ..., background: this._desktopBgKey, ... }; }   // :1386-1395
```

Four properties of this code matter for the design:

1. **Unknown keys are already safe.** `setDesktopBackground('ambient:terrace:night')` on
   today's build returns early and changes nothing. So shipping new IDs cannot corrupt an
   older build, and a stale localStorage value from a future build degrades to "background
   unchanged" rather than a crash.
2. **It already guards XR.** While `renderer.xr.isPresenting`, only `_desktopBgKey` is
   updated; the scene is left alone. The desktop/XR split already exists and is correct.
3. **`_desktopBgKey` is the single source of truth** that `getVisualState()` publishes, and
   the Settings UI round-trips through it. Keeping that one field as the identity of the
   selection is what makes this change small.
4. **Boot order is render-mode first, background second** (`engine-bridge.js:119-122`), so
   the persisted background is re-applied on top of the render-mode preset.

### A.2 Finding — `setRenderMode()` resets the background to black

```js
// ViewerEngine.js:1457, inside setRenderMode()
this.setDesktopBackground('black');
```

The comment above it explains the intent: black is the house look in both modes, and the
user's persisted choice is re-applied at boot "on top of this preset". The consequence is
that **switching Anime ↔ Cinematic mid-session resets the viewport background to black**,
today, for colours too (a user on `white` already loses it).

With images this becomes much more visible, so the plan addresses it explicitly in §J as
the one intentional behaviour change, with the alternative documented.

### A.3 Finding — tone mapping is off in the default render mode

```js
// setRenderMode(), ViewerEngine.js:1426-1432
const anime = mode === 'anime';
this.postProcessing?.setEnabled(!anime);
this.setToneMapping(!anime);
```

with `static DEFAULT_RENDER_MODE = 'anime'` (`:1331`). And in the renderer:

```js
this.renderer.outputEncoding = THREE.sRGBEncoding;           // :64
this.renderer.toneMapping = THREE.ACESFilmicToneMapping;     // :65
this.renderer.toneMappingExposure = 1.0;                     // :66
```

`setToneMapping(false)` sets `toneMapping = NoToneMapping` (`:1533`). So:

- **Anime (the default): no tone mapping.** A scenic sRGB image renders essentially as
  authored.
- **Cinematic: ACES Filmic + the post-processing chain.** The image is tone-mapped, so it
  will look flatter and less saturated — exactly as every other surface in that mode does.

This is the answer to the colour-management requirement, and it means **no global
tone-mapping change is needed or wanted** (§10 of the brief). Details in §B.4.

### A.4 Finding — VR exit rebuilds the background from the colour key

```js
// vr-session-start, ViewerEngine.js:344
this._vrSavedBackground = this.scene.background;     // snapshot taken …

// vr-session-end, ViewerEngine.js:499-500
const bgColor = ViewerEngine.BG_COLORS[this._desktopBgKey] ?? 0x000000;
this.scene.background = new THREE.Color(bgColor);    // … and never used
```

`_vrSavedBackground` is **written but never read** — `grep` finds exactly two occurrences,
both assignments (`:332`, `:344`). The exit path reconstructs a `THREE.Color` from the key,
so with an image selected, leaving VR would land on **black** (`?? 0x000000`), not the
image. This single path is the one lifecycle that genuinely must change.

### A.5 The other background writers, and why they are already safe

| Location | Behaviour | Texture-safe? |
|---|---|---|
| `ViewerEngine.js:98` | initial `new THREE.Color(0x000000)` | n/a |
| `ViewerEngine.js:344-346` | VR entry: snapshot, then solid colour | ✅ snapshot is a reference |
| `ViewerEngine.js:499-500` | VR exit: rebuild from key | ❌ **must change** (§A.4) |
| `ViewerEngine.js:586-600` | VR background setting (`black`/`blue`/`void`/`passthrough`); `passthrough` sets `background = null` + `setClearColor(0,0)` | ✅ VR-only, untouched |
| `ARSupport.js:276-282` | saves `scene.background` **and** `scene.environment`, sets background `null` | ✅ reference, any type |
| `ARSupport.js:331-336` | restores both from the snapshot | ✅ restores a Texture correctly |
| `CompanionMode.js:2761-2785` | `_enableTransparentBackground()`: snapshot, `background = null`, `setClearColor(0x000000, 0)` | ✅ reference |
| `CompanionMode.js:2787-2806` | `_applyBackdrop(hex)`: snapshot, `background = null`, opaque clear | ✅ reference |
| `CompanionMode.js:2808-2818` | `_restoreBackground()` | ✅ restores a Texture correctly |

**Three of the four mode transitions already work with a Texture** because they snapshot
and restore the object reference rather than a colour key. Only VR exit is special-cased,
and only because it was written when the background could only ever be a colour.

### A.6 Resize and post-processing

- `ViewerEngine.resize()` (`:905-928`) is debounced at 100 ms and already driven by both
  `window.resize` and `visualViewport` resize/scroll (`:730-742`). It early-returns while
  `window.__COMPANION_ACTIVE__`. **This is the hook for recomputing image fit — no new
  resize subsystem is needed.**
- `PostProcessing` builds `EffectComposer` + `RenderPass(this.scene, this.camera)`
  (`PostProcessing.js:120-123`), so the scene background is rendered inside the composer
  chain. A `scene.background` texture therefore works in Cinematic mode too.

---

## B. Rendering strategy decision

**Decision: Option A — `scene.background = THREE.Texture`.**

The brief asks not to assume this is correct. It is correct, and the reason is a specific
line in the vendored renderer that makes `cover` possible without a custom shader.

### B.1 The enabling fact: r147 applies the texture matrix to the background quad

`WebGLBackground.render()` (`three.module.js:13850-14030`) handles a plain `Texture`
background by lazily creating a `PlaneGeometry(2, 2)` NDC quad with `ShaderLib.background`,
and then:

```js
planeMesh.material.uniforms.t2D.value = background;
planeMesh.material.uniforms.backgroundIntensity.value = scene.backgroundIntensity;

if ( background.matrixAutoUpdate === true ) {
    background.updateMatrix();
}
planeMesh.material.uniforms.uvTransform.value.copy( background.matrix );   // :14008
```

The background quad is a **full-viewport stretch** — so by default an image *is* distorted,
which is the thing the brief worries about. But the shader's UVs run through
`background.matrix`, which three composes from `texture.offset`, `repeat`, `center` and
`rotation`. Since `matrixAutoUpdate` defaults to `true`, setting `offset` and `repeat` is
all that is required:

```glsl
// ShaderChunk.background_frag, three.module.js:13090
vec4 texColor = texture2D( t2D, vUv );
texColor.rgb *= backgroundIntensity;
gl_FragColor = texColor;
#include <tonemapping_fragment>
#include <encodings_fragment>
```

So **`background-size: cover` + `background-position` are expressible as a 2-component
`repeat` and a 2-component `offset`** (§B.3). No custom shader, no extra mesh, no second
scene, no second renderer.

### B.2 Comparison

| Criterion | **A. `scene.background` texture** | B. Dedicated background plane/pass | C. CSS `background-image` behind a transparent canvas |
|---|---|---|---|
| Size of change | **Smallest.** One manager + one method body; background state already lives here | Medium: new mesh, render order, layers, exclusion from raycast/bounds/shadows | Small in CSS, but needs the canvas made transparent whenever an image is selected |
| `ViewerEngine` | Already owns `scene.background` | New scene object to own and hide from other systems | Must null the background and set `clearAlpha 0`, competing with Companion's own policy |
| Companion | **Already snapshots/restores the reference** (`CompanionMode.js:2767-2813`) | Same, plus the plane must be hidden in PiP | Conflicts: Companion already manages transparency and backdrop for itself |
| WebXR | Already snapshots on entry; only the exit path needs fixing (§A.4) | Plane must be explicitly hidden in XR or it floats in the world | Canvas is the XR framebuffer — a CSS layer behind it is not in the headset at all |
| AR / passthrough | **Already handled** — `ARSupport` nulls and restores; three *also* nulls the background when `environmentBlendMode === 'additive'` (`:13875-13882`) | Plane would occlude passthrough unless separately hidden | Works by accident, but see capture |
| Post-processing | Rendered by `RenderPass` inside the composer | Rendered, but ordering/`depthWrite` must be right | **Risk:** composer passes output opaque; a CSS layer behind can be hidden |
| Screenshots / clips | **Captured** — it is canvas pixels | Captured | **Broken.** `ClipRecorder` uses `canvas.captureStream` (`ClipRecorder.js:272-279`) and `ShareCard.toDataURL()` (`ShareCard.js:201-204`). A CSS background is not in the canvas, so clips and share cards would lose the scenery |
| Context restoration | three re-uploads the texture | Same | n/a |
| Resize | `repeat`/`offset` recomputed in existing `resize()` | Quad rescale in `resize()` | Free (native CSS) |
| Mobile | Fine | Fine | Fine |
| Tone mapping control | **No control** — three's internal material is a closure; `toneMapped` cannot be set | Full control (`toneMapped = false`) | Full control (outside WebGL) |
| Colour management | Correct via `texture.encoding` | Manual | Native |

Option C is eliminated by capture: the clip/share feature exists and would silently start
producing avatars on a void background. Option B buys only tone-mapping control and costs
a scene object that every raycast, bounding-box and XR path would have to learn to ignore.

**Option A wins on change size while matching every existing lifecycle.** Its one real
weakness is tone mapping, and §A.3 shows that weakness does not bite in the default mode.

### B.3 Cover / focal-point maths

```
imageAspect = iw / ih            viewAspect = vw / vh

if (imageAspect > viewAspect)    // image wider than viewport → crop left/right
    repeat = ( viewAspect / imageAspect , 1 )
else                             // image narrower → crop top/bottom
    repeat = ( 1 , imageAspect / viewAspect )

offset.x =        focalX  * (1 - repeat.x)        // focalX  0 = left, 1 = right
offset.y = (1 - focalY) * (1 - repeat.y)          // focalY  0 = top,  1 = bottom
```

`repeat ≤ 1` on both axes, so the visible window is always a sub-rectangle of the image:
**cover, never stretch, never tile.** Required texture configuration:

```js
texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;   // default; must NOT be Repeat
texture.generateMipmaps = false;                             // background draws ~1:1
texture.minFilter = THREE.LinearFilter;                      // required once mips are off
texture.encoding = THREE.sRGBEncoding;                       // see B.4
```

`ClampToEdgeWrapping` + `LinearFilter` + no mips is also what makes the non-power-of-two
asset size (1672×941) safe.

The vertical term inverts `focalY` because `TextureLoader` sets `flipY = true`, so the
image's top row sits at `v = 1`. Sanity checks: `focalY = 0` → `offset.y = 1 - repeat.y`
(window at the top of the image) ✓; `focalY = 1` → `offset.y = 0` (bottom) ✓; `0.5` →
centred ✓. **Confirm this once visually during implementation** with a deliberately tall
viewport and a `top`-focal scene — an inverted vertical axis is the one error in this
formula that looks plausible until you compare against the source image.

**Verified numerically** against the real asset size (1672×941) before writing this
plan. For 1920×1080, 1280×1024, 390×844 (portrait), 1672×941 (exact) and 3440×1440
(ultrawide): the visible sub-rectangle's aspect equals the viewport aspect in every case,
and the window stays inside `[0,1]` on both axes. Focal extremes behave correctly on
whichever axis is actually cropped — on a 3440×1440 viewport, `focalY` 0 / 0.5 / 1 gives a
v-window of `[0.256, 1.0]` / `[0.128, 0.872]` / `[0.0, 0.744]` (top / centred / bottom); on
a 390×844 viewport, `focalX` 0 / 0.5 / 1 gives `[0, 0.260]` / `[0.370, 0.630]` /
`[0.740, 1.0]` (left / centred / right). Note that on a *portrait* viewport with a
landscape image only the horizontal axis crops, so `focalY` correctly has no effect there —
`repeat.y === 1` leaves nothing to pan.

`focalPoint` is authored as a CSS-style string (`center`, `center top`, `45% center`) to
stay compatible with the `yourfriend` catalogue, and parsed to `{focalX, focalY}` by a
~20-line parser supporting the keywords and percentages. Unparseable → `center`.

### B.4 Colour management and tone mapping

- **`texture.encoding = THREE.sRGBEncoding` is required.** In the vendored build,
  `internalFormat = ( encoding === sRGBEncoding && forceLinearEncoding === false ) ? 35907
  : 32856` (`three.module.js:22614`) — `35907` is `SRGB8_ALPHA8`, so the GPU sampler does
  the sRGB→linear decode. Without it the image samples as if it were linear and renders
  too dark/contrasty.
- **The background is tone-mapped when tone mapping is on.** The program parameter is
  `toneMapping: material.toneMapped ? renderer.toneMapping : NoToneMapping`
  (`three.module.js:19428`), and three's internal `BackgroundMaterial` is a `ShaderMaterial`
  with the default `toneMapped = true`. It is created inside a closure with no public
  handle, so **we cannot opt the background out of ACES.**
- Per §A.3 this only applies in **Cinematic** mode. In the default **Anime** mode tone
  mapping is `NoToneMapping`, so sRGB decode → no tonemap → sRGB encode is an identity
  round trip and the image looks as authored.
- **Do not change global tone mapping for this feature.** Instead:
  1. grade the curated starter images so they read well in Anime (the default), and
  2. expose an optional per-scene `intensity` that the manager writes to
     `scene.backgroundIntensity` (present in r147 — `Scene` sets it at
     `three.module.js:29207-29208`), defaulting to `1`. It is a cheap, data-only
     brightness trim for any image that sits wrong in Cinematic.
- If visual review later judges ACES unacceptable for images in Cinematic, the upgrade is
  Option B **behind the same manager API** — one file changes, because the manager is the
  seam. That is a deliberate, deferred decision, not a V1 requirement.

### B.5 What Option A does *not* touch

`scene.background` and `scene.environment` are independent in three; only `environment`
feeds IBL (`WebGLCubeUVMaps`/PMREM). Setting a background texture therefore **cannot**
alter `scene.environment`, PMREM, `RoomEnvironment`, MToon shading, or any light. The
existing `setEnvironmentMap()` path is untouched, satisfying §9 of the brief by
construction rather than by discipline.

---

## C. Additive architecture

```
         index.html  (#bg-selector: 5 static colour cards, unchanged)
                │                    + #bg-scene-grid (rendered from the catalogue)
                ▼
  main.js   one delegated 'change' listener on name="desktop-bg"
                │           (value = the stable ID, colour or image alike)
                ▼
  ViewerEngine.setDesktopBackground(id)        ← SAME public method, same name
                │
                ├── id in BG_COLORS?  ──yes──► existing colour path (byte-identical)
                │
                └── no ──► ViewportBackgroundManager.apply(id)
                              │
                              ├── ViewportBackgroundCatalog.get(id)  (data only)
                              ├── TextureLoader + generation token
                              ├── cover/focal transform
                              ├── dispose previous texture
                              └── scene.background = texture
                                  scene.backgroundIntensity = entry.intensity ?? 1
```

Two new files, both under `src/gltf-viewer/ambience/`. The manager owns background
texture lifecycle and nothing else: no rendering, no lights, no resize registration of its
own (`ViewerEngine.resize()` calls into it), no XR policy.

`_desktopBgKey` remains the single source of truth for *which* background is selected, so
`getVisualState()` and every Settings round-trip keep working unchanged.

---

## D. Background data model

Normalised entries, one shape per kind. The renderer never sees a URL it did not get from
the catalogue.

```js
// colour — describes the five existing values; the authority stays BG_COLORS
{ id: 'black', type: 'color', label: 'Black', swatch: '#000000' }

// image
{
  id: 'ambient:terrace:night',          // stable, independent of the file name
  type: 'image',
  label: 'Coastal Terrace',
  variantLabel: 'Twilight',             // UI composes "Coastal Terrace — Twilight"
  src: 'assets/ambient/dark/coastal-terrace-twilight.webp',
  thumb: 'assets/ambient/dark/coastal-terrace-twilight.webp',  // same file in V1
  focalPoint: 'center',                 // CSS-style; parsed to {focalX, focalY}
  intensity: 1                          // optional → scene.backgroundIntensity
}
```

- `id` is the persisted value and the radio `value`. It never contains an asset path, so
  re-encoding or moving files does not invalidate a user's saved selection.
- `label` / `variantLabel` are UI-only and may be changed or localised freely.
- `thumb` is a separate field from day one so a smaller thumbnail can be introduced later
  as a data change.
- **No executable content.** Entries carry strings and numbers only; `src`/`thumb` are
  validated as same-origin relative paths (§T).

### ID format

`ambient:<scene>:<variant>` — e.g. `ambient:terrace:night`, `ambient:sky:day`.

- The `ambient:` namespace makes old vs. new unambiguous and gives a single place to
  detect "an image ID I do not recognise" for fallback.
- Colons are safe in the existing code: every lookup is a quoted attribute selector,
  `input[name="desktop-bg"][value="${vis.background}"]` (`main.js:2627`, `:2671`), which
  handles `:` without escaping.
- Scene and variant are separate segments so a future day/night resolver could map
  `ambient:terrace` → a variant without changing stored IDs.

---

## E. Persistence

**`desktop_bg` continues to be the only key. No new key. No migration.**

| Case | Stored value | Result |
|---|---|---|
| Existing user | `black` / `dark` / `gray` / `light` / `white` | `BG_COLORS` hit → identical code path, identical pixels |
| New image selection | `ambient:terrace:night` | catalogue hit → image applied |
| Value removed from the catalogue | `ambient:gone:day` | miss → fall back to `black`, warn once, **and rewrite `desktop_bg` to `black`** so the fallback is sticky rather than re-warning every boot |
| Stored by a newer build, opened by an older one | `ambient:…` | `setDesktopBackground` returns early (`:1561-1563`) → background unchanged, no crash |

`main.js:3342-3345` (save) and `engine-bridge.js:121-122` (restore) need **no change**:
both pass an opaque string through, which is already how they work. The UI-sync selectors
also need no change because the scene radios share `name="desktop-bg"`.

One genuine gotcha: `main.js:2333` binds with
`querySelectorAll('input[name="desktop-bg"]').forEach(...)` **once**, so radios injected
later would get no listener. Fix with a single delegated `change` listener on the settings
container (recommended — it is listener-count-neutral and order-independent), or render the
scene cards before that binding runs. Delegation is the smaller, more robust change.

---

## F. Light / dark design

**There is no global light/dark theme in this repository.** Two independent greps across
`src/`, `index.html`, `styles/` and `css/` for `data-theme`, `prefers-color-scheme`,
`localStorage 'theme'`, `light-theme` and `dark-theme` return **zero hits**. `yourfriend`
can pair `lightImage`/`darkImage` because it has a `theme` value to switch on
(`AmbientSlider.tsx:13`); this app does not.

Per the brief's instruction not to invent a theme system for this feature:

> **Each variant is its own catalogue entry and its own radio card.**

```
Coastal Terrace — Twilight      ambient:terrace:night
Coastal Terrace — Day           ambient:terrace:day
```

- Zero new state, zero new localStorage key, zero new architecture.
- The user sees exactly what they will get, which for a deliberately-chosen backdrop is
  better UX than an implicit resolver.
- The data model already keeps `scene` and `variant` separate, so if a real theme system
  arrives later, `ambient:terrace` can be added as a resolving alias **additively**.

For V1 the grid would be large with all ten, so ship **five entries** — one per scene,
choosing the variant that best suits the app's dark UI (the `dark/` set) — and keep the
five `light/` files in the repo, catalogued but commented out or behind a "Day" group, to
be enabled once the grid layout is reviewed. That keeps the first PR's UI small while the
assets land once.

---

## G. Asset strategy

**Local files for the first implementation.** Measured from the `yourfriend` checkout:

| | Count | Dimensions | Total |
|---|---|---|---|
| `public/ambient/dark/*.webp` | 5 | 1672×941 each | 672 KB |
| `public/ambient/light/*.webp` | 5 | 1672×941 each | 610 KB |
| **All ten** | 10 | | **≈1.28 MB** |

1.28 MB of WebP for the complete curated set is small enough that local files beat a CDN
for V1: no CORS, no new origin to configure, no network dependency, works offline, and the
app already serves static files through `nexus-proxy`. Copy into
`assets/ambient/{light,dark}/`, keeping the upstream filenames so provenance is obvious.

Do **not** reference `github.com/.../blob/...` URLs at runtime — those are HTML pages, not
assets.

**Licensing note before copying:** `ruslanmv/yourfriend` has **no `LICENSE` file**, so it
is all-rights-reserved by default. Both repositories share one owner, so this is almost
certainly a formality — but confirm the images are the owner's own work (or
commercially-licensed) and record that, because copying them into this repo redistributes
them under this repo's Apache-2.0 `LICENSE`.

**Resolution note:** 1672×941 upscales slightly on a 4K-wide viewport. Acceptable for a
defocused backdrop, and replacing the set with larger files later is a pure data change.

### Transition to 3D-Ambience-Studio

`ViewportBackgroundCatalog` is the seam. V1 has one source; later a second is added:

```
ViewportBackgroundCatalog
    ├── colors            (BG_COLORS, built in)
    ├── localImages       (assets/ambient/backgrounds.json)           ← V1
    └── studioCatalog     (fetch published catalog.json from the CDN) ← later
```

The manager consumes normalised entries and never learns where they came from, so adding
the remote source touches the catalogue only — not the rendering layer.

**Schema gap (do not paper over it):** the Studio's `schemas/environment.schema.json`
describes `variants.{desktop,quest}` as **panorama** (equirectangular) assets. A flat
scenic image is *not* a panorama, and mapping one onto the other would make the runtime
misrender it as a 360 environment. The future change is a **separate Studio proposal** to
add a flat variant kind, e.g.:

```json
"variants": { "desktop": { "kind": "image", "src": "...", "focalPoint": "center" } }
```

Recommended, **not** part of this task: do not modify `3D-Ambience-Studio` here. Until
such a variant kind exists, the Studio catalogue cannot supply this feature, which is
another reason V1 is local-only.

---

## H. Texture lifecycle

```
apply(id)
  │
  ├─ token = ++this._generation                  ← race guard
  ├─ entry = catalog.get(id)        miss → fallback to 'black', warn, persist, return
  │
  ├─ colour entry → dispose active texture; scene.background = new THREE.Color(...); return
  │
  └─ image entry
       ├─ loader.load(entry.src)
       │      ↓ (async)
       ├─ if (token !== this._generation) { texture.dispose(); return; }   ← STALE, drop it
       ├─ configure: encoding sRGB, ClampToEdge, generateMipmaps false, LinearFilter
       ├─ applyCoverTransform(texture, entry, viewportSize)
       ├─ previous = scene.background
       ├─ scene.background = texture
       ├─ scene.backgroundIntensity = entry.intensity ?? 1
       └─ if (previous?.isTexture && previous !== texture) previous.dispose();
              ↑ dispose only AFTER the swap, so no frame can sample a freed texture
```

- **Race protection** is a monotonic generation counter compared after the await. `Forest →
  Beach → Lake` in quick succession: only the load whose token still matches wins, and the
  two losers dispose their own textures. This satisfies §21 exactly.
- **Failure** (`onError`): log one `console.warn` with the id and URL, **keep the current
  background**, and leave `_desktopBgKey` pointing at the last successfully applied entry
  so `getVisualState()` never advertises a background that is not on screen. No stack
  traces in the UI, no invalid scene state.
- **Memory.** 1672×941×4 B = **6.3 MB** resident per texture; mips would add ~33%, which is
  why `generateMipmaps = false` is specified. **V1 caches nothing**: exactly one background
  texture is alive at a time. A scene-switch costs one ~180 KB fetch (then HTTP cache) and
  one upload. An LRU cache is a later optimisation with a real memory cost and no current
  need.
- **Thumbnails stay in the DOM** as `<img>`/CSS and never become WebGL textures.
- **Per-frame cost is zero.** Nothing is created or uploaded during render; three's
  `updateMatrix()` on the background texture is a 3×3 compose, which it already does for
  every texture with `matrixAutoUpdate`.
- **Resize**: `ViewerEngine.resize()` (`:905`) calls
  `backgroundManager.onResize(w, h)`, which recomputes `repeat`/`offset` on the *existing*
  texture. No reload, no new texture, no new listener.
- **Context loss**: three re-uploads from `texture.image`, which the manager still holds.

---

## I. Companion / VR / AR lifecycle

The policy in all three cases is **leave the existing behaviour exactly as it is, and make
"restore the desktop background" go through the manager** instead of rebuilding a colour.

### desktop → Companion → desktop

```
image selected              scene.background = <Texture>
enter Companion             CompanionMode._enableTransparentBackground()   :2761-2785
                              _savedBackground = <Texture>   (reference — already correct)
                              scene.background = null ; setClearColor(0x000000, 0)
                            → PiP shows the avatar floating, as it does today
exit Companion              _restoreBackground()                          :2808-2818
                              scene.background = <Texture>   ← same object, still valid
                            + ViewerEngine.resize() runs on the way out → cover recomputed
```

**No change to `CompanionMode.js`.** Its transparent-by-default policy
(`transparentBackground = true`) is preserved deliberately: a scenic image in a 340×460 PiP
bubble is visual noise and costs the same 6.3 MB for no benefit. The one thing to verify in
testing is that the cover transform is recomputed for the main window's size after exit,
since `resize()` early-returns while `__COMPANION_ACTIVE__` is set (`:909`).

### desktop → VR → desktop

```
image selected              scene.background = <Texture>
enter VR      :337-346      _vrSavedBackground = <Texture>   (already snapshotted)
                            scene.background = new THREE.Color(black|blue)
                            → VR background options (black / blue / void / passthrough)
                              behave EXACTLY as today. No flat image in the headset.
exit VR       :499-500      ✗ today: new THREE.Color(BG_COLORS[_desktopBgKey] ?? 0x000000)
                            ✓ change: backgroundManager.reapplyCurrent()
                              → colour ID → the same colour as before
                              → image ID  → re-apply the live texture (no refetch)
```

This is the **only required lifecycle change**, and it is two lines. Implementation note:
`reapplyCurrent()` should re-use the already-loaded texture rather than reload, so leaving
VR is instant. `_vrSavedBackground` then becomes either the mechanism or dead code —
routing through the manager keeps one source of truth, so the field can simply be deleted
as optional cleanup (it is currently written and never read; see §A.4).

Also note `setDesktopBackground`'s existing XR guard (`:1561-1564`): selecting a background
*while in VR* updates `_desktopBgKey` only. That remains correct and the manager must
honour it — for an image it should record the selection and defer the load until exit, so a
headset never pays for a texture it cannot see.

### desktop → AR / passthrough → desktop

```
image selected              scene.background = <Texture>
enter AR      ARSupport:276-282   _savedBackground = <Texture>; _savedEnvironment = …
                                  scene.background = null   → camera feed visible
                            three also nulls the background when
                            session.environmentBlendMode === 'additive'  (:13875-13882)
exit AR       ARSupport:331-336   scene.background = _savedBackground   ← Texture restored
```

**No change to `ARSupport.js` and no change to `PassthroughEnhancer.js`.** The snapshot is
a reference, so it already round-trips a texture. The image cannot obscure passthrough
because the background is nulled on entry — by the app, and independently by three for
additive blend modes.

---

## J. Exact repository changes

### CREATE

| File | Why |
|---|---|
| `src/gltf-viewer/ambience/ViewportBackgroundManager.js` | Texture lifecycle: load, cover transform, race token, dispose, failure fallback, resize, re-apply. ~180 lines. The seam that lets the rendering technique change later. |
| `src/gltf-viewer/ambience/ViewportBackgroundCatalog.js` | Normalised entries from `BG_COLORS` + the local image list; ID resolution; the future Studio/CDN source plugs in here. ~80 lines. |
| `assets/ambient/backgrounds.json` | Data-driven scene list. JSON, not JS, so it can later be swapped for a fetched catalogue with no code change. |
| `assets/ambient/dark/*.webp` (5) | Starter assets, ~672 KB (§G). |
| `assets/ambient/light/*.webp` (5) | Starter assets, ~610 KB — land once, surface in the UI per §F. |
| `tests/viewport-background.test.js` | Unit tests for the cover maths, the race token, ID fallback and failure handling (Jest + jsdom, matching the existing suite). |

### MODIFY

| File | Change | Why |
|---|---|---|
| `src/gltf-viewer/ViewerEngine.js` | 1. Instantiate the manager in the constructor. 2. `setDesktopBackground(id)`: colour → unchanged path; otherwise delegate to the manager (keep the early-return for genuinely unknown IDs). 3. VR exit `:499-500` → `backgroundManager.reapplyCurrent()`. 4. `resize()` → `backgroundManager.onResize(w, h)`. 5. `setRenderMode` `:1457` → see the behaviour note below. | The only engine-side integration points. Public API name and signature unchanged. |
| `src/main.js` | Render the scene cards from the catalogue into the new grid; switch the `desktop-bg` binding at `:2333` to one delegated listener. | Dynamically-added radios need a delegated listener; everything else (save `:3342`, sync `:2627`, pre-select `:2670`) already works on opaque string values. |
| `index.html` | Add `<div class="provider-grid" id="bg-scene-grid">` plus a "Scenes" sub-heading after the existing `#bg-selector`. **No change to the five existing colour cards.** | The UI container; cards themselves are data-driven. |
| `styles/main.css` | Add `.provider-thumb` (aspect-ratio 16/9, `background-size: cover`, rounded) and a thumbnail variant of `.provider-content`. | Reuses `provider-grid` / `provider-card` / `provider-radio` and the existing `:checked + .provider-content` selected state. |

`src/engine-bridge.js` — **no change needed.** `localStorage.getItem('desktop_bg')` →
`setDesktopBackground(savedBg)` (`:121-122`) already passes an opaque string.

#### The one intentional behaviour change

`setRenderMode()` currently forces `setDesktopBackground('black')` (`:1457`), so switching
Anime ↔ Cinematic discards the user's background — including an image. Recommended:

```js
this.setDesktopBackground(this._desktopBgKey || 'black');   // preserve the selection
```

This is a deliberate, reviewable change: it also stops a render-mode switch resetting a
user's `white` choice, which is arguably the existing bug. Note it in the PR description
and cover it with a test. **Alternative if the team wants literally zero change for
colours:** keep `'black'` for colour keys and preserve only image selections. That is
inconsistent and harder to explain, so it is the fallback, not the recommendation.

### DO NOT TOUCH

| File | Why |
|---|---|
| `src/CompanionMode.js` | Already snapshots/restores the background reference correctly (§I). Its transparent policy is deliberate. |
| `src/gltf-viewer/ARSupport.js` | Already snapshots/restores correctly. |
| `src/gltf-viewer/PassthroughEnhancer.js` | Does not touch `scene.background` at all. |
| `src/gltf-viewer/VRSupport.js` | VR background options are unchanged by this feature. |
| `src/gltf-viewer/PostProcessing.js` | `RenderPass` already renders the background; nothing to change. |
| `AvatarManager.js`, `VRControllers.js`, `VRPoseSystem.js`, `VRPuppetInteraction.js`, `VRIntimacySystem.js`, `VRGazeController.js`, `VRMediaPanel.js` | No scene-graph object is added, so nothing raycasts, frames or picks differently. |
| LLM / TTS / chat / animation / face tracking | Unrelated. |
| `vendor/three-0.147.0/**` | Vendored; `uvTransform` support means no patch is needed. |
| `3D-Ambience-Studio` (any file) | Out of scope; the schema gap is documented in §G as a future proposal. |

---

## K. Test plan

Unit (Jest + jsdom, no WebGL):

| Test | Asserts |
|---|---|
| Cover maths, wide viewport | `repeat.x < 1`, `repeat.y === 1`, window inside `[0,1]` |
| Cover maths, tall viewport | `repeat.y < 1`, `repeat.x === 1` |
| Cover maths, exact aspect match | `repeat === (1,1)`, `offset === (0,0)` |
| Focal parsing | `center`, `center top`, `45% center`, `left bottom`, garbage → `center` |
| Focal application | `top` pins the window to the image top (guards the flipY inversion) |
| Race token | resolving loads in order C, A, B leaves **B** active; A and C are disposed |
| Unknown ID | falls back to `black`, warns once, rewrites `desktop_bg` |
| Load failure | previous background retained; `_desktopBgKey` unchanged; one warning |
| Colour path | all five existing keys produce the exact `BG_COLORS` values |
| Catalogue entries | every `src`/`thumb` is a relative same-origin path; no entry carries a function |

Manual / regression matrix:

| Area | Case | Expected |
|---|---|---|
| Existing colours | Black, Dark Blue, Gray, Light, White | Identical to today |
| Images | each scene selected | Loads, renders behind the avatar, no distortion |
| Persistence | select image → reload | Same image returns |
| Persistence | select image → select Black → reload | Black |
| Switching | image → colour → image → colour, repeatedly | Correct every time, no leak |
| Rapid switching | click 3 scenes fast | Last click wins |
| Failure | rename one asset on disk | Previous background kept, warning, no crash |
| Resize | landscape ↔ portrait, narrow desktop, mobile rotate | Cover preserved, no stretch |
| Render mode | Anime ↔ Cinematic with an image selected | Image preserved (per §J); avatar shading unchanged |
| Render mode | colours in both modes | Unchanged behaviour aside from the documented preservation |
| Lighting | image selected | `scene.environment`, lights and MToon identical; **verify `scene.environment` is untouched** |
| Companion | image → enter → exit | Existing PiP behaviour; image restored and re-fitted |
| VR | image → enter VR → exit | VR shows black/blue/void/passthrough as today; image restored on exit |
| VR | select an image *while in VR* | No visible change in-headset; applied on exit |
| AR | image → enter passthrough → exit | Camera feed not obscured; image restored |
| Clips | record a clip with an image selected | Scenery present in the recording (the Option C regression we avoided) |
| Memory | switch scenes 20× | Live WebGL texture count returns to 1; no monotonic growth |
| Perf | image selected, idle | No per-frame allocation; frame time unchanged |
| A11y | keyboard through the grid | Focus visible, arrow keys move between radios, labels announced |

---

## L. PR plan

**One focused PR is achievable**, but two are cleaner to review because the second is
pure data and UI:

**PR 1 — background manager + catalogue + lifecycle (code)**
Creates both modules; wires `ViewerEngine` (5 integration points); fixes the VR exit path;
unit tests. Ships with the colour catalogue only plus **one** image entry behind the
existing grid for testing. Reviewable as "does the lifecycle hold", independent of art.
Rollback: revert; colours are untouched throughout.

**PR 2 — assets, catalogue data, Settings UI (data + presentation)**
Adds the ten WebP files and `backgrounds.json`; adds the Scenes grid, thumbnail CSS, and
the delegated listener; the full manual matrix. Rollback: remove the grid; the manager
idles with no image entries.

Optional **PR 3** — crossfade. Not required (§32). Only if it can be done by holding the
outgoing texture for one short tween while honouring
`prefers-reduced-motion: reduce`, with no change to the manager's public API. If it needs
architectural room, drop it.

---

## RECOMMENDED IMPLEMENTATION

```text
Rendering technique:
    scene.background = THREE.Texture, with cover implemented through the texture
    matrix (texture.repeat + texture.offset). Verified possible because the vendored
    r147 copies background.matrix into the background shader's uvTransform uniform
    (three.module.js:14008) — no custom shader, no extra mesh, no second scene, no
    second renderer. Rejected: a dedicated plane (adds a scene object every raycast,
    bounding box and XR path must learn to ignore) and a CSS layer behind a
    transparent canvas (silently removes the scenery from ClipRecorder's
    canvas.captureStream and ShareCard's toDataURL, and is invisible in XR).

Manager/module:
    src/gltf-viewer/ambience/ViewportBackgroundManager.js   — texture lifecycle only
    src/gltf-viewer/ambience/ViewportBackgroundCatalog.js   — normalised entries
    No AmbientSceneManager. No future-feature scaffolding.

Existing API preserved:
    viewer.setDesktopBackground(value) keeps its name and signature. Colour keys take
    the byte-identical existing path. getVisualState().background still returns
    _desktopBgKey, so every Settings round-trip is unchanged.

Persistence:
    localStorage['desktop_bg'] only. No new key, no migration. Colours store as today;
    images store as 'ambient:<scene>:<variant>'. Unknown IDs fall back to black, warn
    once, and rewrite the key so the fallback sticks. An older build ignores an image
    ID safely because setDesktopBackground already early-returns on unknown keys.

Image catalog:
    assets/ambient/backgrounds.json, loaded through ViewportBackgroundCatalog.
    Data only — strings and numbers, no executable content, relative same-origin paths.

Initial assets:
    Local. The ten curated yourfriend WebPs (5 light + 5 dark), all 1672x941,
    ~1.28 MB total, copied to assets/ambient/{light,dark}/. Confirm their licence
    first: yourfriend has no LICENSE file. Surface the five dark scenes in V1's grid.

Image fit strategy:
    cover + focal point. repeat = (viewAspect/imageAspect, 1) when the image is wider,
    else (1, imageAspect/viewAspect); offset.x = focalX*(1-repeat.x),
    offset.y = (1-focalY)*(1-repeat.y) — the vertical inversion is flipY, and must be
    confirmed once visually. ClampToEdgeWrapping, generateMipmaps false, LinearFilter,
    encoding = sRGBEncoding. focalPoint authored as a CSS-style string.

Texture lifecycle:
    One live texture at a time, no cache in V1 (6.3 MB resident each). Monotonic
    generation token discards stale async loads and disposes them. Previous texture
    disposed only after the swap. Failure keeps the current background and warns once.
    resize() recomputes repeat/offset on the existing texture — no reload. Zero
    per-frame work.

Companion behavior:
    Unchanged. CompanionMode already snapshots and restores the background reference,
    so its transparent-by-default PiP policy is preserved and the image returns on
    exit. No edit to CompanionMode.js. Verify the cover transform is recomputed for
    the main window after exit, because resize() early-returns while Companion is active.

VR behavior:
    Unchanged in-headset: black / blue / void / passthrough exactly as today, never a
    flat image. One required fix: VR exit (ViewerEngine.js:499-500) currently rebuilds
    a THREE.Color from _desktopBgKey and would land on black with an image selected —
    route it through backgroundManager.reapplyCurrent() and re-use the loaded texture.
    _vrSavedBackground is today written and never read; routing through the manager
    makes it removable.

AR behavior:
    Unchanged. ARSupport saves and restores both background and environment by
    reference, so a texture round-trips. The image cannot obscure passthrough: the
    app nulls the background on entry, and three independently nulls it for additive
    blend modes. No edit to ARSupport.js or PassthroughEnhancer.js.

3D-Ambience-Studio compatibility:
    The catalogue is the seam: colors + localImages now, a studioCatalog adapter later,
    with no change to the rendering layer. Note the real gap — the Studio's environment
    schema describes panorama variants, and a flat scenic image is not a panorama.
    Recommended future Studio proposal (NOT part of this task): a flat variant kind,
    e.g. variants.desktop.kind = "image" with src and focalPoint.

Files to create:
    src/gltf-viewer/ambience/ViewportBackgroundManager.js
    src/gltf-viewer/ambience/ViewportBackgroundCatalog.js
    assets/ambient/backgrounds.json
    assets/ambient/dark/*.webp, assets/ambient/light/*.webp
    tests/viewport-background.test.js

Files to modify:
    src/gltf-viewer/ViewerEngine.js  (construct manager; setDesktopBackground delegation;
                                      VR-exit restore; resize hook; setRenderMode preserve)
    src/main.js                      (render scene cards; delegated desktop-bg listener)
    index.html                       (add #bg-scene-grid + "Scenes" heading)
    styles/main.css                  (.provider-thumb)

Files not to touch:
    CompanionMode.js, ARSupport.js, PassthroughEnhancer.js, VRSupport.js,
    PostProcessing.js, engine-bridge.js, AvatarManager.js, all VR* interaction modules,
    LLM/TTS/chat/animation/face-tracking, vendor/three-0.147.0/**, 3D-Ambience-Studio.
```

### IMPLEMENTATION ORDER

1. **Confirm asset rights** for the ten WebPs and record it (§G). Blocks nothing else.
2. **`ViewportBackgroundCatalog`** — wrap `BG_COLORS` as `type: 'color'` entries, load
   `backgrounds.json`, implement `get(id)` and fallback. Unit-test ID resolution first;
   nothing renders yet.
3. **Cover maths as a pure function** — `computeCoverTransform(imageAspect, viewAspect,
   focal) → {repeat, offset}`, fully unit-tested including the `top`-focal case. Pure and
   testable without WebGL; get it right before any renderer wiring.
4. **`ViewportBackgroundManager`** — load, configure, apply, generation token, dispose,
   failure fallback, `onResize`, `reapplyCurrent`. Unit-test the token with fake loaders.
5. **Wire `ViewerEngine`** — construct the manager; delegate in `setDesktopBackground`;
   hook `resize()`. Verify the five colours are untouched **before** adding any image.
6. **Fix the VR exit path** to `reapplyCurrent()`, and run the VR enter/exit matrix with a
   colour selected (no image yet) to prove no regression.
7. **Add one image entry** and a temporary radio; verify load, cover on resize, rapid
   switching, failure, and that `scene.environment` is untouched. *End of PR 1.*
8. **Copy the assets**, fill `backgrounds.json`, render the Scenes grid from the catalogue,
   add `.provider-thumb`, switch to the delegated listener.
9. **Decide the `setRenderMode`** preservation change and test Anime ↔ Cinematic.
10. **Run the full matrix** in §K, especially Companion → exit, VR → exit, AR → exit, and
    a recorded clip.
11. **Accessibility pass** — keyboard, focus, labels, no duplicate alt text on decorative
    thumbnails. *End of PR 2.*

### DO NOT DO

```text
Do not use scene.environment, PMREM or RoomEnvironment for the background image.
    V1 is visual only; avatar lighting must be bit-identical.

Do not change renderer.toneMapping, toneMappingExposure or outputEncoding.
    Tone mapping is already off in the default Anime mode; use the per-scene
    intensity field (scene.backgroundIntensity) if an image needs trimming.

Do not add a second renderer, a second scene, or a second resize subsystem.
    ViewerEngine.resize() already fires on window resize and visualViewport changes.

Do not put the image behind a transparent canvas via CSS.
    It disappears from ClipRecorder's captureStream and ShareCard's toDataURL, and
    it does not exist in an XR framebuffer.

Do not show a flat rectangular image as an immersive VR environment.
    A flat quad in a headset reads as a billboard. VR keeps black/blue/void/passthrough.

Do not edit CompanionMode.js, ARSupport.js or PassthroughEnhancer.js.
    All three already handle a Texture background correctly by reference.

Do not cache every background as a WebGL texture.
    6.3 MB each. One live texture in V1; revisit with a measurement.

Do not turn thumbnails into WebGL textures. They are DOM images.

Do not add a global light/dark theme system for this feature.
    No theme state exists in this repository; ship explicit Day/Twilight entries.

Do not add scene rotation, timers, carousels or autoplay. The selection is sticky.

Do not add ambience audio, particles, rain, video, GLB props or panoramas.

Do not add AI generation, model inference, or any Studio API call to this repository.

Do not introduce React or any framework for the Settings cards.
    The existing provider-grid / provider-card / provider-radio pattern is enough.

Do not create new localStorage keys. desktop_bg carries the whole selection.

Do not let catalogue entries carry code, HTML or absolute third-party URLs.

Do not modify vendor/three-0.147.0/**. uvTransform support is already there.

Do not modify 3D-Ambience-Studio. The flat-image schema gap is a separate proposal.
```

---

## Security notes (§41)

- Catalogue entries are **data only**: strings and numbers. No `eval`, no injected HTML, no
  remote scripts. Reject any entry whose `src`/`thumb` is not a relative, same-origin path
  without `..` — validated in the catalogue, before the loader ever sees it.
- Labels are inserted with `textContent`, never `innerHTML`, so a future remote catalogue
  cannot inject markup into Settings.
- When a remote (Studio/CDN) source is added later: allowlist the origin, require HTTPS,
  set `crossOrigin = 'anonymous'` on the loader (the app already does this for glTF at
  `ViewerEngine.js:156`) and configure CORS on the bucket. Out of scope here.

## Definition of Done

Checked against the brief's §43, all of which this design satisfies:

all five existing colours unchanged · scenic images selectable · thumbnails in VIEWPORT
BACKGROUND · cover without distortion · selection persists · avatar animation never stops
(no reload, no reframe, no camera reset) · chat/TTS untouched · render modes unaffected ·
`scene.environment` and lighting untouched · Companion still works · VR backgrounds still
independent · AR/passthrough still works · desktop image restored after leaving XR · rapid
switching race-safe · invalid image fails safely · previous texture disposed · default
remains Black · no second renderer · no second scene · no AI generation in this repository ·
catalogue can later consume Studio-published static assets.
