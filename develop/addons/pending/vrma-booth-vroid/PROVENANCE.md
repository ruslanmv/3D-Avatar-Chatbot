# VRoid Project VRMA motion pack (BOOTH) — development staging

| Field           | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| Source          | [BOOTH item 5512385](https://booth.pm/ja/items/5512385) (pixiv Inc.) |
| License         | Free; commercial OK **with credit**; **no redistributable extract**  |
| Required credit | `Character animation credits to pixiv Inc.'s VRoid Project`          |
| Staging         | `develop/addons/pending/` — development only                         |

## Kept (playback **ok** on AvatarSample_A)

| File         | Motion         |
| ------------ | -------------- |
| VRMA_01.vrma | Show full body |
| VRMA_03.vrma | Peace sign     |
| VRMA_04.vrma | Shoot          |
| VRMA_05.vrma | Spin           |
| VRMA_06.vrma | Model pose     |
| VRMA_07.vrma | Squat          |

## Removed (failed audit)

| File         | Motion   | Reason                         |
| ------------ | -------- | ------------------------------ |
| VRMA_02.vrma | Greeting | **legs-inverted** (hips ~1.22) |

## Product note

Do **not** copy into `vendor/animations/` for a public Apache-2.0 ship without a
distribution plan that respects BOOTH terms (credit + no extractable redistrib).
This folder exists so agents can continue development / optional-download
design.
