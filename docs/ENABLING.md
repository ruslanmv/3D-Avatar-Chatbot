# Behavior Director: the switch, and what needs what

The engine ships **on**, so the 👥 launcher is on the toolbar of a fresh install. It shipped
opt-in until the rollout, and the cost was that every feature behind that button was
undiscoverable: you had to know to tick a checkbox before the button existed at all.

**Settings ▸ Behavior Director** is now a kill switch rather than an ignition. Unticked,
nothing under `src/behavior/` is fetched, parsed or evaluated and the app is the one that
shipped before any of this — which `scripts/behavior-parity-baseline.mjs --check` proves.

Everything *underneath* the engine still ships off: camera, microphone, the HomePilot
session, the adult tier. Turning the engine on grants nothing.

This page is the whole configuration surface, and the recipe for exercising each feature so
you can see it work rather than take a test's word for it.

## What needs HomePilot, and what does not

Most of Together is local. Only the two activities that ask a model about a picture need a
server at all:

| Activity | Needs HomePilot | What it uses |
|---|---|---|
| Focus, Journey, Music, Watch, Coach | **no** | timers, scenes, WebAudio, a video element, MediaPipe pose — all in the browser |
| Help me with this | **yes** | a vision model, to answer about what the camera sees |
| Meeting | **yes** | MeetingSense, to record and transcribe into a conversation |

When HomePilot is not reachable the two tiles stay on the grid and explain themselves when
chosen, naming what B35's discovery actually found — no bridge, bridge unreachable, bridge
too old, or a bridge with HomePilot not enabled behind it — with **Open settings** beside it.
They never open a camera first: a live camera and silence was the old behaviour and is the
thing this replaced.

## The master flag

**Settings ▸ Behavior Director ▸ Enable.** The checkbox writes `nexus_bd_enabled` to
localStorage, and that key is the ignition: `src/main.js` reads it on both engine paths and
only then fetches `src/behavior/boot.js`. Off — how it ships — nothing under `src/behavior/`
is fetched, parsed or evaluated, which is the property
`scripts/behavior-parity-baseline.mjs --check` proves: zero engine scripts in `index.html`,
zero unguarded references, every master flag false.

`config/behavior.config.json` is read **after** boot, and configures the engine that is
already running:

```json
{ "behaviorEngine": { "enabled": true, "debug": false } }
```

> **Known gap.** `behaviorEngine.enabled` in that file is currently read by nothing —
> `boot.js` consumes `debug` and the blocks below, not `enabled`. The toggle is the only
> switch. Whether the JSON key should become a second, deployment-side kill switch (so an
> operator can disable the engine for an install whose users have already ticked the box) is
> an open decision, not an oversight to paper over; until it is taken, treat the key as
> documentation of intent and the toggle as the truth.
>
> It is deliberately still `false` even though the engine ships on: two CI audits assert that
> it is, nothing at runtime reads it, so flipping it would break a gate and change no
> behaviour. The default lives in `startBehaviorDirector()` in `src/main.js`.

Add `?behaviorDebug=1` to the URL (or set `behaviorEngine.debug`) for the on-screen HUD and
the 16-entry pick log — including the refusals, because "she did nothing" is the hardest
behaviour to debug.

## Every other flag, and what it costs

| Flag | Default | Turns on | Needs |
|---|---|---|---|
| **Settings ▸ Behavior Director** (`nexus_bd_enabled`) | **on** | the engine and the 👥 launcher; untick to turn everything off | — |
| the HomePilot session | auto | server intents, curiosity, vision, MCP | an OllaBridge with HomePilot enabled — see below |
| `session.tier1Remote` | `false` | clip selection on the server, for weak devices | as above |
| `nsfwAllowed` | `false` | the user half of the adult gate | — |
| `adult.available` | `false` | the consent flow is constructed at all | server attestation (below) |
| `clips.enabled` | `true` | the 30 s ring buffer and both share loops | `MediaRecorder` + `canvas.captureStream` |
| `clips.suggestOnMacro` | `true` | the once-a-minute "clip that?" nudge | — |
| `capture.*` | 1 fps / 512 px / q0.7 | ceilings, not targets — B11 enforces them once | — |
| `coach.poseFps` | `15` | pose sampling rate | MediaPipe tasks-vision |
| `assistant.panelMaxKb` | `64` | mirrors the server's panel limit | — |
| `budgets` | 2 ms/frame, 50 ms/pick | what `audit-budgets.mjs` holds you to | — |

Nothing here is implied by anything else. The toggle is a kill switch, not a master switch:
turning it on turns on the engine and nothing in this table.

## Reaching HomePilot

**You should not have to configure this.** If you have linked OllaBridge — which you did to
get models — the avatar finds HomePilot through it and connects with the credential it
already holds. Settings shows a status line and nothing else:

```
HomePilot connected through OllaBridge — directives, curiosity.
```

### How it decides

`boot.js` resolves the session in one pass, and the answer is reported as `session.source`:

| `source` | What happened |
|---|---|
| `manual` | A URL is typed under **Advanced**. It wins over everything below — an override that a discovery could silently beat would be useless exactly when it is needed |
| `bridge` | `GET {ollabridge}/health` reported a HomePilot and an `avatar.session` path |
| `no-bridge` | No OllaBridge is linked in the chat provider settings |
| `no-homepilot` | OllaBridge is linked, but HomePilot is off in its Local Runtimes |
| `bridge-too-old` | OllaBridge sees HomePilot but cannot relay the session |
| `bridge-unreachable` | OllaBridge did not answer within 4 s |
| `off` | Automatic discovery was turned off (`nexus_bd_session_auto=false`) |

`bridge-too-old` is the state every OllaBridge deployed before this feature is in, and it is
deliberately **not** an error: the chat path already carries `x_directives`, so she still
gestures and still shows media. What she cannot do is speak first. Saying that is more useful
than reporting a flat failure.

### Why not just type the URL

Because the address only works in the one configuration nobody ships. The browser has to open
that socket itself, so an HTTPS page cannot use a `ws://` address (mixed content, blocked with
a console error that does not say so), and a hosted page reaching `localhost` reaches the
server it is served from rather than the user's machine. The bridge has neither problem: it is
one origin the page already talks to, and it is running next to HomePilot.

There is a second reason. The direct path needs a HomePilot credential in the browser, and
there was never a field for one — the client sent an empty token and the server rejected it,
so the direct path did not work at all as shipped. Through the bridge the browser presents the
bridge's own token, and the bridge holds HomePilot's key. One secret, one origin.

### Connecting one directly anyway

**Settings ▸ Behavior Engine ▸ Advanced.** Fill in the URL and tick the box. This is the right
choice when you are not using OllaBridge, and it is the same control that shipped before —
moved, not removed. It needs a HomePilot with `AVATAR_ENABLED=true`, a browser that can reach
it, and — because of the credential gap above — an `auth` string in the `session` block of
`config/behavior.config.json`.

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
