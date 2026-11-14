# Verification before integration

Use this for every candidate in `develop/sources/`. Do not merge motion into
production until the checklist passes for that clip (or a small batch).

## Per clip

- [ ] License allows Apache-2.0 redistribution (CC0 / CC BY with credit / CMU).
- [ ] Provenance line exists under the source `PROVENANCE.md`.
- [ ] Converted or playable on a VRM 0.x avatar (`AvatarSample_A` first).
- [ ] AX16 / `animation-audit --play` (or runtime audit): not `hips-floating`,
      not sink, not inverted legs, not `no-motion` unless expected for a static
      pose hold.
- [ ] Intent mapping proposed (sit / dance / wave / follow / idle / …) or marked
      pose-only.
- [ ] Second avatar spot-check (e.g. Vita) if retarget-sensitive.
- [ ] Credit string ready for `vendor/animations/manifest.json`.

## Batch gate

```bash
node tools/qa/animation-audit.mjs
node tools/qa/animation-audit.mjs --check
# after candidates are copied to a test path the harness can see:
node audits/vrm_animations/run.mjs --avatar AvatarSample_A
```

## Promotion

1. Copy verified files into `vendor/animations/<category>/` (or `addons/…` for
   experimental).
2. Update `manifest.json` credits + categories.
3. Wire intents only if needed (`MotionClipMap` / Pose presets) — **separate
   product PR**, not this staging folder.
4. Mark the item `integrated: true` in `develop/MANIFEST.json` (or remove from
   staging once shipped).

## Known gaps these packs target

| Need                       | Candidate source                               |
| -------------------------- | ---------------------------------------------- |
| Natural idle / sway / wait | ACCAD Female1 `A02_Sway`, `D2_Wait`            |
| Conversation gestures      | ACCAD `D3_ConversationGestures`; CMU `18_08`   |
| Wave / point               | CMU `13_26`, `13_27`, `14_24`                  |
| Sit ↔ stand               | CMU `13_01`, `13_02`; ACCAD stand/walk         |
| Jumping jacks / stretch    | CMU `13_29`, `14_06`                           |
| Walk variety               | ACCAD walks; CMU `17_*`; Quaternius locomotion |
| Emotes / sit / jump (game) | Quaternius UAL Standard GLB                    |
