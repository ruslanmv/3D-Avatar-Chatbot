# Looking at your other computer

> **You** — Show me what's on my PC.
> **NEXUS** — Looking at Home PC…
> *[ the screenshot ]* &nbsp;&nbsp; Home PC · Just now &nbsp;&nbsp; **Ask about this** · Refresh
> **You** — Why is this failing?
> **NEXUS** — The visible error says the `requests` module is missing… `↳ Screenshot · 10:42:18`

One picture, taken on that machine, on request. The follow-up question is answered about
**that same picture** — never a fresh one, because a new capture under an old image is an
assistant describing a screen you cannot see.

## What it needs

| | Needs HomePilot | Why |
|---|---|---|
| Looking at **this** screen | no | you share it in the browser, as ScreenSense always has |
| Looking at **another** computer | **yes** | no web API photographs a machine it is not running on |

Without a bridge the avatar says so and offers the local screen instead. Nothing else in the
app changes.

## Turning it on

Two mechanisms, tried in this order.

**1. From a screen you are already sharing.** Open HomePilot on that computer and share your
screen there. Nothing else to configure: the request is answered off the stream you can see
yourself sharing, and the browser's own sharing bar is the indicator.

**2. Directly, with no browser open.** On the computer being photographed:

```sh
export HOMEPILOT_REMOTE_CAPTURE=true      # off by default; local-only, never settable remotely
export HOMEPILOT_DEVICE_NAME="Home PC"    # what the card calls it
pip install mss pillow                    # how the picture gets taken
```

Optional: `HOMEPILOT_REMOTE_CAPTURE_TTL_S` (600), `..._MIN_INTERVAL_S` (3),
`..._HOURLY_CAP` (120).

The cloud side needs `HOMEPILOT_ENABLED=true` and `HOMEPILOT_BASE_URL` on your OllaBridge, so
`/health` advertises `avatar.features: ["screen"]` and the avatar knows to offer it.

## What it will not do

* **No streaming.** One JPEG per explicit request. Refresh is a button, so you always know
  which picture the answer is about.
* **No remote control.** Nothing here clicks, types or scrolls on that machine.
* **No silent capture.** Mechanism 1 rides an indicator you can see; mechanism 2 is off
  unless you turned it on there, is rate limited, and writes every capture to
  `<UPLOAD_DIR>/screensense-audit.log`.
* **No keeping it.** The frame is deleted on that computer after ten minutes, and served
  `no-store` so nothing caches a copy that outlives it. The card expires with it.

Where the pixels are analysed is your HomePilot's Multimodal setting: local Ollama by
default, so the picture never leaves that machine. The 🔒 line under each card says which.

## Removing it

Delete `src/features/screen/` and its four `<script>` tags in `index.html`; on the HomePilot
side delete `backend/app/screensense/` and its one `include_router` line. Nothing else refers
to either.
