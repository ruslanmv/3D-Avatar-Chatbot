# Documentation

| Guide                             | Description                                                               |
| --------------------------------- | ------------------------------------------------------------------------- |
| [deployment.md](deployment.md)    | Deploy to Vercel, GitHub Pages, Netlify, or any static host               |
| [vr-setup.md](vr-setup.md)       | VR/AR/Passthrough setup, Meta Quest configuration, troubleshooting        |
| [vr-controls.md](vr-controls.md) | VR controller mapping, movement, chat panel, voice, passthrough settings  |
| [speech.md](speech.md)            | Speech-to-text, text-to-speech, microphone selection, browser support     |
| [llm-manager.md](llm-manager.md) | Multi-provider AI configuration (OpenAI, Claude, Watsonx, Ollama, OllaBridge) |
| [proxy-setup.md](proxy-setup.md) | CORS proxy setup for API requests                                         |
| [poses.md](poses.md)             | Avatar pose presets, AI pose selection API, VR/Desktop sync               |

## Recent additions

- **Face Tracking** — Webcam expression mirroring via MediaPipe FaceLandmarker
  (52 ARKit blend shapes → VRM) with smooth camera zoom to face
- **Passthrough AR** — See your real room with the avatar grounded via contact
  shadows, light estimation, and depth occlusion (Quest 3)
- **Pose Studio** — Interactive bone-level pose editing with presets, save/load,
  undo/redo, and arm mirroring
- **Mobile drawer** — Enterprise mobile navigation with wired buttons for
  Settings, Info, Upload, Voice, VR/AR, Pose Studio, and Fullscreen

## API Reference

Generate API docs from source with JSDoc:

```bash
npm run docs
open docs/index.html
```
