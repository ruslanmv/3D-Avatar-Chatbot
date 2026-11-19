<!-- Loaded when judging how motion, poses or looks LOOK. Keep accurate. -->

# Visual review: see it, then measure it

Numbers that pass are not a body that looks right. Every motion, pose or look
change here is judged on frames of the app's own viewer, on a **real VRM**
(`vendor/avatars/Vita.vrm`, `AvatarSample_A.vrm`, `Victoria_Rubin.vrm`), then
measured. Forge's synthetic reference body is for Forge's paint and fit only:
its presets differ (on it `sittingOpen` raises an arm across her face; on every
real avatar the hands rest on her knees), and it sent a whole review the wrong
way once.

All output goes under `audits/*/runs/` (gitignored). Frames of Private poses are
never committed.

## Which tool

| Question                                                    | Tool                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Does a clip (VRMA/BVH) play right on her? Against a source? | `audits/animations/run.mjs` (+ `--avatar-file`, `--files`, `--tag`)    |
| Side by side: source rig on top, hers below                 | `python3 tools/qa/review_sheets.py pair <ref run> <her run>`           |
| The living layer against the held pose, exact instants      | `tools/qa/living-motion-compare.mjs` → `review_sheets.py compare`      |
| The living layer live: misses, cost, what the model is told | `tools/qa/living-motion-live.mjs`                                      |
| A look (outfit, skin) head to heels                         | `tools/qa/body-detail-render.mjs --views full,fullback`                |
| Private shows (routines) step by step                       | `tools/qa/private-shows-live.mjs`                                      |
| Forge outfits built end to end                              | Forge `tools/body_surface/build_outfits.py`, then the render tool here |
| A gallery of every motion we support, as GIFs               | `tools/qa/motion-gallery.mjs` → `review_sheets.py gallery`             |

## A source clip beside hers (VA5)

```bash
# the source clip on its own rig, loaded through the app's upload input
node audits/animations/run.mjs --avatar-file /path/ref-rig.vrm --files audits/x/clip.vrma --tag ref
# the same clip on her
node audits/animations/run.mjs --avatars AvatarSample_A --files audits/x/clip.vrma --tag chatbot
python3 tools/qa/review_sheets.py pair audits/animations/runs/<…-ref> audits/animations/runs/<…-chatbot>
```

Same instants in the same columns, source on top. `report.json` adds `live`
(time advancing, max bone change in 0.7 s of unpaused play) to each clip.

## The living layer (LM5)

```bash
node tools/qa/living-motion-compare.mjs --vrm vendor/avatars/Vita.vrm --out audits/poses/runs/lm
python3 tools/qa/review_sheets.py compare audits/poses/runs/lm
```

Per scenario (riding, finish, sitting open, knees up): `<name>-sheet.png` (held
preset over the layered frame, per view: front and side, or ground and above for
lying down), `<name>-playback.gif` (6 s at 10 fps), `<name>-angles.png` (pelvis,
spine, chest and head degrees off the held pose, + is backwards).

These motions have **no source animation**: each is a Pose Studio preset held
still plus `PrivateLivingMotion`. The reference is the preset with the layer
off. The layer runs on a fixed simulated clock (60 steps a second from a fresh
stepper), so "1.3 s" is the same instant on both sides and on every run. A
wall-clock capture once took the finish frames after the finish had ebbed and
read as "no head-back".

## The gallery (MP2)

```bash
node tools/qa/motion-gallery.mjs --vrm vendor/avatars/Vita.vrm --out audits/poses/runs/gallery
node audits/animations/run.mjs --avatars Vita --files addons/vrma-cc0/slow_body_roll.vrma,addons/vrma-cc0/club_phrase.vrma --tag cc0 --frames 12
python3 tools/qa/review_sheets.py gallery audits/poses/runs/gallery audits/animations/runs/<…-cc0>
# open audits/poses/runs/gallery/gallery/index.html
```

Every item of the provenance registry (`src/gltf-viewer/MotionProvenance.js`) as
a GIF, grouped by how it was made: hand-authored presets (held, then with the
living layer), the staggered transition, every show step by step, the living
layer in its positions, and the CC0 dances. Add any other
`audits/animations/run.mjs` run (the whole clip library) to the same command
and it joins the gallery under "Clip library". Run it at the end of any motion
work and look through it before calling the work done.

## What Claude made, and switching it off (MP1)

`src/gltf-viewer/MotionProvenance.js` lists every motion Claude created — five
hand-authored presets, the staggered transition, two converted CC0 clips, seven
shows, the living layer — each with its method, batch, files and the exact steps
to remove it. Settings ▸ Private Mode ▸ "Motion created by Claude" has one switch
per method; off hides it everywhere it is offered and deletes nothing.
`tests/motion-provenance.test.js` fails when a new clip, show or preset is added
without an entry, or an entry names a file that is gone. **Anything Claude adds
that moves her body gets an entry in the same commit.**

## Mistakes these tools were built from

- **Mannequin, not her.** Judge on a real VRM.
- **Camera behind her.** Place cameras from her bones (hips→head ×
  hip→hip), never from a model flag: the flag put the camera behind
  AvatarSample_A.
- **A lying pose shot from standing height** reads as folded and tilted. Use the
  ground and above views.
- **Wall-clock frames** of a timed motion miss it. Use the fixed clock.
- **A canvas at a small viewport** came out 241 px tall. Use 1700×950.
- **A build that runs is not a look that fits**, and **a clip that converts is
  not a clip that plays right**. Render it.
