# GLB Models (Deprecated)

GLB model support has been deprecated in favor of VRM format, which provides
full feature support (expressions, lip sync, gaze tracking, spring bone physics,
standardized humanoid bone mapping).

## Remaining Files

| File        | Size  | Notes                   |
| ----------- | ----- | ----------------------- |
| girl.glb    | 7.7MB | Kept for legacy testing |
| student.glb | 1.3MB | Kept for legacy testing |

## Removed Models (backlog for VRM conversion)

The following GLB models were removed from the repository to reduce size. They
can be re-obtained from their original sources and converted to VRM.

| Model             | Size  | Source                       | Morph Targets |
| ----------------- | ----- | ---------------------------- | ------------- |
| avatarsdk.glb     | 12MB  | AvatarSDK (TalkingHead)      | Yes           |
| avaturn.glb       | 14MB  | Avaturn (TalkingHead)        | Yes           |
| brunette.glb      | 4.6MB | TalkingHead                  | Yes           |
| brunette-t.glb    | 2.8MB | TalkingHead (T-Pose)         | Yes           |
| mpfb.glb          | 36MB  | MakeHuman/MPFB (TalkingHead) | Yes           |
| readyplayerme.glb | 1.8MB | Ready Player Me              | Yes           |
| woman.glb         | 14MB  | Local                        | No            |

## Why VRM over GLB?

GLB models lack VRM-specific features:

- No standardized humanoid bone mapping (relies on name heuristics)
- No spring bone physics (hair, skirts, accessories don't move)
- No standardized expression system (depends on morph target naming)
- No eye gaze bone tracking
- No VRMA animation support (the official VRM animation format)

## How to convert GLB to VRM

See `addons/EXTERNAL_TOOLS.md` for conversion tools and guides.
