# VR Controller Reference

Complete guide to VR controller input for the 3D Avatar Chatbot.

## Controller Layout (Meta Quest 2/3)

```
LEFT CONTROLLER                    RIGHT CONTROLLER
┌─────────────┐                    ┌─────────────┐
│  [Y] PTT    │                    │  [B]        │
│  [X] Menu   │                    │  [A]        │
│             │                    │             │
│  [Stick]    │                    │  [Stick]    │
│  Move/Strafe│                    │  Snap Turn  │
│             │                    │             │
│  [Trigger]  │                    │  [Trigger]  │
│  Grab/Spin  │                    │  Grab/Spin  │
│             │                    │             │
│  [Grip]     │                    │  [Grip]     │
│  (reserved) │                    │  Fly Up/Down│
└─────────────┘                    └─────────────┘
```

## Movement

| Control | Action |
| ------- | ------ |
| Left stick forward/back | Walk forward/backward |
| Left stick left/right | Strafe left/right |
| Right stick left/right | Snap turn (45 degrees) |
| Right grip + right stick up/down | Fly up/down |

Movement speed can be adjusted via the VR settings panel (slow / normal / fast).

## Avatar Interaction

| Control | Action |
| ------- | ------ |
| Either trigger (hold) | Grab and spin avatar (turntable) |
| Release trigger | Avatar stays at new rotation |

## Chat Panel

| Control | Action |
| ------- | ------ |
| X button (left) | Toggle chat panel visibility |
| Y button (left) | Push-to-talk (hold to record, release to send) |

The chat panel is a 3D canvas that floats in front of you. It shows the conversation, current AI provider/model, and a mic button.

### Voice Interaction Flow

1. **Press and hold Y** — microphone activates, panel shows recording indicator
2. **Speak your message** — speech is transcribed in real-time
3. **Release Y** — message is sent to the AI provider
4. **Avatar responds** — text appears on the chat panel, TTS speaks the response

### Chat Panel Settings

The VR chat panel syncs settings from the desktop settings modal:

- AI provider and model
- System prompt / personality
- TTS voice and rate

Changes made in desktop settings before entering VR are automatically applied.

## VR Settings (In-Headset)

Access VR-specific settings via the chat panel:

| Setting | Options | Default |
| ------- | ------- | ------- |
| Avatar Scale | 0.5x – 2.0x | 1.0x |
| Movement Speed | Slow / Normal / Fast | Normal |
| VR Background | Black / Blue / Void | Black |
| Session Mode | VR / AR | VR |

## Customization (Developer)

```javascript
// Adjust movement speed
vrControllers.options.moveSpeed = 2.5;

// Adjust snap turn angle
vrControllers.options.snapAngle = 30;

// Adjust vertical flight speed
vrControllers.options.verticalSpeed = 1.5;

// Custom button callback
vrControllers.setMenuButtonCallback(() => {
  console.log('X button pressed');
});
```

## Browser Support

| Browser | VR | AR | Controllers |
| ------- | -- | -- | ----------- |
| Meta Quest Browser | Yes | Yes | Full 6DOF |
| Wolvic | Yes | No | Full 6DOF |
| Chrome (desktop) | Emulator only | No | N/A |
| Firefox Reality | Yes | No | Full 6DOF |
