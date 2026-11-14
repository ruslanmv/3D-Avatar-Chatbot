# Third-party licences for vendor/animations/vrma/

Every `.vrma` in this folder, where it came from, and the terms it is used under.
MIT requires the copyright notice and permission notice to travel with the files;
they are reproduced in full below. Two packs are **not** MIT and are flagged for
review before a public release. The same sources are recorded per clip in
`vendor/animations/manifest.json` (`credits`) and in the KB
(`kb/animations.manifest.jsonl`, `source` / `license`).

| Files | Upstream | Licence |
| --- | --- | --- |
| Angry, Blush, Clapping, Goodbye, Jump, LookAround, Relax, Sad, Sleepy, Surprised, Thinking (`.vrma`) | [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer) | MIT, © 2025 TK256 |
| `idle_loop.vrma` | [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM) `public/idle_loop.vrma` | MIT, © 2023 pixiv Inc. |
| `show_outfit`, `peace_sign`, `finger_gun`, `spin`, `model_pose`, `playful_dip` (`.vrma`) | [VRoid Project VRMA motion pack, BOOTH item 5512385](https://booth.pm/ja/items/5512385) (pixiv Inc.) | BOOTH terms: free, commercial use OK **with credit** — see below |
| `turn_aside`, `open_arms`, `hand_on_heart`, `explain`, `present` (`.vrma`) | [tfuru/vrma-loader-sample](https://github.com/tfuru/vrma-loader-sample) `example/mocopi/vrma/` | **No licence declared upstream** — see below |
| `waiting-standard.vrma` | Not recorded — the repo's docs call it a "VRoid Hub clip idle"; it was added in `d6dc853` (2026-03-27) without a source | **Unknown** — confirm before a public release |

Every clip here was reviewed on three avatar heights (0.69 m, 0.89 m and 0.98 m
hips) with frames checked by eye before it was enabled; evidence is in
`develop/verification/runs/`. The staging copies under `develop/addons/` were
removed on 2026-11-14 — this folder is the only copy.

## Status at a glance

| Licence | Files | Public release |
| --- | --- | --- |
| MIT (tk256, ChatVRM) | 12 | Ready — notices below |
| BOOTH terms (VRoid Project) | 6 | **Review** — credit required; extractable redistribution not permitted |
| None declared (mocopi sample repo) | 5 | **Review** — ask the author for a licence |
| Unknown (`waiting-standard`) | 1 | **Review** — source not recorded |

## tk256ailab/vrm-viewer

MIT License

Copyright (c) 2025 TK256

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## pixiv/ChatVRM

MIT License

Copyright (c) 2023 pixiv Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## VRoid Project VRMA motion pack (BOOTH)

Required credit: **Character animation credits to pixiv Inc.'s VRoid Project**

Original file names: `VRMA_01` Show full body → `show_outfit`, `VRMA_03` Peace sign
→ `peace_sign`, `VRMA_04` Shoot → `finger_gun`, `VRMA_05` Spin → `spin`,
`VRMA_06` Model pose → `model_pose`, `VRMA_07` Squat → `playful_dip` (a playful dip, not an exercise squat). `VRMA_02`
(Greeting) failed audit (legs inverted) and is not included.

BOOTH's terms permit use with credit but do not permit redistributing the motion
files as extractable assets. They are included here at the repository owner's
direction for development (2026-11-14); review before a public release.

## tfuru/vrma-loader-sample (mocopi captures)

`MCPM_20230806_154241` → `turn_aside`, `…154323` → `open_arms`, `…154402` →
`hand_on_heart`, `…154429` → `explain`, `…154455` → `present`.

The upstream repository declares no licence, so redistribution rights are
unclear. Included at the repository owner's direction for development
(2026-11-14); clarify with the author before a public release.
