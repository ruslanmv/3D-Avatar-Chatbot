# Third-party licences for vendor/animations/vrma/

Every `.vrma` here is redistributed under the MIT licence of its upstream
project, which is compatible with this repository's Apache-2.0. MIT requires the
copyright notice and permission notice to travel with the files; they are
reproduced in full below.

| Files | Upstream | Licence |
| --- | --- | --- |
| Angry, Blush, Clapping, Goodbye, Jump, LookAround, Relax, Sad, Sleepy, Surprised, Thinking (`.vrma`) | [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer) | MIT, © 2025 TK256 |
| `idle_loop.vrma` | [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM) `public/idle_loop.vrma` | MIT, © 2023 pixiv Inc. |
| `show_outfit`, `peace_sign`, `finger_gun`, `spin`, `model_pose`, `playful_dip` (`.vrma`) | [VRoid Project VRMA motion pack, BOOTH item 5512385](https://booth.pm/ja/items/5512385) (pixiv Inc.) | BOOTH terms: free, commercial use OK **with credit** — see below |
| `turn_aside`, `open_arms`, `hand_on_heart`, `explain`, `present` (`.vrma`) | [tfuru/vrma-loader-sample](https://github.com/tfuru/vrma-loader-sample) `example/mocopi/vrma/` | **No licence declared upstream** — see below |

`idle_loop.vrma` was staged and audited under `develop/addons/stable/vrma-mit/`
(PR #153) before promotion; it is byte-identical to that copy.

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
