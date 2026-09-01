# Turning the Behavior Director on

Everything in this document ships **off**. That is deliberate, and it is not a rollout plan
in disguise: the engine is opt-in because a companion that starts moving on its own the day
you `git pull` is a companion nobody asked for.

This page is the whole configuration surface, and the recipe for exercising each feature so
you can see it work rather than take a test's word for it.

## The master flag

`config/behavior.config.json`:

```json
{ "behaviorEngine": { "enabled": true, "debug": false } }
```

With `enabled: false` — how it ships — `scripts/behavior-parity-baseline.mjs --check` proves
the engine is **inert**: zero engine scripts in `index.html`, zero unguarded references, and
every master flag false. Turning it on costs one boolean; it does not turn on anything below.

Add `?behaviorDebug=1` to the URL (or set `behaviorEngine.debug`) for the on-screen HUD and
the 16-entry pick log — including the refusals, because "she did nothing" is the hardest
behaviour to debug.

## Every other flag, and what it costs

| Flag | Default | Turns on | Needs |
|---|---|---|---|
| `behaviorEngine.enabled` | `false` | the engine at all | — |
| `session.enabled` + `session.url` | `false` | the HomePilot socket: server intents, curiosity, vision, MCP | a HomePilot with `AVATAR_ENABLED=true` |
| `session.tier1Remote` | `false` | clip selection on the server, for weak devices | as above |
| `nsfwAllowed` | `false` | the user half of the adult gate | — |
| `adult.available` | `false` | the consent flow is constructed at all | server attestation (below) |
| `clips.enabled` | `true` | the 30 s ring buffer and both share loops | `MediaRecorder` + `canvas.captureStream` |
| `clips.suggestOnMacro` | `true` | the once-a-minute "clip that?" nudge | — |
| `capture.*` | 1 fps / 512 px / q0.7 | ceilings, not targets — B11 enforces them once | — |
| `coach.poseFps` | `15` | pose sampling rate | MediaPipe tasks-vision |
| `assistant.panelMaxKb` | `64` | mirrors the server's panel limit | — |
| `budgets` | 2 ms/frame, 50 ms/pick | what `audit-budgets.mjs` holds you to | — |

Nothing here is implied by anything else. `behaviorEngine.enabled` is a kill switch, not a
master switch.

## Browser and hardware

| Feature | Needs | Absent → |
|---|---|---|
| Tier 0/1 (idle, gestures, selection) | nothing beyond WebGL | — |
| Watch / Music / Journeys | `getDisplayMedia`, WebAudio `AnalyserNode` | the activity refuses by name |
| Vision, Screen Insight, Copilot | `getUserMedia` + a HomePilot vision model | ditto |
| Coach | MediaPipe tasks-vision 0.10.14 (CDN), a camera | `pose tracking is unavailable on this device` |
| Clips | `MediaRecorder`, `canvas.captureStream` | `this browser has no MediaRecorder` |
| VR / AR | WebXR (Quest 2/3, Pico) | 2D still works |

Two honest limits:

- **Immersive XR frames cannot be captured.** No API hands a page the composited headset
  frame, on any platform, by design. In XR a clip is the **mirror view**, reported as
  `source: "mirror"`. That is documented behaviour, not a bug to work around.
- **Scene art is not in this repository.** The five journeys and date-night scenes name 8K
  KTX2 skyboxes and ambient loops that are licensed assets. Every manifest carries a
  `fallbackColor` and **enters anyway** — the missing-asset path is a first-class case, not
  an error branch. See `src/features/together/scenes/README.md`.

## Testing each feature

Run the gates first. These are what CI runs, and all four are green:

```bash
npm run validate                              # lint + format + the whole suite
node scripts/behavior-parity-baseline.mjs --check   # inert with the flag off
node scripts/audit-privacy.mjs --check             # 8 claims, all source properties
node scripts/audit-budgets.mjs --check             # frame, pick, clip and coach costs
node kb/scripts/validate-manifest.mjs --level semantic
```

Then, with `behaviorEngine.enabled: true`, feature by feature:

| Feature | How to see it |
|---|---|
| **Idle & gestures** | Load the app and wait. She fidgets, breathes, never loops visibly |
| **Panels** (B20) | Send a `display` frame from HomePilot, or call `NEXUS_BD.panels.show(...)` in the console |
| **Morning brief** (B21) | Ask HomePilot "good morning" over the session socket — panel, one gesture, one sentence |
| **Focus** (B22) | `NEXUS_BD.focus.start([...])`, then say "next", "set a timer for five minutes" |
| **Co-host** (B23) | Share a game window; loud + bright moments produce reactions |
| **Clips** (B24/25) | `NEXUS_BD.clipButton.save()` — a `.webm` lands in Downloads and nothing leaves the device |
| **Copilot** (B26) | `NEXUS_BD.copilot.start(['step one', 'step two'])`, then talk to it |
| **Coach** (B27) | `NEXUS_BD.coach.start('squat')` in front of a camera |
| **Adult tier** (B28/29) | See below — it needs the server first |

`window.NEXUS_BD.stats()` prints the live state of every one of them.

## The adult tier

Three independent things must all be true, and the client can only supply one:

1. **`AVATAR_ADULT_ENABLED=true` on HomePilot**, on a **single-user** instance. The
   owner-attest provider refuses to load when the instance has more than one account — an
   owner attesting for strangers is worse than no gate, because it looks like one. A
   distribution build must configure a real provider via `AVATAR_ADULT_PROVIDER`.
2. **`nsfwAllowed: true`** — the user's own setting.
3. **`adult.available: true`** — with this false the consent flow is not constructed at all.

`adultVerified` is set by exactly one thing: an `adult_ack` frame the server produced. There
is no client path, no config key and no dialog, and a test enumerates every writer in the
engine to keep it that way. A "click yes" age dialog is not merely insufficient — it must not
exist, because shipping one creates the appearance of a gate and a code path that later gets
trusted.

Escalation is earned: four levels, a check-in before each, two minutes minimum at each. The
fastest path from level 1 to 4 is six minutes and three explicit yeses. `cozy` drops to
level 1, `stop` leaves the tier — both from any level, both without a word about it.

**`docs/QA_CHECKLIST.md` section J is unsigned.** Every invariant has a passing test, but no
test drives the whole round trip on a real instance with a real socket. Do not flip
`adult.available` in a distribution build until it is.

## Turning it off again

Set `behaviorEngine.enabled` back to `false`. Nothing persists: consent and attestation are
session-scoped, the clip ring is dropped on stop, and no engine feature writes to
`localStorage`, `indexedDB` or a server outside the session socket you configured. The
privacy audit checks all of that by reading source rather than by asking.
