# VR Controller Reference

Complete guide to VR controller input for the 3D Avatar Chatbot.
Follows the [W3C WebXR xr-standard gamepad mapping](https://www.w3.org/TR/webxr-gamepads-module-1/)
and [Meta Quest Touch controller guidelines](https://developers.meta.com/horizon/design/controllers/).

## Controller Layout (Meta Quest 2/3)

```
LEFT CONTROLLER                    RIGHT CONTROLLER
┌─────────────┐                    ┌─────────────┐
│  [Y] PTT    │                    │  [B] PTT    │
│  [X] Menu   │                    │  [A] Menu   │
│             │                    │             │
│  [Stick]    │                    │  [Stick]    │
│  Move/Strafe│                    │  Snap Turn  │
│             │                    │  Fly Up/Down│
│  [Trigger]  │                    │  [Trigger]  │
│  Select/UI  │                    │  Select/UI  │
│             │                    │             │
│  [Grip]     │                    │  [Grip]     │
│  Grab/Drag  │                    │  Grab/Drag  │
└─────────────┘                    └─────────────┘
```

## Industry-Standard Mapping

This control scheme follows the same conventions as VRChat, Half-Life: Alyx,
Meta Horizon Worlds, and other major VR titles:

| Action          | Input                    | Notes                                       |
| --------------- | ------------------------ | ------------------------------------------- |
| **Select / UI** | Trigger (index finger)   | Point and click on UI elements               |
| **Grab / Hold** | Grip (squeeze)           | Grab avatar to spin, grab panel to drag       |
| **Move**        | Left stick               | Walk forward/back, strafe left/right          |
| **Turn**        | Right stick X            | Snap turn left/right                          |
| **Fly**         | Right stick Y            | Fly up/down                                   |
| **Menu**        | X (left) or A (right)    | Toggle chat panel visibility                  |
| **Push-to-talk**| Y (left) or B (right)    | Hold to record voice, release to send         |

### WebXR Button Index Reference

| Index        | Physical Button            |
| ------------ | -------------------------- |
| `buttons[0]` | Trigger (index finger)     |
| `buttons[1]` | Grip / Squeeze             |
| `buttons[3]` | Thumbstick click           |
| `buttons[4]` | X (left) / A (right)       |
| `buttons[5]` | Y (left) / B (right)       |

## Movement

| Control                   | Action                |
| ------------------------- | --------------------- |
| Left stick forward/back   | Walk forward/backward |
| Left stick left/right     | Strafe left/right     |
| Right stick left/right    | Snap turn             |
| Right stick up/down       | Fly up/down           |

Movement speed can be adjusted via the VR settings panel (slow / normal / fast).

## Avatar Interaction

| Control             | Action                                |
| ------------------- | ------------------------------------- |
| Grip (hold)         | Grab avatar — turntable spin          |
| Grip release        | Drop — avatar stays at new rotation   |
| Grip + point panel  | Grab and drag the chat panel          |

Both controllers can grab. Grip is the standard VR grab button used by
all major titles (VRChat, Alyx, Horizon Worlds, Rec Room).

## Chat Panel & Voice

| Control           | Action                                          |
| ----------------- | ----------------------------------------------- |
| X button (left)   | Toggle chat panel visibility                    |
| A button (right)  | Toggle chat panel visibility (alternative)      |
| Y button (left)   | Push-to-talk (hold to record, release to send)  |
| B button (right)  | Push-to-talk (alternative, hold to record)      |
| Trigger           | Click on UI buttons inside the chat panel       |

The chat panel is a 3D canvas that floats in front of you. It shows the
conversation, current AI provider/model, and a mic button.

### Voice Interaction Flow

1. **Press and hold Y (or B)** — microphone activates, panel shows recording indicator
2. **Speak your message** — speech is transcribed in real-time
3. **Release Y (or B)** — message is sent to the AI provider
4. **Avatar responds** — text appears on the chat panel, TTS speaks the response

### Chat Panel Settings

The VR chat panel syncs settings from the desktop settings modal:

- AI provider and model
- System prompt / personality
- TTS voice and rate

Changes made in desktop settings before entering VR are automatically applied.

## VR Settings (In-Headset)

Access VR-specific settings via the chat panel:

| Setting        | Options                           | Default |
| -------------- | --------------------------------- | ------- |
| Avatar Scale   | 0.5x – 2.0x                      | 1.0x    |
| Movement Speed | Slow / Normal / Fast              | Normal  |
| VR Background  | Black / Blue / Void / Passthrough | Black   |
| Panel Distance | Near / Medium / Far               | Medium  |
| Session Mode   | VR / AR (Passthrough)             | VR      |

### Passthrough background

Cycle the **BG** button to **PASS** to enable passthrough mode on Quest 3.
The headset cameras show your real room while the avatar stands in front of
you with a contact shadow for grounding. A green tint on the BG button
indicates passthrough is active. Light estimation and depth occlusion are
enabled automatically when available.

## Customization (Developer)

```javascript
// Adjust movement speed
vrControllers.options.moveSpeed = 2.5;

// Adjust snap turn speed
vrControllers.options.turnSpeed = 3.0;

// Adjust vertical flight speed
vrControllers.options.verticalSpeed = 1.5;

// Custom menu button callback
vrControllers.setMenuButtonCallback(() => {
    console.log('X or A button pressed');
});
```

## Browser Support

| Browser            | VR  | AR  | Controllers |
| ------------------ | --- | --- | ----------- |
| Meta Quest Browser | Yes | Yes | Full 6DOF   |
| Wolvic             | Yes | No  | Full 6DOF   |
| Chrome (desktop)   | Emulator only | No | N/A |
| Firefox Reality    | Yes | No  | Full 6DOF   |
