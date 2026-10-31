# Screenshots of the VR chat panel (without a headset)

The HomePilot VR chat panel is drawn on a `<canvas>` and shown in the headset as
a texture. To see a change to it — a removed button, a new label, a longer
message — you used to have to put a Quest on. `tools/vr/screenshot-vr-panel.mjs`
loads the real page in headless Chromium, puts a conversation into the real
panel (`window.NEXUS_VIEWER.vrChatPanel`) and saves the canvas as a PNG, exactly
as the headset would show it.

It is how the panel without the Summarize / Explain / Continue chips was checked
(VR1), and how the "You" / "AI" labels overlapping the first line of each
message were found and fixed.

## One-time setup

The tool needs Playwright with Chromium (the same as
`tools/brand/render-app-icons.mjs`):

```bash
npm i --no-save playwright && npx playwright install chromium
```

A machine with Playwright installed globally works as is.

## Take the pictures

```bash
npm run vr:panel-shot
```

That starts the local server itself (`nexus-proxy`, port 8097), renders the three
layers of the panel and stops the server again:

| File                              | Layer                                         |
| --------------------------------- | --------------------------------------------- |
| `tmp/vr-panel/vr-panel-chat.png`     | the conversation, SPEAK / text / SEND          |
| `tmp/vr-panel/vr-panel-controls.png` | ⚙ Controls — pose, interaction, avatar         |
| `tmp/vr-panel/vr-panel-settings.png` | ··· More — the XR settings                     |

`tmp/` is git-ignored, so the pictures never end up in a commit.

## Options

```bash
node tools/vr/screenshot-vr-panel.mjs --help
```

| Option                 | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `--url <url>`          | Use a server you already started (e.g. `npm start` → `http://localhost:8080`) |
| `--port <n>`           | Port for the server the tool starts (default 8097)                            |
| `--out <dir>`          | Where the PNGs go (default `tmp/vr-panel`)                                    |
| `--modes <list>`       | Only some layers, e.g. `--modes chat` or `--modes chat,settings`              |
| `--status <s>`         | `idle`, `listening`, `thinking` or `speaking`                                 |
| `--transcript <text>`  | Show a live speech transcript (implies `--status listening`)                  |
| `--messages <file>`    | A JSON array of `{ "role": "user" \| "bot", "text": "…" }` to show            |
| `--no-sample`          | An empty conversation                                                         |
| `--ar <on\|off>`       | Whether the panel believes AR is supported (headless Chromium says off)       |

Examples:

```bash
# What she shows while you hold the trigger and talk
node tools/vr/screenshot-vr-panel.mjs --modes chat --transcript "hold the trigger and talk to me"

# The settings layer as a Quest's own browser would show it (AR available)
node tools/vr/screenshot-vr-panel.mjs --modes settings --ar on

# Your own conversation, to check how long replies wrap
node tools/vr/screenshot-vr-panel.mjs --modes chat --messages my-chat.json
```

## The usual loop

1. Change the panel (`src/gltf-viewer/VRChatPanel.js`).
2. `npm run vr:panel-shot`.
3. Open the PNGs in `tmp/vr-panel/`. Compare with the previous run if you kept
   it (`--out tmp/vr-panel-before` before the change).

## What it does not show

Only the panel's canvas — not the 3D scene, her, the controllers or the floating
mic indicator. For the whole VR session without a headset, use Meta's
**Immersive Web Emulator** extension in desktop Chrome (an emulated Quest 3 with
controllers), or open the page in the Quest's own browser and inspect it from the
PC at `chrome://inspect` over USB.
