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
