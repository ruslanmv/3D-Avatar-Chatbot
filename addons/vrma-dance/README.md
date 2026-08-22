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

## Converted from this repo's own BVH files

The 11 `dance_*.vrma` files were produced from `vendor/animations/dance/*.bvh` —
assets that already ship with this project — using the official
[vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) converter (MIT, VRM
Consortium), run unmodified against its own conversion library.

There is nothing new to license: same motions, same source files, now in the
format that retargets to any VRM avatar. They therefore play with the Settings →
"BVH animations" toggle OFF, which the `.bvh` originals cannot.

| File                          | Motion             | Length |
| ----------------------------- | ------------------ | ------ |
| dance_1.vrma                  | Dance 1            | 22.1s  |
| dance_2.vrma                  | Dance 2            | 20.4s  |
| dance_backup.vrma             | Backup             | 25.4s  |
| dance_dab.vrma                | Dab                | 7.7s   |
| dance_gangnam_style.vrma      | Gangnam Style      | 12.4s  |
| dance_headdrop.vrma           | Head drop          | 15.7s  |
| dance_marachinostep.vrma      | Marachino step     | 3.2s   |
| dance_northern_soul_spin.vrma | Northern soul spin | 8.8s   |
| dance_ontop.vrma              | On top             | 24.3s  |
| dance_pushback.vrma           | Pushback           | 17.8s  |
| dance_rumba.vrma              | Rumba              | 2.3s   |

Each was validated after conversion: GLB container, `VRMC_vrm_animation`
extension present, 52 human bones mapped, 55 animation channels.

### Adding your own

Drop any `.vrma` into this folder and the clip index picks it up — say its name
and it plays, with no code change. Add it to `ADDON_DANCE` in
`src/xr/MotionClipMap.js` if you also want it in the random "dance" pool. Keep
per-file credit lines here for anything sourced externally.
