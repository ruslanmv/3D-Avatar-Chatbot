# Local verification report (2026-11-14)

Installed and ran the app on this machine (`npm ci`, `npm start` →
`http://127.0.0.1:8080`), then audited **every Pose Navigator pose and every
inventory clip** on `AvatarSample_A`, plus a curated smoke of `develop/`
candidates.

## Environment

- Branch: `cursor/animation-candidates-develop-d04a` (from living-worlds + AX16)
- Proxy: nexus-proxy on port 8080
- Playwright Chromium (SwiftShader)
- Product motion fixes from draft PR #152 were **not** on this branch

## 1. Inventory

```text
audited 17 avatars · 26 poses · 145 clips · intents 7/7 · 0 fail · 8 warn
animations audit up to date
```

## 2. Critical suite (default plan)

`develop/verification/runs/avatar-sample-a-critical/`

| Jobs | ok  | warn | fail |
| ---- | --- | ---- | ---- |
| 24   | 17  | 4    | 3    |

Matches the post-#151 smoke shape (poses + key VRMA/BVH). Failures are known
floaters (e.g. Mixamo-origin `waving` / `backflip`) and sinking converted
dances.

## 3. Full suite — all poses + all clips (AvatarSample_A)

`develop/verification/runs/avatar-sample-a-full/` (CSV + summary; shots under
`audits/vrm_animations/runs/2026-11-14T08-11-47/shots/`, 123 JPEGs)

| Jobs | ok  | warn | fail |
| ---- | --- | ---- | ---- |
| 171  | 48  | 9    | 114  |

### Pose Navigator (26 presets)

| ok  | warn                           | fail                          |
| --- | ------------------------------ | ----------------------------- |
| 24  | 1 (`anchorGrounded` no-motion) | 1 (`lyingSide` legs-inverted) |

**Verdict:** Pose Navigator largely works. Sitting / kneeling / lying presets
play; one lying preset fails inverted-legs; anchor is nearly static.

### Shipped VRMA (`vendor/animations/vrma/`)

All six score **ok** (Angry, Relax, Sad, Surprised, Thinking, waiting-standard).

### Vendor BVH (SillyTavern pack)

Most emotion / action / idle / dance BVH score **hips-floating** (~1.8–2.1 m vs
standing ~0.90 m). A minority of sit / kneel / lay / remorse / crunch clips
score ok. This is a **retarget / hip-height** product issue (see PR #152
MO4/MO6), not a missing file.

### Add-on Mixamo-origin VRMA

Mostly **hips-floating** (2.3–3.5 m) or underground — already experimental /
quarantine territory.

## 4. develop/ candidate smoke (new packs)

`node develop/verification/play-candidates.mjs` →
`develop/verification/runs/develop-candidates/`

| Jobs | ok  | warn | fail |
| ---- | --- | ---- | ---- |
| 12   | 0   | 0    | 12   |

All **played successfully** (loader fetched real BVH, not HTML). Every clip
failed **hips-floating**:

| Source        | Typical hips Y | Meaning                                                                 |
| ------------- | -------------- | ----------------------------------------------------------------------- |
| ACCAD Female1 | ~1.78 m        | Playable but needs scale/grounding before ship                          |
| CMU curated   | ~16–18 m       | Playable but wrong units/scale — must retarget (e.g. bvh2vrma + ground) |

**Verdict:** Candidates are valid downloadable motion and load in the app, but
they are **not** ready to integrate until scale/grounding is fixed and AX16
scores ok.

## 5. Do not integrate yet

Do not copy `develop/sources/**` into `vendor/animations/` until:

1. Convert / retarget (prefer [bvh2vrma](https://vrm-c.github.io/bvh2vrma/))
2. Ground hips to ~standing height on AvatarSample_A
3. Re-run this smoke + AX16 critical suite
4. Spot-check a second avatar (Vita)

## Commands to reproduce

```bash
npm ci
npm i --no-save playwright && npx playwright install chromium
npm start
node tools/qa/animation-audit.mjs --check
node tools/qa/animation-audit.mjs --play --avatar AvatarSample_A --shots fail
node tools/qa/animation-audit.mjs --play --avatar AvatarSample_A --full --shots fail
node develop/verification/play-candidates.mjs
```
