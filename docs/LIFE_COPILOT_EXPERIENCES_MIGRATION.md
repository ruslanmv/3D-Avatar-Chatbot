# Life, Copilot, Experiences — migration

The Together chooser is still there. The two-person toolbar button still
opens it. This pass adds a destination bar on the avatar card and routes
its actions into modules that already worked, plus one new experience.

Hide the bar without turning the Behavior Director off:

```js
localStorage.setItem('nexus_companion_nav', 'false');
```

Unset, or any value other than `'false'`, shows it. The default destination
is Life.

## What each action calls

| Destination | Action | Implementation |
| --- | --- | --- |
| Life | Talk | Focuses `#speech-text`. Same chat. |
| Life | Relax | Starts Together Focus with the sit input (no capture). |
| Life | Shared moments | Opens Music setup. |
| Life | Memories | Life scope. A title is stored only with an explicit save. |
| Life | Watch or listen | Opens Watch setup. The panel still owns the screen grant. |
| Life | Preferences | Relationship enums, environment volume, reduced motion, optional Life-memory grant for Copilot. Romance above "off" is stored only when `NEXUS_SPICY` is enabled, and never applied as a Copilot mood. |
| Copilot | Tasks, projects, planning | Local board in the Copilot scope. No calendar, mail, or files. |
| Copilot | Focus | Opens the existing Focus setup (study or sit). |
| Copilot | Learn | Opens `NEXUS_STUDY_LOOP` when it is loaded, and focuses the chat box. |
| Copilot | Research and help | Focuses chat. Lookup runs only if that provider is already enabled. |
| Copilot | Screen help | Opens the Copilot activity setup, which explains the camera before the activity asks. |
| Experiences | Seaside Evening | Experience director. |
| Experiences | Scene Tale | Opens Playground, the existing Scene Tale. |
| Experiences | Character studio | Clicks `#openPoseStudioBtn` when that button exists. Wardrobe stays on its current path. |
| Experiences | Saved experiences | Progress beats in the Experiences scope. |

Cozy Evening, Mystery Adventure, Creative Studio, and a scene-sized Character
Studio are listed as not available. They are not buttons that pretend to start.

## Storage

| Key | Contents | Cleared with the chat? |
| --- | --- | --- |
| `nexus_chat_messages` | transcript | yes |
| `nexus_companion_session_v1` | ids, destination, voice, comfort, grants | no |
| `nexus_companion_memory_v1` | scopes | no |

Schema version is 1. A newer blob is ignored and a fresh session is used.
Stored destinations `together`, `journey`, `coach`, `game`, `play`, and
`playground` migrate onto the three destinations. The conversation id is
kept.

## Prompt

`NEXUS_COMPANION.systemPromptSuffix()` returns `''` until the person uses a
destination (`customized`). Copilot's paragraph lists open tasks and forbids
relationship memories. Life and Experiences may include relationship enums
and approved titles. Neither paragraph grants the model the camera, the
microphone, or the renderer.

## Adult boundary

Private memory and romance above "off" require the existing spicy switch.
Copilot refuses both even when the switch is on. Starting Seaside does not
open private mode. Scene Tale's own private gate is unchanged.

## Not removed

`NEXUS_TOGETHER_*`, activity files, journey manifests, coach, focus, and the
Together panel. Retiring a tile waits until the replacement has been used in
the same acceptance tests the tile already has. That bar is not met for
Watch's file picker, Coach's rep counter, or Meeting.
