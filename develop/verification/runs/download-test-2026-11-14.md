# Download + playback test (AvatarSample_A)

Scratch only — binaries under `develop/verification/scratch-candidates/`
(gitignored).

## Summary

- jobs: 12
- ok: 11
- fail: 1

## VRoid Project BOOTH 7-pack

| File           | Motion         | Verdict  | Hips Y | Flags         |
| -------------- | -------------- | -------- | ------ | ------------- |
| `VRMA_01.vrma` | Show full body | **ok**   | 0.859  | -             |
| `VRMA_02.vrma` | Greeting       | **fail** | 1.216  | legs-inverted |
| `VRMA_03.vrma` | Peace sign     | **ok**   | 0.846  | -             |
| `VRMA_04.vrma` | Shoot          | **ok**   | 0.849  | -             |
| `VRMA_05.vrma` | Spin           | **ok**   | 0.847  | -             |
| `VRMA_06.vrma` | Model pose     | **ok**   | 0.88   | -             |
| `VRMA_07.vrma` | Squat          | **ok**   | 0.903  | -             |

## tfuru mocopi samples

| File                        | Verdict | Hips Y | Flags |
| --------------------------- | ------- | ------ | ----- |
| `MCPM_20230806_154241.vrma` | **ok**  | 0.895  | -     |
| `MCPM_20230806_154323.vrma` | **ok**  | 0.907  | -     |
| `MCPM_20230806_154402.vrma` | **ok**  | 0.896  | -     |
| `MCPM_20230806_154429.vrma` | **ok**  | 0.878  | -     |
| `MCPM_20230806_154455.vrma` | **ok**  | 0.893  | -     |

## License notes

- **BOOTH 7-pack:** free + commercial with credit; **no redistributable
  extract** in git. Optional runtime download only.
- **mocopi (tfuru/vrma-loader-sample):** no SPDX on the repo — keep pending / do
  not promote until clarified.

## Re-run

```bash
node develop/verification/audit-additive.mjs \
  --dir develop/verification/scratch-candidates/mocopi \
  --dir develop/verification/scratch-candidates/booth
```
