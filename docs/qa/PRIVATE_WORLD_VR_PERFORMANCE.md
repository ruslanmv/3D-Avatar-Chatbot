# Private World: VR and performance

**No hardware was measured.** Every number on this page comes from headless
Chromium rendering through **SwiftShader** (Google's software Vulkan,
reported as `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`) in
a 4-core cloud container. They are useful as **counts**: draw calls,
triangles, resources, and whether those grow. They are **useless as frame
times**: SwiftShader draws this scene at about 3 frames per second, which says
nothing about a GPU.

**The target.** Quest-class 72 Hz is a 13.9 ms frame budget, and the target
is sustained frame pacing, not an average FPS. **No claim about it can be made
from this page.** It needs the Quest procedure in `docs/VR_STARTUP.md`,
release blocker 4.

## 1. What the scene costs (counts, valid on any renderer)

| | Desktop 1440×860 (`private-cabaret`) | iPhone 13 profile (`private-cabaret-light`) |
| --- | --- | --- |
| Scene file | `cabaret-stage.glb`, 1.31 MB | `cabaret-stage-light.glb`, 0.92 MB |
| Scene triangles (catalogue, measured by the recipe tool) | 68,044 | 25,160 (under `MOBILE_TRIANGLES` 30,000) |
| Draw calls, her + room, per frame | 28 | 26 |
| Triangles drawn per frame, her + room | 108,270 | 65,450 |
| Geometries / textures resident | 36 / 148 | 34 / 148 |
| JS heap (Chromium's coarse `performance.memory`) | 54.2 MB | 51.0 MB |
| Start of Intimate → gate open (includes world load and the Forge check) | 3.0 s | 3.2 s |

The 148 textures are mostly hers (the VRM's), not the room's. The room adds no
lights, no shadows, no post-processing and no animation of its own: a light
preset is a blend of the existing hemisphere and key lights
(`runtime.setMood`), and a dance is the existing clip mixer.

## 2. Software frame times (SwiftShader: not a performance result)

| | Idle, 8 s | Dancing, 8 s |
| --- | --- | --- |
| Desktop: frames / mean / p95 / max | 22 / 369 ms / 417 ms / 500 ms | 23 / 354 ms / 433 ms / 467 ms |
| Phone profile: frames / mean / p95 / max | 25 / 334 ms / 400 ms / 450 ms | 23 / 359 ms / 467 ms / 467 ms |

The only conclusion from this table is relative: dancing does not make the
frame meaningfully slower than idle on the same software renderer.

## 3. Enter/exit cycles (matrix 12)

Three rounds of stopping Intimate (the world is removed) and starting it again
(the world is shown and the gate reopens), measured each time with the room
open:

| | Before | After 1 | After 2 | After 3 |
| --- | --- | --- | --- | --- |
| Desktop geometries / textures / heap | 36 / 148 / 54.2 MB | 36 / 148 / 54.2 | 36 / 148 / 54.2 | 36 / 148 / 54.2 |
| Phone geometries / textures / heap | 34 / 148 / 51.0 MB | 34 / 148 / 51.0 | 34 / 148 / 51.0 | 34 / 148 / 51.0 |

There is no growth in GPU resources; the world's own disposal (VW) holds. The
heap figure is Chromium's bucketed estimate and would hide small leaks;
listener counts were not measured. This is evidence of no gross leak, not
proof of none.

## 4. VR behaviour: what holds by construction, and what is untested

| Requirement | State |
| --- | --- |
| No unsolicited camera movement; never move the person's headset | **Holds by construction**: a spot move re-places the *scene* under her while the view is black (`goToSpot`); the XR camera is never translated or rotated. Framing changes apply on screens only |
| Teleport/blink is the default | **Holds**: every move fades through black; there is no glide |
| Snap turn, smooth locomotion | Not provided by this feature; unchanged app behaviour |
| Personal space, reduced motion | Comfort checks are the existing VW rules (`comfortProblem`); light changes are a cut under reduced motion |
| Overlays readable without covering her | **Fails on the phone profile** (evaluation D5); untested in the headset |
| Audio placed at the scene location | Not applicable: this room adds no positional audio |
| Quest frame pacing at 72 Hz | **Untested: no hardware** |
| Seated use, End reachable in VR | **Untested: no headset** |

## 5. glTF validation and provenance

The cabaret GLBs were already in the catalogue with provenance in
`assets/vr-worlds/PROVENANCE.md`, cut by recipe, and with measured triangles.
The spot files record each GLB's SHA-256, and `tests/living-worlds` re-hashes
it. Running the official Khronos glTF validator over the two GLBs was **not
done** here. It is a recommended step before release, alongside the hardware
run.
