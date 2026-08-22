# Keyboard Reference

Every keyboard shortcut in the desktop app, and the reasoning behind the
choices. The mouse already orbits, dollies and pans through OrbitControls —
this is the keyboard half.

Implemented in [`src/gltf-viewer/CameraKeyboard.js`](../src/gltf-viewer/CameraKeyboard.js)
with the arithmetic in [`CameraFraming.js`](../src/gltf-viewer/CameraFraming.js).

## Camera

| Key                        | Action                                    |
| -------------------------- | ----------------------------------------- |
| `+` / `=` / `Numpad +`     | Zoom in                                   |
| `-` / `_` / `Numpad -`     | Zoom out                                  |
| `Shift` + zoom             | Fine step (~3% instead of ~10%)           |
| `1`                        | Frame the full body                       |
| `2`                        | Frame the bust (head and shoulders)       |
| `3`                        | Frame the face                            |
| `0`                        | Reset the view                            |
| `F`                        | Frame the character                       |
| `←` / `→`                  | Orbit left / right around the character   |
| `↑` / `↓`                  | Orbit up / down around the character      |
| `Shift` + any arrow        | Slide the frame without rotating it (pan) |

All three forms of plus and minus are accepted because they are physically
different keys — `=` is the unshifted plus on most layouts, and the numpad
sends its own codes.

`1` / `2` / `3` are the framings character creators ship (Genshin Impact,
Honkai Star Rail, FF14, Black Desert). "Let me look at her face" is a
destination, not a distance, so it gets its own key rather than a hunt with
free zoom. They run through
[`CameraPresets`](../src/gltf-viewer/CameraPresets.js), so the move is eased
and correctly fitted, not a jump.

`0` and `F` differ slightly: `F` re-fits the camera on the avatar's current
bounds, while `0` is the same reset the **Reset View** drawer button performs.

### Orbit or pan?

They answer different questions, which is why both exist.

**Orbit** (plain arrows) walks the camera around her — "show me the other side
of that skirt". The angle changes, the distance does not.

**Pan** (`Shift` + arrows) slides the frame without rotating — "I am zoomed in
on the boots and they are off to one side". The angle you chose is kept.

Reaching an off-centre detail by orbiting would cost you the angle, which is
exactly the thing you were trying to hold still. That is why panning is its own
gesture rather than something you improvise with orbit.

Panning moves the camera **and** `controls.target` by the same vector, so the
orbit pivot travels with the view: pan, then orbit, and you spin around what
you are now looking at rather than around where the character happens to stand.

> **The character never moves.** Every one of these keys moves the CAMERA. The
> avatar's own position and rotation are never touched — press `0` and you are
> back at the start with her exactly where she was.

### Pose Studio and the arrows

Pose Studio binds `←` / `→` for stepping through poses. While its panel is
open, those two are released to it — but **only** those two, and **only** while
it is open. It never claims `↑` / `↓`, and orbiting while you pose is useful, so
the vertical arrows keep working throughout, as does zoom and the `1`/`2`/`3`
framings.

## Chat and panels

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `Enter`   | Send the message in the chat box              |
| `Alt` + `C` | Toggle Companion Mode (picture-in-picture)  |
| `Esc`     | Close the avatar picker or the AR QR dialog   |
| `←` / `→` | Previous / next pose — **only while Pose Studio is open** |

## Keys that are deliberately NOT bound

This half matters as much as the bindings themselves.

| Key             | Why it is left alone                                             |
| --------------- | ---------------------------------------------------------------- |
| `W` `A` `S` `D` | The Unity / Unreal flythrough — but those require holding right-mouse to enter camera mode first. A bare letter key one tab away from a chat box is a trap. |
| `Ctrl`/`Cmd` + `+` / `-` | The browser's own page zoom. Intercepting it breaks accessibility. Every handler bails when a modifier is held. |
| `←` / `→` (while Pose Studio is open) | Pose Studio steps through poses with them. The camera releases that pair while its panel is open — see above. |

## Two rules the implementation follows

**Nothing fires while you are typing.** Every handler checks the focus target
for `input`, `textarea`, `select` and `contentEditable`. The chat box is the
usual focus in this app, so without that guard `-` and the digits would be
unusable.

**Zoom is multiplicative, not additive.** One press multiplies the camera
distance by `0.9` (or `0.97` with `Shift`) rather than subtracting a fixed
amount:

```js
distance *= 0.9;   // same proportion at 2 m and at 20 m
distance -= 0.2;   // crawls when far, slams into the model when near
```

The same metre covers wildly different angular amounts at different ranges, so
a subtraction feels broken at both ends. This is the usual reason a hand-rolled
zoom "feels bad", and it is normally misdiagnosed as a speed-tuning problem —
OrbitControls' own dolly uses `0.95 ^ zoomSpeed` for exactly this reason.

Zooming changes **only** the distance. The orbit angle and `controls.target`
are untouched, so zooming never costs you the angle you had chosen.

## Tuning

| Constant         | File               | Default | Effect                    |
| ---------------- | ------------------ | ------- | ------------------------- |
| `DOLLY_STEP`     | `CameraFraming.js` | `0.9`   | Zoom per press            |
| `DOLLY_STEP_FINE`| `CameraFraming.js` | `0.97`  | Zoom per press with Shift |
| `PITCH_STEP`     | `CameraKeyboard.js`| `0.05`  | Radians per `↑`/`↓` press |
| `YAW_STEP`       | `CameraKeyboard.js`| `0.05`  | Radians per `←`/`→` press |
| `PAN_FRACTION`   | `CameraFraming.js` | `0.06`  | Fraction of the frame per pan press |
| `PAN_FRACTION_FINE` | `CameraFraming.js` | `0.02` | Same, with Shift held  |
| `PRESET_MS`      | `CameraKeyboard.js`| `420`   | Framing transition length |
| `HEADROOM_BIAS`  | `CameraFraming.js` | `0.04`  | How high the subject sits in frame |

Holding a key auto-repeats, which gives continuous zoom and orbit for free. If
that feels too fast, `DOLLY_STEP` is the single number to change.

Zoom is clamped by `controls.minDistance` / `maxDistance`, which
`ViewerEngine._applyFraming()` adapts per avatar — a small model lets you get
closer than a large one.

Pan is **not** clamped: you can slide the character out of frame entirely if
you want to look at the space beside her. `0` brings everything back, which is
why it is worth learning first.

Pan scales with distance for the same reason zoom is a ratio. One press always
travels the same fraction of the visible frame — 6% by default — so it feels
identical whether you are framing her whole body or a single boot. A fixed
number of world units would be a huge jump close up and imperceptible far out.

## Accessibility

- Motion-sensitive users get the destination rather than the journey: framing
  transitions snap when `prefers-reduced-motion: reduce` is set.
- Browser and OS chords are never intercepted, so page zoom, tab switching and
  screen-reader shortcuts all behave normally.
- Keys are only swallowed (`preventDefault`) once they have matched a binding.
  `-` and the digits stay ordinary characters everywhere else on the page.

## Not available in VR

The keyboard camera controls are desktop-only. In an immersive session the
headset owns the camera, and `CameraPresets.transitionTo()` returns without
moving anything. See [vr-controls.md](vr-controls.md) for the controller
equivalents.

## Related

- [vr-controls.md](vr-controls.md) — VR controller mapping
- [poses.md](poses.md) — Pose Studio, which owns `←` / `→`
- [getting-started-for-kids.md](getting-started-for-kids.md) — the friendly version
