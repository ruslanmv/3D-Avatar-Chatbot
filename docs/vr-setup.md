# VR / AR Setup

## Requirements

- **HTTPS** — WebXR requires a secure context (`https://` or `localhost`)
- **Browser** — Meta Quest Browser, Wolvic, or any WebXR-compatible browser
- **Headset** — Meta Quest 2/3/Pro, Pico, HTC Vive, or any WebXR device

## Quick Start

### Desktop (no headset)

Open the app in Chrome/Edge. The VR/AR buttons appear in the avatar footer if WebXR is available.

### Meta Quest

1. Enable **Developer Mode** on your Quest (Settings → System → Developer)
2. Open **Meta Quest Browser**
3. Navigate to your deployed URL (e.g., `https://your-app.vercel.app`)
4. Click **Enter VR** in the avatar footer
5. Put on your headset

### Local network (development)

```bash
# Find your local IP
hostname -I    # Linux
ipconfig       # Windows

# Start the dev server
npm run dev

# On Quest Browser, navigate to:
# https://YOUR_IP:8080
```

For local development without HTTPS, use `localhost` or set up a self-signed certificate.

## AR Mode

- **Mobile (iOS)** — Uses Quick Look (USDZ) for native AR
- **Mobile (Android)** — Uses Scene Viewer for native AR
- **Desktop** — Shows QR code to launch AR on your phone
- **WebXR headset** — Hit-test surface detection with shadow plane

The AR button auto-detects your platform and uses the best available method.
On mobile, AR is also accessible from the hamburger menu drawer → VR/AR button.

## Passthrough Mode (Quest 3)

Passthrough lets you see your real room through the headset cameras while
the 3D avatar stands in front of you with realistic grounding.

### How to enable

1. Enter VR mode on Quest 3
2. Open the chat panel (X button)
3. Cycle the **BG** button to **PASS** (Black → Blue → Void → Passthrough)
4. Your room appears as background with the avatar grounded via contact shadow

### How it works

The `PassthroughEnhancer` module activates automatically and provides:

- **Contact shadow** — Soft radial gradient under the avatar's feet for
  believable grounding in your real environment
- **Light estimation** — Uses the WebXR Light Estimation API to match virtual
  lighting to your room's real-world conditions (direction, intensity, color)
- **Depth occlusion** — On Quest 3, real objects can appear in front of virtual
  ones using the depth sensing API
- **Warm indoor lighting** — Default passthrough lighting tuned for typical
  indoor environments with soft shadows

When you switch away from passthrough (cycle BG back to Black/Blue/Void),
all lighting and shadow settings are restored to their previous state.

### Passthrough via AR mode

You can also switch to full AR mode from the VR settings panel by cycling
the **VIEW** button to **PASS**. This ends the VR session and starts an
immersive-ar session with hit-test placement. The passthrough enhancements
(contact shadow, light estimation) activate automatically in AR mode.

## Meta Quest Troubleshooting

| Problem | Solution |
| ------- | -------- |
| VR button missing | Ensure HTTPS. Check browser console for WebXR errors |
| Black screen in VR | Hard refresh (pull down to reload in Quest Browser) |
| Controller not tracked | Exit and re-enter VR session |
| Poor performance | Reduce polygon count. Target < 50K triangles per avatar |
| Audio not working | Grant audio permissions. Check Quest volume |
| Can't connect locally | Use `https://` not `http://`. Check firewall allows port 8080 |

### Developer console on Quest

1. Connect Quest to PC via USB
2. Open `chrome://inspect/#devices` in desktop Chrome
3. Click "Inspect" next to your Quest Browser tab
4. Full Chrome DevTools available for debugging

## Performance Tips

- Keep avatar models under 50K triangles for smooth VR (72+ FPS)
- Use compressed textures (KTX2) when possible
- Limit real-time shadows to 1 directional light
- The app auto-adjusts quality via `PerformanceMonitor` (reduces shadow quality, disables SSAO on mobile)
