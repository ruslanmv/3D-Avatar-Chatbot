# GLB Models Archive

This folder contains GLB avatar models that were previously included in the main
chatbot library. These models are archived here for future conversion to VRM
format, which enables full feature support (expressions, lip sync, gaze
tracking, spring bone physics).

## Models

| File              | Size  | Source                       | Morph Targets |
| ----------------- | ----- | ---------------------------- | ------------- |
| avatarsdk.glb     | 12MB  | AvatarSDK (TalkingHead)      | Yes           |
| avaturn.glb       | 14MB  | Avaturn (TalkingHead)        | Yes           |
| brunette.glb      | 4.6MB | TalkingHead                  | Yes           |
| brunette-t.glb    | 2.8MB | TalkingHead (T-Pose)         | Yes           |
| girl.glb          | 7.7MB | Local                        | No            |
| mpfb.glb          | 36MB  | MakeHuman/MPFB (TalkingHead) | Yes           |
| readyplayerme.glb | 1.8MB | Ready Player Me              | Yes           |
| student.glb       | 1.3MB | Local                        | No            |
| woman.glb         | 14MB  | Local                        | No            |

## Why archived?

GLB models lack VRM-specific features:

- No standardized humanoid bone mapping (relies on name heuristics)
- No spring bone physics (hair, skirts, accessories don't move)
- No standardized expression system (depends on morph target naming)
- No eye gaze bone tracking

Once converted to VRM, these models can be moved back to `vendor/avatars/` and
added to `avatars.json` with full feature support.

## How to convert

See `addons/EXTERNAL_TOOLS.md` for conversion tools and guides.
