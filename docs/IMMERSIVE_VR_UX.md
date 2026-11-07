# Immersive VR and mixed reality — interaction

This describes the code path. It is not a hardware certification.

## What did not change

`docs/vr-controls.md` still holds. Left stick moves, right stick snap-turns,
triggers click the existing VR panel, and the right trigger talks when it is
not on a visible panel button. Seaside does not replace that mapping and does
not add artificial turn or head-locked UI.

Teleport was not added. The current locomotion is the one the controller
tests cover. Replacing it with teleport would be a separate change to
`VRControllers`, reviewed against those tests. Seaside is usable seated:
the shell, lantern, and exit stone sit in front of the default camera at
`(0, 1.25, 2)`, and the sheet's buttons call the same interactions.

## What Seaside adds in a headset

The terrace group is in the same scene as the avatar. `bindViewer` runs on
the first ViewerEngine frame, so the meshes exist before a session if the
experience was started on the desktop, and they exist inside the session if
it is started after entry.

A controller ray that hits a mesh with `experienceSelectable` selects it and
does not also start push-to-talk. A miss falls through. Grip, sticks, and
panel buttons are untouched.

Exit is the exit stone in the scene and the Exit control on the destination
sheet. Leaving the experience restores the previous scene graph additions
(the group is removed). It does not end the WebXR session.

The sky sphere and ocean bands are omitted when `environmentBlendMode` is
`additive` or `alpha-blend`, so a passthrough session is not painted over
with a fake room. If blend mode cannot be read, the full terrace is used.
A failure inside `prepare` marks the experience failed and restores; it does
not call `forceExit` on VR or AR.

## Comfort

- The camera is never assigned by the experience.
- Reduced motion skips the lantern pulse (`comfort.reducedMotion`).
- Avatar locomotion toward the user is refused inside the comfort distance
  (default 0.8 m). Seaside does not walk her.
- No camera shake, no forced look-at, no vignette.

## Scale and gaze

Her existing gaze controller still runs in `ViewerEngine` while presenting.
Seaside does not add a second look-at. Placement stays at the origin the
avatar already occupies, which is the distance the desktop camera was framed
for. The user moves; she does not step into the headset.

## Audio

Waves are an oscillator bed at the environment gain, ducked while speech is
marked. They are not her voice. Her voice remains the TTS engine already
selected in Settings. Ending VR stops the bed.

## What still needs a headset

Frame time at 72 Hz, controller hit targets, whether the terrace intersects
a real playspace, and passthrough lighting are unchecked. See
[IMMERSIVE_VR_TESTING.md](IMMERSIVE_VR_TESTING.md).
