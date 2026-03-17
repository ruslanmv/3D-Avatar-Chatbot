# VRMA Animation Files

## Active (wired into the application)

These 5 VRMA files are currently active and map to existing emotions:

- **Angry.vrma** — maps to `angry` emotion
- **Sad.vrma** — maps to `sad` emotion
- **Thinking.vrma** — maps to `thinking` emotion
- **Surprised.vrma** — maps to `surprised` emotion
- **Relax.vrma** — maps to `relax` / idle state

## Inactive (kept for future use)

The following VRMA files are **not currently compatible** with the avatar skeleton
and cause errors when loaded. They are kept here for future integration once
skeleton retargeting is improved:

- Blush.vrma
- Clapping.vrma
- Goodbye.vrma
- Jump.vrma
- LookAround.vrma
- Sleepy.vrma

These files were sourced from [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer).

## Re-enabling

To re-enable any of these files:
1. Add the file path back to `vendor/animations/manifest.json` under the `vrma` category
2. Test with your target avatar to verify skeleton compatibility
