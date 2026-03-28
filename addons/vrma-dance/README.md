# VRMA Dance Animations (Future Use)

Mixamo-origin VRMA dance files from
[DavinciDreams/3dchat](https://github.com/DavinciDreams/3dchat).

**Status: NOT production-ready.** These files use Mixamo bone names
(`mixamorig:Hips`) which cause inverted poses on VRM 0.x models. They need
additional retargeting work before they can be used in production.

## Files

| File                  | Animation         |
| --------------------- | ----------------- |
| hipHopDancing.vrma    | Hip hop dance     |
| sambaDancing.vrma     | Samba             |
| rumbaDancing.vrma     | Rumba             |
| sillyDancing.vrma     | Silly/fun dance   |
| twistDance.vrma       | Twist             |
| hipHopDance.vrma      | Hip hop (variant) |
| dancingTwerk.vrma     | Twerk             |
| breakdanceUprock.vrma | Breakdance        |

## Known Issues

1. Mixamo bone names contain colons (`mixamorig:Hips`) — THREE.GLTFLoader
   sanitizes these, causing name mismatches (fixed in VRMAAnimationLoader.js)
2. VRM 0.x coordinate flip produces inverted poses — the
   `transformQuatForVRM0()` function negates X/Z but Mixamo-origin files may
   need different handling
3. Files are glTF JSON format (not binary) — GLTFLoader supports both

## To Re-enable

1. Fix VRM 0.x retargeting for Mixamo-origin VRMA files
2. Move files to `vendor/animations/vrma-dance/`
3. Add to `manifest.json` under a `vrma-dance` category
4. Add to `CLIP_INTENTS.dance.preferredFiles` in `AnimationPresets.js`

## Source

- Repository: https://github.com/DavinciDreams/3dchat
- License: Mixamo royalty-free (converted from Mixamo FBX)
